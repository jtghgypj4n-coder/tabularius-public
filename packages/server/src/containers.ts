import path from 'node:path';
// Container files over HTTP: streamed in pieces, with range requests (so
// video and audio play and seek, and big downloads resume), ETags, and
// thumbnails of images and PDFs.
//
//   GET /tabularius/containers/{db}/{id}/{name}?sig=...              the file (Range: bytes=... for part of it)
//   GET /tabularius/containers/{db}/{id}/{name}?sig=...&thumb=256    a PNG fitting 256 x 256
//
// Thumbnails of PNG, GIF and JPEG are made here, on a worker thread. PDFs and
// other formats (TIFF, HEIC, ...) use pdftoppm (Poppler) or, on macOS, sips
// when the machine has them; TABULARIUS_THUMBNAILS=builtin turns those off.
// Thumbnails are kept in memory, a few dozen megabytes' worth.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { accessSync, statSync, constants, mkdtempSync } from 'node:fs';
import { cleanupPath, readFileSync, writeFileSync } from '../../store/src/fs-boundary.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTAINER_CHUNK } from '../../store/src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { imageSize } from './thumbnails.ts';

const CACHE_BYTES = 48 * 1024 * 1024;
const WORKERS = 2;
const TOOL_TIMEOUT_MS = 20_000;
const WORKER_TIMEOUT_MS = 20_000;
export const THUMB_MIN = 16;
export const THUMB_MAX = 1024;
/** Pictures up to this size are sent as they are when they are no bigger than the thumbnail asked for; a bigger file is decoded and sent as a smaller PNG. */
export const THUMBNAIL_PASSTHROUGH_BYTES = 128 * 1024;
/** What a native converter (pdftoppm, sips) may use where the system can limit it: address space, CPU seconds and the size of a file it writes. */
const TOOL_ADDRESS_SPACE = 512 * 1024 * 1024;
const TOOL_CPU_SECONDS = 20;
const TOOL_FILE_BYTES = 16 * 1024 * 1024;
// Admission covers queued and running inputs across both decoding paths.
const THUMB_INPUT_BYTES = 64 * 1024 * 1024;
const THUMB_RETAINED_BYTES = 128 * 1024 * 1024;
const THUMB_JOBS = 16;

interface Thumb { mime: string; data: Uint8Array }
interface Making { promise: Promise<Thumb | undefined>; controller: AbortController; users: number }
class ThumbnailLimit extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * A Range header as one byte range of a file of `size` bytes; 'unsatisfiable' when it asks for bytes that are not there;
 * or undefined to send it all (RFC 9110: a Range in another unit, or one that is not well formed, is ignored). Several
 * ranges at once are not served as multipart: the whole file is sent (a server may ignore a Range), unless none of them
 * can be satisfied.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  const text = (header ?? '').trim();
  if (/^bytes=\s*(?:\d*-\d*)(?:\s*,\s*\d*-\d*)+$/.test(text)) {
    const each = text.slice(text.indexOf('=') + 1).split(',').map((r) => parseRange(`bytes=${r.trim()}`, size));
    // A part that is not a range at all (or is backwards) is ignored like a malformed Range, which sends everything.
    return each.some((r) => r === undefined) || each.some((r) => r !== 'unsatisfiable') ? undefined : 'unsatisfiable';
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(text);
  if (!m || (!m[1] && !m[2])) return undefined;
  let start: number, end: number;
  if (!m[1]) {
    const n = Number(m[2]);
    if (!n) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (m[2] && Number(m[2]) < start) return undefined;
  }
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

/**
 * Content-Disposition for a download. The plain name is ASCII only, with no quote, slash or backslash (a header can't
 * carry more, and a path in a name is never one); the real name goes in filename* (RFC 8187), every character a
 * browser might read as syntax encoded, with a stray half of a surrogate pair fixed.
 */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string | null): string {
  const real = (filename || 'file').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
  const plain = real.replace(/[^\x20-\x7e]|["\\/]/g, '_') || 'file';
  const star = encodeURIComponent(real).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${kind}; filename="${plain}"; filename*=UTF-8''${star}`;
}

/** A time as an HTTP date (whole seconds). */
const httpDate = (seconds: number) => new Date(seconds * 1000).toUTCString();

export class ContainerFiles {
  private readonly cache = new Map<string, Thumb>();
  private readonly incarnations = new WeakMap<Store, string>();
  private cached = 0;
  private readonly workers: (Worker | undefined)[] = [];
  private readonly pending = new Map<number, { worker: Worker; done: (png: Uint8Array | undefined) => void; data: Uint8Array; size: number; sent: boolean; timer?: NodeJS.Timeout }>();
  private readonly workerBusy: boolean[] = [];
  private readonly workerFailures: number[] = [];
  private readonly workerRetryAt: number[] = [];
  private readonly workerFailureLogged = new Set<number>();
  private nextJob = 0;
  private turn = 0;
  private stopped = false;
  private activeTools = 0;
  private readonly waitingTools: ((taken: boolean) => void)[] = [];
  private tools?: { pdftoppm?: string; sips?: string; prlimit?: string; sh?: string };
  /** Thumbnails being made, so a page of 50 asking at once makes each one once. */
  private readonly making = new Map<string, Making>();
  private retainedBytes = 0;
  private admittedJobs = 0;

  private readonly createWorker: () => Worker;
  private readonly workerTimeoutMs: number;
  private readonly platform: NodeJS.Platform;

  constructor(options: { createWorker?: () => Worker; workerTimeoutMs?: number; platform?: NodeJS.Platform } = {}) {
    this.platform = options.platform ?? process.platform;
    this.createWorker = options.createWorker ?? (() => new Worker(new URL('./thumbnail-worker.ts', import.meta.url)));
    this.workerTimeoutMs = options.workerTimeoutMs ?? WORKER_TIMEOUT_MS;
  }

  private containerVersion(store: Store, identity: string): string {
    let incarnation = this.incarnations.get(store);
    if (!incarnation) this.incarnations.set(store, incarnation = randomUUID());
    return createHash('sha256').update(incarnation).update('\0').update(String(identity)).digest('hex');
  }

  /** Sends a container file, or part of it, or its thumbnail. */
  async send(req: IncomingMessage, res: ServerResponse, store: Store, id: number, opts: { thumb?: number; headers?: Record<string, string> } = {}): Promise<void> {
    const info = store.containerInfo(id);
    if (!info) {
      res.writeHead(404).end();
      return;
    }
    if (info.external?.missing) {
      // Stored outside the FileMaker file, and that file wasn't copied here (RC_Data_FMS/<file>/).
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`externally stored file not found: ${info.external.path}\n`);
      return;
    }
    if (opts.thumb !== undefined) return this.sendThumbnail(req, res, store, id, info.version, Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(opts.thumb))));

    const etag = `"${id}-${info.size}-${this.containerVersion(store, info.version)}"`;
    // The type is the uploader's word: only kinds that can't run script show in place. Anything else (HTML, SVG,
    // XML...) is sent to be saved, and sandboxed should a browser show it anyway, so it never runs as this site.
    const mime = /^[\x21-\x7e][\x20-\x7e]*$/.test(info.mime) ? info.mime : 'application/octet-stream';
    const safe = inlineSafe(mime);
    const headers: Record<string, string | number> = {
      'content-type': mime,
      'content-disposition': contentDisposition(safe ? 'inline' : 'attachment', info.filename),
      ...(safe ? {} : { 'content-security-policy': "sandbox; default-src 'none'" }),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'accept-ranges': 'bytes',
      etag,
      ...(info.modified === undefined ? {} : { 'last-modified': httpDate(info.modified) }),
      ...opts.headers,
    };
    // The conditions of RFC 9110 section 13.2.2, in its order. A date is compared as the whole second it names.
    const since = (header: string | string[] | undefined): number | undefined => {
      const t = Date.parse(Array.isArray(header) ? header[0] : header ?? '');
      return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
    };
    const ifMatch = req.headers['if-match'];
    const unmodifiedSince = since(req.headers['if-unmodified-since']);
    if (ifMatch !== undefined ? !strongMatches(ifMatch, etag) : unmodifiedSince !== undefined && info.modified !== undefined && info.modified > unmodifiedSince) {
      res.writeHead(412, { 'content-type': 'text/plain; charset=utf-8', etag }).end('The file is not the one asked for');
      return;
    }
    const modifiedSince = since(req.headers['if-modified-since']);
    if (req.headers['if-none-match'] !== undefined ? matches(req.headers['if-none-match'], etag)
      : modifiedSince !== undefined && info.modified !== undefined && info.modified <= modifiedSince) {
      res.writeHead(304, headers).end();
      return;
    }
    // If-Range names the version the client holds, by tag or by date; anything else gets the whole file.
    const ifRange = [req.headers['if-range']].flat()[0]?.trim();
    const current = !ifRange || ifRange === etag || (info.modified !== undefined && since(ifRange) === info.modified && !/^(W\/)?"/.test(ifRange));
    const range = current && (req.method === 'GET' || req.method === 'HEAD') ? parseRange(req.headers.range, info.size) : undefined;
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` }).end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'content-length': end - start + 1,
      ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
    });
    if (req.method === 'HEAD' || info.size === 0) {
      res.end();
      return;
    }
    if (!info.chunked) {
      // Kept whole (small, or stored before pieces): one read.
      const file = store.container(id);
      res.end(file ? file.data.subarray(start, end + 1) : undefined);
      return;
    }
    // Piece by piece, waiting while the client catches up.
    let closed = false;
    res.once('close', () => (closed = true));
    for (let at = start; at <= end && !closed;) {
      const to = Math.min(end, (Math.floor(at / CONTAINER_CHUNK) + 1) * CONTAINER_CHUNK - 1);
      const piece = store.containerRange(id, at, to);
      if (!piece.length) break;
      at += piece.length;
      if (!res.write(piece)) await new Promise<void>((resolve) => {
        const go = () => {
          res.off('drain', go);
          res.off('close', go);
          resolve();
        };
        res.on('drain', go);
        res.on('close', go);
      });
    }
    res.end();
  }

  private async sendThumbnail(req: IncomingMessage, res: ServerResponse, store: Store, id: number, identity: string, size: number): Promise<void> {
    const alive = () => !req.aborted && !res.destroyed && !res.writableEnded;
    if (!alive()) return;
    // A restore can reuse both container ids and version counters. A newly opened
    // Store starts a fresh incarnation, even when the database inode is unchanged.
    // Only this container changing or the file reopening invalidates its bytes.
    const version = this.containerVersion(store, identity);
    const key = `${store.path}\0${id}\0${size}\0${version}`;
    const etag = `"t${id}-${size}-${version}"`;
    if (matches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { etag, 'cache-control': 'private, no-store' }).end();
      return;
    }
    let thumb = this.cache.get(key);
    if (thumb) {
      // Recently used: to the back of the queue.
      this.cache.delete(key);
      this.cache.set(key, thumb);
    } else {
      let making = this.making.get(key);
      if (!making) {
        if (this.making.size >= 64) {
          res.writeHead(503, { 'retry-after': '1' }).end('Too many thumbnails are being made; try again shortly');
          return;
        }
        const controller = new AbortController();
        making = { promise: this.make(store, id, size, controller.signal), controller, users: 0 };
        this.making.set(key, making);
        const current = making;
        current.promise = current.promise.then((result) => {
          if (result && !controller.signal.aborted && this.making.get(key) === current) this.remember(key, result);
          return result;
        }).finally(() => {
          if (this.making.get(key) === current) this.making.delete(key);
        });
      }
      making.users++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (--making.users === 0) {
          making.controller.abort();
          if (this.making.get(key) === making) this.making.delete(key);
        }
      };
      let disconnected!: () => void;
      const closed = new Promise<undefined>((resolve) => { disconnected = () => { release(); resolve(undefined); }; });
      res.once?.('close', disconnected);
      req.once?.('aborted', disconnected);
      try {
        if (!alive()) return;
        thumb = await Promise.race([making.promise, closed]);
      } catch (error) {
        if (!(error instanceof ThumbnailLimit)) throw error;
        if (alive()) res.writeHead(error.status, { 'content-type': 'text/plain; charset=utf-8', ...(error.status === 503 ? { 'retry-after': '1' } : {}) }).end(error.message);
        return;
      } finally {
        res.off?.('close', disconnected);
        req.off?.('aborted', disconnected);
        release();
      }
    }
    if (!alive()) return;
    if (!thumb) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No thumbnail for this kind of file');
      return;
    }
    res.writeHead(200, {
      'content-type': thumb.mime, 'content-length': thumb.data.length, 'cache-control': 'private, no-store', etag, 'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : thumb.data);
  }

  private async make(store: Store, id: number, size: number, signal = new AbortController().signal): Promise<Thumb | undefined> {
    if (this.stopped || signal.aborted) return undefined;
    const info = store.containerInfo(id);
    if (!info) return undefined;
    if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > THUMB_INPUT_BYTES) throw new ThumbnailLimit(413, 'Thumbnail input exceeds 64 MiB');
    if (this.admittedJobs >= THUMB_JOBS || this.retainedBytes + info.size > THUMB_RETAINED_BYTES) throw new ThumbnailLimit(503, 'Thumbnail capacity is full; retry later');
    this.admittedJobs++;
    this.retainedBytes += info.size;
    try { return await this.makeAdmitted(store, id, size, info.size, signal); }
    finally { this.admittedJobs--; this.retainedBytes -= info.size; }
  }

  private async makeAdmitted(store: Store, id: number, size: number, bytes: number, signal: AbortSignal): Promise<Thumb | undefined> {
    if (this.stopped || signal.aborted) return undefined;
    const file = store.container(id);
    if (!file) return undefined;
    const d = file.data;
    if (d.length > bytes) throw new ThumbnailLimit(413, 'Thumbnail input changed size; retry the request');
    const signature = Buffer.from(d.buffer, d.byteOffset, Math.min(d.length, 8));
    const builtin = signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : ['GIF87a', 'GIF89a'].includes(signature.subarray(0, 6).toString('ascii')) ? 'image/gif'
        : d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff ? 'image/jpeg' : undefined;
    if (builtin) {
      // A small picture is its own thumbnail when it is no bigger than asked for, or when it
      // is a JPEG, which is only read at an eighth of its size here and would come out smaller.
      const dims = imageSize(d);
      if (dims && dims.width > 0 && dims.height > 0 && d.length <= THUMBNAIL_PASSTHROUGH_BYTES) {
        const longest = Math.max(dims.width, dims.height);
        if (longest <= size || (d[0] === 0xff && longest / 8 < size)) return { mime: builtin, data: d };
      }
      const png = await this.inWorker(d, size, signal);
      if (png) return { mime: 'image/png', data: png };
    }
    if (this.stopped || signal.aborted) return undefined;
    const pdf = d[0] === 0x25 && d[1] === 0x50 && d[2] === 0x44 && d[3] === 0x46; // %PDF
    const png = pdf || file.mime.startsWith('image/') ? await this.withTool(d, pdf, size, signal) : undefined;
    return png && { mime: 'image/png', data: png };
  }

  private inWorker(data: Uint8Array, size: number, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    if (this.stopped || signal?.aborted) return Promise.resolve(undefined);
    for (let i = 0; i < WORKERS; i++) this.ensureWorker(i);
    const id = this.nextJob++;
    const slot = this.turn++ % WORKERS;
    const w = this.ensureWorker(slot)!;
    if (!w) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const cancel = () => {
        if (!this.pending.has(id)) return;
        if (job.sent) this.retireWorker(slot, job.worker, false);
        else { this.pending.delete(id); job.done(undefined); }
      };
      const job = { worker: w, done: (png: Uint8Array | undefined) => { signal?.removeEventListener('abort', cancel); resolve(png); }, data, size, sent: false };
      this.pending.set(id, job);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      this.sendNext(slot, w);
    });
  }

  private ensureWorker(slot: number): Worker | undefined {
    if (this.workers[slot] || this.stopped) return this.workers[slot];
    if (performance.now() < (this.workerRetryAt[slot] ?? 0)) return undefined;
    if ((this.workerFailures[slot] ?? 0) >= 3) {
      this.workerFailures[slot] = 0;
      this.workerRetryAt[slot] = 0;
      this.workerFailureLogged.delete(slot);
    }
    let w: Worker;
    try { w = this.createWorker(); } catch {
      this.workerFailed(slot);
      return undefined;
    }
    this.workers[slot] = w;
    w.unref();
    w.on('message', ({ id, png }: { id: number; png?: Uint8Array }) => {
      const job = this.pending.get(id);
      if (!job || job.worker !== w) return;
      if (job.timer) clearTimeout(job.timer);
      this.pending.delete(id);
      job.done(png && new Uint8Array(png));
      this.workerFailures[slot] = 0;
      this.workerRetryAt[slot] = 0;
      this.workerFailureLogged.delete(slot);
      this.workerBusy[slot] = false;
      this.sendNext(slot, w);
    });
    w.on('error', () => this.retireWorker(slot, w));
    w.on('exit', () => this.retireWorker(slot, w));
    return w;
  }

  private retireWorker(slot: number, worker: Worker, failed = true): void {
    if (this.workers[slot] !== worker) return;
    this.workers[slot] = undefined;
    this.workerBusy[slot] = false;
    if (failed) this.workerFailed(slot);
    const finished: (() => void)[] = [];
    for (const [id, job] of this.pending) {
      if (job.worker !== worker) continue;
      // A cancelled active request must not cancel other clients waiting here.
      if (!failed && !job.sent) continue;
      if (job.timer) clearTimeout(job.timer);
      this.pending.delete(id);
      finished.push(() => job.done(undefined));
    }
    const terminated = () => {
      // Keep input admission charged until the worker releases its copy.
      for (const done of finished) done();
      if (failed) return;
      const queued = [...this.pending].filter(([, job]) => job.worker === worker);
      if (!queued.length) return;
      const replacement = this.stopped ? undefined : this.ensureWorker(slot);
      for (const [id, job] of queued) {
        if (replacement) job.worker = replacement;
        else { this.pending.delete(id); job.done(undefined); }
      }
      if (replacement) this.sendNext(slot, replacement);
    };
    void worker.terminate().then(terminated, terminated);
  }

  private sendNext(slot: number, worker: Worker): void {
    if (this.stopped || this.workers[slot] !== worker || this.workerBusy[slot]) return;
    const next = [...this.pending].find(([, job]) => job.worker === worker && !job.sent);
    if (!next) return;
    const [id, job] = next;
    job.sent = true;
    this.workerBusy[slot] = true;
    try {
      worker.postMessage({ id, data: job.data, size: job.size });
      // Only an active job has a deadline. Time waiting behind work already
      // sent to this worker does not count against it.
      job.timer = setTimeout(() => this.retireWorker(slot, worker), this.workerTimeoutMs);
    } catch { this.retireWorker(slot, worker); }
  }

  private workerFailed(slot: number): void {
    const failures = (this.workerFailures[slot] ?? 0) + 1;
    this.workerFailures[slot] = failures;
    if (failures >= 3) {
      if (!this.workerFailureLogged.has(slot)) {
        this.workerFailureLogged.add(slot);
        console.warn(`Container thumbnail worker ${slot + 1} failed ${failures} times; retrying this worker slot in five minutes`);
      }
      this.workerRetryAt[slot] = performance.now() + 5 * 60_000;
      return;
    }
    this.workerRetryAt[slot] = performance.now() + [100, 500][failures - 1];
  }

  /** A thumbnail from pdftoppm or sips, when the machine has one of them. */
  private async withTool(data: Uint8Array, pdf: boolean, size: number, signal?: AbortSignal): Promise<Uint8Array | undefined> {
    if (this.stopped || signal?.aborted) return undefined;
    this.tools ??= process.env.TABULARIUS_THUMBNAILS === 'builtin' ? {} : {
      pdftoppm: findExecutable('pdftoppm', this.platform),
      sips: this.platform === 'darwin' ? findExecutable('sips', this.platform) : undefined,
      prlimit: this.platform === 'linux' ? findExecutable('prlimit', this.platform) : undefined,
      sh: this.platform === 'linux' ? findExecutable('sh', this.platform) : undefined,
    };
    const run = pdf && this.tools.pdftoppm
      ? (dir: string) => [this.tools!.pdftoppm!, ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to', String(size), join(dir, 'in'), join(dir, 'out')]] as const
      : this.tools.sips
        ? (dir: string) => [this.tools!.sips!, ['-s', 'format', 'png', '-Z', String(size), join(dir, 'in'), '--out', join(dir, 'out.png')]] as const
        : undefined;
    if (!run) return undefined;
    if (!await this.takeToolSlot(signal)) return undefined;
    let dir: string | undefined;
    let cleanup = () => {};
    try {
      if (this.stopped || signal?.aborted) return undefined;
      dir = mkdtempSync(join(tmpdir(), 'tabularius-thumb-'));
      cleanup = cleanupPath(dir, { recursive: true, force: true });
      writeFileSync(join(dir, 'in'), data);
      const [tool, toolArgs] = run(dir);
      const { cmd, args } = limitedCommand(tool, toolArgs, this.platform, this.tools);
      await new Promise<void>((resolve, reject) => {
        execFile(cmd, [...args], { timeout: TOOL_TIMEOUT_MS, maxBuffer: 1024 * 1024, signal }, (e) => (e ? reject(e) : resolve()));
      });
      if (this.stopped || signal?.aborted) return undefined;
      return new Uint8Array(readFileSync(join(dir, 'out.png')));
    } catch {
      return undefined;
    } finally {
      try { cleanup(); }
      finally { this.releaseToolSlot(); }
    }
  }

  private async takeToolSlot(signal?: AbortSignal): Promise<boolean> {
    if (this.stopped || signal?.aborted) return false;
    if (this.activeTools < WORKERS) { this.activeTools++; return true; }
    if (this.waitingTools.length >= THUMB_JOBS) return false;
    return new Promise<boolean>((resolve) => {
      const done = (taken: boolean) => { signal?.removeEventListener('abort', cancel); resolve(taken); };
      const cancel = () => {
        const index = this.waitingTools.indexOf(done);
        if (index !== -1) { this.waitingTools.splice(index, 1); done(false); }
      };
      this.waitingTools.push(done);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }

  private releaseToolSlot(): void {
    const next = this.waitingTools.shift();
    if (next) next(true);
    else this.activeTools--;
  }

  private remember(key: string, thumb: Thumb): void {
    this.cache.set(key, thumb);
    this.cached += thumb.data.length;
    for (const [k, v] of this.cache) {
      if (this.cached <= CACHE_BYTES && this.cache.size <= 1024) break;
      this.cache.delete(k);
      this.cached -= v.data.length;
    }
  }

  /** Drop bytes and in-flight cache entries when a hosted path closes or reopens. */
  clear(path: string): void {
    const prefix = `${path}\0`;
    for (const [key, thumb] of this.cache) if (key.startsWith(prefix)) {
      this.cache.delete(key);
      this.cached -= thumb.data.length;
    }
    for (const [key, making] of this.making) if (key.startsWith(prefix)) {
      this.making.delete(key);
      making.controller.abort();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const making of this.making.values()) making.controller.abort();
    this.making.clear();
    for (const done of this.waitingTools.splice(0)) done(false);
    for (const [id, job] of this.pending) {
      if (job.timer) clearTimeout(job.timer);
      this.pending.delete(id);
      job.done(undefined);
    }
    for (const w of this.workers.splice(0)) if (w) void w.terminate();
  }
}

/** If-Match: `*`, or one of the tags, compared strongly (a weak tag never matches). */
function strongMatches(header: string, etag: string): boolean {
  return header.trim() === '*' || header.split(',').some((t) => t.trim() === etag);
}

function matches(header: string | undefined, etag: string): boolean {
  return !!header && (header.trim() === '*' || header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag));
}

/**
 * The command that runs a native converter under resource limits, where the system has them: on Linux prlimit (or,
 * without it, `ulimit` in sh) caps address space at 512 MiB, CPU time at 20 seconds and the size of any file written at
 * 16 MiB. Neither the tool's name nor its arguments are ever part of shell text; sh gets them as separate arguments.
 * On macOS and Windows the converter runs without these limits (macOS does not enforce an address-space limit, and
 * Windows has no equivalent here); the 20-second wall-clock timeout, the 16 MiB input cap and the two converter slots
 * apply everywhere.
 */
export function limitedCommand(
  cmd: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  tools: { prlimit?: string; sh?: string },
): { cmd: string; args: string[]; limits: 'prlimit' | 'ulimit' | 'none' } {
  if (platform === 'linux' && tools.prlimit) {
    return { cmd: tools.prlimit, args: [`--as=${TOOL_ADDRESS_SPACE}`, `--cpu=${TOOL_CPU_SECONDS}`, `--fsize=${TOOL_FILE_BYTES}`, '--', cmd, ...args], limits: 'prlimit' };
  }
  if (platform === 'linux' && tools.sh) {
    // ulimit -v is in KiB; -f is in 512-byte blocks in POSIX mode, which is what sh runs in.
    const script = `ulimit -v ${TOOL_ADDRESS_SPACE / 1024}; ulimit -t ${TOOL_CPU_SECONDS}; ulimit -f ${TOOL_FILE_BYTES / 512}; exec "$@"`;
    return { cmd: tools.sh, args: ['-c', script, 'sh', cmd, ...args], limits: 'ulimit' };
  }
  return { cmd, args: [...args], limits: 'none' };
}

/** Native tools only: batch files would require a shell, which thumbnail inputs never enter. */
export function findExecutable(cmd: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, usable: (file: string) => boolean = (file) => {
  try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; }
}): string | undefined {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const names = platform === 'win32' ? [`${cmd}.exe`, `${cmd}.com`] : [cmd];
  for (const entry of (env.PATH ?? env.Path ?? '').split(paths.delimiter)) {
    const dir = entry.replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const name of names) {
      const file = paths.join(dir, name);
      if (usable(file)) return file;
    }
  }
  return undefined;
}

/** Types a browser shows without running anything from the file: pictures (not SVG), PDF, sound, video and plain text. */
export function inlineSafe(mime: string): boolean {
  // A list ("text/plain;,text/html": browsers take the last type) or control characters: not something to show inline.
  if (/[,\x00-\x1f\x7f]/.test(mime)) return false;
  const t = mime.split(';')[0].trim().toLowerCase();
  return /^image\/(png|jpeg|gif|webp|avif|bmp|heic|heif|tiff|x-icon|vnd\.microsoft\.icon)$/.test(t) || t === 'application/pdf'
    || /^(audio|video)\/[a-z0-9.+-]+$/.test(t) || t === 'text/plain' || t === 'text/csv';
}

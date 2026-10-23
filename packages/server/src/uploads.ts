// Hosting a FileMaker file from the admin console: the browser sends the
// .fmp12 in pieces (so a multi-gigabyte file isn't one endless request, and
// an interrupted upload picks up where it stopped), the server converts it
// on a worker thread, reporting tables and records as it goes, then hosts it
// and keeps the conversion report: what in the file won't work yet.
//
//   POST   /tabularius/admin/v1/uploads              {name: "Contacts.fmp12", size}  -> the upload
//   PUT    /tabularius/admin/v1/uploads/{id}?offset=N   the next piece (raw bytes, up to 64 MB)
//   POST   /tabularius/admin/v1/uploads/{id}/finish  every byte is there: convert and host it
//   GET    /tabularius/admin/v1/uploads              uploads and their progress, newest first
//   DELETE /tabularius/admin/v1/uploads/{id}         stop an upload (or forget a finished one)
//
// Pieces wait in <folder>/.openhbam-uploads until the file is converted;
// then the .fmp12 sits next to its store, as if it had been dropped into
// the folder.

import { eachChunk } from './dataapi.ts';
import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { cleanupPath, openSync, writeSync } from '../../store/src/fs-boundary.ts';
import { join } from 'node:path';
import type { ImportProgress } from '../../store/src/index.ts';
import type { Host } from './host.ts';
import { sourceEncryption, STORE_EXT } from './host.ts';
import { ENCRYPTED_EXT } from './encrypt.ts';
import { conversionReport, type ConversionReport } from './conversion.ts';
import { optimizationReport } from './optimization.ts';
import { pluginReadiness } from './plugin-readiness.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';

export const MAX_PIECE = 64 * 1024 * 1024;
const KEEP = 20;
/** An upload that has received nothing for this long is abandoned and removed (TABULARIUS_UPLOAD_IDLE_HOURS, default 24; 0 keeps them). */
export const UPLOAD_IDLE_MS = Math.max(0, Number(process.env.TABULARIUS_UPLOAD_IDLE_HOURS ?? 24) || 0) * 60 * 60 * 1000;
const UPLOAD_DIR = '.openhbam-uploads';
/**
 * The largest upload accepted, so a declared size can't fill the disk before a
 * byte of it is checked. Default 10 GB; set TABULARIUS_MAX_UPLOAD to the number of
 * bytes (0 for no limit) on a server that hosts larger files from the browser.
 */
export const MAX_UPLOAD = Math.max(0, Math.trunc(Number(process.env.TABULARIUS_MAX_UPLOAD ?? 10 * 1024 * 1024 * 1024)) || 0);

/** Source bytes allowed across uploading, queued and converting files. Always finite; 0/invalid uses 20 GiB. */
export const MAX_UPLOAD_IN_PROGRESS = positiveBytes(process.env.TABULARIUS_MAX_UPLOAD_IN_PROGRESS, 20 * 1024 * 1024 * 1024);
function positiveBytes(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Upload {
  id: string;
  /** The name it will be hosted as (the file name without .fmp12). */
  name: string;
  size: number;
  received: number;
  phase: 'uploading' | 'waiting' | 'converting' | 'hosted' | 'failed' | 'locked';
  started: string;
  finished?: string;
  /** While converting: tables done of all, and records copied. */
  progress?: ImportProgress;
  tables?: number;
  records?: number;
  error?: string;
  /** What won't work yet, once hosted. */
  report?: Pick<ConversionReport, 'summary'> & { items: number };
  /** What its plug-in calls will do here (plugin-readiness.ts): the one line the console shows, empty when every call runs. */
  plugins?: { line: string; willNotRun: number };
  /** Ways to make the converted file smaller and faster (optimization.ts): how many, and the report as text. */
  optimization?: { items: number; high: number; headline: string; text: string };
}

/** A FileMaker file name to host: its base name, or why it can't be. */
export function hostedName(file: unknown): string {
  if (typeof file !== 'string') throw new UploadError(400, 'Name the file');
  const base = file.split(/[\\/]/).pop()!.trim();
  const m = /^(.+)\.fmp12$/i.exec(base);
  if (!m) throw new UploadError(400, `${base || 'That'} isn't a FileMaker database file. Choose a file whose name ends in .fmp12.`);
  const name = m[1];
  // Windows treats these as devices with any extension, and drops trailing dots and spaces ("Contacts." is "Contacts").
  const device = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3])(?:[ .]|$)/i.test(name);
  // eslint-disable-next-line no-control-regex
  if (name.startsWith('.') || /[\u0000-\u001f<>:"|?*]/.test(name) || name.endsWith(STORE_EXT.slice(0, -7)) || /[ .]$/.test(name) || device
    // The longest name the file makes beside itself: its journal and "-wal" and "-shm" files, "<name>.results-wal" and "<name>.enc.partial".
    || Buffer.byteLength(name + STORE_EXT + '.enc.partial') > 255 || Buffer.byteLength(name + STORE_EXT + '.results-wal') > 255 || Buffer.byteLength(name + '.fmp12') > 255) {
    throw new UploadError(400, `"${base}" isn't a name a file can be hosted under. Rename it without any of < > : " | ? *, with no dot or space at the end and not starting with a dot, then try again.`);
  }
  return name;
}

/** A size for a person to read: 1.5 GB, 700 MB, 12 KB. */
export function readableBytes(n: number): string {
  const unit = n >= 1024 ** 3 ? [1024 ** 3, 'GB'] as const : n >= 1024 ** 2 ? [1024 ** 2, 'MB'] as const : [1024, 'KB'] as const;
  const v = n / unit[0];
  return `${v >= 10 ? Math.round(v) : Number(v.toFixed(1))} ${unit[1]}`;
}

/**
 * What a person is told when a file could not be hosted: what happened to it and what to do next, not the converter's
 * own words ("block 1 out of range"). Anything not recognised keeps the converter's text, after a plain first sentence.
 */
export function explainHostingFailure(name: string, raw: string): string {
  const file = `${name}.fmp12`;
  if (/bad magic number|not a FileMaker file/i.test(raw)) {
    return `${file} isn't a FileMaker database: it doesn't start the way a .fmp12 file does. Make sure it is the database file itself (not a backup, an export or a file of another kind that was renamed), then drop it again.`;
  }
  if (/block count \d+ does not match|out of range|truncated|unexpected end|end of (?:file|data)/i.test(raw)) {
    return `${file} ends too early, so it was probably copied only in part. Copy it again, check that its size matches the original, then drop it here again.`;
  }
  if (/wrong passphrase/i.test(raw)) return `That passphrase doesn't open ${file}. Check it and try again.`;
  if (/Encryption at Rest/i.test(raw)) return `${file} uses Encryption at Rest. Enter its passphrase under Hosted files to host it.`;
  if (/^conversion took longer than \d+s and was stopped$/.test(raw)) {
    return `${file} couldn't be converted: ${raw}. Ask the server administrator to increase TABULARIUS_CONVERT_TIMEOUT, then try again.`;
  }
  return `${file} couldn't be converted: ${raw}. If it opens in FileMaker Pro, please report this with the version that made the file; if it doesn't, the file itself may be damaged.`;
}

const quota = () => `Too much is being uploaded at once (the aggregate quota for uploads in progress is ${readableBytes(MAX_UPLOAD_IN_PROGRESS)}). Wait for the others to finish, then try again.`;

export class Uploads {
  private readonly host: Host;
  private readonly log: (msg: string) => void;
  private readonly sweeper?: NodeJS.Timeout;
  private readonly uploads = new Map<string, Upload>();
  private readonly dir: string;
  private readonly owner = `${process.pid}-${randomBytes(9).toString('hex')}`;
  private readonly now: () => number;
  private readonly idleMs: number;
  /** When each upload last started or received a piece (monotonic milliseconds). */
  private readonly active = new Map<string, number>();
  private readonly writing = new Set<string>();
  private readonly cleanups = new Map<string, ReturnType<typeof cleanupPath>>();
  private readonly conversions = new Map<string, { stop: AbortController; done: Promise<void> }>();

  constructor(host: Host, log: (msg: string) => void = () => {}, opts: { now?: () => number; idleMs?: number } = {}) {
    this.host = host;
    this.log = log;
    this.now = opts.now ?? (() => monotonicClock.now());
    this.idleMs = opts.idleMs ?? UPLOAD_IDLE_MS;
    this.dir = join(host.dir, UPLOAD_DIR);
    // Keep live and unidentifiable owners, including legacy files and reused PIDs.
    if (existsSync(this.dir)) for (const file of readdirSync(this.dir)) {
      const owner = /^([1-9][0-9]*)-[a-f0-9]{18}-[A-Za-z0-9_-]{12}\.part$/.exec(file);
      if (!owner || !Number.isSafeInteger(Number(owner[1]))) continue;
      try { process.kill(Number(owner[1]), 0); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') rmSync(join(this.dir, file), { force: true });
      }
    }
    if (this.idleMs > 0) this.sweeper = setInterval(() => this.sweep(), Math.min(this.idleMs, 15 * 60 * 1000)).unref();
  }

  stop(): void {
    clearInterval(this.sweeper);
  }

  list(): Upload[] {
    this.sweep();
    return [...this.uploads.values()].reverse();
  }

  get(id: string): Upload {
    const u = this.uploads.get(id);
    if (!u) throw new UploadError(404, 'No such upload: it may have been removed, or the server restarted. Drop the file again to start over.');
    return u;
  }

  private part(id: string): string {
    return join(this.dir, `${id}.part`);
  }

  private cleanPart(id: string, throwOnError = true): void {
    const cleanup = this.cleanups.get(id);
    this.cleanups.delete(id);
    cleanup?.({ throwOnError });
  }

  private taken(name: string): boolean {
    const lower = name.toLowerCase();
    return !!this.host.get(name) || existsSync(join(this.host.dir, name + STORE_EXT)) || existsSync(join(this.host.dir, name + STORE_EXT + ENCRYPTED_EXT)) || existsSync(join(this.host.dir, name + '.fmp12'))
      || [...this.uploads.values()].some((u) => u.name.toLowerCase() === lower && u.phase !== 'failed' && u.phase !== 'hosted' && u.phase !== 'locked');
  }

  /** Count bytes already stored, including pieces currently being written. */
  private bytesInProgress(): number {
    let bytes = 0;
    for (const u of this.uploads.values()) {
      if (u.phase === 'waiting' || u.phase === 'converting') bytes += u.size;
      else if (u.phase === 'uploading' && existsSync(this.part(u.id))) bytes += statSync(this.part(u.id)).size;
    }
    return bytes;
  }

  start(body: Record<string, unknown>): Upload {
    const name = hostedName(body.name);
    const size = Number(body.size);
    if (size === 0) throw new UploadError(400, `${name}.fmp12 is empty (0 bytes). If it shouldn't be, copy it again and make sure the copy finished, then drop it here again.`);
    if (!Number.isSafeInteger(size) || size < 0) throw new UploadError(400, 'Give the file\'s size in bytes');
    if (MAX_UPLOAD && size > MAX_UPLOAD) {
      const sizes = readableBytes(size) === readableBytes(MAX_UPLOAD) ? [`${size.toLocaleString('en-US')} bytes`, `${MAX_UPLOAD.toLocaleString('en-US')} bytes`] : [readableBytes(size), readableBytes(MAX_UPLOAD)];
      throw new UploadError(413, `${name}.fmp12 is ${sizes[0]}, more than the ${sizes[1]} this server takes in one upload. Copy it into the hosted folder (${this.host.dir}) instead, or start the server with TABULARIUS_MAX_UPLOAD set to a larger number of bytes.`);
    }
    this.sweep();
    this.prune();
    if (this.uploads.size >= 128) throw new UploadError(429, 'Too many uploads are in progress; finish or remove one first');
    if (this.taken(name)) throw new UploadError(409, `A file named ${name} is already hosted or being uploaded. Remove it from Hosted files first to host this copy instead, or rename this file.`);
    if (size > MAX_UPLOAD_IN_PROGRESS) throw new UploadError(413, quota());
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const id = `${this.owner}-${randomBytes(9).toString('base64url')}`;
    closeSync(openSync(this.part(id), 'wx', 0o600));
    this.cleanups.set(id, cleanupPath(this.part(id)));
    const u: Upload = { id, name, size, received: 0, phase: 'uploading', started: new Date().toISOString() };
    this.uploads.set(id, u);
    this.active.set(id, this.now());
    this.sweep();
    this.prune();
    return u;
  }

  /** Appends the next piece; `offset` must be what has arrived so far (a retry of the last piece is fine). */
  async write(id: string, offset: number, req: IncomingMessage): Promise<Upload> {
    const u = this.get(id);
    if (u.phase !== 'uploading') throw new UploadError(409, 'This upload is complete');
    if (this.writing.has(id)) throw new UploadError(409, 'A piece of this upload is still arriving');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > u.received) throw new UploadError(409, `Send from byte ${u.received}`);
    const length = Number(req.headers['content-length']);
    if (length > MAX_PIECE) throw new UploadError(413, `Send pieces of at most ${MAX_PIECE} bytes`);
    if (offset + length > u.size) throw new UploadError(413, 'More bytes than the file\'s size');
    this.active.set(id, this.now());
    const fd = openSync(this.part(id), 'r+');
    this.writing.add(id);
    let at = offset;
    try {
      await eachChunk(req, (chunk) => {
        if (at - offset + chunk.length > MAX_PIECE) throw new UploadError(413, `Send pieces of at most ${MAX_PIECE} bytes`);
        if (at + chunk.length > u.size) throw new UploadError(413, 'More bytes than the file\'s size');
        const existing = statSync(this.part(id)).size;
        const extension = Math.max(0, at + chunk.length - existing);
        if (extension > MAX_UPLOAD_IN_PROGRESS - this.bytesInProgress()) throw new UploadError(413, quota());
        let done = 0;
        while (done < chunk.length) done += writeSync(fd, chunk, done, chunk.length - done, at + done);
        at += chunk.length;
      });
    } finally {
      closeSync(fd);
      this.writing.delete(id);
      // A disconnect may leave a complete prefix on disk; retries resume from that prefix.
      u.received = Math.max(u.received, at);
      this.active.set(id, this.now());
    }
    return u;
  }

  /** Converts and hosts a fully arrived file; resolves when that has started. */
  finish(id: string): Upload {
    const u = this.get(id);
    if (u.phase !== 'uploading') throw new UploadError(409, 'This upload is already finished');
    if (this.writing.has(id)) throw new UploadError(409, 'A piece of this upload is still arriving');
    const size = statSync(this.part(id)).size;
    if (u.received !== u.size || size !== u.size) throw new UploadError(409, `Only ${u.received} of ${u.size} bytes have arrived`);
    u.phase = 'waiting';
    const stop = new AbortController();
    const done = this.convert(u, stop).finally(() => this.conversions.delete(id));
    this.conversions.set(id, { stop, done });
    return u;
  }

  private async convert(u: Upload, stop: AbortController): Promise<void> {
    try {
      // Encryption at Rest: it waits in the folder for its passphrase, entered in the admin console.
      const enc = sourceEncryption(this.part(u.id));
      if (enc.encrypted) {
        this.host.parkLocked(this.part(u.id), u.name, enc.hint, true);
        u.phase = 'locked';
        this.log(`uploaded ${u.name}.fmp12 uses Encryption at Rest: enter its passphrase in the admin console to host it`);
        return;
      }
      this.log(`converting uploaded ${u.name}.fmp12`);
      const r = await this.host.hostUpload(this.part(u.id), u.name, (p) => {
        u.phase = 'converting';
        u.progress = p;
      }, stop.signal);
      u.phase = 'hosted'; // Publication is complete; later removal only forgets the upload.
      await this.host.openFileEverywhere(u.name);
      u.tables = r.tables;
      u.records = r.records;
      u.phase = 'hosted';
      this.log(`converted ${u.name}.fmp12: ${r.tables} tables, ${r.records} records; now hosting ${u.name}`);
      const store = this.host.get(u.name);
      if (store) {
        try {
          const report = conversionReport(store, this.host.names());
          u.report = { summary: report.summary, items: countItems(report) };
        } catch (e) {
          u.report = { summary: `The conversion report couldn't be made: ${(e as Error).message}`, items: 0 };
        }
        try {
          const r = pluginReadiness(store, this.host.plugins);
          if (r.line) u.plugins = { line: r.line, willNotRun: r.willNotRun };
        } catch (e) {
          this.log(`plug-in readiness of ${u.name} couldn't be made: ${(e as Error).message}`);
        }
        try {
          const o = optimizationReport(store);
          if (o.findings.length) u.optimization = { items: o.findings.length, high: o.findings.filter((f) => f.impact === 'high').length, headline: o.headline, text: o.text };
        } catch (e) {
          this.log(`optimization report for ${u.name} couldn't be made: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.cleanPart(u.id, false);
      if (stop.signal.aborted) this.log(`cancelled upload of ${u.name}.fmp12`);
      else {
        u.phase = 'failed';
        u.error = explainHostingFailure(u.name, (e as Error).message);
        this.log(`couldn't host uploaded ${u.name}.fmp12: ${(e as Error).message}`);
      }
    } finally {
      if (stop.signal.aborted) {
        this.cleanPart(u.id, false);
        this.uploads.delete(u.id);
        this.active.delete(u.id);
      }
      this.cleanups.delete(u.id);
      u.finished = new Date().toISOString();
      u.progress = undefined;
    }
  }

  /** Stops an upload in progress, waiting for conversion cleanup, or forgets a finished one. */
  remove(id: string): void | Promise<void> {
    const u = this.get(id);
    if (this.writing.has(id)) throw new UploadError(409, 'A piece of this upload is still arriving');
    if (u.phase === 'waiting' || u.phase === 'converting') {
      const conversion = this.conversions.get(id);
      conversion?.stop.abort();
      return conversion?.done; // The conversion owns its files until the worker has exited.
    }
    this.cleanPart(id);
    this.uploads.delete(id);
    this.active.delete(id);
  }

  /** Removes uploads still receiving pieces that have been idle past the limit: their pieces would otherwise fill the disk until a restart. */
  sweep(): void {
    if (this.idleMs <= 0) return;
    const cutoff = this.now() - this.idleMs;
    for (const [id, u] of this.uploads) {
      if (this.writing.has(id) || u.phase !== 'uploading' || (this.active.get(id) ?? 0) > cutoff) continue;
      this.cleanPart(id);
      this.uploads.delete(id);
      this.active.delete(id);
      this.log(`removed abandoned upload of ${u.name}.fmp12: nothing arrived for ${Math.round(this.idleMs / 3_600_000)} hours`);
    }
  }

  private prune(): void {
    for (const [id, u] of this.uploads) {
      if (this.uploads.size <= KEEP) break;
      if (u.phase === 'hosted' || u.phase === 'failed' || u.phase === 'locked') { this.uploads.delete(id); this.active.delete(id); this.cleanups.delete(id); }
    }
  }
}

/** Everything a report lists, counted once per kind of problem. */
function countItems(r: ConversionReport): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) n += v.length;
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  const { summary: _s, database: _d, ...rest } = r;
  walk(rest);
  return n;
}

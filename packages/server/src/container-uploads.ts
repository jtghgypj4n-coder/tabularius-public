// Putting a big file in a container field in pieces, so that an interrupted upload picks up where it stopped and
// neither the browser nor the server ever holds the whole file. Beyond FileMaker's Data API, under the layout like the
// rest of it (dataapi.ts routes them):
//
//   POST   .../layouts/{layout}/records/{id}/container-uploads/{field}[/{repetition}]   {filename, mime, size, sha256?}
//   GET    .../layouts/{layout}/container-uploads/{upload}                    what has arrived
//   PUT    .../layouts/{layout}/container-uploads/{upload}?offset=N           the next piece (raw bytes)
//   POST   .../layouts/{layout}/container-uploads/{upload}/finish             every byte is there: put it in the field
//   DELETE .../layouts/{layout}/container-uploads/{upload}                    stop, and forget what arrived
//
// The pieces wait in a file on this computer until the last one is in, then go into the field the way an upload through
// the Data API does, with the same checks. Whether the account may write that field is settled when the upload starts
// (before a byte is taken in) and again when it finishes, with the account's privileges at that moment.

import { createHash, randomBytes, type Hash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readSync, rmSync } from 'node:fs';
import { cleanupPath, openSync, writeFileSync, writeSync } from '../../store/src/fs-boundary.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContainerFile } from '../../store/src/index.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';

/** The most a container file may be, over any route that takes one in. */
export const MAX_CONTAINER_FILE = 1024 * 1024 * 1024;
/** The most one piece may be. */
export const MAX_CONTAINER_PIECE = 64 * 1024 * 1024;
/** How many uploads one account may have going at once in one file, and how many bytes (their declared sizes) all accounts together. */
export const MAX_CONTAINER_UPLOADS_PER_ACCOUNT = 4;
export const MAX_CONTAINER_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;
/** An upload that has received nothing for this long is abandoned (TABULARIUS_UPLOAD_IDLE_HOURS, default 24; 0 keeps them). */
const IDLE_MS = Math.max(0, Number(process.env.TABULARIUS_UPLOAD_IDLE_HOURS ?? 24) || 0) * 60 * 60 * 1000;

const UPLOAD_PREFIX = 'tabularius-container-uploads-';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface UploadSweepOptions {
  tmp: string;
  now?: number;
  olderThanMs?: number;
  alive?: (pid: number) => boolean;
  log?: (message: string) => void;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' ? true : code === 'ESRCH' ? false : false;
  }
}

/** Removes stale upload spools left by an interrupted server, without following links outside the temp folder. */
export function sweepOrphanUploadFolders(opts: UploadSweepOptions): { removed: string[]; kept: number; failed: number } {
  const result = { removed: [] as string[], kept: 0, failed: 0 };
  const now = opts.now ?? Date.now();
  const olderThanMs = opts.olderThanMs ?? DAY_MS;
  const alive = opts.alive ?? processAlive;
  const log = opts.log ?? (() => {});
  let names: string[];
  try { names = readdirSync(opts.tmp); }
  catch {
    try { log('upload sweep: could not list the temporary folder'); } catch { /* Logging cannot stop cleanup. */ }
    return { ...result, failed: 1 };
  }
  for (const name of names) {
    if (!new RegExp(`^${UPLOAD_PREFIX}[A-Za-z0-9]{6}$`).test(name)) continue;
    const path = join(opts.tmp, name);
    try {
      const before = lstatSync(path);
      if (!before.isDirectory() || (typeof process.getuid === 'function' && before.uid !== process.getuid())) { result.kept++; continue; }
      if (folders.has(path)) { result.kept++; continue; }
      let newest = before.mtimeMs;
      for (const child of readdirSync(path)) {
        try { newest = Math.max(newest, lstatSync(join(path, child)).mtimeMs); }
        catch (error) { throw error; }
      }
      const age = now - newest;
      let marker: { pid?: unknown } | undefined;
      try {
        const markerPath = join(path, 'owner.json');
        const markerStat = lstatSync(markerPath);
        if (markerStat.isFile() && markerStat.size <= 4096) {
          const fd = openSync(markerPath, 'r');
          let text: string;
          try {
            const bytes = Buffer.alloc(4097);
            const length = readSync(fd, bytes, 0, bytes.length, 0);
            if (length > 4096) throw new Error('owner marker is too large');
            text = bytes.subarray(0, length).toString('utf8');
          } finally { closeSync(fd); }
          const parsed = JSON.parse(text) as unknown;
          if (parsed && typeof parsed === 'object') marker = parsed as { pid?: unknown };
        }
      } catch { /* Missing, unreadable, oversized or malformed marker means age decides. */ }
      const ownPid = marker?.pid === process.pid;
      if (ownPid || age <= olderThanMs) { result.kept++; continue; }
      const dirAge = now - before.mtimeMs;
      if (typeof marker?.pid === 'number' && Number.isSafeInteger(marker.pid) && marker.pid > 0 && dirAge < WEEK_MS && alive(marker.pid)) { result.kept++; continue; }
      const again = lstatSync(path);
      if (!again.isDirectory() || again.dev !== before.dev || again.ino !== before.ino) { result.kept++; continue; }
      rmSync(path, { recursive: true, force: true });
      result.removed.push(name);
      if (result.removed.length >= 100) break;
    } catch (error) {
      result.failed++;
      try { log(`${name}: cleanup failed`); } catch { /* Logging cannot stop cleanup. */ }
    }
  }
  return result;
}

/** What a refused step says, with an HTTP status; the Data API turns it into its own error. */
export class ContainerUploadError extends Error {
  readonly status: number;
  /** How many bytes have arrived, when the refusal is about where to send the next piece. */
  readonly received?: number;
  constructor(status: number, message: string, received?: number) {
    super(message);
    this.status = status;
    this.received = received;
  }
}

/** Where a finished upload goes. */
export interface ContainerTarget {
  layout: string;
  recordId: number;
  field: string;
  repetition: number;
  portal?: { name: string; recordId: number };
  /** The record's modId the upload was started against, checked again when it finishes. */
  modId?: string;
}

export interface ContainerUpload extends ContainerTarget {
  id: string;
  db: string;
  account: string;
  filename: string | null;
  mime: string;
  size: number;
  received: number;
}

interface Held extends ContainerUpload {
  path: string;
  cleanup: ReturnType<typeof cleanupPath>;
  hash: Hash;
  /** The SHA-256 the client said the file has, to check at the end. */
  expected?: string;
  touched: number;
  writing: boolean;
  /** Handed out by `complete` and not yet `done` or `reopen`ed: a second finish waits for the first. */
  finishing: boolean;
  /** Cancelled while a piece was arriving: the piece stops and the file goes when it does. */
  cancelled: boolean;
}

/** Spool folders in use, removed when the process ends (an upload cut short by a crash cannot be resumed anyway). */
const folders = new Map<string, () => void>();
process.once('exit', () => { for (const cleanup of folders.values()) cleanup(); });

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class ContainerUploads {
  private readonly uploads = new Map<string, Held>();
  private readonly tmp: string;
  private readonly now: () => number;
  private readonly idleMs: number;
  private dir?: string;
  private timer?: NodeJS.Timeout;

  constructor(opts: { tmp?: string; now?: () => number; idleMs?: number } = {}) {
    this.tmp = opts.tmp ?? (process.env.TABULARIUS_UPLOAD_TMP || tmpdir());
    this.now = opts.now ?? (() => monotonicClock.now());
    this.idleMs = opts.idleMs ?? IDLE_MS;
  }

  private spool(id: string): string {
    if (this.dir && !existsSync(this.dir)) { folders.delete(this.dir); this.dir = undefined; }
    if (!this.dir) {
      mkdirSync(this.tmp, { recursive: true });
      this.dir = mkdtempSync(join(this.tmp, 'tabularius-container-uploads-'));
      folders.set(this.dir, cleanupPath(this.dir, { recursive: true, force: true }));
      try { writeFileSync(join(this.dir, 'owner.json'), JSON.stringify({ pid: process.pid, started: Date.now(), version: 1 }), { flag: 'wx', mode: 0o600 }); }
      catch { /* Age-based sweep remains available if the marker cannot be written. */ }
    }
    return join(this.dir, `${id}.part`);
  }

  /** Declared bytes of every upload that is not finished. */
  private declared(): number {
    let n = 0;
    for (const u of this.uploads.values()) n += u.size;
    return n;
  }

  /** Starts an upload for `who`; the caller has already checked that the account may write the field. */
  start(who: { db: string; account: string }, target: ContainerTarget, meta: { filename?: unknown; mime?: unknown; size?: unknown; sha256?: unknown }): ContainerUpload {
    this.sweep();
    const size = Number(meta.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new ContainerUploadError(400, "Give the file's size in bytes");
    if (size > MAX_CONTAINER_FILE) throw new ContainerUploadError(413, `A container file may be at most ${MAX_CONTAINER_FILE} bytes`);
    if (meta.filename !== undefined && meta.filename !== null && typeof meta.filename !== 'string') throw new ContainerUploadError(400, 'The file name is text');
    if (meta.mime !== undefined && typeof meta.mime !== 'string') throw new ContainerUploadError(400, 'The type is text');
    if (meta.sha256 !== undefined && !(typeof meta.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(meta.sha256))) throw new ContainerUploadError(400, 'sha256 is 64 hexadecimal digits');
    const mine = [...this.uploads.values()].filter((u) => u.db === who.db && same(u.account, who.account)).length;
    if (mine >= MAX_CONTAINER_UPLOADS_PER_ACCOUNT) throw new ContainerUploadError(429, `This account already has ${mine} uploads going; finish or cancel one first`);
    if (this.declared() + size > MAX_CONTAINER_UPLOAD_BYTES) throw new ContainerUploadError(413, 'Too many bytes are being uploaded at once; try again when one has finished');
    const id = randomBytes(18).toString('base64url');
    const path = this.spool(id);
    closeSync(openSync(path, 'wx', 0o600));
    const held: Held = {
      id, db: who.db, account: who.account, ...target,
      filename: typeof meta.filename === 'string' && meta.filename ? meta.filename.replace(/^[\s\S]*[\\/]/, '') || null : null,
      mime: typeof meta.mime === 'string' && meta.mime ? meta.mime : 'application/octet-stream',
      size, received: 0, path, cleanup: cleanupPath(path), hash: createHash('sha256'), expected: typeof meta.sha256 === 'string' ? meta.sha256.toLowerCase() : undefined,
      touched: this.now(), writing: false, finishing: false, cancelled: false,
    };
    this.uploads.set(id, held);
    this.timer ??= this.idleMs > 0 ? setInterval(() => this.sweep(), Math.min(this.idleMs, 15 * 60 * 1000)).unref() : undefined;
    return this.view(held);
  }

  private view(u: Held): ContainerUpload {
    const { id, db, account, layout, recordId, field, repetition, portal, modId, filename, mime, size, received } = u;
    return { id, db, account, layout, recordId, field, repetition, ...(portal ? { portal } : {}), ...(modId === undefined ? {} : { modId }), filename, mime, size, received };
  }

  /** An upload of this account in this file; anyone else's is as if it were not there. */
  private own(id: string, who: { db: string; account: string }, layout: string): Held {
    const u = this.uploads.get(id);
    if (!u || u.db !== who.db || !same(u.account, who.account) || !same(u.layout, layout)) throw new ContainerUploadError(404, 'No such upload');
    return u;
  }

  get(id: string, who: { db: string; account: string }, layout: string): ContainerUpload {
    // Asking how far it has got is not progress: only bytes keep an upload from going idle.
    return this.view(this.own(id, who, layout));
  }

  private touch(u: Held): void {
    u.touched = this.now();
  }

  /**
   * Opens the next piece, which must start where the last one ended. Feed it the bytes with `append` and always call
   * `end`: whatever arrived stays, so a retry asks `get` where to start.
   */
  beginPiece(id: string, who: { db: string; account: string }, layout: string, offset: number, length: number | undefined): { upload: ContainerUpload; append(chunk: Buffer): void; end(): void } {
    const u = this.own(id, who, layout);
    if (u.writing) throw new ContainerUploadError(409, 'A piece of this upload is still arriving', u.received);
    if (u.finishing) throw new ContainerUploadError(409, 'This upload is being finished', u.received);
    if (!Number.isSafeInteger(offset) || offset !== u.received) throw new ContainerUploadError(409, `Send from byte ${u.received}`, u.received);
    if (length !== undefined && Number.isFinite(length)) {
      if (length > MAX_CONTAINER_PIECE) throw new ContainerUploadError(413, `Send pieces of at most ${MAX_CONTAINER_PIECE} bytes`, u.received);
      if (u.received + length > u.size) throw new ContainerUploadError(413, "More bytes than the file's size", u.received);
    }
    const fd = openSync(u.path, 'r+');
    u.writing = true;
    this.touch(u);
    let inPiece = 0;
    let closed = false;
    return {
      upload: this.view(u),
      append: (chunk) => {
        if (u.cancelled) throw new ContainerUploadError(409, 'This upload was cancelled');
        if (inPiece + chunk.length > MAX_CONTAINER_PIECE) throw new ContainerUploadError(413, `Send pieces of at most ${MAX_CONTAINER_PIECE} bytes`, u.received);
        if (u.received + chunk.length > u.size) throw new ContainerUploadError(413, "More bytes than the file's size", u.received);
        for (let done = 0; done < chunk.length;) done += writeSync(fd, chunk, done, chunk.length - done, u.received + done);
        u.hash.update(chunk);
        u.received += chunk.length;
        inPiece += chunk.length;
      },
      end: () => {
        if (closed) return;
        closed = true;
        closeSync(fd);
        u.writing = false;
        this.touch(u);
        if (u.cancelled) this.drop(u);
      },
    };
  }

  /**
   * The file, once every byte has arrived, for the caller to put in the field. The upload stays until `done`, so a
   * finish refused for a reason that can be put right (the record is open elsewhere) can be sent again.
   */
  complete(id: string, who: { db: string; account: string }, layout: string): { upload: ContainerUpload; file: ContainerFile } {
    const u = this.own(id, who, layout);
    if (u.writing) throw new ContainerUploadError(409, 'A piece of this upload is still arriving', u.received);
    if (u.finishing) throw new ContainerUploadError(409, 'This upload is being finished', u.received);
    if (u.received !== u.size) throw new ContainerUploadError(409, `Only ${u.received} of ${u.size} bytes have arrived`, u.received);
    const sha256 = u.hash.copy().digest('hex');
    if (u.expected && u.expected !== sha256) {
      this.drop(u, false);
      throw new ContainerUploadError(422, 'The file that arrived is not the one described (its SHA-256 differs); upload it again');
    }
    this.touch(u);
    u.finishing = true;
    return { upload: this.view(u), file: { filename: u.filename, mime: u.mime, path: u.path, size: u.size, sha256 } };
  }

  /** The file could not be put in the field: the upload stays, to be finished again. */
  reopen(id: string): void {
    const u = this.uploads.get(id);
    if (u) u.finishing = false;
  }

  /** The file is in the field: forget the upload and remove what was kept. */
  done(id: string): void {
    const u = this.uploads.get(id);
    if (u) this.drop(u);
  }

  /** Stops an upload and removes what arrived; a piece still arriving stops with its next chunk. */
  cancel(id: string, who: { db: string; account: string }, layout: string): void {
    const u = this.own(id, who, layout);
    u.cancelled = true;
    if (!u.writing) this.drop(u);
    else this.uploads.delete(id);
  }

  private drop(u: Held, throwOnError = true): void {
    this.uploads.delete(u.id);
    u.cleanup({ throwOnError });
  }

  /** Removes uploads nothing has arrived for in the idle time: their bytes would otherwise stay until the server stopped. */
  sweep(): void {
    if (this.idleMs <= 0) return;
    const cutoff = this.now() - this.idleMs;
    for (const u of this.uploads.values()) if (!u.writing && u.touched <= cutoff) this.drop(u);
  }

  /** For the tests: how many uploads are being kept. */
  get count(): number {
    return this.uploads.size;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const u of [...this.uploads.values()]) this.drop(u);
    if (this.dir) {
      folders.get(this.dir)?.();
      folders.delete(this.dir);
    }
    this.dir = undefined;
  }
}

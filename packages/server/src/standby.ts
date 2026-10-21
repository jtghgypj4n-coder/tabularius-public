// A standby server: keeps a folder of copies of another server's files, a
// second or so behind it, by copying each file once and then applying its
// changes as they come (replication.ts is the other side). If the main server
// fails, stop the standby and serve its folder: the files are ordinary hosted
// files, as they were when the last changes arrived.
//
//   tabularius standby <folder> --primary https://main:8080 --token T
//
// What it is up to is kept in <folder>/.openhbam-standby.json, so a restart
// carries on where it stopped. A file changed by anything else since (it was
// served after a takeover, say) is never overwritten unless asked.

import { createWriteStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { refuseNewer } from '../../store/src/store-format.ts';
import { STORE_EXT } from './host.ts';
import { guardedFetch } from '../../scripts/src/net-guard.ts';
import { claimFolder } from './backup.ts';
import { applyLog, decodeRecords } from './logs.ts';

import { writeDurable } from '../../store/src/durable.ts';

export const STANDBY_STATE = '.openhbam-standby.json';

/** A file as it stood: its size and time, or null for no file. */
export type Seen = { size: number; mtimeMs: number } | null;

/** What this is doing to a file: saved before the file is touched, and gone once it is done. */
export interface StandbyPending {
  /** The states the file may be in as far as this is concerned: before, and after a copy (a change applied leaves it somewhere only the next note knows). */
  states: Seen[];
  /** The hash of the log this left beside the file, which is the only log there is that is not a local change. */
  log?: string;
}

export interface StandbyFile {
  run: string;
  /** The last change applied. */
  seq: number;
  /** The copy is whole once this change is applied. */
  wholeAfter: number;
  /** The file as this left it, to notice anything else changing it. Both -1 while `pending` is set (and in notes from before it existed, where they mean the same). */
  size: number;
  mtimeMs: number;
  /** Set while a copy or a change is being done; the file is copied again, and is this's own while it is in one of these states. */
  pending?: StandbyPending;
  /** When the last change was applied (epoch ms). */
  at: number;
}

export interface StandbyState {
  primary: string;
  files: Record<string, StandbyFile>;
}

export interface StandbyOptions {
  folder: string;
  /** The main server's address, like https://main.example.com:8080. */
  primary: string;
  token: string;
  /** Copy files over ones in the folder that this standby didn't make. */
  overwrite?: boolean;
  /** Seconds to wait for changes in each request. */
  wait?: number;
  log?: (m: string) => void;
}

/** The standby state of a folder, if it is (or was) a standby. */
export function standbyState(folder: string, log: (message: string) => void = console.warn): StandbyState | undefined {
  try { return readJsonStateSync<StandbyState>(join(folder, STANDBY_STATE)); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`standby state ${join(folder, STANDBY_STATE)} could not be read; starting without standby state: ${(e as Error).message}`);
    }
    return undefined;
  }
}

/** Files a standby has copied but not yet brought to a whole state, by name. */
export function unfinishedStandbyFiles(state: StandbyState): string[] {
  return Object.entries(state.files).filter(([, f]) => f.seq < f.wholeAfter).map(([n]) => n);
}

class Stop extends Error {}

export class Standby {
  readonly opts: StandbyOptions;
  readonly state: StandbyState;
  private readonly log: (m: string) => void;
  private readonly abort = new AbortController();
  private readonly clientId = randomBytes(8).toString('hex');
  private readonly following = new Map<string, Promise<void>>();
  private readonly resync = new Set<string>();
  private release?: () => void;
  private lister?: Promise<void>;
  private flushTimer?: NodeJS.Timeout;
  /** The last problem reaching the main server, if it is still going on. */
  problem?: string;

  constructor(opts: StandbyOptions) {
    this.opts = { ...opts, primary: opts.primary.replace(/\/+$/, '') };
    this.log = opts.log ?? console.warn;
    const old = standbyState(opts.folder, this.log);
    this.state = old?.primary === this.opts.primary ? old : { primary: this.opts.primary, files: {} };
  }

  /** Starts following the main server; throws when the folder holds files this standby didn't make. */
  start(): void {
    const theirs = readdirSync(this.opts.folder).filter((f) => f.endsWith(STORE_EXT) && !(f.slice(0, -STORE_EXT.length) in this.state.files));
    if (theirs.length && !this.opts.overwrite) {
      throw new Error(`${this.opts.folder} already has files this standby didn't copy (${theirs.join(', ')}): use an empty folder, or --overwrite to replace them`);
    }
    if (!this.opts.overwrite) {
      for (const name of Object.keys(this.state.files)) this.assertCopyAllowed(name);
    }
    this.release = claimFolder(this.opts.folder);
    this.save();
    this.lister = this.list();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.lister;
    await Promise.all(this.following.values());
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      this.save();
    }
    this.release?.();
  }

  /** Each file: the last change applied and whether the copy is whole. */
  status(): { file: string; seq: number; whole: boolean; at?: string }[] {
    return Object.entries(this.state.files).map(([file, f]) => ({ file, seq: f.seq, whole: f.seq >= f.wholeAfter, at: f.at ? new Date(f.at).toISOString() : undefined }));
  }

  private save(lockWaitMs?: number): void {
    const path = join(this.opts.folder, STANDBY_STATE);
    updateJsonStateSync(path, this.state, (current) => ({
      primary: this.state.primary,
      files: current.primary === this.state.primary ? { ...current.files, ...this.state.files } : { ...this.state.files },
    }), { mode: 0o600, lockWaitMs });
  }

  /** Background saves wait briefly for the state lock, then retry later with a doubling delay, so a busy lock never stalls the event loop. */
  private scheduleSave(delay = 250): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      try { this.save(50); }
      catch (e) { this.log(`standby state could not be saved: ${(e as Error).message}`); this.scheduleSave(Math.min(delay * 2, 30_000)); }
    }, delay);
    this.flushTimer.unref();
  }

  private async get(path: string, timeoutS = 60): Promise<Response> {
    if (this.abort.signal.aborted) throw new Stop();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutS * 1000)]);
    try {
      return await guardedFetch(this.opts.primary + path, { headers: { authorization: `Bearer ${this.opts.token}`, 'x-tabularius-standby-id': this.clientId }, signal }, { policy: { private: true }, timeoutMs: Infinity, maxBytes: Infinity });
    } catch (e) {
      if (this.abort.signal.aborted) throw new Stop();
      throw e;
    }
  }

  private async pause(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      this.abort.signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
    if (this.abort.signal.aborted) throw new Stop();
  }

  private trouble(what: string): void {
    if (this.problem !== what) this.log(what);
    this.problem = what;
  }

  /** Looks for files to follow every 10 seconds. */
  private async list(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const res = await this.get('/tabularius/replication/v1/files', 30);
        if (res.status === 401) throw new Error('the main server refused the replication token');
        if (res.status === 404) throw new Error('the main server answered 404: it has no replication routes, because it was not started with --replication-token or because it is an older version (upgrade the main server first, then this standby)');
        if (!res.ok) throw new Error(`the main server answered ${res.status}`);
        const { files } = await res.json() as { files: { name: string }[] };
        for (const { name } of files) {
          if (!this.following.has(name)) this.following.set(name, this.follow(name));
        }
        if (this.problem?.startsWith("can't reach")) this.problem = undefined;
        await this.pause(10_000);
      } catch (e) {
        if (e instanceof Stop) return;
        this.trouble(`can't reach ${this.opts.primary}: ${(e as Error).message}`);
        try {
          await this.pause(5_000);
        } catch {
          return;
        }
      }
    }
  }

  private path(name: string): string {
    return join(this.opts.folder, name + STORE_EXT);
  }

  private seenAt(path: string): Seen {
    try {
      const s = statSync(path);
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch { return null; }
  }

  private seen(name: string): Seen {
    return this.seenAt(this.path(name));
  }

  /** The hash of the write-ahead log beside the file, if it holds anything. */
  private logHash(name: string): string | undefined {
    try {
      const log = readFileSync(this.path(name) + '-wal');
      return log.length ? createHash('sha256').update(log).digest('hex') : undefined;
    } catch { return undefined; }
  }

  /**
   * Whether a sidecar of the file holds something that is not this's own: a rollback journal, or a write-ahead log, that
   * is not empty is a local change that is not in the file itself, unless it is the log this left (`ours`, a hash). An
   * empty one, or a shared-memory index (which holds nothing that is not in the log), is only what opening the file leaves.
   */
  private sidecarHolds(name: string, ours?: string): boolean {
    try { if (statSync(this.path(name) + '-journal').size > 0) return true; } catch { /* none */ }
    try { if (statSync(this.path(name) + '-wal').size > 0) return ours === undefined || this.logHash(name) !== ours; } catch { /* none */ }
    return false;
  }

  /** Whether the file is as this left it, whole and with nothing noted as being done to it. */
  private untouched(name: string): boolean {
    const f = this.state.files[name];
    if (!f || f.pending || f.size < 0 || !existsSync(this.path(name))) return false;
    const s = statSync(this.path(name));
    return s.size === f.size && s.mtimeMs === f.mtimeMs && !this.sidecarHolds(name);
  }

  /**
   * Whether something other than this standby changed the file, or left changes beside it, since it was last updated.
   * While a copy or a batch of changes is being done, the notes (saved before the file is touched) say what states the
   * file may be in, and the log this left beside it; the file in one of those states, with that log or none, is this's
   * own, and anything else is not. Notes from before that was kept have only a size of -1, which means the file in
   * any state. A file that is gone has nothing to lose, unless a log or journal is left that might.
   */
  private changedHere(name: string): boolean {
    const f = this.state.files[name];
    if (f?.pending) {
      const now = this.seen(name);
      const ours = f.pending.states.some((s) => s === null ? now === null : now !== null && s.size === now.size && s.mtimeMs === now.mtimeMs);
      return !ours || this.sidecarHolds(name, f.pending.log);
    }
    if (f && f.size < 0) return false;
    if (!existsSync(this.path(name))) return this.sidecarHolds(name);
    return !this.untouched(name);
  }

  /** Check again after network I/O, before a copy can replace local bytes or sidecars. */
  private assertCopyAllowed(name: string): void {
    if (this.opts.overwrite) return;
    if (this.changedHere(name)) throw new Error(`${name} changed here since it was last updated: use --overwrite to replace it`);
  }

  /** Notes what is about to be done to the file, and saves at once: the file is not touched until it is on disk. */
  private begin(name: string, f: StandbyFile, pending: StandbyPending): void {
    this.state.files[name] = { ...f, size: -1, mtimeMs: -1, pending };
    this.save();
  }

  /** After a failure, or when stopping, with a copy or changes half done: the file as it is now is this's own, and is copied again. */
  private settle(name: string): void {
    const f = this.state.files[name];
    if (!f?.pending) return;
    this.state.files[name] = { ...f, pending: { states: [this.seen(name)], log: this.logHash(name) } };
    try { this.save(); } catch { this.scheduleSave(); }
  }

  private mark(name: string, f: StandbyFile, now = false): void {
    const s = statSync(this.path(name));
    const whole = { ...f, size: s.size, mtimeMs: s.mtimeMs };
    delete whole.pending;
    this.state.files[name] = whole;
    if (!now) return this.scheduleSave();
    try { this.save(); } catch { this.scheduleSave(); }
  }

  private async follow(name: string): Promise<void> {
    let delay = 1000;
    while (!this.abort.signal.aborted) {
      try {
        if (this.resync.has(name) || !this.untouched(name)) {
          await this.copy(name);
        }
        await this.catchUp(name);
        delay = 1000;
      } catch (e) {
        if (e instanceof Stop) return;
        this.trouble(`following ${name}: ${(e as Error).message}`);
        try {
          await this.pause(delay);
        } catch {
          return;
        }
        delay = Math.min(30_000, delay * 2);
      }
    }
  }

  private async copy(name: string): Promise<void> {
    this.assertCopyAllowed(name);
    const res = await this.get(`/tabularius/replication/v1/files/${encodeURIComponent(name)}/copy`, 3600);
    if (!res.ok || !res.body) throw new Error(`copying it: the main server answered ${res.status}`);
    // Each position must be present and plain digits: a missing or blank one would read as zero, and "0x10" or "1e3" as other numbers.
    const count = (raw: string | null): number => (raw !== null && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN);
    const seq = count(res.headers.get('x-tabularius-seq') ?? res.headers.get('x-openhbam-seq'));
    const wholeAfter = count(res.headers.get('x-tabularius-whole-after') ?? res.headers.get('x-openhbam-whole-after'));
    const run = res.headers.get('x-tabularius-run') ?? res.headers.get('x-openhbam-run') ?? '';
    if (!run || !Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(wholeAfter) || wholeAfter < seq) {
      await res.body.cancel();
      throw new Error('copying it: invalid replication position from the primary');
    }
    const target = this.path(name);
    const partial = target + '.standby-partial';
    try {
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(partial));
      const db = new DatabaseSync(partial, { readOnly: true });
      try {
        const r = Object.values(db.prepare('PRAGMA quick_check').get() as Record<string, string>)[0];
        if (r !== 'ok') throw new Error(`the copy failed its check: ${r}`);
        refuseNewer(db, name);
      } finally {
        db.close();
      }
      this.assertCopyAllowed(name);
      for (const x of ['-wal', '-shm', '-journal']) rmSync(partial + x, { force: true });
      // Noted before the file is touched, and saved now rather than in a moment: a crash between the two must not leave a
      // file in the folder that the next start takes for someone else's. The old file and the new one are the two states
      // it is in (the new one's size and time are those of the partial file, which the rename keeps), and the log beside
      // the old one, which was allowed to be there, is the only one that may be.
      this.begin(name, { run, seq, wholeAfter: Math.max(wholeAfter, seq + 1), size: -1, mtimeMs: -1, at: 0 }, { states: [this.seen(name), this.seenAt(partial)], log: this.logHash(name) });
      // Checked once more against what was just noted, so that only the instants from here to the rename are open to a
      // write by another program. A journal left beside the old file would be rolled back into the new one when it is opened.
      this.assertCopyAllowed(name);
      for (const x of ['-wal', '-shm', '-journal']) rmSync(target + x, { force: true });
      writeDurable(partial, target);
    } catch (e) {
      rmSync(partial, { force: true });
      throw e;
    }
    this.mark(name, { run, seq, wholeAfter, size: 0, mtimeMs: 0, at: Date.now() });
    this.resync.delete(name);
    this.log(`copied ${name}`);
  }

  /** Applies changes as they come, until the copy has to be made again. */
  private async catchUp(name: string): Promise<void> {
    const wait = this.opts.wait ?? 25;
    while (!this.abort.signal.aborted) {
      const f = this.state.files[name];
      const res = await this.get(`/tabularius/replication/v1/files/${encodeURIComponent(name)}/changes?run=${f.run}&after=${f.seq}&wait=${wait}`, wait + 30);
      if (res.status === 409 || res.status === 410) {
        // The main server restarted, or this fell too far behind: start again from a fresh copy.
        this.log(`${name}: ${((await res.json()) as { error: string }).error}`);
        this.resync.add(name);
        return;
      }
      if (!res.ok) throw new Error(`the main server answered ${res.status}`);
      const records = decodeRecords(Buffer.from(await res.arrayBuffer())).filter((r) => r.seq > f.seq);
      if (!this.untouched(name)) return;
      let seq = f.seq;
      for (const r of records) {
        if (r.seq !== ++seq) throw new Error(`change ${seq} is missing`);
      }
      seq = f.seq;
      if (records.length) {
        try {
          for (const r of records) {
            // Each change is noted before it is applied, with the file as it is and the log it will leave beside it.
            this.begin(name, { ...f, seq, wholeAfter: Math.max(f.wholeAfter, records.at(-1)!.seq + 1) }, { states: [this.seen(name)], log: createHash('sha256').update(r.data).digest('hex') });
            applyLog(this.path(name), r.data);
            seq = r.seq;
          }
        } catch (e) {
          this.settle(name);
          throw e;
        }
        this.mark(name, { ...f, seq, at: Date.now() }, true);
      }
      if (this.problem?.startsWith(`following ${name}:`)) this.problem = undefined;
    }
  }
}

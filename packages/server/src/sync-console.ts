// Keeping a hosted file in step with a FileMaker Server copy, from the admin console: the saved setup per
// file, a check (a dry run, on request or on a timer), the conflicts it found for an administrator to settle one
// record at a time, applying the result, and the log of what was sent and brought in. The work itself is
// store/src/sync-apply.ts; this adds the console's guards around it.
//
// Setups live in <folder>/.openhbam-sync.json (readable by its owner only). A setup never holds the FileMaker
// password: it comes from the file named by `passwordFile` or TABULARIUS_FMS_PASSWORD, or is typed for one run and
// forgotten. The last run of each file is kept in <folder>/.openhbam-sync-last.json (same mode), for the same setup only. Whoever can save a setup picks where the password is sent, so the server holds that to what its
// operator has said: a password file has to be in the secrets folder (<folder>/.openhbam-secrets, or
// TABULARIUS_SYNC_SECRETS), TABULARIUS_FMS_PASSWORD goes only to a server named in TABULARIUS_SYNC_HOSTS (host or host:port,
// comma separated), and with that list set no other host is reached. Without it, this machine, link-local and
// metadata addresses are refused. A scheduled sync (a schedule of the server's schedules, see schedules.ts) can't be
// typed a password, so it needs one of the first two.
//
// What changes anything is opt-in twice: the setup must allow it (`allowWrites` to send to FileMaker,
// `allowPulls` to change this file), and the request must ask for it (`write` / `pull`). Capture-only files never
// sync. Only one run per file at a time.

import { existsSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { classifyAddress, isLoopbackAddress } from '../../scripts/src/net-guard.ts';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { join, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  applySync, readSyncLog, releaseHeldTables, type ApplyResult, type Resolution, type SyncLogRow, type TableApply, type TableSyncConfig,
} from '../../store/src/index.ts';
import { dataApiClient, dataApiSource, checkSyncAllowed, parseSyncConfig, FmsSyncError, CONTAINER_PULL_MAX_BYTES } from './fms-sync.ts';
import type { Host } from './host.ts';
import type { SyncJobs, SyncRunSummary, SyncScheduleOptions } from './schedules.ts';

const FILE = '.openhbam-sync.json';
/** What each file's last run found, kept so a restart doesn't blank the Sync page. */
const LAST_FILE = '.openhbam-sync-last.json';
/** Conflicts listed per check (the rest are counted). */
const CONFLICT_LIMIT = 500;
/** Longest value shown for a conflicting field. */
const VALUE_LIMIT = 300;

/** An error with the HTTP status the console answers with. */
export class SyncConsoleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** One hosted file's saved setup. */
export interface SyncSetup {
  /** The FileMaker Server, `https://host` (or a bare host name). */
  server: string;
  /** The file's name on that server. */
  database: string;
  /** The FileMaker account to sign in as (needs the fmrest privilege). */
  user: string;
  /** A file holding that account's password, read at each run. Without it TABULARIUS_FMS_PASSWORD is used. */
  passwordFile?: string;
  /** Accept the self-signed certificate a new FileMaker Server has. */
  insecure?: boolean;
  tables: TableSyncConfig[];
  /** The console may send this file's changes to FileMaker. */
  allowWrites?: boolean;
  /** The console may change this file with FileMaker's changes. */
  allowPulls?: boolean;
  /** A run may also move container files (photos, documents): a pull brings them, a write sends them, up to a size limit each. */
  allowContainers?: boolean;
}

export interface ConflictView {
  table: string;
  uuid: string;
  reviewToken: string;
  /** What happened, in a few words. */
  kind: 'both-changed' | 'deleted-here' | 'deleted-on-filemaker';
  clashes: { field: string; here: string; filemaker: string }[];
}

/** What the latest check or apply found, for the page. */
export interface SyncStatus {
  at: string;
  trigger: 'manual' | 'scheduled' | 'apply';
  /** Set when the run couldn't be made at all (sign-in failed, no password). */
  error?: string;
  tables: TableApply[];
  refused?: string;
  stopped?: string;
  interrupted: number;
  conflicts: ConflictView[];
  /** Conflicts beyond the ones listed. */
  moreConflicts: number;
  runId?: string;
}

export interface SyncOverview {
  database: string;
  setup: SyncSetup;
  running: boolean;
  last?: SyncStatus;
  /** Whether a password is available without typing one (a scheduled check needs it). */
  passwordSaved: boolean;
}

export interface ApplyRequest {
  write?: boolean;
  pull?: boolean;
  /** With `pull`: bring container files too; with `write`: send them (403 unless the setup has allowContainers). */
  containers?: boolean;
  allowDeletes?: boolean;
  /** A deletion pulled from FileMaker leaves the records related to it (by "delete related records") alone. */
  keepRelated?: boolean;
  resolutions?: Resolution[];
  /** Typed for this run only. */
  password?: string;
  /** Lets tables an earlier run held back write again first. */
  release?: boolean;
}

const KEYS = ['server', 'database', 'user', 'passwordFile', 'insecure', 'tables', 'allowWrites', 'allowPulls', 'allowContainers'];

/** Addresses a server of this kind never needs to reach: this machine, link-local (cloud metadata lives there) and "any". */
export function isInternalAddress(address: string): boolean {
  return classifyAddress(address) === 'never' || isLoopbackAddress(address);
}

const hostOf = (server: string): URL => new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`);

/** The servers the operator listed, as lower-case "host" or "host:port" entries. */
function listedHosts(): string[] | undefined {
  const raw = process.env.TABULARIUS_SYNC_HOSTS;
  if (raw === undefined || !raw.trim()) return undefined;
  return raw.split(',').map((h) => h.trim().toLowerCase().replace(/^\[|\](?=:|$)/g, '')).filter(Boolean);
}

/** Whether the operator named this server. */
function isListed(server: string): boolean {
  const list = listedHosts();
  if (!list) return false;
  const u = hostOf(server);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return list.includes(host) || (u.port !== '' && list.includes(`${host}:${u.port}`));
}

const shorten = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return s.length > VALUE_LIMIT ? `${s.slice(0, VALUE_LIMIT - 3)}...` : s;
};

export class SyncConsole {
  private readonly host: Host;
  private readonly log: (m: string) => void;
  private setups = new Map<string, SyncSetup>();
  private readonly lastStatus = new Map<string, SyncStatus>();
  private readonly running = new Set<string>();

  constructor(host: Host, log: (m: string) => void = () => {}) {
    this.host = host;
    this.log = log;
    const f = join(host.dir, FILE);
    if (existsSync(f)) {
      try {
        const saved = (JSON.parse(readFileSync(f, 'utf8')) as { setups?: Record<string, SyncSetup> }).setups ?? {};
        // Old request spellings may alias one hosted file. Keep one only when they agree; conflicting aliases
        // need a fresh PUT, so neither destination can silently win.
        const groups = new Map<string, [string, SyncSetup][]>();
        for (const [name, setup] of Object.entries(saved)) {
          const key = name.toLowerCase();
          groups.set(key, [...(groups.get(key) ?? []), [name, setup]]);
        }
        for (const entries of groups.values()) {
          const [name, setup] = entries[0];
          if (entries.some(([, s]) => JSON.stringify(s) !== JSON.stringify(setup))) {
            log(`sync: conflicting setup aliases for ${name}; save a new setup`);
            continue;
          }
          this.setups.set(this.canonical(name), setup);
        }
      } catch (e) {
        // Keep the unreadable setup for recovery; the next successful save would otherwise replace it.
        renameSync(f, `${f}.damaged-${Date.now()}`);
        log(`sync: can't read ${FILE}: ${(e as Error).message}`);
      }
    }
    this.loadLast();
  }

  /** The last runs saved by an earlier server, for the setups that are still the same ones (same destination and mapping). */
  private loadLast(): void {
    const f = join(this.host.dir, LAST_FILE);
    if (!existsSync(f)) return;
    try {
      const saved = (readJsonStateSync<{ runs?: Record<string, { key?: string; status?: SyncStatus }> }>(f)).runs ?? {};
      for (const [database, setup] of this.setups) {
        const run = saved[database];
        if (run?.status && typeof run.status.at === 'string' && Array.isArray(run.status.tables) && Array.isArray(run.status.conflicts) && run.key === this.history(database, setup)) {
          this.lastStatus.set(database, run.status);
        }
      }
    } catch (e) {
      this.log(`sync: can't read ${LAST_FILE}: ${(e as Error).message}`);
    }
  }

  private remember(database: string, status: SyncStatus): void {
    this.lastStatus.set(database, status);
    this.saveLast(database);
  }

  private forget(database: string): void {
    if (this.lastStatus.delete(database)) this.saveLast(database);
  }

  /** Best effort: a run that can't be written down is still shown until the server restarts. */
  private saveLast(database: string): void {
    try {
      const runs: Record<string, { key: string; status: SyncStatus }> = {};
      for (const [database, status] of this.lastStatus) {
        const setup = this.setups.get(database);
        if (setup) runs[database] = { key: this.history(database, setup), status };
      }
      const f = join(this.host.dir, LAST_FILE);
      updateJsonStateSync<{ runs: Record<string, { key: string; status: SyncStatus }> }>(f, { runs: {} }, (current) => {
        const merged = { ...current.runs };
        if (runs[database]) merged[database] = runs[database];
        else delete merged[database];
        return { runs: merged };
      }, { mode: 0o600, lockWaitMs: 50 });
    } catch (e) {
      this.log(`sync: can't write ${LAST_FILE}: ${(e as Error).message}`);
    }
  }

  private captured(): string[] {
    return this.host.scriptOptions().outbound?.captureOnly ?? [];
  }

  private save(database: string, setup?: SyncSetup): void {
    const f = join(this.host.dir, FILE);
    updateJsonStateSync<{ setups: Record<string, SyncSetup> }>(f, { setups: {} }, (current) => {
      const setups = { ...current.setups };
      if (setup) setups[database] = setup;
      else delete setups[database];
      return { setups };
    }, { mode: 0o600 });
  }

  private canonical(database: string): string {
    return this.host.files().find((f) => f.name.toLowerCase() === database.toLowerCase())?.name ?? database;
  }

  /** A new destination or mapping starts with a separate baseline, including after a restart or DELETE/PUT. */
  private history(database: string, setup: SyncSetup): string {
    const mappings = setup.tables.map(({ policy: _policy, ...mapping }) => mapping).sort((a, b) => a.localTable.localeCompare(b.localTable));
    const identity = [hostOf(setup.server).href, setup.database, mappings];
    return `${database}@${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
  }

  private idle(database: string): void {
    if (this.running.has(database)) throw new SyncConsoleError(`a sync of ${database} is already running`, 409);
  }

  private setup(database: string): SyncSetup {
    const s = this.setups.get(database);
    if (!s) throw new SyncConsoleError(`${database} has no sync set up`, 404);
    return s;
  }

  private overview(database: string, setup: SyncSetup): SyncOverview {
    return { database, setup, running: this.running.has(database), ...(this.lastStatus.has(database) ? { last: this.lastStatus.get(database) } : {}), passwordSaved: this.savedPassword(setup) !== undefined };
  }

  list(): SyncOverview[] {
    return [...this.setups].map(([database, s]) => this.overview(database, s)).sort((a, b) => (a.database < b.database ? -1 : 1));
  }

  get(database: string): SyncOverview {
    database = this.canonical(database);
    return this.overview(database, this.setup(database));
  }

  /** Saves a file's setup (replacing the old one), checked: the file is hosted, may sync, and the tables are well formed. */
  put(database: string, input: unknown): SyncOverview {
    database = this.canonical(database);
    this.idle(database);
    if (!this.host.storeOf(database)) throw new SyncConsoleError(`${database} isn't hosted`, 404);
    const raw = (input ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(raw).filter((k) => !KEYS.includes(k));
    if (unknown.length) throw new SyncConsoleError(`unknown setting${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    let parsed;
    try {
      parsed = parseSyncConfig({ server: raw.server, database: raw.database, user: raw.user, tables: raw.tables });
      checkSyncAllowed([database], parsed, { write: false, captureOnly: this.captured() });
    } catch (e) {
      if (e instanceof FmsSyncError) throw new SyncConsoleError(e.message);
      throw e;
    }
    if (typeof raw.user !== 'string' || !raw.user) throw new SyncConsoleError('the setup needs "user" (an account on the FileMaker Server with the fmrest privilege)');
    for (const k of ['insecure', 'allowWrites', 'allowPulls', 'allowContainers'] as const) {
      if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new SyncConsoleError(`"${k}" is true or false`);
    }
    if (raw.passwordFile !== undefined && typeof raw.passwordFile !== 'string') throw new SyncConsoleError('"passwordFile" is the name of a file holding the password');
    const passwordFile = raw.passwordFile ? this.secretPath(raw.passwordFile as string) : undefined;
    this.checkServer(parsed.server);
    const setup: SyncSetup = {
      server: parsed.server, database: parsed.database, user: raw.user as string,
      ...(passwordFile ? { passwordFile } : {}),
      ...(raw.insecure ? { insecure: true } : {}),
      tables: parsed.tables,
      ...(raw.allowWrites ? { allowWrites: true } : {}),
      ...(raw.allowPulls ? { allowPulls: true } : {}),
      ...(raw.allowContainers ? { allowContainers: true } : {}),
    };
    this.save(database, setup);
    this.setups.set(database, setup);
    this.forget(database);
    this.log(`sync: saved the setup for ${database} (FileMaker ${setup.database} on ${new URL(/^https?:\/\//i.test(setup.server) ? setup.server : `https://${setup.server}`).host}${setup.allowWrites ? ', writes allowed' : ''}${setup.allowPulls ? ', pulls allowed' : ''}${setup.allowContainers ? ', container files allowed' : ''})`);
    return this.get(database);
  }

  remove(database: string): boolean {
    database = this.canonical(database);
    this.idle(database);
    const had = this.setups.has(database);
    if (had) {
      this.save(database);
      this.setups.delete(database);
      this.forget(database);
      this.log(`sync: removed the setup for ${database}`);
    }
    return had;
  }

  /** The folder password files have to be in. */
  private secretsDir(): string {
    return resolve(process.env.TABULARIUS_SYNC_SECRETS || join(this.host.dir, '.openhbam-secrets'));
  }

  /** A password file's full path, refused unless it is in the secrets folder (a bare name is looked for there). Links are followed when it is read. */
  private secretPath(name: string): string {
    const dir = this.secretsDir();
    const full = resolve(dir, name);
    const inside = relative(dir, full);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new SyncConsoleError(`"passwordFile" has to be a file in ${dir}: put the password there (readable by the server only) and name it`);
    }
    return full;
  }

  /** The server this setup may be pointed at, by what is known without asking the network. */
  private checkServer(server: string): void {
    const u = hostOf(server);
    const list = listedHosts();
    if (list) {
      if (!isListed(server)) throw new SyncConsoleError(`${u.host} isn't a FileMaker Server this server may reach: its operator lists them in TABULARIUS_SYNC_HOSTS`);
      return;
    }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost') || (isIP(host) && isInternalAddress(host))) {
      throw new SyncConsoleError(`${u.host} is this machine or a link-local address: a server that should reach it is listed in TABULARIUS_SYNC_HOSTS`);
    }
  }

  /** The same, once the name has been looked up (a name that points inside is as bad as an address that does). */
  private async checkResolved(server: string): Promise<void> {
    this.checkServer(server);
    if (isListed(server)) return;
    const host = hostOf(server).hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return;
    let found: { address: string }[];
    try {
      found = await lookup(host, { all: true });
    } catch {
      throw new SyncConsoleError(`couldn't find ${host}`, 502);
    }
    if (found.some((f) => isInternalAddress(f.address))) throw new SyncConsoleError(`${host} points to this machine or a link-local address: a server that should reach it is listed in TABULARIUS_SYNC_HOSTS`);
  }

  private savedPassword(setup: SyncSetup): string | undefined {
    if (setup.passwordFile) {
      try {
        // The folder is checked again here: a link put there since points elsewhere.
        const real = realpathSync(this.secretPath(setup.passwordFile));
        const dir = realpathSync(this.secretsDir());
        const inside = relative(dir, real);
        if (!inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep)[0] === '..') return undefined;
        return readFileSync(real, 'utf8').replace(/\r?\n$/, '');
      } catch {
        return undefined;
      }
    }
    // The server's own password goes only to a server its operator named.
    return isListed(setup.server) ? process.env.TABULARIUS_FMS_PASSWORD : undefined;
  }

  private connection(setup: SyncSetup, typed: string | undefined) {
    const password = typed || this.savedPassword(setup);
    if (!password) throw new SyncConsoleError(setup.passwordFile ? `can't read the password file ${setup.passwordFile}: it has to be a file in ${this.secretsDir()}` : 'no password: type it, or name a file in the secrets folder holding it ("passwordFile"), or list this server in TABULARIUS_SYNC_HOSTS to use TABULARIUS_FMS_PASSWORD', 400);
    return { server: setup.server, database: setup.database, user: setup.user, password, insecure: !!setup.insecure, tables: setup.tables };
  }

  private view(r: ApplyResult, trigger: SyncStatus['trigger']): SyncStatus {
    const all: ConflictView[] = [];
    for (const p of r.plans) {
      for (const c of p.conflicts) {
        all.push({
          table: p.localTable, uuid: c.uuid, reviewToken: c.reviewToken!,
          kind: c.localRecordId === null ? 'deleted-here' : c.remoteRecordId === null ? 'deleted-on-filemaker' : 'both-changed',
          clashes: c.clashes.map((f) => ({ field: f.field, here: shorten(f.local), filemaker: shorten(f.remote) })),
        });
      }
    }
    return {
      at: new Date().toISOString(), trigger, tables: r.tables, ...(r.refused ? { refused: r.refused } : {}), ...(r.stopped ? { stopped: r.stopped } : {}),
      interrupted: r.interrupted, conflicts: all.slice(0, CONFLICT_LIMIT), moreConflicts: Math.max(0, all.length - CONFLICT_LIMIT), runId: r.runId,
    };
  }

  /**
   * What a failed run says. FileMaker's own refusals are worded here (never the server's text), and a failure to
   * connect is one fixed sentence: the error of the network would tell whoever saved the setup what is listening
   * where it points.
   */
  private reached(e: unknown, setup: SyncSetup): unknown {
    if (e instanceof SyncConsoleError) return e;
    if (e instanceof FmsSyncError) return new SyncConsoleError(e.message, 502);
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^(E[A-Z]+|UNABLE_|CERT_|DEPTH_|SELF_SIGNED|ERR_TLS|HPE_)/.test(code)) {
      return new SyncConsoleError(`couldn't reach ${hostOf(setup.server).host}${/CERT|SELF_SIGNED|TLS|UNABLE_/.test(code) ? ' securely (its certificate isn\u2019t trusted: "insecure" accepts a new server\u2019s own)' : ''}`, 502);
    }
    return e;
  }

  /** One run at a time per file. */
  private async exclusive<T>(database: string, fn: () => Promise<T>): Promise<T> {
    this.idle(database);
    this.running.add(database);
    try {
      return await fn();
    } finally {
      this.running.delete(database);
    }
  }

  /** A dry run: reads both sides, writes nothing to either, and remembers what it found. */
  async check(database: string, opts: { password?: string; trigger?: 'manual' | 'scheduled' } = {}): Promise<SyncStatus> {
    database = this.canonical(database);
    return this.exclusive(database, () => this.runCheck(database, opts));
  }

  private async runCheck(database: string, opts: { password?: string; trigger?: 'manual' | 'scheduled' }): Promise<SyncStatus> {
    const setup = this.setup(database);
    checkSyncAllowed([database], { ...setup, ...(setup.allowWrites ? { allowWrites: true } : {}) }, { write: false, captureOnly: this.captured() });
    await this.checkResolved(setup.server);
    const conn = this.connection(setup, opts.password);
    const trigger = opts.trigger ?? 'manual';
    const store = this.host.get(database);
    if (!store || !store.sql.isOpen) throw new SyncConsoleError('the file was closed or changed; run Check again', 409);
    const schema = store.schema;
    const stop = new AbortController();
    const cancel = (closing: typeof store) => { if (closing === store) stop.abort(); };
    const assertActive = () => {
      if (stop.signal.aborted || this.host.get(database) !== store || !store.sql.isOpen || store.schema !== schema) {
        throw new SyncConsoleError('the file was closed or changed; run Check again', 409);
      }
    };
    const source = dataApiSource({ ...conn, signal: stop.signal });
    this.host.beforeClose.push(cancel);
    try {
      // A setup that allows container files has them counted (not fetched) in the check.
      const result = await applySync(store, this.history(database, setup), setup.tables, source, source, {
        write: false, assertWritable: assertActive, reviewIdentity: JSON.stringify(setup), ...(setup.allowContainers ? { containers: { maxBytes: CONTAINER_PULL_MAX_BYTES } } : {}),
      });
      const status = this.view(result, trigger);
      this.remember(database, status);
      return status;
    } catch (e) {
      const status: SyncStatus = { at: new Date().toISOString(), trigger, error: (e as Error).message, tables: [], interrupted: 0, conflicts: [], moreConflicts: 0 };
      this.remember(database, status);
      throw this.reached(e, setup);
    } finally {
      try { await source.close(); } finally { this.host.beforeClose.splice(this.host.beforeClose.indexOf(cancel), 1); }
    }
  }

  /** Sends and/or brings in what the plan says, once the setup allows it and the request asks for it. */
  async apply(database: string, req: ApplyRequest): Promise<SyncStatus> {
    database = this.canonical(database);
    return this.exclusive(database, async () => {
      const store = this.host.get(database);
      if (!store) throw new SyncConsoleError(`${database} must be open to sync`, 409);
      const stop = new AbortController();
      const cancel = (closing: typeof store) => { if (closing === store) stop.abort(); };
      const assertWritable = () => {
        if (stop.signal.aborted || this.host.get(database) !== store) throw new SyncConsoleError(`${database} was paused or closed during sync; check again before applying`, 409);
      };
      this.host.beforeClose.push(cancel);
      try {
        return await this.runApply(database, req, assertWritable, stop.signal);
      } finally {
        this.host.beforeClose.splice(this.host.beforeClose.indexOf(cancel), 1);
      }
    });
  }

  private async runApply(database: string, req: ApplyRequest, assertWritable: () => void, signal: AbortSignal): Promise<SyncStatus> {
    const setup = this.setup(database);
    const store = this.host.storeOf(database);
    if (!store) throw new SyncConsoleError(`${database} isn't hosted`, 404);
    const write = req.write === true;
    const pull = req.pull === true;
    if (!write && !pull) throw new SyncConsoleError('say what to do: "write" (send to FileMaker) and/or "pull" (bring its changes here)');
    if (write && !setup.allowWrites) throw new SyncConsoleError(`this setup doesn't allow writing to FileMaker: turn on "allowWrites" for ${database} first`, 403);
    if (pull && !setup.allowPulls) throw new SyncConsoleError(`this setup doesn't allow changing ${database} from FileMaker: turn on "allowPulls" first`, 403);
    const containers = req.containers === true;
    if (containers && !setup.allowContainers) throw new SyncConsoleError(`this setup doesn't allow container files from FileMaker: turn on "allowContainers" for ${database} first`, 403);
    checkSyncAllowed([database], { ...setup, ...(setup.allowWrites ? { allowWrites: true } : {}) }, { write, captureOnly: this.captured() });
    const resolutions = this.resolutions(req.resolutions);
    for (const r of resolutions) {
      if (r.keep === 'mine' && !write) throw new SyncConsoleError(`keeping this file's version of ${r.table} ${r.uuid} sends it to FileMaker: ask for "write" too`);
      if (r.keep === 'theirs' && !pull) throw new SyncConsoleError(`keeping FileMaker's version of ${r.table} ${r.uuid} changes this file: ask for "pull" too`);
    }
    await this.checkResolved(setup.server);
    const conn = { ...this.connection(setup, req.password), signal };
    const client = write ? dataApiClient(conn) : undefined;
    const source = client ?? dataApiSource(conn);
    try {
      assertWritable();
      if (req.release) releaseHeldTables(store, this.history(database, setup), setup.tables);
      this.log(`sync: ${database}: ${write && pull ? 'sending to and pulling from' : write ? 'sending to' : 'pulling from'} FileMaker${req.allowDeletes ? ', deletions included' : ''}`);
      const result = await applySync(store, this.history(database, setup), setup.tables, source, client ?? source, {
        assertWritable, reviewIdentity: JSON.stringify(setup),
        write, pull, allowDeletes: req.allowDeletes === true, keepRelated: req.keepRelated === true, resolutions, ...(containers ? { containers: { maxBytes: CONTAINER_PULL_MAX_BYTES } } : {}), actor: `${setup.user}@${new URL(/^https?:\/\//i.test(setup.server) ? setup.server : `https://${setup.server}`).host}`,
      });
      const status = this.view(result, 'apply');
      this.remember(database, status);
      const done = result.tables.reduce((n, t) => n + t.created + t.updated + t.deleted + t.pulled.created + t.pulled.updated + t.pulled.deleted, 0);
      this.log(`sync: ${database}: ${result.refused ? 'refused' : result.stopped ? 'stopped' : 'done'}, ${done} record${done === 1 ? '' : 's'} changed (run ${result.runId})`);
      return status;
    } catch (e) {
      throw this.reached(e, setup);
    } finally {
      await source.close();
    }
  }

  private resolutions(input: unknown): Resolution[] {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new SyncConsoleError('"resolutions" is a list of { table, uuid, keep, reviewToken }');
    if (input.length > 100_000) throw new SyncConsoleError('"resolutions" may have at most 100000 entries');
    return input.map((r, i) => {
      const x = r as Partial<Resolution> | null;
      if (!x || typeof x.table !== 'string' || typeof x.uuid !== 'string' || (x.keep !== 'mine' && x.keep !== 'theirs')) {
        throw new SyncConsoleError(`resolutions[${i}] needs "table", "uuid" and "keep" ("mine" or "theirs")`);
      }
      if (typeof x.reviewToken !== 'string' || !x.reviewToken) throw new SyncConsoleError(`resolutions[${i}] needs the "reviewToken" from a check; review again`);
      return { table: x.table, uuid: x.uuid, keep: x.keep, reviewToken: x.reviewToken };
    });
  }

  /** The log of what was sent and brought in, newest last: default 200, at most 10,000, also for one run. */
  logOf(database: string, opts: { run?: string; limit?: number } = {}): SyncLogRow[] {
    database = this.canonical(database);
    this.setup(database);
    const store = this.host.storeOf(database);
    if (!store) throw new SyncConsoleError(`${database} isn't hosted`, 404);
    const limit = opts.limit !== undefined && opts.limit > 0 ? Math.max(1, Math.min(10_000, Math.floor(opts.limit))) : 200;
    return readSyncLog(store, { runId: opts.run, limit });
  }

  /** The sync side of the server's sync schedules. */
  jobs(): SyncJobs {
    return {
      check: (database, opts) => this.checkSchedulable(database, opts),
      run: (database, opts) => this.runScheduled(database, opts),
    };
  }

  /** A schedule can be made for this file with these options: it has a setup that allows them, and a password to use unattended. */
  private checkSchedulable(database: string, opts: SyncScheduleOptions): void {
    const setup = this.setup(database);
    checkSyncAllowed([database], { ...setup, ...(setup.allowWrites ? { allowWrites: true } : {}) }, { write: opts.write === true, captureOnly: this.captured() });
    if (opts.write && !setup.allowWrites) throw new SyncConsoleError(`the sync setup for ${database} doesn't allow writing to FileMaker: turn on "May send" in the Sync page first`);
    if (opts.pull && !setup.allowPulls) throw new SyncConsoleError(`the sync setup for ${database} doesn't allow changing it from FileMaker: turn on "May be changed" in the Sync page first`);
    if (this.savedPassword(setup) === undefined) throw new SyncConsoleError(`a scheduled sync can't be typed a password: name a file holding it ("passwordFile") or set TABULARIUS_FMS_PASSWORD`);
  }

  /** One scheduled run: a check, or (when the schedule opted in, and the setup allows) a send and/or pull. Deletions are never included. */
  private async runScheduled(database: string, opts: SyncScheduleOptions): Promise<SyncRunSummary> {
    this.checkSchedulable(database, opts);
    const write = opts.write === true;
    const pull = opts.pull === true;
    const status = write || pull ? await this.apply(database, { write, pull }) : await this.check(database, { trigger: 'scheduled' });
    const conflicts = status.conflicts.length + status.moreConflicts;
    const sum = (f: (t: TableApply) => number) => status.tables.reduce((n, t) => n + f(t), 0);
    const changed = sum((t) => t.created + t.updated + t.deleted + t.pulled.created + t.pulled.updated + t.pulled.deleted);
    const failed = sum((t) => t.failed.length);
    const parts = [
      write || pull ? `${changed} record${changed === 1 ? '' : 's'} moved` : `${changed} record${changed === 1 ? '' : 's'} would move`,
      conflicts ? `${conflicts} changed on both sides` : '',
      failed ? `${failed} failed` : '',
    ].filter(Boolean);
    const problem = status.refused ? `nothing was written: ${status.refused}` : status.stopped ? `stopped: ${status.stopped}` : failed ? `${failed} record${failed === 1 ? '' : 's'} failed` : undefined;
    return { summary: `${write || pull ? 'Ran' : 'Checked'}: ${parts.join(', ')}`, conflicts, changed: write || pull ? changed : 0, ...(problem && !(status.refused && conflicts) ? { problem } : {}) };
  }
}

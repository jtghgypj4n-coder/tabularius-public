// Script schedules, like FileMaker Server's "Run script" schedules: a script of
// a hosted file runs every so often, as an account of that file.
//
// Schedules live in <folder>/.openhbam-schedules.json and are managed through
// the admin console; each one's recent runs (HISTORY of them) are kept in
// <folder>/.openhbam-schedule-runs.json, so they survive a restart. Scheduled scripts are offline: they never reach the
// network, even on a server started with --allow-script-network, unless the
// schedule itself also allows it. Send Mail never sends. A schedule can also run
// each time its file opens (at startup, or opened again from the console; not a
// paused file resuming, which is only for copying it) instead
// of on a timer. A capture-only file is never scheduled.
//
// A schedule can also be a sync with a FileMaker Server copy of a hosted file (`sync`), set up in the console's
// Sync page first. It is a check (a dry run, the default) unless the schedule itself opts into sending to
// FileMaker (`write`) or changing the file (`pull`), and the file's sync setup has to allow that too. A record
// changed on both sides stops a write or pull before anything moves, and shows up as an alert.

import { itemNetwork } from './item-network.ts';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { captureOnly, runScript } from '../../scripts/src/index.ts';
import type { Host } from './host.ts';
import { backupFolder, defaultBackupDir } from './backup.ts';
import { describeCheck, verifyAfterBackup } from './backup-verify.ts';
import { backupFolderProblem, checkBackupFolder } from './backup-folder.ts';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';

const FILE = '.openhbam-schedules.json';
const RUNS_FILE = '.openhbam-schedule-runs.json';
const BACKUP_PROBLEM_TTL_MS = 60_000;
/** Runs kept per schedule. */
export const HISTORY = 50;

/** What a sync schedule is allowed to do beyond checking. */
export interface SyncScheduleOptions {
  /** Send this file's changes to FileMaker. The file's sync setup has to allow it as well. */
  write?: boolean;
  /** Bring FileMaker's changes into this file. The file's sync setup has to allow it as well. */
  pull?: boolean;
}

/** What one scheduled sync did, for the schedule's run list and its alerts. */
export interface SyncRunSummary {
  /** In a few words: what was checked or moved. */
  summary: string;
  /** Records changed on both sides, waiting for an administrator. */
  conflicts: number;
  /** Records sent, brought in or deleted. */
  changed: number;
  /** Set when the run was refused or stopped. */
  problem?: string;
}

/** The sync side of a sync schedule: the console's sync, kept apart so schedules need not know how it works. */
export interface SyncJobs {
  /** Throws (with the reason) unless a file's sync can run with these options on a schedule. */
  check(database: string, opts: SyncScheduleOptions): void;
  run(database: string, opts: SyncScheduleOptions): Promise<SyncRunSummary>;
}

export interface Schedule {
  id: string;
  name: string;
  /** Hosted file (without .fmp12). */
  database: string;
  script: string;
  parameter?: string;
  /** Account the script runs as: its privilege set applies, and Get ( AccountName ) returns it. */
  account: string;
  /** Minutes between runs (not used when it runs on opening). */
  everyMinutes: number;
  /** Runs each time the file opens instead of on a timer. */
  onOpen?: boolean;
  /** Local time of day ("HH:MM") the runs line up with; the first run is the next time the schedule passes it. */
  at?: string;
  enabled: boolean;
  /** Insert from URL may reach the network: only when the server also allows it. */
  network?: boolean;
  /**
   * What the hosted files' scripts, formulas, layouts and options looked like when a person last turned the network
   * switch on or approved them for this schedule (see `codeSeal`). While anything differs, the run gets no connections
   * and no connection mail, checked at every request: a script edited since, by anyone, in any file the run reaches,
   * may now call a connection nobody looked at.
   */
  sealed?: CodeSeal;
  /** A sync of the file with FileMaker Server rather than a script (`script` and `account` are then empty). */
  sync?: SyncScheduleOptions;
  /**
   * "backup": backs up every hosted file instead of running a script (database, script and account are empty).
   * "verify": reads every page of the hosted files (just `database`, when it names one) and fails when one is damaged.
   */
  kind?: 'backup' | 'message' | 'verify';
  /** A message schedule's text, sent to every connected client. */
  message?: string;
  /** A backup schedule's destination folder (the backups folder when omitted) and how many sets it keeps. */
  dest?: string;
  keep?: number;
  /** A backup schedule reads the new set back (and one older set) after the copy; a bad set fails the run. On unless false. */
  verify?: boolean;
}

export interface ScheduleRun {
  at: string;
  error: number;
  result: string;
  steps: number;
  ms: number;
  message?: string;
  /** First 100 retained script warnings, kept with the bounded run history. */
  warnings?: string[];
  /** Run from the console ("Run now") rather than at its time. */
  manual?: boolean;
  /** A sync run: records changed on both sides that need an administrator. */
  conflicts?: number;
}

export type ScheduleInput = Partial<Omit<Schedule, 'id' | 'sealed'>> & {
  /** From the console: the file's scripts as they are now are fine for this schedule's connections. */
  approveScripts?: boolean;
};

/** The next run at or after `from`: on the grid of `everyMinutes` from today's `at` (or from `from`). */
export function nextRun(s: Pick<Schedule, 'everyMinutes' | 'at'>, from: number): number {
  const every = s.everyMinutes * 60_000;
  if (!s.at) return from + every;
  const [h, m] = s.at.split(':').map(Number);
  const anchor = new Date(from);
  anchor.setHours(h, m, 0, 0);
  // Daily local-time schedules follow calendar days, including the short and long DST days.
  if (s.everyMinutes === 1440) {
    if (anchor.getTime() < from) {
      // After the clock has fallen back, an unclaimed second occurrence can still run.
      // arm() skips a day whose durable key was claimed by the first occurrence.
      const offset = new Date(from).getTimezoneOffset();
      if (offset > anchor.getTimezoneOffset()) {
        const second = anchor.getTime() + (offset - anchor.getTimezoneOffset()) * 60_000;
        const repeated = new Date(second);
        if (second >= from && repeated.getFullYear() === anchor.getFullYear() &&
            repeated.getMonth() === anchor.getMonth() && repeated.getDate() === anchor.getDate() &&
            repeated.getHours() === h && repeated.getMinutes() === m) return second;
      }
      anchor.setDate(anchor.getDate() + 1);
      // setDate can retain the prior day's DST-normalized hour across a transition.
      anchor.setHours(h, m, 0, 0);
    }
    return anchor.getTime();
  }
  const steps = Math.ceil((from - anchor.getTime()) / every);
  return anchor.getTime() + Math.max(steps, 0) * every;
}

function localDay(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Why a file's scripts are never scheduled: a capture-only file (built in, or one the server names). */
function heldBack(database: string, host: Host): string | undefined {
  return captureOnly(database, host.scriptOptions().outbound?.captureOnly)
    ? `"${database}" is a capture-only file: its scripts are never scheduled`
    : undefined;
}

/** What a schedule's connections were approved against: a short fingerprint for each thing in the hosted files that can run or steer code. */
export type CodeSeal = Record<string, string>;

const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).filter(([, x]) => x !== undefined).map(([k, x]) => [k, canon(x)]))
  : v;
const print = (v: unknown): string => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex').slice(0, 10);

/**
 * Fingerprints of what can run code or steer it in every hosted file (a scheduled script can call another file's, or
 * open it): scripts, custom functions, each table's fields (their formulas), each layout with its triggers and buttons,
 * custom menus, and the file's options, data sources and table occurrences (which file a call lands in). Keys sorted,
 * so a file read back from disk seals the same as it did before.
 */
export function codeSeal(host: Pick<Host, 'names' | 'get'>): CodeSeal {
  const seal: CodeSeal = {};
  for (const name of host.names()) {
    const store = host.get(name);
    if (!store) continue;
    const { schema } = store;
    for (const x of schema.scripts) seal[`${name}: script ${x.name}`] = print(x);
    for (const x of schema.customFunctions) seal[`${name}: custom function ${x.name}`] = print(x);
    for (const x of schema.tables) seal[`${name}: fields of ${x.name}`] = print(x);
    const designs = store.designs().layouts;
    for (const x of schema.layouts) seal[`${name}: layout ${x.name}`] = print({ x, design: designs.find((d) => d.id === x.id) });
    seal[`${name}: menus`] = print({ m: schema.customMenus, s: schema.customMenuSets, d: schema.defaultMenuSetId });
    seal[`${name}: options and data sources`] = print({ o: schema.fileOptions, d: schema.dataSources, t: schema.tableOccurrences });
  }
  return seal;
}

/** What differs between an approval and now, in words (at most `max`, then a count). */
export function sealChanges(approved: CodeSeal | undefined, now: CodeSeal, max = 8): string[] {
  if (!approved || typeof approved !== 'object') return ['not approved yet'];
  const out: string[] = [];
  for (const k of Object.keys(now)) if (approved[k] !== now[k]) out.push(approved[k] === undefined ? `${k} (new)` : k);
  for (const k of Object.keys(approved)) if (now[k] === undefined) out.push(`${k} (removed)`);
  return out.length > max ? [...out.slice(0, max), `and ${out.length - max} more`] : out;
}

function validate(s: Schedule, host: Host, sync?: SyncJobs, checkBackupDestination = true): void {
  if (!s.name.trim()) throw new ScheduleError('name is required');
  if (s.kind === 'message') {
    if (!s.message?.trim() || s.message.length > 200) throw new ScheduleError('the message is 1 to 200 characters');
  }
  if (s.kind === 'message' || s.kind === 'backup' || s.kind === 'verify') {
    if (s.sync) throw new ScheduleError(`a ${s.kind} schedule has no sync`);
    if (s.kind === 'verify' && s.database && !host.get(s.database)) throw new ScheduleError(`"${s.database}" is not hosted`);
    if (s.verify !== undefined && s.kind !== 'backup') throw new ScheduleError('verify is for backup schedules');
    if (s.kind === 'backup' && (!Number.isInteger(s.keep ?? 7) || (s.keep ?? 7) < 1 || (s.keep ?? 7) > 1000)) throw new ScheduleError('keep must be 1 to 1000 backups');
    if (s.kind === 'backup' && s.dest && checkBackupDestination) {
      try { s.dest = checkBackupFolder(s.dest, host.dir); }
      catch (e) { throw new ScheduleError((e as Error).message); }
    }
    if (!Number.isFinite(s.everyMinutes) || s.everyMinutes < 1 || s.everyMinutes > 366 * 1440) throw new ScheduleError('everyMinutes must be between 1 and 527040');
    if (s.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)) throw new ScheduleError('at must be a time of day, HH:MM');
    return;
  }
  const held = heldBack(s.database, host);
  if (held) throw new ScheduleError(held);
  const store = host.get(s.database);
  if (!store) throw new ScheduleError(`"${s.database}" is not hosted`);
  if (s.sync) {
    if (!sync) throw new ScheduleError('sync is not running on this server');
    if (s.script || s.account || s.parameter || s.network || s.onOpen) throw new ScheduleError('a sync schedule has no script, account, parameter, network or onOpen');
    try {
      sync.check(s.database, s.sync);
    } catch (e) {
      throw new ScheduleError((e as Error).message);
    }
    if (!Number.isFinite(s.everyMinutes) || s.everyMinutes < 5 || s.everyMinutes > 366 * 1440) throw new ScheduleError('a sync schedule runs at most every 5 minutes: everyMinutes is 5 to 527040');
    if (s.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)) throw new ScheduleError('at must be a time of day, HH:MM');
    return;
  }
  if (!store.schema.scripts.some((x) => x.name === s.script)) throw new ScheduleError(`"${s.database}" has no script "${s.script}"`);
  if (!s.account.trim()) throw new ScheduleError('account is required');
  try {
    store.requireActiveAccount(s.account);
    store.privileges(s.account).checkScript(s.script);
  } catch (e) {
    throw new ScheduleError(`account "${s.account}" can't run "${s.script}": ${(e as Error).message}`);
  }
  if (!Number.isFinite(s.everyMinutes) || s.everyMinutes < 1 || s.everyMinutes > 366 * 1440) throw new ScheduleError('everyMinutes must be between 1 and 527040');
  if (s.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)) throw new ScheduleError('at must be a time of day, HH:MM');
}

export class ScheduleError extends Error {}

function syncOptions(input: unknown): SyncScheduleOptions {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ScheduleError('"sync" is an object: {} to check, or {"write": true} / {"pull": true}');
  for (const k of Object.keys(o)) {
    if (k !== 'write' && k !== 'pull') throw new ScheduleError(`unknown sync option "${k}": use "write" and/or "pull"`);
    if (typeof o[k] !== 'boolean') throw new ScheduleError(`sync "${k}" is true or false`);
  }
  return { ...(o.write ? { write: true } : {}), ...(o.pull ? { pull: true } : {}) };
}

export class Schedules {
  private readonly host: Host;
  private readonly log: (m: string) => void;
  private list: Schedule[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly due = new Map<string, number>();
  /** Changes to a schedule invalidate callbacks from its prior timer, including an in-flight run's completion. */
  private readonly timerVersions = new Map<string, number>();
  private readonly running = new Set<string>();
  /** Scheduled times skipped because the schedule was still running, since the server started. */
  private readonly skipped = new Map<string, number>();
  /** Recent runs, newest first. */
  private readonly history = new Map<string, ScheduleRun[]>();
  /** Runs and failed runs since the server started (for metrics). */
  private readonly counts = new Map<string, { runs: number; failures: number }>();
  private readonly backupProblems = new Map<string, { dest: string; at: number; unavailable?: string }>();
  private stopped = false;
  /** Sends a text to every connected client and says how many it reached (a message schedule's task). */
  broadcast?: (text: string) => number;
  /** Set once the console's sync is up; sync schedules need it. */
  syncJobs?: SyncJobs;

  constructor(host: Host, log: (m: string) => void = () => {}) {
    this.host = host;
    this.log = log;
    const f = join(host.dir, FILE);
    if (existsSync(f)) {
      try {
        this.list = (readJsonStateSync<{ schedules?: Schedule[] }>(f)).schedules ?? [];
      } catch (e) {
        log(`schedules: can't read ${FILE}: ${(e as Error).message}`);
      }
    }
    const runs = join(host.dir, RUNS_FILE);
    if (existsSync(runs)) {
      try {
        const kept = (readJsonStateSync<{ runs?: Record<string, ScheduleRun[]> }>(runs)).runs ?? {};
        for (const s of this.list) if (Array.isArray(kept[s.id])) this.history.set(s.id, kept[s.id].slice(0, HISTORY));
      } catch (e) {
        log(`schedules: can't read ${RUNS_FILE}: ${(e as Error).message}`);
      }
    }
    for (const s of this.list) this.arm(s);
    // "When the file opens": each file as it is opened again, and the files open now once the server is up
    // (a cluster's followers stop() before then, so only the leader runs them).
    host.onAdd.push((store) => setImmediate(() => this.opened(store.name)));
    setImmediate(() => {
      for (const name of host.names()) this.opened(name);
      this.noticeHeld();
    });
  }

  /**
   * Says once, when the server starts, which schedules have their connections held: a person must approve them before
   * a run gets a connection, or mail through one (a server upgrade that tightens what an approval covers, or a design
   * change made while the server was down, leaves earlier approvals out of date). Otherwise the first sign is a run
   * that quietly does without them.
   */
  private noticeHeld(): void {
    if (this.stopped || !this.host.scriptOptions().connections) return;
    for (const s of this.list) {
      if (s.network !== true || s.kind || s.sync || this.warned.has(s.id)) continue;
      const changed = this.connectionsChanged(s, true);
      if (!changed.length) continue;
      this.warned.add(s.id);
      this.host.logs?.event('Warning', `Schedule "${s.name}" (${s.database}, script ${s.script}) has its connections held: ${changed.slice(0, 3).join(', ')} changed since a person last approved it, so its runs get no connections and send no mail through one until it is approved again in the console's Schedules page.`, 'schedule');
    }
  }

  /** Runs the schedules set to run when this file opens. */
  private opened(database: string): void {
    if (this.stopped) return;
    for (const s of this.list) {
      if (s.enabled && s.onOpen && !s.kind && s.database.toLowerCase() === database.toLowerCase() && !this.running.has(s.id)) {
        void this.run(s.id, false).catch(() => {});
      }
    }
  }

  /**
   * Schedules turned on whose latest run failed, newest first, for the security health page: what ran, when, and why
   * it stopped, with how many of its recent runs failed.
   */
  failing(database?: string): { id: string; name: string; database: string; script: string; account: string; at: string; error: number; message?: string; failedRuns: number; runs: number }[] {
    return this.list
      // Turned off, it won't fail again: not something to look at.
      .filter((s) => s.enabled && !s.sync && (!database || s.database.toLowerCase() === database.toLowerCase()))
      .flatMap((s) => {
        const runs = this.history.get(s.id) ?? [];
        const last = runs[0];
        if (!last || last.error === 0) return [];
        return [{
          id: s.id, name: s.name, database: s.database, script: s.script, account: s.account, at: last.at, error: last.error,
          ...(last.message ? { message: last.message } : {}), failedRuns: runs.filter((r) => r.error !== 0).length, runs: runs.length,
        }];
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Sync schedules turned on whose latest run found records changed on both sides (nothing moves until an
   * administrator settles them in the Sync page) or could not finish. Each stays here until a run is clean.
   */
  syncAlerts(database?: string): { id: string; name: string; database: string; at: string; conflicts: number; problem?: string; write: boolean; pull: boolean }[] {
    return this.list
      .filter((s) => s.sync && s.enabled && (!database || s.database.toLowerCase() === database.toLowerCase()))
      .flatMap((s) => {
        const last = (this.history.get(s.id) ?? [])[0];
        if (!last || (!last.conflicts && !last.error)) return [];
        return [{ id: s.id, name: s.name, database: s.database, at: last.at, conflicts: last.conflicts ?? 0, ...(last.error ? { problem: last.message ?? `error ${last.error}` } : {}), write: !!s.sync!.write, pull: !!s.sync!.pull }];
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Each schedule with its next run, its last run, its last failed run (which
   * may be older than the last one), and runs and failures since the server started.
   */
  all(): (Schedule & { next?: string; last?: ScheduleRun; lastError?: ScheduleRun; running: boolean; runs: number; failures: number; skipped: number; connectionsHeld?: boolean; connectionsChanged?: string[]; unavailable?: string })[] {
    return this.list.map((s) => {
      const due = this.due.get(s.id);
      const runs = this.history.get(s.id) ?? [];
      const lastError = runs.find((r) => r.error !== 0);
      return {
        ...s, ...(due ? { next: new Date(due).toISOString() } : {}), ...(runs[0] ? { last: runs[0] } : {}), ...(lastError ? { lastError } : {}),
        running: this.running.has(s.id), runs: this.counts.get(s.id)?.runs ?? 0, failures: this.counts.get(s.id)?.failures ?? 0, skipped: this.skipped.get(s.id) ?? 0,
        ...(() => { const changed = this.connectionsChanged(s); return changed.length ? { connectionsHeld: true, connectionsChanged: changed } : {}; })(),
        ...(s.kind === 'backup' && s.dest ? (() => { const unavailable = this.backupProblem(s); return unavailable ? { unavailable } : {}; })() : {}),
      };
    });
  }

  /** Listings only read a destination once a minute; save and run refresh the known state. */
  private backupProblem(s: Schedule): string | undefined {
    const dest = s.dest!;
    const cached = this.backupProblems.get(s.id);
    const now = performance.now();
    if (cached?.dest === dest && now - cached.at < BACKUP_PROBLEM_TTL_MS) return cached.unavailable;
    const unavailable = backupFolderProblem(dest, this.host.dir);
    this.backupProblems.set(s.id, { dest, at: now, unavailable });
    return unavailable;
  }

  /** A schedule's recent runs, newest first. */
  runs(id: string): ScheduleRun[] {
    return this.history.get(id) ?? [];
  }

  get(id: string): Schedule | undefined {
    return this.list.find((s) => s.id === id);
  }

  create(input: ScheduleInput): Schedule {
    const s: Schedule = {
      id: randomBytes(6).toString('hex'),
      ...(input.kind === 'backup' ? { kind: 'backup' as const, ...(input.dest ? { dest: String(input.dest) } : {}), keep: Number(input.keep ?? 7), ...(input.verify === false ? { verify: false } : {}) } : {}),
      ...(input.kind === 'verify' ? { kind: 'verify' as const } : {}),
      ...(input.kind === 'message' ? { kind: 'message' as const, message: String(input.message ?? '') } : {}),
      name: String(input.name ?? input.script ?? ''),
      database: String(input.database ?? ''),
      script: String(input.script ?? ''),
      account: String(input.account ?? ''),
      everyMinutes: Number(input.everyMinutes ?? 1440),
      enabled: input.enabled !== false,
      ...(input.parameter !== undefined && input.parameter !== '' ? { parameter: String(input.parameter) } : {}),
      ...(input.at ? { at: String(input.at) } : {}),
      ...(input.network === true ? { network: true } : {}),
      ...(input.onOpen === true ? { onOpen: true } : {}),
      ...(input.sync !== undefined ? { sync: syncOptions(input.sync) } : {}),
    };
    if (input.verify !== undefined && s.kind !== 'backup') throw new ScheduleError('verify is for backup schedules');
    if (s.sync && !input.name) s.name = `Sync ${s.database}`;
    validate(s, this.host, this.syncJobs);
    // A person turning the network switch on looked at the scripts as they are (a copy of a schedule that is held is held too).
    if (s.network && input.approveScripts !== false) this.seal(s);
    this.list.push(s);
    if (s.kind === 'backup' && s.dest) this.backupProblems.set(s.id, { dest: s.dest, at: performance.now() });
    this.save(s, undefined, true);
    const current = this.get(s.id);
    if (current) this.arm(current);
    return s;
  }

  update(id: string, input: ScheduleInput): Schedule {
    const old = this.get(id);
    if (!old) throw new ScheduleError('no such schedule');
    const s: Schedule = { ...old };
    if (input.kind !== undefined && input.kind !== old.kind) throw new ScheduleError("a schedule can't change from one kind of task to another");
    if (old.kind && old.kind !== 'verify' && (['database', 'script', 'account', 'parameter'] as const).some((k) => input[k] !== undefined)) throw new ScheduleError(`a ${old.kind} schedule has no file, script or account`);
    for (const k of ['name', 'database', 'script', 'account', 'parameter', 'at'] as const) {
      if (input[k] === undefined) continue;
      if (input[k] === '' && (k === 'parameter' || k === 'at')) delete s[k];
      else s[k] = String(input[k]);
    }
    if (s.kind === 'verify' && (input.script !== undefined || input.account !== undefined || input.parameter !== undefined)) throw new ScheduleError('a verify schedule has no script or account');
    if (s.kind === 'message' && input.message !== undefined) s.message = String(input.message);
    if (input.verify !== undefined && s.kind !== 'backup') throw new ScheduleError('verify is for backup schedules');
    if (s.kind === 'backup') {
      if (input.keep !== undefined) s.keep = Number(input.keep);
      if (input.verify !== undefined) {
        if (input.verify === false) s.verify = false;
        else delete s.verify;
      }
      if (input.dest !== undefined) {
        if (input.dest === '') delete s.dest;
        else s.dest = String(input.dest);
      }
    }
    if (input.everyMinutes !== undefined) s.everyMinutes = Number(input.everyMinutes);
    if (input.enabled !== undefined) s.enabled = input.enabled === true;
    if (input.network !== undefined) {
      if (input.network === true) s.network = true;
      else delete s.network;
    }
    if (input.onOpen !== undefined) {
      if (input.onOpen === true) s.onOpen = true;
      else delete s.onOpen;
    }
    if (input.sync !== undefined) {
      if (!old.sync) throw new ScheduleError('a script schedule can\'t become a sync schedule: add a new one');
      s.sync = syncOptions(input.sync);
    }
    validate(s, this.host, this.syncJobs, old.kind !== 'backup' || input.dest !== undefined && input.dest !== old.dest);
    if (!s.network) delete s.sealed;
    // Sealed when the switch goes on or a person approves; a rename, or another file or script, keeps what was approved (and so is held until approved).
    else if (!old.network || input.approveScripts === true) this.seal(s);
    this.list[this.list.indexOf(old)] = s;
    // A new time of day (or a new interval) is a new schedule for "once a day": today's run under the old time doesn't use up today.
    if (s.at !== old.at || s.everyMinutes !== old.everyMinutes) this.forgetRunDays(id);
    if (s.kind === 'backup' && s.dest && s.dest !== old.dest) this.backupProblems.set(s.id, { dest: s.dest, at: performance.now() });
    else if (!s.dest) this.backupProblems.delete(s.id);
    this.save(s);
    const current = this.get(s.id);
    if (current) this.arm(current);
    return s;
  }

  /** Records the hosted files as they are now as the ones a person looked at for this schedule. */
  private seal(s: Schedule): void {
    s.sealed = codeSeal(this.host);
    this.warned.delete(s.id);
  }

  /**
   * The current fingerprints for listings: kept while no hosted file's schema or layout designs were replaced (every design
   * change replaces them), so the console's polling does not hash large files again and again. A run asks afresh.
   */
  private sealNow(fresh = false): CodeSeal {
    const stores = this.host.names().map((n) => this.host.get(n));
    const parts = stores.flatMap((st) => (st ? [st, st.schema, st.designs()] : []));
    const c = this.sealCache;
    if (!fresh && c && c.parts.length === parts.length && c.parts.every((x, i) => x === parts[i])) return c.seal;
    this.sealCache = { parts, seal: codeSeal(this.host) };
    return this.sealCache.seal;
  }
  private sealCache?: { parts: unknown[]; seal: CodeSeal };
  /** Schedules whose held state was already written to the log, so a schedule that runs every minute says it once. */
  private warned = new Set<string>();

  /** What changed in the hosted files since this schedule's connections were approved (empty when nothing, or when it uses none). */
  connectionsChanged(s: Schedule, fresh = false): string[] {
    if (!s.network || s.kind || s.sync) return [];
    return sealChanges(s.sealed, this.sealNow(fresh));
  }

  /** Whether a network schedule's files changed since a person approved them: its runs get no connections until a person approves them in the console. */
  connectionsHeld(s: Schedule): boolean {
    return this.connectionsChanged(s).length > 0;
  }

  remove(id: string): boolean {
    const s = this.get(id);
    if (!s) return false;
    this.disarm(id);
    this.timerVersions.delete(id);
    this.list.splice(this.list.indexOf(s), 1);
    this.history.delete(id);
    this.counts.delete(id);
    this.skipped.delete(id);
    this.warned.delete(id);
    this.backupProblems.delete(id);
    this.save(undefined, id);
    this.saveRuns(id, true);
    return true;
  }

  /** Runs a schedule's script now (the console's "Run now", and each scheduled time). */
  async run(id: string, manual = true, scheduledAt = Date.now()): Promise<ScheduleRun> {
    const s = this.get(id);
    if (!s) throw new ScheduleError('no such schedule');
    if (this.running.has(id)) throw new ScheduleError('the schedule is already running');
    if (!manual && !s.onOpen && s.at && s.everyMinutes === 1440 && !this.claimDay(id, localDay(scheduledAt))) {
      throw new ScheduleError(`the schedule already ran on ${localDay(scheduledAt)}`);
    }
    this.running.add(id);
    const started = Date.now();
    let run: ScheduleRun;
    try {
      if (s.kind === 'backup') {
        if (s.dest) {
          try {
            s.dest = checkBackupFolder(s.dest, this.host.dir);
            this.backupProblems.set(s.id, { dest: s.dest, at: performance.now() });
          } catch (e) {
            this.backupProblems.set(s.id, { dest: s.dest, at: performance.now(), unavailable: (e as Error).message });
            throw e;
          }
        }
        const made = await backupFolder(this.host.dir, s.dest, s.keep ?? 7);
        // Read back before it counts as good, and one older set checked again (as the server's own backups are).
        if (s.verify !== false) {
          const check = await verifyAfterBackup(s.dest ?? defaultBackupDir(this.host.dir), basename(made.dir), (m) => this.log(`schedule "${s.name}": ${m}`));
          if (!check.ok) throw new ScheduleError(describeCheck(basename(made.dir), check));
        }
        run = { at: new Date(started).toISOString(), error: 0, result: basename(made.dir), steps: 0, ms: Date.now() - started, ...(manual ? { manual } : {}) };
      } else if (s.kind === 'verify') {
        // Every page of each hosted file, off the request path; a damaged one fails the run and names the file.
        const names = s.database ? [s.database] : this.host.names();
        const bad: string[] = [];
        for (const name of names) {
          const r = await this.host.verifyHosted(name);
          if (r.state !== 'ok') bad.push(`${name}: ${r.detail}`);
        }
        if (bad.length) throw new ScheduleError(`${bad.length === 1 ? 'a file' : `${bad.length} files`} failed the check: ${bad.join('; ')}`);
        run = { at: new Date(started).toISOString(), error: 0, result: `${names.length} ${names.length === 1 ? 'file' : 'files'} ok`, steps: 0, ms: Date.now() - started, ...(manual ? { manual } : {}) };
      } else if (s.kind === 'message') {
        if (!this.broadcast) throw new ScheduleError('this server has no connected clients to message');
        const reached = this.broadcast(s.message ?? '');
        run = { at: new Date(started).toISOString(), error: 0, result: `${reached} ${reached === 1 ? 'client' : 'clients'}`, steps: 0, ms: Date.now() - started, ...(manual ? { manual } : {}) };
      } else {
        const held = heldBack(s.database, this.host);
        if (held) throw new ScheduleError(held);
        const store = this.host.get(s.database);
        if (!store) throw new ScheduleError(`"${s.database}" is not hosted`);
        if (s.sync) {
          run = await this.runSync(s, started, manual);
        } else {
          store.requireActiveAccount(s.account);
          const privileges = store.privileges(s.account);
          privileges.checkScript(s.script);
          const opts = this.host.scriptOptions(s.database);
          // Anything the run can reach edited since a person last approved it (the AI can edit it) gets no connections, and no mail through one.
          // Checked again at every request, so an edit while the run waits its turn or is under way is caught too.
          const watched = s.network === true && !!opts.connections;
          const changed = watched ? this.connectionsChanged(s, true) : [];
          const withheld = changed.length > 0;
          if (withheld && !this.warned.has(s.id)) {
            this.warned.add(s.id);
            this.host.logs?.event('Warning', `Schedule "${s.name}" ran without its connections: ${changed.slice(0, 3).join(', ')} changed after they were last approved for it. Approve them in the console's Schedules page.`, 'schedule');
          }
          const stale = () => (s.network === true ? sealChanges(s.sealed, codeSeal(this.host), 3) : []);
          const connections = opts.connections && opts.network && s.network === true ? {
            host: (name: string) => opts.connections!.host(name),
            request: async (name: string, req: Parameters<NonNullable<typeof opts.connections>['request']>[1], files: readonly string[]) => {
              const now = stale();
              if (now.length) throw new Error(`connections are held for this schedule: ${now.join(', ')} changed after a person last approved it`);
              return opts.connections!.request(name, req, files);
            },
          } : undefined;
          // Connection mail is held the same way; the operator's own mail flag is not a connection.
          const mail = opts.mail && !this.host.mailIsFlag ? async (m: Parameters<NonNullable<typeof opts.mail>>[0]) => {
            const now = stale();
            return now.length ? `mail through a connection is held for this schedule: ${now.join(', ')} changed after a person last approved it` : opts.mail!(m);
          } : opts.mail;
          // Schedules wait their turn with Perform Script on Server; Perform Script on Server inside a schedule runs at once.
          const r = await opts.serverQueue.run((stop) => runScript(store, s.script, {
            ...(stop ? { stop } : {}),
            parameter: s.parameter, account: s.account, executionAccount: s.account, privileges,
            documents: opts.documents,
            ...itemNetwork(opts, s.network, 'schedule'), ...(opts.networkAllow ? { networkAllow: opts.networkAllow } : {}),
            // In outbound test mode schedules' mail is captured like everyone's; with sending on, it is sent.
            ...(opts.outbound ? { outbound: opts.outbound } : {}), ...(mail ? { mail } : {}), ...(opts.ai ? { ai: opts.ai } : {}),
            // Connections (S3, web APIs) by name, only for a schedule whose network switch is on (outbound test mode would otherwise hand a fetcher to every run); schedules are made by people in the console, never by the AI.
            ...(connections ? { connections } : {}),
            ...(opts.profile ? { profile: opts.profile } : {}),
          }), { file: store.name, script: s.script, account: s.account, kind: 'schedule' });
          run = { at: new Date(started).toISOString(), error: r.error, result: r.result, steps: r.steps, ms: Date.now() - started, ...(r.warnings?.length ? { warnings: r.warnings.slice(0, 100) } : {}), ...(withheld ? { message: `ran without its connections: ${changed.slice(0, 3).join(', ')} changed since they were last approved for this schedule` } : {}), ...(manual ? { manual } : {}) };
        }
      }
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      run = { at: new Date(started).toISOString(), error: typeof code === 'number' ? code : -1, result: '', steps: 0, ms: Date.now() - started, message: (e as Error).message, ...(manual ? { manual } : {}) };
    } finally {
      this.running.delete(id);
    }
    // Deleted while it ran: nothing to keep.
    if (this.get(id)) {
      this.history.set(id, [run, ...(this.history.get(id) ?? [])].slice(0, HISTORY));
      const c = this.counts.get(id) ?? { runs: 0, failures: 0 };
      this.counts.set(id, { runs: c.runs + 1, failures: c.failures + (run.error ? 1 : 0) });
      this.saveRuns(id);
    }
    if (s.kind === 'message') {
      this.host.logs?.event(run.error ? 'Error' : 'Information', `Schedule "${s.name}" sent a message to clients${run.error ? `: error ${run.error}${run.message ? `, ${run.message}` : ''}` : ` (${run.result})`}`, 'schedule');
      return run;
    }
    if (s.kind === 'verify') {
      this.host.logs?.event(run.error ? 'Error' : 'Information', `Schedule "${s.name}" verified ${s.database ? `"${s.database}"` : 'the hosted files'}${run.error ? `: ${run.message ?? `error ${run.error}`}` : ` (${run.result})`}`, 'schedule');
      return run;
    }
    if (s.kind === 'backup') {
      this.host.logs?.event(run.error ? 'Error' : 'Information', `Schedule "${s.name}" backed up the hosted files${run.error ? `: error ${run.error}${run.message ? `, ${run.message}` : ''}` : ` (${run.result})`}`, 'schedule');
      return run;
    }
    if (run.error) this.host.logs?.write('ScriptEvent', 'Error', s.database, s.sync ? `Sync schedule "${s.name}": ${run.message ?? `error ${run.error}`}` : `Schedule "${s.name}" ran "${s.script}" (${s.account}): error ${run.error}${run.message ? `, ${run.message}` : ''}`);
    this.log(`schedule "${s.name}": ${s.database} / ${s.sync ? 'sync' : s.script} ${run.error ? `error ${run.error}${run.message ? `: ${run.message}` : ''}` : 'ok'} (${run.steps} steps, ${run.ms} ms)`);
    return run;
  }

  /** One scheduled sync: a check unless the schedule opted into sending or pulling. */
  private async runSync(s: Schedule, started: number, manual: boolean): Promise<ScheduleRun> {
    const jobs = this.syncJobs;
    if (!jobs) throw new ScheduleError('sync is not running on this server');
    const before = (this.history.get(s.id) ?? [])[0]?.conflicts ?? 0;
    const r = await jobs.run(s.database, s.sync!);
    // The log hears of it when the count changes, not at every run while it waits.
    if (r.conflicts !== before) {
      if (r.conflicts) this.host.logs?.write('Event', 'Warning', s.database, `Sync "${s.name}": ${r.conflicts} record${r.conflicts === 1 ? ' is' : 's are'} changed on both sides and wait for a decision in the console's Sync page`);
      else this.host.logs?.write('Event', 'Information', s.database, `Sync "${s.name}": no records are waiting for a decision any more`);
    }
    return {
      at: new Date(started).toISOString(), error: r.problem ? -1 : 0, result: r.summary, steps: r.changed, ms: Date.now() - started,
      ...(r.problem ? { message: r.problem } : {}), ...(r.conflicts ? { conflicts: r.conflicts } : {}), ...(manual ? { manual } : {}),
    };
  }

  stop(): void {
    this.stopped = true;
    for (const id of [...this.timers.keys()]) this.disarm(id);
  }

  private arm(s: Schedule, from = Date.now()): void {
    this.disarm(s.id);
    if (!s.enabled || this.stopped || s.onOpen) return;
    let at = nextRun(s, from);
    if (s.at && s.everyMinutes === 1440) {
      try {
        const claimed = readJsonStateSync<{ runDays?: Record<string, string[]> }>(join(this.host.dir, RUNS_FILE)).runDays?.[s.id] ?? [];
        while (claimed.includes(localDay(at))) at = nextRun(s, at + 1);
      } catch (e) {
        if (existsSync(join(this.host.dir, RUNS_FILE))) {
          this.log(`schedules: can't read daily run keys: ${(e as Error).message}`);
          return;
        }
      }
    }
    this.due.set(s.id, at);
    this.waitFor(s, at);
  }

  /** Check the wall clock periodically: a changed system clock does not move an existing timeout. */
  private waitFor(s: Schedule, at: number): void {
    const wait = Math.max(0, Math.min(at - Date.now(), 60_000));
    const version = this.timerVersions.get(s.id);
    const timer = setTimeout(() => {
      // An edit, removal, or stop can replace this timer while its callback is pending.
      if (this.timers.get(s.id) !== timer || this.timerVersions.get(s.id) !== version || !this.get(s.id) || this.stopped) return;
      if (Date.now() < at) return this.waitFor(s, at);
      this.timers.delete(s.id);
      this.due.delete(s.id);
      // The last run is still going: this time is skipped, and the log says so (a run never overlaps itself).
      if (this.running.has(s.id)) {
        this.skipped.set(s.id, (this.skipped.get(s.id) ?? 0) + 1);
        this.host.logs?.event('Warning', `Schedule "${s.name}" skipped its run at ${new Date(at).toISOString()}: the previous run was still going`, 'schedule');
        const current = this.get(s.id);
        if (current) this.arm(current);
        return;
      }
      void this.run(s.id, false, at).catch(() => {}).finally(() => {
        const current = this.get(s.id);
        if (!this.stopped && current && this.timerVersions.get(s.id) === version) this.arm(current, Date.now() + 1);
      });
    }, wait);
    timer.unref();
    this.timers.set(s.id, timer);
  }

  private disarm(id: string): void {
    this.timerVersions.set(id, (this.timerVersions.get(id) ?? 0) + 1);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.due.delete(id);
  }

  private saveRuns(id: string, removed = false): void {
    const f = join(this.host.dir, RUNS_FILE);
    try {
      updateJsonStateSync<{ runs: Record<string, ScheduleRun[]>; runDays?: Record<string, string[]> }>(f, { runs: {} }, (current) => {
        const runs = { ...current.runs };
        const runDays = { ...current.runDays };
        if (removed) { delete runs[id]; delete runDays[id]; }
        else {
          const mine = this.history.get(id) ?? [];
          runs[id] = [...mine, ...(runs[id] ?? []).filter((run) => !mine.some((own) => JSON.stringify(own) === JSON.stringify(run)))]
            .sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY);
        }
        return { runs, runDays };
      }, { mode: 0o600, lockWaitMs: 50 });
    } catch (e) {
      // A full disk shouldn't stop schedules from running.
      this.log(`schedules: can't save run history: ${(e as Error).message}`);
    }
  }

  private forgetRunDays(id: string): void {
    try {
      updateJsonStateSync<{ runs: Record<string, ScheduleRun[]>; runDays?: Record<string, string[]> }>(
        join(this.host.dir, RUNS_FILE), { runs: {} }, (current) => {
          if (!current.runDays?.[id]) return current;
          const runDays = { ...current.runDays };
          delete runDays[id];
          return { ...current, runDays };
        }, { mode: 0o600, lockWaitMs: 50 });
    } catch (e) {
      this.log(`schedules: can't clear daily run keys: ${(e as Error).message}`);
    }
  }

  /** Reserve the local date before work starts so a restart or repeated hour cannot start it twice.
   * A crash after reservation can leave that date unexecuted; replaying it could duplicate external effects. */
  private claimDay(id: string, day: string): boolean {
    let claimed = false;
    updateJsonStateSync<{ runs: Record<string, ScheduleRun[]>; runDays?: Record<string, string[]> }>(
      join(this.host.dir, RUNS_FILE), { runs: {} }, (current) => {
        const runDays = { ...current.runDays };
        const days = runDays[id] ?? [];
        if (days.includes(day)) return current;
        claimed = true;
        // Only the last days matter (a restart looks at today and the repeated hour), so the list doesn't grow for ever.
        runDays[id] = [...days, day].slice(-14);
        return { ...current, runDays };
      }, { mode: 0o600 },
    );
    return claimed;
  }

  private save(changed?: Schedule, removedId?: string, create = false): void {
    const f = join(this.host.dir, FILE);
    const saved = updateJsonStateSync<{ schedules: Schedule[] }>(f, { schedules: [] }, (current) => {
      const schedules = current.schedules ?? [];
      return { schedules: removedId ? schedules.filter((s) => s.id !== removedId)
        : changed ? schedules.some((s) => s.id === changed.id)
          ? schedules.map((s) => s.id === changed.id ? changed : s) : create ? [...schedules, changed] : schedules
          : schedules };
    }, { mode: 0o600 });
    this.list = saved.schedules;
  }
}

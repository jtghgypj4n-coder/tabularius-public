// Switching from FileMaker Server in one step: its hosted files, script
// schedules, backup schedule and SSL certificate brought into a Tabularius folder.
//
// What the server is set up to do comes from its Admin API (v2), read live or
// from a JSON file saved earlier (`fetchFmsExport` makes one). The files and the
// certificate come from the FileMaker Server folder on disk (its Data/Databases
// and CStore folders), since the Admin API doesn't hand out either.
//
// Nothing here runs a script or sends mail: script schedules are written down
// for Tabularius's scheduler, which runs them offline; message and system-script
// schedules, and schedule emails, are listed as not carried over.

import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { hostRefusal, socketLookup } from '../../scripts/src/net-guard.ts';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { createHash, createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import type { Schedule } from './schedules.ts';
import { claimFolder } from './backup.ts';
import { migrateFile } from './migration-files.ts';

// The FileMaker Server is one an administrator named (often on the same network), so its own network is allowed; the metadata range is never reached, and a name is checked on the lookup the connection uses.
const FMS_LOOKUP = socketLookup({ private: true });

/** The Admin API answers a migration reads: each one is the `response` of that call. */
export interface FmsExport {
  /** GET /server/metadata */
  metadata?: Record<string, unknown>;
  /** GET /server/config/general */
  general?: Record<string, unknown>;
  /** GET /server/config/security */
  security?: Record<string, unknown>;
  /** GET /databases: response.databases */
  databases?: FmsDatabase[];
  /** GET /schedules: response.schedules */
  schedules?: FmsSchedule[];
}

export interface FmsDatabase {
  filename: string;
  /** FileMaker path of its folder: filemac:/Macintosh HD/..., filewin:/C:/..., filelinux:/... */
  folder?: string;
  status?: string;
  isEncrypted?: boolean;
}

export type FmsSchedule = Record<string, unknown> & { name?: string; enabled?: boolean };

/** Settings `tabularius serve` reads from the folder when no flag or environment variable gives them. */
export interface FolderSettings {
  backupEvery?: string;
  keep?: number;
  backupDir?: string;
  /** How big a log may get before it is turned over, like "100MB" (`--log-limit`). */
  logLimit?: string | number;
  tlsCert?: string;
  tlsKey?: string;
}

export const SETTINGS_FILE = '.openhbam-settings.json';
const SCHEDULES_FILE = '.openhbam-schedules.json';

/** Read and check the settings object shared by serve and the admin console. */
export function readSettingsObject(dir: string): Record<string, unknown> {
  const f = join(dir, SETTINGS_FILE);
  if (!existsSync(f)) return {};
  let value: unknown;
  try { value = readJsonStateSync<unknown>(f); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (e instanceof Error && e.cause instanceof SyntaxError) throw new Error(`${f} isn't valid JSON: ${e.cause.message}`, { cause: e });
    throw e;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${f}: settings must be an object`);
  const s = value as Record<string, unknown>;
  for (const [key, type] of Object.entries({ backupEvery: 'string', keep: 'number', backupDir: 'string', tlsCert: 'string', tlsKey: 'string', blockNewUsers: 'boolean', sessionIdleMinutes: 'number', webSessionIdleMinutes: 'number', responsiveStackBelow: 'number', scriptPluginInstall: 'boolean' })) {
    if (s[key] !== undefined && typeof s[key] !== type) throw new Error(`${f}: ${key} must be a ${type}`);
  }
  return s;
}

/** The folder's settings; paths in it are relative to the folder. */
export function readSettings(dir: string): FolderSettings {
  const s = readSettingsObject(dir) as FolderSettings;
  for (const k of ['backupDir', 'tlsCert', 'tlsKey'] as const) if (s[k]) s[k] = resolve(dir, s[k]);
  return s;
}

export interface MigrateOptions {
  /** The FileMaker Server folder: /Library/FileMaker Server, C:\Program Files\FileMaker\FileMaker Server, /opt/FileMaker/FileMaker Server. */
  fmsDir?: string;
  /** Passphrase of CStore/serverKey.pem, which FileMaker Server keeps encrypted. */
  keyPassphrase?: string;
  /** Only say what would be done. */
  dryRun?: boolean;
  /** Completed file steps; ETA is absent until there is a measured rate. */
  onProgress?: (progress: { completed: number; total: number; elapsedMs: number; etaMs: number | null }) => void;
}

export interface MigrationReport {
  files: { name: string; from?: string; done: boolean; note?: string }[];
  schedules: { name: string; done: boolean; note?: string }[];
  settings: FolderSettings;
  certificate?: { subject: string; validTo: string; done: boolean; note?: string };
  notes: string[];
}

export class FmsMigrationError extends Error {}

function checksum(path: string): string {
  const hash = createHash('sha256');
  const file = openSync(path, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (let n: number; (n = readSync(file, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, n));
  } finally { closeSync(file); }
  return hash.digest('hex');
}

function fileTree(path: string, root = path): { name: string; hash: string }[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new FmsMigrationError(`symlink in container folder: ${full}`);
    if (entry.isDirectory()) return fileTree(full, root);
    if (!entry.isFile()) throw new FmsMigrationError(`unsupported entry in container folder: ${full}`);
    return [{ name: relative(root, full), hash: checksum(full) }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function copyVerifiedFile(from: string, to: string, dest: string): void {
  const stage = mkdtempSync(join(dest, '.tabularius-migrate-'));
  try {
    const part = join(stage, basename(to));
    const before = checksum(from);
    copyFileSync(from, part);
    const after = checksum(from);
    if (before !== after || checksum(part) !== after) throw new FmsMigrationError(`${basename(from)} changed while being copied; rerun after stopping writes to the source`);
    // Another migration may have completed this file while we copied it.
    if (!existsSync(to)) renameSync(part, to);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

function copyVerifiedTree(from: string, to: string, dest: string): void {
  if (existsSync(to)) {
    if (JSON.stringify(fileTree(from)) !== JSON.stringify(fileTree(to))) throw new FmsMigrationError(`${to} differs from the source container folder; resolve it before rerunning`);
    return;
  }
  const stage = mkdtempSync(join(dest, '.tabularius-migrate-'));
  try {
    const part = join(stage, basename(to));
    const before = fileTree(from);
    cpSync(from, part, { recursive: true, errorOnExist: true, force: false });
    const after = fileTree(from);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(after) !== JSON.stringify(fileTree(part))) {
      throw new FmsMigrationError(`${basename(from)} container files changed while being copied; rerun after stopping writes to the source`);
    }
    mkdirSync(join(to, '..'), { recursive: true });
    if (!existsSync(to)) renameSync(part, to);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

// Reading the Admin API ------------------------------------------------------

function call(base: URL, method: string, path: string, headers: Record<string, string>, insecure: boolean): Promise<{ status: number; body: any; text: string }> {
  return new Promise((done, fail) => {
    const url = new URL(`/fmi/admin/api/v2${path}`, base);
    // The socket's lookup is not asked about an address written out (http://169.254.169.254): checked here.
    const refused = hostRefusal({ private: true }, url.hostname);
    if (refused) return fail(new Error(refused));
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, headers: { 'content-type': 'application/json', 'content-length': '0', ...headers },
      agent: false, lookup: FMS_LOOKUP, ...(insecure ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        done({ status: res.statusCode ?? 0, body, text });
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error(`${url.host} didn't answer`)));
    req.on('error', fail);
    req.end();
  });
}

/**
 * Reads a FileMaker Server's setup through its Admin API, signing in as its
 * Admin Console account. `insecure` accepts the self-signed certificate a new
 * FileMaker Server has. Calls the server can't answer are left out.
 */
export async function fetchFmsExport(server: string, user: string, password: string, insecure = false): Promise<FmsExport> {
  const base = new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`);
  const auth = await call(base, 'POST', '/user/auth', { authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') }, insecure);
  const token = auth.body?.response?.token as string | undefined;
  if (!token) {
    const m = auth.body?.messages?.[0];
    throw new FmsMigrationError(`couldn't sign in to ${base.host}: ${m ? `${m.text} (${m.code})` : `HTTP ${auth.status}`}`);
  }
  const bearer = { authorization: `Bearer ${token}` };
  const get = async (path: string) => {
    const r = await call(base, 'GET', path, bearer, insecure);
    return r.body?.messages?.[0]?.code === '0' ? r.body.response as Record<string, any> : undefined;
  };
  const requiredList = async (path: string, key: 'databases' | 'schedules'): Promise<any[]> => {
    const r = await call(base, 'GET', path, bearer, insecure);
    if (r.body?.messages?.[0]?.code !== '0' || !Array.isArray(r.body?.response?.[key])) {
      throw new FmsMigrationError(`couldn't read ${key} from ${base.host}: HTTP ${r.status}; the live export is incomplete`);
    }
    return r.body.response[key];
  };
  try {
    const out: FmsExport = {};
    const metadata = await get('/server/metadata');
    if (metadata) out.metadata = metadata;
    const general = await get('/server/config/general');
    if (general) out.general = general;
    const security = await get('/server/config/security');
    if (security) out.security = security;
    out.databases = await requiredList('/databases', 'databases');
    out.schedules = await requiredList('/schedules', 'schedules');
    return out;
  } finally {
    await call(base, 'DELETE', `/user/auth/${encodeURIComponent(token)}`, bearer, insecure).catch(() => {});
  }
}

// Files ------------------------------------------------------------------------

/** A FileMaker path (filemac:/Macintosh HD/Library/..., filewin:/C:/..., filelinux:/opt/...) as a path on this machine. */
export function nativePath(fmPath: string): string {
  const m = /^file(mac|win|linux)?:\/?(.*)$/i.exec(fmPath);
  if (!m) return fmPath;
  const rest = m[2];
  if (m[1]?.toLowerCase() === 'mac') return '/' + rest.split('/').slice(1).join('/'); // drop the volume name
  if (m[1]?.toLowerCase() === 'win') return rest.replace(/\//g, '\\');
  return '/' + rest.replace(/^\/+/, '');
}

/** Where a hosted file is on disk: under the FileMaker Server folder's Data/Databases when given, else at its own path. */
function sourceOf(db: FmsDatabase, fmsDir?: string): string | undefined {
  const folder = db.folder ? nativePath(db.folder) : '';
  const tries: string[] = [];
  if (fmsDir) {
    // The part after Data/Databases is the same wherever the server ran.
    const under = /[\\/]Data[\\/]Databases[\\/](.*)$/i.exec(folder)?.[1] ?? '';
    tries.push(join(fmsDir, 'Data', 'Databases', ...under.split(/[\\/]/).filter(Boolean), db.filename));
  }
  if (folder) tries.push(join(folder, db.filename));
  return tries.find((p) => existsSync(p));
}

/** Every .fmp12 under the FileMaker Server folder's Data/Databases. */
function databasesOnDisk(fmsDir: string): FmsDatabase[] {
  const root = join(fmsDir, 'Data', 'Databases');
  const out: FmsDatabase[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== 'RC_Data_FMS') walk(join(dir, e.name));
      } else if (extname(e.name).toLowerCase() === '.fmp12') {
        out.push({ filename: e.name, folder: 'filelinux:' + dir.split(sep).join('/') + '/' });
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

// Schedules -------------------------------------------------------------------

const TASKS = ['backupType', 'filemakerScriptType', 'messageType', 'scriptSequenceType', 'systemScriptType', 'verifyType'] as const;

function timing(s: FmsSchedule): { everyMinutes: number; at?: string; note?: string; partial?: boolean } | { skip: string } {
  const every = s.everyndaysType as Record<string, any> | undefined;
  const weekly = s.weeklyType as Record<string, any> | undefined;
  if (s.onceType) return { skip: 'runs once in FileMaker Server; Tabularius schedules repeat' };
  const t = every ?? weekly;
  if (!t) return { skip: 'has no timing Tabularius knows' };
  const at = /T(\d\d:\d\d)/.exec(String(t.startTimeStamp ?? ''))?.[1];
  const notes: string[] = [];
  let partial = false;
  let days = 1;
  if (every) days = Math.max(1, Math.floor(Number(every.dailyDays ?? 1)) || 1);
  else {
    const week = new Set((Array.isArray(weekly!.daysOfTheWeek) ? weekly!.daysOfTheWeek : []).map((d: unknown) => String(d).toUpperCase()));
    if (week.size < 7) {
      partial = true;
      notes.push(`runs on ${[...week].join(', ') || 'no days'} in FileMaker Server; Tabularius runs it every day, so it's imported turned off`);
    }
  }
  let everyMinutes = days * 1440;
  const repeat = t.repeatTask as Record<string, any> | undefined;
  if (repeat) {
    const n = Math.floor(Number(repeat.repeatFrequency));
    const unit = String(repeat.repeatInterval ?? 'HOURS').toUpperCase();
    if (n >= 1 && (unit === 'HOURS' || unit === 'MINUTES')) {
      everyMinutes = unit === 'HOURS' ? n * 60 : n;
      if (repeat.endTime && !/^23:5\d/.test(String(repeat.endTime))) notes.push(`repeats until ${repeat.endTime} in FileMaker Server; Tabularius repeats around the clock`);
      if (days > 1) notes.push(`runs every ${days} days in FileMaker Server; Tabularius repeats it every day`);
    }
  }
  if (t.endDate) notes.push(`ends on ${t.endDate} in FileMaker Server; Tabularius keeps running it until turned off`);
  return { everyMinutes, ...(at ? { at } : {}), ...(notes.length ? { note: notes.join('; ') } : {}), partial };
}

/** "1d", "6h", "30m": an interval `serve --backup-every` takes. */
function interval(minutes: number): string {
  return minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

// The migration ----------------------------------------------------------------

/**
 * Brings a FileMaker Server's setup into `dest`, a Tabularius folder (made if
 * missing). A file already in the folder (its container files with it), and
 * schedules with a name already used, are left as they are, so running it
 * again only adds files and schedules that are new.
 */
export function migrateFms(exp: FmsExport, dest: string, opts: MigrateOptions = {}): MigrationReport {
  if (opts.dryRun) return migrateFmsClaimed(exp, dest, opts);
  mkdirSync(dest, { recursive: true });
  const release = claimFolder(dest, 'restore');
  try { return migrateFmsClaimed(exp, dest, opts); }
  finally { release(); }
}

function migrateFmsClaimed(exp: FmsExport, dest: string, opts: MigrateOptions): MigrationReport {
  const report: MigrationReport = { files: [], schedules: [], settings: {}, notes: [] };
  const write = !opts.dryRun;
  if (write) mkdirSync(dest, { recursive: true });

  // Hosted files.
  const databases = exp.databases ?? (opts.fmsDir ? databasesOnDisk(opts.fmsDir) : []);
  const started = Date.now();
  const progress = () => {
    const completed = report.files.length;
    const elapsedMs = Date.now() - started;
    opts.onProgress?.({ completed, total: databases.length, elapsedMs,
      etaMs: completed && completed < databases.length ? Math.ceil(elapsedMs / completed * (databases.length - completed)) : completed === databases.length ? 0 : null });
  };
  if (!exp.databases && !opts.fmsDir) report.notes.push('No hosted file list: give the FileMaker Server folder (--fms-dir) or its Admin API (--from).');
  const taken = new Set<string>();
  for (const db of databases) {
    if (basename(db.filename) !== db.filename || /[\\\0:]/.test(db.filename) || !/\.fmp12$/i.test(db.filename)) {
      throw new FmsMigrationError(`invalid hosted filename: ${db.filename}`);
    }
    const name = basename(db.filename, extname(db.filename));
    const entry: MigrationReport['files'][number] = { name, done: false };
    report.files.push(entry);
    if (taken.has(name.toLowerCase())) {
      entry.note = `another hosted file is also named ${db.filename}; Tabularius hosts one file per name, so this one is left out`;
      progress();
      continue;
    }
    taken.add(name.toLowerCase());
    const from = sourceOf(db, opts.fmsDir);
    if (!from) {
      entry.note = `not found${opts.fmsDir ? ` under ${join(opts.fmsDir, 'Data', 'Databases')}` : ''}; copy ${db.filename} into ${dest} yourself`;
      progress();
      continue;
    }
    entry.from = from;
    const to = join(dest, db.filename);
    if (existsSync(to) || existsSync(join(dest, name + '.sqlite')) || existsSync(join(dest, name + '.openhbam.sqlite'))) {
      if (existsSync(to) && checksum(from) !== checksum(to)) throw new FmsMigrationError(`${db.filename} differs from the source; resolve it before rerunning`);
      entry.note = 'already in the folder';
      entry.done = true;
      continue;
    }
    const notes: string[] = [];
    if (db.isEncrypted) notes.push('encrypted with FileMaker\'s encryption at rest, which Tabularius can\'t read yet');
    // Externally stored container data sits next to the file; it comes along so nothing is lost.
    const external = join(from, '..', 'RC_Data_FMS', name);
    if (existsSync(external)) {
      notes.push('its externally stored container files were copied to RC_Data_FMS (secure storage isn\'t read yet)');
    }
    if (write) {
      migrateFile(dest, from, to, external, join(dest, 'RC_Data_FMS', name));
    }
    entry.done = true;
    if (notes.length) entry.note = notes.join('; ');
    progress();
  }

  // Schedules.
  const schedulesPath = join(dest, SCHEDULES_FILE);
  let kept: Schedule[] = [];
  if (existsSync(schedulesPath)) kept = (readJsonStateSync<{ schedules?: Schedule[] }>(schedulesPath).schedules ?? []);
  const names = new Set(kept.map((s) => s.name));
  const added: Schedule[] = [];
  const backups: { minutes: number; keep: number; target?: string; name: string }[] = [];
  for (const s of exp.schedules ?? []) {
    const name = String(s.name ?? '').trim() || 'Schedule';
    const task = TASKS.find((k) => s[k] !== undefined);
    const entry: MigrationReport['schedules'][number] = { name, done: false };
    report.schedules.push(entry);
    const mail = Array.isArray(s.sendEmail) && s.sendEmail.length ? 'it emailed when done in FileMaker Server; Tabularius schedules send no mail' : undefined;
    const when = timing(s);
    if (task === 'filemakerScriptType') {
      if ('skip' in when) {
        entry.note = when.skip;
        continue;
      }
      const t = s.filemakerScriptType as Record<string, any>;
      const file = /^file:(.+?)(?:\.fmp12)?$/i.exec(String(t.resource ?? ''))?.[1];
      if (!file) {
        entry.note = `runs on ${t.resource || 'no file'}; Tabularius script schedules run on one file`;
        continue;
      }
      if (names.has(name)) {
        entry.note = 'a schedule with this name is already there';
        entry.done = true;
        continue;
      }
      names.add(name);
      const account = String(t.fmScriptAccount ?? '').trim();
      added.push({
        id: randomBytes(6).toString('hex'), name, database: file, script: String(t.fmScriptName ?? ''),
        ...(t.fmScriptParam ? { parameter: String(t.fmScriptParam) } : {}),
        account: account || 'Admin', everyMinutes: when.everyMinutes, ...(when.at ? { at: when.at } : {}),
        enabled: s.enabled === true && !when.partial,
      });
      entry.done = true;
      const notes = [when.note, account ? undefined : 'had no account; runs as Admin', mail, t.timeout ? `its ${t.timeout}-minute time limit isn't carried over` : undefined].filter(Boolean);
      if (notes.length) entry.note = notes.join('; ');
    } else if (task === 'backupType') {
      if ('skip' in when) {
        entry.note = when.skip;
        continue;
      }
      const b = s.backupType as Record<string, any>;
      if (b.resourceType && b.resourceType !== 'ALL_DB') {
        entry.note = 'backs up some files only; Tabularius backs up every hosted file, on the schedule of the main backup';
        continue;
      }
      if (s.enabled === false) {
        entry.note = 'turned off in FileMaker Server';
        continue;
      }
      backups.push({ minutes: when.everyMinutes, keep: Math.max(1, Number(b.maxBackups) || 7), target: b.backupTarget ? nativePath(String(b.backupTarget)) : undefined, name });
      entry.done = true;
      entry.note = [when.note, mail].filter(Boolean).join('; ') || undefined;
    } else if (task === 'verifyType') {
      entry.note = 'Tabularius checks every backup set with `tabularius verify-backup`, which you can run on a timer';
    } else if (task === 'messageType') {
      entry.note = 'sends a message to FileMaker clients; Tabularius has no such schedule';
    } else if (task === 'systemScriptType' || task === 'scriptSequenceType') {
      entry.note = 'runs programs on the server; Tabularius never brings these over: set them up with cron or Task Scheduler if still needed';
    } else entry.note = 'of a kind Tabularius doesn\'t know';
  }
  if (added.length && write) {
    updateJsonStateSync<{ schedules?: Schedule[] }>(schedulesPath, { schedules: [] }, (current) => {
      const schedules = [...(current.schedules ?? [])];
      const seen = new Set(schedules.map((schedule) => schedule.name.toLowerCase()));
      schedules.push(...added.filter((schedule) => !seen.has(schedule.name.toLowerCase())));
      return { ...current, schedules };
    }, { mode: 0o600 });
  }

  // Backups: Tabularius keeps one backup schedule, so the most frequent one wins.
  if (backups.length) {
    backups.sort((a, b) => a.minutes - b.minutes);
    const main = backups[0];
    report.settings.backupEvery = interval(main.minutes);
    report.settings.keep = main.keep;
    if (main.target && existsSync(main.target)) report.settings.backupDir = main.target;
    else if (main.target) report.notes.push(`Backups went to ${main.target} in FileMaker Server, which isn't on this machine; Tabularius backs up to ${join(dest, 'Backups')}.`);
    for (const other of backups.slice(1)) {
      const e = report.schedules.find((x) => x.name === other.name)!;
      e.done = false;
      e.note = `Tabularius keeps one backup schedule; "${main.name}" (every ${interval(main.minutes)}) is the one used`;
    }
  }

  // The SSL certificate FileMaker Server was given (server.pem is its own self-signed one).
  if (opts.fmsDir) {
    const cstore = join(opts.fmsDir, 'CStore');
    const certFile = join(cstore, 'serverCustom.pem');
    const keyFile = join(cstore, 'serverKey.pem');
    if (existsSync(certFile)) {
      const pem = readFileSync(certFile, 'utf8');
      const cert = new X509Certificate(pem);
      const cr: NonNullable<MigrationReport['certificate']> = { subject: cert.subject.replace(/\n/g, ', '), validTo: new Date(cert.validTo).toISOString(), done: false };
      report.certificate = cr;
      if (new Date(cert.validTo).getTime() < Date.now()) cr.note = 'it has expired; serve with --https for a free one, or give a new one with --tls-cert and --tls-key';
      else if (!existsSync(keyFile)) cr.note = 'its private key, CStore/serverKey.pem, isn\'t there';
      else {
        let key: ReturnType<typeof createPrivateKey> | undefined;
        try {
          key = createPrivateKey({ key: readFileSync(keyFile, 'utf8'), ...(opts.keyPassphrase ? { passphrase: opts.keyPassphrase } : {}) });
        } catch {
          cr.note = opts.keyPassphrase
            ? 'its private key didn\'t open with that passphrase'
            : 'its private key is encrypted: give the passphrase it was imported with in TABULARIUS_FMS_KEY_PASSPHRASE';
        }
        if (key && !cert.checkPrivateKey(key)) {
          cr.note = 'CStore/serverKey.pem isn\'t the key of this certificate';
          key = undefined;
        }
        if (key) {
          if (write) {
            mkdirSync(join(dest, 'tls'), { recursive: true, mode: 0o700 });
            writeFileSync(join(dest, 'tls', 'cert.pem'), pem);
            // Kept unencrypted for the server to read at start, like --tls-key; readable by its owner only.
            writeFileSync(join(dest, 'tls', 'key.pem'), key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
          }
          report.settings.tlsCert = join('tls', 'cert.pem');
          report.settings.tlsKey = join('tls', 'key.pem');
          cr.done = true;
        }
      }
    }
  }

  // Server settings with no counterpart, so the admin knows they were seen.
  const g = exp.general ?? {};
  if (g.maxFiles !== undefined || g.maxProConnections !== undefined) report.notes.push('FileMaker Server\'s limits on files and connections don\'t apply: Tabularius has none.');
  if (exp.security?.requireSecureDB === true) report.notes.push('FileMaker Server required every file to have a password: Tabularius lets accounts without one sign in from the server itself only (see --allow-blank-passwords).');

  if (write && Object.keys(report.settings).length) {
    const f = join(dest, SETTINGS_FILE);
    updateJsonStateSync<FolderSettings>(f, {}, (before) => {
      const stored: FolderSettings = { ...before, ...report.settings };
      if (stored.backupDir) stored.backupDir = relative(dest, stored.backupDir) || '.';
      return stored;
    }, { mode: 0o600 });
  }
  return report;
}

/** The report as lines for a person. */
export function describeMigration(r: MigrationReport, dest: string, dryRun = false): string[] {
  const out: string[] = [];
  const mark = (done: boolean) => (done ? (dryRun ? 'would bring' : 'brought') : 'left out');
  out.push(`Files (${r.files.filter((f) => f.done).length} of ${r.files.length}):`);
  for (const f of r.files) out.push(`  ${mark(f.done)}: ${f.name}${f.note ? ` (${f.note})` : ''}`);
  out.push(`Schedules (${r.schedules.filter((s) => s.done).length} of ${r.schedules.length}):`);
  for (const s of r.schedules) out.push(`  ${mark(s.done)}: ${s.name}${s.note ? ` (${s.note})` : ''}`);
  if (r.certificate) out.push(`Certificate: ${mark(r.certificate.done)}: ${r.certificate.subject}, valid to ${r.certificate.validTo.slice(0, 10)}${r.certificate.note ? ` (${r.certificate.note})` : ''}`);
  const s = r.settings;
  if (s.backupEvery) out.push(`Backups: every ${s.backupEvery}, keeping ${s.keep}${s.backupDir ? `, to ${s.backupDir}` : ''}`);
  for (const n of r.notes) out.push(n);
  if (!dryRun) out.push(`Next: tabularius serve ${dest}${s.tlsCert ? ' --port 443 --host 0.0.0.0' : ''}  (each file is converted the first time it's served)`);
  return out;
}

/** Size of the files a migration copies, for the dry run. */
export function copySize(r: MigrationReport): number {
  return r.files.reduce((n, f) => n + (f.done && f.from ? statSync(f.from).size : 0), 0);
}

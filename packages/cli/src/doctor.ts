// `tabularius doctor <folder> [--port 8080] [--url https://...]`: the usual reasons a server won't start or can't be
// reached, checked one by one, each with the one thing to do about it. Reads and probes only: nothing is changed.

import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statfsSync, statSync } from 'node:fs';
import type { StatsFs } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { accountsSharingLockout, STORE_FORMAT } from '../../store/src/index.ts';
import { encryptedUnchecked, filesNewerThan, hostedFiles } from './newer-files.ts';
import { pageCheck, type PageCheck } from '../../server/src/backup-verify.ts';
import { backupSets, defaultBackupDir, EMBED_PRESETS, probeEmbedding, readSettings, resolveEmbedEndpoint } from '../../server/src/index.ts';
import { checkHealth, healthUrl, installed, portFree } from './service.ts';
import { minimumNode, nodeSupports } from './node-version.cjs';

export type Level = 'ok' | 'warn' | 'problem';
export interface Check { name: string; level: Level; message: string; fix?: string }

const MIN_FREE_BYTES = 1024 ** 3;
const CERT_WARN_DAYS = 14;

interface StorageOptions {
  path?: string;
  statfs?: (folder: string) => Pick<StatsFs, 'type' | 'bavail' | 'bsize'>;
}

/** A conservative free-space budget: the current footprint, a full WAL and another backup run. */
export function diskCheck(free: number, hosted: number, backups: number): Check {
  const needed = Math.max(MIN_FREE_BYTES, hosted * 3 + backups);
  const budget = `${(needed / 1024 ** 3).toFixed(1)} GB recommended for hosted files, backups, the write-ahead log and a backup run`;
  return free >= needed
    ? { name: 'Disk', level: 'ok', message: `${(free / 1024 ** 3).toFixed(1)} GB free; ${budget}` }
    : { name: 'Disk', level: 'problem', message: `only ${(free / 1024 ** 2).toFixed(0)} MB free where the files are; ${budget}`, fix: 'Free some space; backups and the write-ahead log need room to grow.' };
}

/** Recognizable sync folders and network mounts; an unrecognized path is not proof of local storage. */
export function locationCheck(path: string, type?: number): Check | undefined {
  const p = path.replace(/\\/g, '/');
  const synced = /(?:^|\/)(?:Dropbox(?: \([^/]+\))?|OneDrive(?:[ -][^/]+)?|iCloud ?Drive|com~apple~CloudDocs|Google Drive|GoogleDrive(?:-[^/]+)?)(?:\/|$)/i.test(p);
  // Linux statfs magic: NFS, SMB, CIFS, SMB2, AFS, Coda, Ceph and 9P.
  const network = /^\/\/(?![?.]\/)(?:[^/]+)\/[^/]+/.test(p) || /^\/\/\?\/UNC\//i.test(p)
    || [0x6969, 0x517b, 0xff534d42, 0xfe534d42, 0x5346414f, 0x6b414653, 0x73757245, 0x00c36400, 0x01021997].includes(Number(type) >>> 0);
  if (!synced && !network) return undefined;
  return {
    name: 'Storage', level: 'warn', message: `${path} appears to be ${synced ? 'inside a synced folder' : 'on a network share'}; SQLite's write-ahead log is unsafe there`,
    fix: 'Keep the data folder on a local disk outside Dropbox, OneDrive, iCloud Drive and Google Drive. Copy completed backups elsewhere instead.',
  };
}

// Metadata only. Do not follow directory symlinks (including loops) while sizing backup trees.
function treeBytes(folder: string): number {
  if (!existsSync(folder)) return 0;
  return readdirSync(folder, { withFileTypes: true }).reduce((bytes, e) => {
    const path = join(folder, e.name);
    return bytes + (e.isDirectory() ? treeBytes(path) : e.isFile() ? statSync(path).size : 0);
  }, 0);
}

export function storageChecks(folder: string, opts: StorageOptions = {}): Check[] {
  let path = opts.path ?? folder;
  if (opts.path === undefined) {
    try { path = realpathSync(folder); } catch { /* use the supplied path */ }
  }
  const out: Check[] = [];
  let s: Pick<StatsFs, 'type' | 'bavail' | 'bsize'> | undefined;
  try { s = (opts.statfs ?? statfsSync)(folder); } catch {
    out.push({ name: 'Disk', level: 'warn', message: 'free disk space could not be checked', fix: 'Check free space on the disk holding the data folder.' });
  }
  const location = locationCheck(path, s?.type) ?? locationCheck(folder, s?.type);
  if (location) out.push(location);
  if (s) {
    try {
      let hosted = 0;
      for (const name of readdirSync(folder)) {
        if (/\.(fmp12|openhbam\.sqlite(?:\.enc|-wal)?)$/i.test(name)) {
          const st = statSync(join(folder, name));
          if (st.isFile()) hosted += st.size;
        }
      }
      for (const dir of ['RC_Data_FMS', 'Files']) hosted += treeBytes(join(folder, dir));
      let dir = defaultBackupDir(folder);
      try { dir = readSettings(folder).backupDir ?? dir; } catch { /* the settings check says so */ }
      out.push(diskCheck(Number(s.bavail) * Number(s.bsize), hosted, treeBytes(dir)));
    } catch {
      out.push({ name: 'Disk', level: 'warn', message: 'hosted files or backups could not be sized', fix: 'Check read permissions on the data and backup folders, then run doctor again.' });
    }
  }
  return out;
}

/**
 * Reads every hosted file's pages with SQLite's check and names the ones that are damaged. `full` runs the slower complete
 * check (it also compares each index with its table); the default quick check finds a bad page or a truncated file.
 * Neither changes anything, and both can run while the server is up. A byte changed inside a record cannot be found:
 * SQLite does not checksum its pages, which is what backup checksums and `verify-backup` are for.
 */
export function fileChecks(folder: string, opts: { full?: boolean } = {}): Check[] {
  let names: string[];
  names = hostedFiles(folder).plain;
  const out: Check[] = [];
  let sound = 0;
  for (const name of names) {
    const path = join(folder, name);
    const shown = name.replace(/\.openhbam\.sqlite$/i, '');
    let result: PageCheck;
    try {
      result = statSync(path).size === 0 ? { state: 'damaged', detail: 'the file is empty (0 bytes)' } : pageCheck(path, !opts.full);
    } catch (e) { result = { state: 'unreadable', detail: (e as Error).message }; }
    if (result.state === 'ok') { sound++; continue; }
    // Not being able to read it (no permission, another process busy with it) says nothing about its pages.
    if (result.state === 'unreadable') {
      out.push({ name: 'File check', level: 'warn', message: `${shown} could not be checked: ${result.detail.replace(/\s+/g, ' ').slice(0, 200)}`, fix: 'Run doctor as the user that runs Tabularius, or again when the server is not busy with it.' });
      continue;
    }
    out.push({
      name: 'Damaged file', level: 'problem', message: `${shown}: ${result.detail.replace(/\s+/g, ' ').slice(0, 200)}`,
      fix: `Stop serving it, then restore it from a backup: tabularius restore ${folder} <backup-set>. tabularius verify-backup ${folder} says which backups are sound.`,
    });
  }
  if (names.length && !out.some((c) => c.level === 'problem' || c.level === 'warn')) out.push({ name: 'Pages', level: 'ok', message: `${sound} ${sound === 1 ? 'file reads' : 'files read'} cleanly (${opts.full ? 'full' : 'quick'} check)` });
  return out;
}

/**
 * Accounts whose names fold to one lockout bucket (Straße and Strasse, an accent written two ways): failed sign-ins on one
 * count against the other, and a correct sign-in on one clears the other's count. New accounts like that are refused;
 * a file made before that can still hold a pair. Reads each file read-only; one that can't be read says nothing here.
 */
export function accountChecks(folder: string): Check[] {
  let names: string[];
  names = hostedFiles(folder).plain;
  const out: Check[] = [];
  for (const name of names) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(folder, name), { readOnly: true });
      db.exec('PRAGMA busy_timeout = 2000');
      const rows = db.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[];
      for (const g of accountsSharingLockout(rows.map((r) => r.name))) {
        out.push({
          name: 'Accounts', level: 'warn',
          message: `${name.replace(/\.openhbam\.sqlite$/i, '')}: ${g.map((n) => `"${n}"`).join(' and ')} share one sign-in lockout`,
          fix: 'Failed sign-ins on one count against the other. Rename or delete one of them in the admin console.',
        });
      }
    } catch { /* damage and unreadable files are the file check's to report */ } finally {
      try { db?.close(); } catch { /* nothing more to do */ }
    }
  }
  return out;
}

/**
 * Files written by a newer Tabularius than this one: this build refuses them (it would not know what the newer one added),
 * so the server leaves them out. Reads each file read-only; one that can't be read says nothing here.
 */
export function formatChecks(folder: string): Check[] {
  const skipped = encryptedUnchecked(folder);
  const note: Check[] = skipped.length ? [{
    name: 'Encrypted files', level: 'warn',
    message: `${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} encrypted, so ${skipped.length === 1 ? 'its' : 'their'} file format and pages were not checked`,
    fix: 'Run doctor again with TABULARIUS_ENCRYPTION_KEY set to the passphrase.',
  }] : [];
  return [...note, ...filesNewerThan(folder, STORE_FORMAT).map((f) => ({
    name: 'Newer file', level: 'problem' as const,
    message: `${f.name} was written by a newer Tabularius (${f.found === 'unreadable' ? 'a file format number this version cannot read' : `file format ${f.found}`}; this version reads up to format ${STORE_FORMAT}), so this version does not open it`,
    fix: 'Update Tabularius (tabularius upgrade) to open it, or put back a backup made before the newer version first opened it: tabularius restore <folder> <backup-set>.',
  }))];
}

/** The runtime required by package.json. */
export function nodeCheck(version = process.versions.node): Check {
  const ok = nodeSupports(version);
  return ok
    ? { name: 'Node', level: 'ok', message: `Node ${version}` }
    : { name: 'Node', level: 'problem', message: `Node ${version} is too old`, fix: `Install Node ${minimumNode} or newer (https://nodejs.org).` };
}

function folderChecks(folder: string, storage?: StorageOptions): Check[] {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return [{ name: 'Folder', level: 'problem', message: `${folder} doesn't exist`, fix: `Make the folder, or give the folder your files are in.` }];
  }
  const out: Check[] = [];
  try {
    accessSync(folder, constants.R_OK | constants.W_OK);
    out.push({ name: 'Folder', level: 'ok', message: `${folder} can be read and written` });
  } catch {
    out.push({ name: 'Folder', level: 'problem', message: `${folder} can't be read and written by this user`, fix: `Give this user permission to the folder (on macOS and Linux: chown or chmod; on Windows: Properties, Security).` });
  }
  let files = 0;
  try { files = readdirSync(folder).filter((n) => /\.(fmp12|openhbam\.sqlite(\.enc)?)$/i.test(n)).length; } catch { /* reported above */ }
  out.push(files
    ? { name: 'Files', level: 'ok', message: `${files} ${files === 1 ? 'file' : 'files'} to host` }
    : { name: 'Files', level: 'warn', message: 'no .fmp12 or hosted files in the folder', fix: 'Copy a FileMaker file into the folder, or run: tabularius new <folder> <name>' });
  out.push(...storageChecks(folder, storage));
  return out;
}

/** The certificate the folder's settings name: found, readable, and not about to run out. */
export function certificateCheck(folder: string, now = new Date()): Check | undefined {
  let cert: string | undefined;
  try { cert = readSettings(folder).tlsCert; } catch (e) {
    return { name: 'Settings', level: 'problem', message: `.openhbam-settings.json can't be read (${(e as Error).message})`, fix: 'Fix the JSON in that file, or delete it to go back to the defaults.' };
  }
  if (!cert) return undefined;
  if (!existsSync(cert)) return { name: 'Certificate', level: 'problem', message: `${cert} doesn't exist`, fix: 'Put the certificate there, or remove tlsCert and tlsKey from .openhbam-settings.json.' };
  try {
    const x = new X509Certificate(readFileSync(cert));
    const days = Math.floor((new Date(x.validTo).getTime() - now.getTime()) / 86_400_000);
    if (days < 0) return { name: 'Certificate', level: 'problem', message: `expired ${-days} days ago (${x.validTo})`, fix: 'Renew it. With --https the server renews its own.' };
    if (days < CERT_WARN_DAYS) return { name: 'Certificate', level: 'warn', message: `runs out in ${days} days (${x.validTo})`, fix: 'Renew it before then.' };
    return { name: 'Certificate', level: 'ok', message: `valid until ${x.validTo}` };
  } catch {
    return { name: 'Certificate', level: 'problem', message: `${cert} isn't a certificate this program can read`, fix: 'It should be a PEM file.' };
  }
}

/** Backups: the folder is there and the newest set is not old. */
export function backupCheck(folder: string, now = new Date()): Check {
  let dir = defaultBackupDir(folder);
  try { dir = readSettings(folder).backupDir ?? dir; } catch { /* the settings check says so */ }
  if (!existsSync(dir)) return { name: 'Backups', level: 'warn', message: `no backup folder yet (${dir})`, fix: `Run: tabularius backup ${folder}   (or serve with --backup-every 1d)` };
  const sets = backupSets(dir);
  if (!sets.length) return { name: 'Backups', level: 'warn', message: `${dir} has no backups`, fix: `Run: tabularius backup ${folder}` };
  const newest = statSync(join(dir, sets[sets.length - 1])).mtime;
  const days = Math.floor((now.getTime() - newest.getTime()) / 86_400_000);
  // Made while this computer's clock was ahead (or it has since been set back): the age would read as negative.
  if (newest.getTime() > now.getTime() + 3_600_000) {
    const ahead = Math.ceil((newest.getTime() - now.getTime()) / 86_400_000);
    return { name: 'Backups', level: 'warn', message: `the newest of ${sets.length} (${sets[sets.length - 1]}) was made ${ahead} ${ahead === 1 ? 'day' : 'days'} from now by this computer's clock`, fix: `The clock was wrong when it was made, or is wrong now. Set the clock right, then run: tabularius backup ${folder}` };
  }
  return days > 7
    ? { name: 'Backups', level: 'warn', message: `the newest of ${sets.length} is ${days} days old`, fix: 'Schedule them: serve with --backup-every 1d' }
    : { name: 'Backups', level: 'ok', message: `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}, the newest ${days === 0 ? 'today' : `${days} days old`}` };
}

/**
 * The embedding model scripts use (Insert Embedding, RAG, Perform Semantic Find), when one is set by --ai-embed-url and
 * --ai-embed-model or the TABULARIUS_AI_EMBED_* variables: asked for the vector of one word. Nothing is checked when none is set.
 */
export async function embedCheck(url?: string, model?: string, env: NodeJS.ProcessEnv = process.env): Promise<Check | undefined> {
  const u = url ?? env.TABULARIUS_AI_EMBED_URL;
  const m = model ?? env.TABULARIUS_AI_EMBED_MODEL;
  let endpoint;
  try { endpoint = resolveEmbedEndpoint(u, m, env.TABULARIUS_AI_EMBED_KEY); } catch (e) {
    return { name: 'Embeddings', level: 'problem', message: (e as Error).message.replace(/^serve: /, ''), fix: 'Give --ai-embed-url ollama (or lmstudio), or an OpenAI-compatible URL and --ai-embed-model.' };
  }
  if (!endpoint) return undefined;
  const preset = Object.values(EMBED_PRESETS).find((p) => p.url === endpoint.url);
  try {
    const r = await probeEmbedding(endpoint);
    return { name: 'Embeddings', level: 'ok', message: `${endpoint.model} at ${endpoint.url} gives ${r.dimensions}-number vectors (${r.ms} ms)` };
  } catch (e) {
    const unreachable = /can't reach|no answer/.test((e as Error).message);
    return {
      name: 'Embeddings', level: 'problem', message: (e as Error).message,
      fix: unreachable
        ? `Start ${preset?.name ?? 'the embedding server'}${preset ? ` (${preset.start})` : ''}, or check the address ${endpoint.url}.`
        : `Check that ${endpoint.model} is an embedding model the server has${preset ? ` (${preset.start})` : ''}.`,
    };
  }
}

export async function runDoctor(folder: string, opts: { full?: boolean; port?: number; url?: string; home?: string; embedUrl?: string; embedModel?: string; storage?: StorageOptions } = {}): Promise<Check[]> {
  const checks: Check[] = [nodeCheck(), ...folderChecks(folder, opts.storage)];
  if (existsSync(folder)) {
    const cert = certificateCheck(folder);
    if (cert) checks.push(cert);
    checks.push(backupCheck(folder));
    checks.push(...fileChecks(folder, { full: opts.full }));
    checks.push(...accountChecks(folder));
    checks.push(...formatChecks(folder));
  }
  const svc = installed(opts.home);
  const port = opts.port ?? svc?.port ?? 8080;
  if (svc) {
    const up = await checkHealth(healthUrl(svc));
    checks.push(up
      ? { name: 'Service', level: 'ok', message: `installed, answering on port ${svc.port} (up ${Math.round(up.uptimeSeconds)} s)` }
      : { name: 'Service', level: 'problem', message: `installed for ${svc.folder} but nothing answers on port ${svc.port}`, fix: `Start it (macOS: launchctl kickstart; Linux: systemctl --user start Tabularius; Windows: Task Scheduler), or look at its log. To start over: tabularius service uninstall` });
  }
  // The installed service owns its own port; a --port that names another one is still asked about.
  if (!svc || port !== svc.port) {
    if (!(await portFree(port, '127.0.0.1'))) checks.push({ name: 'Port', level: 'warn', message: `port ${port} is in use`, fix: `If that's not Tabularius, serve on another: --port ${port + 1}` });
    else checks.push({ name: 'Port', level: 'ok', message: `port ${port} is free` });
  }
  if (opts.url) {
    const up = await checkHealth(new URL('/tabularius/health', opts.url).toString());
    const refused = up ? await certificateRefusal(opts.url) : undefined;
    checks.push(!up
      ? { name: 'Address', level: 'problem', message: `${opts.url} doesn't answer`, fix: 'Check the server is running, the router or firewall passes the port, and the name points at this machine.' }
      : refused
        ? { name: 'Address', level: refused.level, message: `${opts.url} answers, but a browser would refuse it: ${refused.message}`, fix: refused.fix }
        : { name: 'Address', level: 'ok', message: `${opts.url} answers` });
  }
  const embed = await embedCheck(opts.embedUrl, opts.embedModel);
  if (embed) checks.push(embed);
  return checks;
}

/**
 * Whether a browser would accept the certificate at an https address, asked with the usual checks on (the health
 * probe above ignores them, so a server with a bad certificate still "answers"). Undefined: accepted, or plain http.
 */
export function certificateRefusal(url: string): Promise<{ level: Level; message: string; fix: string } | undefined> {
  if (!/^https:/i.test(url)) return Promise.resolve(undefined);
  const renew = 'Renew it. With --https the server renews its own.';
  return new Promise((done) => {
    const req = httpsRequest(new URL('/tabularius/health', url), { timeout: 3000, agent: false }, (res) => { res.resume(); done(undefined); });
    req.on('error', (e: NodeJS.ErrnoException) => {
      const code = e.code ?? '';
      if (code === 'CERT_HAS_EXPIRED') done({ level: 'problem', message: 'its certificate has expired', fix: renew });
      else if (code === 'CERT_NOT_YET_VALID') done({ level: 'problem', message: "its certificate is not valid yet (the clock on this computer or on the server is wrong)", fix: "Set the clocks right; if they are, the certificate was made for a later date and needs replacing." });
      else if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') done({ level: 'problem', message: `its certificate is for other names (${e.message.replace(/^Hostname\/IP does not match certificate's altnames: /, '')})`, fix: 'Use a certificate that lists the name people type, or have the server get one for it: serve with --https <name>.' });
      else if (/SELF_SIGNED|UNABLE_TO_(VERIFY|GET)/.test(code)) done({ level: 'warn', message: "its certificate was not made by an authority this computer trusts", fix: "If this is --https local, each device trusts it once from /tabularius/tls/. Otherwise use a certificate from a public authority (--https <name> gets one)." });
      else done(undefined); // not a certificate problem; the health probe has already said what it can
    });
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

export function doctorText(checks: Check[]): string {
  const mark = { ok: 'ok     ', warn: 'check  ', problem: 'PROBLEM' } as const;
  const lines = checks.flatMap((c) => [`${mark[c.level]} ${c.name}: ${c.message}`, ...(c.fix && c.level !== 'ok' ? [`        -> ${c.fix}`] : [])]);
  const problems = checks.filter((c) => c.level === 'problem').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  lines.push('', problems ? `${problems} ${problems === 1 ? 'problem' : 'problems'} to fix${warns ? `, ${warns} to look at` : ''}` : warns ? `Nothing is broken; ${warns} to look at` : 'All good');
  if (problems || warns) lines.push('More help: docs/troubleshooting.md');
  return lines.join('\n') + '\n';
}

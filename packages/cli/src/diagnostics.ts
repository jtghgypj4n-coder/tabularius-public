import path from 'node:path';
import { fileURLToPath } from 'node:url';
// `tabularius diagnostics <folder> [--out file.zip|folder] [--include-names] [--full]`: a bundle of facts for a bug report
// that cannot carry what must not be sent. Two layers hold it to that:
//
//   1. It is built from a short list of facts it knows are safe (versions, counts, sizes, a few settings that are
//      numbers or switches, the checks `doctor` makes), never from a record, a script, a setting it has not listed or a
//      file's contents. Everything else about the folder is left out, not filtered out.
//   2. The two kinds of text that can say anything (the tail of the server's log, and error text) go through a scrubber
//      that hides every secret and personal value it can recognize, and every value this install is known to hold
//      (settings and environment values that were not listed as safe). The finished bundle is then checked, by a
//      test that shares none of those rules, for every value this install is known to hold and for the folder's path,
//      and refused if one is there.
//
// Nothing is written until the whole bundle has passed. The folder and the files in it are only read: the conversion
// report is made from a scratch copy of each file's design, never from the file itself.

import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { arch, cpus, hostname, homedir, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zip } from '../../calc/src/zip.ts';
import { isCredentialName } from '../../scripts/src/credentials.ts';
import { pluginStatus } from '../../plugins/src/index.ts';
import { conversionReport, readSettings, runningServer, STORE_EXT } from '../../server/src/index.ts';
import { SERVER_VERSION } from '../../server/src/version.ts';
import { createStore, Store, STORE_FORMAT } from '../../store/src/index.ts';
import { runDoctor, doctorText } from './doctor.ts';
import { installed } from './service.ts';

const REDACTED = '‹redacted›';
/** Lines of each log the bundle keeps. */
export const LOG_LINES = 500;
/** The logs whose lines are kept: the others name accounts and client addresses on every line. */
const LOGS = ['Event', 'ScriptEvent'] as const;

/** Settings-file keys that are a switch or a number, and so say nothing about anyone. */
const SAFE_SETTINGS = new Set(['blockNewUsers', 'sessionIdleMinutes', 'webSessionIdleMinutes', 'responsiveStackBelow', 'scriptPluginInstall']);
/** Environment variables whose values are a number, a duration or a choice, shown with their value; the others by name only. */
const SAFE_ENV = new Set([
  'TABULARIUS_WORKERS', 'TABULARIUS_PROGRESSIVE', 'TABULARIUS_BACKUP_EVERY', 'TABULARIUS_BACKUP_KEEP', 'TABULARIUS_SQL_PORT',
  'TABULARIUS_HTTP_PORT', 'TABULARIUS_STOP_GRACE_MS', 'TABULARIUS_DRAIN_SECONDS', 'TABULARIUS_UPLOAD_IDLE_HOURS', 'TABULARIUS_AI_DAILY_TOKENS', 'TABULARIUS_AI_ACCOUNT_DAILY_TOKENS', 'TABULARIUS_AI_RUN_TOKENS',
  'TABULARIUS_AI_MONTHLY_BUDGET', 'TABULARIUS_TRACE_SQL_MIN_MS', 'TZ', 'LANG',
]);
/** `serve` flags whose values are the same kind of thing. */
const SAFE_FLAGS = new Set(['--port', '--workers', '--progressive', '--backup-every', '--keep', '--stats-interval', '--log-limit', '--sql-port', '--http-port', '--ai-daily-tokens', '--ai-account-daily-tokens', '--ai-run-tokens', '--ai-monthly-budget']);
const SECRET_ENV = /key|token|secret|pass|credential|auth|smtp|cookie|session|bearer|private/i;

const URL_AUTH = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@"'<>]+@/gi;
const EMAIL = /(?<![\w.+%-])[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Longest stretch of one log line that is scrubbed; the rest is cut (a line longer than this is not a message anyone reads). */
const LINE_MAX = 4000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTER = String.raw`\p{L}\p{N}_`;

export interface ScrubberOptions {
  /** The folder being described, shown as <folder>. */
  folder: string;
  /** Where each other absolute path is masked from (the user's home), as the operating system names it. */
  home?: string;
  /** Values this install is known to hold secret: removed wherever they appear. */
  secrets?: Iterable<string>;
  /** Names from the solution (files, accounts, tables, fields, layouts, scripts), each with the label that replaces it. */
  names?: Map<string, string>;
  /** Machine name, hidden. */
  host?: string;
  /** Per-bundle key for address labels, so one address is one label here and nothing links it to another bundle. */
  salt?: Buffer;
}

/**
 * Hides secrets and personal values in text. `patterns` is the layer that needs no knowledge of the solution (secrets,
 * paths, addresses); `text` adds the names from the solution and, for log lines, anything quoted.
 */
export class Scrubber {
  private readonly folder: string;
  private readonly home?: string;
  private readonly host?: string;
  private readonly salt: Buffer;
  private readonly secrets: string[];
  private readonly names: [string, string][];

  constructor(o: ScrubberOptions) {
    this.folder = o.folder;
    this.home = o.home;
    this.host = o.host && o.host.length >= 3 ? o.host : undefined;
    this.salt = o.salt ?? randomBytes(16);
    // Longest first, so a secret that holds another is hidden whole.
    this.secrets = [...new Set([...(o.secrets ?? [])].filter((s) => s.length >= 4))].sort((a, b) => b.length - a.length);
    const names = new Map<string, string>();
    for (const [n, label] of o.names ?? []) {
      if (n.length < 2) continue;
      names.set(n, label);
      // The same name in a web address.
      for (const form of [encodeURIComponent(n), encodeURIComponent(n).replace(/%20/g, '+'), encodeURI(n)]) if (form !== n && !names.has(form)) names.set(form, label);
    }
    this.names = [...names].sort((a, b) => b[0].length - a[0].length);
  }

  private label(kind: string, value: string): string {
    return `${kind}-${createHmac('sha256', this.salt).update(value).digest('hex').slice(0, 6)}`;
  }

  /** Secrets, personal values and paths. Applied until it changes nothing, so applying it again changes nothing. */
  patterns(input: string): string {
    let s = input;
    for (let i = 0; i < 5; i++) {
      const next = this.hide(s);
      if (next === s) break;
      s = next;
    }
    return s;
  }

  private hide(input: string): string {
    let s = input;
    for (const secret of this.secrets) s = s.split(secret).join(REDACTED);
    // The folder and the home folder before anything else, so a long part of either is not taken for a token and left behind.
    for (const [path, label] of [[this.folder, '<folder>'], [this.home, '~']] as const) {
      if (!path) continue;
      s = s.split(path).join(label);
      const escaped = path.replace(/\\/g, '\\\\');
      if (escaped !== path) s = s.split(escaped).join(label);
    }
    // Private keys, whole blocks.
    s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, REDACTED);
    // What a parser quotes of the text it could not read (a settings file with a password in it): never the quote.
    s = s.replace(/(isn't valid JSON:|Unexpected token|is not valid JSON|in JSON at position \d+)[^\r\n]*/gi, '$1 …');
    // Cookies and authorization headers, to the end of the line.
    s = s.replace(/\b((?:Set-)?Cookie|Proxy-Authorization|Authorization)(\s*[:=]\s*)[^\r\n]*/gi, `$1$2${REDACTED}`);
    s = s.replace(/\b(Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`);
    // A user and password in a web address, and the user beside it.
    s = s.replace(URL_AUTH, `$1${REDACTED}@`);
    // Any other web address keeps its host: the path can hold a secret (a webhook) and the query's values can be anything.
    s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/"'<>?]+)\/[^\s"'<>?]*/gi, '$1/…');
    s = s.replace(/([?&](?:token|access_token|code|state|key|sig|signature|secret|api_?key|password|pwd|auth)=)[^&\s"'<>]*/gi, '$1…');
    s = s.replace(/([?&][\w.%-]+=)(?!\d{1,6}(?![\w.-])|true\b|false\b|…)[^&\s"'<>]*/gi, '$1…');
    // name = value and "name": "value" where the name is a password, key or token.
    s = s.replace(/(?<![\w.-])(["']?)([\w.-]+(?:[ \t]+[\w.-]+){0,2})\1(\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&"'}\])]+)/g,
      (m, q: string, name: string, sep: string, value: string) => {
        if (!isCredentialName(name) || value.includes(REDACTED)) return m;
        const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
        return `${q}${name}${q}${sep}${quote}${REDACTED}${quote}`;
      });
    // Tokens by their look: well-known prefixes, JSON web tokens, and any long unbroken run of letters and digits.
    s = s.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED);
    s = s.replace(/\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}\b/g, REDACTED);
    s = s.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,})\b/g, REDACTED);
    s = s.replace(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/g, REDACTED);
    s = s.replace(/(?<![A-Za-z0-9_+=-])[A-Za-z0-9_+=-]{32,}(?![A-Za-z0-9_+=-])/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) && !/address-[0-9a-f]{6}/.test(m) ? REDACTED : m));
    // Session tokens in paths, then paths that name a person.
    s = s.replace(/(\/sessions\/)[^/?\s]+/gi, '$1…');
    // A person's name in a path: /Users/x, /home/x, C:\Users\Jane Doe, \\server\share, ~x.
    s = s.replace(/\/(?:Users|home)\/[^/\s"'<>:;,]+/gi, '/~');
    s = s.replace(/\/~/g, '~');
    s = s.replace(/\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'<>:;,]+(?: [^\\/\s"'<>:;,]+(?=[\\/]))?/gi, '~');
    s = s.replace(/\\\\[\w.$-]+\\[\w.$-]+(?:\\[^\\\s"'<>:;,]+)?/g, '<share>');
    s = s.replace(/(?<![\w~])~(?!\/)[A-Za-z][\w.-]*(?=\/|\\|\s|$)/g, '~');
    if (this.host) s = s.replace(new RegExp(`(?<![${LETTER}-])${escapeRe(this.host)}(?![${LETTER}-])`, 'giu'), '<host>');
    // Numbers written as a national id.
    s = s.replace(/(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, '<number>');
    // Addresses become labels; the two that name no one are kept.
    s = s.replace(EMAIL, '<email>');
    s = s.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\w]|\.\d)/g, (ip) => (ip === '0.0.0.0' || ip === '127.0.0.1' || ip.split('.').some((n) => Number(n) > 255) ? ip : this.label('address', ip)));
    s = s.replace(/(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4}::(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4})(?![\w:])/gi, (ip) => (!/[0-9a-f]/i.test(ip) || ip === '::1' ? ip : this.label('address', ip.toLowerCase())));
    return s;
  }

  /** Names from the solution, then `patterns`. */
  text(input: string): string {
    // Addresses first: a name inside one ("alice@example.com") would otherwise be replaced and leave the domain behind.
    let s = input.replace(URL_AUTH, `$1${REDACTED}@`).replace(EMAIL, '<email>');
    const lower = s.toLowerCase();
    for (const [name, label] of this.names) {
      if (!lower.includes(name.toLowerCase())) continue;
      s = s.replace(new RegExp(`(?<![${LETTER}])${escapeRe(name)}(?![${LETTER}])`, 'giu'), label);
    }
    return this.patterns(s);
  }

  /** A log line: text between quotes can be a value from a record, so it goes too. */
  logLine(line: string): string {
    const unquoted = (line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)} …` : line)
      // A script's own error message can quote the value that was refused; keep the error number and drop the rest.
      .replace(/(\berror -?\d+),[^\r\n]*/gi, '$1, …')
      .replace(/"[^"\r\n]*"/g, '"…"')
      .replace(/“[^”\r\n]*”/g, '“…”')
      .replace(/(?<![\p{L}\p{N}])'[^'\r\n]*'(?![\p{L}\p{N}])/gu, "'…'");
    return this.text(unquoted);
  }
}

/** The design of a hosted file (everything in _fm_meta) in a new scratch store, read without writing to the file. */
function designCopy(path: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-diagnostics-'));
  const target = join(dir, `${name}${STORE_EXT}`);
  let source: DatabaseSync | undefined;
  try {
    createStore(target);
    source = new DatabaseSync(path, { readOnly: true });
    source.exec('PRAGMA busy_timeout = 2000');
    const rows = source.prepare('SELECT key, json FROM _fm_meta').all() as { key: string; json: string }[];
    const db = new DatabaseSync(target);
    try {
      const put = db.prepare('INSERT INTO _fm_meta (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json');
      for (const r of rows) put.run(r.key, r.json);
    } finally {
      db.close();
    }
    return target;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  } finally {
    try { source?.close(); } catch { /* nothing more to do */ }
  }
}

/** The last `count` lines of a file, read from its end so a log of any size costs the same. */
export function tailLines(file: string, count = LOG_LINES): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = statSync(file).size;
    let chunk = 64 * 1024;
    let text = '';
    for (;;) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
      // A cut at the front may split a character or a line; the first line is dropped unless the whole file was read.
      if (start === 0 || text.split('\n').length > count + 2 || chunk >= 64 * 1024 * 1024) {
        const lines = text.split(/\r?\n/);
        if (start > 0) lines.shift();
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        return lines.slice(-count);
      }
      chunk *= 4;
    }
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Strings anywhere in a value. */
function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) stringsIn(x, out);
  return out;
}

/**
 * Strings in a setting that are secrets: anything under a key named like a password, key or token, and any long string
 * that looks like a token. Words such as a level ("Error") are not, and hiding them would eat the log.
 */
function secretStrings(v: unknown, key: string, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (isCredentialName(key) || (v.length >= 12 && /\d/.test(v) && /[A-Za-z]/.test(v) && !/\s/.test(v) && !v.includes('/'))) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) secretStrings(x, key, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) secretStrings(x, isCredentialName(key) ? key : k, out);
  return out;
}

/** Every `name` in a design: tables, fields, layouts, scripts, value lists, accounts. */
function namesIn(v: unknown, kind: string, out: Map<string, string>): void {
  if (Array.isArray(v)) { for (const x of v) namesIn(x, kind, out); return; }
  if (!v || typeof v !== 'object') return;
  for (const [key, value] of Object.entries(v)) {
    if (key === 'name' && typeof value === 'string' && value.length >= 3) out.set(value, kind);
    else if (value && typeof value === 'object') namesIn(value, key.replace(/s$/, ''), out);
  }
}

interface HostedFile {
  /** The name without the extension. */
  name: string;
  id: string;
  path: string;
}

/** What is known of the secrets this install holds, as values to hide wherever they appear. */
export function knownSecrets(folder: string, env: NodeJS.ProcessEnv, home: string | undefined, extra: string[] = []): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v.length >= 4) out.add(v); };
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (SECRET_ENV.test(name) || isCredentialName(name)) add(value);
    else if (/^(?:TABULARIUS|OPENHBAM)_/.test(name) && !SAFE_ENV.has(name) && value.length >= 8) add(value);
  }
  // The settings file: every string in a key that was not listed as a switch or a number.
  try {
    const settings = readSettings(folder) as Record<string, unknown>;
    for (const [key, value] of Object.entries(settings)) if (!SAFE_SETTINGS.has(key)) for (const s of secretStrings(value, key)) add(s);
  } catch {
    // A settings file that does not parse may still hold a password: every piece of it is hidden.
    for (const piece of rawPieces(join(folder, '.openhbam-settings.json'))) add(piece);
  }
  // The folder's own secret files (connection secrets, webhooks, access tokens, the admin password, sign-in provider files, keys).
  try {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const n = entry.name;
      if (!/^\.openhbam-(?:connection-secrets|secrets|webhooks|oidc|mcp-tokens?|admin)/.test(n) && !/\.(?:key|pem)$/i.test(n)) continue;
      const file = join(folder, n);
      const files = entry.isDirectory() ? readdirSync(file).map((f) => join(file, f)) : [file];
      for (const f of files) {
        for (const piece of rawPieces(f)) {
          // A JSON file's strings, and the file's own lines.
          add(piece);
          for (const str of /^\s*[[{]/.test(piece) ? stringsIn(tryJson(piece)) : []) {
            if (str.length < 6) continue;
            add(str);
            // A web address: the secret is usually one piece of its path or one query value.
            try {
              const url = new URL(str);
              for (const part of url.pathname.split('/')) if (part.length >= 8) add(part);
              for (const [, v] of url.searchParams) if (v.length >= 6) add(v);
            } catch { /* not an address */ }
          }
        }
      }
    }
  } catch { /* none */ }
  // Files the environment points at (mail account, AI key).
  for (const [name, value] of Object.entries(env)) {
    if (value && /_FILE$/.test(name) && /^(?:TABULARIUS|OPENHBAM)_/.test(name)) for (const piece of rawPieces(value)) add(piece);
  }
  // Per-user files that hold a key or an account (the AI key, the mail account): their contents, whole and by line.
  if (home) {
    for (const dir of new Set([home, ...(env.TABULARIUS_HOME || env.OPENHBAM_HOME ? [join(homedir(), '.openhbam')] : [])])) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isFile() || entry.name === 'service.json') continue;
          for (const piece of rawPieces(join(dir, entry.name))) add(piece);
        }
      } catch { /* no such folder */ }
    }
  }
  for (const s of extra) add(s);
  return [...out];
}

/** The whole of a small text file, each of its lines, and (when it does not read as JSON) each word: values to hide. Nothing for a missing or large file. */
function rawPieces(file: string): string[] {
  try {
    if (statSync(file).size > 64 * 1024) return [];
    const text = readFileSync(file, 'utf8');
    const pieces = [text.trim(), ...text.split(/\r?\n/).map((l) => l.trim())];
    if (/\.json$/.test(file) && tryJson(text) === undefined) for (const m of text.matchAll(/:\s*"?([^",}\]\r\n]+)/g)) pieces.push(m[1]!.trim());
    return pieces.filter((p) => p.length >= 4);
  } catch {
    return [];
  }
}

function tryJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** Flags as the service was installed with them: names, and values only for the numbers and durations. */
function safeFlags(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const next = eq > 0 ? a.slice(eq + 1) : args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1] : undefined;
    if (eq <= 0 && next !== undefined) i++;
    out.push(next === undefined ? flag : SAFE_FLAGS.has(flag) && /^[\w.:-]+$/.test(next) ? `${flag} ${next}` : `${flag} <value left out>`);
  }
  return out;
}

function commitOfThisInstall(): string {
  try {
    const root = diagnosticRoot();
    if (!existsSync(join(root, '.git'))) return 'not a git checkout';
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

export interface DiagnosticsOptions {
  /** Show hosted file names instead of file-1, file-2. */
  includeNames?: boolean;
  /** Read every page of every file (doctor --full). */
  full?: boolean;
  /** The operating system's home folder, and the per-user folder (~/.openhbam); the defaults are this process's. */
  home?: string;
  userFolder?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

const DESIGN_COUNTS = ['tables', 'tableOccurrences', 'layouts', 'scripts', 'valueLists', 'customFunctions', 'privilegeSets', 'dataSources'] as const;

/** The bundle: file name → text. Throws, writing nothing, if the finished bundle still holds something the scrubber would hide. */
export async function diagnostics(folderArg: string, opts: DiagnosticsOptions = {}): Promise<Map<string, string>> {
  const folder = resolve(folderArg);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`diagnostics: ${folder} is not a folder; give the folder Tabularius serves`);
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const userFolder = opts.userFolder ?? env.TABULARIUS_HOME ?? env.OPENHBAM_HOME ?? join(home, '.openhbam');
  const now = opts.now ?? new Date();
  let service: ReturnType<typeof installed>;
  try { service = installed(userFolder); } catch { service = undefined; }

  // Hosted files, read only: the design's names (to hide them) and counts (to show them).
  const files: HostedFile[] = readdirSync(folder).filter((n) => n.endsWith(STORE_EXT)).sort().map((n, i) => ({ name: n.slice(0, -STORE_EXT.length), id: `file-${i + 1}`, path: join(folder, n) }));
  const names = new Map<string, string>();
  // Every file in the folder is named in the bundle's text by its own name or the one without its extension, and a file that
  // was not converted is just the case this bundle is for: all of them are hidden, not only the converted ones.
  let other = 0;
  for (const entry of readdirSync(folder)) {
    if (entry.startsWith('.') || entry.endsWith(STORE_EXT)) continue;
    const label = `<file ${++other}>`;
    names.set(entry, label);
    const base = entry.replace(/\.[^.]+$/, '');
    if (base !== entry && !names.has(base)) names.set(base, label);
  }
  const kinds = new Map<string, number>();
  const labelFor = (kind: string, name: string) => {
    if (names.has(name)) return;
    const n = (kinds.get(kind) ?? 0) + 1;
    kinds.set(kind, n);
    names.set(name, `<${kind} ${n}>`);
  };
  const designs = new Map<string, { counts: Record<string, number>; format?: number; accounts: number }>();
  const unreadable = new Map<string, string>();
  for (const f of files) {
    if (!opts.includeNames) { names.set(f.name, f.id); names.set(f.name + STORE_EXT, f.id); }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(f.path, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 2000');
      const schemaRow = db.prepare("SELECT json FROM _fm_meta WHERE key = 'schema'").get() as { json: string } | undefined;
      const schema = schemaRow ? JSON.parse(schemaRow.json) as Record<string, unknown> : {};
      const found = new Map<string, string>();
      namesIn(schema, 'name', found);
      const accounts = (db.prepare('SELECT name FROM _fm_accounts').all() as { name: string }[]).map((r) => r.name);
      for (const [n, kind] of found) labelFor(kind, n);
      for (const a of accounts) labelFor('account', a);
      const counts: Record<string, number> = {};
      for (const k of DESIGN_COUNTS) counts[k] = Array.isArray(schema[k]) ? (schema[k] as unknown[]).length : 0;
      counts.fields = Array.isArray(schema.tables) ? (schema.tables as { fields?: unknown[] }[]).reduce((n, t) => n + (t.fields?.length ?? 0), 0) : 0;
      counts.accounts = accounts.length;
      designs.set(f.id, { counts, accounts: accounts.length });
    } catch (e) {
      unreadable.set(f.id, (e as Error).message.replace(/(valid JSON|Unexpected token|JSON at position)[\s\S]*/i, '$1 …'));
    } finally {
      try { db?.close(); } catch { /* nothing more to do */ }
    }
  }

  const salt = randomBytes(16);
  const flagValues = service ? service.extra.filter((a) => !a.startsWith('--') && !/^[\d.:]+(?:[KMG]B?)?$/i.test(a) && !/^(?:true|false|on|off)$/i.test(a)) : [];
  const keyFile = service?.extra.findIndex((a) => a === '--ai-key-file') ?? -1;
  const secrets = knownSecrets(folder, env, userFolder, [...flagValues, ...(keyFile >= 0 ? rawPieces(service!.extra[keyFile + 1] ?? '') : [])]);
  const scrub = new Scrubber({ folder, home, secrets, names, host: hostname(), salt });
  // Names are applied to free text only: the structured files hold labels and numbers, and a table called "tables" must not rename a key.
  const out = new Map<string, string>();
  const json = (v: unknown) => scrub.patterns(JSON.stringify(v, null, 2)) + '\n';

  // The environment.
  const seenEnv = Object.keys(env).filter((k) => /^(?:TABULARIUS|OPENHBAM)_/.test(k)).sort();
  const hostedBytes = files.reduce((n, f) => { try { return n + statSync(f.path).size; } catch { return n; } }, 0);
  const running = runningServer(folder) !== undefined;
  out.set('environment.json', json({
    generatedAt: now.toISOString(),
    tabularius: { version: SERVER_VERSION, commit: commitOfThisInstall().slice(0, 12), storeFormat: STORE_FORMAT },
    node: process.version,
    system: { platform: platform(), arch: arch(), release: release(), cpus: cpus().length, memoryBytes: totalmem(), timezoneOffsetMinutes: now.getTimezoneOffset() },
    howItRuns: service ? `installed as a service (${service.platform})` : existsSync('/.dockerenv') ? 'in a container' : 'started by hand (or from source)',
    serverRunningOnThisFolder: running,
    service: service ? { port: service.port, host: service.host, system: service.system, flags: safeFlags(service.extra) } : null,
    environmentVariables: {
      set: seenEnv,
      values: Object.fromEntries(Object.keys(env).filter((k) => SAFE_ENV.has(k) && env[k]).sort().map((k) => [k, env[k]])),
    },
  }));

  // Settings: switches and numbers by value, everything else by name.
  let settings: Record<string, unknown> = {};
  try { settings = readSettings(folder) as Record<string, unknown>; } catch { /* reported below */ }
  out.set('settings.json', json({
    values: Object.fromEntries(Object.entries(settings).filter(([k, v]) => SAFE_SETTINGS.has(k) && (typeof v === 'boolean' || typeof v === 'number')).sort(([a], [b]) => a.localeCompare(b))),
    otherSettingsSet: Object.keys(settings).filter((k) => !SAFE_SETTINGS.has(k)).sort(),
  }));

  // Files: ids, sizes, counts. Names only on request.
  const infos = [];
  for (const f of files) {
    let size = 0; let wal = 0;
    try { size = statSync(f.path).size; } catch { /* gone */ }
    try { wal = statSync(f.path + '-wal').size; } catch { /* none */ }
    const d = designs.get(f.id);
    infos.push({
      id: f.id, ...(opts.includeNames ? { name: f.name } : {}), bytes: size, walBytes: wal,
      readable: !!d, ...(d ? { design: d.counts } : { problem: scrub.text(unreadable.get(f.id) ?? 'could not be read').replace(/\s+/g, ' ').slice(0, 300) }),
    });
  }
  out.set('files.json', json({ count: files.length, namesIncluded: !!opts.includeNames, files: infos }));

  // The last conversion report, counts only.
  const conversions = [];
  for (const f of files) {
    if (!designs.has(f.id)) continue;
    let store: Store | undefined;
    let copy: string | undefined;
    try {
      // The report needs only the design. Opening the file itself would migrate it and write to it, so the design is read
      // (read only) into a scratch file, and the scratch file is what is opened.
      copy = designCopy(f.path, f.name);
      store = new Store(copy, f.name);
      const report = conversionReport(store, files.map((x) => x.name));
      const { summary: _s, database: _d, ...groups } = report;
      const tally = (v: unknown): { kinds: number; uses: number } => {
        if (Array.isArray(v)) return { kinds: v.length, uses: v.reduce((n: number, x: { count?: number }) => n + (typeof x?.count === 'number' ? x.count : 1), 0) };
        if (v && typeof v === 'object') return Object.values(v).reduce((a: { kinds: number; uses: number }, x) => { const t = tally(x); return { kinds: a.kinds + t.kinds, uses: a.uses + t.uses }; }, { kinds: 0, uses: 0 });
        return { kinds: 0, uses: 0 };
      };
      const counted: Record<string, unknown> = {};
      for (const [group, value] of Object.entries(groups)) {
        if (group === 'privileges' || group === 'accounts' || group === 'externalContainers') continue;
        counted[group] = value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tally(v)]))
          : tally(value);
      }
      conversions.push({ id: f.id, counted });
    } catch (e) {
      conversions.push({ id: f.id, problem: scrub.text((e as Error).message).replace(/\s+/g, ' ').slice(0, 300) });
    } finally {
      try { store?.close(); } catch { /* nothing more to do */ }
      if (copy) rmSync(dirname(copy), { recursive: true, force: true });
    }
  }
  out.set('conversion.json', json({ note: 'How many kinds of thing, and how many places, the conversion report lists for each file; never what they are called.', files: conversions }));

  // Disk.
  try {
    const fs = statfsSync(folder);
    out.set('disk.json', json({ totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize, hostedFilesBytes: hostedBytes }));
  } catch (e) {
    out.set('disk.json', json({ problem: scrub.text((e as Error).message) }));
  }

  // Plug-ins.
  try {
    const st = pluginStatus(folder);
    const label = (file: string) => files.find((f) => f.name.toLowerCase() === file.replace(/\.fmp12$/i, '').toLowerCase())?.[opts.includeNames ? 'name' : 'id'] ?? 'a file that is not hosted';
    out.set('plugins.json', json({
      installed: st.installed.map((m) => ({ id: m.id, name: m.name, version: m.version, publisher: m.publisher, functions: m.functions.length, signedBy: st.installs[m.id]?.signer ?? null, on: Object.entries(st.enabled).filter(([, ids]) => ids.includes(m.id)).map(([f]) => label(f)) })),
      builtIn: st.builtins.map((b) => ({ id: b.id, offFor: b.offFor.map(label) })),
      problems: st.problems.map((p) => scrub.text(p).replace(/\s+/g, ' ').slice(0, 300)),
    }));
  } catch (e) {
    out.set('plugins.json', json({ problem: scrub.text((e as Error).message).replace(/\s+/g, ' ').slice(0, 300) }));
  }

  // Schedules: what they are and how the last run went, not what they run.
  const schedules: unknown[] = [];
  try {
    const file = join(folder, '.openhbam-schedules.json');
    if (existsSync(file)) {
      const list = (JSON.parse(readFileSync(file, 'utf8')) as { schedules?: Record<string, unknown>[] }).schedules ?? [];
      let runs: Record<string, { at: string; error: number; steps: number; ms: number; manual?: boolean; conflicts?: number }[]> = {};
      try { runs = (JSON.parse(readFileSync(join(folder, '.openhbam-schedule-runs.json'), 'utf8')) as { runs?: typeof runs }).runs ?? {}; } catch { /* no history */ }
      list.forEach((s, i) => {
        const history = Array.isArray(runs[String(s.id)]) ? runs[String(s.id)]! : [];
        const last = history[0];
        schedules.push({
          id: `schedule-${i + 1}`, kind: typeof s.kind === 'string' ? s.kind : s.sync ? 'sync' : 'script', enabled: s.enabled === true, onOpen: s.onOpen === true,
          everyMinutes: typeof s.everyMinutes === 'number' ? s.everyMinutes : null, at: typeof s.at === 'string' && /^\d{1,2}:\d{2}$/.test(s.at) ? s.at : null,
          network: s.network === true, file: files.find((f) => f.name === s.database)?.[opts.includeNames ? 'name' : 'id'] ?? null,
          runsKept: history.length, runsThatFailed: history.filter((r) => r.error !== 0).length,
          lastRun: last ? { at: last.at, error: last.error, steps: last.steps, ms: last.ms, manual: last.manual === true, ...(last.conflicts ? { conflicts: last.conflicts } : {}) } : null,
        });
      });
    }
  } catch (e) {
    schedules.push({ problem: scrub.text((e as Error).message).replace(/\s+/g, ' ').slice(0, 300) });
  }
  out.set('schedules.json', json({ count: schedules.length, schedules }));

  // What doctor says (the file check, accounts, backups, certificate, service, port), with the folder and names hidden.
  const checks = await runDoctor(folder, { full: opts.full, home: userFolder });
  out.set('doctor.txt', scrub.text(doctorText(checks)));

  // The tail of the log.
  for (const log of LOGS) {
    const lines = tailLines(join(folder, 'Logs', `${log}.log`));
    out.set(`log-${log}.txt`, lines.length ? lines.map((l) => scrub.logLine(l)).join('\n') + '\n' : `(no ${log}.log in the folder's Logs, or it could not be read)\n`);
  }

  out.set('README.txt', [
    'tabularius diagnostics',
    '',
    `Made ${now.toISOString()} by Tabularius ${SERVER_VERSION}. Every file here is plain text: open them and read them before you send the bundle.`,
    '',
    'What is in it',
    '  environment.json  version, Node, operating system, how the server runs, which settings variables are set (names, and values only for numbers and choices)',
    '  settings.json     the server settings that are a switch or a number; the other settings by name only',
    `  files.json        each hosted file as ${opts.includeNames ? 'its name' : 'file-1, file-2'}: size, whether it opens, how many tables, fields, layouts, scripts, value lists`,
    '  conversion.json   how many kinds of thing and how many places the conversion report lists, never what they are called',
    '  disk.json         free and total space where the files are',
    '  plugins.json      installed plug-ins (id, version, publisher) and which files they are on for',
    '  schedules.json    each schedule as schedule-1, schedule-2: how often, and how the last run ended',
    '  doctor.txt        the checks `tabularius doctor` makes',
    `  log-Event.txt, log-ScriptEvent.txt  the last ${LOG_LINES} lines of each, with anything in quotes, names from your solution, addresses and secrets hidden`,
    '',
    'What is never in it',
    '  records, field values, scripts, calculations, layouts, file or account names (unless you asked for the file names), passwords, tokens, API keys, session ids, the sign-in and access logs, email addresses, IP addresses (the same address is the same label throughout this bundle and means nothing outside it), your user name in a path (shown as ~), the folder path (shown as <folder>)',
    '',
    `Hidden values show as ${REDACTED}, <email>, address-xxxxxx, <host>, ~ or <folder>, and names from your solution as <table 1>, <field 3>, <account 2> and so on.`,
    '',
  ].join('\n'));

  // A check that does not use the rules above: none of the values this install is known to hold, and neither the folder nor the home folder, is in any file.
  const held = [...secrets.filter((x) => x.length >= 4), folder, ...(home ? [home] : [])].filter((x) => x.length >= 4 && x !== '/');
  for (const [name, text] of out) {
    if (name === 'README.txt') continue; // fixed words, written here
    const leaked = held.find((x) => text.includes(x));
    if (leaked !== undefined) throw new Error(`diagnostics: ${name} still held a value that is hidden elsewhere in the bundle, so nothing was written. Please report this, without the bundle.`);
  }
  return out;
}

/** Writes a bundle as a .zip file or into a new folder; returns what was written. Refuses to replace anything. */
export function writeBundle(bundle: Map<string, string>, out: string, now = new Date()): string {
  const target = resolve(out);
  if (existsSync(target)) throw new Error(`diagnostics: ${target} is already there; give another --out`);
  if (/\.zip$/i.test(target)) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zip([...bundle].map(([name, text]) => ({ name: `tabularius-diagnostics/${name}`, data: Buffer.from(text, 'utf8') })), now), { flag: 'wx', mode: 0o600 });
  } else {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const [name, text] of bundle) writeFileSync(join(target, name), text, { flag: 'wx', mode: 0o600 });
  }
  return target;
}

/** `tabularius-diagnostics-20261017-153000.zip`, in UTC. */
export function defaultBundleName(now = new Date()): string {
  return `tabularius-diagnostics-${now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}.zip`;
}

/** Resolve module URLs without treating escaped spaces or drive letters as POSIX paths. */
export function diagnosticRoot(url = import.meta.url, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return paths.resolve(paths.dirname(fileURLToPath(url, { windows: platform === 'win32' })), '..', '..', '..');
}

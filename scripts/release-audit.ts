// What ships: audits the files of a release pack (scripts/build-release.ts) or of the committed tree (what the
// public snapshot, scripts/public-snapshot.ts, starts from), against the allow-list in scripts/release-allowlist.json.
// It reads files and prints findings; it builds nothing public, tags nothing and pushes nothing.
//
//   node --no-warnings scripts/release-audit.ts --tree             the committed files of HEAD (no network)
//   node --no-warnings scripts/release-audit.ts --pack FILE        a pack written by `build-release.ts --pack-only`
//   node --no-warnings scripts/release-audit.ts --build            build a pack in a temporary folder (needs npm), then audit it
//
// Exit code 0: nothing found. 1: findings (each names a rule, a file and what is wrong). The same checks run in the
// test suite (packages/cli/test/release-audit.test.ts) on the committed tree and on planted problems, so a rule that
// stopped catching its problem fails there.
//
// The checks, by rule name:
//   unlisted-file      a file the allow-list does not name (the list is the data file, one reason per entry)
//   not-in-lock        a node_modules package that is not a production package of package-lock.json
//   no-notice          a shipped package with no licence text in THIRD-PARTY-NOTICES.md
//   fixture-file       a FileMaker file, SQLite file or fixtures/ path, by name or by the first bytes
//   key-file           .pem, .key, .p12, .pfx or .env files
//   source-map         a .map file, or a sourceMappingURL comment in our own code
//   debug-output       profiles, heap snapshots, logs, build info, editor and merge leftovers, coverage
//   native-binary      .node, .so, .dll, .dylib, .exe files, or ELF, Mach-O and PE headers
//   executable         an execute bit on a file the allow-list does not name
//   risky-mode         setuid, setgid, sticky or world-writable bits, or a mode git does not use
//   symlink            a link in a pack, or a committed link that is absolute or leaves the tree
//   oversized          a file over the allow-list's size limit (with a reason where one is allowed more)
//   secret             a private key block or a token in the shape of a GitHub, Anthropic, OpenAI, AWS or Slack credential
//   high-entropy       a long random-looking string in our own files
//   private-detail     a person's home folder, a personal machine name, or a private-relay address
//   machine-detail     the builder's own home folder, checkout path, temporary folder, user name or host name
//   email              an address outside the placeholder domains and the allow-list
//   banned-name        a word from scripts/banned-names.ts
//   lifecycle-script   preinstall, install, postinstall or prepare in a package.json, or a binding.gyp (npm runs node-gyp for it)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { hostname, homedir, tmpdir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { bannedLines } from './banned-names.ts';

export const REPO = resolve(import.meta.dirname, '..');

// ---- What goes in a release pack ----------------------------------------------------------------------------------

/** Folders of tests, browser tests, evaluations and benchmarks: code for the people who build the program, not for people who run it. */
const NOT_PROGRAM_DIR = /\/(test|e2e|evals|bench)\//;

/** True for a tracked file that belongs in the release pack: the program under packages/, its reference pages, and the package files. */
export function isProgramFile(f: string): boolean {
  return (f.startsWith('packages/') && !NOT_PROGRAM_DIR.test(f) && !f.endsWith('tsconfig.json'))
    || /^docs\/(reference\/)?[A-Za-z0-9_-]+\.md$/.test(f) || f === 'package.json' || f === 'package-lock.json' || f === 'LICENSE' || f === 'NOTICE';
}

/** Dot files that configure a dependency's own linting, coverage, publishing and git use, and the maps of its sources: nothing runs them. */
const DEPENDENCY_DOTFILE = /^\.(eslintrc(\..+)?|eslintignore|nycrc(\..+)?|npmignore|npmrc|editorconfig|gitattributes|gitignore|travis\.yml|babelrc(\..+)?|prettierrc(\..+)?|prettierignore|jshintrc|jscsrc|istanbul\.yml|coveralls\.yml|DS_Store)$/;

/** True for a file under node_modules that the release leaves out. */
export function isDependencyDebris(path: string): boolean {
  if (!path.startsWith('node_modules/')) return false;
  const parts = path.split('/');
  return path.endsWith('.map') || parts.includes('.github') || DEPENDENCY_DOTFILE.test(parts[parts.length - 1]);
}

// ---- The allow-list -------------------------------------------------------------------------------------------------

export interface Scope {
  /** Every file must match one of these. `*` is any run of characters but a slash, `**` any run, `?` one character. */
  allow: { glob: string; why: string }[];
  /** Files that may carry the execute bit. */
  executable: { glob: string; why: string }[];
  /** The size limit of a file, in bytes. */
  maxBytes: number;
  /** Files allowed more than that, with what they are. */
  larger: { glob: string; maxBytes: number; why: string }[];
  /** A rule that does not apply to a file, with why. */
  exceptions: { glob: string; rule: string; why: string }[];
  /** Addresses that may appear. */
  emails: { address: string; why: string }[];
}
export interface AllowList { pack: Scope; tree: Scope }

export function loadAllowList(): AllowList {
  return JSON.parse(readFileSync(join(REPO, 'scripts', 'release-allowlist.json'), 'utf8')) as AllowList;
}

/** A pattern as a regular expression. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { re += '(?:.*/)?'; i++; } else re += '.*'; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matches = (globs: readonly string[], path: string) => globs.some((g) => globToRegExp(g).test(path));

// ---- Findings -------------------------------------------------------------------------------------------------------

export interface Entry { path: string; size: number; mode: number; data: Buffer; /** A link's target, for an entry that is a link. */ link?: string }
export interface Finding { rule: string; path: string; line?: number; detail: string }
export interface Machine { homedir?: string; repo?: string; stage?: string; username?: string; hostname?: string }
export interface AuditOptions {
  kind: 'pack' | 'tree';
  scope: Scope;
  /** The production packages of package-lock.json (names). With it, a node_modules package outside the set is a finding. */
  prodPackages?: ReadonlySet<string>;
  /** The text of THIRD-PARTY-NOTICES.md. With it, a shipped package with no `## name version` heading is a finding. */
  notices?: string;
  /** Who built it: their folders and names must not be in what they built. */
  machine?: Machine;
  /** Which lines of a text hold a banned word. Defaults to the list the no-private-names test uses. */
  banned?: (text: string) => number[];
}

// Shapes that mean a real credential. Test files hold fake ones to test redaction, so they are skipped.
export const KEY_SHAPES: Array<[string, RegExp]> = [
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['a GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['an Anthropic or OpenAI key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{40,}\b/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b(?!.*EXAMPLE)/],
  ['a Slack token', /\bxox[abeoprs]-[A-Za-z0-9-]{20,}\b/],
];
// Things that identify a person or a private network. Documentation placeholders are allowed.
export const PRIVATE_SHAPES: Array<[string, RegExp]> = [
  ['a home folder with a real-looking user name', /(?:\/Users\/|\/home\/)(?!someone\b|x\b|a\b|me\b|user\b|you\b|name\b|USER\b|claude\b|runner\b|node\b|tabularius\b)[a-z][a-z0-9_-]{2,}\//],
  ['a Windows home folder with a real-looking user name', /\b[A-Za-z]:\\Users\\(?!someone\b|x\b|a\b|me\b|user\b|you\b|name\b|USER\b|Public\b|Default\b|runneradmin\b|runner\b)[A-Za-z][A-Za-z0-9_-]{2,}\\/],
  ['a .local machine name of a person', /\b[A-Z][a-z]+s-(?:MacBook|Mac-mini|iMac|Mac-Studio)[A-Za-z0-9-]*\.local\b/],
  ['a private-relay or personal email', /[A-Za-z0-9._-]+@(?:privaterelay\.appleid\.com|icloud\.com|me\.com)\b/],
];

const TEXT_NAME = /\.(ts|cts|mts|js|cjs|mjs|json|md|markdown|yml|yaml|sh|ps1|html|css|txt|toml|plist|service|xml|sql|rb|nuspec|svg|webmanifest|csv)$|(^|\/)(LICENSE|NOTICE|Dockerfile|Caddyfile|\.[a-z]+rc|\.nvmrc|\.editorconfig|\.gitattributes|\.gitignore|\.dockerignore)$/;
const FIXTURE_PATH = /\.(fmp12|fp7|fmp|fmpur|sqlite3?|db)$|\.sqlite-(wal|shm)$|(^|\/)fixtures\//i;
// A dependency's own test fixtures are its business (and a folder of that name is common); a database or FileMaker file is not.
const DEPENDENCY_FIXTURE_PATH = /\.(fmp12|fp7|fmp|fmpur|sqlite3?|db)$|\.sqlite-(wal|shm)$/i;
const KEY_FILE = /\.(pem|key|p12|pfx|p8|jks|keystore)$|(^|\/)\.env(\.|$)|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i;
const DEBUG_OUTPUT = /\.(cpuprofile|heapprofile|heapsnapshot|trace|prof|log|tsbuildinfo|orig|rej|swp|swo|bak|tmp|pid)$|~$|(^|\/)(\.DS_Store|Thumbs\.db|core|npm-debug\.log[^/]*)$|(^|\/)(coverage|\.nyc_output)\//i;
const NATIVE_NAME = /\.(node|so|dll|dylib|exe|bin)$|\.so\.\d/i;
// npm runs these three when a package is installed as a dependency; `prepare` and `prepublish` it runs only for the project being installed (this one), so a dependency's are its publisher's.
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];
const PROJECT_SCRIPTS = [...INSTALL_SCRIPTS, 'prepare', 'prepublish'];
// The names RFC 2606 keeps for examples, plus GitHub's no-reply addresses.
const PLACEHOLDER_EMAIL = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost|users\.noreply\.github\.com)$/i;
// A real top-level domain is lower case letters; `Customers@odata.navigationLink` is an OData annotation, not an address.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,24}(?![A-Za-z0-9-]|\.[A-Za-z0-9])/g;

/** The first bytes of the files that must not ship, whatever they are called. */
export function magicKind(data: Buffer): 'sqlite' | 'filemaker' | 'elf' | 'macho' | 'pe' | undefined {
  if (data.length >= 16 && data.subarray(0, 16).toString('latin1') === 'SQLite format 3\0') return 'sqlite';
  if (data.length >= 15 && [0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x05, 0x00, 0x02, 0x00, 0x02, 0xc0].every((b, i) => data[i] === b)) return 'filemaker';
  if (data.length >= 4) {
    const w = data.readUInt32BE(0);
    if (w === 0x7f454c46) return 'elf';
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(w)) return 'macho';
    // 0xcafebabe is also a Java class file; Mach-O universal files have a small count after it.
    if (w === 0xcafebabe && data.length >= 8 && data.readUInt32BE(4) < 20) return 'macho';
    if (data.subarray(0, 2).toString('latin1') === 'MZ' && data.length > 64) return 'pe';
  }
  return undefined;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isNodeModules = (p: string) => p.startsWith('node_modules/');
const isUtf16 = (e: Entry) => e.data.length >= 2 && e.data[0] === 0xff && e.data[1] === 0xfe;
// A file named for text is searched whatever bytes it holds (a stray NUL must not switch the content rules off); any other file only when its start is text.
const looksText = (e: Entry) => e.size <= 4 << 20 && (TEXT_NAME.test(e.path) || isUtf16(e) || !e.data.subarray(0, 8000).includes(0));

/** The package a node_modules path belongs to, nested ones included: `node_modules/a/node_modules/@s/b/x.js` is `@s/b`. */
export function packageOf(path: string): string | undefined {
  const i = path.lastIndexOf('node_modules/');
  if (i < 0) return undefined;
  const rest = path.slice(i + 'node_modules/'.length).split('/');
  if (rest.length < 2) return undefined; // a file directly in node_modules (npm's bookkeeping)
  return rest[0].startsWith('@') ? (rest.length >= 3 ? `${rest[0]}/${rest[1]}` : undefined) : rest[0];
}

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/** Strings of 40 or more base64 or token characters that look random: enough different characters, mixed case and digits. */
export function randomLookingTokens(line: string): string[] {
  if (/\b(sha(?:1|256|384|512)|md5)-|integrity|data:[a-z/+.-]+;base64/i.test(line)) return [];
  const out: string[] = [];
  for (const m of line.matchAll(/[A-Za-z0-9+/_=-]{40,}/g)) {
    const t = m[0];
    if (/^[0-9a-f]+$/i.test(t) || /^[a-z_-]+$/.test(t) || /^[A-Z_-]+$/.test(t) || /^(.)\1+$/.test(t)) continue;
    if (!/[a-z]/.test(t) || !/[A-Z]/.test(t) || !/[0-9]/.test(t)) continue;
    if (/\//.test(t) && /^[A-Za-z0-9/]+$/.test(t) === false) continue;
    if (entropy(t) >= 4.5) out.push(t);
  }
  return out;
}

/** Audits entries. The findings are in path order. */
export function audit(entries: readonly Entry[], options: AuditOptions): Finding[] {
  const { scope, kind } = options;
  const findings: Finding[] = [];
  const add = (rule: string, path: string, detail: string, line?: number) => {
    if (scope.exceptions.some((x) => x.rule === rule && globToRegExp(x.glob).test(path))) return;
    findings.push({ rule, path, detail, ...(line !== undefined ? { line } : {}) });
  };
  const noticeHeadings = options.notices !== undefined ? new Set([...options.notices.matchAll(/^## (\S+) (\S+)$/gm)].map((m) => `${m[1]}@${m[2]}`)) : undefined;
  const seenPackages = new Map<string, string>(); // name@version -> a path inside it
  const machine = options.machine ?? {};
  const machinePaths = [['the builder\'s home folder', machine.homedir], ['the builder\'s checkout', machine.repo], ['the builder\'s temporary folder', machine.stage]]
    .filter((x): x is [string, string] => typeof x[1] === 'string' && x[1].length >= 5 && x[1] !== sep);
  const machineNames: Array<[string, RegExp]> = [];
  if (machine.username && machine.username.length >= 3) machineNames.push([`the builder's user name (${machine.username}) in a path`, new RegExp(`(?:/Users/|/home/|\\\\Users\\\\|~)${escapeRegExp(machine.username)}(?![A-Za-z0-9_-])`)]);
  if (machine.hostname && machine.hostname.length >= 6 && !/^localhost/i.test(machine.hostname)) machineNames.push([`the builder's host name (${machine.hostname})`, new RegExp(`\\b${escapeRegExp(machine.hostname)}\\b`, 'i')]);

  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const p = e.path;
    const dep = isNodeModules(p);
    const base = p.slice(p.lastIndexOf('/') + 1);

    // Which files may be here at all.
    const pkg = dep ? packageOf(p) : undefined;
    if (dep && options.prodPackages) {
      if (pkg === undefined) add('unlisted-file', p, 'a file directly in node_modules');
      else if (!options.prodPackages.has(pkg)) add('not-in-lock', p, `${pkg} is not a production package of package-lock.json`);
    } else if (!dep && !scope.allow.some((a) => globToRegExp(a.glob).test(p))) add('unlisted-file', p, 'not named in scripts/release-allowlist.json');
    if (dep && pkg) {
      // Collect each package once, by its package.json.
      if (base === 'package.json' && p.endsWith(`${pkg}/package.json`)) {
        try {
          const j = JSON.parse(e.data.toString('utf8')) as { name?: string; version?: string };
          seenPackages.set(`${j.name ?? pkg}@${j.version ?? '?'}`, p);
        } catch { add('unlisted-file', p, 'a package.json that does not parse'); }
      }
    }

    // Links, modes, sizes.
    if (e.link !== undefined) {
      if (kind === 'pack') add('symlink', p, `a link to ${e.link}: a pack holds plain files only`);
      else {
        const target = isAbsolute(e.link) ? e.link : normalize(join(dirname(p), e.link));
        if (isAbsolute(e.link)) add('symlink', p, `an absolute link to ${e.link}`);
        else if (target.startsWith('..') || isAbsolute(target)) add('symlink', p, `a link to ${e.link}, outside the tree`);
        else add('symlink', p, `a link to ${e.link}: the release build leaves committed links out, and a link is one more thing a checkout can point somewhere else`);
      }
      continue;
    }
    if (e.mode & 0o7002) add('risky-mode', p, `mode ${(e.mode & 0o7777).toString(8)} has a setuid, setgid, sticky or world-writable bit`);
    if (kind === 'pack' && (e.mode & 0o777) !== 0o644 && (e.mode & 0o777) !== 0o755) add('risky-mode', p, `mode ${(e.mode & 0o777).toString(8)}: a pack stores 644 or 755 only`);
    if (e.mode & 0o111 && !matches(scope.executable.map((x) => x.glob), p)) add('executable', p, 'has the execute bit and is not named in the allow-list\'s executable list');
    const limit = scope.larger.find((l) => globToRegExp(l.glob).test(p))?.maxBytes ?? scope.maxBytes;
    if (e.size > limit) add('oversized', p, `${e.size} bytes, over the ${limit} allowed`);

    // What the file is.
    const magic = magicKind(e.data);
    if ((dep ? DEPENDENCY_FIXTURE_PATH : FIXTURE_PATH).test(p)) add('fixture-file', p, 'a database, FileMaker or fixture file by name');
    else if (magic === 'sqlite' || magic === 'filemaker') add('fixture-file', p, `${magic === 'sqlite' ? 'a SQLite database' : 'a FileMaker file'} by its first bytes`);
    if (KEY_FILE.test(p)) add('key-file', p, 'a key, certificate or .env file by name');
    if (p.endsWith('.map')) add('source-map', p, 'a source map');
    if (DEBUG_OUTPUT.test(p)) add('debug-output', p, 'a profile, log, build-info, backup or editor leftover by name');
    if (NATIVE_NAME.test(p)) add('native-binary', p, 'a compiled library or program by name');
    else if (magic === 'elf' || magic === 'macho' || magic === 'pe') add('native-binary', p, `a compiled ${magic === 'elf' ? 'Linux' : magic === 'macho' ? 'macOS' : 'Windows'} program or library by its first bytes`);
    if (base === 'binding.gyp') add('lifecycle-script', p, 'npm builds a package with a binding.gyp by running node-gyp, as an install script');

    if (!looksText(e)) continue;
    const text = isUtf16(e) ? e.data.subarray(2).toString('utf16le') : e.data.toString('utf8');

    if (base === 'package.json') {
      try {
        const j = JSON.parse(text) as { scripts?: Record<string, unknown> };
        for (const name of dep ? INSTALL_SCRIPTS : PROJECT_SCRIPTS) if (j.scripts && typeof j.scripts[name] === 'string') add('lifecycle-script', p, `scripts.${name}: ${String(j.scripts[name]).slice(0, 80)}`);
      } catch { /* reported above for dependencies */ }
    }

    // Content rules. Test files hold fake credentials on purpose; a dependency's own files are held to the credential rules only.
    const contentSkipped = (!dep && /(^|\/)(test|e2e|evals)\/|\.test\.ts$|^docs\/reference\//.test(p)) || /(^|\/)package-lock\.json$|(^|\/)THIRD-PARTY-NOTICES\.md$/.test(p);
    if (!contentSkipped) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const at = i + 1;
        for (const [what, re] of KEY_SHAPES) if (re.test(line) && !(dep && what === 'a private key block')) add('secret', p, `looks like ${what}`, at);
        if (dep) return;
        for (const [what, re] of PRIVATE_SHAPES) if (re.test(line)) add('private-detail', p, `looks like ${what}`, at);
        for (const [what, where] of machinePaths) if (line.includes(where)) add('machine-detail', p, `holds ${what}`, at);
        for (const [what, re] of machineNames) if (re.test(line)) add('machine-detail', p, `holds ${what}`, at);
        for (const m of line.matchAll(EMAIL)) {
          if (PLACEHOLDER_EMAIL.test(m[0]) || scope.emails.some((x) => x.address.toLowerCase() === m[0].toLowerCase())) continue;
          add('email', p, `the address ${m[0]}`, at);
        }
        for (const t of randomLookingTokens(line)) add('high-entropy', p, `a random-looking string of ${t.length} characters (${t.slice(0, 4)}…)`, at);
        if (/^\s*(\/\/|\/\*)[#@]\s*sourceMappingURL=/.test(line)) add('source-map', p, 'a sourceMappingURL comment', at);
      });
      // A dependency's code may name the header of a key it parses; a header followed by the key's own lines is a key.
      if (dep && /-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=]{20,}/.test(text)) add('secret', p, 'a private key block with key lines');
      if (!dep) for (const line of (options.banned ?? bannedLines)(text)) add('banned-name', p, 'a word from the banned list', line);
    }
  }

  if (noticeHeadings) {
    for (const [key, path] of seenPackages) if (!noticeHeadings.has(key)) add('no-notice', path, `${key} has no licence text in THIRD-PARTY-NOTICES.md`);
  }
  return findings;
}

// ---- Gathering entries ------------------------------------------------------------------------------------------------

/** The production packages of a package-lock.json, and the ones that run a script when installed. */
export function lockPackages(lock: { packages?: Record<string, { dev?: boolean; link?: boolean; hasInstallScript?: boolean }> }): { prod: Set<string>; installScripts: string[] } {
  const prod = new Set<string>();
  const installScripts: string[] = [];
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || p.link || p.dev === true) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (name.startsWith('@tabularius/')) continue;
    prod.add(name);
    if (p.hasInstallScript) installScripts.push(name);
  }
  return { prod, installScripts };
}

/** The committed files of HEAD (or of the index): what the public snapshot starts from. */
export function treeEntries(root = REPO): Entry[] {
  const listing = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  return listing.map((line) => {
    const [meta, path] = [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1)];
    const gitMode = parseInt(meta.split(' ')[0], 8);
    const full = join(root, path);
    // The index describes the committed type, not what is in the working tree.
    // Inspect each component before descending: even a regular indexed file can
    // now be a symlink, or live beneath a directory replaced by one.
    let component = root;
    for (const part of path.split('/')) {
      component = join(component, part);
      let st;
      try { st = lstatSync(component); } catch { return { path, size: 0, mode: 0o644, data: Buffer.alloc(0) }; } // deleted in the working tree
      if (st.isSymbolicLink()) return { path, size: 0, mode: 0o777, data: Buffer.alloc(0), link: readlinkSync(component) };
    }
    if (gitMode === 0o120000) return { path, size: 0, mode: 0o777, data: Buffer.alloc(0), link: readlinkSync(full) };
    if (gitMode === 0o160000) return { path, size: 0, mode: 0o7777, data: Buffer.alloc(0) }; // a submodule: risky-mode names it
    const data = readFileSync(full);
    return { path, size: data.length, mode: gitMode & 0o777, data };
  });
}

/** The entries of a pack file written by `build-release.ts --pack-only`. */
export async function packEntries(file: string): Promise<Entry[]> {
  const { unpack } = await import('./build-release.ts');
  return unpack(readFileSync(file)).map((f) => ({ path: f.path, size: f.size, mode: f.mode, data: Buffer.from(f.data) }));
}

/** The builder's own folders and names, for the machine-detail rule. */
export function thisMachine(stage?: string): Machine {
  let username: string | undefined;
  try { username = userInfo().username; } catch { /* no user entry, as in some containers */ }
  return { homedir: homedir(), repo: REPO, stage: stage ?? join(tmpdir(), 'tabularius-release-'), username, hostname: hostname() };
}

export function auditTree(root = REPO): Finding[] {
  const list = loadAllowList();
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const { installScripts } = lockPackages(lock);
  const findings = audit(treeEntries(root), { kind: 'tree', scope: list.tree });
  for (const name of installScripts) findings.push({ rule: 'lifecycle-script', path: 'package-lock.json', detail: `${name} runs an install script; every installer passes --ignore-scripts, so it would not run: remove the package or decide that it may` });
  return findings;
}

export async function auditPack(file: string, machine = thisMachine()): Promise<Finding[]> {
  const list = loadAllowList();
  const entries = await packEntries(file);
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8'));
  const { prod, installScripts } = lockPackages(lock);
  const notices = entries.find((e) => e.path === 'THIRD-PARTY-NOTICES.md')?.data.toString('utf8') ?? '';
  const findings = audit(entries, { kind: 'pack', scope: list.pack, prodPackages: prod, notices, machine });
  for (const name of installScripts) findings.push({ rule: 'lifecycle-script', path: 'package-lock.json', detail: `${name} runs an install script` });
  return findings;
}

/** Groups of licence texts shipped byte for byte more than once (information, not a finding: each package's notice has to travel). */
export function duplicateLicences(entries: readonly Entry[]): { copies: number; bytes: number; examples: string[] }[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!isNodeModules(e.path) || !/(^|\/)(licen[cs]e|copying)(\.(md|txt|markdown))?$/i.test(e.path)) continue;
    const key = createHash('sha256').update(e.data).digest('hex');
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => ({ copies: g.length, bytes: g[0].size * (g.length - 1), examples: g.slice(0, 3).map((e) => e.path) })).sort((a, b) => b.bytes - a.bytes);
}

function report(findings: Finding[]): void {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const [rule, list] of byRule) {
    console.log(`\n${rule}: ${list.length}`);
    for (const f of list.slice(0, 40)) console.log(`  ${f.path}${f.line ? `:${f.line}` : ''}  ${f.detail}`);
    if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
  }
  console.log(findings.length ? `\n${findings.length} finding(s).` : '\nNothing found.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  let findings: Finding[];
  if (args.includes('--tree')) findings = auditTree();
  else if (get('--pack')) findings = await auditPack(get('--pack')!);
  else if (args.includes('--build')) {
    const out = mkdtempSync(join(tmpdir(), 'tabularius-audit-'));
    try {
      execFileSync(process.execPath, ['--no-warnings', join(REPO, 'scripts', 'build-release.ts'), '--pack-only', '--out', out, '--version', '0.0.0-audit'], { stdio: 'inherit' });
      const file = readdirSync(out).find((f) => f.endsWith('.pack'));
      if (!file) throw new Error('the build wrote no pack');
      findings = await auditPack(join(out, file));
    } finally { rmSync(out, { recursive: true, force: true }); }
  } else { console.error('Usage: release-audit.ts --tree | --pack FILE | --build'); process.exit(2); }
  report(findings);
  process.exitCode = findings.length ? 1 : 0;
}

// Not a top-level await: build-release.ts imports this file, and this file imports build-release.ts back (for unpack).
if (import.meta.main) main().catch((e) => { console.error((e as Error).message); process.exitCode = 2; });

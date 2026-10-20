// Licence and committed-data checks, plus a command to write the release's third-party notices.
//
//   node scripts/licence-gate.ts [check] [--audit] [--list]
//   node scripts/licence-gate.ts notices <folder holding node_modules> <out.md>
//
// check:   every package the lock file names has a licence on the allow list
//          (runtime packages: permissive only; dev packages may also be
//          MPL-2.0), the workspace packages match the LICENSE file, LICENSE and
//          NOTICE exist, and git tracks no sample files, keys or big binaries.
//          --audit adds `npm audit --omit=dev` (fails on high or critical).
//          --list prints the runtime packages and a count of each licence.
// notices: writes the licence text of every package under <folder>/node_modules
//          (the program's runtime dependencies) and of the Node.js runtime the
//          single-file build copies. The release build writes the same file, because MIT, ISC
//          and BSD licences ask for their notice to travel with copies.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNotices } from './third-party-notices.ts';
export { collectNotices, renderNotices } from './third-party-notices.ts';

const repo = resolve(import.meta.dirname, '..');

/** Licences a package that ships in the program may carry. */
export const RUNTIME_ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense',
]);
/** Dev-only packages never ship; file-level copyleft (MPL-2.0) is fine for tools run against the code. */
export const DEV_ALLOWED = new Set([...RUNTIME_ALLOWED, 'MPL-2.0', 'Python-2.0', 'CC-BY-4.0']);
/** Lock-file paths allowed past the lists above, each with its reason. Empty today. */
export const EXCEPTIONS: Record<string, string> = {};

/**
 * Whether an SPDX expression ("MIT", "(MIT OR Apache-2.0)", "A AND B") is
 * satisfied by the allowed set: OR needs one side, AND needs both.
 */
export function licenceAllowed(expression: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!expression) return false;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === '(') {
      const v = or();
      if (tokens[i++] !== ')') throw new Error(`unbalanced parentheses in ${expression}`);
      return v;
    }
    if (t === undefined || t === ')' || /^(AND|OR)$/i.test(t)) throw new Error(`cannot read licence expression ${expression}`);
    return allowed.has(t.replace(/\+$/, ''));
  };
  const and = (): boolean => {
    let v = atom();
    while (/^AND$/i.test(tokens[i] ?? '')) { i++; const r = atom(); v = v && r; }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (/^OR$/i.test(tokens[i] ?? '')) { i++; const r = and(); v = v || r; }
    return v;
  };
  try {
    const v = or();
    return v && i === tokens.length;
  } catch {
    return false;
  }
}

interface LockEntry { version?: string; license?: string; dev?: boolean; link?: boolean }
export interface Dependency { path: string; name: string; version: string; licence: string; dev: boolean }

/** The packages of a lock file (v2/v3), without the root and the workspace packages themselves. */
export function lockDependencies(lock: { packages?: Record<string, LockEntry> }): Dependency[] {
  const out: Dependency[] = [];
  for (const [path, e] of Object.entries(lock.packages ?? {})) {
    if (path === '' || e.link || !path.includes('node_modules/')) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.push({ path, name, version: e.version ?? '?', licence: e.license ?? '(none declared)', dev: e.dev === true });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function checkDependencies(deps: Dependency[], exceptions: Record<string, string> = EXCEPTIONS): string[] {
  const problems: string[] = [];
  for (const d of deps) {
    if (exceptions[d.path]) continue;
    if (licenceAllowed(d.licence, d.dev ? DEV_ALLOWED : RUNTIME_ALLOWED)) continue;
    problems.push(`${d.dev ? 'dev' : 'runtime'} package ${d.name}@${d.version} is ${d.licence}, which is not on the ${d.dev ? 'dev' : 'runtime'} allow list`);
  }
  return problems;
}

/** First line of a LICENSE file to its SPDX id, for the licences this project uses. */
export function spdxOfLicenceFile(text: string): string | undefined {
  const head = text.trimStart().slice(0, 200);
  if (/^MIT License/i.test(head)) return 'MIT';
  if (/^Apache License\s+Version 2\.0/i.test(head)) return 'Apache-2.0';
  return undefined;
}

export function checkWorkspaces(root: string): string[] {
  const problems: string[] = [];
  const licenceText = existsSync(join(root, 'LICENSE')) ? readFileSync(join(root, 'LICENSE'), 'utf8') : undefined;
  if (licenceText === undefined) problems.push('LICENSE is missing');
  if (!existsSync(join(root, 'NOTICE'))) problems.push('NOTICE is missing (credit for code derived from other projects goes there)');
  const expected = licenceText === undefined ? undefined : spdxOfLicenceFile(licenceText);
  if (licenceText !== undefined && !expected) problems.push('LICENSE is not a licence this check recognises (MIT or Apache-2.0)');
  const manifests = ['package.json', ...readdirSync(join(root, 'packages')).map((p) => join('packages', p, 'package.json'))];
  for (const m of manifests) {
    const file = join(root, m);
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { license?: string };
    if (!pkg.license) problems.push(`${m} declares no licence`);
    else if (expected && pkg.license !== expected) problems.push(`${m} declares ${pkg.license} but LICENSE is ${expected}`);
  }
  return problems;
}

const FORBIDDEN_EXTENSIONS = /\.(fmp12|fp7|fp5|fp3|fmpsl|fmpur|sqlite3?|db|pem|key|p12|pfx|keystore|zip|tgz|tar|gz|7z|bundle)$/i;
const FORBIDDEN_NAMES = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|credentials\.json)$/;
const MAX_TRACKED_BYTES = 2 * 1024 * 1024;
/** Tracked files allowed past the rules above. Empty today. */
export const TRACKED_EXCEPTIONS: Record<string, string> = {};

/**
 * Sample files other people made, keys, archives and large binaries must not
 * be committed: public repos keep history forever, and fixtures are fetched by
 * scripts/fetch-fixtures.ts because their authors' terms are unknown.
 */
export function checkTrackedFiles(files: string[], sizeOf: (f: string) => number): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (TRACKED_EXCEPTIONS[f]) continue;
    if (f.startsWith('fixtures/')) problems.push(`${f} is under fixtures/, which holds downloaded sample files and is never committed`);
    else if (FORBIDDEN_EXTENSIONS.test(f)) problems.push(`${f} looks like a data file, key or archive`);
    else if (FORBIDDEN_NAMES.test(f)) problems.push(`${f} looks like a secret`);
    else if (sizeOf(f) > MAX_TRACKED_BYTES) problems.push(`${f} is ${(sizeOf(f) / 1048576).toFixed(1)} MB; files over 2 MB are not committed`);
  }
  return problems;
}

function trackedFiles(root: string): string[] {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** `npm audit` of what ships. Returns the problems, or none when the registry can't be reached and `strict` is off. */
export function audit(root: string, strict: boolean): string[] {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  let report: { metadata?: { vulnerabilities?: Record<string, number> }; error?: { code?: string; summary?: string } } = {};
  try { report = JSON.parse(r.stdout); } catch { /* not JSON: the registry was unreachable */ }
  if (report.error || !report.metadata) {
    const why = report.error?.summary ?? r.stderr.trim().split('\n')[0] ?? 'no answer';
    return strict ? [`npm audit could not run: ${why}`] : (console.log(`npm audit skipped: ${why}`), []);
  }
  const v = report.metadata.vulnerabilities ?? {};
  const bad = (v.high ?? 0) + (v.critical ?? 0);
  return bad ? [`npm audit --omit=dev finds ${v.critical ?? 0} critical and ${v.high ?? 0} high vulnerabilities; run it to see them`] : [];
}

function listing(deps: Dependency[]): string {
  const counts = new Map<string, number>();
  for (const d of deps) counts.set(`${d.dev ? 'dev    ' : 'runtime'} ${d.licence}`, (counts.get(`${d.dev ? 'dev    ' : 'runtime'} ${d.licence}`) ?? 0) + 1);
  return [
    ...[...counts].sort().map(([k, n]) => `${String(n).padStart(4)}  ${k}`),
    '',
    'Runtime packages:',
    ...deps.filter((d) => !d.dev).map((d) => `  ${d.name}@${d.version}  ${d.licence}`),
  ].join('\n');
}

function main(argv: string[]): number {
  if (argv[0] === 'notices') {
    if (!argv[1] || !argv[2]) { console.error('usage: licence-gate.ts notices <folder holding node_modules> <out.md>'); return 2; }
    console.log(`wrote ${argv[2]} (${writeNotices(resolve(argv[1]), resolve(argv[2]))} packages)`);
    return 0;
  }
  const deps = lockDependencies(JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')));
  const problems = [
    ...checkDependencies(deps),
    ...checkWorkspaces(repo),
    ...checkTrackedFiles(trackedFiles(repo), (f) => statSync(join(repo, f)).size),
    ...(argv.includes('--audit') ? audit(repo, true) : []),
  ];
  if (argv.includes('--list')) console.log(listing(deps));
  const runtime = deps.filter((d) => !d.dev).length;
  if (problems.length) {
    console.error(`licence gate: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`licence gate ok: ${runtime} runtime and ${deps.length - runtime} dev packages on the allow lists, workspace licences match LICENSE, no sample files or keys tracked${argv.includes('--audit') ? ', npm audit clean' : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

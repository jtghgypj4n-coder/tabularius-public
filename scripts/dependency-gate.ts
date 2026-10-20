// The checks that keep the repository safe to make public:
//   1. Every package a user's install runs (the lock file's non-dev packages) has a licence we can ship.
//   2. Dev-only packages are listed with theirs; a copyleft one is refused too, but a weak one (MPL-2.0) is allowed.
//   3. Nothing is committed that must stay out: no file under fixtures/ (the public samples' terms are unknown, so
//      `npm run fixtures` downloads them) and no FileMaker file anywhere.
//   4. With --audit, `npm audit --omit=dev` finds no known high or critical vulnerability in what ships.
//
//   node --no-warnings scripts/dependency-gate.ts [--audit]
//
// Checks 1 to 3 need no network and also run in the test suite (packages/cli/test/dependency-gate.test.ts).
// The audit needs the npm registry, so run it by hand (or from a scheduled job on the owner's runner).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** Licences that may ship in what people install. */
export const RUNTIME_LICENCES = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Python-2.0', 'Unlicense']);
/** Dev tools are not shipped, so a weak copyleft licence is fine there (it only needs to stay unmodified). */
export const DEV_LICENCES = new Set([...RUNTIME_LICENCES, 'MPL-2.0']);

export interface LockedPackage { name: string; version: string; licence: string; dev: boolean }

/** The packages in a package-lock.json, leaving out this repository's own workspace packages. */
export function lockedPackages(lock: { packages?: Record<string, { version?: string; license?: unknown; dev?: boolean; link?: boolean }> }): LockedPackage[] {
  const out: LockedPackage[] = [];
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || p.link) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (name.startsWith('@tabularius/')) continue;
    out.push({ name, version: p.version ?? '?', licence: typeof p.license === 'string' ? p.license : 'UNKNOWN', dev: p.dev === true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * True when an SPDX expression ("MIT", "(MIT OR Apache-2.0)", "(A OR B) AND C") can be taken under allowed terms:
 * OR needs one side allowed, AND needs both. Anything it cannot read is refused.
 */
export function licenceAllowed(spdx: string, allowed: Set<string>): boolean {
  const tokens = spdx.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === '(') {
      const v = or();
      if (tokens[i++] !== ')') throw new Error('unbalanced');
      return v;
    }
    if (t === undefined || t === ')' || /^(AND|OR)$/i.test(t)) throw new Error('unreadable');
    return allowed.has(t);
  };
  const and = (): boolean => {
    let v = atom();
    while (/^AND$/i.test(tokens[i] ?? '')) { i++; v = atom() && v; }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (/^OR$/i.test(tokens[i] ?? '')) { i++; v = and() || v; }
    return v;
  };
  try {
    return or() && i === tokens.length;
  } catch {
    return false;
  }
}

/** What is wrong with the lock file's licences, one line each (empty when it is fine). */
export function licenceProblems(packages: LockedPackage[]): string[] {
  return packages
    .filter((p) => !licenceAllowed(p.licence, p.dev ? DEV_LICENCES : RUNTIME_LICENCES))
    .map((p) => `${p.name}@${p.version} is ${p.licence}, which is not allowed in ${p.dev ? 'dev tools' : 'what ships'}`);
}

const FILEMAKER_FILE = /\.(fmp12|fmp|fp7|fp5|fmpsl|fmpur|fmpreport)$/i;

/** What is wrong with a list of committed paths: sample files and FileMaker files must not be in the repository. */
export function committedProblems(paths: string[]): string[] {
  return paths
    .filter((p) => p.startsWith('fixtures/') || FILEMAKER_FILE.test(p))
    .map((p) => `${p} is committed, but ${p.startsWith('fixtures/') ? 'fixtures/ is downloaded by npm run fixtures and never committed' : 'FileMaker files are never committed'}`);
}

function main(): void {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const packages = lockedPackages(lock);
  const problems = [
    ...licenceProblems(packages),
    ...committedProblems(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean)),
  ];

  const byLicence = new Map<string, number>();
  for (const p of packages) byLicence.set(`${p.dev ? 'dev' : 'runtime'} ${p.licence}`, (byLicence.get(`${p.dev ? 'dev' : 'runtime'} ${p.licence}`) ?? 0) + 1);
  console.log('Licences in package-lock.json:');
  for (const [k, n] of [...byLicence].sort()) console.log(`  ${String(n).padStart(3)}  ${k}`);

  if (process.argv.includes('--audit')) {
    try {
      execFileSync('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      console.log('npm audit --omit=dev: no high or critical vulnerability');
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      problems.push(`npm audit --omit=dev found a high or critical vulnerability:\n${err.stdout ?? ''}${err.stderr ?? ''}`.trimEnd());
    }
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Dependencies and committed files are fine.');
}

if (import.meta.main) main();

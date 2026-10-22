// The checks that keep the repository safe to make public:
//   1. Every package a user's install runs (the lock file's non-dev packages) has a licence we can ship.
//   2. Dev-only packages are listed with theirs; a copyleft one is refused too, but a weak one (MPL-2.0) is allowed.
//   3. Nothing is committed that must stay out: no file under fixtures/ (the public samples' terms are unknown, so
//      `npm run fixtures` downloads them) and no FileMaker file anywhere.
//   4. Packages import only downward (fmp12, calc, store, then scripts and plug-ins, then server, then cli); the web
//      client imports nothing from the other packages. Leaks that already exist are listed in KNOWN_LEAKS and shrink.
//   5. With --audit, `npm audit --omit=dev` finds no known high or critical vulnerability in what ships.
//
//   node --no-warnings scripts/dependency-gate.ts [--audit]
//
// Checks 1 to 4 need no network and also run in the test suite (packages/cli/test/dependency-gate.test.ts).
// The audit needs the npm registry, so run it by hand (or from a scheduled job on the owner's runner).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** The packages a package may import from. `web` runs in the browser, so it imports none; nothing imports `web`, `cli` or `server` below it. */
export const ALLOWED_IMPORTS: Record<string, string[]> = {
  fmp12: [],
  calc: ['fmp12'],
  store: ['fmp12', 'calc'],
  plugins: ['fmp12', 'calc', 'store'],
  scripts: ['fmp12', 'calc', 'store'],
  server: ['fmp12', 'calc', 'store', 'plugins', 'scripts'],
  cli: ['fmp12', 'calc', 'store', 'plugins', 'scripts', 'server'],
  web: [],
};

/** Upward imports that exist today, as "file -> package". Fix one and delete its line; the test fails on a line that no longer applies. */
export const KNOWN_LEAKS: string[] = [
  'packages/store/src/store.ts -> scripts',
  'packages/server/src/page-draft.ts -> web',
  'packages/server/src/modernize.ts -> web',
];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return ['node_modules', 'test', 'e2e', 'evals'].includes(e.name) ? [] : sourceFiles(join(dir, e.name));
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [join(dir, e.name)] : [];
  });
}

/** Every "file -> package" import that goes to a package the file's own package may not use (tests, browser tests and evals are not scanned). */
export function packageImports(root: string, allowed: Record<string, string[]> = ALLOWED_IMPORTS): string[] {
  const out = new Set<string>();
  for (const pkg of Object.keys(allowed)) {
    for (const file of sourceFiles(join(root, 'packages', pkg))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/['"`](?:\.\.\/)+(fmp12|calc|store|plugins|scripts|server|cli|web)\//g)) {
        const target = m[1];
        if (target !== pkg && !allowed[pkg].includes(target)) out.add(`${file.slice(root.length + 1).split('\\').join('/')} -> ${target}`);
      }
    }
  }
  return [...out].sort();
}

/** What is wrong with the imports between packages: a new upward import, or a KNOWN_LEAKS line that is fixed and should go. */
export function layeringProblems(imports: string[], known: string[] = KNOWN_LEAKS): string[] {
  return [
    ...imports.filter((i) => !known.includes(i)).map((i) => `${i}: a package may not import from a higher one (see ALLOWED_IMPORTS in scripts/dependency-gate.ts); move the shared code down`),
    ...known.filter((k) => !imports.includes(k)).map((k) => `${k} is fixed: delete it from KNOWN_LEAKS in scripts/dependency-gate.ts`),
  ];
}

function main(): void {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const packages = lockedPackages(lock);
  const problems = [
    ...licenceProblems(packages),
    ...committedProblems(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean)),
    ...layeringProblems(packageImports(ROOT)),
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
  console.log('Dependencies, package layering and committed files are fine.');
}

if (import.meta.main) main();

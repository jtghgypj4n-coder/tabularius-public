// Builds the release twice from one commit, in clean clones at different paths, under different time zones,
// language settings and umasks, and fails when the two builds differ by a single byte. A release anyone can
// rebuild from the source and get the same files is a release anyone can check.
//
//   node scripts/verify-repro.ts [--commit REV] [--full] [--keep]
//
// By default each build stops after packing the program's files (scripts/build-release.ts --pack-only) and the
// pack, the licence notices and the software bill of materials are compared; --full builds the program itself
// (a copy of Node with the pack inside) as well, which needs 200 MB of space and the network for postject.
// When the packs differ it names the files inside that differ. Needs the network for `npm ci`. Only committed
// files are built: a change not yet committed is not part of the comparison.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unpack } from './build-release.ts';

const repo = resolve(import.meta.dirname, '..');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** The SHA-256 of every file in a folder, by name. */
export function hashFolder(dir: string): Map<string, string> {
  return new Map(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.name, sha256(readFileSync(join(dir, e.name)))]));
}

/** How two builds differ: files only one made, and files with different bytes. Empty means identical. */
export function compareBuilds(a: Map<string, string>, b: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (!a.has(name)) problems.push(`${name}: only the second build wrote it`);
    else if (!b.has(name)) problems.push(`${name}: only the first build wrote it`);
    else if (a.get(name) !== b.get(name)) problems.push(`${name}: bytes differ`);
  }
  return problems;
}

/** Which files inside two packs differ (and in what), so a nondeterministic build says where to look. */
export function comparePacks(a: Buffer, b: Buffer): string[] {
  const read = (p: Buffer) => new Map(unpack(p).map((f) => [f.path, f]));
  const [x, y] = [read(a), read(b)];
  const out: string[] = [];
  for (const path of [...new Set([...x.keys(), ...y.keys()])].sort()) {
    const [f, g] = [x.get(path), y.get(path)];
    if (!f) out.push(`${path}: only in the second pack`);
    else if (!g) out.push(`${path}: only in the first pack`);
    else if (f.mode !== g.mode) out.push(`${path}: mode ${f.mode.toString(8)} against ${g.mode.toString(8)}`);
    else if (!f.data.equals(g.data)) out.push(`${path}: contents differ`);
  }
  return out;
}

/** The two builds' conditions: everything a build could wrongly depend on is different. */
const CONDITIONS = [
  { label: 'first', folders: ['one', 'tabularius'], env: { TZ: 'UTC', LC_ALL: 'C', LANG: 'C' }, umask: '022' },
  { label: 'second', folders: ['a-longer-folder-name', 'nested', 'src'], env: { TZ: 'Pacific/Auckland', LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' }, umask: '077' },
];

function sh(cmd: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; umask?: string } = {}): void {
  const { umask, ...spawnOptions } = options;
  // umask is the shell's: set it, then run the command in that shell's process.
  const [file, argv] = umask && process.platform !== 'win32' ? ['sh', ['-c', 'umask "$0" && exec "$@"', umask, cmd, ...args]] : [cmd, args];
  const r = spawnSync(file, argv, { ...spawnOptions, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
}

function build(root: string, c: (typeof CONDITIONS)[number], rev: string, full: boolean): Map<string, string> {
  const dir = join(root, c.label, ...c.folders);
  mkdirSync(dir, { recursive: true });
  sh('git', ['clone', '--quiet', '--no-hardlinks', repo, dir], { umask: c.umask });
  sh('git', ['-C', dir, 'checkout', '--quiet', '--detach', rev], { umask: c.umask });
  const out = join(root, c.label, 'out');
  const args = [join(dir, 'scripts', 'build-release.ts'), '--out', out, '--version', 'repro', ...(full ? [] : ['--pack-only'])];
  const env = { ...process.env, ...c.env };
  sh(process.execPath, args, { cwd: dir, env, umask: c.umask });
  return hashFolder(out);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const keep = args.includes('--keep');
  const at = args.indexOf('--commit');
  const rev = spawnSync('git', ['-C', repo, 'rev-parse', at >= 0 ? args[at + 1] : 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  if (!rev) { console.error('no such commit'); process.exit(2); }
  if (spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()) console.log('note: uncommitted changes are not part of what is built');
  const root = mkdtempSync(join(tmpdir(), 'tabularius-repro-'));
  let failed = false;
  try {
    console.log(`building ${rev.slice(0, 12)} twice${full ? ' (whole program)' : ''}`);
    const [a, b] = CONDITIONS.map((c) => build(root, c, rev, full));
    const problems = compareBuilds(a, b);
    for (const [name, hash] of a) console.log(`${problems.some((p) => p.startsWith(`${name}:`)) ? 'DIFFERENT' : 'same     '} ${hash.slice(0, 16)}  ${name}`);
    for (const p of problems) console.error(`FAILED: ${p}`);
    const pack = [...a.keys()].find((n) => n.endsWith('.pack'));
    if (pack && problems.some((p) => p.startsWith(`${pack}:`))) {
      const [x, y] = CONDITIONS.map((c) => readFileSync(join(root, c.label, 'out', pack)));
      for (const p of comparePacks(x, y).slice(0, 30)) console.error(`  inside the pack: ${p}`);
    }
    failed = problems.length > 0;
    if (!failed) console.log('reproducible: both builds wrote the same files, byte for byte');
  } catch (e) {
    console.error((e as Error).message);
    failed = true;
  } finally {
    if (keep) console.log(`kept ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
}

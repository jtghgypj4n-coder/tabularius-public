import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type Run = { status: number; output: string };
type Gate = { file: string; reason: string };
type SlowTest = Gate & { when: string[] };
const run = (command: string, args: string[], cwd = ROOT): Run => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ?? ''}` };
};
const git = (...args: string[]) => run('git', args);
function statusEntries(root = ROOT): { code: string; file: string }[] {
  const status = run('git', ['status', '--porcelain=v1', '-z', '-uall'], root);
  if (status.status) throw new Error(status.output);
  const records = status.output.split('\0').filter(Boolean);
  const entries: { code: string; file: string }[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const code = record.slice(0, 2);
    entries.push({ code, file: record.slice(3) });
    if (/[RC]/.test(code)) i++; // -z gives the old path as a second record.
  }
  return entries;
}
const json = <T>(name: string): T => JSON.parse(readFileSync(join(ROOT, 'scripts', name), 'utf8')) as T;
const allTests = (): string[] => {
  const packages = join(ROOT, 'packages');
  return readdirSync(packages).flatMap((name) => {
    const dir = join(packages, name, 'test');
    return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.test.ts')).map((file) => `packages/${name}/test/${file}`) : [];
  }).sort();
};
export function changedFiles(): { files: string[]; missingMain: boolean } {
  const base = git('merge-base', 'HEAD', 'origin/main');
  const missingMain = base.status !== 0;
  const diff = missingMain ? undefined : git('diff', '--name-only', '-z', base.output.trim());
  if (diff?.status) throw new Error(diff.output);
  const committed = diff?.output.split('\0') ?? [];
  const pending = statusEntries().map((entry) => entry.file);
  return { files: [...new Set([...committed, ...pending].filter(Boolean))].sort(), missingMain };
}
export function selectTouchedTests(changed: string[], tests: string[], missingMain = false, readText: (file: string) => string = (file) => readFileSync(join(ROOT, file), 'utf8')): { tests: string[]; wider: boolean } {
  const chosen = new Set<string>();
  let wider = false;
  for (const file of changed) {
    if (/\.test\.ts$/.test(file) && tests.includes(file)) chosen.add(file);
    const source = /^packages\/([^/]+)\/src\/(.+)\.ts$/.exec(file);
    const broad = /^(scripts\/|package\.json$|\.github\/)/.test(file);
    if (broad) wider = true;
    if (file === 'package.json' || file.startsWith('.github/')) continue;
    if (!source && !broad) continue;
    const packageName = source?.[1];
    const relative = source ? `${source[2]}.ts` : file;
    const basename = relative.split('/').at(-1) ?? relative;
    const namedTest = source ? `packages/${packageName}/test/${basename.slice(0, -3)}.test.ts` : '';
    const candidates = tests;
    const matches = candidates.filter((test) => !source || !test.endsWith('/precheck.test.ts')).filter((test) => {
      if (test === namedTest) return true;
      const content = readText(test);
      return source ? content.includes(relative) || content.includes(basename) || content.includes(file) : content.includes(file);
    });
    if (source && !matches.length) {
      for (const test of tests.filter((test) => test.startsWith(`packages/${packageName}/test/`))) chosen.add(test);
    } else for (const test of matches) chosen.add(test);
  }
  if (missingMain) {
    const packages = new Set(changed.flatMap((file) => /^packages\/([^/]+)\//.exec(file)?.[1] ?? []));
    for (const test of tests) if (!packages.size || [...packages].some((name) => test.startsWith(`packages/${name}/test/`))) chosen.add(test);
  }
  return { tests: [...chosen].sort(), wider };
}
const errors = (output: string): string[] => output.split(/\r?\n/).filter((line) => /(?:^|\/)\S+\(\d+,\d+\): error TS\d+:/.test(line));
const errorFile = (line: string) => line.match(/^(.+?)\(\d+,\d+\): error TS\d+:/)?.[1]?.replaceAll('\\', '/') ?? '';
export function compareBaseline(output: string, baseline: string[], changed: string[], mainErrorCount = baseline.length): { ok: boolean; newErrors: string[]; errors: string[] } {
  const current = errors(output);
  const touched = new Set(changed);
  const old = new Set(baseline);
  const newErrors = current.filter((line) => touched.has(errorFile(line)) || (!old.has(line) && current.length > mainErrorCount));
  return { ok: current.length <= mainErrorCount && newErrors.length === 0, newErrors, errors: current };
}
export function treeHash(root = ROOT, head = git('show', '-s', '--format=%H', 'HEAD').output.trim()): string {
  const hash = createHash('sha256').update(head);
  const diff = run('git', ['diff', '--binary', 'HEAD'], root);
  if (diff.status) throw new Error(diff.output);
  hash.update(diff.output);
  for (const { file } of statusEntries(root).filter((entry) => entry.code === '??')) {
    const path = join(root, file);
    hash.update(file);
    hash.update(lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
  }
  return hash.digest('hex');
}
export function markerPath(root = ROOT): string {
  const checkout = createHash('sha256').update(resolve(root)).digest('hex');
  return join(tmpdir(), 'tabularius-precheck', checkout, 'precheck-ok');
}
export function writeMarker(head: string, hash: string, root = ROOT): void {
  const path = markerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${head} ${hash}\n`);
}
export function runPrecheck(options: { quick?: boolean; updateBaseline?: boolean; mainCheckout?: string; commandRunner?: (command: string, args: string[]) => Run } = {}): number {
  const execute = options.commandRunner ?? run;
  const start = performance.now();
  const rows: [string, number, boolean][] = [];
  const failures: string[] = [];
  const timed = (name: string, fn: () => boolean) => {
    const then = performance.now();
    let ok = false;
    try { ok = fn(); } catch (error) { failures.push(`${name}: ${String(error)}`); }
    rows.push([name, (performance.now() - then) / 1000, ok]);
  };
  let changed: string[] = [];
  let missingMain = false;
  let head = '';
  if (!options.updateBaseline) timed('changes', () => {
    const found = changedFiles();
    changed = found.files;
    missingMain = found.missingMain;
    head = git('show', '-s', '--format=%H', 'HEAD').output.trim();
    if (missingMain) console.log('origin/main missing: gates and whole touched packages will run');
    return Boolean(head);
  });
  if (options.updateBaseline) {
    timed('baseline', () => {
      const checkout = options.mainCheckout ? resolve(options.mainCheckout) : ROOT;
      const main = git('rev-parse', 'origin/main');
      const checkoutHead = run('git', ['rev-parse', 'HEAD'], checkout);
      const checkoutStatus = run('git', ['status', '--porcelain'], checkout);
      if (main.status || checkoutHead.status || checkoutStatus.status || checkoutHead.output.trim() !== main.output.trim() || checkoutStatus.output.trim()) {
        throw new Error('--update-baseline requires a clean checkout of current origin/main');
      }
      head = main.output.trim();
      const result = options.commandRunner ? execute('npm', ['run', 'typecheck']) : run('npm', ['run', 'typecheck'], checkout);
      const lines = errors(result.output);
      if (result.status && !lines.length) throw new Error(result.output);
      writeFileSync(join(ROOT, 'scripts/precheck-baseline.json'), JSON.stringify({ mainCommit: head, errors: lines, mainErrorCount: lines.length }, null, 2) + '\n');
      console.log(`baseline: ${lines.length} error lines saved from ${head}`);
      return true;
    });
  } else {
    timed('typecheck', () => {
      const result = execute('npm', ['run', 'typecheck']);
      const baseline = json<{ errors: string[]; mainErrorCount?: number }>('precheck-baseline.json');
      const mainCount = baseline.mainErrorCount ?? baseline.errors.length;
      const compared = compareBaseline(result.output, baseline.errors, changed, mainCount);
      if (result.status && !compared.errors.length) failures.push(result.output.trim().split('\n').at(-1) ?? 'typecheck failed');
      failures.push(...compared.newErrors);
      if (compared.errors.length > mainCount) failures.push(`typecheck: ${compared.errors.length} errors exceed baseline ${mainCount}`);
      return compared.ok && (result.status === 0 || compared.errors.length > 0);
    });
    const gates = json<Gate[]>('precheck-gates.json');
    const skip = json<Record<string, string>>('precheck-skip.json');
    timed('gates', () => {
      const paths = gates.map((gate) => gate.file).filter((file) => !skip[file]);
      for (const file of paths) if (!existsSync(join(ROOT, file))) throw new Error(`missing gate: ${file}`);
      const result = execute(process.execPath, ['--no-warnings', '--test', '--test-concurrency=2', '--test-reporter=spec', ...paths]);
      if (result.status) failures.push(...testFailures(result.output));
      return result.status === 0;
    });
    if (!options.quick) timed('touched-area', () => {
      const mapped = selectTouchedTests(changed, allTests(), missingMain);
      if (mapped.wider) console.log('wider change: CI will run the full suite');
      const slow = json<SlowTest[]>('precheck-slow.json').filter((test) => changed.some((file) => test.when.some((prefix) => prefix === '*' || file === prefix || file.startsWith(prefix)))).map((test) => test.file);
      const paths = [...new Set([...mapped.tests, ...slow])].filter((file) => !skip[file] && !gates.some((gate) => gate.file === file));
      if (!paths.length) return true;
      const result = execute(process.execPath, ['--no-warnings', '--test', '--test-concurrency=2', '--test-reporter=spec', ...paths]);
      if (result.status) failures.push(...testFailures(result.output));
      return result.status === 0;
    });
  }
  const passed = rows.every((row) => row[2]);
  if (passed && !options.updateBaseline) timed('marker', () => { writeMarker(head, treeHash(ROOT, head)); return true; });
  console.log('step          seconds  result');
  for (const [name, seconds, ok] of rows) console.log(`${name.padEnd(14)}${seconds.toFixed(1).padStart(7)}  ${ok ? 'PASS' : 'FAIL'}`);
  for (const failure of failures) console.log(failure);
  const ok = rows.every((row) => row[2]);
  console.log(ok ? `precheck: PASS ${head} ${((performance.now() - start) / 1000).toFixed(1)}s` : 'precheck: FAIL');
  return ok ? 0 : 1;
}
export function testFailures(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) if (/^[✖✗]/.test(lines[i]) || /not ok \d+/.test(lines[i])) {
    const tail = lines.slice(i + 1);
    const marker = tail.findIndex((line) => /AssertionError|Error:|error:/.test(line));
    const raw = marker < 0 ? undefined : tail[marker];
    const assertion = raw?.trim() === 'error: |-' ? tail.slice(marker + 1).find((line) => line.trim()) : raw;
    found.push(`${lines[i].trim()}${assertion ? ` — ${assertion.trim()}` : ''}`);
  }
  return found.length ? found : [output.trim().split('\n').at(-1) ?? 'test failed'];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkoutFlag = process.argv.indexOf('--main-checkout');
  process.exitCode = runPrecheck({ quick: process.argv.includes('--quick'), updateBaseline: process.argv.includes('--update-baseline'), mainCheckout: checkoutFlag < 0 ? undefined : process.argv[checkoutFlag + 1] });
}

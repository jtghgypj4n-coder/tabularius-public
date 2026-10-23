// Compare machine-normalized benchmark timings against a committed baseline.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CONFIG, TOLERANCE, compare, confirmedRegressions, median, medianRatios, ratios, wideElapsed, type Baseline, type BenchOutput, type RatioRow } from './bench-check-lib.ts';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--update-baseline')) throw new Error('usage: npm run bench:check -- [--update-baseline]');
const update = args.includes('--update-baseline');
// The calibration loop is pure CPU, so it cannot cancel out differences in disk, memory and SQLite behaviour between platforms: a Mac baseline
// read 50-60% slower on sorts and 60% faster on import on Linux. Each platform class keeps its own baseline; the Apple-silicon Mac one is the original file.
const platform = `${process.platform}-${process.arch}`;
const baselinePath = join(fileURLToPath(new URL('.', import.meta.url)), platform === 'darwin-arm64' ? 'bench-baseline.json' : `bench-baseline.${platform}.json`);
// One deliberately broad cold-process budget applies on every platform. It
// includes module loading and HTTP, which the CPU calibration cannot normalize.
const wideBudget = (JSON.parse(readFileSync(new URL('./bench-baseline.json', import.meta.url), 'utf8')) as Baseline).wide;
if (!wideBudget) throw new Error('missing wide benchmark budget');

function wideBatch(): number {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (loadavg()[0] >= 90) throw new Error('run benchmarks only when load1 < 90');
    const run = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('./bench-wide.ts', import.meta.url)),
      '--records', String(wideBudget!.records), '--tables', String(wideBudget!.tables)],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 180_000 });
    if (run.error) throw run.error;
    if (run.status !== 0) throw new Error(`wide benchmark failed (${run.status}): ${run.stderr.trim()}`);
    samples.push(wideElapsed(JSON.parse(run.stdout), wideBudget!));
  }
  const ms = median(samples);
  console.log(`Wide | Process start through first use | ${ms.toFixed(1)} ms | budget ${wideBudget!.maxMs} ms | ${ms > wideBudget!.maxMs ? 'over' : 'ok'}`);
  return ms;
}

function sample(): RatioRow[] {
  const load1 = loadavg()[0];
  if (load1 >= 90) throw new Error(`load1 is ${load1.toFixed(1)}; run benchmarks only when load1 < 90`);
  const run = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('./bench.ts', import.meta.url)),
    '--json', '--records', String(CONFIG.records), '--customers', String(CONFIG.customers), '--import', String(CONFIG.importRows), '--runs', String(CONFIG.runs)],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`benchmark failed (${run.status}): ${run.stderr.trim()}`);
  return ratios(JSON.parse(run.stdout) as BenchOutput);
}

function batch(): RatioRow[] {
  const samples: RatioRow[][] = [];
  for (let i = 0; i < 3; i++) {
    process.stderr.write(`Benchmark ${i + 1}/3\n`);
    samples.push(sample());
  }
  return medianRatios(samples);
}

function table(rows: ReturnType<typeof compare>): void {
  console.log('Area | Operation | Baseline ratio | Current ratio | Change | Result');
  console.log('--- | --- | ---: | ---: | ---: | ---');
  for (const row of rows) console.log(`${row.group} | ${row.operation} | ${row.baseline.toFixed(4)} | ${row.ratio.toFixed(4)} | ${(row.increase * 100).toFixed(1)}% | ${row.over ? 'over' : 'ok'}`);
}

const first = batch();
if (update) {
  const baseline: Baseline = { version: 1, config: CONFIG, tolerance: TOLERANCE, operations: first, ...(platform === 'darwin-arm64' ? { wide: wideBudget } : {}) };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  table(compare(first, baseline));
  console.log(`Updated ${baselinePath}`);
} else {
  if (!existsSync(baselinePath)) throw new Error(`no benchmark baseline for ${platform}; run npm run bench:check -- --update-baseline on an idle machine of this kind and commit ${baselinePath}`);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  const initial = compare(first, baseline);
  table(initial);
  if (initial.some((row) => row.over)) {
    console.log('Above tolerance; confirming with three more benchmark runs.');
    const second = compare(batch(), baseline);
    table(second);
    const confirmed = confirmedRegressions(initial, second);
    if (confirmed.length) {
      console.error(`Regression confirmed in ${confirmed.length} operation(s).`);
      process.exitCode = 1;
    } else console.log('No operation exceeded tolerance in two consecutive batches.');
  } else console.log('All operations within 40% tolerance.');
}

if (wideBatch() > wideBudget.maxMs) {
  console.log('Wide run above budget; confirming with three more fresh processes.');
  if (wideBatch() > wideBudget.maxMs) {
    console.error('Regression confirmed in wide cold start / first use.');
    process.exitCode = 1;
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticks, valueTicks } from '../src/chart.ts';
import { spawn } from 'node:child_process';

test('chart axes tick at round values covering the data, from zero', () => {
  assert.deepEqual(ticks(0, 95), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(ticks(0, 281421906), [0, 100000000, 200000000, 300000000]);
  assert.deepEqual(ticks(-1000, 6500), [-2000, 0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(ticks(0, 0), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(ticks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test('a value axis Chart Setup fixes runs between its bounds', () => {
  assert.deepEqual(valueTicks([3, 7, 9], 0, 10), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(valueTicks([40, 72], 0, 100), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(valueTicks([3, 7], 1, 10), [1, 2, 4, 6, 8, 10]);
  // Only a minimum: the maximum follows the data.
  assert.deepEqual(valueTicks([3, 95], 0), [0, 20, 40, 60, 80, 100]);
  // Bounds that make no range are ignored.
  assert.deepEqual(valueTicks([0, 95], 10, 10), [0, 20, 40, 60, 80, 100]);
});

test('large tightly spaced bounds return a bounded tick list', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { ticks } from ${JSON.stringify(new URL('../src/chart.ts', import.meta.url).href)};
    const result = ticks(1e16, 1e16 + 2);
    process.stdout.write(JSON.stringify(result));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
    const watchdog = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, timedOut: true }); }, 10_000);
    child.once('exit', (code) => { clearTimeout(watchdog); resolve({ code, timedOut: false }); });
  });
  assert.equal(result.timedOut, false, 'tick generation exceeded its child-process watchdog');
  assert.equal(result.code, 0, stderr);
  const out = JSON.parse(stdout) as number[];
  assert.ok(out.length <= 7, `expected a small tick list, got ${out.length}`);
  assert.ok(out.every(Number.isFinite));
});

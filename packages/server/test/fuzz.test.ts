import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, type Target } from '../../../scripts/fuzz/generate.ts';
import { Runner, fuzz } from '../../../scripts/fuzz/harness.ts';
import { exercise } from '../../../scripts/fuzz/targets.ts';
import { stubCommands } from './edge-test-helpers.ts';

// The long run is `npm run fuzz`; this is a fixed-seed, fixed-iteration smoke so CI cost stays flat.
const SMOKE_ITERATIONS = 150;
const REGRESSIONS = fileURLToPath(new URL('./fuzz-regressions/', import.meta.url));

test('every reader target survives a fixed-seed fuzz smoke in a child process', async (t) => {
  stubCommands(t);
  const runner = new Runner({ timeoutMs: 10_000, memoryMb: 256 });
  t.after(() => runner.close());
  for (const target of TARGETS) {
    const report = await fuzz({ target, seed: 1, iterations: SMOKE_ITERATIONS, runner });
    assert.equal(report.iterations, SMOKE_ITERATIONS, target);
    assert.deepEqual(report.findings.map(f => `${f.kind}: ${f.signature}\n${f.input.toString('base64')}\n${f.detail}`), [], target);
  }
});

test('the harness reports each failure kind once, deduplicated and minimised', async (t) => {
  stubCommands(t);
  for (const [mode, kind, signature] of [
    ['error', 'error', /^TypeError$/],
    ['hang', 'hang', /^hang$/],
    ['exit', 'crash', /^crash: exit 70$/],
    ['oom', 'crash', /^crash: (SIG\w+|exit \d+) \| FATAL ERROR: .*heap/i],
  ] as const) {
    const report = await fuzz({
      target: 'calc', seed: 1, iterations: 2, timeoutMs: mode === 'hang' ? 300 : 10_000, memoryMb: 32, minimiseRuns: mode === 'error' ? 400 : 1,
      env: { ...process.env, TABULARIUS_FUZZ_SELFTEST: mode },
    });
    assert.equal(report.findings.length, 1, mode);
    const [finding] = report.findings;
    assert.equal(finding.kind, kind, mode);
    assert.match(finding.signature, signature, mode);
    if (mode === 'error') assert.ok(finding.input.length <= 1, `minimised to ${finding.input.length} bytes`);
  }
});

test('minimised inputs from past fuzz findings are read without an unexpected error', async (t) => {
  const files = readdirSync(REGRESSIONS).filter(f => f.endsWith('.json')).sort();
  assert.ok(files.length > 0);
  for (const file of files) {
    const { target, input } = JSON.parse(readFileSync(join(REGRESSIONS, file), 'utf8')) as { target: Target; input: string };
    await t.test(file, async () => { await exercise(target, Buffer.from(input, 'base64')); });
  }
});

// No file is capture-only unless the operator names it: TABULARIUS_CAPTURE_ONLY (comma-separated
// prefixes) or `--capture-only` (setCaptureOnlyDefaults). A name matches any file starting with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { captureOnlyDefaults, captureOnly, setCaptureOnlyDefaults } from '../src/outbound.ts';

const outbound = new URL('../src/outbound.ts', import.meta.url).href;
const probe = (env: Record<string, string>, code: string) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import * as o from ${JSON.stringify(outbound)}; ${code}`], { env: { ...process.env, TABULARIUS_CAPTURE_ONLY: '', ...env }, encoding: 'utf8' }));

test('nothing is capture-only by default', () => {
  assert.deepEqual(probe({}, 'console.log(JSON.stringify([o.captureOnlyDefaults(), o.captureOnly("Anything"), o.captureOnly("Any_File")]))'), [[], false, false]);
});

test('TABULARIUS_CAPTURE_ONLY names the prefixes, trimmed, empty entries ignored', () => {
  const r = probe({ TABULARIUS_CAPTURE_ONLY: ' Client_ , ,Archive.fmp12' }, 'console.log(JSON.stringify([o.captureOnlyDefaults(), o.captureOnly("client_orders.fmp12"), o.captureOnly("Archive"), o.captureOnly("Archive 2")]))');
  assert.deepEqual(r, [['Client_', 'Archive.fmp12'], true, true, true]);
  assert.equal(probe({ TABULARIUS_CAPTURE_ONLY: 'Client_' }, 'console.log(JSON.stringify(o.captureOnly("Other")))'), false);
});

test('setCaptureOnlyDefaults adds to the list, and replace starts it over', () => {
  const before = [...captureOnlyDefaults()];
  try {
    setCaptureOnlyDefaults(['Zed*'], true);
    assert.equal(captureOnly('zed_file'), true);
    assert.equal(captureOnly('Other'), false);
    setCaptureOnlyDefaults(['Other']);
    assert.equal(captureOnly('Other'), true);
    assert.equal(captureOnly('zed_file'), true);
    // The extra list given beside the defaults works as before.
    assert.equal(captureOnly('Third', ['third']), true);
    setCaptureOnlyDefaults([], true);
    assert.equal(captureOnly('Other'), false);
  } finally {
    setCaptureOnlyDefaults(before, true);
  }
});

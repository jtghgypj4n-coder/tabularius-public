import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { TIMED, phases } from './test-e2e-lib.ts';

const files = ['packages/web/e2e/browse.e2e.ts', 'packages/web/e2e/render-budgets.e2e.ts', 'packages/web/e2e/finds.e2e.ts'];

test('the timed file runs alone, after the others, one at a time', () => {
  const [rest, timed] = phases(files, ['--test-concurrency=2', '--test-timeout=240000']);
  assert.deepEqual(rest, { files: [files[0], files[2]], args: ['--test-concurrency=2', '--test-timeout=240000'] });
  assert.deepEqual(timed, { files: [files[1]], args: ['--test-timeout=240000', '--test-concurrency=1'] });
});

test('every file runs exactly once, and a run with no timed file has one phase', () => {
  const all = phases(files, []).flatMap((phase) => phase.files);
  assert.deepEqual([...all].sort(), [...files].sort());
  assert.equal(phases([files[0]], []).length, 1);
});

test('the timed files exist', () => {
  const present = readdirSync(new URL('../packages/web/e2e/', import.meta.url));
  for (const file of TIMED) assert.ok(present.includes(file), `${file} is not in packages/web/e2e`);
});

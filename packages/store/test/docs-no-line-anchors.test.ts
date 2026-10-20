import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A line number in a doc goes stale at the next edit of the file it names, so docs point at
// the file only. This keeps the script-steps page from growing them again.
test('docs/script-steps-support.md cites source files, not line numbers', () => {
  const text = readFileSync(join(import.meta.dirname, '../../../docs/script-steps-support.md'), 'utf8');
  const stale = [...text.matchAll(/<!--\s*[\w./-]+\.ts:\d+[^>]*-->/g)].map((m) => m[0]);
  assert.deepEqual(stale, []);
});

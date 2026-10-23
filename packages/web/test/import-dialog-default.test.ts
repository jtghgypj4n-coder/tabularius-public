import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('the leave-out-repeats checkbox is unchecked by default and names the plan keys', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'import-dialog.ts'), 'utf8');
  assert.match(source, /data-fk': 'skip-duplicates'\s*\}\) as HTMLInputElement/);
  assert.doesNotMatch(source, /data-fk': 'skip-duplicates', checked:/);
  assert.match(source, /judged on: \$\{plan\.keys\.join\(', '\)\}/);
  assert.match(source, /action === 'add' && plan\.keys\.length/);
  assert.match(source, /No repeat check applies\./);
});

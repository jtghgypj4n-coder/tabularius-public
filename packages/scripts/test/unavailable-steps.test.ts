// The error 3 step lists in unavailable-steps.ts are the "Not supported (error 3)" table of docs/script-steps-support.md,
// and the steps that need set-up are in its "Partly supported" table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPT_STEP_NAMES } from '../../fmp12/src/index.ts';
import { ERROR_3_STEPS, ERROR_3_UNLESS_CONFIGURED } from '../src/unavailable-steps.ts';

const docs = readFileSync(join(import.meta.dirname, '../../../docs/script-steps-support.md'), 'utf8');
const section = docs.slice(docs.indexOf('## Not supported (error 3)'), docs.indexOf('\n## ', docs.indexOf('## Not supported (error 3)') + 5));
// First cell of each row: step names separated by ";"; a name followed by "(when ...)" or "(via ...)" depends on set-up.
const cells = [...section.matchAll(/^\| ([^|]+) \| /gm)].map((m) => m[1].trim()).filter((c) => c !== 'Script step');

test('the error 3 step lists match the support table in the docs', () => {
  const always = new Set<string>();
  const sometimes = new Set<string>();
  for (const cell of cells) {
    const conditional = cell.includes('(');
    for (const part of cell.replace(/\([^)]*\)/g, '').split(';')) {
      const name = part.trim();
      if (name) (conditional ? sometimes : always).add(name);
    }
  }
  assert.deepEqual([...ERROR_3_STEPS].sort(), [...always].sort());
  // A step that works once the server is set up for it (mail, script network access, the embedding model) is not
  // "not supported", so its row lives in "Partly supported". A conditional row here must be one of these lists,
  // and each name in these lists is either a conditional row here or a row in "Partly supported".
  const partlyStart = docs.indexOf('## Partly supported');
  const partly = docs.slice(partlyStart, docs.indexOf('\n## ', partlyStart + 5));
  const partlyCells = [...partly.matchAll(/^\| ([^|]+) \| /gm)].map((m) => m[1]);
  for (const name of sometimes) assert.ok(ERROR_3_UNLESS_CONFIGURED.has(name), `${name} is conditional in the table but not in ERROR_3_UNLESS_CONFIGURED`);
  for (const name of ERROR_3_UNLESS_CONFIGURED) {
    assert.ok(sometimes.has(name) || partlyCells.some((c) => c.includes(name)), `${name} is in neither the conditional rows nor Partly supported`);
  }
});

test('every name in the error 3 lists is a script step', () => {
  const known = new Set<string>(SCRIPT_STEP_NAMES);
  for (const name of [...ERROR_3_STEPS, ...ERROR_3_UNLESS_CONFIGURED]) assert.ok(known.has(name), `${name} is not a step name`);
});

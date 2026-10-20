// The error 3 step lists in unavailable-steps.ts are the "Not supported (error 3)" table of docs/script-steps-support.md.
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
  // The RAG steps work when the server has the embedding model: the table says so in its text, not in the name.
  for (const name of ['Configure RAG Account', 'Perform RAG Action']) {
    always.delete(name);
    sometimes.add(name);
  }
  assert.deepEqual([...ERROR_3_STEPS].sort(), [...always].sort());
  assert.deepEqual([...ERROR_3_UNLESS_CONFIGURED].sort(), [...sometimes].sort());
});

test('every name in the error 3 lists is a script step', () => {
  const known = new Set<string>(SCRIPT_STEP_NAMES);
  for (const name of [...ERROR_3_STEPS, ...ERROR_3_UNLESS_CONFIGURED]) assert.ok(known.has(name), `${name} is not a step name`);
});

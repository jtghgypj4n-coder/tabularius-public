// docs/sort-languages.md lists each language and the locale that stands in for it; design mode's list of languages is the
// same list. These fail when the code, the page and the dialog stop agreeing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SORT_LANGUAGES } from '../../calc/src/collation.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const page = readFileSync(join(root, 'docs', 'sort-languages.md'), 'utf8');

test('docs/sort-languages.md lists every language with the locale that stands in for it', () => {
  const rows = [...page.matchAll(/^\| ([A-Za-z_]+) \| ([A-Za-z-]+) \| (.+) \|$/gm)].map((m) => ({ name: m[1], locale: m[2], checked: m[3] }));
  assert.deepEqual(rows.map((r) => `${r.name} ${r.locale}`), SORT_LANGUAGES.map((l) => `${l.name} ${l.locale}`));
  for (const r of rows) assert.match(r.checked, /approximation of Claris, unverified/, r.name);
});

test('design mode offers every language, under the name FileMaker gives it', () => {
  const source = readFileSync(join(root, 'packages', 'web', 'src', 'design', 'schema.ts'), 'utf8');
  const list = source.slice(source.indexOf('const LANGUAGES'), source.indexOf('];', source.indexOf('const LANGUAGES')));
  const offered = [...list.matchAll(/\['([A-Za-z_]+)', '[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual([...offered].sort(), SORT_LANGUAGES.map((l) => l.name).sort());
});

// Every dialog the web client builds has an accessible name: an aria-label, or an aria-labelledby that points at a
// heading whose id is written in the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));

test('web client dialogs are named', () => {
  const bad: string[] = [];
  for (const file of files(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/h\('dialog',([^\n]*)/g)) {
      const attrs = m[1];
      const line = src.slice(0, m.index).split('\n').length;
      const by = /'aria-labelledby':\s*'([^']+)'/.exec(attrs);
      if (by) {
        if (!src.includes(`id: '${by[1]}'`)) bad.push(`${file}:${line} points at #${by[1]}, which nothing in the file defines`);
      } else if (!/'aria-label':/.test(attrs)) bad.push(`${file}:${line} has no aria-label or aria-labelledby`);
    }
  }
  assert.deepEqual(bad, []);
});

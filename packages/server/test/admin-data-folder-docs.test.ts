import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

test('ADMIN.md lists every literal Tabularius data-folder name in package sources', () => {
  const doc = readFileSync(join(root, 'ADMIN.md'), 'utf8');
  const table = doc.split('\n').filter((line) => line.startsWith('| `'))
    .map((line) => (/^\| `([^`]+)`/.exec(line)?.[1] ?? '').replace(/\/$/, ''));
  const listed = new Set(table);
  const names = new Set<string>();
  for (const pkg of readdirSync(join(root, 'packages'))) {
    const src = join(root, 'packages', pkg, 'src');
    try {
      for (const file of sourceFiles(src)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
          if (match[2].includes('${')) continue;
          for (const name of match[2].matchAll(/\.openhbam-[A-Za-z0-9._-]+/g)) {
            names.add(name[0].replace(/[.-]+$/, '').split('/')[0]);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const missing = [...names].filter((name) => !listed.has(name)).sort();
  assert.deepEqual(missing, [], `ADMIN.md data-folder table is missing: ${missing.join(', ')}`);
});

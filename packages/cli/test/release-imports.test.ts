// The release executable carries packages/ but not the workspace links in node_modules/@tabularius
// (scripts/build-release.ts removes them), so code that imports another package by its @tabularius name
// runs from a checkout and fails to start in the release build. Packages import each other by path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(p);
    return /\.(ts|js|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
}

test('no program code imports another package by its @tabularius name', () => {
  const found: string[] = [];
  for (const pkg of readdirSync(join(root, 'packages'))) {
    let files: string[];
    try {
      files = sources(join(root, 'packages', pkg, 'src'));
    } catch {
      continue;
    }
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        if (/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@tabularius\//.test(line)) found.push(`${relative(root, f)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(found, []);
});

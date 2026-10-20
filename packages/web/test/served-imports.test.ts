// The web client is served from packages/web only (webclient.ts serveStatic), so a module that imports a file
// outside it fails to load in the browser, taking the whole app shell with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PASSKEY_SECOND_FACTOR_REQUIRED } from '../../store/src/error-codes.ts';

const web = join(import.meta.dirname, '..');
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);

test('web client modules import only files the server serves (inside packages/web)', () => {
  const outside: string[] = [];
  for (const file of sources(join(web, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const target = resolve(dirname(file), m[1]);
      if (relative(web, target).startsWith('..')) outside.push(`${relative(web, file)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(outside, []);
});

test("the web client's passkey sign-in code matches the server's", () => {
  const main = readFileSync(join(web, 'src', 'main.ts'), 'utf8');
  assert.match(main, new RegExp(`const PASSKEY_SECOND_FACTOR_REQUIRED = ${PASSKEY_SECOND_FACTOR_REQUIRED};`));
});

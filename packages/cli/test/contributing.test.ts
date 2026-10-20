// CONTRIBUTING.md names npm scripts and files. If one is renamed, the guide must follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const guide = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');

test('every npm script CONTRIBUTING.md tells you to run exists', () => {
  const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
  const named = [...guide.matchAll(/npm (?:run )?([a-z][a-z:]*)/g)].map((m) => m[1]);
  assert.ok(named.includes('docs:reference') && named.includes('fixtures'), 'the guide still names the generated-docs and fixtures commands');
  for (const name of named) assert.ok(name in scripts || name === 'install' || name === 'test', `npm script "${name}" exists`);
});

test('every file CONTRIBUTING.md links to exists', () => {
  for (const [, target] of guide.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(existsSync(join(root, target)), `${target} exists`);
});

test('.nvmrc names a Node version the engines field accepts', () => {
  const nvm = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
  const min = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines: { node: string } }).engines.node.replace('>=', '');
  const parts = (v: string) => v.split('.').map(Number);
  const [a, b = 0] = parts(nvm);
  const [ma, mb = 0] = parts(min);
  assert.ok(a > ma || (a === ma && b >= mb), `.nvmrc ${nvm} is at least ${min}`);
});

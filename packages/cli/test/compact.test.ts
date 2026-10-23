import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { commandStubEnv } from '../../../scripts/test-command-stubs.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('compact command reports one or all synthetic hosted files as text or JSON', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = commandStubEnv(t);
  for (const name of ['A', 'B']) {
    const path = join(dir, `${name}.openhbam.sqlite`);
    createStore(path);
    const store = new Store(path, name);
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
      for (let n = 0; n < 20; n++) store.create('Items', { Name: `row-${n}` });
      for (let n = 1; n <= 10; n++) store.delete('Items', n);
    } finally { store.close(); }
  }
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, 'compact', dir, ...args], { encoding: 'utf8', env, timeout: 10_000 });
  const one = run('A', '--json');
  assert.equal(one.status, 0, one.stderr);
  assert.equal(JSON.parse(one.stdout).name, 'A');
  assert.equal(JSON.parse(one.stdout).report.walAfterBytes, 0);
  const all = run();
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /A: \d+ -> \d+ bytes; WAL/);
  assert.match(all.stdout, /B: \d+ -> \d+ bytes; WAL/);
  const unknown = run('Missing');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /no database "Missing"/);
});

test('compact command explains an empty hosted folder', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-compact-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['--no-warnings', main, 'compact', dir], { encoding: 'utf8', env: commandStubEnv(t), timeout: 10_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no hosted files/);
});

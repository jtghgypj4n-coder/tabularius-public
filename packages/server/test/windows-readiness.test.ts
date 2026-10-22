import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupFolder } from '../src/backup.ts';
import { createStore } from '../../store/src/index.ts';
import { commitRestore, recoverRestore } from '../src/restore-files.ts';

test('Windows backup length preflight leaves no partial set or pruned backups', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  createStore(join(root, 'Test.openhbam.sqlite'));
  const dest = join(root, 'a'.repeat(170));
  await assert.rejects(backupFolder(root, dest, 1, undefined, { platform: 'win32' }), /shorter.*folder/);
  assert.equal(existsSync(dest), false);
});
test('restore preserves live files when the first rename is blocked', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-restore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'live');
  const staged = join(root, 'staged');
  writeFileSync(target, 'old'); writeFileSync(staged, 'new');
  const locked = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
  assert.throws(() => commitRestore(root, [{ staged, target }], locked), { code: 'EPERM' });
  assert.equal(readFileSync(target, 'utf8'), 'old');
  assert.equal(readFileSync(staged, 'utf8'), 'new');
  recoverRestore(root);
});

import { findExecutable } from '../src/containers.ts';
test('Windows thumbnail tools resolve exe names in a quoted PATH with spaces', () => {
  const seen: string[] = [];
  const executable = 'C:\\Program Files\\tools\\pdftoppm.exe';
  const found = findExecutable('pdftoppm', 'win32', { PATH: 'C:\\missing;"C:\\Program Files\\tools"' }, (file) => { seen.push(file); return file === executable; });
  assert.equal(found, executable);
  assert.ok(seen.includes('C:\\missing\\pdftoppm.exe'));
  assert.equal(findExecutable('pdftoppm', 'linux', { PATH: '/first:/second' }, (file) => file === '/second/pdftoppm'), '/second/pdftoppm');
});

import { writeDurable } from '../../store/src/durable.ts';
test('a locked rollback retains its journal and saved data for later recovery', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-restore-locked-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'live'), staged = join(root, 'staged');
  writeFileSync(target, 'old'); writeFileSync(staged, 'new');
  let calls = 0;
  assert.throws(() => commitRestore(root, [{ staged, target }], (from, to) => {
    if (++calls > 1) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
    writeDurable(from, to);
  }), /rollback was incomplete/);
  assert.ok(existsSync(join(root, '.restore-journal.json')));
  recoverRestore(root);
  assert.equal(readFileSync(target, 'utf8'), 'old');
  assert.equal(existsSync(join(root, '.restore-journal.json')), false);
});

import { databaseNameProblem } from '../src/solution-builder.ts';
test('new database names reject Windows devices before a store is created', () => {
  assert.equal(databaseNameProblem('Generated Data'), undefined);
  for (const name of ['CON', 'NUL', 'COM1', 'LPT²', 'aux']) assert.ok(databaseNameProblem(name), name);
});

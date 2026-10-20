// Test restores: a backup set is restored to a scratch folder and every file
// opened as the server would, so a backup is known to come back, not hoped to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Host, STORE_EXT, backupFolder, serve } from '../src/index.ts';
import { lastRestore, restoreTestDue, testRestore } from '../src/backup-verify.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const FILE = 'Charts' + STORE_EXT;
let dir: string;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-test-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  new Host(dir).close();
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

test('a set restores to a scratch folder and opens, with its record and account counts; the set itself is untouched', { skip }, async () => {
  const dest = join(dir, 'sets');
  const set = (await backupFolder(dir, dest, 0, '')).dir;
  const before = readdirSync(set).sort();
  assert.equal(restoreTestDue(dest), true);
  const r = await testRestore(set, '');
  assert.equal(r.ok, true);
  const opened = r.files[FILE] as { tables: number; records: number; accounts: number };
  assert.equal(opened.tables, 10);
  assert.ok(opened.records > 0);
  assert.ok(opened.accounts >= 1);
  assert.deepEqual(lastRestore(set), r, 'kept with the set');
  assert.deepEqual(readdirSync(set).sort(), before, 'the set gets no -wal or -shm files');
  assert.equal(restoreTestDue(dest), false, 'one a day is enough');
  assert.equal(restoreTestDue(dest, 24 * 3600_000, Date.now() + 25 * 3600_000), true);
});

test('a copy that is not a working file is reported, not passed', { skip }, async () => {
  const dest = join(dir, 'bad');
  const set = (await backupFolder(dir, dest, 0, '')).dir;
  writeFileSync(join(set, FILE), 'not a database');
  const r = await testRestore(set, '');
  assert.equal(r.ok, false);
  assert.equal(typeof r.files[FILE], 'string');
});

test('the admin console runs a test restore and lists the outcome with each set', { skip }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-restore-admin-'));
  copyFileSync(fixture, join(folder, 'Charts.fmp12'));
  const s = await serve({ dir: folder, port: 0, log: () => {} });
  try {
    const post = (path: string) => fetch(`${s.url}/tabularius/admin/v1${path}`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } }).then((r) => r.json());
    const status = () => fetch(`${s.url}/tabularius/admin/v1/status`).then((r) => r.json());
    await post('/backup');
    // The backup is checked in the background; let that finish first.
    for (let i = 0; i < 100 && !(await status()).backups.sets[0]?.check; i++) await new Promise((ok) => setTimeout(ok, 50));
    const name = (await status()).backups.sets[0].name;
    const r = await post(`/backups/${name}/test-restore`);
    assert.equal(r.ok, true);
    assert.equal((await status()).backups.sets[0].restored.ok, true);
  } finally {
    (s.server as Server).close();
    rmSync(folder, { recursive: true });
  }
});

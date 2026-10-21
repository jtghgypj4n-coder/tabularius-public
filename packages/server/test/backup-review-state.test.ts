import './backup-review-guard.ts';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readJsonStateSync, sweepStateTempsSync, writeJsonStateSync } from '../../store/src/durable.ts';
import { createStore, Store, STORE_FORMAT } from '../../store/src/index.ts';
import { filesNewerThan, encryptedUnchecked } from '../../cli/src/newer-files.ts';
import { encryptFileSync } from '../src/encrypt.ts';
import { backupFolderProblem, checkBackupFolder } from '../src/backup-folder.ts';
import { retainCurrentCredentials } from '../src/backup.ts';
import { Schedules } from '../src/schedules.ts';
import type { Host } from '../src/host.ts';

function folder(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'tabularius-review-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('concurrent manifest writers through an alias retain all updates across restart', { timeout: 30_000 }, async (t) => {
  const root = folder(t);
  const live = join(root, 'live'); const alias = join(root, 'alias');
  fs.mkdirSync(live); fs.symlinkSync(live, alias, 'junction');
  const url = new URL('../src/backup-info.ts', import.meta.url).href;
  const children = [live, alias].map((dir) => spawn(process.execPath, ['--no-warnings', '--input-type=module', '--eval', `
    import { updateBackupInfo } from ${JSON.stringify(url)};
    for (let i = 0; i < 12; i++) updateBackupInfo(${JSON.stringify(dir)}, (s) => { s.count = (s.count ?? 0) + 1; });
  `], { stdio: ['ignore', 'ignore', 'inherit'] }));
  t.after(() => { for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill(); });
  const results = await Promise.all(children.map((c) => once(c, 'exit')));
  assert.ok(results.every(([code]) => code === 0));
  assert.deepEqual(readJsonStateSync(join(live, 'backup.json')), { count: 24 });
});

test('state cleanup retains a live foreign writer and future temps, and preserves corrupt evidence once', (t) => {
  const root = folder(t);
  const now = Date.now();
  const own = join(root, `.state.${process.pid}.${randomUUID()}.tmp`);
  const foreign = join(root, `.state.${process.ppid}.${randomUUID()}.tmp`);
  for (const path of [own, foreign]) { fs.writeFileSync(path, 'synthetic'); fs.utimesSync(path, new Date(now - 7200000), new Date(now - 7200000)); }
  assert.deepEqual(sweepStateTempsSync(root, now - 86400000), []);
  assert.deepEqual(sweepStateTempsSync(root, now), [own]);
  assert.equal(fs.existsSync(foreign), true);
  const state = join(root, 'backup.json');
  fs.writeFileSync(state, '{"é":');
  for (let i = 0; i < 2; i++) assert.throws(() => readJsonStateSync(state), /not valid JSON/);
  assert.equal(fs.readFileSync(state, 'utf8'), '{"é":');
  assert.equal(fs.readdirSync(root).filter((n) => n.includes('.damaged-')).length, 1);
  writeJsonStateSync(state, { recovered: true });
  assert.deepEqual(readJsonStateSync(state), { recovered: true });
});

test('backup destination aliases cannot enter live container folders', (t) => {
  const root = folder(t);
  const live = join(root, 'live'); const containers = join(live, 'Files'); const alias = join(root, 'alias');
  fs.mkdirSync(containers, { recursive: true }); fs.symlinkSync(containers, alias, 'junction');
  const dest = join(alias, 'é 🧪');
  assert.throws(() => checkBackupFolder(dest, live), /inside/);
  assert.match(backupFolderProblem(dest, live)!, /inside/);
  assert.equal(fs.existsSync(dest), false);
});

test('backup destination cache expires by elapsed time despite a backward wall clock and resets on edit', (t) => {
  const root = folder(t); const live = join(root, 'live'); const dest = join(root, 'dest'); const changed = join(root, 'changed');
  fs.mkdirSync(live); fs.mkdirSync(dest); fs.mkdirSync(changed);
  let monotonic = 100;
  t.mock.method(performance, 'now', () => monotonic);
  const host = { dir: live, onAdd: [], names: () => [], scriptOptions: () => ({}) } as unknown as Host;
  const schedules = new Schedules(host);
  t.after(() => schedules.stop());
  const s = schedules.create({ kind: 'backup', name: 'synthetic', dest, enabled: false });
  fs.rmSync(dest, { recursive: true });
  t.mock.method(Date, 'now', () => 0);
  assert.equal(schedules.all()[0].unavailable, undefined);
  monotonic += 60_001;
  assert.match(schedules.all()[0].unavailable!, /isn't there/);
  schedules.update(s.id, { dest: changed });
  assert.equal(schedules.all()[0].unavailable, undefined);
});

test('encrypted format inspection preserves ciphertext and distinguishes a live plaintext working copy', (t) => {
  const root = folder(t); const path = join(root, 'État.openhbam.sqlite');
  createStore(path);
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO _fm_meta(key,json) VALUES ('storeFormat',?) ON CONFLICT(key) DO UPDATE SET json=excluded.json").run(String(STORE_FORMAT + 1)); db.close();
  encryptFileSync(path, path + '.enc', 'synthetic key'); fs.rmSync(path);
  const before = fs.readFileSync(path + '.enc');
  assert.equal(encryptedUnchecked(root, '').length, 1);
  assert.equal(filesNewerThan(root, STORE_FORMAT, 'synthetic key').length, 1);
  assert.deepEqual(fs.readFileSync(path + '.enc'), before);
  createStore(path);
  assert.equal(encryptedUnchecked(root, '').length, 0);
  assert.deepEqual(filesNewerThan(root, STORE_FORMAT, 'synthetic key'), []);
});

test('unreadable current credentials refuse restore, while damaged current credentials disable historical passwords', { skip: process.getuid?.() === 0 || process.platform === 'win32' }, (t) => {
  const root = folder(t); const path = join(root, 'current.sqlite'); const staged = join(root, 'staged.sqlite');
  createStore(path);
  const store = new Store(path);
  store.setPassword('Éva', 'synthetic password', '[Full Access]'); store.close();
  fs.copyFileSync(path, staged);
  const before = fs.readFileSync(staged);
  fs.chmodSync(path, 0);
  try { assert.throws(() => retainCurrentCredentials(path, staged)); }
  finally { fs.chmodSync(path, 0o600); }
  assert.deepEqual(fs.readFileSync(staged), before);
  fs.writeFileSync(path, Buffer.alloc(4096, 0x55));
  retainCurrentCredentials(path, staged);
  const db = new DatabaseSync(staged, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM _fm_accounts WHERE password_hash IS NOT NULL OR password_disabled != 1').get()!.n, 0);
  } finally { db.close(); }
});

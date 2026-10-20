import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { backupFolder, restoreAt, restoreBackup, restorePoint, restorePointTo } from '../src/backup.ts';
import { testRestore, verifySet } from '../src/backup-verify.ts';
import { readBackupInfo, writeBackupInfo } from '../src/backup-info.ts';
import { recoverRestore } from '../src/restore-files.ts';

const file = 'A.openhbam.sqlite';
const rel = 'Files/A/document.txt';
function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-backup-batch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'live');
  mkdirSync(live);
  for (const name of ['A', 'B']) {
    createStore(join(live, name + '.openhbam.sqlite'));
    const store = new Store(join(live, name + '.openhbam.sqlite'), name);
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value', type: 'text' }] }]);
    store.create('Items', { Value: 'base' });
    store.close();
  }
  mkdirSync(join(live, 'Files/A'), { recursive: true });
  writeFileSync(join(live, rel), 'base');
  return { root, live, dest: join(root, 'Backups') };
}

test('AR-server-backup-ops-04: case 3', async (t) => {
  const { live, dest } = setup(t);
  const set = (await backupFolder(live, dest, 0, '')).dir;
  rmSync(join(set, 'B.openhbam.sqlite'));
  for (const check of [verifySet, testRestore]) {
    const result = await check(set, '');
    assert.equal(result.ok, false);
    assert.match(String(result.files['B.openhbam.sqlite']), /missing/);
  }
  const before = readFileSync(join(live, file));
  await assert.rejects(restoreBackup(live, set, undefined, ''), /B.openhbam.sqlite.*missing/);
  await assert.rejects(restoreAt(live, dest, Date.now(), undefined, ''), /B.openhbam.sqlite.*missing/);
  assert.deepEqual(readFileSync(join(live, file)), before);
});

test('AR-server-backup-ops-05: case 3', async (t) => {
  const { live, dest } = setup(t);
  const first = (await backupFolder(live, dest, 0, '')).dir;
  const point = restorePoint(dest, file, Date.now())!;
  for (const destination of [live, join(live, 'Copy')]) {
    mkdirSync(destination, { recursive: true });
    await restorePointTo(point, join(destination, file), '');
    assert.equal(readFileSync(join(destination, rel), 'utf8'), 'base');
  }
  await assert.rejects(restorePointTo(point, join(live, 'Renamed.openhbam.sqlite'), ''), /external.*different database name/);
  assert.equal(existsSync(join(live, 'Renamed.openhbam.sqlite')), false);
  const before = readFileSync(join(live, file));
  let read = false;
  await assert.rejects(restorePointTo({ ...point, logs: [{ at: Date.now(), read: async () => { read = true; return Buffer.alloc(0); } }] }, join(live, file), ''), /external.*progressive logs/);
  assert.equal(read, false);
  assert.deepEqual(readFileSync(join(live, file)), before);
  assert.equal(readFileSync(join(live, rel), 'utf8'), 'base');
  assert.equal((await verifySet(first, '')).ok, true);
});

test('AR-server-backup-ops-05: case 4', async (t) => {
  const { live, dest } = setup(t);
  await backupFolder(live, dest, 0, '');
  const store = new Store(join(live, file), 'A');
  store.update('Items', 1, { Value: 'live' });
  store.close();
  writeFileSync(join(live, rel), 'live');
  const before = readFileSync(join(live, file));
  const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import { restoreAt } from ${JSON.stringify(new URL('../src/backup.ts', import.meta.url).href)};
    import { armCrashPointForTest } from ${JSON.stringify(new URL('../../store/src/crash-point.ts', import.meta.url).href)};
    armCrashPointForTest('restore:after-publish');
    await restoreAt(process.argv[1], process.argv[2], Date.now(), undefined, '');
  `, live, dest], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 73, result.stderr);
  const journal = JSON.parse(readFileSync(join(live, '.restore-journal.json'), 'utf8'));
  assert.ok(journal.files.some((entry: { target: string }) => entry.target === file));
  assert.ok(journal.files.some((entry: { target: string }) => entry.target === 'Files/A'));
  recoverRestore(live);
  assert.deepEqual(readFileSync(join(live, file)), before);
  assert.equal(readFileSync(join(live, rel), 'utf8'), 'live');
});

test('AR-server-backup-ops-05: case 5', async (t) => {
  const { live, dest } = setup(t);
  const first = (await backupFolder(live, dest, 0, '')).dir;
  const info = readBackupInfo<{ finished: Record<string, string> }>(first);
  const at = Date.now();
  info.finished[file] = new Date(at - 2000).toISOString();
  writeBackupInfo(first, info);
  const logDir = join(first, 'progressive/A');
  mkdirSync(logDir, { recursive: true });
  const d = new Date(at - 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.000.wal`;
  writeFileSync(join(logDir, name), 'not read');
  await assert.rejects(restoreAt(live, dest, at, undefined, ''), /external.*progressive logs/);
  assert.ok(!readdirSync(live).some((f) => f.endsWith('.restoring')));
});

test('AR-server-backup-ops-05: case 6', async (t) => {
  const { live, dest } = setup(t);
  const store = new Store(join(live, file), 'A');
  let id: number;
  try {
    store.applyDesign([{ op: 'createField', table: 'Items', name: 'Pic', type: 'container', options: { externalStorage: { path: 'Items/Pic/' } } }]);
    store.setContainer('Items', 1, 'Pic', 1, { filename: 'managed.txt', mime: 'text/plain', data: Buffer.from('managed bytes') });
    id = Number(store.sql.prepare('SELECT id FROM _fm_containers WHERE external IS NOT NULL').get()!.id);
    assert.equal(store.externalContainerCheck().missing, 0);
  } finally { store.close(); }
  await backupFolder(live, dest, 0, '');
  rmSync(join(live, 'RC_Data_FMS'), { recursive: true });
  await restoreAt(live, dest, Date.now(), undefined, '');
  const restored = new Store(join(live, file), 'A');
  try {
    assert.equal(restored.externalContainerCheck().missing, 0);
    assert.equal(Buffer.from(restored.container(id!)!.data).toString(), 'managed bytes');
  } finally { restored.close(); }
});

test('AR-server-backup-ops-05: case 7', async (t) => {
  const { live, dest } = setup(t);
  rmSync(join(live, 'Files'), { recursive: true });
  await backupFolder(live, dest, 0, '');
  const point = restorePoint(dest, file, Date.now())!;
  const store = new Store(join(live, file), 'A');
  let log: Buffer;
  try {
    store.sql.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint = 0');
    store.sql.exec("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (1, 'new.txt', 'text/plain', 'file', x'', 'new.txt')");
    log = readFileSync(join(live, file + '-wal'));
  } finally { store.close(); }
  const before = readFileSync(join(live, file));
  await assert.rejects(restorePointTo({ ...point, logs: [{ at: Date.now(), read: async () => log }] }, join(live, file), ''), /external.*progressive logs/);
  assert.deepEqual(readFileSync(join(live, file)), before);
});

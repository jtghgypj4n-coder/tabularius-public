import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { backupFolder, backupSets, restoreAt, restoreBackup, restorePoint, restorePointTo } from '../src/backup.ts';
import { stageExternal, verifyExternal } from '../src/backup-external.ts';
import { checksum, testRestore, verifySet } from '../src/backup-verify.ts';
import { readBackupInfo, writeBackupInfo } from '../src/backup-info.ts';

const file = 'A.openhbam.sqlite';
const rel = 'Files/A/document.txt';
function setup(t: TestContext, external = false) {
  const root = mkdtempSync(join(tmpdir(), 'tabularius-restorability-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'live');
  mkdirSync(live);
  createStore(join(live, file));
  const store = new Store(join(live, file), 'A');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value', type: 'text' }] }]);
  store.create('Items', { Value: 'base' });
  if (external) {
    mkdirSync(join(live, 'Files/A'), { recursive: true });
    writeFileSync(join(live, rel), 'container bytes');
    store.sql.exec("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (1, 'document.txt', 'text/plain', 'file', x'', 'document.txt')");
  }
  store.close();
  return { live, dest: join(root, 'Backups') };
}
function change(path: string) {
  const db = new DatabaseSync(path);
  try { db.exec("UPDATE Items SET Value = 'changed'"); } finally { db.close(); }
}

test('AR-server-backup-ops-03: case 1', async (t) => {
  const { live, dest } = setup(t, true);
  await backupFolder(live, dest, 1, 'key A');
  const next = await backupFolder(live, dest, 1, 'key B');
  assert.equal((await verifySet(next.dir, 'key B')).ok, true);
  const staged = await stageExternal(next.dir, live, ['A'], 'key B');
  staged.cleanup();
  rmSync(join(live, 'Files'), { recursive: true });
  await restoreBackup(live, next.dir, undefined, 'key B');
  assert.equal(readFileSync(join(live, rel), 'utf8'), 'container bytes');
  assert.equal(backupSets(dest).length, 1);
});

test('AR-server-backup-ops-03: case 2', async (t) => {
  const { live, dest } = setup(t, true);
  const set = (await backupFolder(live, dest, 0, 'key A')).dir;
  for (const key of ['', 'key B']) {
    assert.ok(Object.keys(await verifyExternal(set, key)).includes(rel));
  }
});

test('AR-server-backup-ops-03: case 3', async (t) => {
  const { live, dest } = setup(t);
  const previous = await backupFolder(live, dest, 1, 'key A');
  const remove = fs.rmSync;
  let injected = false;
  t.mock.method(fs, 'rmSync', (path: fs.PathLike, options?: fs.RmOptions) => {
    if (String(path).endsWith('.partial/' + file) && existsSync(String(path) + '.enc')) {
      writeFileSync(String(path) + '.enc', 'injected output');
      injected = true;
    }
    return remove(path, options);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(backupFolder(live, dest, 1, 'key A'));
    assert.equal(injected, true);
    assert.ok(existsSync(previous.dir));
    assert.equal(backupSets(dest).length, 1);
    assert.ok(!readdirSync(dest).some((f) => f.endsWith('.partial')));
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('AR-server-backup-ops-04: case 1', async (t) => {
  const { live, dest } = setup(t);
  const set = (await backupFolder(live, dest, 0, '')).dir;
  rmSync(join(set, file));
  for (const check of [verifySet, testRestore]) {
    const result = await check(set, '');
    assert.equal(result.ok, false);
    assert.match(String(result.files[file]), /missing|ENOENT/);
  }
});

test('AR-server-backup-ops-04: case 2', async (t) => {
  const { live, dest } = setup(t);
  rmSync(join(live, file));
  const set = (await backupFolder(live, dest, 0, '')).dir;
  for (const check of [verifySet, testRestore]) assert.equal((await check(set, '')).ok, true);
  writeBackupInfo(set, {});
  for (const check of [verifySet, testRestore]) assert.equal((await check(set, '')).ok, false);
});

for (const key of ['', 'key A']) test(`AR-server-backup-ops-05: case ${key ? 2 : 1}`, async (t) => {
  const { live, dest } = setup(t, true);
  await backupFolder(live, dest, 0, key);
  rmSync(join(live, 'Files'), { recursive: true });
  const result = await restoreAt(live, dest, Date.now(), undefined, key);
  assert.equal(result.length, 1);
  assert.equal(readFileSync(join(live, rel), 'utf8'), 'container bytes');
});

test('AR-server-backup-ops-04,05,06', async (t) => {
  const cases = ['edited', 'absent', 'unlisted checksum', 'external absent', 'external key', 'encrypted edited'] as const;
  for (const damage of cases) await t.test(damage, async (t) => {
    const external = damage.startsWith('external');
    const key = damage === 'external key' || damage === 'encrypted edited' ? 'key A' : '';
    const { live, dest } = setup(t, external);
    const set = (await backupFolder(live, dest, 0, key)).dir;
    const point = restorePoint(dest, file, Date.now())!;
    const info = readBackupInfo<{ sha256: Record<string, string>; external: Record<string, { sha256: string }> }>(set);
    if (damage === 'edited') change(point.copy);
    if (damage === 'absent') rmSync(point.copy);
    if (damage === 'unlisted checksum') { delete info.sha256[file]; writeBackupInfo(set, info); }
    if (damage === 'external absent') rmSync(join(set, rel));
    if (damage === 'external key') {
      const { encryptFile } = await import('../src/encrypt.ts');
      await encryptFile(join(live, rel), join(set, rel + '.enc'), 'key B');
      info.external[rel].sha256 = await checksum(join(set, rel + '.enc'));
      writeBackupInfo(set, info);
    }
    if (damage === 'encrypted edited') {
      const bytes = readFileSync(point.copy); bytes[bytes.length - 1] ^= 1; writeFileSync(point.copy, bytes);
    }
    change(join(live, file));
    const before = readFileSync(join(live, file));
    const calls = {
      restoreBackup: () => restoreBackup(live, set, undefined, key),
      restoreAt: () => restoreAt(live, dest, Date.now(), undefined, key),
      restorePointTo: () => restorePointTo(point, join(live, file), key),
      testRestore: async () => { assert.equal((await testRestore(set, key)).ok, false); },
      verifySet: async () => { assert.equal((await verifySet(set, key)).ok, false); },
    };
    for (const [name, run] of Object.entries(calls)) await t.test(name, async () => {
      if (name === 'testRestore' || name === 'verifySet') await run();
      else await assert.rejects(run);
      assert.deepEqual(readFileSync(join(live, file)), before);
      assert.ok(!readdirSync(live).some((f) => f.includes('.restoring')));
      if (external) assert.equal(readFileSync(join(live, rel), 'utf8'), 'container bytes');
    });
  });
});

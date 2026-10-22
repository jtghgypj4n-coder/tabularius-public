import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitRestore } from '../src/restore-files.ts';
import { writeDurable } from '../../store/src/durable.ts';
import { createStore } from '../../store/src/index.ts';
import { backupFolder, restoreBackup } from '../src/backup.ts';
import { restoreExternal } from '../src/backup-external.ts';
import { checksum, verifySet } from '../src/backup-verify.ts';

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'backup-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'live');
  const set = join(root, 'set');
  mkdirSync(folder); mkdirSync(set);
  return { root, folder, set };
}

test('X1.1: a hand-built manifest cannot replace a sibling directory', async (t) => {
  const { root, folder, set } = setup(t);
  const victim = join(root, 'Victim');
  mkdirSync(victim);
  writeFileSync(join(victim, 'keep'), 'live');
  for (const rel of ['../Victim/keep', 'Unknown/Victim/keep', '/Files/Victim/keep', 'C:/Files/Victim/keep', 'Files/C:Victim/keep', 'Files/Victim/C:keep', 'Files/Victim/keep:stream', 'Files/Victim/../../keep', 'Files/Victim/../keep', 'Files/Victim/..\\keep', 'Files/Victim//keep']) {
    writeFileSync(join(set, 'backup.json'), JSON.stringify({ external: { [rel]: { sha256: 'unused' } } }));
    await assert.rejects(restoreExternal(set, folder, ['Victim']), /unsafe external path/i);
    assert.equal(readFileSync(join(victim, 'keep'), 'utf8'), 'live');
  }
  for (const root of [set, folder]) {
    mkdirSync(join(root, 'Files'), { recursive: true });
    symlinkSync(victim, join(root, 'Files', 'Victim'));
    writeFileSync(join(set, 'backup.json'), JSON.stringify({ external: { 'Files/Victim/keep': { sha256: 'unused' } } }));
    await assert.rejects(restoreExternal(set, folder, ['Victim']), /unsafe external path/i);
    rmSync(join(root, 'Files', 'Victim'));
  }
});

test('X1.2: one changed byte prevents every database replacement', async (t) => {
  for (const key of ['', 'backup key']) {
    const { folder, set } = setup(t);
    const names = ['A.openhbam.sqlite', 'B.openhbam.sqlite'];
    for (const name of names) createStore(join(folder, name));
    const backup = (await backupFolder(folder, set, 0, key)).dir;
    for (const name of names) {
      const db = new DatabaseSync(join(folder, name));
      try { db.exec('CREATE TABLE changed_after_backup (value TEXT)'); } finally { db.close(); }
    }
    const damaged = join(backup, names[1] + (key ? '.enc' : ''));
    const bytes = readFileSync(damaged);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(damaged, bytes);
    const before = names.map((name) => readFileSync(join(folder, name)));
    const unchanged = () => names.forEach((name, i) => {
      assert.deepEqual(readFileSync(join(folder, name)), before[i]);
      assert.equal(existsSync(join(folder, name + '.restoring')), false);
    });
    await assert.rejects(restoreBackup(folder, backup, undefined, key), /changed on disk|checksum/);
    unchanged();
    if (!key) {
      // Even a matching checksum cannot make a non-database acceptable.
      writeFileSync(damaged, 'not a database');
      const info = JSON.parse(readFileSync(join(backup, 'backup.json'), 'utf8'));
      info.sha256[names[1]] = await checksum(damaged);
      writeFileSync(join(backup, 'backup.json'), JSON.stringify(info));
      await assert.rejects(restoreBackup(folder, backup, undefined, key), /not a database/);
      unchanged();
      // External staging also has to succeed before any database is replaced.
      const clean = (await backupFolder(folder, set, 0, key)).dir;
      const cleanInfo = JSON.parse(readFileSync(join(clean, 'backup.json'), 'utf8'));
      cleanInfo.external = { 'Files/A/missing': { sha256: 'unused' } };
      writeFileSync(join(clean, 'backup.json'), JSON.stringify(cleanInfo));
      await assert.rejects(restoreBackup(folder, clean, undefined, key), /Files\/A\/missing: missing backup file; use a complete backup set and try the restore again/);
      unchanged();
    }
  }
  // Failure after a later rename restores earlier databases and their WAL too.
  const { folder, set } = setup(t);
  const a = join(folder, 'A'); const b = join(folder, 'B');
  const nextA = join(set, 'A'); const nextB = join(set, 'B');
  for (const path of [a, b, a + '-wal']) writeFileSync(path, 'original');
  for (const path of [nextA, nextB]) writeFileSync(path, 'replacement');
  assert.throws(() => commitRestore(folder, [
    { staged: nextA, target: a }, { target: a + '-wal' }, { staged: nextB, target: b },
  ], (from, to) => {
    writeDurable(from, to);
    if (from === nextB) throw new Error('injected directory sync failure');
  }), /injected directory sync failure/);
  for (const path of [a, b, a + '-wal']) assert.equal(readFileSync(path, 'utf8'), 'original');

});

test('X1.3: unreadable manifest fails verification without overwriting the evidence', async (t) => {
  const { set } = setup(t);
  createStore(join(set, 'A.openhbam.sqlite'));
  writeFileSync(join(set, 'backup.json'), '{');
  const result = await verifySet(set, '');
  assert.equal(result.ok, false);
  assert.match(result.files['backup.json'], /unreadable manifest/i);
  assert.equal(readFileSync(join(set, 'backup.json'), 'utf8'), '{');
});

for (const key of ['', 'key']) test(`restore refuses a database listed in the manifest but missing from the set${key ? ' encrypted' : ''}`, async (t) => {
  const { folder, set } = setup(t);
  const names = ['A.openhbam.sqlite', 'B.openhbam.sqlite'];
  for (const name of names) createStore(join(folder, name));
  const backup = (await backupFolder(folder, set, 0, key)).dir;
  rmSync(join(backup, names[1] + (key ? '.enc' : '')));
  const before = names.map((name) => readFileSync(join(folder, name)));
  await assert.rejects(restoreBackup(folder, backup, undefined, key), /B\.openhbam\.sqlite: missing database copy/);
  names.forEach((name, i) => assert.deepEqual(readFileSync(join(folder, name)), before[i]));
  // Even a completely empty set names the missing database, rather than succeeding.
  rmSync(join(backup, names[0] + (key ? '.enc' : '')));
  await assert.rejects(restoreBackup(folder, backup, undefined, key), /A\.openhbam\.sqlite: missing database copy/);
});

test('a database absent from the manifest cannot replace its live database', async (t) => {
  const { folder, set } = setup(t);
  const name = 'A.openhbam.sqlite';
  createStore(join(folder, name));
  const backup = (await backupFolder(folder, set, 0, '')).dir;
  createStore(join(backup, 'Unlisted.openhbam.sqlite'));
  writeFileSync(join(folder, 'Unlisted.openhbam.sqlite'), 'keep live');
  const before = readFileSync(join(folder, name));
  await assert.rejects(restoreBackup(folder, backup, undefined, ''), /Unlisted\.openhbam\.sqlite: not listed in the database inventory/);
  assert.equal(readFileSync(join(folder, 'Unlisted.openhbam.sqlite'), 'utf8'), 'keep live');
  assert.deepEqual(readFileSync(join(folder, name)), before);
});

test('database restore requires backup.json when either generation has containers', async (t) => {
  for (const containersIn of ['live', 'set']) {
    const { folder, set } = setup(t);
    const name = 'A.openhbam.sqlite';
    createStore(join(folder, name));
    const backup = (await backupFolder(folder, set, 0, '')).dir;
    const root = containersIn === 'live' ? folder : backup;
    mkdirSync(join(root, 'Files/A'), { recursive: true });
    writeFileSync(join(root, 'Files/A/keep'), 'keep container');
    rmSync(join(backup, 'backup.json'));
    const before = readFileSync(join(folder, name));
    await assert.rejects(restoreBackup(folder, backup, undefined, ''), /unreadable manifest.*backup.json/);
    assert.deepEqual(readFileSync(join(folder, name)), before);
    assert.equal(readFileSync(join(root, 'Files/A/keep'), 'utf8'), 'keep container');
  }
});

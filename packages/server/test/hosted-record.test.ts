import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { backupFolder, restoreAt, restoreBackup } from '../src/backup.ts';
import { Host } from '../src/host.ts';
import { approveInRecord, approveRestoredFiles, firstStartRecord, HOSTED_RECORD_FILE, loadHostedRecord, vet } from '../src/hosted-record.ts';

function folder(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'hosted-record-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('record is strict, atomic, and a damaged copy cannot be overwritten', (t) => {
  const dir = folder(t);
  assert.equal(loadHostedRecord(dir), undefined);
  firstStartRecord(dir, [{ name: 'A', id: 'one' }]);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, HOSTED_RECORD_FILE)).mode & 0o777, 0o600);
  assert.equal(vet(loadHostedRecord(dir), 'a', 'one'), 'approved');
  assert.equal(vet(loadHostedRecord(dir), 'A', 'two'), 'held');
  assert.equal(existsSync(join(dir, HOSTED_RECORD_FILE + '.tmp')), false);
  approveInRecord(dir, 'B', 'two', 'admin', 'admin');
  assert.equal(vet(loadHostedRecord(dir), 'B', 'two'), 'approved');
  approveInRecord(dir, '__proto__', 'three', 'admin', 'admin');
  assert.equal(vet(loadHostedRecord(dir), '__proto__', 'three'), 'approved');
  assert.equal(vet(loadHostedRecord(dir), 'constructor', 'three'), 'held');
  const path = join(dir, HOSTED_RECORD_FILE);
  writeFileSync(path, '{');
  assert.equal(loadHostedRecord(dir), null);
  assert.equal(vet(loadHostedRecord(dir), 'A', 'one'), 'unknown-record');
  assert.throws(() => approveInRecord(dir, 'C', 'three', 'admin', 'admin'), /damaged/);
  assert.equal(readFileSync(path, 'utf8'), '{');
  for (const wrong of [{ version: 2, files: {} }, { version: 1, files: { a: { id: 7 } } }, { version: 1, files: {}, extra: true }]) {
    writeFileSync(path, JSON.stringify(wrong));
    assert.equal(loadHostedRecord(dir), null);
  }
});

test('an abandoned record temp does not block an approval', (t) => {
  const dir = folder(t);
  const temp = join(dir, HOSTED_RECORD_FILE + '.tmp');
  writeFileSync(temp, 'interrupted write');
  approveInRecord(dir, 'A', 'one', 'operator', 'admin');
  assert.equal(loadHostedRecord(dir)?.files.a.by, 'operator');
  assert.equal(vet(loadHostedRecord(dir), 'A', 'one'), 'approved');
  assert.equal(existsSync(temp), false);
});

test('restore approvals merge and backups omit the local record', async (t) => {
  const root = folder(t);
  const live = join(root, 'live'); const dest = join(root, 'backups');
  mkdirSync(live); mkdirSync(dest);
  createStore(join(live, 'A.openhbam.sqlite'));
  approveInRecord(live, 'Old', 'older', 'admin', 'admin');
  const backup = await backupFolder(live, dest, 0, '');
  assert.equal(readdirSync(backup.dir).includes(HOSTED_RECORD_FILE), false);
  createStore(join(live, 'B.openhbam.sqlite'));
  await restoreBackup(live, backup.dir, 'A', '');
  const record = loadHostedRecord(live);
  assert.equal(record?.files.old.id, 'older');
  assert.equal(record?.files.a.how, 'restore');
  assert.equal(record?.files.b, undefined);
  assert.equal(readdirSync(live).some((name) => name === HOSTED_RECORD_FILE + '.tmp'), false);
  approveRestoredFiles(live, ['B']);
  assert.equal(loadHostedRecord(live)?.files.b.how, 'restore');
  approveInRecord(live, 'A', 'replaced', 'admin', 'admin');
  await restoreAt(live, dest, Date.now() + 1000, 'A', '');
  assert.equal(loadHostedRecord(live)?.files.a.how, 'restore');
});

test('a damaged record does not turn a committed restore into an error', async (t) => {
  const root = folder(t);
  const live = join(root, 'live'); const dest = join(root, 'backups');
  mkdirSync(live); mkdirSync(dest);
  createStore(join(live, 'A.openhbam.sqlite'));
  const backup = await backupFolder(live, dest, 0, '');
  rmSync(join(live, 'A.openhbam.sqlite'));
  writeFileSync(join(live, HOSTED_RECORD_FILE), '{');
  const lines: string[] = [];
  assert.deepEqual(await restoreBackup(live, backup.dir, 'A', '', { log: (line) => lines.push(line) }), ['A.openhbam.sqlite']);
  assert.equal(existsSync(join(live, 'A.openhbam.sqlite')), true);
  assert.equal(readFileSync(join(live, HOSTED_RECORD_FILE), 'utf8'), '{');
  assert.equal(vet(loadHostedRecord(live), 'A', 'anything'), 'unknown-record');
  assert.ok(lines.some((line) => /damaged.*held/i.test(line)));
  const host = new Host(live);
  assert.equal(host.isHeld('A'), true);
  await host.close();
  rmSync(join(live, 'A.openhbam.sqlite'));
  lines.length = 0;
  assert.equal((await restoreAt(live, dest, Date.now() + 1000, 'A', '', { log: (line) => lines.push(line) })).length, 1);
  assert.equal(readFileSync(join(live, HOSTED_RECORD_FILE), 'utf8'), '{');
  assert.ok(lines.some((line) => /damaged.*held/i.test(line)));
  const afterPointRestore = new Host(live);
  assert.equal(afterPointRestore.isHeld('A'), true);
  await afterPointRestore.close();
});

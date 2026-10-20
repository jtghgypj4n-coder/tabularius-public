// Backup verification: each set is read back after it is taken and older
// ones are checked again, so a damaged copy is found before it is needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Server } from 'node:http';
import { Host, STORE_EXT, backupFolder, backupSets, serve } from '../src/index.ts';
import { lastCheck, verifyAfterBackup, verifySet } from '../src/backup-verify.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const FILE = 'Charts' + STORE_EXT;
let dir: string;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-verify-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  new Host(dir).close();
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

/** Overwrites a few bytes in the middle of a file, as a failing disk might. */
function damage(path: string) {
  const fd = openSync(path, 'r+');
  writeSync(fd, Buffer.alloc(4096, 0x5a), 0, 4096, Math.floor(statSync(path).size / 2 / 4096) * 4096);
  closeSync(fd);
}

test('a good set passes; a copy changed on disk afterwards is caught, by its checksum or by reading it back', { skip }, async () => {
  const dest = join(dir, 'plain');
  const set = (await backupFolder(dir, dest, 0, '')).dir;
  const check = await verifySet(set, '');
  assert.deepEqual(check.files, { [FILE]: 'ok' });
  assert.equal(check.ok, true);
  assert.deepEqual(lastCheck(set), check, 'kept with the set');
  assert.ok(!existsSync(join(set, FILE + '-wal')), 'checking leaves nothing behind');

  damage(join(set, FILE));
  const bad = await verifySet(set, '');
  assert.equal(bad.ok, false);
  assert.equal(bad.files[FILE], 'changed on disk since it was taken');

  // A set taken before checksums were recorded is still read back in full.
  const info = JSON.parse(readFileSync(join(set, 'backup.json'), 'utf8'));
  delete info.sha256;
  writeFileSync(join(set, 'backup.json'), JSON.stringify(info));
  const read = await verifySet(set, '');
  assert.equal(read.ok, false);
  assert.notEqual(read.files[FILE], 'ok');
});

test('a set taken while nothing was hosted passes', { skip }, async () => {
  const empty = join(dir, 'empty-folder');
  mkdirSync(empty, { recursive: true });
  const set = (await backupFolder(empty, join(dir, 'empty'), 0, '')).dir;
  const check = await verifySet(set, '');
  assert.deepEqual(check.files, {});
  assert.equal(check.ok, true);
});

test('an encrypted set is checked by decrypting it; without the passphrase it is flagged, not passed', { skip }, async () => {
  const dest = join(dir, 'sealed');
  const set = (await backupFolder(dir, dest, 0, 'correct horse')).dir;
  assert.equal((await verifySet(set, 'correct horse')).ok, true);
  const none = await verifySet(set, '');
  assert.equal(none.ok, false);
  assert.match(none.files[FILE], /TABULARIUS_BACKUP_KEY/);
  const wrong = await verifySet(set, 'wrong');
  assert.equal(wrong.ok, false);
  assert.ok(!existsSync(join(set, FILE)), 'nothing decrypted is left in the set');
});

test('after a backup the new set is checked, then the set checked longest ago', { skip }, async () => {
  const dest = join(dir, 'rolling');
  const a = basename((await backupFolder(dir, dest, 0, '')).dir);
  const b = basename((await backupFolder(dir, dest, 0, '')).dir);
  await verifySet(join(dest, b), '');
  const c = basename((await backupFolder(dir, dest, 0, '')).dir);
  const said: string[] = [];
  const check = await verifyAfterBackup(dest, c, (m) => said.push(m), '');
  assert.equal(check.ok, true);
  assert.deepEqual(said, [`backup ${c} checked: 1 file ok`, `backup ${a} checked: 1 file ok`], 'the never-checked set before the one checked already');
});

test('backups in the same second get ordered names and retention keeps the newest sets', { skip }, async () => {
  const dest = join(dir, 'same-second');
  const at = new Date(2026, 5, 15, 12, 34, 56).getTime();
  const now = () => at;
  const one = await backupFolder(dir, dest, 2, '', { now });
  const two = await backupFolder(dir, dest, 2, '', { now });
  const three = await backupFolder(dir, dest, 2, '', { now });
  const names = [one, two, three].map((r) => basename(r.dir));
  const stamp = (time: number) => {
    const d = new Date(time);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };
  assert.deepEqual(names, [stamp(at), stamp(at + 1000), stamp(at + 2000)]);
  assert.deepEqual(one.removed, []);
  assert.deepEqual(two.removed, []);
  assert.deepEqual(three.removed, [names[0]]);
  assert.deepEqual(backupSets(dest), names.slice(1));
});

test('the admin console shows each set\'s check and checks one on request', { skip }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-verify-admin-'));
  let server: Server | undefined;
  try {
    copyFileSync(join(dir, FILE), join(folder, FILE));
    const s = await serve({ dir: folder, port: 0, log: () => {} });
    server = s.server;
    const admin = (path: string, method = 'GET') => fetch(`${s.url}/tabularius/admin/v1/${path}`, { method, headers: { 'x-tabularius-admin': '1' } });
    const made = await (await admin('backup', 'POST')).json();
    const set = basename(made.dir);
    // Checked in the background after "Back up now".
    let row: { name: string; check?: { ok: boolean } } | undefined;
    for (let i = 0; i < 100 && !row?.check; i++) {
      row = (await (await admin('status')).json()).backups.sets.find((x: { name: string }) => x.name === set);
      await sleep(50);
    }
    assert.equal(row?.check?.ok, true);
    damage(join(made.dir, FILE));
    const again = await (await admin(`backups/${set}/verify`, 'POST')).json();
    assert.equal(again.ok, false);
    assert.equal((await (await admin('status')).json()).backups.sets[0].check.ok, false);
    assert.equal((await admin('backups/2020-01-01_000000/verify', 'POST')).status, 404);
    const eventLog = join(folder, 'Logs', 'Event.log');
    const failure = new RegExp(`\\tError\\tserver\\tbackup ${set} failed its check: ${FILE.replace('.', '\\.')}: changed on disk`);
    for (let i = 0; i < 100; i++) {
      if (existsSync(eventLog) && failure.test(readFileSync(eventLog, 'utf8'))) break;
      await sleep(10);
    }
    assert.match(readFileSync(eventLog, 'utf8'), failure);
  } finally {
    server?.close();
    rmSync(folder, { recursive: true });
  }
});

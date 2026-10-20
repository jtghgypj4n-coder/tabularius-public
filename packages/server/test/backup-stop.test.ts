import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { BackupStopped, backupFolder, backupRunning, backupSets, defaultBackupDir, serve, stopBackups } from '../src/index.ts';

// Stopping a running backup: it ends after the file it is copying, its half-made set is removed, and nothing old is
// pruned. The one taken before a restore is not stoppable.

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-stop-'));
  for (let i = 0; i < 25; i++) createStore(join(dir, `File${i}` + STORE_EXT));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const admin = { 'x-tabularius-admin': '1' };
const leftovers = (dest: string) => (existsSync(dest) ? readdirSync(dest) : []);

test('a stopped backup leaves no set and no half-made folder, and prunes nothing', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const dest = join(dir, 'unit');
  await backupFolder(dir, dest, 0, '');
  const before = backupSets(dest);
  assert.equal(before.length, 1);
  t.mock.timers.tick(1100); // a new set name is made from the second
  const running = backupFolder(dir, dest, 1, '', { stoppable: true });
  assert.equal(backupRunning(), true);
  assert.equal(stopBackups(), 1);
  await assert.rejects(running, (e) => e instanceof BackupStopped);
  assert.equal(backupRunning(), false);
  assert.deepEqual(backupSets(dest), before, 'the old set is still there, and no new one');
  assert.deepEqual(leftovers(dest), before, 'no .partial folder either');
  assert.equal(stopBackups(), 0, 'nothing left to stop');
});

test('a backup not marked stoppable (the one before a restore) is not stopped', async () => {
  const dest = join(dir, 'restore');
  const running = backupFolder(dir, dest, 0, '');
  assert.equal(stopBackups(), 0);
  assert.equal((await running).files.length, 25);
});

test('the admin route stops Back up now: it answers 409, and the set is not kept', async () => {
  const dest = defaultBackupDir(dir);
  const start = fetch(`${base}/tabularius/admin/v1/backup`, { method: 'POST', headers: admin });
  let stopped = 0;
  for (let i = 0; i < 400 && !stopped; i++) {
    const r = await fetch(`${base}/tabularius/admin/v1/backup/stop`, { method: 'POST', headers: admin });
    assert.equal(r.status, 200);
    stopped = ((await r.json()) as { stopped: number }).stopped;
    if (!stopped) await sleep(2);
  }
  const reply = await start;
  assert.ok(stopped > 0, 'the backup was running when the stop arrived');
  assert.equal(reply.status, 409);
  assert.match(((await reply.json()) as { error: string }).error, /stopped/);
  assert.deepEqual(backupSets(dest), []);
  assert.deepEqual(leftovers(dest), []);
  const status = (await (await fetch(`${base}/tabularius/admin/v1/status`, { headers: admin })).json()) as { backups: { running: boolean } };
  assert.equal(status.backups.running, false);
  // Backing up again afterwards works.
  const again = await fetch(`${base}/tabularius/admin/v1/backup`, { method: 'POST', headers: admin });
  assert.equal(again.status, 200);
  assert.equal(backupSets(dest).length, 1);
});

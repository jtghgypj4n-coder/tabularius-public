// The backup folder is set from the admin console: validated, saved in the folder's settings (the key `tabularius serve`
// reads, so a restart keeps it), applied at once when nothing else follows the old folder, and never over a --backup-dir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { backupSets, defaultBackupDir, serve } from '../src/index.ts';

let dir: string;
let elsewhere: string;
let server: Server;
let base: string;

const start = async (backups?: { every: number; dest?: string }, progressive?: { every: number }) => {
  const s = await serve({ dir, port: 0, log: () => {}, ...(backups ? { backups } : {}), ...(progressive ? { progressive } : {}) });
  server = s.server;
  base = s.url;
};
const stop = () => new Promise<void>((r) => (server ? server.close(() => r()) : r()));

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-folder-'));
  elsewhere = mkdtempSync(join(tmpdir(), 'tabularius-backup-elsewhere-'));
  createStore(join(dir, 'Notes' + STORE_EXT));
});
after(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  rmSync(elsewhere, { recursive: true, force: true, maxRetries: 10 });
});

const admin = { 'x-tabularius-admin': '1', 'content-type': 'application/json' };
const set = (folder: unknown) => fetch(`${base}/tabularius/admin/v1/backup-folder`, { method: 'POST', headers: admin, body: JSON.stringify({ folder }) }).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));
type Status = { backups: { dest: string; saved?: string; fixed: boolean; running?: boolean; progressive?: unknown } };
const status = () => fetch(`${base}/tabularius/admin/v1/backups`, { headers: admin }).then((r) => r.json() as Promise<Status>);
/** The backup a start makes on its own, and the point-in-time one, are finished (the console refuses to move the folder under a running one). */
const settled = async (progressive = false) => {
  for (const end = Date.now() + 30_000; ; await new Promise((ok) => setTimeout(ok, 100))) {
    const s = (await status()).backups;
    if (!s.running && (!progressive || s.progressive)) return;
    assert.ok(Date.now() < end, 'the start-up backups finished');
  }
};

test('the folder is checked before it is saved', async () => {
  await start({ every: 86_400_000 });
  await settled();
  assert.equal((await set(7)).status, 400);
  assert.match(String((await set('relative/path')).body.error), /full path/);
  assert.match(String((await set(dir)).body.error), /hosted folder itself/);
  writeFileSync(join(elsewhere, 'a-file'), 'x');
  assert.match(String((await set(join(elsewhere, 'a-file'))).body.error), /is a file/);
  assert.match(String((await set(join(elsewhere, 'a-file', 'inside'))).body.error), /can't write/);
  // A drive that isn't connected is not made on the startup disk, and a folder that would hold copies of itself is refused.
  assert.match(String((await set(join(elsewhere, 'no-drive', 'tabularius'))).body.error), /is the drive connected/);
  mkdirSync(join(dir, 'Files', 'Notes'), { recursive: true });
  assert.match(String((await set(join(dir, 'Files', 'Notes', 'bk'))).body.error), /can't be inside/);
  assert.match(String((await set(join(dir, 'RC_Data_FMS'))).body.error), /can't be inside/);
  // The hosted folder reached through a link is still the hosted folder.
  symlinkSync(dir, join(elsewhere, 'link-to-hosted'));
  assert.match(String((await set(join(elsewhere, 'link-to-hosted'))).body.error), /hosted folder itself/);
  assert.match(String((await set(join(elsewhere, 'link-to-hosted', 'Files', 'x'))).body.error), /can't be inside/);
  assert.equal((await status()).backups.dest, defaultBackupDir(dir), 'nothing changed');
  assert.equal((await status()).backups.saved, undefined);
});

test('a folder set in the console takes effect at once, receives the next backup, and survives a restart', async () => {
  const target = join(elsewhere, 'here');
  await settled();
  const r = await set(target);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { folder: target, backupDir: target, appliesNow: true });
  assert.equal((await status()).backups.dest, target);
  assert.equal(JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8')).backupDir, target);

  const oldSets = backupSets(defaultBackupDir(dir)).length;
  const done = await fetch(`${base}/tabularius/admin/v1/backup`, { method: 'POST', headers: admin });
  assert.equal(done.status, 200);
  assert.equal(backupSets(target).length, 1, 'Back up now went to the new folder');
  assert.equal(backupSets(defaultBackupDir(dir)).length, oldSets, 'none more in the old one');

  // A new start, with a schedule and no --backup-dir, keeps it.
  await stop();
  await start({ every: 86_400_000 });
  const after = (await status()).backups;
  assert.equal(after.dest, target);
  assert.equal(after.saved, target);
  assert.equal(after.fixed, false);

  // Empty goes back to the default folder.
  const back = await set('');
  assert.deepEqual(back.body, { folder: null, backupDir: defaultBackupDir(dir), appliesNow: true });
  assert.equal((await status()).backups.saved, undefined);
  assert.equal(backupSets(target).length, 1, 'sets already taken stay where they are');
});

test('a --backup-dir given at start counts, and the console says so instead of saving over it', async () => {
  await stop();
  const flagged = join(elsewhere, 'flagged');
  await start({ every: 86_400_000, dest: flagged });
  const s = (await status()).backups;
  assert.equal(s.dest, flagged);
  assert.equal(s.fixed, true);
  const r = await set(join(elsewhere, 'other'));
  assert.equal(r.status, 409);
  assert.match(String(r.body.error), /--backup-dir/);
  assert.equal((await status()).backups.saved, undefined);
});

test('without a schedule the saved folder is still where Back up now goes', async () => {
  await stop();
  await start();
  await settled();
  const target = join(elsewhere, 'manual');
  assert.equal((await set(target)).body.appliesNow, true);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/backup`, { method: 'POST', headers: admin })).status, 200);
  assert.equal(backupSets(target).length, 1);
});

test('with point-in-time backups following the old folder, the new one is saved and counts after a restart', async () => {
  await stop();
  rmSync(join(dir, '.openhbam-settings.json'), { force: true });
  await start({ every: 86_400_000 }, { every: 60_000 });
  await settled(true);
  const target = join(elsewhere, 'progressive');
  const r = await set(target);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.appliesNow, false);
  assert.equal(r.body.backupDir, defaultBackupDir(dir), 'still the old folder for now');
  assert.equal((await status()).backups.saved, target);
  await stop();
  await start({ every: 86_400_000 }, { every: 60_000 });
  assert.equal((await status()).backups.dest, target, 'after the restart');
});

test('with point-in-time backups and no schedule, every backup still goes to the folder they were started on', async () => {
  await stop();
  rmSync(join(dir, '.openhbam-settings.json'), { force: true });
  await start(undefined, { every: 60_000 });
  await settled(true);
  const before = (await status()).backups.dest;
  const r = await set(join(elsewhere, 'late'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.appliesNow, false);
  assert.equal(r.body.backupDir, before);
  assert.equal((await status()).backups.dest, before, 'the status, Back up now and restores stay with the point-in-time logs');
  assert.equal((await fetch(`${base}/tabularius/admin/v1/backup`, { method: 'POST', headers: admin })).status, 200);
  assert.equal(backupSets(join(elsewhere, 'late')).length, 0);
});

test('a folder typed with a trailing slash is saved as the plain path and says it applied', async () => {
  await stop();
  rmSync(join(dir, '.openhbam-settings.json'), { force: true });
  await start({ every: 86_400_000 });
  await settled();
  const r = await set(join(elsewhere, 'slashed') + '/');
  assert.deepEqual(r.body, { folder: join(elsewhere, 'slashed'), backupDir: join(elsewhere, 'slashed'), appliesNow: true });
  assert.equal((await status()).backups.dest, join(elsewhere, 'slashed'));
});

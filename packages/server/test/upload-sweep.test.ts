import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, lutimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContainerUploads, sweepOrphanUploadFolders } from '../src/container-uploads.ts';
import { serve } from '../src/index.ts';

const day = 24 * 60 * 60 * 1000;
const root = () => mkdtempSync(join(tmpdir(), 'tabularius-upload-sweep-test-'));
const folder = (tmp: string, suffix = Math.random().toString(36).slice(2, 8).padEnd(6, 'a')) => {
  const path = join(tmp, `tabularius-container-uploads-${suffix}`);
  mkdirSync(path);
  return path;
};
function date(path: string, time: number) {
  const d = new Date(time);
  utimesSync(path, d, d);
  for (const name of readdirSync(path)) utimesSync(join(path, name), d, d);
}
function owner(path: string, pid: number) { writeFileSync(join(path, 'owner.json'), JSON.stringify({ pid, started: 1, version: 1 })); }

test('sweep applies age, owner, name, symlink, cap and failure rules', (t) => {
  const tmp = root();
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const now = Date.now();
  const oldDead = folder(tmp); owner(oldDead, 99999999); date(oldDead, now - 2 * day);
  const live = folder(tmp); owner(live, 23); date(live, now - 2 * day);
  const week = folder(tmp); owner(week, 24); date(week, now - 8 * day);
  const young = folder(tmp); owner(young, 25); date(young, now - day / 2);
  const noMarker = folder(tmp); date(noMarker, now - 2 * day);
  const badMarker = folder(tmp); writeFileSync(join(badMarker, 'owner.json'), '{'); date(badMarker, now - 2 * day);
  const outside = join(tmp, 'outside'); mkdirSync(outside); const sentinel = join(outside, 'sentinel'); writeFileSync(sentinel, 'safe');
  const linkFolder = join(tmp, 'tabularius-container-uploads-link01'); symlinkSync(outside, linkFolder, 'dir');
  const file = join(tmp, 'tabularius-container-uploads-file01'); writeFileSync(file, 'safe');
  mkdirSync(join(tmp, 'other-name'));
  const insideLink = folder(tmp); const inside = join(insideLink, 'external'); symlinkSync(outside, inside, 'dir'); date(insideLink, now - 2 * day); lutimesSync(inside, new Date(now - 2 * day), new Date(now - 2 * day));
  const result = sweepOrphanUploadFolders({ tmp, now, alive: (pid) => [23, 24].includes(pid) });
  assert.deepEqual(new Set(result.removed), new Set([oldDead, week, noMarker, badMarker, insideLink].map((p) => p.split('/').pop())));
  assert.ok(result.kept >= 4);
  assert.equal(existsSync(sentinel), true);
  assert.equal(lstatSync(linkFolder).isSymbolicLink(), true);
  assert.equal(existsSync(file), true);
  assert.equal(existsSync(young), true);
});

test('sweep removes no more than 100 folders per call', (t) => {
  const tmp = root(); t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const now = Date.now();
  for (let i = 0; i < 105; i++) { const f = folder(tmp, i.toString(36).padStart(6, '0')); date(f, now - 2 * day); }
  const first = sweepOrphanUploadFolders({ tmp, now, alive: () => false });
  assert.equal(first.removed.length, 100);
  const second = sweepOrphanUploadFolders({ tmp, now, alive: () => false });
  assert.equal(second.removed.length, 5);
});

test('default process liveness recognizes this process and a completed child', (t) => {
  const tmp = root(); t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const marker = join(tmp, 'forbidden-command-used');
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(tmp, command), `#!/bin/sh\nprintf x > '${marker}'\nexit 99\n`, { mode: 0o700 });
  }
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { env: { PATH: tmp } });
  assert.equal(child.status, 0);
  assert.equal(existsSync(marker), false);
  const old = folder(tmp); owner(old, child.pid ?? -1); date(old, Date.now() - 2 * day);
  const result = sweepOrphanUploadFolders({ tmp, now: Date.now() });
  assert.ok(result.removed.includes(old.split('/').pop()!));
  const current = folder(tmp); owner(current, process.pid); date(current, Date.now() - 2 * day);
  assert.ok(sweepOrphanUploadFolders({ tmp, now: Date.now() }).kept >= 1);
});

test('upload owners mark distinct spools and live processes protect them', (t) => {
  const tmp = root(); t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const first = new ContainerUploads({ tmp });
  const second = new ContainerUploads({ tmp });
  const target = { layout: 'L', recordId: 1, field: 'F', repetition: 1 };
  first.start({ db: 'D', account: 'A' }, target, { size: 1 });
  second.start({ db: 'D', account: 'A' }, target, { size: 1 });
  const spools = readdirSync(tmp).map((name) => join(tmp, name));
  assert.equal(spools.length, 2);
  for (const spool of spools) {
    const marker = JSON.parse(readFileSync(join(spool, 'owner.json'), 'utf8'));
    assert.equal(marker.pid, process.pid);
    assert.equal(marker.version, 1);
    date(spool, Date.now() - 2 * day);
  }
  assert.equal(sweepOrphanUploadFolders({ tmp, now: Date.now() + 2 * day }).kept, 2);
  // This process owns them: even a sweep that thinks no one is alive, a week on, leaves them.
  assert.equal(sweepOrphanUploadFolders({ tmp, now: Date.now() + 8 * day, alive: () => false }).removed.length, 0);
  assert.equal(readdirSync(tmp).length, 2);
});

test('a spool folder this process owns survives a week idle and is recreated if it goes missing', (t) => {
  const tmp = root(); t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const uploads = new ContainerUploads({ tmp });
  const target = { layout: 'L', recordId: 1, field: 'F', repetition: 1 };
  const a = uploads.start({ db: 'D', account: 'A' }, target, { size: 1 });
  const [name] = readdirSync(tmp);
  const spool = join(tmp, name!);
  date(spool, Date.now() - 9 * day);
  const result = sweepOrphanUploadFolders({ tmp, now: Date.now(), alive: () => false });
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(spool), true);
  // Whatever removed the folder (a tmp cleaner, say), the next upload makes a fresh one instead of failing.
  rmSync(spool, { recursive: true, force: true });
  const b = uploads.start({ db: 'D', account: 'A' }, target, { size: 1 });
  assert.notEqual(a.id, b.id);
  assert.equal(existsSync(join(tmp, readdirSync(tmp)[0]!, `${b.id}.part`)), true);
  assert.equal(readdirSync(tmp).length, 1);
});

test('server startup sweeps the configured upload folder and close clears its timer', async (t) => {
  const dir = root(); const uploadTmp = root();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(uploadTmp, { recursive: true, force: true }); });
  const before = process.env.TABULARIUS_UPLOAD_TMP;
  process.env.TABULARIUS_UPLOAD_TMP = uploadTmp;
  const orphan = folder(uploadTmp); date(orphan, Date.now() - 2 * day);
  let app: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    app = await serve({ dir, port: 0, watch: false, checkFiles: false, statsInterval: 0, log() {} });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => app!.server.close(() => resolve()));
    assert.equal(existsSync(orphan), false);
  } finally {
    if (app?.server.listening) await new Promise<void>((resolve) => app!.server.close(() => resolve()));
    if (before === undefined) delete process.env.TABULARIUS_UPLOAD_TMP; else process.env.TABULARIUS_UPLOAD_TMP = before;
  }
});

test('unreadable folder failure does not stop the sweep where permissions are enforceable', (t) => {
  if (process.platform === 'win32' || typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('permissions are not enforceable here');
  const tmp = root(); t.after(() => { try { chmodSync(join(tmp, 'tabularius-container-uploads-abcdef'), 0o700); } catch {} rmSync(tmp, { recursive: true, force: true }); });
  const bad = folder(tmp, 'abcdef'); chmodSync(bad, 0); const good = folder(tmp, 'abcdeg'); date(good, Date.now() - 2 * day);
  const result = sweepOrphanUploadFolders({ tmp, now: Date.now(), alive: () => false });
  assert.equal(result.failed, 1); assert.ok(existsSync(bad)); assert.ok(result.removed.includes('tabularius-container-uploads-abcdeg'));
});

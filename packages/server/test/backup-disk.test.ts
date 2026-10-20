// A backup that cannot fit is refused before anything is made, and the metrics say how much disk is free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { backupSets, serve } from '../src/index.ts';
import { backupFolder, backupNeeds, scheduleProgressive } from '../src/backup.ts';
import { logRecords, type LogFollower } from '../src/logs.ts';
import { freeBytes, sizeText } from '../src/disk.ts';

const folderWith = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-disk-'));
  createStore(join(dir, 'Notes' + STORE_EXT));
  // A container file kept outside the store.
  mkdirSync(join(dir, 'RC_Data_FMS', 'Notes', 'Pics'), { recursive: true });
  writeFileSync(join(dir, 'RC_Data_FMS', 'Notes', 'Pics', '1.bin'), Buffer.alloc(200_000, 1));
  return dir;
};
const fakeFree = (bytes: number) => () => ({ bavail: bytes / 4096, bsize: 4096 });

test('a backup that cannot fit is refused with what it needs and what is free, and leaves nothing behind', async () => {
  const dir = folderWith();
  const dest = join(dir, 'Backups');
  try {
    const needs = backupNeeds(dir, ['Notes' + STORE_EXT]);
    assert.ok(needs > 200_000, 'the container file counts');
    await assert.rejects(
      backupFolder(dir, dest, 7, undefined, { statfs: fakeFree(50 * 4096) }),
      (e: Error) => /not enough free disk space for a backup in .*Backups: it needs about [\d.]+ (KB|MB) free, 200 KB available/.test(e.message),
    );
    assert.ok(!existsSync(dest) || readdirSync(dest).length === 0, 'no .partial folder or set');
    assert.deepEqual(backupSets(dest), []);

    // Room for it: it goes ahead.
    const r = await backupFolder(dir, dest, 7, undefined, { statfs: fakeFree(1 << 30) });
    assert.deepEqual(r.files, ['Notes' + STORE_EXT]);
    assert.equal(backupSets(dest).length, 1);

    // The container file is linked to the earlier set, so a second backup needs only the store.
    assert.ok(backupNeeds(dir, ['Notes' + STORE_EXT], r.dir) < 200_000, 'unchanged containers are not counted again');

    // A system that does not say how much is free does not stop a backup.
    const unknown = await backupFolder(dir, dest, 7, undefined, { statfs: () => { throw new Error('no statfs here'); }, now: () => Date.now() + 5000 });
    assert.equal(unknown.files.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup folder labels stay unique and sortable after a backward clock change', async () => {
  const old = process.env.TZ;
  process.env.TZ = 'America/New_York';
  const dir = folderWith();
  const dest = join(dir, 'Backups');
  try {
    const times = [new Date(2026, 10, 1, 1, 30).getTime(), new Date(2026, 10, 1, 1, 0).getTime(), new Date(2025, 11, 31, 23, 59).getTime()];
    const names: string[] = [];
    for (const at of times) names.push((await backupFolder(dir, dest, 7, undefined, { now: () => at })).dir.split('/').at(-1)!);
    assert.deepEqual(names, [...names].sort());
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(backupSets(dest), names);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});

test('progressive backup log names preserve earlier changes after a repeated clock time', async () => {
  const old = process.env.TZ;
  process.env.TZ = 'America/New_York';
  const dir = folderWith();
  const dest = join(dir, 'Backups');
  let follower: LogFollower | undefined;
  const store = { name: 'Notes' };
  const shipper = { follow: () => {}, add: (f: LogFollower) => { follower = f; }, remove: () => {}, ship: () => {} };
  try {
    const schedule = await scheduleProgressive({ dir, names: () => ['Notes'], get: () => store } as never,
      { every: 1, dest, shipper: shipper as never });
    const at = new Date(2026, 10, 1, 1, 30).getTime();
    assert.equal(follower!.take(store as never, Buffer.from('first'), at), true);
    schedule.follow(schedule.set()!); // a restart opens a new log for the same backup set
    assert.equal(follower!.take(store as never, Buffer.from('second'), at - 30 * 60_000), true);
    const logs = readdirSync(join(schedule.set()!, 'progressive', 'Notes')).sort();
    assert.equal(logs.length, 2);
    assert.equal(logs.every((name) => logRecords(join(schedule.set()!, 'progressive', 'Notes', name)).length === 1), true);
    assert.deepEqual(logs, [...logs].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});

test('free space is read from the nearest folder that exists, sizes are written to read', () => {
  const seen: string[] = [];
  const statfs = (p: string) => {
    seen.push(p);
    if (!p.endsWith('exists')) throw new Error('ENOENT');
    return { bavail: 10n, bsize: 4096n };
  };
  assert.equal(freeBytes('/x/exists/not/yet/made', statfs), 40960);
  assert.deepEqual(seen, ['/x/exists/not/yet/made', '/x/exists/not/yet', '/x/exists/not', '/x/exists']);
  assert.equal(freeBytes('/nothing', () => { throw new Error('no'); }), undefined);
  assert.equal(sizeText(512), '512 bytes');
  assert.equal(sizeText(1536), '1.5 KB');
  assert.equal(sizeText(320 * 1024 * 1024), '320 MB');
  assert.equal(sizeText(1.5 * 1024 ** 3), '1.5 GB');
});

test('the metrics report free disk space for the data and the backups', async () => {
  const dir = folderWith();
  const { server, url } = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const text = await (await fetch(`${url}/tabularius/admin/v1/metrics`, { headers: { 'x-tabularius-admin': '1' } })).text();
    assert.match(text, /# TYPE tabularius_disk_free_bytes gauge/);
    for (const area of ['data', 'backups']) {
      const m = new RegExp(`^tabularius_disk_free_bytes\\{area="${area}"\\} (\\d+)`, 'm').exec(text);
      assert.ok(m && Number(m[1]) > 0, `${area}: ${m?.[0]}`);
    }
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

// Putting a file back to a moment from the admin console, while the server runs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;
// Changes are saved every few minutes; tests save them at once.
let save: () => void;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-live-restore-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, progressive: { every: 3_600_000 } });
  server = s.server;
  base = s.url;
  host = s.host;
  save = () => s.progressive!.run();
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const admin = (method: string, body?: object) => fetch(`${base}/tabularius/admin/v1/restore`, {
  method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const name = (db = 'Charts') => String(host.get(db)!.get('Congress', 1).fieldData.Name);

test('restore a file to a moment, as a copy and in place, from the console', { skip }, async () => {
  // Point-in-time backups start with a full backup.
  let points;
  for (let i = 0; i < 200; i++) {
    points = (await admin('GET')).body;
    if (points.progressive && points.databases[0]?.from) break;
    await sleep(50);
  }
  assert.equal(points.progressive, true);
  const original = name();
  await sleep(20);

  host.get('Charts')!.update('Congress', 1, { Name: 'Good edit' });
  save();
  await sleep(30);
  const good = Date.now();
  await sleep(30);
  host.get('Charts')!.update('Congress', 1, { Name: 'Mistake' });

  // As a copy beside the live file.
  const copy = await admin('POST', { database: 'Charts', at: good, mode: 'copy', name: 'Charts before mistake' });
  assert.equal(copy.status, 200, JSON.stringify(copy.body));
  assert.equal(copy.body.database, 'Charts before mistake');
  assert.equal(name('Charts before mistake'), 'Good edit');
  assert.equal(name(), 'Mistake', 'the live file is untouched');
  assert.equal((await admin('POST', { database: 'Charts', at: good, mode: 'copy', name: 'Charts before mistake' })).status, 409);

  // No mode is a copy: the live file is left alone and the answer says so.
  const bare = await admin('POST', { database: 'Charts', at: good, name: 'Charts by default' });
  assert.equal(bare.status, 200, JSON.stringify(bare.body));
  assert.equal(bare.body.mode, 'copy');
  assert.equal(bare.body.database, 'Charts by default');
  assert.equal(name(), 'Mistake', 'a post with no mode did not replace the live file');

  // Any other mode is refused, not read as a replacement or as a copy.
  for (const mode of ['Replace', 'REPLACE', 'overwrite', '', null, 1, true, ['replace']]) {
    const refused = await admin('POST', { database: 'Charts', at: good, mode });
    assert.equal(refused.status, 400, JSON.stringify(mode));
    assert.match(refused.body.error, /mode must be "copy" or "replace"/);
  }
  assert.equal(name(), 'Mistake', 'a refused mode changed nothing');

  // In place is asked for by name: the file is put back and hosted again.
  const replaced = await admin('POST', { database: 'Charts', at: good, mode: 'replace' });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal(name(), 'Good edit');

  // Later changes are saved after the restored file, so it can be restored again past this point.
  host.get('Charts')!.update('Congress', 1, { Name: 'After restore' });
  save();
  await sleep(30);
  const later = Date.now();
  await sleep(30);
  host.get('Charts')!.update('Congress', 1, { Name: 'Another mistake' });
  assert.equal((await admin('POST', { database: 'Charts', at: later, mode: 'replace' })).status, 200);
  assert.equal(name(), 'After restore');

  // Before any backup, in the future, or a file that isn't hosted.
  assert.equal((await admin('POST', { database: 'Charts', at: '2001-01-01 00:00' })).status, 400);
  assert.equal((await admin('POST', { database: 'Charts', at: Date.now() + 3_600_000 })).status, 400);
  assert.equal((await admin('POST', { database: 'Nope', at: good })).status, 404);
  assert.notEqual(original, 'Good edit');
});

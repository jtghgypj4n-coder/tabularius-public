// The admin JSON API answers the same way everywhere: a missing database is a 400 (never a 200 holding an error),
// ?db= means ?database=, a backup is never quietly more than it was asked to be, and the sets can be listed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-adminjson-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const get = (path: string) => fetch(`${base}/tabularius/admin/v1${path}`).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, any> }));
const post = (path: string, body?: unknown) => fetch(`${base}/tabularius/admin/v1${path}`, {
  method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, any> }));

test('a missing database is a 400 on every endpoint that asks for one', { skip }, async () => {
  for (const path of ['/usage', '/unusual-access', '/audit', '/who-can?table=Congress', '/view-as', '/access']) {
    const r = await get(path);
    assert.equal(r.status, 400, path);
    assert.match(r.body.error, /database/, path);
  }
  assert.equal((await get('/usage?database=Charts')).status, 200);
});

test('?db= means ?database=', { skip }, async () => {
  const long = await get('/usage?database=Charts');
  const short = await get('/usage?db=Charts');
  assert.equal(short.status, 200);
  assert.deepEqual(short.body, long.body);
  assert.equal((await get('/usage?db=Nope')).status, 400);
});

test('a backup covers every file, so naming one is refused; the sets are listed', { skip }, async () => {
  const refused = await post('/backup', { database: 'Charts' });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /every hosted file/);
  assert.equal((await get('/backups')).body.backups.sets.length, 0, 'the refused request made nothing');

  const made = await post('/backup');
  assert.equal(made.status, 200);
  const listed = (await get('/backups')).body.backups;
  assert.equal(listed.sets.length, 1);
  assert.equal(listed.sets[0].name, made.body.dir.split(/[\\/]/).pop());
  assert.equal(typeof listed.keep, 'number');
});

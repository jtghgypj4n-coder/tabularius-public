// FileMaker Server ends a Data API session after 15 idle minutes and answers 952 without doing anything. The sync's
// connection signs in again and repeats that one request, once; a session that is refused on a fresh sign-in is not
// retried. A small proxy in front of Tabularius's own Data API (standing in for FileMaker, as fms-sync-apply.test.ts does)
// plays the expiry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve, dataApiClient, dataApiSource } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { applySync, createStore, Store, type DesignOp, type TableSyncConfig } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let proxy: Server;
let base: string;
let remote: Store;
let local: Store;
/** How many requests with a token to answer with 952, and how many sign-ins and creates went through. */
let expire = 0;
let signIns = 0;
let creates = 0;

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] } as DesignOp];
const table: TableSyncConfig = { localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fms-expiry-'));
  const served = join(dir, 'served');
  mkdirSync(served);
  createStore(join(served, 'Remote' + STORE_EXT));
  const s = await serve({ dir: served, port: 0, watch: false, log: () => {} });
  server = s.server;
  remote = s.host.get('Remote')!;
  remote.applyDesign(design);
  remote.setPassword('Admin', 'pw', '[Full Access]');
  const target = new URL(s.url);
  proxy = createServer((req, res) => {
    if (req.method === 'POST' && /\/sessions$/.test(req.url ?? '')) signIns++;
    if (req.method === 'POST' && /\/records$/.test(req.url ?? '')) creates++;
    if (expire > 0 && /^Bearer /.test(req.headers.authorization ?? '')) {
      expire--;
      req.resume();
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ code: '952', message: 'Invalid FileMaker Data API token (*)' }], response: {} }));
      return;
    }
    const up = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 500, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
  });
  await new Promise<void>((ok) => proxy.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  createStore(join(dir, 'Local' + STORE_EXT));
  local = new Store(join(dir, 'Local' + STORE_EXT), 'Local');
  local.applyDesign(design);
});
after(() => {
  local?.close();
  proxy?.close();
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const login = { database: 'Remote', user: 'Admin', password: 'pw', tables: [table] };

test('a read answered 952 signs in again and is repeated once', async () => {
  remote.create('Contacts', { uuid: 'r1', Name: 'Ann' });
  const source = dataApiSource({ server: base, ...login });
  try {
    assert.equal((await source.changedSince('Contacts', undefined as never)).length, 1);
    // The session ends while idle; the next request finds it gone.
    signIns = 0;
    expire = 1;
    const fields = await source.writableFields('Contacts');
    assert.ok(fields.has('Name'));
    assert.equal(signIns, 1, 'one new sign-in');
  } finally {
    await source.close();
  }
});

test('a write answered 952 is repeated on the new session, and the record is made once; the last checks run again', async () => {
  const client = dataApiClient({ server: base, ...login });
  try {
    await client.writableFields('Contacts');
    creates = 0;
    expire = 1;
    let checks = 0;
    const made = await client.create('Contacts', { uuid: 'r2', Name: 'Bo' }, () => { checks++; });
    assert.ok(made.recordId);
    assert.equal(checks, 2, 'beforeSend ran before each send');
    assert.equal(creates, 2, 'the first send was refused before FileMaker did anything');
    assert.equal(remote.query(`SELECT count(*) n FROM "Contacts" WHERE uuid = 'r2'`, 1)[0].n, 1);
  } finally {
    await client.close();
  }
});

test('a whole run goes through when the session ends during it', async () => {
  local.create('Contacts', { uuid: 'r3', Name: 'Cy' });
  const client = dataApiClient({ server: base, ...login });
  try {
    expire = 0;
    // Let the plan's reads through, then end the session just before the first write.
    const res = await applySync(local, 'Local', [table], client, { ...client, create: async (...a: Parameters<typeof client.create>) => { expire = 1; return client.create(...a); } } as typeof client, { write: true });
    assert.equal(res.refused, undefined);
    assert.equal(res.tables[0].created, 1);
    assert.equal(res.tables[0].failed.length, 0);
    assert.equal(remote.query(`SELECT count(*) n FROM "Contacts" WHERE uuid = 'r3'`, 1)[0].n, 1);
  } finally {
    await client.close();
  }
});

test('a second 952 is reported, not retried again', async () => {
  const source = dataApiSource({ server: base, ...login });
  try {
    await source.writableFields('Contacts');
    expire = 2; // the request and its repeat, both refused
    await assert.rejects(() => source.changedSince('Contacts', undefined as never), /error 952/);
  } finally {
    expire = 0;
    await source.close();
  }
});

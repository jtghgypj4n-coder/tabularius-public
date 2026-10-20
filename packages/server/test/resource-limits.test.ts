// Resource bounds and their response semantics, using only a synthetic temporary store.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, ensureSyncTables } from '../../store/src/index.ts';
import type { DesignOp, Store } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
let token: string;
const previousSyncHosts = process.env.TABULARIUS_SYNC_HOSTS;
const recordsPath = '/fmi/data/vLatest/databases/L/layouts/Items/records';

const create = (name: string, signal?: AbortSignal) => fetch(`${base}${recordsPath}`, {
  method: 'POST', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ fieldData: { Name: name } }),
});

function holdCreate() {
  const pending = request(new URL(recordsPath, base), {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
  });
  const result = new Promise<number>((resolve, reject) => {
    pending.on('response', (response) => { response.resume(); resolve(response.statusCode ?? 0); });
    pending.on('error', reject);
  });
  pending.write('{"fieldData":');
  return { pending, result, finish: () => pending.end('{"Name":"held"}}') };
}

async function waitUntilBusy() {
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${base}/fmi/data/vLatest/validateSession`, { headers: { authorization: `Bearer ${token}` } });
    if ((await response.json()).response.isSessionInUse) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('the first request did not acquire its token');
}

async function assertBusy(response: Response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await response.json()).messages[0].code, '301');
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-resource-limits-'));
  createStore(join(dir, 'L' + STORE_EXT));
  setAdminPassword(dir, 'secret');
  process.env.TABULARIUS_SYNC_HOSTS = 'example.com';
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = served.server;
  base = served.url;
  store = served.host.get('L')!;
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' },
  ] }] as DesignOp[]);
  for (const name of ['one', 'two', 'three', 'four', 'five']) store.create('Items', { uuid: name, Name: name });
  store.setPassword('Admin', 'pw', '[Full Access]');
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmodata'])] });
  const signIn = await fetch(`${base}/fmi/data/vLatest/databases/L/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(signIn.status, 200);
  token = ((await signIn.json()) as any).response.token;
});

after(async () => {
  if (previousSyncHosts === undefined) delete process.env.TABULARIUS_SYNC_HOSTS;
  else process.env.TABULARIUS_SYNC_HOSTS = previousSyncHosts;
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('OData pages bound SQL ids while preserving sorting, filtering, counts and next links', async () => {
  const original = store.selectIds.bind(store);
  const queries: { limit?: number; offset?: number }[] = [];
  store.selectIds = (layout, options) => {
    queries.push({ limit: options?.limit, offset: options?.offset });
    return original(layout, options);
  };
  const headers = { authorization: 'Basic ' + btoa('Admin:pw'), prefer: 'odata.maxpagesize=2' };
  const get = async (query: string) => {
    const response = await fetch(query.startsWith('http') ? query : `${base}/fmi/odata/v4/L/Items${query}`, { headers });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body as { value: { ROWID: number }[]; '@odata.count': number; '@odata.nextLink'?: string };
  };
  try {
    const first = await get('?$filter=ROWID gt 1&$orderby=Name desc&$skip=1&$top=3&$count=true');
    assert.deepEqual(first.value.map((r) => r.ROWID), [3, 4]);
    assert.equal(first['@odata.count'], 4);
    assert.deepEqual(queries.pop(), { limit: 3, offset: 1 });
    const next = new URL(first['@odata.nextLink']!);
    assert.equal(next.searchParams.get('$skip'), '3');
    assert.equal(next.searchParams.get('$top'), '1');
    const second = await get(next.href);
    assert.deepEqual(second.value.map((r) => r.ROWID), [5]);
    assert.equal(second['@odata.count'], 4);
    assert.equal(second['@odata.nextLink'], undefined);
    assert.deepEqual(queries.pop(), { limit: 1, offset: 3 });
    for (const query of ['?$top=0&$count=true', '?$skip=99&$count=true']) {
      const empty = await get(query);
      assert.deepEqual(empty.value, []);
      assert.equal(empty['@odata.count'], 5);
      assert.equal(empty['@odata.nextLink'], undefined);
    }
    const unbounded = await get('');
    assert.equal(unbounded.value.length, 2);
    assert.ok(unbounded['@odata.nextLink']);
    const one = await get('?$top=1');
    assert.equal(one.value.length, 1);
    assert.equal(one['@odata.nextLink'], undefined);
    assert.deepEqual(queries.pop(), { limit: 1, offset: 0 });
    const count = await fetch(`${base}/fmi/odata/v4/L/Items/$count?$filter=ROWID gt 1`, { headers });
    assert.equal(await count.text(), '4');
    assert.ok(queries.every((q) => Number.isFinite(q.limit) && q.limit! <= 3));
  } finally {
    store.selectIds = original;
  }
});

test('web client accepts 100,000 found-set ids and rejects larger arrays', async () => {
  for (const size of [100_000, 100_001]) {
    const response = await fetch(`${base}/tabularius/app/v1/databases/L/layouts/Items/records`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: Array(size).fill(1), limit: 1 }),
    });
    assert.equal(response.status, size === 100_000 ? 200 : 400);
    const body = await response.json();
    if (size === 100_000) assert.equal(body.data.length, 1);
    else assert.match(body.error.message, /100,000/);
  }
});

test('overlapping creates run FIFO on one token while GET and find remain concurrent', async () => {
  const held = holdCreate();
  try {
    await waitUntilBusy();
    for (const [method, suffix, body] of [['GET', '', undefined], ['POST', '/../_find', JSON.stringify({ query: [{ Name: 'one' }] })]] as const) {
      const read = await fetch(`${base}${recordsPath}${suffix}`, {
        method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body,
      });
      assert.equal(read.status, 200, await read.text());
    }
    const waiting: Promise<Response>[] = [];
    for (let i = 0; i < 8; i++) {
      waiting.push(create(`fifo-${i}`));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const otherLogin = await fetch(`${base}/fmi/data/vLatest/databases/L/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') },
    });
    const otherToken = (await otherLogin.json()).response.token;
    const other = await fetch(`${base}${recordsPath}`, {
      method: 'POST', headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fieldData: { Name: 'other' } }),
    });
    assert.equal(other.status, 200, await other.text());
    held.finish();
    assert.equal(await held.result, 200);
    const responses = await Promise.all(waiting);
    const ids = [];
    for (const response of responses) {
      const body = await response.json() as { response: { recordId: string } };
      assert.equal(response.status, 200, JSON.stringify(body));
      ids.push(Number(body.response.recordId));
    }
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.equal(new Set(ids).size, waiting.length);
  } finally {
    if (!held.pending.writableEnded) held.finish();
    await held.result;
  }
  const after = await create('after');
  assert.equal(after.status, 200, await after.text());
});

test('a full write queue refuses the next request with Retry-After', async () => {
  const held = holdCreate();
  const waiting: Promise<Response>[] = [];
  try {
    await waitUntilBusy();
    for (let i = 0; i < 16; i++) waiting.push(create(`full-${i}`));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assertBusy(await create('overflow'));
  } finally {
    held.finish();
    assert.equal(await held.result, 200);
    for (const response of await Promise.all(waiting)) assert.equal(response.status, 200, await response.text());
  }
});

test('a waiting write times out with Retry-After and leaves the token usable', async () => {
  const held = holdCreate();
  try {
    await waitUntilBusy();
    await assertBusy(await create('timed-out'));
  } finally {
    held.finish();
    assert.equal(await held.result, 200);
  }
  const after = await create('after-timeout');
  assert.equal(after.status, 200, await after.text());
});

test('disconnecting a queued write frees its slot', async () => {
  const held = holdCreate();
  const canceled = new AbortController();
  const waiting: Promise<Response>[] = [];
  try {
    await waitUntilBusy();
    const disconnected = create('disconnect', canceled.signal).catch((e: unknown) => e);
    for (let i = 0; i < 15; i++) waiting.push(create(`disconnect-${i}`));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assertBusy(await create('before-disconnect'));
    canceled.abort();
    assert.ok((await disconnected) instanceof Error);
    // The replacement is the sixteenth waiter; it must be admitted, not refused as overflow.
    waiting.push(create('replacement'));
  } finally {
    held.finish();
    assert.equal(await held.result, 200);
    for (const response of await Promise.all(waiting)) assert.equal(response.status, 200, await response.text());
  }
});

test('an aborted upload releases the active token gate', async () => {
  const held = holdCreate();
  await waitUntilBusy();
  held.pending.destroy();
  await assert.rejects(held.result);
  const after = await create('after-abort');
  assert.equal(after.status, 200, await after.text());
});

test('failed Data API bodies release the token for the next write', async () => {
  for (const [body, expected] of [['{', 400], ['{}', 200]] as const) {
    const response = await fetch(`${base}/fmi/data/vLatest/databases/L/layouts/Items/records`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, expected, await response.text());
  }
});

test('sync logs default to 200 and cap explicit limits at 10,000, including run filters', async () => {
  const auth = { 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:secret') };
  const setup = await fetch(`${base}/tabularius/admin/v1/sync/L`, {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ server: 'https://example.com', database: 'Remote', user: 'Admin',
      tables: [{ localTable: 'Items', uuidField: 'uuid', modTimestampField: 'modts' }] }),
  });
  assert.equal(setup.status, 200, await setup.text());
  ensureSyncTables(store!);
  const insert = store!.sql.prepare("INSERT INTO _fm_sync_log (run_id, at, op, status) VALUES ('R', '2026-01-01', 'update', 'done')");
  for (let i = 0; i < 10_005; i++) insert.run();
  for (const [query, expected] of [['', 200], ['run=R', 200], ['limit=1000000', 10_000], ['run=R&limit=1000000', 10_000], ['run=R&limit=7', 7], ['limit=-1', 200], ['run=R&limit=NaN', 200], ['run=R&limit=2.9', 2]] as const) {
    const response = await fetch(`${base}/tabularius/admin/v1/sync/L/log?${query}`, { headers: auth });
    assert.equal(response.status, 200);
    const body = await response.json() as { log: unknown[] };
    assert.equal(body.log.length, expected, query);
  }
});

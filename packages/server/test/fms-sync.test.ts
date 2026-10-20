// The tier-2 sync dry run against a real Data API: Tabularius's own, standing in
// for FileMaker Server (docs/data-api-compatibility.md). The planner reads a
// local file and the served file and says what would move, and it must leave
// both exactly as they were. Built here, with no .fmp12, so it runs without the
// downloaded samples.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve, dataApiSource, dataApiClient, describePlan, parseSyncConfig, verifySync, describeSyncVerification, FmsSyncError } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, syncPlan, openForPlanning, Store, type DesignOp, type TableSyncConfig } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let remote: Store;
let local: Store;

const contacts = (extra: { name: string }[] = []): DesignOp[] => [{ op: 'createTable', name: 'Contacts', fields: [
  { name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }, { name: 'Met', type: 'date' }, { name: 'Amount', type: 'number' }, ...extra,
] } as DesignOp];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fms-sync-'));
  const served = join(dir, 'served');
  mkdirSync(served);
  createStore(join(served, 'Remote' + STORE_EXT));
  const s = await serve({ dir: served, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  remote = s.host.get('Remote')!;
  remote.applyDesign(contacts());
  remote.setPassword('Admin', 'pw', '[Full Access]');
  remote.create('Contacts', { uuid: 'u1', Name: 'Ann', Met: '01/02/2026', Amount: 5 });
  remote.create('Contacts', { uuid: 'u2', Name: 'Bob' });
  remote.create('Contacts', { uuid: 'u4', Name: 'Only on FileMaker' });
  remote.create('Contacts', { Name: 'No key there' });

  // The local copy has one more field, which the served layout doesn't show.
  createStore(join(dir, 'Local' + STORE_EXT));
  local = new Store(join(dir, 'Local' + STORE_EXT), 'Local');
  local.applyDesign(contacts([{ name: 'Ref' }]));
  local.create('Contacts', { uuid: 'u1', Name: 'Ann', Met: '01/02/2026', Amount: 5 });
  local.create('Contacts', { uuid: 'u2', Name: 'Robert' });
  local.create('Contacts', { uuid: 'u3', Name: 'Only here' });
  local.create('Contacts', { Name: 'No key here' });
});
after(() => {
  local?.close();
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const table: TableSyncConfig = { localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' };

/** Every record of a store's Contacts table with its modification count, to show nothing was written. */
const snapshot = (s: Store) => JSON.stringify(s.query('SELECT * FROM "Contacts" ORDER BY _fm_record_id', 100));

test('a first dry run over the Data API: new records each way, the same record left alone, a difference held for review', async () => {
  const beforeRemote = snapshot(remote);
  const beforeLocal = snapshot(local);
  // Two records a page, so the four served records take more than one request.
  const source = dataApiSource({ server: base, database: 'Remote', user: 'Admin', password: 'pw', tables: [table], pageSize: 2 });
  // As sync-plan opens it: read-only.
  const readOnly = openForPlanning(join(dir, 'Local' + STORE_EXT));
  let plans;
  try {
    plans = await syncPlan(readOnly, 'Local', [table], source);
  } finally {
    readOnly.close();
    await source.close();
  }
  assert.equal(plans.length, 1);
  const [plan] = plans;
  assert.equal(plan.paused, undefined);
  assert.deepEqual(plan.pushes.map((p) => [p.uuid, p.op]), [['u3', 'create']]);
  assert.deepEqual(plan.pulls.map((p) => [p.uuid, p.op]), [['u4', 'create']]);
  // u1 has the same name, date and number on both sides, so it is not a conflict.
  assert.deepEqual(plan.conflicts.map((c) => [c.uuid, c.policy, c.clashes]), [['u2', 'flag', [{ field: 'Name', local: 'Robert', remote: 'Bob' }]]]);
  assert.deepEqual(plan.unkeyed, { local: 1, remote: 1 });

  // Nothing written on either side.
  assert.equal(snapshot(remote), beforeRemote);
  assert.equal(snapshot(local), beforeLocal);

  const text = describePlan(plans, 'fms.example.com').join('\n');
  assert.match(text, /^Dry run: nothing was changed here or on fms\.example\.com\./);
  assert.match(text, /1 to send to FileMaker \(1 new, 0 changed, 0 deleted\)/);
  assert.match(text, /1 to bring here \(1 new, 0 changed, 0 deleted\)/);
  assert.match(text, /u2: Name here "Robert", on FileMaker "Bob"/);
  assert.match(text, /2 left out because their UUID field is empty \(1 here, 1 on FileMaker\)/);
});

test('a served layout that does not show the UUID field, or is missing, pauses that table and names why', async () => {
  const keyedOnRef = { ...table, uuidField: 'Ref' };
  const noLayout = { ...table, remoteLayout: 'Nowhere' };
  const source = dataApiSource({ server: base, database: 'Remote', user: 'Admin', password: 'pw', tables: [keyedOnRef, noLayout] });
  try {
    const plans = await syncPlan(local, 'Local', [keyedOnRef, noLayout], source);
    assert.deepEqual(plans.map((p) => p.paused), ["layout Contacts in Remote doesn't show Ref; add it to the layout", 'FileMaker has no layout Nowhere in Remote']);
  } finally {
    await source.close();
  }
});

test('a read that does not add up pauses the table, so a record missed is not taken as deleted', async () => {
  // A server that says three records are there but hands over two.
  const fake = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const ok = (response: unknown) => res.end(JSON.stringify({ response, messages: [{ code: '0', message: 'OK' }] }));
    if (req.method === 'POST') return ok({ token: 't' });
    if (req.method === 'DELETE') return ok({});
    if (/\/records\?/.test(req.url ?? '')) {
      const offset = Number(new URL(req.url!, 'http://x').searchParams.get('_offset'));
      const rec = (n: number) => ({ fieldData: { uuid: `u${n}`, modts: '' }, recordId: String(n), modId: '1' });
      return ok({ dataInfo: { foundCount: 3 }, data: offset === 1 ? [rec(1), rec(2)] : [] });
    }
    return ok({ fieldMetaData: [{ name: 'uuid' }, { name: 'modts' }] });
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  const source = dataApiSource({ server: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, database: 'Remote', user: 'Admin', password: 'pw', tables: [table], pageSize: 2 });
  try {
    const [plan] = await syncPlan(local, 'Local', [table], source);
    assert.match(plan.paused ?? '', /changed while it was read \(2 records read, 3 there\)/);
    assert.equal(plan.pulls.length + plan.pushes.length, 0);
  } finally {
    await source.close();
    fake.close();
  }
});

test('same-count source edits between pages pause instead of planning from a mixed snapshot', async () => {
  let reads = 0;
  const fake = createServer((req, res) => {
    const ok = (response: unknown) => res.end(JSON.stringify({ response, messages: [{ code: '0' }] }));
    if (req.method === 'POST') return ok({ token: 't' });
    if (req.method === 'DELETE') return ok({});
    if (!req.url?.includes('/records?')) return ok({ fieldMetaData: [{ name: 'uuid' }, { name: 'modts' }] });
    reads++;
    const offset = Number(new URL(req.url, 'http://x').searchParams.get('_offset'));
    const version = reads > 2 ? 'changed' : 'original';
    return ok({ dataInfo: { foundCount: 2 }, data: [{ fieldData: { uuid: `u${offset}`, modts: '', Name: version }, recordId: String(offset), modId: version === 'changed' ? '2' : '1' }] });
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  const source = dataApiSource({ server: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, database: 'Remote', user: 'Admin', password: 'pw', tables: [table], pageSize: 1 });
  try {
    const [plan] = await syncPlan(local, 'Local', [table], source);
    assert.match(plan.paused ?? '', /changed while it was read/);
    assert.equal(reads, 4);
  } finally { await source.close(); await new Promise<void>((done) => fake.close(() => done())); }
});

test('a formerly empty layout gaining a record during the read also pauses', async () => {
  let reads = 0;
  const fake = createServer((req, res) => {
    const ok = (response: unknown, code = '0') => res.end(JSON.stringify({ response, messages: [{ code }] }));
    if (req.method === 'POST') return ok({ token: 't' });
    if (req.method === 'DELETE') return ok({});
    if (!req.url?.includes('/records?')) return ok({ fieldMetaData: [{ name: 'uuid' }, { name: 'modts' }] });
    if (++reads === 1) return ok({}, '401');
    return ok({ dataInfo: { foundCount: 1 }, data: [{ fieldData: { uuid: 'new', modts: '' }, recordId: '1', modId: '1' }] });
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  const source = dataApiSource({ server: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, database: 'Remote', user: 'Admin', password: 'pw', tables: [table] });
  try {
    const [plan] = await syncPlan(local, 'Local', [table], source);
    assert.match(plan.paused ?? '', /changed while it was read/);
    assert.equal(reads, 2);
  } finally { await source.close(); await new Promise<void>((done) => fake.close(() => done())); }
});

test('fresh verification reports exact counts, deterministic sample checksums and field-list design hashes', async () => {
  const source = dataApiSource({ server: base, database: 'Remote', user: 'Admin', password: 'pw', tables: [table], pageSize: 2 });
  try {
    const [check] = await verifySync(local, [table], source);
    assert.deepEqual([check.localCount, check.remoteCount, check.sampled], [4, 4, 4]);
    assert.ok(check.sampleDifferences > 0);
    assert.notEqual(check.localSampleHash, check.remoteSampleHash);
    assert.notEqual(check.localDesignHash, check.remoteDesignHash);
    assert.match(describeSyncVerification([check]).join('\n'), /DIFFERENCE: field-list design hash differs/);
    assert.match(describeSyncVerification([check]).join('\n'), /DIFFERENCE: \d+ of 4 sampled keyed records differ or are missing/);
  } finally { await source.close(); }
});

test('Data API reads cap bodies, enforce a total deadline, and retry transient GET failures', async () => {
  const run = async (handler: (req: IncomingMessage, res: ServerResponse) => void, opts: { maxResponseBytes?: number; requestTimeoutMs?: number }, check: (source: ReturnType<typeof dataApiSource>, server: string) => Promise<void>) => {
    const fake = createServer(handler);
    await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
    const server = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    const source = dataApiSource({ server, database: 'Remote', user: 'Admin', password: 'pw', tables: [table], ...opts });
    try { await check(source, server); }
    finally {
      await source.close();
      await new Promise<void>((done) => fake.close(() => done()));
    }
  };
  const ok = (res: ServerResponse, response: unknown) => res.end(JSON.stringify({ response, messages: [{ code: '0' }] }));

  await run((_req, res) => {
    if (_req.method === 'POST') return ok(res, { token: 't' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"response":"');
    res.end('x'.repeat(300));
  }, { maxResponseBytes: 128 }, async (source) => {
    await assert.rejects(source.changedSince('Contacts', null), /exceeded the 128-byte limit/);
  });

  let drips = 0;
  await run((req, res) => {
    if (req.method === 'POST') return ok(res, { token: 't' });
    if (req.method === 'DELETE') return ok(res, {});
    drips++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    const drip = setInterval(() => res.write(' '), 20);
    res.on('close', () => clearInterval(drip));
  }, { requestTimeoutMs: 120 }, async (source) => {
    await assert.rejects(source.changedSince('Contacts', null), /request deadline/);
    assert.ok(drips >= 1);
  });

  let metadataGets = 0;
  await run((req, res) => {
    if (req.method === 'POST') return ok(res, { token: 't' });
    if (req.method === 'DELETE') return ok(res, {});
    if (req.url?.includes('/records?')) return ok(res, { dataInfo: { foundCount: 0 }, data: [] });
    if (++metadataGets === 1) return res.writeHead(503).end('unavailable');
    return ok(res, { fieldMetaData: [{ name: 'uuid' }, { name: 'modts' }] });
  }, {}, async (source) => {
    assert.deepEqual(await source.changedSince('Contacts', null), []);
    assert.equal(metadataGets, 2, 'the GET is retried once and then succeeds');
  });

  let writes = 0;
  await run((req, res) => {
    if (req.url?.endsWith('/sessions')) return ok(res, { token: 't' });
    if (req.method === 'POST') { writes++; return res.writeHead(503).end('unavailable'); }
    if (req.method === 'DELETE') return ok(res, {});
    return ok(res, {});
  }, {}, async (_source, server) => {
    const client = dataApiClient({ server, database: 'Remote', user: 'Admin', password: 'pw', tables: [table] });
    try {
      await assert.rejects(client.create('Contacts', { uuid: 'u1' }), /couldn't create the record/);
      assert.equal(writes, 1, 'a refused write is sent once, without GET retry/backoff');
    } finally {
      await client.close();
    }
  });
});

test('the password never crosses a network in the clear', () => {
  assert.throws(() => dataApiSource({ server: 'http://fms.example.com', database: 'Remote', user: 'Admin', password: 'pw', tables: [table] }), /use https/);
});

test('a closed source cannot start another authenticated read', async () => {
  const source = dataApiSource({ server: base, database: 'Remote', user: 'Admin', password: 'pw', tables: [table] });
  await source.close();
  await assert.rejects(source.layoutFields('Contacts'), /session is closed/);
  await assert.rejects(source.changedSince('Contacts', null), /session is closed/);
});

test('a wrong password is a clear sign-in error', async () => {
  const source = dataApiSource({ server: base, database: 'Remote', user: 'Admin', password: 'nope', tables: [table] });
  try {
    await assert.rejects(syncPlan(local, 'Local', [table], source), (e: Error) => e instanceof FmsSyncError && /couldn't sign in to Remote/.test(e.message));
  } finally {
    await source.close();
  }
});

test('the configuration file: checked, with a table\'s layout defaulting to its name', () => {
  assert.deepEqual(parseSyncConfig({ server: 'fms.example.com', database: 'Invoices', tables: [{ localTable: 'Invoices', uuidField: 'id', modTimestampField: 'modified', policy: 'newer-wins' }] }),
    { server: 'fms.example.com', database: 'Invoices', tables: [{ localTable: 'Invoices', remoteLayout: 'Invoices', uuidField: 'id', modTimestampField: 'modified', policy: 'newer-wins' }] });
  assert.throws(() => parseSyncConfig({ server: 'x', database: 'y', tables: [] }), /needs "tables"/);
  assert.throws(() => parseSyncConfig({ server: 'x', database: 'y', tables: [{ localTable: 'T', uuidField: 'id' }] }), /tables\[0\] needs "modTimestampField"/);
  assert.throws(() => parseSyncConfig({ server: 'x', database: 'y', tables: [{ localTable: 'T', uuidField: 'id', modTimestampField: 'm', policy: 'last-wins' }] }), /"policy" is one of/);
});

test('the configuration file caps its table count at 1000', () => {
  const entry = { localTable: 'T', uuidField: 'id', modTimestampField: 'm' };
  assert.equal(parseSyncConfig({ server: 'x', database: 'y', tables: Array(1000).fill(entry) }).tables.length, 1000);
  assert.throws(() => parseSyncConfig({ server: 'x', database: 'y', tables: Array(1001).fill(entry) }), /at most 1000 tables/);
});

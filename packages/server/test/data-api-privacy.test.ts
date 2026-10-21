import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStore, type PrivilegeDefinition, type Change } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { SqlEndpoint } from '../src/sql.ts';
import { ODataEndpoint } from '../src/odata.ts';
import { Live, MAX_STREAM_BUFFER } from '../src/live.ts';
import { describeRecord } from '../src/record-context.ts';
import { PgServer } from '../src/pgwire.ts';
import { PgClient } from './pg-client.ts';

const all = { view: true, edit: true, create: true, delete: true };
const definition: PrivilegeDefinition = {
  name: 'Reader', records: all, layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
  extendedPrivileges: ['fmrest', 'fmodata', 'fmxdbc'],
};

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-data-api-privacy-'));
  for (const name of ['Main', 'Other']) createStore(join(dir, `${name}.openhbam.sqlite`));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.get('Main')!;
  const other = host.get('Other')!;
  const api = new DataApi(host);
  const live = new Live(host, api);
  t.after(async () => {
    live.closeAll();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Title' }, { name: 'Tenant' }] },
    { op: 'createLayout', name: 'BlockedRecords', occurrence: 'Items' },
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Title' }, { name: 'Link' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Title' }, { name: 'Link' }] },
    { op: 'createTable', name: 'Grandchildren', fields: [{ name: 'Title' }, { name: 'Link' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Link', right: 'Link' }] },
    { op: 'createRelationship', left: 'Children', right: 'Grandchildren', predicates: [{ left: 'Link', right: 'Link' }] },
  ]);
  other.applyDesign([{ op: 'createTable', name: 'PrivateTable', fields: [{ name: 'PrivateColumn' }, { name: 'PublicColumn' }] }]);
  store.applyDesign([
    { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'ExternalPrivate', file: 'Other', externalTable: other.schema.tables.find((x) => x.name === 'PrivateTable')!.id },
    { op: 'createLayout', name: 'External', occurrence: 'ExternalPrivate' },
  ]);
  const a = store.create('Items', { Title: 'A item', Tenant: 'A' }).recordId;
  const b = store.create('Items', { Title: 'B item', Tenant: 'B' }).recordId;
  const parent = store.create('Parents', { Title: 'parent', Link: 'private-key' }).recordId;
  store.create('Children', { Title: 'child', Link: 'private-key' });
  store.create('Grandchildren', { Title: 'grandchild', Link: 'private-key' });
  store.savePrivilegeSet(definition);
  store.setPassword('Reader', 'test-password', 'Reader');
  const token = store.createApiToken('Reader');
  return { host, store, other, api, live, sql: new SqlEndpoint(host, api), odata: new ODataEndpoint(host, api), token, a, b, parent,
    // A privilege-set change signs existing sessions out, so a test that changes privileges mints a new token.
    fresh: (scope?: { layouts: string[] }) => store.createApiToken('Reader', scope) };
}

class Response extends EventEmitter {
  status = 0;
  text = '';
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  writableLength = 0;
  writeHead(status: number) { this.status = status; this.headersSent = true; return this; }
  setHeader() { return this; }
  getHeader() { return undefined; }
  write(text: string) { this.text += text; return true; }
  end(text = '') { this.text += text; this.writableEnded = true; this.emit('close'); return this; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
  get body(): any { return JSON.parse(this.text); }
  get events(): Change[] { return [...this.text.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1])); }
}

async function request(endpoint: { handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> }, path: string, token: string, from = '127.0.0.1') {
  const req = Object.assign(new EventEmitter(), {
    method: 'GET', headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: from, destroyed: false },
  });
  const res = new Response();
  assert.equal(await endpoint.handle(req as IncomingMessage, res as unknown as ServerResponse, new URL(path, 'http://localhost')), true);
  return res;
}

test('AR-server-data-apis-01', async (t) => {
  const f = fixture(t);
  f.store.applySecurity([{ op: 'setAccount', name: 'Reader', localOnly: true }]);
  for (const [name, endpoint, path] of [
    ['Data API', f.api, `/fmi/data/vLatest/databases/Main/layouts/Items/records/${f.a}`],
    ['SQL', f.sql, '/tabularius/sql/v1/databases/Main?q=SELECT%201'],
    ['OData', f.odata, '/fmi/odata/v4/Main/Items'],
  ] as const) await t.test(name, async () => {
    assert.equal((await request(endpoint, path, f.token, '203.0.113.25')).status, 403);
    assert.equal((await request(endpoint, path, f.token)).status, 200);
    f.store.applySecurity([{ op: 'setAccount', name: 'Reader', localOnly: false }]);
    assert.equal((await request(endpoint, path, f.token, '203.0.113.25')).status, 200);
    f.store.applySecurity([{ op: 'setAccount', name: 'Reader', localOnly: true }]);
  });
});

test('AR-server-data-apis-02', async (t) => {
  const f = fixture(t);
  for (const table of ['Parents', 'Children', 'Grandchildren']) {
    for (const access of ['none', 'masked'] as const) await t.test(`${table} ${access}`, () => {
      f.store.savePrivilegeSet({ ...definition, tables: { [table]: { ...all, fields: { Link: access } } } });
      const p = f.store.privileges('Reader');
      const context = describeRecord(f.store, 'Parents', f.parent, { privileges: p, follow: ['Grandchildren'] });
      assert.deepEqual(context.related, []);
      if (table !== 'Grandchildren') assert.deepEqual(describeRecord(f.store, 'Parents', f.parent, { privileges: p }).related, []);
    });
  }
  f.store.savePrivilegeSet(definition);
  assert.equal(describeRecord(f.store, 'Parents', f.parent, { privileges: f.store.privileges('Reader'), follow: ['Grandchildren'] }).related[0].count, 1);
});

test('AR-server-data-apis-02 owner privileges and intermediate records', (t) => {
  const f = fixture(t);
  f.other.create('PrivateTable', { PrivateColumn: 'private-key', PublicColumn: 'visible' });
  f.other.savePrivilegeSet({ ...definition, records: { ...all, fields: { PrivateColumn: 'none' } } });
  f.other.setPassword('Reader', 'other-password', 'Reader');
  const externalKey = f.other.schema.tables.find((x) => x.name === 'PrivateTable')!.fields.find((x) => x.name === 'PrivateColumn')!.id;
  f.store.applyDesign([{ op: 'createRelationship', left: 'Parents', right: 'ExternalPrivate', predicates: [{ left: 'Link', right: externalKey }] }]);
  assert.deepEqual(describeRecord(f.store, 'Parents', f.parent, { privileges: f.store.privileges('Reader'), follow: ['ExternalPrivate'] }).related, []);
  f.other.savePrivilegeSet(definition);
  assert.equal(describeRecord(f.store, 'Parents', f.parent, { privileges: f.store.privileges('Reader'), follow: ['ExternalPrivate'] }).related[0].count, 1);
  f.store.savePrivilegeSet({ ...definition, tables: { Children: { ...all, view: 'Title = "unavailable"' } } });
  const context = describeRecord(f.store, 'Parents', f.parent, { privileges: f.store.privileges('Reader'), follow: ['Grandchildren'] });
  assert.equal(context.related[0].count, 0);
  assert.deepEqual(context.related[0].records, []);
});

test('AR-server-data-apis-03 events', async (t) => {
  const f = fixture(t);
  const restricted = { ...definition, tables: { Items: { ...all, view: 'Tenant = "A"' } } };
  f.store.savePrivilegeSet(restricted);
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', f.fresh());
  t.after(() => stream.destroy());
  f.store.update('Items', f.b, { Title: 'changed B' });
  f.store.update('Items', f.a, { Title: 'changed A' });
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => e.recordId), [f.a]);
  stream.text = '';
  // A bulk change keeps only the ids the account can see; a table-wide change with no visible row says nothing.
  f.store.notify('update', 'Items', undefined, undefined, undefined, undefined, [f.a, f.b]);
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => e.ids), [[f.a]]);
  stream.text = '';
  f.store.notify('truncate', 'Items');
  await Promise.resolve();
  assert.equal(stream.events.length, 0);
  f.store.notify('update', 'Items', undefined, undefined, undefined, undefined, [f.a]);
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => e.ids), [[f.a]]);
  stream.text = '';
  f.store.delete('Items', f.b);
  f.store.delete('Items', f.a);
  await Promise.resolve();
  assert.ok(stream.events.every((e) => e.recordId !== f.b && !e.ids?.includes(f.b)));
  assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['delete', f.a]]);
  assert.ok(!stream.text.includes('deletedVisibility') && !stream.text.includes('Tenant'), 'visibility evidence stays internal');
});

test('AR-server-data-apis-03 deletes use the last row under scoped and unscoped tokens', async (t) => {
  for (const scoped of [false, true]) await t.test(scoped ? 'scoped' : 'unscoped', async (t) => {
    const f = fixture(t);
    f.store.savePrivilegeSet({ ...definition, tables: { Items: { ...all, view: 'Tenant = "A"' } } });
    const token = f.fresh(scoped ? { layouts: ['Items'] } : undefined);
    const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', token);
    t.after(() => stream.destroy());
    // A hidden row's id is immediately reused by a visible row; the old delete must remain hidden.
    f.store.delete('Items', f.b);
    assert.equal(f.store.create('Items', { Tenant: 'A' }).recordId, f.b);
    await Promise.resolve();
    assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['create', f.b]]);
    stream.text = '';
    // The inverse: a visible delete must survive reuse of its id by a hidden row before flush.
    f.store.delete('Items', f.b, { privileges: f.store.privileges('Reader'), account: 'Reader' });
    assert.equal(f.store.create('Items', { Tenant: 'B' }).recordId, f.b);
    await Promise.resolve();
    assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['delete', f.b]]);
  });
});

test('AR-server-data-apis-03 queued deletes recheck row rules and layout access', async (t) => {
  for (const revoke of ['row rule', 'table', 'layout', 'account'] as const) await t.test(revoke, async (t) => {
    const f = fixture(t);
    const restricted = { ...definition, tables: { Items: { ...all, view: 'Tenant = "A"' } } };
    f.store.savePrivilegeSet(restricted);
    const token = f.store.createApiToken('Reader', { layouts: ['Items'] });
    const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', token);
    t.after(() => stream.destroy());
    f.store.delete('Items', f.a);
    if (revoke === 'account') f.store.setAccountActive('Reader', false);
    else f.store.savePrivilegeSet(revoke === 'layout'
      ? { ...restricted, layoutAccess: { Items: { layout: 'viewOnly', records: 'none' } } }
      : { ...definition, tables: { Items: { ...all, view: revoke === 'table' ? false : 'Tenant = "B"' } } });
    await Promise.resolve();
    assert.equal(stream.events.filter((e) => e.kind === 'delete').length, 0);
    if (revoke === 'account') f.store.setAccountActive('Reader', true);
    f.store.savePrivilegeSet(restricted);
    const allowed = await request(f.live, '/tabularius/live/v1/databases/Main/events', f.fresh({ layouts: ['Items'] }));
    t.after(() => allowed.destroy());
    const id = f.store.create('Items', { Tenant: 'A' }).recordId;
    await Promise.resolve();
    allowed.text = '';
    f.store.delete('Items', id);
    await Promise.resolve();
    assert.deepEqual(allowed.events.map((e) => [e.kind, e.recordId]), [['delete', id]]);
  });
});

test('AR-server-data-apis-03 external deletes retain owner rules across serialized changes', async (t) => {
  const f = fixture(t);
  f.other.savePrivilegeSet({ ...definition, records: { ...all, view: 'PublicColumn = "A"' } });
  f.other.setPassword('Reader', 'other-password', 'Reader');
  const a = f.other.create('PrivateTable', { PrivateColumn: 'never on the wire', PublicColumn: 'A' }).recordId;
  const b = f.other.create('PrivateTable', { PrivateColumn: 'hidden', PublicColumn: 'B' }).recordId;
  const token = f.store.createApiToken('Reader', { layouts: ['External'] });
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', token);
  t.after(() => stream.destroy());
  const listeners = [...f.other.listeners];
  const changes: Change[] = [];
  // The cluster serializes changes before delivering them to the receiving process's listeners.
  f.other.listeners.clear();
  f.other.listeners.add((c) => changes.push(JSON.parse(JSON.stringify(c))));
  f.other.delete('PrivateTable', b);
  f.other.delete('PrivateTable', a);
  for (const c of changes) for (const listener of listeners) listener({ ...c, remote: true });
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => [e.kind, e.file, e.recordId]), [['delete', 'Other', a]]);
  assert.ok(!stream.text.includes('deletedVisibility') && !stream.text.includes('never on the wire'));
});

test('AR-server-data-apis-03 delete visibility is decided before table-dependent rules change', async (t) => {
  const f = fixture(t);
  f.store.savePrivilegeSet({ ...definition, tables: {
    Items: { ...all, view: 'ExecuteSQL ( "SELECT COUNT(*) FROM Items" ; "" ; "" ) = 2' },
  } });
  assert.equal(f.store.canViewRecord('Items', f.b, f.store.privileges('Reader')), true);
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', f.fresh());
  t.after(() => stream.destroy());
  f.store.delete('Items', f.b);
  assert.equal(f.store.canViewRecord('Items', f.a, f.store.privileges('Reader')), false);
  f.store.delete('Items', f.a);
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['delete', f.b]]);
});

test('AR-server-data-apis-03 delete visibility includes external principals on other workers', async (t) => {
  const f = fixture(t);
  f.store.savePrivilegeSet({ ...definition, tables: {
    Items: { ...all, view: 'Tenant = "A" and Get ( AccountName ) = "directory-reader"' },
  } });
  f.store.setExternalAccount('Directory', 'Reader');
  const token = f.api.open(f.store, 'directory-reader', 'rest', 'Directory');
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', token);
  t.after(() => stream.destroy());
  const sessions = f.api.own(() => 1);
  // The writer knows this reader only through the cluster's session list.
  t.mock.method(f.api, 'own', () => []);
  f.api.others = () => sessions;
  f.store.delete('Items', f.b);
  f.store.delete('Items', f.a);
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['delete', f.a]]);
  assert.ok(!stream.text.includes('deletedVisibility'));
});

test('AR-server-data-apis-03 restore deletes use the last row', async (t) => {
  const f = fixture(t);
  f.store.savePrivilegeSet({ ...definition, tables: { Items: { ...all, view: 'Tenant = "A"' } } });
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', f.fresh());
  t.after(() => stream.destroy());
  assert.equal(f.store.restoreRecord('Items', f.b, 0).action, 'deleted');
  assert.equal(f.store.restoreRecord('Items', f.a, 0).action, 'deleted');
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['delete', f.a]]);
});

test('AR-server-data-apis-03 deletes without row rules still reach scoped streams', async (t) => {
  const f = fixture(t);
  const token = f.store.createApiToken('Reader', { layouts: ['Items'] });
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', token);
  t.after(() => stream.destroy());
  f.store.delete('Parents', f.parent);
  f.store.delete('Items', f.a);
  await Promise.resolve();
  assert.deepEqual(stream.events.map((e) => [e.kind, e.recordId]), [['delete', f.a]]);
});

test('AR-server-data-apis-03 pending delete visibility counts toward the buffer limit', async (t) => {
  const f = fixture(t);
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', f.token);
  t.after(() => stream.destroy());
  const subscribed = f.store.listeners.size;
  f.store.notify('delete', 'Items', f.a, undefined, undefined, undefined, undefined,
    [{ account: 'Reader', rule: 'a'.repeat(MAX_STREAM_BUFFER + 1) }]);
  await Promise.resolve();
  assert.equal(stream.destroyed, true);
  assert.equal(f.live.streamCount, 0);
  assert.equal(f.store.listeners.size, subscribed - 1);
  assert.equal(stream.events.length, 0);
});

test('AR-server-data-apis-03 presence', async (t) => {
  const f = fixture(t);
  f.store.savePrivilegeSet({ ...definition, tables: { Items: { ...all, view: 'Tenant = "A"' } } });
  for (const id of [f.a, f.b]) {
    f.store.locks.acquire('Items', id, 'admin-session', 'Admin');
    f.store.locks.view('Items', id, 'admin-session', 'Admin');
  }
  const token = f.fresh();
  for (const path of ['locks', 'viewers']) await t.test(path, async () => {
    const reply = await request(f.live, `/tabularius/live/v1/databases/Main/${path}`, token);
    assert.deepEqual(reply.body[path].map((x: { recordId: number }) => x.recordId), [f.a]);
  });
});

test('AR-server-data-apis-03 scope and current privileges', async (t) => {
  const f = fixture(t);
  const token = f.store.createApiToken('Reader', { layouts: ['Items'] });
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', token);
  t.after(() => stream.destroy());
  f.store.locks.view('Parents', f.parent, 'admin-session', 'Admin');
  f.store.notify('view', 'Parents', f.parent);
  const external = f.other.create('PrivateTable', { PrivateColumn: 'private' }).recordId;
  f.other.locks.view('PrivateTable', external, 'admin-session', 'Admin');
  f.other.notify('view', 'PrivateTable', external);
  f.store.update('Items', f.a, { Title: 'queued' });
  f.store.savePrivilegeSet({ ...definition, layoutAccess: { Items: { layout: 'viewOnly', records: 'none' } } });
  await Promise.resolve();
  // The queued update is dropped and the stream is told its sign-in expired.
  assert.ok(!stream.text.includes('event: change'));
  assert.ok(stream.text.includes('event: expired'));
  // The privilege change also signed the old token out.
  assert.equal((await request(f.live, '/tabularius/live/v1/databases/Main/viewers', token)).status, 401);
  f.store.savePrivilegeSet(definition);
  const again = f.fresh({ layouts: ['Items'] });
  assert.deepEqual((await request(f.live, '/tabularius/live/v1/databases/Main/viewers', again)).body.viewers, []);
  const allowed = await request(f.live, '/tabularius/live/v1/databases/Main/events', again);
  t.after(() => allowed.destroy());
  f.store.update('Items', f.a, { Title: 'allowed again' });
  await Promise.resolve();
  assert.deepEqual(allowed.events.map((e) => e.recordId), [f.a]);
});

test('AR-server-data-apis-03 pending buffer', async (t) => {
  const f = fixture(t);
  const stream = await request(f.live, '/tabularius/live/v1/databases/Main/events', f.token);
  t.after(() => stream.destroy());
  const subscribed = f.store.listeners.size;
  f.store.notify('update', 'Items', f.a, undefined, { account: 'a'.repeat(MAX_STREAM_BUFFER + 1) });
  await Promise.resolve();
  assert.equal(stream.destroyed, true);
  assert.equal(f.live.streamCount, 0);
  assert.equal(f.store.listeners.size, subscribed - 1);
  assert.equal(stream.events.length, 0);
});

test('AR-server-data-apis-04 HTTP', async (t) => {
  const f = fixture(t);
  const sql = (query: string) => request(f.sql, '/tabularius/sql/v1/databases/Main?q=' + encodeURIComponent(query), f.token);
  assert.ok(!(await request(f.sql, '/tabularius/sql/v1/databases/Main/tables', f.token)).body.tables.some((x: { name: string }) => x.name === 'ExternalPrivate'));
  assert.notEqual((await sql('SELECT * FROM ExternalPrivate')).status, 200);
  for (const [table, column] of [['FileMaker_Fields', 'TableName'], ['FileMaker_Tables', 'TableName']] as const) await t.test(table, async () => {
    const r = await sql(`SELECT * FROM ${table}`);
    assert.equal(r.status, 200, r.text);
    const index = r.body.columns.findIndex((x: { name: string }) => x.name === column);
    assert.ok(r.body.rows.some((row: string[]) => row[index] === 'Items'));
    assert.ok(!r.body.rows.some((row: string[]) => row[index] === 'ExternalPrivate'));
  });
  f.other.savePrivilegeSet({ ...definition, records: { ...all, fields: { PrivateColumn: 'none' } } });
  f.other.setPassword('Reader', 'other-password', 'Reader');
  const columns = await sql("SELECT FieldName FROM FileMaker_Fields WHERE TableName = 'ExternalPrivate'");
  assert.equal(columns.status, 200, columns.text);
  assert.deepEqual(columns.body.rows, [['PublicColumn']]);
  f.other.savePrivilegeSet(definition);
  const granted = await sql("SELECT FieldName FROM FileMaker_Fields WHERE TableName = 'ExternalPrivate' ORDER BY FieldName");
  assert.deepEqual(granted.body.rows, [['PrivateColumn'], ['PublicColumn']]);
  assert.equal(f.host.closeFile('Other'), true);
  const closed = await sql("SELECT TableName FROM FileMaker_Tables WHERE TableName = 'ExternalPrivate'");
  assert.equal(closed.status, 200, closed.text);
  assert.deepEqual(closed.body.rows, []);
});

test('AR-server-data-apis-04 pgwire', async (t) => {
  const f = fixture(t);
  const pg = new PgServer(f.host, { port: 0 });
  t.after(() => pg.close());
  const c = await PgClient.open({ port: await pg.listen(), user: 'Reader', password: 'test-password', database: 'Main' });
  t.after(() => c.close());
  assert.equal((await c.simple('SELECT * FROM ExternalPrivate')).error?.code, '42501');
  for (const query of ['SELECT table_name, column_name FROM information_schema.columns', 'SELECT TableName, FieldName FROM FileMaker_Fields']) await t.test(query, async () => {
    for (const r of [await c.simple(query), await c.extended(query)]) {
      assert.equal(r.error, undefined);
      assert.ok(r.rows.some((row) => row[0] === 'Items'));
      assert.ok(!r.rows.some((row) => row[0] === 'ExternalPrivate'));
    }
  });
  f.other.savePrivilegeSet({ ...definition, records: { ...all, fields: { PrivateColumn: 'masked' } } });
  f.other.setPassword('Reader', 'other-password', 'Reader');
  const query = "SELECT column_name FROM information_schema.columns WHERE table_name = 'ExternalPrivate' ORDER BY column_name";
  assert.deepEqual((await c.simple(query)).rows, [['PublicColumn']]);
  f.other.savePrivilegeSet(definition);
  assert.deepEqual((await c.extended(query)).rows, [['PrivateColumn'], ['PublicColumn']]);
  f.other.setAccountActive('Reader', false);
  assert.deepEqual((await c.simple(query)).rows, []);
});

test('AR-server-data-apis-05', async (t) => {
  const f = fixture(t);
  f.store.savePrivilegeSet({ ...definition, layoutAccess: { BlockedRecords: { layout: 'viewOnly', records: 'none' } } });
  const token = f.fresh();
  const path = `/fmi/data/vLatest/databases/Main/layouts/BlockedRecords/records/${f.a}`;
  assert.equal((await request(f.api, path, token)).body.messages[0].code, '200');
  assert.equal((await request(f.api, path + '?layout.response=Items', token)).body.messages[0].code, '200');
  assert.equal((await request(f.api, `/fmi/data/vLatest/databases/Main/layouts/Items/records/${f.a}`, token)).status, 200);
  assert.equal((await request(f.api, `/fmi/data/vLatest/databases/Main/layouts/Items/records/${f.a}?layout.response=BlockedRecords`, token)).body.messages[0].code, '200');
});

// fmDataSource at log in (the guide's "Log in to an external data source"): an account and password for another
// hosted file whose tables a layout shows. That file's account then decides what the session sees there; without
// it, the session's own account name is used there, as before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { sessionPrivileges } from '../src/dataapi.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, Store } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-data-source-'));
  const open = (name: string) => {
    createStore(join(dir, name + STORE_EXT));
    return new Store(join(dir, name + STORE_EXT), name);
  };
  const b = open('B');
  b.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
  b.create('Items', { Title: 'from B' });
  b.setPassword('Clerk', 'b-pw', '[Full Access]');
  b.setPassword('Backup', 'backup-pw', '[Full Access]');
  const items = b.schema.tables.find((t) => t.name === 'Items')!;
  const table = items.id;
  const title = items.fields.find((f) => f.name === 'Title')!.id;
  b.close();
  const a = open('A');
  a.applyDesign([
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
    { op: 'createOccurrence', name: 'BItems', file: 'B', externalTable: table },
    { op: 'createLayout', name: 'External', occurrence: 'BItems' },
  ]);
  const ext = a.schema.tableOccurrences.find((t) => t.name === 'BItems')!.id;
  a.applyDesign([{ op: 'updateLayout', layout: 'External', design: { objects: [{
    id: 101, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 20, left: 20, bottom: 40, right: 300 },
    field: { tableOccurrenceId: ext, fieldId: title, tableOccurrence: 'BItems', field: 'Title', display: 'edit', repetitions: 1 },
  } as never], tableView: [] } }]);
  // Ann has no account in B.
  a.setPassword('Ann', 'a-pw', '[Full Access]');
  a.close();
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function call(path: string, auth: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/fmi/data/vLatest${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const login = (body: unknown) => call('/databases/A/sessions', 'Basic ' + btoa('Ann:a-pw'), 'POST', body);
const records = async (token: string) => call('/databases/A/layouts/External/records', 'Bearer ' + token);

test('without fmDataSource, a file with no account of the same name shows nothing', async () => {
  const r = await login({});
  assert.equal(r.status, 200);
  const got = await records(r.body.response.token);
  assert.equal(got.body.messages[0].code, '200', JSON.stringify(got.body.messages)); // no access to B's records
});

test('fmDataSource signs in to the other file with its own account', async () => {
  const r = await login({ fmDataSource: [{ database: 'B', username: 'Clerk', password: 'b-pw' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  const got = await records(r.body.response.token);
  assert.equal(got.status, 200, JSON.stringify(got.body.messages));
  assert.deepEqual(got.body.response.data.map((x: any) => x.fieldData.Title), ['from B']);
});

test('data-source sessions stop using an account after it is deactivated', async () => {
  const r = await login({ fmDataSource: [{ database: 'B', username: 'Clerk', password: 'b-pw' }] });
  assert.equal(r.status, 200);
  const b = new Store(join(dir, 'B' + STORE_EXT), 'B');
  try {
    b.setAccountActive('Clerk', false);
    const got = await records(r.body.response.token);
    assert.equal(got.body.messages[0].code, '952');
  } finally {
    b.setAccountActive('Clerk', true);
    b.close();
  }
});

test('implicit same-name cross-file accounts stop granting privileges when disabled', async () => {
  const b = new Store(join(dir, 'B' + STORE_EXT), 'B');
  const a = new Store(join(dir, 'A' + STORE_EXT), 'A');
  try {
    b.setPassword('Ann', 'b-ann', '[Full Access]');
    assert.equal(a.privileges('Ann').in(b).full, true);
    b.setAccountActive('Ann', false);
    assert.equal(a.privileges('Ann').in(b).full, false);
  } finally { a.close(); b.close(); }
});

test('implicit cross-file privileges preserve and validate the trusted directory person', () => {
  const a = new Store(join(dir, 'A' + STORE_EXT), 'A');
  const b = new Store(join(dir, 'B' + STORE_EXT), 'B');
  try {
    a.setPassword('pat@example.test', 'person-a', '[Full Access]');
    b.setPassword('pat@example.test', 'person-b', '[Full Access]');
    a.setExternalAccount('Team', '[Full Access]');
    b.setExternalAccount('Team', '[Full Access]');
    const privileges = sessionPrivileges(a, {
      token: 'test-session', db: 'A', account: 'alias', via: 'Team', externalIdentity: { person: 'pat@example.test', mapping: 'Team' },
      started: Date.now(), lastUsed: Date.now(), scripts: {} as never, client: 'web',
    });
    assert.equal(privileges.in(b).full, true);
    b.setAccountActive('pat@example.test', false);
    assert.equal(privileges.in(b).full, false);
    assert.equal(b.identityAllowed('alias', 'Team', undefined, 'pat@example.test'), false);
  } finally { a.close(); b.close(); }
});

test('a deleted external mapping cannot be inherited by a replacement local account', () => {
  const a = new Store(join(dir, 'A' + STORE_EXT), 'A');
  try {
    const ro = a.privilegeSets().find((p) => p.name === '[Read-Only Access]')?.name ?? a.privilegeSets()[0]!.name;
    a.setExternalAccount('Team', ro);
    const binding = a.externalIdentityId('Team')!;
    assert.equal(a.identityAllowed('alias', 'Team', binding), true);
    assert.equal(a.deleteAccount('Team'), true);
    assert.equal(a.identityAllowed('alias', 'Team', binding), false);
    a.setPassword('Team', 'local-password', ro);
    assert.equal(a.identityAllowed('alias', 'Team', binding), false);
    assert.equal(a.identityAllowed('alias', 'Team'), false);
  } finally { a.close(); }
});

test('fmDataSource rejects more than 20 entries before any password check', async (t) => {
  const verify = t.mock.method(Store.prototype, 'verifyAsync', async () => {
    assert.fail('an oversized fmDataSource must not check any password');
  });
  for (const length of [21, 5000]) {
    const r = await login({ fmDataSource: Array.from({ length }, () => ({ database: 'B', username: 'Clerk', password: 'b-pw' })) });
    // Large envelopes are refused before JSON/list validation; both paths precede password checks.
    assert.equal(r.status, length === 5000 ? 413 : 400);
    assert.equal(r.body.messages[0].code, '960');
  }
  assert.equal(verify.mock.callCount(), 0);
});

test('fmDataSource rejects a malformed second entry before any password check', async (t) => {
  const verify = t.mock.method(Store.prototype, 'verifyAsync');
  const valid = { database: 'B', username: 'Clerk', password: 'b-pw' };
  for (const invalid of [
    { database: 5 },
    { ...valid, database: 5 },
    { ...valid, database: '' },
    { ...valid, username: 5 },
    { ...valid, username: '' },
    { ...valid, password: 5 },
    { database: 'B', username: 'Clerk' },
    null,
  ]) {
    const r = await login({ fmDataSource: [valid, invalid] });
    assert.equal(r.status, 400);
    assert.equal(r.body.messages[0].code, '960');
    assert.equal(verify.mock.callCount(), 0, 'a malformed fmDataSource must not check any password');
  }
});

test('fmDataSource accepts 20 entries and checks each database only once, ignoring case', async (t) => {
  const verify = t.mock.method(Store.prototype, 'verifyAsync');
  const r = await login({ fmDataSource: [
    { database: 'B', username: 'Clerk', password: 'b-pw' },
    ...Array.from({ length: 18 }, (_, i) => ({ database: i % 2 ? 'B' : 'b', username: 'Ignored', password: 'wrong' })),
    { database: 'a', username: 'Ignored', password: 'wrong' },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body.messages));
  assert.equal(verify.mock.callCount(), 2, 'one primary password check and one external password check');
  const got = await records(r.body.response.token);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.response.data.map((x: any) => x.fieldData.Title), ['from B']);
});

test('a wrong password for the data source fails the log in', async () => {
  const r = await login({ fmDataSource: [{ database: 'B', username: 'Clerk', password: 'wrong' }] });
  assert.equal(r.status, 401);
  assert.equal(r.body.messages[0].code, '212');
});

test('a file that isn\'t hosted is 802, and a malformed entry is 960', async () => {
  assert.equal((await login({ fmDataSource: [{ database: 'Nope', username: 'Clerk', password: 'b-pw' }] })).body.messages[0].code, '802');
  assert.equal((await login({ fmDataSource: [{ database: 'B', oAuthRequestId: 'x' }] })).body.messages[0].code, '960');
  assert.equal((await login({ fmDataSource: 'B' })).body.messages[0].code, '960');
});

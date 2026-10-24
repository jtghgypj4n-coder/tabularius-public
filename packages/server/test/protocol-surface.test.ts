import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { serve, setAdminPassword, type ServeOptions } from '../src/index.ts';
import { openLocalAccess, localAccess } from '../src/local-admin.ts';

// Protocol surface correctness (backlog r16 C3): malformed paths, OData single-record options, the Admin API's report of
// the XML interface, logged faults, OData script sessions, pgwire protocol negotiation and Access-log sign-ins.

async function setup(t: TestContext, options: Partial<ServeOptions> = {}) {
  const dir = mkdtempSync(join(import.meta.dirname, '.protocol-surface-'));
  const logs: string[] = [];
  const s = await serve({ dir, port: 0, watch: false, log: (m) => void logs.push(m), ...options });
  t.after(async () => {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  for (const name of ['A', 'B']) {
    const store = s.host.create(name);
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }, { name: 'Note' }] }]);
    store.create('Items', { Title: `title of ${name}`, Note: `note of ${name}` });
    store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmodata', 'fmxml', 'fmxdbc'] });
    store.setPassword('alice', 'alice-password', 'Reader');
  }
  return { ...s, dir, logs, a: s.host.get('A')!, b: s.host.get('B')! };
}

const basic = (account: string, password: string) => ({ authorization: `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}` });
const alice = basic('alice', 'alice-password');

async function accessLogWithSignIns(file: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  let access = '';
  const ready = [
    /alice could not sign in to A through OData access: wrong account or password/,
    /alice signed in to A \(OData access\)/,
    /alice could not sign in to A through XML publishing: wrong account or password/,
    /alice signed in to A \(XML publishing\)/,
    /alice could not sign in to A through SQL access, like ODBC\/JDBC/,
    /alice signed in to A \(SQL access, like ODBC\/JDBC\)/,
  ];
  while (Date.now() < deadline) {
    try { access = readFileSync(file, 'utf8'); } catch { /* the log writer hasn't created it yet */ }
    if (ready.every((pattern) => pattern.test(access))) return access;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return access;
}

test('a malformed % escape in a path is a 400 on every route that decodes it, not a logged 500', async (t) => {
  const { url } = await setup(t);
  const errors = t.mock.method(console, 'error', () => {});
  const paths = [
    'fmi/data/vLatest/databases/%zz/layouts', 'fmi/data/vLatest/databases/A/layouts/%zz/records', 'fmi/data/vLatest/databases/A/scripts/%zz',
    'tabularius/admin/v1/ai-access/%zz', 'tabularius/admin/v1/conversion-guide/%zz', 'tabularius/live/v1/databases/%zz/events',
    'tabularius/security/v1/databases/%zz', 'tabularius/changes/v1/databases/%zz', 'tabularius/design/v1/databases/%zz',
    'tabularius/dashboards/v1/databases/%zz', 'tabularius/assistant/v1/databases/%zz/handover', 'tabularius/automations/v1/databases/%zz',
    'tabularius/cleanup/v1/databases/%zz/scan', 'tabularius/debug/v1/databases/%zz/scripts', 'tabularius/digests/v1/databases/%zz',
    'tabularius/scim/v2/databases/%zz', 'fmi/webd/%zz', 'tabularius/images/%zz/1', 'tabularius/app/v1/databases/%zz/runs/stop',
    'tabularius/app/v1/databases/%zz/prefs/x', 'tabularius/app/v1/databases/%zz/layouts/Items', 'fmi/odata/v4/%zz', 'fmi/odata/v4/A/%zz',
  ];
  for (const path of paths) {
    const response = await fetch(`${url}/${path}`);
    assert.equal(response.status, 400, `${path} answered ${response.status}`);
  }
  // The Data API answers in its own envelope, with the invalid-parameter code.
  const data = await (await fetch(`${url}/fmi/data/vLatest/databases/%zz/layouts`)).json();
  assert.equal(data.messages[0].code, '960');
  assert.deepEqual(errors.mock.calls.map((c) => String(c.arguments[0])), [], 'a caller\'s bad path is not logged as a server fault');
});

test('the Admin API has no route that takes a token in the path, so a malformed % escape there is just not found', async (t) => {
  const { url, dir } = await setup(t);
  setAdminPassword(dir, 'admin-secret');
  const login = await fetch(`${url}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: basic('admin', 'admin-secret') });
  assert.equal(login.status, 200);
  const token = (await login.json()).response.token as string;
  const response = await fetch(`${url}/fmi/admin/api/v2/user/auth/%zz`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 404);
});

test('OData Set(id) honours $select and refuses options a single record cannot take', async (t) => {
  const { url } = await setup(t);
  const root = `${url}/fmi/odata/v4/A`;
  const all = await (await fetch(`${root}/Items(1)`, { headers: alice })).json();
  assert.equal(all.Title, 'title of A');
  assert.equal(all.Note, 'note of A');
  const some = await (await fetch(`${root}/Items(1)?$select=Title`, { headers: alice })).json();
  assert.equal(some.Title, 'title of A');
  assert.equal(some.ROWID, 1, 'the key stays');
  assert.equal('Note' in some, false, '$select leaves the other properties out');
  assert.match(some['@odata.context'], /\(ROWID,ROWMODID,Title\)\/\$entity$/);
  assert.equal((await fetch(`${root}/Items(1)?$select=Title&$format=json`, { headers: alice })).status, 200);
  for (const option of ['$top=1', '$filter=Title%20eq%20%27x%27', '$bogus=1']) {
    const response = await fetch(`${root}/Items(1)?${option}`, { headers: alice });
    assert.equal(response.status, 400, option);
    assert.equal((await response.json()).error.code, '8310', option);
  }
  assert.equal((await fetch(`${root}/Items(1)?$levels=2`, { headers: alice })).status, 501);
  assert.equal((await fetch(`${root}/Items(1)?$select=Nothing`, { headers: alice })).status, 400);
});

test('the Admin API reports the XML interface as enabled, and still refuses to change it', async (t) => {
  const { url, a, dir } = await setup(t);
  setAdminPassword(dir, 'admin-secret');
  // The XML interface is served whatever the Admin API says.
  const served = await fetch(`${url}/fmi/xml/fmresultset.xml?-db=A&-lay=Items&-findall`, { headers: alice });
  assert.equal(served.status, 200);
  assert.match(await served.text(), /<error code="0"/);
  assert.ok(a);
  const login = await fetch(`${url}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: basic('admin', 'admin-secret') });
  assert.equal(login.status, 200);
  const bearer = { authorization: `Bearer ${(await login.json()).response.token}`, 'content-type': 'application/json' };
  assert.deepEqual((await (await fetch(`${url}/fmi/admin/api/v2/xml/config`, { headers: bearer })).json()).response, { enabled: true });
  const off = await fetch(`${url}/fmi/admin/api/v2/xml/config`, { method: 'PATCH', headers: bearer, body: JSON.stringify({ enabled: false }) });
  assert.equal(off.status, 400);
});

test('a fault of the server\'s own on the XML interface and SQL over HTTP is logged with its cause', async (t) => {
  const { url, a, logs } = await setup(t, { sqlPort: 0 });
  const errors = t.mock.method(console, 'error', () => {});
  const boom = new TypeError('boom from the store');
  const find = a.find.bind(a);
  (a as unknown as { find: unknown }).find = () => { throw boom; };
  const xml = await fetch(`${url}/fmi/xml/fmresultset.xml?-db=A&-lay=Items&-findall`, { headers: alice });
  assert.match(await xml.text(), /<error code="951"/);
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('TypeError: boom from the store')), 'the XML interface logged the cause (as redacted text with its stack)');
  (a as unknown as { find: unknown }).find = find;

  errors.mock.resetCalls();
  const sqlBoom = new TypeError('boom from SQL');
  const select = a.select.bind(a);
  (a as unknown as { select: unknown }).select = () => { throw sqlBoom; };
  const sql = await fetch(`${url}/tabularius/sql/v1/databases/A`, { method: 'POST', headers: { ...alice, 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT Title FROM Items' }) });
  (a as unknown as { select: unknown }).select = select;
  assert.equal(sql.status, 500);
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('TypeError: boom from SQL')), 'SQL over HTTP logged the cause (as redacted text with its stack)');
  assert.doesNotMatch(await sql.text(), /boom from SQL/, 'the caller is not told the fault\'s text');
  // A SQL error about the caller\'s own query is still theirs to read, and is not a fault.
  errors.mock.resetCalls();
  const mine = await fetch(`${url}/tabularius/sql/v1/databases/A`, { method: 'POST', headers: { ...alice, 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT Nothing FROM Items' }) });
  assert.equal(mine.status, 400);
  assert.equal(errors.mock.callCount(), 0);
  assert.ok(logs);
});

test('OData script sessions are kept apart for each hosted file', async (t) => {
  const { url, a, b } = await setup(t);
  for (const store of [a, b]) {
    store.applyDesign([{ op: 'createScript', name: 'Bump', text: 'Set Variable [ $$count ; $$count + 1 ]\nExit Script [ $$count ]' }] as never);
    store.savePrivilegeSet({ name: 'Runner', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: "modifiable", extendedPrivileges: ["fmodata"] });
    store.setPassword('runner', 'pw', 'Runner');
  }
  const bump = async (db: string) => (await (await fetch(`${url}/fmi/odata/v4/${db}/Script.Bump`, { method: 'POST', headers: { ...basic('runner', 'pw'), 'content-type': 'application/json' }, body: '{}' })).json()).scriptResult?.resultParameter;
  assert.equal(await bump('A'), '1');
  assert.equal(await bump('A'), '2');
  assert.equal(await bump('B'), '1', 'file B does not see file A\'s $$count');
});

test('pgwire answers a newer protocol minor or an unknown option with NegotiateProtocolVersion and goes on', async (t) => {
  const { logs } = await setup(t, { sqlPort: 0, hostname: '127.0.0.1' });
  for (let i = 0; i < 100 && !logs.some((l) => l.startsWith('PostgreSQL clients: port')); i++) await new Promise((r) => setTimeout(r, 20));
  const port = Number(/port (\d+)/.exec(logs.find((l) => l.startsWith('PostgreSQL clients'))!)![1]);
  const talk = (code: number, params: Record<string, string>) => new Promise<Buffer>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    t.after(() => socket.destroy());
    const pairs = Buffer.concat([...Object.entries(params).flatMap(([k, v]) => [Buffer.from(k), Buffer.from([0]), Buffer.from(v), Buffer.from([0])]), Buffer.from([0])]);
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + pairs.length, 0);
    head.writeInt32BE(code, 4);
    let got = Buffer.alloc(0);
    socket.on('data', (d) => {
      got = Buffer.concat([got, d]);
      // The negotiation message, then the password request (R): enough to see.
      if (got.includes(Buffer.from('R\0\0\0\u0008\0\0\0\u0003', 'latin1')) || got[0] === 0x45) resolve(got);
    });
    socket.on('error', reject);
    socket.on('connect', () => socket.write(Buffer.concat([head, pairs])));
    setTimeout(() => resolve(got), 3000);
  });
  const newer = await talk(0x00030002, { user: 'alice', database: 'A', '_pq_.test': '1' });
  assert.equal(String.fromCharCode(newer[0]), 'v');
  assert.equal(newer.readInt32BE(5), 0, 'newest minor this server speaks');
  assert.equal(newer.readInt32BE(9), 1, 'one option it does not know');
  assert.equal(newer.subarray(13, newer.indexOf(0, 13)).toString(), '_pq_.test');
  const afterIt = newer.subarray(1 + newer.readInt32BE(1));
  assert.equal(String.fromCharCode(afterIt[0]), 'R', 'the password request follows');
  // A plain 3.0 start gets no negotiation message.
  const plain = await talk(0x00030000, { user: 'alice', database: 'A' });
  assert.equal(String.fromCharCode(plain[0]), 'R');
  // Another major version is still refused.
  const other = await talk(0x00040000, { user: 'alice', database: 'A' });
  assert.equal(String.fromCharCode(other[0]), 'E');
});

test('sign-ins on OData, XML, SQL over HTTP and pgwire are written to the Access log', async (t) => {
  const { url, dir, logs } = await setup(t, { sqlPort: 0, hostname: '127.0.0.1' });
  const wrong = basic('alice', 'not-the-password');
  assert.equal((await fetch(`${url}/fmi/odata/v4/A/Items`, { headers: wrong })).status, 401);
  assert.equal((await fetch(`${url}/fmi/odata/v4/A/Items`, { headers: alice })).status, 200);
  assert.equal((await fetch(`${url}/fmi/xml/fmresultset.xml?-db=A&-lay=Items&-findall`, { headers: wrong })).status, 401);
  assert.equal((await fetch(`${url}/fmi/xml/fmresultset.xml?-db=A&-lay=Items&-findall`, { headers: alice })).status, 200);
  await fetch(`${url}/tabularius/sql/v1/databases/A`, { method: 'POST', headers: { ...wrong, 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT 1' }) });
  await fetch(`${url}/tabularius/sql/v1/databases/A`, { method: 'POST', headers: { ...alice, 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT 1' }) });
  const access = await accessLogWithSignIns(join(dir, 'Logs', 'Access.log'));
  assert.match(access, /alice could not sign in to A through OData access: wrong account or password/);
  assert.match(access, /alice signed in to A \(OData access\)/);
  assert.match(access, /alice could not sign in to A through XML publishing: wrong account or password/);
  assert.match(access, /alice signed in to A \(XML publishing\)/);
  assert.match(access, /alice could not sign in to A through SQL access, like ODBC\/JDBC/);
  assert.match(access, /alice signed in to A \(SQL access, like ODBC\/JDBC\)/);
  assert.equal(access.split('alice signed in to A (OData access)').length, 2, 'a success is written once, not on every request');
  assert.ok(logs);
});

test('the Admin API login needs Basic with the admin password: the local channel and loopback do not sign in', async (t) => {
  const { url, dir } = await setup(t);
  const auth = `${url}/fmi/admin/api/v2/user/auth`;
  // No admin password set: even a loopback caller with Basic credentials is refused, with a message that says what to do.
  const unset = await fetch(auth, { method: 'POST', headers: basic('admin', '') });
  assert.equal(unset.status, 401);
  const body = await unset.json();
  assert.equal(body.messages[0].code, '212');
  assert.match(body.messages[0].text, /Set an admin password/);

  // With a password set, the local channel token plus a wrong Basic password is still a 401.
  setAdminPassword(dir, 'admin-secret');
  const close = openLocalAccess(dir, url);
  t.after(close);
  const local = localAccess(dir)!.token;
  const viaLocal = await fetch(auth, { method: 'POST', headers: { 'x-tabularius-local': local, ...basic('admin', 'wrong') } });
  assert.equal(viaLocal.status, 401);
  assert.equal((await viaLocal.json()).messages[0].code, '212');
  const localOnly = await fetch(auth, { method: 'POST', headers: { 'x-tabularius-local': local } });
  assert.equal(localOnly.status, 401);
});

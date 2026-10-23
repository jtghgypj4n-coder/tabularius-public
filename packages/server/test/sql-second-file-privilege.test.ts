// A query that reaches the tables of a second hosted file (a user-interface file over a data file) needs the SQL
// extended privilege (fmxdbc) in that second file only when its administrator turned that on; it is off by default.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { PgClient } from './pg-client.ts';

let dir = '';
let server: Server;
let host: Host;
let base = '';
let sqlPort = 0;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-second-'));
  for (const n of ['Face', 'Data']) createStore(join(dir, `${n}.openhbam.sqlite`), { mode: 'native' });
  const logs: string[] = [];
  const s = await serve({ dir, port: 0, watch: false, sqlPort: 0, log: (m) => void logs.push(m) });
  server = s.server;
  host = s.host;
  base = s.url;
  const face = host.get('Face')!, data = host.get('Data')!;
  data.applyDesign([{ op: 'createTable', name: 'Src', fields: [{ name: 'Value' }] }] as never);
  data.create('Src', { Value: 'from-the-data-file' });
  face.applyDesign([
    { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
    { op: 'createOccurrence', name: 'External', file: 'Data', externalTable: data.schema.tables[0].id },
  ] as never);
  // Ann uses SQL in the interface file. In the data file she reads everything but her set has no SQL privilege.
  const full = face.privilegeSets().find((p) => p.id === 1)!;
  face.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxdbc'] });
  face.setPassword('Ann', 'pw', full.name);
  data.savePrivilegeSet({ name: 'Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  data.setPassword('Ann', 'pw', 'Readers');
  // Bea has it in both.
  face.setPassword('Bea', 'pw', full.name);
  data.savePrivilegeSet({ name: 'SqlReaders', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmxdbc'] });
  data.setPassword('Bea', 'pw', 'SqlReaders');
  for (let i = 0; i < 100 && !logs.some((l) => l.startsWith('PostgreSQL clients: port')); i++) await new Promise((r) => setTimeout(r, 20));
  sqlPort = Number(/port (\d+)/.exec(logs.find((l) => l.startsWith('PostgreSQL clients'))!)![1]);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const http = (account: string, sql: string) => fetch(`${base}/tabularius/sql/v1/databases/Face`, {
  method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: JSON.stringify({ sql }),
});
const pg = async (account: string, sql: string) => {
  const c = await PgClient.open({ port: sqlPort, user: account, password: 'pw', database: 'Face' });
  try { return await c.simple(sql); } finally { c.close(); }
};
const SECOND = 'SELECT Value FROM External';

test('the switch is off for a file by default and is kept in the file', () => {
  const data = host.get('Data')!;
  assert.equal(data.sqlRequiresFmxdbc, false);
  data.setSqlRequiresFmxdbc(true);
  assert.equal(data.sqlRequiresFmxdbc, true);
  data.setSqlRequiresFmxdbc(false);
  assert.equal(data.sqlRequiresFmxdbc, false);
  assert.throws(() => data.setSqlRequiresFmxdbc('yes' as never), /true or false/);
  // Each change is in the file's security log; setting what is already set adds nothing.
  const logged = () => data.securityEvents({ kind: 'sql-privilege-required' }).length;
  const before = logged();
  data.setSqlRequiresFmxdbc(false, { account: 'admin console' });
  assert.equal(logged(), before);
  data.setSqlRequiresFmxdbc(true, { account: 'admin console' });
  assert.equal(logged(), before + 1);
  assert.ok(data.securityEvents({ kind: 'sql-privilege-required' }).some((e) => e.account === 'admin console'));
  data.setSqlRequiresFmxdbc(false);
});

test('a second file is queried without its own SQL privilege while the switch is off', async () => {
  const r = await http('Ann', SECOND);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).rows, [['from-the-data-file']]);
  assert.deepEqual((await pg('Ann', SECOND)).rows, [['from-the-data-file']]);
});

test('with the switch on, the second file needs the SQL privilege for the account; its own file does not change', async () => {
  const data = host.get('Data')!;
  data.setSqlRequiresFmxdbc(true);
  try {
    const refused = await http('Ann', SECOND);
    assert.equal(refused.status, 403);
    const body = await refused.json();
    assert.equal(body.error.code, 9);
    assert.match(body.error.message, /fmxdbc/);
    assert.match(body.error.message, /Data/);
    const over = await pg('Ann', SECOND);
    assert.equal(over.error?.code, '42501');
    assert.match(over.error!.message, /fmxdbc.*Data/);
    // An account that has it in the second file, and a query that stays in the first, are not affected.
    assert.deepEqual((await (await http('Bea', SECOND)).json()).rows, [['from-the-data-file']]);
    assert.deepEqual((await pg('Bea', SECOND)).rows, [['from-the-data-file']]);
    assert.equal((await http('Ann', 'SELECT 1')).status, 200);
    // The table is not listed to the account either.
    const tables = await (await fetch(`${base}/tabularius/sql/v1/databases/Face/tables`, { headers: { authorization: 'Basic ' + btoa('Ann:pw') } })).json();
    assert.ok(!tables.tables.some((t: { name: string }) => t.name === 'External'));
    const bea = await (await fetch(`${base}/tabularius/sql/v1/databases/Face/tables`, { headers: { authorization: 'Basic ' + btoa('Bea:pw') } })).json();
    assert.ok(bea.tables.some((t: { name: string }) => t.name === 'External'));
  } finally { data.setSqlRequiresFmxdbc(false); }
  assert.equal((await http('Ann', SECOND)).status, 200, 'turning it off lets the query through again');
});

test('the admin API reads and sets it, and refuses a body that is not true or false', async () => {
  const call = async (body?: unknown) => {
    const r = await fetch(`${base}/tabularius/admin/v1/sql-privilege/Data`, body === undefined ? {} : {
      method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  assert.deepEqual((await call()).body, { on: false });
  assert.deepEqual((await call({ on: true })).body, { on: true });
  assert.equal(host.get('Data')!.sqlRequiresFmxdbc, true);
  for (const invalid of [{ on: 'false' }, null, [], { on: 1 }]) assert.equal((await call(invalid)).status, 400);
  assert.deepEqual((await call()).body, { on: true });
  assert.deepEqual((await call({ on: false })).body, { on: false });
  const missing = await fetch(`${base}/tabularius/admin/v1/sql-privilege/Nope`, { headers: { 'x-tabularius-admin': '1' } });
  assert.equal(missing.status, 404);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

// OData schema changes (FileMaker_Tables, FileMaker_Indexes), as on FileMaker Server.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
let host: Host;
const ann = { authorization: 'Basic ' + btoa('Ann:pw') };
const cy = { authorization: 'Basic ' + btoa('Cy:pw') };

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-schema-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  // Can write records over OData, but isn't [Full Access].
  store.savePrivilegeSet({
    name: 'Editors', extendedPrivileges: ['fmodata'], layouts: 'modifiable', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: true, create: true, delete: true },
  });
  store.setPassword('Cy', 'pw', 'Editors');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = ann) => {
  const res = await fetch(root + path, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) as Record<string, any> : undefined };
};

test('create a table, add fields, and use it as an entity set', { skip }, async () => {
  const store = host.get('Charts')!;
  const made = await call('POST', '/FileMaker_Tables', {
    tableName: ' Visits ',
    fields: [
      { name: 'Code', type: 'VARCHAR(10)', primary: true },
      { name: 'Seats', type: 'int', nullable: false, repetitions: 2 },
      { name: 'Day', type: 'DATE', default: 'CURRENT_DATE' },
      { name: 'Who', type: 'varchar', default: 'USER' },
      { name: 'Badge', type: 'BLOB' },
    ],
  });
  assert.equal(made.res.status, 201);
  assert.equal(made.body!.tableName, 'Visits');
  const t = store.schema.tables.find((x) => x.name === 'Visits')!;
  const f = (n: string) => t.fields.find((x) => x.name === n)!;
  assert.deepEqual([f('Code').type, f('Seats').type, f('Day').type, f('Badge').type], ['text', 'number', 'date', 'container']);
  assert.equal(f('Code').options?.validation?.notEmpty, true);
  assert.equal(f('Code').options?.validation?.unique, true);
  assert.equal(f('Code').options?.validation?.maxLength, 10);
  assert.equal(f('Seats').options?.repetitions, 2);
  assert.equal(f('Day').options?.autoEnter?.value, 'creationDate');
  assert.equal(f('Who').options?.autoEnter?.value, 'creationAccountName');

  const added = await call('PATCH', '/FileMaker_Tables/visits', { fields: [{ name: 'Note', type: 'CHARACTER VARYING', global: true }] });
  assert.equal(added.res.status, 200);
  assert.ok(added.body!.fields.some((x: any) => x.name === 'Note' && x.global));

  // The new table's occurrence is an entity set straight away, and its records take the auto-enter values.
  const rec = await call('POST', '/Visits', { Code: 'A1', Seats: 3 });
  assert.equal(rec.res.status, 201, JSON.stringify(rec.body));
  assert.equal(rec.body!.Who, 'Ann');
  const dup = await call('POST', '/Visits', { Code: 'A1', Seats: 3 });
  assert.ok(dup.res.status >= 400, 'primary means unique');

  // Each change is in the security log under the account that made it.
  assert.ok(store.securityEvents({ kind: 'schema-changed', account: 'Ann' }).length >= 2);
});

test('indexes: create and remove', { skip }, async () => {
  const store = host.get('Charts')!;
  await call('POST', '/FileMaker_Tables', { tableName: 'Tags', fields: [{ name: 'Label', type: 'VARCHAR' }] });
  const made = await call('POST', '/FileMaker_Indexes/Tags', { indexName: 'label' });
  assert.equal(made.res.status, 201);
  assert.deepEqual(made.body, { indexName: 'Label' });
  assert.ok(store.indexedFields('Tags').has('Label'));
  assert.equal(store.schema.tables.find((x) => x.name === 'Tags')!.fields[0].options?.index?.value, true);
  // An index made another way (a find-speed suggestion) is still removed as a logged design change.
  store.addFieldIndex('Tags', 'Label');
  await call('DELETE', '/FileMaker_Indexes/Tags/Label');
  store.addFieldIndex('Tags', 'Label');
  const logged = store.securityEvents({ kind: 'schema-changed', account: 'Ann' }).length;
  const gone = await call('DELETE', '/FileMaker_Indexes/Tags/Label');
  assert.ok(store.securityEvents({ kind: 'schema-changed', account: 'Ann' }).length > logged);
  assert.equal(gone.res.status, 204);
  assert.ok(!store.indexedFields('Tags').has('Label'));
  assert.equal(store.schema.tables.find((x) => x.name === 'Tags')!.fields[0].options?.index, undefined);
});

test('delete a field, then the table', { skip }, async () => {
  const store = host.get('Charts')!;
  await call('POST', '/FileMaker_Tables', { tableName: 'Scratch', fields: [{ name: 'A', type: 'NUMERIC' }, { name: 'B', type: 'TIME' }] });
  assert.equal((await call('DELETE', '/FileMaker_Tables/Scratch/B')).res.status, 204);
  assert.deepEqual(store.schema.tables.find((x) => x.name === 'Scratch')!.fields.map((x) => x.name), ['A']);
  assert.equal((await call('DELETE', '/FileMaker_Tables/Scratch')).res.status, 204);
  assert.ok(!store.schema.tables.some((x) => x.name === 'Scratch'));
  const missing = await call('DELETE', '/FileMaker_Tables/Scratch');
  assert.equal(missing.res.status, 404);
  assert.equal(missing.body!.error.code, '106');
  assert.equal((await call('DELETE', '/FileMaker_Tables/Visits/Nope')).res.status, 404);
});

test('only [Full Access] changes the schema, and bad requests say why', { skip }, async () => {
  const store = host.get('Charts')!;
  const denied = await call('POST', '/FileMaker_Tables', { tableName: 'Sneaky', fields: [{ name: 'X', type: 'VARCHAR' }] }, cy);
  assert.equal(denied.res.status, 403);
  assert.match(denied.body!.error.message, /Full Access/);
  assert.equal((await call('DELETE', '/FileMaker_Tables/Visits', undefined, cy)).res.status, 403);
  // Nor does a read-only API token, even one for a [Full Access] account.
  const bearer = { authorization: `Bearer ${store.createApiToken('Ann', { readOnly: true })}` };
  assert.equal((await call('POST', '/FileMaker_Tables', { tableName: 'Sneaky', fields: [{ name: 'X', type: 'VARCHAR' }] }, bearer)).res.status, 403);
  assert.equal((await call('DELETE', '/FileMaker_Tables/Visits', undefined, bearer)).res.status, 403);
  assert.ok(!store.schema.tables.some((x) => x.name === 'Sneaky'));
  assert.ok(store.schema.tables.some((x) => x.name === 'Visits'));

  const cases: [unknown, RegExp][] = [
    [{ fields: [] }, /tableName/],
    [{ tableName: 'Q', fields: [{ name: 'X', type: 'GEOMETRY' }] }, /not a field type/],
    [{ tableName: 'Q', fields: [{ name: 'X', type: 'INT', default: 'TOMORROW' }] }, /default/],
    [{ tableName: 'Q', fields: [{ name: 'X', type: 'INT', color: 'red' }] }, /no "color"/],
    [{ tableName: 'Q', fields: [{ name: 'X', type: 'INT', repetitions: 0 }] }, /repetitions/],
  ];
  for (const [body, why] of cases) {
    const r = await call('POST', '/FileMaker_Tables', body);
    assert.equal(r.res.status, 400, JSON.stringify(body));
    assert.match(r.body!.error.message, why);
  }
  assert.ok(!store.schema.tables.some((x) => x.name === 'Q'));
  assert.equal((await call('PATCH', '/FileMaker_Tables/Visits', { fields: [] })).res.status, 400);
  assert.equal((await call('GET', '/FileMaker_Tables')).res.status, 405);
});

test('a schema change in a change set is refused, and nothing in the set is kept', { skip }, async () => {
  const store = host.get('Charts')!;
  const res = await fetch(`${root}/$batch`, {
    method: 'POST',
    headers: { ...ann, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [
      { id: '1', atomicityGroup: 'g', method: 'POST', url: 'Visits', body: { Code: 'B2', Seats: 1 } },
      { id: '2', atomicityGroup: 'g', method: 'POST', url: 'FileMaker_Tables', body: { tableName: 'InBatch', fields: [{ name: 'X', type: 'INT' }] } },
    ] }),
  });
  const body = await res.json() as { responses: { id: string; status: number; body?: any }[] };
  assert.ok(body.responses.some((r) => r.status === 400 && /change set/.test(JSON.stringify(r.body))), JSON.stringify(body));
  assert.ok(!store.schema.tables.some((x) => x.name === 'InBatch'));
  const count = await fetch(`${root}/Visits/$count?$filter=Code eq 'B2'`, { headers: ann });
  assert.equal(await count.text(), '0');
});

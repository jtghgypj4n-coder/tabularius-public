// The admin console's "Field access" endpoint: GET/POST
// /tabularius/admin/v1/field-access lets an admin see and change which fields
// of a table a privilege set can modify, view only, or not see at all —
// the one part of FileMaker's "Edit Privilege Set" this console can change
// itself (Store.savePrivilegeSet, already built; only the UI/route is new).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
let fieldA: string, fieldB: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fieldaccess-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} }); // loopback: console calls are open
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const table = store.schema.tables.find((t) => t.name === 'Congress')!;
  fieldA = table.fields[0].name;
  fieldB = table.fields[1].name;
  store.savePrivilegeSet({
    name: 'Clerks',
    records: { view: true, edit: true, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const get = (path: string) => fetch(`${base}${path}`).then((r) => r.json());
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body) }).then((r) => r.json());

test('with no set/table it offers the pickers', { skip }, async () => {
  const r = await get('/tabularius/admin/v1/field-access?database=Charts');
  assert.equal(r.database, 'Charts');
  assert.ok(r.privilegeSets.includes('Clerks'));
  assert.ok(r.tables.includes('Congress'));
});

test('a set with no field overrides shows every field modifiable', { skip }, async () => {
  const r = await get(`/tabularius/admin/v1/field-access?database=Charts&privilegeSet=Clerks&table=Congress`);
  assert.equal(r.canView, true);
  assert.ok(r.fields.length > 0);
  assert.ok(r.fields.every((f: { access: string }) => f.access === 'modifiable'));
});

test('setting a field to view-only, then to no access, takes effect for the set — and reports back the field actually used', { skip }, async () => {
  const toViewOnly = await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks', table: 'Congress', field: fieldA, access: 'viewOnly' });
  assert.equal(toViewOnly.ok, true);
  assert.equal(toViewOnly.access, 'viewOnly');

  const after1 = await get(`/tabularius/admin/v1/field-access?database=Charts&privilegeSet=Clerks&table=Congress`);
  assert.equal(after1.fields.find((f: { name: string }) => f.name === fieldA).access, 'viewOnly');
  // Every other field, fieldB included, is untouched.
  assert.equal(after1.fields.find((f: { name: string }) => f.name === fieldB).access, 'modifiable');

  await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks', table: 'Congress', field: fieldA, access: 'none' });
  const after2 = await get(`/tabularius/admin/v1/field-access?database=Charts&privilegeSet=Clerks&table=Congress`);
  assert.equal(after2.fields.find((f: { name: string }) => f.name === fieldA).access, 'none');

  // Setting it back to modifiable (the table's own default) is a clean round-trip, not a stuck override.
  await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks', table: 'Congress', field: fieldA, access: 'modifiable' });
  const set = store.privilegeSet('Clerks')!;
  assert.equal(set.tables?.Congress?.fields?.[fieldA], undefined, 'no leftover override once back at the default');
});

test('the change is actually enforced, not just reported back', { skip }, async () => {
  store.setPassword('clerk', 'clerk-pw-123', 'Clerks');
  await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks', table: 'Congress', field: fieldA, access: 'none' });
  const pv = store.privilegesForSet('Clerks');
  assert.equal(pv.field('Congress', fieldA), 'none');
  store.savePrivilegeSet({ ...store.privilegeSet('Clerks')!, tables: {} }); // reset for later tests
});

test('editing one table never disturbs a fieldsDefault:none table, nor another table\'s own view/edit rules', { skip }, async () => {
  const other = store.schema.tables.find((t) => t.name !== 'Congress')!;
  const otherField = other.fields[0].name;
  store.savePrivilegeSet({
    name: 'Clerks2',
    records: { view: true, edit: true, create: false, delete: false },
    tables: {
      // A custom set whose fields default to hidden (as a FileMaker-customized table imports): only the
      // listed field is accessible, everything else is 'none' even though it's not in `fields`.
      Congress: { view: true, edit: true, create: false, delete: false, fieldsDefault: 'none', fields: { [fieldA]: 'viewOnly' } },
      [other.name]: { view: 'Get(AccountName) = "x"', edit: false, create: false, delete: false },
    },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'],
  });
  try {
    // fieldB has no entry, so under fieldsDefault:none it starts hidden, not modifiable.
    const before = store.privilegesForSet('Clerks2').field('Congress', fieldB);
    assert.equal(before, 'none');

    // Explicitly making fieldB modifiable must actually open it, not get "optimized away" as the table's default.
    await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks2', table: 'Congress', field: fieldB, access: 'modifiable' });
    const pv = store.privilegesForSet('Clerks2');
    assert.equal(pv.field('Congress', fieldB), 'modifiable');
    assert.equal(pv.field('Congress', fieldA), 'viewOnly', 'the field edited earlier is untouched');

    // The other table's own record-access rule (a calculation, not a plain boolean) survives untouched.
    const set = store.privilegeSet('Clerks2')!;
    assert.equal(set.tables?.[other.name]?.view, 'Get(AccountName) = "x"');
    assert.equal(pv.field(other.name, otherField), 'modifiable', 'that table has no field overrides, so its fields stay at their own default');
  } finally {
    store.deletePrivilegeSet('Clerks2');
  }
});

test('[Full Access], an unknown set, an unknown field, or a bad access value are reported, not applied', { skip }, async () => {
  assert.match((await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: '[Full Access]', table: 'Congress', field: fieldA, access: 'none' })).error, /Full Access/);
  assert.match((await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Nope', table: 'Congress', field: fieldA, access: 'none' })).error, /No privilege set "Nope"/);
  assert.match((await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks', table: 'Congress', field: 'NopeField', access: 'none' })).error, /No field/);
  assert.match((await post('/tabularius/admin/v1/field-access', { database: 'Charts', privilegeSet: 'Clerks', table: 'Congress', field: fieldA, access: 'bogus' })).error, /access must be/);
});

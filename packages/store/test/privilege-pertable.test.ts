// Mapping a custom-record-access set (per-table and per-field, as the fmp12 reader returns it)
// onto the store's PrivilegeDefinition, failing closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorityOf, customAccess, fromFmp12, relaxUnverified, validateDefinition, Privileges, type PrivilegeDefinition } from '../src/privileges.ts';
import type { PrivilegeSet, Schema } from '../../fmp12/src/index.ts';

const schema = {
  tables: [
    { id: 129, name: 'People', fields: [{ id: 1, name: 'Name' }, { id: 2, name: 'Salary' }, { id: 3, name: 'Notes' }, { id: 4, name: 'Dept' }] },
    { id: 130, name: 'Secrets', fields: [{ id: 1, name: 'Code' }] },
  ],
} as unknown as Schema;

const rec = (view: boolean, create = false, edit = false, del = false) => ({ view, create, edit, delete: del });
const set = (over: Partial<PrivilegeSet>): PrivilegeSet => ({
  id: 9, name: 'Custom', records: rec(false), customRecordAccess: true,
  layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'], ...over,
} as unknown as PrivilegeSet);
const oracle = (d: PrivilegeDefinition) => new Privileges('u', d, null, () => { throw new Error('no other file'); });

test('a table the custom set does not list has no access, and so does the file level', () => {
  const d = fromFmp12(set({ tableRecords: [{ tableId: 129, records: rec(true, true, true, false) }] }), schema);
  assert.deepEqual(d.records, { view: false, edit: false, create: false, delete: false });
  assert.deepEqual(Object.keys(d.tables!), ['People']);
  const p = oracle(d);
  assert.equal(p.table('People').view, true);
  assert.equal(p.table('Secrets').view, false);
  assert.equal(p.field('Secrets', 'Code'), 'none');
});

test('a table that customises fields keeps only fields marked exactly read/write (0x03)', () => {
  const m = customAccess(set({
    tableRecords: [{ tableId: 129, records: rec(true, false, true), fields: [
      { fieldId: 1, access: 0x03, view: true, edit: true },
      { fieldId: 2, access: 0x00, view: false, edit: false },
      { fieldId: 3, access: 0x01, view: true, edit: false },
      { fieldId: 4, access: 0x07, view: true, edit: true }, // spare high bits: not a plain 0x03
    ] }],
  }), schema);
  assert.deepEqual(m.tables.People.fields, { Name: 'modifiable', Salary: 'none', Notes: 'none', Dept: 'none' });
  assert.deepEqual(m.unverifiedReadOnly, { People: ['Notes'] }, 'only the 0x01 field is a candidate for relaxation');
  assert.deepEqual(m.hiddenFields, { People: ['Salary', 'Notes', 'Dept'] });
});

test('a field the set does not list is no access when the table customises fields', () => {
  const m = customAccess(set({ tableRecords: [{ tableId: 129, records: rec(true), fields: [{ fieldId: 1, access: 0x03, view: true, edit: true }] }] }), schema);
  assert.deepEqual(m.tables.People.fields, { Name: 'modifiable', Salary: 'none', Notes: 'none', Dept: 'none' });
  assert.deepEqual(m.unverifiedReadOnly, {}, 'an unlisted field is never offered for relaxation');
});

test('a table without field customisation has no field limits', () => {
  const m = customAccess(set({ tableRecords: [{ tableId: 130, records: rec(true) }] }), schema);
  assert.equal(m.tables.Secrets.fields, undefined);
});

test('edit and delete are gated on view', () => {
  const t = customAccess(set({ tableRecords: [{ tableId: 129, records: rec(false, true, true, true) }] }), schema).tables.People;
  assert.equal(t.view, false);
  assert.equal(t.edit, false);
  assert.equal(t.delete, false);
});

test('without the schema, or for an unknown table id, nothing is granted', () => {
  const s = set({ tableRecords: [{ tableId: 129, records: rec(true, true, true, true) }, { tableId: 999, records: rec(true) }] });
  const none = fromFmp12(s);
  assert.equal(none.tables, undefined, 'no schema, no names, no grants');
  assert.deepEqual(none.records, { view: false, edit: false, create: false, delete: false });
  const m = customAccess(s, schema);
  assert.deepEqual(m.unresolvedTables, [999]);
  assert.deepEqual(Object.keys(m.tables), ['People']);
});

test('a set that is not on custom record access is imported exactly as before', () => {
  const d = fromFmp12(set({ customRecordAccess: undefined, records: rec(true, true, true, false), tableRecords: [{ tableId: 129, records: rec(false) }] }), schema);
  assert.deepEqual(d.records, { view: true, create: true, edit: true, delete: false });
  assert.equal(d.tables, undefined);
});

test('relaxing turns only the 0x01 fields view-only and leaves a field an admin already changed alone', () => {
  const d = fromFmp12(set({
    tableRecords: [{ tableId: 129, records: rec(true, false, true), fields: [
      { fieldId: 1, access: 0x03, view: true, edit: true },
      { fieldId: 2, access: 0x00, view: false, edit: false },
      { fieldId: 3, access: 0x01, view: true, edit: false },
      { fieldId: 4, access: 0x01, view: true, edit: false },
    ] }],
  }), schema);
  d.tables!.People.fields!.Dept = 'modifiable'; // the admin already opened this one
  const { def, relaxed } = relaxUnverified(d);
  assert.equal(relaxed, 1);
  assert.deepEqual(def.tables!.People.fields, { Name: 'modifiable', Salary: 'none', Notes: 'viewOnly', Dept: 'modifiable' });
  assert.equal(def.unverifiedReadOnly, undefined);
});

test('validateDefinition rejects a malformed unverifiedReadOnly', () => {
  const ok = fromFmp12(set({ tableRecords: [{ tableId: 129, records: rec(true), fields: [{ fieldId: 3, access: 0x01, view: true, edit: false }] }] }), schema);
  assert.deepEqual(validateDefinition(ok).unverifiedReadOnly, { People: ['Notes'] });
  assert.throws(() => validateDefinition({ ...ok, unverifiedReadOnly: { People: 'Notes' } }), /unverifiedReadOnly/);
  assert.throws(() => validateDefinition({ ...ok, unverifiedReadOnly: ['x'] }), /unverifiedReadOnly/);
});

test('a field added to a customised table later is hidden, also after the set is saved', () => {
  const d = fromFmp12(set({ tableRecords: [{ tableId: 129, records: rec(true, false, true), fields: [{ fieldId: 1, access: 0x03, view: true, edit: true }] }] }), schema);
  assert.equal(oracle(d).field('People', 'BrandNewField'), 'none', 'not in the file\'s list: no access');
  assert.equal(oracle(d).field('People', 'Name'), 'modifiable');
  // A table with no field customisation still defaults to modifiable.
  const plain = fromFmp12(set({ tableRecords: [{ tableId: 130, records: rec(true) }] }), schema);
  assert.equal(oracle(plain).field('Secrets', 'Anything'), 'modifiable');
  assert.equal(oracle(d).readsEverything, false);
  assert.throws(() => validateDefinition({ ...d, tables: { People: { ...d.tables!.People, fieldsDefault: 'modifiable' } } } as never), /fieldsDefault/);
});

test('a table listed twice in the file gets no access', () => {
  const m = customAccess(set({ tableRecords: [{ tableId: 129, records: rec(true, true, true, true) }, { tableId: 129, records: rec(true) }] }), schema);
  assert.equal(m.tables.People.view, false);
  assert.equal(oracle({ ...fromFmp12(set({}), schema), tables: m.tables }).field('People', 'Name'), 'none');
});

test('the approval diff reports a change to what an unlisted field gets', async () => {
  const { diffPrivilegeSet } = await import('../src/access-report.ts');
  const d = fromFmp12(set({ tableRecords: [{ tableId: 129, records: rec(true), fields: [{ fieldId: 1, access: 0x03, view: true, edit: true }] }] }), schema);
  const opened = { ...d, tables: { People: { ...d.tables!.People, fieldsDefault: undefined } } } as PrivilegeDefinition;
  const changes = diffPrivilegeSet(opened, d).map((c) => c.detail);
  assert.ok(changes.includes('People: fields not listed → modifiable'), changes.join(' | '));
});

test('authority does not change when a field is added to, or hidden by default in, a table the set lists', () => {
  const listed = set({ tableRecords: [{ tableId: 129, records: rec(true, false, true), fields: [{ fieldId: 1, access: 0x03, view: true, edit: true }, { fieldId: 2, access: 0x00, view: false, edit: false }] }] });
  const before = fromFmp12(listed, schema);
  const withNewField = { tables: [{ ...schema.tables[0], fields: [...schema.tables[0].fields, { id: 5, name: 'Added later' }] }, schema.tables[1]] } as unknown as Schema;
  const after = fromFmp12(listed, withNewField);
  assert.notDeepEqual(before, after, 'the derived set does list the new field as hidden');
  assert.deepEqual(authorityOf(after), authorityOf(before), 'but nobody can do anything different');
  // Granting a hidden field is a change of authority.
  const granted = fromFmp12(set({ tableRecords: [{ tableId: 129, records: rec(true, false, true), fields: [{ fieldId: 1, access: 0x03, view: true, edit: true }, { fieldId: 2, access: 0x03, view: true, edit: true }] }] }), schema);
  assert.notDeepEqual(authorityOf(granted), authorityOf(before));
  assert.equal(JSON.stringify(authorityOf(before)).includes('unverifiedReadOnly'), false);
});

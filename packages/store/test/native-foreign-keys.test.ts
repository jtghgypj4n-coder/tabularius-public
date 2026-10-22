// Native files' foreign keys (N4): a named declaration on a relationship's one child = parent match, kept on every
// write, with ON DELETE followed when a parent goes; shown in GetTableDDL, the design report and the design text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  applySync, createStore, designReport, designText, planDesignApply, readSyncLog, Store, StoreError, tableDDL,
  type DesignOp, type RemoteRecord, type RemoteSource, type RemoteWriter,
} from '../src/index.ts';
import type { OnDelete } from '../../fmp12/src/index.ts';

function open(t: { after: (fn: () => void) => void }, mode: 'native' | 'compat' = 'native'): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-fk-'));
  const path = join(dir, 'Sales.sqlite');
  createStore(path, mode === 'native' ? { mode: 'native' } : {});
  const store = new Store(path, 'Sales');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

const tables: DesignOp[] = [
  { op: 'createTable', name: 'Customers', fields: [{ name: 'ID' }, { name: 'Name' }] },
  { op: 'createTable', name: 'Invoices', fields: [{ name: 'ID' }, { name: 'CustomerID' }, { name: 'Total', type: 'number' }] },
  { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceID' }, { name: 'Item' }] },
];
const invoiceKey = (onDelete: OnDelete) => ({ name: 'invoice_customer', child: { table: 'Invoices', field: 'CustomerID' }, parent: { table: 'Customers', field: 'ID' }, onDelete });
const lineKey = (onDelete: OnDelete) => ({ name: 'line_invoice', child: { table: 'Lines', field: 'InvoiceID' }, parent: { table: 'Invoices', field: 'ID' }, onDelete });

/** Customers ← Invoices ← Lines, each a relationship with a foreign key. */
function sales(store: Store, onInvoice: OnDelete, onLine: OnDelete = 'cascade'): void {
  store.applyDesign([
    ...tables,
    { op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }], foreignKey: invoiceKey(onInvoice) },
    // The child on the right this time, to show the side follows the fields named.
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'ID', right: 'InvoiceID' }], foreignKey: lineKey(onLine) },
  ]);
  store.create('Customers', { ID: 'c1', Name: 'Ada' });
  store.create('Customers', { ID: 'c2', Name: 'Bo' });
  store.create('Invoices', { ID: 'i1', CustomerID: 'c1' });
  store.create('Invoices', { ID: 'i2', CustomerID: 'c1' });
  store.create('Invoices', { ID: 'i3', CustomerID: 'c2' });
  store.create('Lines', { InvoiceID: 'i1', Item: 'pen' });
  store.create('Lines', { InvoiceID: 'i1', Item: 'ink' });
  store.create('Lines', { InvoiceID: 'i3', Item: 'pad' });
}

const ids = (store: Store, table: string, field = 'ID') => store.query(`SELECT ${field} AS v FROM "${table}" ORDER BY _fm_record_id`, 100).map((r) => r.v);
const idOf = (store: Store, table: string, field: string, value: string) => Number(store.query(`SELECT _fm_record_id AS id FROM "${table}" WHERE ${field} = '${value}'`, 1)[0].id);
const code = (n: number, re: RegExp) => (e: unknown) => e instanceof StoreError && e.code === n && re.test(e.message);
const audits = (store: Store) => store.auditLog({ limit: 1000 }).length;

test('a compat file refuses a foreign key and says they are for native files', (t) => {
  const store = open(t, 'compat');
  store.applyDesign(tables);
  assert.throws(() => store.applyDesign([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }], foreignKey: invoiceKey('restrict') }]),
    code(960, /Foreign keys are for native files/));
  // The relationship alone is as it always was, and stays without one.
  store.applyDesign([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }] }]);
  const rel = store.schema.relationships[0];
  assert.equal('foreignKey' in rel, false);
  assert.throws(() => store.applyDesign([{ op: 'updateRelationship', relationship: rel.id, foreignKey: invoiceKey('cascade') }]), /native files/);
  store.create('Invoices', { ID: 'i1', CustomerID: 'nobody' });
  assert.match(tableDDL(store.schema, '["Invoices","Customers"]', false), /^ {2}FOREIGN KEY \("CustomerID"\) REFERENCES "Customers" \("ID"\)$/m);
});

test('a child key must be a parent\'s: create, edit, duplicate and multi-line values; empty is allowed', (t) => {
  const store = open(t);
  sales(store, 'restrict');
  assert.throws(() => store.create('Invoices', { ID: 'i9', CustomerID: 'c9' }), code(505, /Foreign key "invoice_customer": no Customers record has ID "c9"/));
  assert.equal(store.create('Invoices', { ID: 'i4' }).recordId > 0, true, 'an empty key needs no parent');
  // Text keys match the way the relationship does, without regard to case.
  store.create('Invoices', { ID: 'i5', CustomerID: 'C2' });
  const i1 = idOf(store, 'Invoices', 'ID', 'i1');
  assert.throws(() => store.update('Invoices', i1, { CustomerID: 'c9' }), code(505, /no Customers record/));
  assert.throws(() => store.update('Invoices', i1, { CustomerID: 'c1\rc2' }), code(505, /holds one Customers key, not a list/));
  store.update('Invoices', i1, { CustomerID: 'c2' });
  store.update('Invoices', i1, { Total: 3 }, undefined, {});
  assert.equal(store.duplicate('Invoices', i1).recordId > 0, true);
  assert.deepEqual(ids(store, 'Invoices', 'CustomerID'), ['c2', 'c1', 'c2', null, 'C2', 'c2']);
  // A parent's key can't change while child records use it, unless another parent keeps the old one.
  const c2 = idOf(store, 'Customers', 'ID', 'c2');
  assert.throws(() => store.update('Customers', c2, { ID: 'c3' }), code(505, /4 Invoices records use ID "c2"/));
  const twin = store.create('Customers', { ID: 'c2', Name: 'Twin' }).recordId;
  store.update('Customers', c2, { ID: 'c3' });
  assert.throws(() => store.delete('Customers', twin), code(505, /on delete restrict/));
});

test('restrict refuses deleting a parent with children, before anything changes; a parent without children goes', (t) => {
  const store = open(t);
  sales(store, 'restrict');
  const before = audits(store);
  const events: string[] = [];
  store.listeners.add((c) => events.push(`${c.kind} ${c.table}`));
  assert.throws(() => store.delete('Customers', idOf(store, 'Customers', 'ID', 'c1')), code(505, /Foreign key "invoice_customer" \(on delete restrict\): 2 Invoices records use this record's ID "c1"/));
  assert.deepEqual(ids(store, 'Customers'), ['c1', 'c2']);
  assert.equal(audits(store), before);
  assert.deepEqual(events, []);
  const lonely = store.create('Customers', { ID: 'c7' }).recordId;
  store.delete('Customers', lonely);
  assert.deepEqual(ids(store, 'Customers'), ['c1', 'c2']);
});

test('cascade follows two levels, auditing each delete the way a delete does', (t) => {
  const store = open(t);
  sales(store, 'cascade', 'cascade');
  const events: string[] = [];
  store.listeners.add((c) => { if (c.kind === 'delete') events.push(c.table); });
  store.delete('Customers', idOf(store, 'Customers', 'ID', 'c1'));
  assert.deepEqual(ids(store, 'Customers'), ['c2']);
  assert.deepEqual(ids(store, 'Invoices'), ['i3']);
  assert.deepEqual(ids(store, 'Lines', 'Item'), ['pad']);
  const deleted = store.auditLog({ kind: 'delete', limit: 100 }).map((e) => e.table).sort();
  assert.deepEqual(deleted, ['Customers', 'Invoices', 'Invoices', 'Lines', 'Lines']);
  assert.deepEqual(events.sort(), ['Customers', 'Invoices', 'Invoices', 'Lines', 'Lines']);
});

test('set-null empties the children\'s key, and no-action refuses only when children would be left', (t) => {
  const store = open(t);
  sales(store, 'set-null', 'no-action');
  store.delete('Customers', idOf(store, 'Customers', 'ID', 'c1'));
  assert.deepEqual(ids(store, 'Invoices', 'CustomerID'), [null, null, 'c2']);
  assert.ok(store.auditLog({ kind: 'update', table: 'Invoices', limit: 10 }).length >= 2);
  assert.throws(() => store.delete('Invoices', idOf(store, 'Invoices', 'ID', 'i1')), code(505, /on delete no action\): 2 Lines records would be left/));
  assert.deepEqual(ids(store, 'Invoices'), ['i1', 'i2', 'i3']);
  store.delete('Invoices', idOf(store, 'Invoices', 'ID', 'i2'));
  assert.deepEqual(ids(store, 'Invoices'), ['i1', 'i3']);

  // No action is checked after the delete's other work: here a "delete related records" relationship takes the lines first.
  const fresh = open(t);
  fresh.applyDesign([
    ...tables,
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'ID', right: 'InvoiceID' }], foreignKey: lineKey('no-action') },
    { op: 'createOccurrence', name: 'Invoice Lines', table: 'Lines' },
    { op: 'createRelationship', left: 'Invoices', right: 'Invoice Lines', predicates: [{ left: 'ID', right: 'InvoiceID' }], rightDelete: true },
  ]);
  fresh.create('Invoices', { ID: 'i1' });
  fresh.create('Lines', { InvoiceID: 'i1', Item: 'pen' });
  fresh.delete('Invoices', idOf(fresh, 'Invoices', 'ID', 'i1'));
  assert.deepEqual(ids(fresh, 'Lines', 'Item'), []);
});

test('a refusal deep in a cascade leaves nothing half done: no records, audit rows or change events', (t) => {
  const store = open(t);
  sales(store, 'cascade', 'restrict');
  const before = audits(store);
  const events: string[] = [];
  store.listeners.add((c) => events.push(`${c.kind} ${c.table}`));
  assert.throws(() => store.delete('Customers', idOf(store, 'Customers', 'ID', 'c1')), code(505, /line_invoice.*2 Lines records use this record's ID "i1"/));
  assert.deepEqual(ids(store, 'Customers'), ['c1', 'c2']);
  assert.deepEqual(ids(store, 'Invoices'), ['i1', 'i2', 'i3']);
  assert.deepEqual(ids(store, 'Lines', 'Item'), ['pen', 'ink', 'pad']);
  assert.equal(audits(store), before);
  assert.deepEqual(events, []);
  // The same inside an open transaction (a savepoint of its own rolls back): the transaction's earlier work stays.
  const trial = store.trial();
  try {
    store.create('Customers', { ID: 'c8' });
    assert.throws(() => store.delete('Customers', idOf(store, 'Customers', 'ID', 'c1')), code(505, /line_invoice/));
    // Read on the writing connection: a query sees only what is committed.
    const live = (table: string) => (store.sql.prepare(`SELECT ID AS v FROM "${table}" ORDER BY _fm_record_id`).all() as { v: string }[]).map((r) => r.v);
    assert.deepEqual(live('Customers'), ['c1', 'c2', 'c8']);
    assert.deepEqual(live('Invoices'), ['i1', 'i2', 'i3']);
    assert.equal(audits(store), before + 1);
  } finally {
    trial.undo();
  }
  // c2's invoice has a line too: the same refusal. A customer whose invoices have no lines cascades.
  store.create('Customers', { ID: 'c5' });
  store.create('Invoices', { ID: 'i5', CustomerID: 'c5' });
  store.delete('Customers', idOf(store, 'Customers', 'ID', 'c5'));
  assert.deepEqual(ids(store, 'Invoices'), ['i1', 'i2', 'i3']);
});

test('truncating a parent table follows ON DELETE for every child', (t) => {
  const store = open(t);
  sales(store, 'restrict', 'cascade');
  assert.throws(() => store.truncate('Customers'), code(505, /on delete restrict\): 3 Invoices records use Customers keys/));
  assert.deepEqual(ids(store, 'Customers'), ['c1', 'c2']);
  store.truncate('Invoices');
  assert.deepEqual(ids(store, 'Invoices'), []);
  assert.deepEqual(ids(store, 'Lines', 'Item'), []);
  store.truncate('Customers');
  assert.deepEqual(ids(store, 'Customers'), []);
});

test('adding a foreign key checks the records first and refuses with how many break it and the first few keys', (t) => {
  const store = open(t);
  store.applyDesign(tables);
  store.create('Customers', { ID: 'c1' });
  for (const k of ['c1', 'x1', 'x2', 'x2', '', 'x3']) store.create('Invoices', { CustomerID: k });
  store.applyDesign([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }] }]);
  const rel = store.schema.relationships[0].id;
  const add = (onDelete: OnDelete = 'restrict') => store.applyDesign([{ op: 'updateRelationship', relationship: rel, foreignKey: invoiceKey(onDelete) }]);
  assert.throws(() => add(), code(505, /can't be added: 4 Invoices records have a CustomerID that no Customers record has as ID.*"x1", "x2", "x3"/));
  assert.equal(store.schema.relationships[0].foreignKey, undefined, 'nothing of the change is kept');
  // In one change with the relationship itself, too.
  assert.throws(() => store.applyDesign([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }], foreignKey: { ...invoiceKey('cascade'), name: 'other' } }]), /4 Invoices records/);
  assert.equal(store.schema.relationships.length, 1);
  for (const k of ['x1', 'x2', 'x3']) store.create('Customers', { ID: k });
  add('cascade');
  assert.deepEqual(store.schema.relationships[0].foreignKey, { name: 'invoice_customer', child: 'left', childTableId: store.schema.tables[1].id, childFieldId: 2, parentTableId: store.schema.tables[0].id, parentFieldId: 1, onDelete: 'cascade' });
  // The change log has it by ids, so a replay doesn't depend on names.
  const logged = store.designHistory().at(-1)!.op as { foreignKey?: unknown };
  assert.deepEqual(logged.foreignKey, { name: 'invoice_customer', child: { table: store.schema.tables[1].id, field: 2 }, parent: { table: store.schema.tables[0].id, field: 1 }, onDelete: 'cascade' });
});

test('design refuses a foreign key that does not fit its relationship, and changes that would break one', (t) => {
  const store = open(t);
  store.applyDesign([...tables, { op: 'createTable', name: 'Notes', fields: [{ name: 'Ref', type: 'integer' }] }]);
  const refuse = (ops: DesignOp[], re: RegExp) => assert.throws(() => store.applyDesign(ops), code(960, re));
  refuse([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', operator: '<', right: 'ID' }], foreignKey: invoiceKey('restrict') }], /exactly one match, child field = parent field.*a < match/);
  refuse([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }, { left: 'ID', right: 'Name' }], foreignKey: invoiceKey('restrict') }], /2 matches/);
  refuse([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'ID', right: 'ID' }], foreignKey: invoiceKey('restrict') }], /matches Invoices::ID = Customers::ID, not Invoices::CustomerID = Customers::ID/);
  refuse([{ op: 'createRelationship', left: 'Notes', right: 'Customers', predicates: [{ left: 'Ref', right: 'ID' }], foreignKey: { name: 'n', child: { table: 'Notes', field: 'Ref' }, parent: { table: 'Customers', field: 'ID' } } }], /Notes::Ref is integer and Customers::ID is text/);
  refuse([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }], foreignKey: { ...invoiceKey('restrict'), onDelete: 'explode' as OnDelete } }], /onDelete is one of restrict, cascade, set-null, no-action/);
  refuse([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }], foreignKey: { ...invoiceKey('restrict'), name: ' ' } }], /needs a name/);
  store.applyDesign([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'ID' }], foreignKey: invoiceKey('restrict') }]);
  const rel = store.schema.relationships[0].id;
  refuse([{ op: 'createRelationship', left: 'Lines', right: 'Invoices', predicates: [{ left: 'InvoiceID', right: 'ID' }], foreignKey: { ...lineKey('cascade'), name: 'INVOICE_customer' } }], /"INVOICE_customer" already exists/);
  refuse([{ op: 'updateRelationship', relationship: rel, predicates: [{ left: 'ID', right: 'ID' }] }], /Foreign key "invoice_customer": the relationship no longer matches Invoices::CustomerID = Customers::ID; change or drop the foreign key/);
  refuse([{ op: 'updateField', table: 'Invoices', field: 'CustomerID', type: 'number' }], /is number and Customers::ID is text/);
  refuse([{ op: 'updateField', table: 'Customers', field: 'ID', kind: 'calculation', calculation: '"x"' }], /Customers::ID is a calculation field/);
  // A rename follows (keys are kept by id); an edit may give just the part that changes.
  store.applyDesign([{ op: 'updateField', table: 'Customers', field: 'ID', name: 'Code' }, { op: 'updateRelationship', relationship: rel, foreignKey: { onDelete: 'set-null' } }]);
  assert.match(tableDDL(store.schema, 'Invoices\nCustomers', false), /CONSTRAINT "invoice_customer" FOREIGN KEY \("CustomerID"\) REFERENCES "Customers" \("Code"\) ON DELETE SET NULL/);
  // Deleting the child field takes the key with the match; restoring the field brings both back.
  store.applyDesign([{ op: 'deleteField', table: 'Invoices', field: 'CustomerID' }]);
  assert.equal(store.schema.relationships[0].foreignKey, undefined);
  store.applyDesign([{ op: 'restoreDeleted', deleted: store.deletedDesigns()[0].id }]);
  const restored = () => store.schema.relationships[0].foreignKey;
  assert.equal(restored()?.onDelete, 'set-null');
  // null drops it; writes are free again.
  store.applyDesign([{ op: 'updateRelationship', relationship: rel, foreignKey: null }]);
  assert.equal(store.schema.relationships[0].foreignKey, undefined);
  store.create('Invoices', { CustomerID: 'nobody' });
});

test('GetTableDDL and the design report show the key; the occurrence graph under it is unchanged', (t) => {
  const store = open(t);
  sales(store, 'cascade', 'no-action');
  const ddl = tableDDL(store.schema, '["Invoices","Customers","Lines"]', false);
  assert.match(ddl, /CREATE TABLE "Invoices" \([^;]*\n {2}CONSTRAINT "invoice_customer" FOREIGN KEY \("CustomerID"\) REFERENCES "Customers" \("ID"\) ON DELETE CASCADE\n\);/);
  assert.match(ddl, /CREATE TABLE "Lines" \([^;]*\n {2}CONSTRAINT "line_invoice" FOREIGN KEY \("InvoiceID"\) REFERENCES "Invoices" \("ID"\) ON DELETE NO ACTION\n\);/);
  assert.doesNotMatch(ddl, /^ {2}FOREIGN KEY/m, 'a declared key replaces the inferred one');
  assert.doesNotMatch(tableDDL(store.schema, '["Invoices","Customers"]', true), /FOREIGN KEY/);
  const visible = (table: string, field?: string) => field !== 'CustomerID' || table !== 'Invoices';
  assert.doesNotMatch(tableDDL(store.schema, '["Invoices","Customers"]', false, visible), /invoice_customer/);
  const ddr = designReport(store.schema, store.designs(), { fileName: 'Sales', now: new Date(0) });
  assert.match(ddr, /<ForeignKey name="invoice_customer" onDelete="cascade"><ChildField><Field table="Invoices" id="2" name="CustomerID"\/><\/ChildField><ParentField><Field table="Customers" id="1" name="ID"\/><\/ParentField><\/ForeignKey>/);
  // Portals and related fields read the same relationship as before.
  const i1 = idOf(store, 'Invoices', 'ID', 'i1');
  assert.equal(store.evaluate('Invoices', 'Customers::Name', i1).value, 'Ada');
  assert.equal(store.evaluate('Invoices', 'Count ( Lines::Item )', i1).value, '2');
  // The design API lists it with the relationship.
  assert.equal(store.schema.relationships.filter((r) => r.foreignKey).length, 2);
});

test('the design text carries the key, and adding, changing or removing its line round-trips', (t) => {
  const store = open(t);
  sales(store, 'cascade', 'restrict');
  const source = () => ({ schema: store.schema, layouts: store.designs().layouts, accounts: store.accounts(), privilegeSets: store.privilegeSets() });
  const text = designText(source());
  const rels = text.get('relationships.txt')!;
  assert.match(rels, /^ {2}Foreign key "invoice_customer": Invoices::CustomerID references Customers::ID, on delete cascade$/m);
  assert.match(rels, /^ {2}Foreign key "line_invoice": Lines::InvoiceID references Invoices::ID, on delete restrict$/m);
  assert.equal(planDesignApply(text, source()).ops.length, 0, 'the export is nothing to apply');
  const round = (edited: string) => {
    const files = new Map(designText(source()));
    files.set('relationships.txt', edited);
    const plan = planDesignApply(files, source());
    store.applyDesign(plan.ops);
    assert.equal(designText(source()).get('relationships.txt'), edited);
    return plan;
  };
  // Change one key, drop the other, then add it back under a new name.
  let edited = rels.replace('on delete cascade', 'on delete set-null').replace(/\n {2}Foreign key "line_invoice"[^\n]*/, '');
  const plan = round(edited);
  assert.deepEqual(plan.ops.map((o) => [o.op, (o as { foreignKey?: { onDelete?: string } | null }).foreignKey?.onDelete ?? (o as { foreignKey?: null }).foreignKey]), [['updateRelationship', 'set-null'], ['updateRelationship', null]]);
  edited = edited.replace(/(Invoices::ID = Lines::InvoiceID\n {2}Options: [^\n]*)/, '$1\n  Foreign key "lines": Lines::InvoiceID references Invoices::ID, on delete no-action');
  round(edited);
  assert.equal(store.schema.relationships[1].foreignKey?.name, 'lines');
  // A new relationship with its key, from text alone.
  edited = edited.replace(/\n$/, '') + '\nLines ↔ Customers\n  Lines::Item = Customers::ID\n  Foreign key "item_customer": Lines::Item references Customers::ID, on delete restrict\n';
  assert.throws(() => round(edited), code(505, /"item_customer" can't be added: 3 Lines records/));
  const bad = new Map(designText(source()));
  bad.set('relationships.txt', rels.replace('on delete cascade', 'on delete sometimes'));
  assert.throws(() => planDesignApply(bad, source()), /on delete sometimes; it can be restrict, cascade, set-null, no-action/);
});

test('a live sync pull obeys the key: a pulled record whose key has no parent here fails, the rest come in', async (t) => {
  const store = open(t);
  store.applyDesign([
    { op: 'createTable', name: 'Companies', fields: [{ name: 'Code' }] },
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }, { name: 'Company' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Companies', predicates: [{ left: 'Company', right: 'Code' }], foreignKey: { name: 'contact_company', child: { table: 'Contacts', field: 'Company' }, parent: { table: 'Companies', field: 'Code' } } },
  ]);
  store.create('Companies', { Code: 'acme' });
  const remote: RemoteRecord[] = [
    { uuid: 'u1', recordId: '1', modId: '1', fields: { uuid: 'u1', modts: '', Name: 'Ann', Company: 'acme' } },
    { uuid: 'u2', recordId: '2', modId: '1', fields: { uuid: 'u2', modts: '', Name: 'Bea', Company: 'globex' } },
  ];
  const fm: RemoteSource & RemoteWriter = {
    changedSince: async () => remote, allUuids: async () => new Set(remote.map((r) => r.uuid)), writableFields: async () => new Set(['uuid', 'Name', 'Company']),
    read: async (_l, id) => remote.find((r) => r.recordId === id),
    create: async () => { throw new Error('nothing is pushed'); }, update: async () => { throw new Error('nothing is pushed'); }, delete: async () => { throw new Error('nothing is pushed'); },
  };
  const res = await applySync(store, 'Sales', [{ localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' }], fm, fm, { write: false, pull: true });
  assert.equal(res.tables[0].pulled.created, 1);
  assert.deepEqual(res.tables[0].failed.map((f) => [f.uuid, f.op]), [['u2', 'pull-create']]);
  assert.match(res.tables[0].failed[0].error, /contact_company.*globex/);
  assert.deepEqual(ids(store, 'Contacts', 'Name'), ['Ann']);
  assert.equal(readSyncLog(store, { limit: 100 }).filter((l) => l.status === 'failed').length, 1);
});

test('a refusal counts the child records only for an account that can see their table', (t) => {
  const store = open(t);
  sales(store, 'restrict', 'no-action');
  const open_ = { view: true, edit: true, create: true, delete: true };
  store.savePrivilegeSet({ name: 'Clerk', records: open_, tables: { Invoices: { ...open_, view: false }, Lines: { ...open_, view: false } }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
  store.setPassword('clerk', 'pw', 'Clerk');
  const privileges = store.privileges('clerk');
  const c1 = idOf(store, 'Customers', 'ID', 'c1');
  assert.throws(() => store.delete('Customers', c1, { privileges }), code(505, /\(on delete restrict\): Invoices records use this record's ID "c1"; delete or change them first/));
  assert.throws(() => store.update('Customers', c1, { ID: 'c0' }, undefined, { privileges }), code(505, /: Invoices records use ID "c1"/));
  // Full access still gets the count.
  assert.throws(() => store.delete('Customers', c1), code(505, /2 Invoices records use/));
});

const seqOf = (store: Store, table: string, recordId: number, kind: string) =>
  store.auditLog({ table, recordId, kind, limit: 10 })[0].seq;

test('restoring a parent from the audit log to before it existed follows ON DELETE like a delete', (t) => {
  const store = open(t);
  sales(store, 'restrict');
  const c2 = idOf(store, 'Customers', 'ID', 'c2');
  assert.throws(() => store.restoreRecord('Customers', c2, 0), code(505, /invoice_customer.*on delete restrict/));
  assert.deepEqual(ids(store, 'Customers'), ['c1', 'c2']);
  assert.deepEqual(ids(store, 'Invoices', 'CustomerID'), ['c1', 'c1', 'c2']);

  const cascading = open(t);
  sales(cascading, 'cascade', 'cascade');
  assert.equal(cascading.restoreRecord('Customers', idOf(cascading, 'Customers', 'ID', 'c2'), 0).action, 'deleted');
  assert.deepEqual(ids(cascading, 'Invoices'), ['i1', 'i2']);
  assert.deepEqual(ids(cascading, 'Lines', 'Item'), ['pen', 'ink']);
});

test('restoring a deleted child from the audit log needs its parent', (t) => {
  const store = open(t);
  sales(store, 'cascade', 'cascade');
  const i3 = idOf(store, 'Invoices', 'ID', 'i3');
  store.delete('Customers', idOf(store, 'Customers', 'ID', 'c2'));
  const gone = seqOf(store, 'Invoices', i3, 'delete');
  assert.throws(() => store.restoreRecord('Invoices', i3, gone - 1), code(505, /no Customers record has ID "c2"/));
  assert.deepEqual(ids(store, 'Invoices'), ['i1', 'i2']);
  // With the parent back first, it can come back too.
  store.create('Customers', { ID: 'c2' });
  assert.equal(store.restoreRecord('Invoices', i3, gone - 1).action, 'created');
  assert.deepEqual(ids(store, 'Invoices'), ['i1', 'i2', 'i3']);
});

test('restoring an edit from the audit log keeps both ends of the key', (t) => {
  const store = open(t);
  sales(store, 'restrict');
  // A parent's old key: children use its new one now.
  const c3 = store.create('Customers', { ID: 'c3' }).recordId;
  store.update('Customers', c3, { ID: 'c4' });
  store.create('Invoices', { ID: 'i4', CustomerID: 'c4' });
  const renamed = seqOf(store, 'Customers', c3, 'update');
  assert.throws(() => store.restoreRecord('Customers', c3, renamed - 1), code(505, /1 Invoices record uses ID "c4"/));
  assert.deepEqual(ids(store, 'Customers'), ['c1', 'c2', 'c4']);
  // A child's old key: its parent is gone since.
  const i3 = idOf(store, 'Invoices', 'ID', 'i3');
  store.update('Invoices', i3, { CustomerID: 'c1' });
  store.delete('Customers', idOf(store, 'Customers', 'ID', 'c2'));
  const moved = seqOf(store, 'Invoices', i3, 'update');
  assert.throws(() => store.restoreRecord('Invoices', i3, moved - 1), code(505, /no Customers record has ID "c2"/));
  assert.equal(store.get('Invoices', i3).fieldData.CustomerID, 'c1');
});

test('a parent\'s delete, edit and truncate check their children under the write lock, so no child can come in between', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-fk-lock-'));
  const path = join(dir, 'Sales.sqlite');
  createStore(path, { mode: 'native' });
  const store = new Store(path, 'Sales');
  // Another process's connection, which doesn't wait for a lock.
  const other = new DatabaseSync(path);
  other.exec('PRAGMA busy_timeout = 0');
  t.after(() => { other.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  sales(store, 'restrict');
  // Whenever the store looks for a parent's children, the other connection tries to add one first.
  const tried: string[] = [];
  const sql = store.sql;
  const prepare = sql.prepare.bind(sql);
  sql.prepare = ((text: string) => {
    const statement = prepare(text);
    if (!/^SELECT _fm_record_id AS id FROM "Invoices" WHERE "CustomerID"/.test(text)) return statement;
    const all = statement.all.bind(statement);
    statement.all = ((...params: never[]) => {
      try {
        other.prepare('INSERT INTO "Invoices" ("ID", "CustomerID") VALUES (\'sneaked\', ?)').run(params[0] ?? 'c1');
        tried.push('inserted');
      } catch (e) {
        tried.push(/locked|busy/i.test(String(e)) ? 'locked' : String(e));
      }
      return all(...params);
    }) as typeof statement.all;
    return statement;
  }) as typeof sql.prepare;
  const c9 = store.create('Customers', { ID: 'c9' }).recordId;
  store.delete('Customers', c9);
  const c8 = store.create('Customers', { ID: 'c8' }).recordId;
  store.update('Customers', c8, { ID: 'c7' });
  assert.throws(() => store.truncate('Customers'), code(505, /on delete restrict/));
  assert.ok(tried.length >= 3, `the seam ran for each (${tried.join(', ')})`);
  assert.deepEqual([...new Set(tried)], ['locked']);
  assert.deepEqual(ids(store, 'Invoices').filter((v) => v === 'sneaked'), []);
});

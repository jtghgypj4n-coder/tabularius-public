import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, explainRelated, Store } from '../src/index.ts';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-explain-related-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

let n = 0;
function crm(): Store {
  const path = join(dir, `Crm${++n}.sqlite`);
  createStore(path);
  const store = new Store(path, 'Crm');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Region' }, { name: 'Pick', options: { global: true } }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Region' }, { name: 'Total', type: 'number' }, { name: 'Status' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }, { left: 'Region', right: 'Region' }] },
    { op: 'createOccurrence', name: 'Picked', table: 'Orders' },
    { op: 'createRelationship', left: 'Customers', right: 'Picked', predicates: [{ left: 'Pick', right: 'Status' }] },
  ]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!.id;
  const field = (f: string) => store.schema.tables.find((x) => x.name === 'Orders')!.fields.find((x) => x.name === f)!.id;
  const ref = (f: string) => ({ tableOccurrenceId: occ('Orders'), fieldId: field(f), tableOccurrence: 'Orders', field: f });
  const layout = store.design('Customers')!;
  const portal = {
    id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
    portal: { tableOccurrenceId: occ('Orders'), tableOccurrence: 'Orders', rows: 4, initialRow: 1, sort: [{ field: ref('Total'), descending: true }], filter: 'Orders::Status ≠ "Void"' },
    children: [{ id: 901, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 202, left: 22, bottom: 222, right: 120 }, style: {}, field: { ...ref('Total'), display: 'edit', repetitions: 1 } }],
  };
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...layout.objects, portal] } as never }]);
  return store;
}

test('a portal: the path, both sides of each match, the filter and sort, and each row in or out', () => {
  const store = crm();
  const c = store.create('Customers', { Id: '1', Region: 'West' }).recordId;
  for (const [total, status, region] of [[5, 'Open', 'West'], [50, 'Void', 'West'], [20, 'Open', 'West'], [9, 'Paid', 'East']]) {
    store.create('Orders', { CustomerId: '1', Total: String(total), Status: String(status), Region: String(region) });
  }
  const info = store.layout('Customers');
  const e = explainRelated(store, info, c, { portal: 'Orders' }, { candidate: 4 });
  assert.equal(e.kind, 'portal');
  assert.equal(e.path.length, 1);
  assert.equal(e.path[0].relationship, 'Customers::Id = Orders::CustomerId and Customers::Region = Orders::Region');
  assert.deepEqual(e.path[0].match.map((m) => [m.values, m.matches]), [[[1], 4], [['West'], 3]]);
  assert.equal(e.related, 3);
  assert.deepEqual(e.portal, { name: 'Orders', shown: 2, filteredOut: 1, filter: 'Orders::Status ≠ "Void"', sort: ['Total descending'] });
  // Shown rows in the portal's order first, then the hidden one.
  assert.deepEqual(e.rows.map((r) => [r.recordId, r.shown, r.position]), [[3, true, 1], [1, true, 2], [2, false, undefined]]);
  assert.match(e.rows[2].reason, /Hidden by the portal filter, which gives "0"/);
  assert.deepEqual(e.rows[0].keys, { 'Orders::CustomerId': 1, 'Orders::Region': 'West' });
  assert.equal(e.verdict, 'The portal "Orders" shows 2 of 3 related records (the filter hides 1)');
  // Record 4 is in the East.
  assert.equal(e.candidate!.related, false);
  assert.deepEqual(e.candidate!.checks.map((x) => x.ok), [true, false]);
  assert.match(e.candidate!.reason, /Customers::Region \("West"\) = Orders::Region \("East"\) doesn't match/);
  // Record 2 is related, and the filter's steps say why it's hidden.
  const two = explainRelated(store, info, c, { portal: 'Orders' }, { candidate: 2 }).candidate!;
  assert.equal(two.related, true);
  assert.equal(two.shown, false);
  assert.equal(two.filter!.value, '0');
  assert.equal(two.filter!.steps!.steps![0].value, 'Void');
  store.close();
});

test('why a portal is empty: an empty key, no matching value, matches that never meet, the filter', () => {
  const store = crm();
  const info = store.layout('Customers');
  store.create('Orders', { CustomerId: '1', Region: 'East', Status: 'Void' });
  store.create('Orders', { CustomerId: '2', Region: 'West', Status: 'Void' });
  const empty = store.create('Customers', { Region: 'West' }).recordId;
  assert.match(explainRelated(store, info, empty, { portal: 'Orders' }).verdict,
    /is empty: Customers::Id is empty on this record, and empty match fields never match anything/);
  const none = store.create('Customers', { Id: '7', Region: 'West' }).recordId;
  assert.match(explainRelated(store, info, none, { portal: 'Orders' }).verdict, /no Orders record matches Customers::Id = Orders::CustomerId with 7/);
  const apart = store.create('Customers', { Id: '1', Region: 'West' }).recordId;
  assert.match(explainRelated(store, info, apart, { portal: 'Orders' }).verdict,
    /each match finds records on its own \(Customers::Id = Orders::CustomerId: 1; Customers::Region = Orders::Region: 1\), but no record matches all of them together/);
  const hidden = store.create('Customers', { Id: '2', Region: 'West' }).recordId;
  assert.equal(explainRelated(store, info, hidden, { portal: 'Orders' }).verdict,
    'The portal "Orders" is empty: the relationship finds 1 record, and the portal filter hides every one');
  store.close();
});

test('a related field through a global key shows the first related record', () => {
  const store = crm();
  const info = store.layout('Customers');
  const c = store.create('Customers', { Id: '1' }).recordId;
  store.create('Orders', { Status: 'Open', Total: '5' });
  store.create('Orders', { Status: 'Open', Total: '8' });
  store.setGlobalField('Customers::Pick', 'open');
  const e = explainRelated(store, info, c, { field: 'Picked::Total' });
  assert.deepEqual(e.path[0].match[0].values, ['open']);
  assert.equal(e.related, 2);
  assert.equal(e.verdict, 'Picked::Total shows record 1, the first of 2 related records: "5"');
  assert.throws(() => explainRelated(store, info, c, { field: 'Picked::Nope' }), /no field named "Nope"/);
  store.close();
});

test('a global or unstored match field on the far side: the relationship can\'t match', () => {
  const store = crm();
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Key', options: { global: true } }, { name: 'Text' }] },
    { op: 'createField', table: 'Notes', name: 'Calc key', kind: 'calculation', type: 'text', calculation: 'Text', options: { unstored: true } },
    { op: 'createRelationship', left: 'Customers', right: 'Notes', predicates: [{ left: 'Region', right: 'Key' }] },
    { op: 'createOccurrence', name: 'Calc notes', table: 'Notes' },
    { op: 'createRelationship', left: 'Customers', right: 'Calc notes', predicates: [{ left: 'Region', right: 'Calc key' }] },
  ]);
  const info = store.layout('Customers');
  const c = store.create('Customers', { Id: '1', Region: 'West' }).recordId;
  store.create('Notes', { Text: 'West' });
  store.setGlobalField('Notes::Key', 'West');
  const global = explainRelated(store, info, c, { field: 'Notes::Text' });
  assert.equal(global.related, 0);
  assert.match(global.verdict, /Notes::Key is a global field on the side being matched: .* this relationship can't match/);
  const unstored = explainRelated(store, info, c, { field: 'Calc notes::Text' });
  assert.equal(unstored.related, 0);
  assert.match(unstored.verdict, /Calc notes::Calc key is an unstored calculation on the side being matched: .* this relationship can't match/);
  store.close();
});

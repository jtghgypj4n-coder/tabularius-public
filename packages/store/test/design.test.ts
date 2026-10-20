import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canCreateRelated, createStore, designReport, importFmp12, upgradeDesigns, parseScriptText, Store, StoreError } from '../src/index.ts';
import { scriptText } from '../../fmp12/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-design-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

function blank(name: string): Store {
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  return new Store(path, name);
}

test('a solution built from scratch: tables, fields, a layout, records', () => {
  const store = blank('Scratch');
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'First' }, { name: 'Last' }, { name: 'Age', type: 'number' }] },
    { op: 'createField', table: 'Contacts', name: 'Full', kind: 'calculation', calculation: 'First & " " & Last' },
  ]);
  assert.deepEqual(store.layouts(), [{ name: 'Contacts', table: 'Contacts' }]);
  assert.equal(store.schema.tableOccurrences[0].name, 'Contacts');
  const design = store.design('Contacts')!;
  assert.ok(design.objects.some((o) => o.field?.field === 'Age'));

  const { recordId } = store.create('Contacts', { First: 'Ada', Last: 'Lovelace', Age: '36' });
  let rec = store.get('Contacts', recordId);
  assert.equal(rec.fieldData.Full, 'Ada Lovelace');
  assert.equal(rec.fieldData.Age, 36);

  // Renaming a field rewrites formulas and layouts that use it; the data stays.
  store.applyDesign([{ op: 'updateField', table: 'Contacts', field: 'First', name: 'Given name' }]);
  const full = store.schema.tables[0].fields.find((f) => f.name === 'Full')!;
  assert.equal(full.calculation, 'Given name & " " & Last');
  assert.ok(store.design('Contacts')!.objects.some((o) => o.field?.field === 'Given name'));
  rec = store.get('Contacts', recordId);
  assert.equal(rec.fieldData['Given name'], 'Ada');
  assert.equal(rec.fieldData.Full, 'Ada Lovelace');

  // Deleting it leaves FileMaker's marker in the formula.
  store.applyDesign([{ op: 'deleteField', table: 'Contacts', field: 'Given name' }]);
  assert.equal(store.schema.tables[0].fields.find((f) => f.name === 'Full')!.calculation, '<Field Missing> & " " & Last');
  assert.equal(store.get('Contacts', recordId).fieldData['Given name'], undefined);
  assert.equal(store.designHistory().length, 4);
  assert.ok(store.design('Contacts')!.objects.some((o) => o.field?.field === 'Full'), 'fields added later join the generated layout');
  store.close();
});

test('changes apply all together or not at all', () => {
  const store = blank('Atomic');
  assert.throws(() => store.applyDesign([
    { op: 'createTable', name: 'A' },
    { op: 'createTable', name: 'a' },
  ]), (e: StoreError) => e.code === 504 && /Change 2/.test(e.message));
  assert.equal(store.schema.tables.length, 0);
  assert.throws(() => store.query('SELECT * FROM A'), /no such table/);
  assert.throws(() => store.applyDesign([{ op: 'createTable', name: '_fm_x' }]), (e: StoreError) => e.code === 960);
  assert.equal(store.designHistory().length, 0);
  store.close();
});

test('stored calculations are computed for existing records; types are reinterpreted', () => {
  const store = blank('Recompute');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Qty', type: 'number' }, { name: 'Price', type: 'number' }, { name: 'When' }] }]);
  const a = store.create('Items', { Qty: '2', Price: '1.5', When: '10/11/2026' }).recordId;
  const b = store.create('Items', { Qty: '4', Price: '2' }).recordId;
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Total', kind: 'calculation', type: 'number', calculation: 'Qty * Price' }]);
  assert.equal(store.get('Items', a).fieldData.Total, 3);
  assert.equal(store.get('Items', b).fieldData.Total, 8);
  store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Total', calculation: 'Qty * Price * 10' }]);
  assert.equal(store.get('Items', b).fieldData.Total, 80);
  // Text "10/11/2026" becomes a date (stored as ISO), shown back in US order.
  store.applyDesign([{ op: 'updateField', table: 'Items', field: 'When', type: 'date' }]);
  assert.equal(store.query(`SELECT "When" AS w FROM Items WHERE _fm_record_id = ${a}`)[0].w, '2026-10-11');
  assert.equal(store.get('Items', a).fieldData.When, '10/11/2026');
  store.close();
});

test('turning indexing on or off doesn\'t recompute a stored calculation', () => {
  const store = blank('NoRecompute');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Qty', type: 'number' }] }]);
  const a = store.create('Items', { Qty: '2' }).recordId;
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Twice', kind: 'calculation', type: 'number', calculation: 'Qty * 2' }]);
  // A value FileMaker stored long ago (calculations go stale): recomputing would replace it.
  (store as unknown as { sql: { exec(q: string): void } }).sql.exec(`UPDATE Items SET "Twice" = 99 WHERE _fm_record_id = ${a}`);
  store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Twice', options: { noAutoIndex: true } }] as never);
  store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Twice', options: { noAutoIndex: null } }] as never);
  assert.equal(store.get('Items', a).fieldData.Twice, 99);
  store.close();
});

test('an empty container still counts as a value for "do not evaluate if all referenced fields are empty"', () => {
  const store = blank('EmptyRefs');
  store.applyDesign([{ op: 'createTable', name: 'Art', fields: [{ name: 'Note' }, { name: 'Image', type: 'container' }] }]);
  const a = store.create('Art', {}).recordId;
  store.applyDesign([
    { op: 'createField', table: 'Art', name: 'NoImage', kind: 'calculation', type: 'number', calculation: 'IsEmpty ( Image )' },
    { op: 'createField', table: 'Art', name: 'NoNote', kind: 'calculation', type: 'number', calculation: 'IsEmpty ( Note )' },
  ]);
  // As a private sample's stored flags show: 1 for the empty container, nothing for the empty text field.
  assert.equal(store.get('Art', a).fieldData.NoImage, 1);
  assert.equal(store.get('Art', a).fieldData.NoNote, '');
  store.close();
});

test('relationships, value lists, custom functions and scripts', () => {
  const store = blank('Graph');
  store.applyDesign([
    { op: 'createTable', name: 'Companies', fields: [{ name: 'Id', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } }, { name: 'Name' }] },
    { op: 'createTable', name: 'People', fields: [{ name: 'CompanyId', type: 'number' }, { name: 'Name' }] },
    { op: 'createOccurrence', name: 'People of company', table: 'People' },
    { op: 'createRelationship', left: 'Companies', right: 'People of company', predicates: [{ left: 'Id', right: 'CompanyId' }] },
    { op: 'createField', table: 'Companies', name: 'Headcount', kind: 'calculation', type: 'number', calculation: 'Count ( People of company::Name )', options: { unstored: true } },
    { op: 'createValueList', name: 'Sizes', values: ['Small', 'Large'] },
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createScript', name: 'Hello', steps: [{ name: 'Set Variable', params: { variable: '$x', value: 'People of company::Name' } }, { name: 'Exit Script', params: { calculation: '$x' } }] },
  ]);
  const co = store.create('Companies', { Name: 'Acme' }).recordId;
  const id = store.get('Companies', co).fieldData.Id;
  store.create('People', { CompanyId: String(id), Name: 'Wile' });
  store.create('People', { CompanyId: String(id), Name: 'Road' });
  assert.equal(store.get('Companies', co).fieldData.Headcount, 2);
  assert.equal(store.schema.scripts[0].steps[0].stepId, 141);
  assert.equal(store.schema.scripts[0].steps[1].line, 'Exit Script [ Result: $x ]');

  // Renaming the occurrence follows into formulas and script steps.
  store.applyDesign([{ op: 'updateOccurrence', occurrence: 'People of company', name: 'Staff' }]);
  const headcount = store.schema.tables.find((t) => t.name === 'Companies')!.fields.find((f) => f.name === 'Headcount')!;
  assert.equal(headcount.calculation, 'Count ( Staff::Name )');
  assert.equal(store.schema.scripts[0].steps[0].params!.value, 'Staff::Name');
  assert.equal(store.schema.relationships[0].rightTableOccurrence, 'Staff');
  assert.equal(store.get('Companies', co).fieldData.Headcount, 2);

  // Renaming a table renames its SQL table; the records stay.
  store.applyDesign([{ op: 'renameTable', table: 'People', name: 'Persons' }]);
  assert.equal(store.query('SELECT count(*) AS n FROM Persons')[0].n, 2);
  assert.equal(store.get('Companies', co).fieldData.Headcount, 2);
  store.close();
});

test('layouts and scripts can be renamed, rebuilt and deleted', () => {
  const store = blank('Layouts');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createLayout', name: 'T list', occurrence: 'T' },
    { op: 'createScript', name: 'Go', steps: [{ name: 'Go to Layout', params: { layout: { id: 2, name: 'T list' }, layoutDestination: 'named' } }] },
  ]);
  store.applyDesign([{ op: 'updateLayout', layout: 'T list', name: 'All T' }]);
  assert.equal(store.schema.scripts[0].steps[0].params!.layout!.name, 'All T');
  assert.match(store.schema.scripts[0].steps[0].line!, /“All T”/);
  const design = store.design('All T')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'All T', design: { ...design, width: 900, objects: design.objects.slice(0, 1) } }]);
  assert.equal(store.design('All T')!.width, 900);
  assert.equal(store.design('All T')!.objects.length, 1);
  store.applyDesign([{ op: 'deleteLayout', layout: 'All T' }]);
  assert.deepEqual(store.layouts().map((l) => l.name), ['T']);
  assert.throws(() => store.applyDesign([{ op: 'createScript', name: 'Bad', steps: [{ name: 'Fly to the Moon' }] }]), (e: StoreError) => e.code === 960);
  store.close();
});

test('design changes to an imported file survive re-reading its design', { skip }, () => {
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  let store = new Store(path, 'Charts');
  const table = store.schema.tables.find((t) => t.name === 'Congress')!;
  const before = store.query('SELECT count(*) AS n FROM Congress')[0].n;
  store.applyDesign([
    { op: 'updateField', table: 'Congress', field: 'Party', name: 'Party Code', comment: 'D, R or I' },
    { op: 'createField', table: 'Congress', name: 'Label', kind: 'calculation', calculation: 'Name & " (" & Party Code & ")"' },
  ]);
  const rec = store.find('Congress', { limit: 1, query: [{ Name: '=Nancy Pelosi' }] }).records[0];
  assert.equal(rec.fieldData.Label, 'Nancy Pelosi (D)');
  store.applyDesign([{ op: 'deleteField', table: 'Congress', field: 'Name' }]);
  store.applyDesign([{ op: 'restoreDeleted', deleted: store.deletedDesigns()[0].id }]);
  store.close();

  // A reader upgrade re-reads the design from the .fmp12; the edits are applied again.
  upgradeDesigns(path, fixture);
  store = new Store(path, 'Charts');
  const fields = store.schema.tables.find((t) => t.id === table.id)!.fields;
  assert.ok(fields.some((f) => f.name === 'Party Code' && f.comment === 'D, R or I'));
  assert.ok(!fields.some((f) => f.name === 'Party'));
  assert.equal(fields.find((f) => f.name === 'Label')?.calculation, 'Name & " (" & Party Code & ")"');
  assert.ok(fields.some((f) => f.name === 'Name'));
  assert.equal(store.query('SELECT count(*) AS n FROM Congress')[0].n, before);
  store.close();
});

test('scripts as text: unchanged lines keep their steps, edited lines are read', { skip }, () => {
  const flicks = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
  const path = join(dir, 'Flicks.sqlite');
  importFmp12(flicks, path);
  const store = new Store(path, 'Flicks');
  // Every script reads back from its own text as exactly the same steps.
  for (const s of store.schema.scripts) {
    const back = parseScriptText(scriptText(s.steps), store.schema, s.steps);
    assert.equal(back.length, s.steps.length, s.name);
    back.forEach((b, i) => assert.equal(b, s.steps[i], `${s.name} step ${i + 1}`));
  }
  const script = store.schema.scripts.find((s) => s.steps.length > 5)!;
  const lines = scriptText(script.steps).split('\n');
  lines.unshift('Set Variable [ $greeting ; Value: "Hello " & Get ( AccountName ) ]', '# a note', '// Beep');
  store.applyDesign([{ op: 'updateScript', script: script.name, text: lines.join('\n') }]);
  const steps = store.schema.scripts.find((s) => s.id === script.id)!.steps;
  assert.equal(steps.length, script.steps.length + 3);
  assert.deepEqual(steps[0].params, { variable: '$greeting', value: '"Hello " & Get ( AccountName )' });
  assert.equal(steps[1].stepId, 89);
  assert.equal(steps[1].text, 'a note');
  assert.equal(steps[2].enabled, false);
  assert.deepEqual(steps.slice(3), script.steps);
  store.close();
});

test('scripts as text: steps, targets and errors with line numbers', () => {
  const store = blank('ScriptText');
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Age', type: 'number' }] },
    { op: 'createScript', name: 'Tidy', text: [
      'Go to Layout [ “People” ]',
      'Perform Find [ Restore; Find: People::Age: “>65” ]',
      'Sort Records [ Restore; People::Name; ascending ; With dialog: Off ]',
      'Go to Record/Request/Page [ First ]',
      'Loop',
      '\tSet Field [ People::Name ; Proper ( People::Name ) ]',
      '\tGo to Record/Request/Page [ Next ; Exit after last: On ]',
      'End Loop',
      'Exit Script [ Result: Get ( FoundCount ) ]',
    ].join('\n') },
  ]);
  const steps = store.schema.scripts[0].steps;
  assert.equal(steps.length, 9);
  assert.equal(steps[0].params!.layout!.name, 'People');
  assert.deepEqual(steps[1].params!.requests, [{ omit: false, criteria: [{ field: { tableOccurrence: { id: 129, name: 'People' }, field: { id: 1, name: 'Name' } }, criteria: '>65' }].map((c) => ({ ...c, field: { ...c.field, field: { id: 2, name: 'Age' } } })) }]);
  assert.equal(steps[2].params!.sort![0].order, 'ascending');
  assert.equal(steps[2].params!.noDialog, true);
  assert.equal(steps[5].params!.field!.field.name, 'Name');
  assert.equal(steps[6].params!.exitAfterLast, true);
  assert.equal(steps[8].line, 'Exit Script [ Result: Get ( FoundCount ) ]');
  // It runs: the steps are what the script engine reads.
  store.create('People', { Name: 'ada lovelace', Age: '70' });
  store.create('People', { Name: 'young one', Age: '20' });

  assert.throws(() => store.applyDesign([{ op: 'updateScript', script: 'Tidy', text: 'Go to Layout [ “Nope” ]\nSet Field [ People::Nope ; 1 ]' }]),
    (e: StoreError) => e.code === 960 && /Line 1: No layout named "Nope"/.test(e.message));
  assert.throws(() => store.applyDesign([{ op: 'updateScript', script: 'Tidy', text: 'Beep\nFly [ high ]' }]), /Line 2: Unknown script step "Fly"/);
  store.close();
});

test('portal sort and filter', () => {
  const store = blank('Portals');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Total', type: 'number' }, { name: 'Status' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
  ]);
  const occ = (n: string) => store.schema.tableOccurrences.find((t) => t.name === n)!.id;
  const field = (t: string, f: string) => store.schema.tables.find((x) => x.name === t)!.fields.find((x) => x.name === f)!.id;
  const layout = store.design('Customers')!;
  const ref = (f: string) => ({ tableOccurrenceId: occ('Orders'), fieldId: field('Orders', f), tableOccurrence: 'Orders', field: f });
  const portal = {
    id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
    portal: { tableOccurrenceId: occ('Orders'), tableOccurrence: 'Orders', rows: 4, initialRow: 1, sort: [{ field: ref('Total'), descending: true }], filter: 'Orders::Status ≠ "Void"' },
    children: [{ id: 901, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 202, left: 22, bottom: 222, right: 120 }, style: {}, field: { ...ref('Total'), display: 'edit', repetitions: 1 } }],
  };
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...layout.objects, portal] } as never }]);
  const c = store.create('Customers', { Id: '1', Name: 'Acme' }).recordId;
  for (const [total, status] of [[5, 'Open'], [50, 'Void'], [20, 'Open'], [9, 'Paid']]) store.create('Orders', { CustomerId: '1', Total: String(total), Status: String(status) });
  const rows = store.get('Customers', c).portalData!.Orders;
  assert.deepEqual(rows.map((r) => r['Orders::Total']), [20, 9, 5]);
  assert.deepEqual(store.portalCounts('Customers', c), { Orders: 3 });
  assert.deepEqual(store.get('Customers', c, 'us', { Orders: { offset: 2, limit: 1 } }).portalData!.Orders.map((r) => r['Orders::Total']), [9]);

  // Renames reach the portal's sort field and filter formula.
  store.applyDesign([{ op: 'updateField', table: 'Orders', field: 'Status', name: 'State' }, { op: 'updateField', table: 'Orders', field: 'Total', name: 'Amount' }]);
  const p = store.design('Customers')!.objects.find((o) => o.id === 900)!.portal!;
  assert.equal(p.filter, 'Orders::State ≠ "Void"');
  assert.equal(p.sort![0].field.field, 'Amount');
  assert.deepEqual(store.get('Customers', c).portalData!.Orders.map((r) => r['Orders::Amount']), [20, 9, 5]);
  store.close();
});

test('layout and script order with folders and separators', () => {
  const store = blank('Order');
  store.applyDesign([
    { op: 'createTable', name: 'A' },
    { op: 'createTable', name: 'B' },
    { op: 'createTable', name: 'C' },
  ]);
  store.applyDesign([{ op: 'setOrder', list: 'layouts', order: [{ item: 'C' }, { folder: 'Reports', children: [{ item: 'A' }, { separator: true }] }] }]);
  const order = store.schema.layoutOrder.map((o) => [o.kind, o.name, o.depth]);
  assert.deepEqual(order, [['item', 'C', 0], ['folder', 'Reports', 0], ['item', 'A', 1], ['separator', '', 1], ['item', 'B', 0]]);
  const folderId = store.schema.layoutOrder[1].id;
  assert.ok(!store.schema.layouts.some((l) => l.id === folderId), 'folders get ids of their own');
  // The logged op names items by id and keeps the folder's id.
  assert.deepEqual(store.designHistory(1)[0].op, { op: 'setOrder', list: 'layouts', order: [{ item: 3 }, { folder: 'Reports', id: folderId, children: [{ item: 1 }, { separator: true, id: folderId + 1 }] }, { item: 2 }] });
  // New layouts join the end; deleted ones leave.
  store.applyDesign([{ op: 'createLayout', name: 'D', occurrence: 'A' }, { op: 'deleteLayout', layout: 'C' }]);
  assert.deepEqual(store.schema.layoutOrder.filter((o) => o.kind === 'item').map((o) => o.name), ['A', 'B', 'D']);
  assert.throws(() => store.applyDesign([{ op: 'setOrder', list: 'layouts', order: [{ item: 'A' }, { item: 'A' }] }]), /twice/);
  assert.throws(() => store.applyDesign([{ op: 'setOrder', list: 'scripts', order: [{ item: 'Nope' }] }]), /missing/);
  store.close();
});

test('"Include in menu" for layouts and scripts', () => {
  const store = blank('InMenu');
  store.applyDesign([{ op: 'createTable', name: 'A' }, { op: 'createTable', name: 'B' }, { op: 'createScript', name: 'Go', steps: [] }]);
  const hidden = (order: { name: string; hidden?: true }[]) => order.filter((o) => o.hidden).map((o) => o.name);
  // A file with no stored order gets one in the layouts' own order.
  store.applyDesign([{ op: 'updateLayout', layout: 'B', includeInMenu: false }, { op: 'updateScript', script: 'Go', includeInMenu: false }]);
  assert.deepEqual(store.schema.layoutOrder.map((o) => o.name), ['A', 'B']);
  assert.deepEqual(hidden(store.schema.layoutOrder), ['B']);
  assert.deepEqual(hidden(store.schema.scriptOrder), ['Go']);
  // Moving it keeps the setting; an order entry can change it.
  store.applyDesign([{ op: 'setOrder', list: 'layouts', order: [{ item: 'B' }, { item: 'A', includeInMenu: false }] }]);
  assert.deepEqual(hidden(store.schema.layoutOrder), ['B', 'A']);
  store.applyDesign([{ op: 'updateLayout', layout: 'B', includeInMenu: true }]);
  assert.deepEqual(hidden(store.schema.layoutOrder), ['A']);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'A', includeInMenu: 'no' as unknown as boolean }]), /true or false/);
  store.close();
});

test('value lists from a field: all values, a second field, related values', () => {
  const store = blank('Lists');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Product' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createValueList', name: 'Customers', field: { occurrence: 'Customers', field: 'Id', second: 'Name', sortBySecond: true } },
    { op: 'createValueList', name: 'Bought', field: { occurrence: 'Orders', field: 'Product', related: 'Customers' } },
  ]);
  const ada = store.create('Customers', { Id: '2', Name: 'Ada' }).recordId;
  store.create('Customers', { Id: '1', Name: 'Zed' });
  store.create('Customers', { Id: '3', Name: '' });
  for (const [c, p] of [[2, 'Tea'], [2, 'Cake'], [2, 'Tea'], [1, 'Coffee']]) store.create('Orders', { CustomerId: String(c), Product: String(p) });

  // Distinct values, sorted (here by the second field); the logged op names things by id.
  assert.deepEqual(store.valueListItems('Customers'), [{ value: '3', display: '' }, { value: '2', display: 'Ada' }, { value: '1', display: 'Zed' }]);
  assert.deepEqual(store.designHistory(1)[0].op, { op: 'createValueList', id: 2, name: 'Bought', field: { occurrence: store.schema.tableOccurrences[1].id, field: 2, related: store.schema.tableOccurrences[0].id } });
  assert.deepEqual(store.valueListItems('Bought'), [], 'related values need a record');
  assert.deepEqual(store.valueListItems('Bought', { info: store.layout('Customers'), recordId: ada }).map((i) => i.value), ['Cake', 'Tea']);
  assert.deepEqual(store.valueListItems('Bought', { info: store.layout('Customers'), recordId: ada + 1 }).map((i) => i.value), ['Coffee']);

  // Renaming the field changes nothing (lists refer by id); custom values replace the field.
  store.applyDesign([{ op: 'updateField', table: 'Orders', field: 'Product', name: 'Item' }]);
  assert.equal(store.valueListItems('Bought', { info: store.layout('Customers'), recordId: ada }).length, 2);
  store.applyDesign([{ op: 'updateValueList', valueList: 'Bought', values: ['A'] }]);
  assert.deepEqual(store.schema.valueLists.find((v) => v.name === 'Bought'), { id: 2, name: 'Bought', values: ['A'] });
  assert.throws(() => store.applyDesign([{ op: 'createValueList', name: 'Bad', field: { occurrence: 'Orders', field: 'Nope' } }]), /missing/);

  // A list defined in another file gives that file's items once the file is open.
  const other = blank('UsesLists');
  other.schema.dataSources.push({ id: 7, name: 'Lists', paths: ['file:Lists'] });
  other.schema.valueLists.push({ id: 1, name: 'Their customers', external: { dataSourceId: 7, valueListId: 1 } });
  assert.deepEqual(other.valueListItems('Their customers'), [], 'empty until the file is open');
  other.resolveFile = (name) => (name === 'Lists' ? store : undefined);
  assert.deepEqual(other.valueListItems('Their customers').map((i) => i.display), ['', 'Ada', 'Zed']);
  other.close();
  store.close();
});

test('a sub-summary part follows its field when it is renamed', () => {
  const store = blank('Parts');
  store.applyDesign([{ op: 'createTable', name: 'Sales', fields: [{ name: 'Region' }, { name: 'Amount', type: 'number' }] }]);
  const layout = store.design('Sales')!;
  const to = store.schema.tableOccurrences[0];
  const region = store.schema.tables[0].fields.find((f) => f.name === 'Region')!;
  const parts = [...layout.parts, { kind: 'sub-summary-leading' as const, kindId: 3, top: 400, height: 30, style: {}, breakField: { tableOccurrenceId: to.id, fieldId: region.id, tableOccurrence: to.name, field: 'Region' } }];
  store.applyDesign([{ op: 'updateLayout', layout: 'Sales', design: { parts } }]);
  store.applyDesign([{ op: 'updateField', table: 'Sales', field: 'Region', name: 'Area' }]);
  assert.equal(store.design('Sales')!.parts.find((p) => p.kind === 'sub-summary-leading')!.breakField!.field, 'Area');
  store.close();
});

test('script triggers follow renamed scripts and fields', () => {
  const store = blank('Triggers');
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Text' }] },
    { op: 'createScript', name: 'Loaded', text: 'Beep' },
  ]);
  const scriptId = store.schema.scripts[0].id;
  const layout = store.design('Notes')!;
  const objects = layout.objects.map((o) => (o.field?.field === 'Text' ? { ...o, triggers: [{ event: 'OnObjectModify', scriptId, script: 'Loaded', parameter: 'Notes::Text' }] } : o));
  store.applyDesign([{ op: 'updateLayout', layout: 'Notes', design: { objects, triggers: [{ event: 'OnRecordLoad', scriptId, script: 'Loaded', parameter: 'Text' }] } }]);
  store.applyDesign([{ op: 'updateScript', script: 'Loaded', name: 'Shown' }, { op: 'updateField', table: 'Notes', field: 'Text', name: 'Body' }]);
  const d = store.design('Notes')!;
  assert.deepEqual(d.triggers, [{ event: 'OnRecordLoad', scriptId, script: 'Shown', parameter: 'Body' }]);
  assert.deepEqual(d.objects.find((o) => o.triggers)!.triggers, [{ event: 'OnObjectModify', scriptId, script: 'Shown', parameter: 'Notes::Body' }]);
  store.close();
});

test('relationship options: creating through a portal, and deleting related records', () => {
  const store = blank('RelOptions');
  store.applyDesign([
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceId', type: 'number' }, { name: 'Item' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Id', right: 'InvoiceId' }], rightDelete: true },
  ]);
  const rel = store.schema.relationships[0];
  assert.deepEqual([rel.leftCreate, rel.rightCreate, rel.leftDelete, rel.rightDelete], [true, true, undefined, true]);
  const inv = store.create('Invoices', { Id: '1' }).recordId;
  store.create('Invoices', { Id: '2' });
  for (const [i, item] of [[1, 'a'], [1, 'b'], [2, 'c']]) store.create('Lines', { InvoiceId: String(i), Item: String(item) });
  store.delete('Invoices', inv);
  assert.deepEqual(store.query('SELECT Item FROM Lines').map((r) => r.Item), ['c']);

  // Turning creation off on the Lines side stops new portal rows.
  const layout = store.design('Invoices')!;
  const portal = { id: 900, kind: 'portal', type: 3, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {}, portal: { tableOccurrenceId: store.schema.tableOccurrences[1].id, tableOccurrence: 'Lines', rows: 3, initialRow: 1 }, children: [] };
  store.applyDesign([{ op: 'updateLayout', layout: 'Invoices', design: { objects: [...layout.objects, portal] } as never }, { op: 'updateRelationship', relationship: rel.id, rightCreate: false }]);
  const two = store.findIds('Invoices')[0];
  assert.throws(() => store.updatePortals('Invoices', two, { Lines: [{ 'Lines::Item': 'd' }] }), /Cannot create records/);
  store.applyDesign([{ op: 'updateRelationship', relationship: rel.id, rightCreate: true }]);
  // It says which related records it made, for the Data API's newPortalRecordInfo.
  const made = store.updatePortals('Invoices', two, { Lines: [{ 'Lines::Item': 'd' }] });
  assert.equal(store.query('SELECT count(*) AS n FROM Lines WHERE InvoiceId = 2')[0].n, 2);
  assert.equal(made.length, 1);
  assert.equal(made[0].portal, 'Lines');
  assert.equal(store.get('Lines', made[0].recordId).fieldData.Item, 'd');
  store.close();
});

test('field options: looked-up values, strict data types, existing values, prohibit modification', () => {
  const store = blank('FieldOptions');
  store.applyDesign([
    { op: 'createTable', name: 'Products', fields: [{ name: 'Code' }, { name: 'Price', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'Code' }] },
    { op: 'createRelationship', left: 'Lines', right: 'Products', predicates: [{ left: 'Code', right: 'Code' }] },
    { op: 'createField', table: 'Lines', name: 'Price', type: 'number', options: { autoEnter: { lookup: { occurrence: 'Products', field: 'Price', noMatch: 'value', value: '0' } as never } } },
    { op: 'createField', table: 'Lines', name: 'Qty', options: { validation: { type: 'number' } } },
    { op: 'createField', table: 'Lines', name: 'Stamp', options: { autoEnter: { data: 'web', prohibitModification: true } } },
  ]);
  const price = store.schema.tables[1].fields.find((f) => f.name === 'Price')!;
  assert.deepEqual(price.options?.autoEnter?.lookup, { occurrenceId: store.schema.tableOccurrences[0].id, fieldId: 2, noMatch: 'value', value: '0' });
  store.create('Products', { Code: 'A', Price: '9.5' });
  store.create('Products', { Code: 'B', Price: '20' });
  const line = store.create('Lines', { Code: 'A' }).recordId;
  const get = (col: string) => store.query(`SELECT ${col} AS v FROM Lines WHERE _fm_record_id = ${line}`)[0].v;
  assert.equal(get('Price'), 9.5);
  // A typed price stays until the match field changes again.
  store.update('Lines', line, { Price: '8' });
  assert.equal(get('Price'), 8);
  store.update('Lines', line, { Code: 'B' });
  assert.equal(get('Price'), 20);
  store.update('Lines', line, { Code: 'Z' });
  assert.equal(get('Price'), 0);
  // A product's price changing later doesn't change the line (it was copied).
  store.update('Lines', line, { Code: 'A' });
  store.update('Products', store.findIds('Products')[0], { Price: '11' });
  assert.equal(get('Price'), 9.5);

  assert.throws(() => store.update('Lines', line, { Qty: 'two' }), (e: StoreError) => e.code === 502);
  store.update('Lines', line, { Qty: '2' });

  assert.equal(get('Stamp'), 'web');
  assert.throws(() => store.update('Lines', line, { Stamp: 'x' }, undefined, { dataEntry: true }), (e: StoreError) => e.code === 201);
  store.update('Lines', line, { Stamp: 'script' });
  assert.equal(get('Stamp'), 'script');

  store.applyDesign([{ op: 'updateField', table: 'Lines', field: 'Code', options: { validation: { existing: true } } }]);
  store.create('Lines', { Code: 'A' });
  assert.throws(() => store.create('Lines', { Code: 'Q' }), (e: StoreError) => e.code === 505);

  assert.throws(() => store.applyDesign([{ op: 'createField', table: 'Products', name: 'Bad', options: { autoEnter: { lookup: { occurrence: 'Products', field: 'Code' } as never } } }]), /needs a relationship/);
  store.close();
});

test('field options: next lower/higher lookups, calculated messages, validation on every commit', () => {
  const store = blank('FieldOptions2');
  store.applyDesign([
    { op: 'createTable', name: 'Rates', fields: [{ name: 'From', type: 'number' }, { name: 'Rate', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Total', type: 'number' }, { name: 'Limit', type: 'number' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Rates', predicates: [{ left: 'Total', right: 'From' }] },
    { op: 'createField', table: 'Orders', name: 'Lower', type: 'number', options: { autoEnter: { lookup: { occurrence: 'Rates', field: 'Rate', noMatch: 'lower' } as never } } },
    { op: 'createField', table: 'Orders', name: 'Higher', type: 'number', options: { autoEnter: { lookup: { occurrence: 'Rates', field: 'Rate', noMatch: 'higher' } as never } } },
    { op: 'createField', table: 'Orders', name: 'Note', options: { validation: { calculation: 'Total <= Limit', calculationAlways: true, message: '"Over the limit of " & Limit', messageCalculation: true } } },
  ]);
  for (const [from, rate] of [[0, 1], [100, 2], [500, 3]]) store.create('Rates', { From: String(from), Rate: String(rate) });
  const id = store.create('Orders', { Total: '250', Limit: '1000' }).recordId;
  const get = (col: string) => store.query(`SELECT ${col} AS v FROM Orders WHERE _fm_record_id = ${id}`)[0].v;
  // No rate starts at 250: the next lower (100) and next higher (500) rows are copied.
  assert.equal(get('Lower'), 2);
  assert.equal(get('Higher'), 3);
  store.update('Orders', id, { Total: '500' });
  assert.equal(get('Lower'), 3);
  assert.equal(get('Higher'), 3);
  // Note isn't modified, but its calculation is checked on every commit, with its message worked out.
  assert.throws(() => store.update('Orders', id, { Limit: '10' }), /Over the limit of 10/);
  store.applyDesign([{ op: 'updateField', table: 'Orders', field: 'Note', options: { validation: { calculation: 'Total <= Limit', message: '"Over the limit of " & Limit', messageCalculation: true } } }]);
  store.update('Orders', id, { Limit: '10' });
  assert.throws(() => store.update('Orders', id, { Note: 'x' }), /Over the limit of 10/);
  store.close();
});

test('buttons that do one step: written as a script line, stored as the step', () => {
  const store = blank('Buttons');
  store.applyDesign([
    { op: 'createTable', name: 'Tasks', fields: [{ name: 'Title' }, { name: 'Status' }] },
    { op: 'createScript', name: 'Archive', text: 'Beep' },
  ]);
  const layout = store.design('Tasks')!;
  const button = (id: number, action: Record<string, unknown>) => ({ id, kind: 'button', type: 10, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200 + id, left: 20, bottom: 220 + id, right: 120 }, style: {}, text: 'Go', action });
  const { applied } = store.applyDesign([{ op: 'updateLayout', layout: 'Tasks', design: { objects: [...layout.objects,
    button(901, { stepId: 0, step: '', text: 'Set Field [ Tasks::Status ; "Done" ]' }),
    button(902, { stepId: 0, step: '', text: 'Perform Script [ "Archive" ; Parameter: Tasks::Title ]' })] } as never }]);
  const objs = store.design('Tasks')!.objects;
  const set = objs.find((o) => o.id === 901)!.action!;
  assert.equal(set.step, 'Set Field');
  assert.equal(set.line, 'Set Field [ Tasks::Status ; "Done" ]');
  assert.deepEqual(set.params, { field: { tableOccurrence: { id: store.schema.tableOccurrences[0].id, name: 'Tasks' }, field: { id: 2, name: 'Status' } }, calculation: '"Done"' });
  assert.equal((set as { text?: string }).text, undefined);
  assert.deepEqual(objs.find((o) => o.id === 902)!.action, { stepId: 1, step: 'Perform Script', scriptId: store.schema.scripts[0].id, script: 'Archive', parameter: 'Tasks::Title' });
  // The applied change carries the read step, for the editor.
  const savedButton = (applied[0] as { design: { objects: { id: number; action?: { step: string } }[] } }).design.objects.find((o) => o.id === 901);
  assert.equal(savedButton?.action?.step, 'Set Field');
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Tasks', design: { objects: [button(903, { stepId: 0, step: '', text: 'Beep\nBeep' })] } as never }]), /one step/);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Tasks', design: { objects: [button(903, { stepId: 0, step: '', text: 'Perform Script [ "Nope" ]' })] } as never }]), /No script named "Nope"/);
  store.close();
});

test('button bars: calculated labels and an active segment that must be one of its segments', () => {
  const store = blank('Bars');
  store.applyDesign([{ op: 'createTable', name: 'Tasks', fields: [{ name: 'Title' }] }]);
  const anchors = { left: true, top: true, right: false, bottom: false };
  const seg = (id: number, extra: Record<string, unknown>) => ({ id, kind: 'button', type: 10, anchors, bounds: { top: 300, left: 20, bottom: 320, right: 80 }, style: {}, ...extra });
  const bar = (active: number) => ({ id: 910, kind: 'button-bar', type: 18, anchors, bounds: { top: 300, left: 20, bottom: 320, right: 140 }, style: {}, activeSegment: active,
    children: [seg(911, { text: 'Open' }), seg(912, { label: '"Done (" & Get ( FoundCount ) & ")"' })] });
  const objects = store.design('Tasks')!.objects;
  store.applyDesign([{ op: 'updateLayout', layout: 'Tasks', design: { objects: [...objects, bar(912)] } as never }]);
  const saved = store.design('Tasks')!.objects.find((o) => o.id === 910)!;
  assert.equal(saved.activeSegment, 912);
  assert.equal(saved.children![1].label, '"Done (" & Get ( FoundCount ) & ")"');
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Tasks', design: { objects: [...objects, bar(999)] } as never }]), /one of its segments/);
  store.close();
});

test('charts: Chart Setup is checked when a layout is saved', () => {
  const store = blank('ChartsSetup');
  store.applyDesign([{ op: 'createTable', name: 'Sales', fields: [{ name: 'Region' }, { name: 'Amount', type: 'number' }] }]);
  const objects = store.design('Sales')!.objects;
  const chart = (c: Record<string, unknown>) => ({ id: 920, kind: 'chart', type: 13, external: 'CHRT', anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 300, left: 20, bottom: 540, right: 380 }, style: {}, chart: c });
  const ok = { type: 'pie', source: 'found-set', grouped: true, categories: 'Sales::Region', series: [{ data: 'Sales::Amount', name: '"Amount"' }] };
  store.applyDesign([{ op: 'updateLayout', layout: 'Sales', design: { objects: [...objects, chart(ok)] } as never }]);
  assert.deepEqual(store.design('Sales')!.objects.find((o) => o.id === 920)!.chart, ok);
  const save = (c: Record<string, unknown>) => () => store.applyDesign([{ op: 'updateLayout', layout: 'Sales', design: { objects: [...objects, chart(c)] } as never }]);
  assert.throws(save({ ...ok, type: 'donut' }), /isn't a chart type/);
  assert.throws(save({ ...ok, source: 'everything' }), /current record, the found set or related records/);
  assert.throws(save({ ...ok, series: [{ name: '"x"' }] }), /data formula/);
  // The look: background gradient and text sizes and colors, as read from files.
  const look = { ...ok, background: ['#ffffff', 'rgb(230 236 245)'], text: { title: { size: 18, color: '#112233' }, legend: { size: 10, color: 'rgb(51 51 51 / 0.8)' } } };
  save(look)();
  assert.deepEqual(store.design('Sales')!.objects.find((o) => o.id === 920)!.chart, look);
  assert.throws(save({ ...ok, background: ['#fff'] }), /two colors/);
  assert.throws(save({ ...ok, text: { title: { size: 12, color: 'red;}' } } }), /size up to 200 and a color/);
  store.close();
  const reopened = new Store(join(dir, 'ChartsSetup.sqlite'), 'ChartsSetup');
  try {
    assert.deepEqual(reopened.design('Sales')!.objects.find((o) => o.id === 920)!.chart, look);
  } finally {
    reopened.close();
  }
});

test('File Options: open layout and window scripts, by id so renames follow', () => {
  const store = blank('FileOpts');
  store.applyDesign([
    { op: 'createTable', name: 'Home', fields: [{ name: 'Note' }] },
    { op: 'createScript', name: 'Startup', text: 'Beep' },
    { op: 'setFileOptions', openLayout: 'Home', onFirstWindowOpen: 'Startup' },
  ]);
  const ids = { layout: store.schema.layouts[0].id, script: store.schema.scripts[0].id };
  assert.deepEqual(store.schema.fileOptions, { onFirstWindowOpen: { scriptId: ids.script, script: 'Startup' }, openLayoutId: ids.layout, openLayout: 'Home' });
  store.applyDesign([{ op: 'setFileOptions', onFirstWindowOpen: null, onLastWindowClose: ids.script }]);
  assert.deepEqual(store.schema.fileOptions, { onLastWindowClose: { scriptId: ids.script, script: 'Startup' }, openLayoutId: ids.layout, openLayout: 'Home' });
  store.applyDesign([{ op: 'setFileOptions', openLayout: null, onLastWindowClose: null }]);
  assert.equal(store.schema.fileOptions, undefined);
  assert.throws(() => store.applyDesign([{ op: 'setFileOptions', onFirstWindowOpen: 'Nope' }]), /Script "Nope" is missing/);
  store.applyDesign([{ op: 'setFileOptions', onWindowOpen: ids.script, onWindowClose: 'Startup' }]);
  assert.deepEqual(store.schema.fileOptions, { onWindowOpen: { scriptId: ids.script, script: 'Startup' }, onWindowClose: { scriptId: ids.script, script: 'Startup' } });
  assert.throws(() => store.applyDesign([{ op: 'setFileOptions', onWindowClose: 'Nope' }]), /Script "Nope" is missing/);
  store.applyDesign([{ op: 'setFileOptions', onWindowOpen: null, onWindowClose: null }]);
  assert.equal(store.schema.fileOptions, undefined);
  store.close();
});

test('Manage Containers: base directories and fields stored externally (kept for FileMaker)', () => {
  const store = blank('Containers');
  store.applyDesign([
    { op: 'createTable', name: 'Docs', fields: [{ name: 'Title' }, { name: 'File', type: 'container' }] },
    { op: 'createContainerDirectory', path: 'Files/Attachments' },
  ]);
  assert.deepEqual(store.schema.containerDirectories, [{ id: 1, path: 'Files/Attachments/' }]);
  // The default (0) can be changed even though the file never listed it.
  store.applyDesign([{ op: 'updateContainerDirectory', directory: 0, path: 'Files/Containers/' }]);
  assert.deepEqual(store.schema.containerDirectories, [{ id: 0, path: 'Files/Containers/' }, { id: 1, path: 'Files/Attachments/' }]);
  store.applyDesign([
    { op: 'updateField', table: 'Docs', field: 'File', options: { externalStorage: { directory: 1, path: '"Docs/" & Title & "/"' } } },
    { op: 'createField', table: 'Docs', name: 'Scan', type: 'container', options: { externalStorage: { secure: true, fewerFolders: true } } },
  ]);
  const field = (n: string) => store.schema.tables[0].fields.find((f) => f.name === n)!;
  assert.deepEqual(field('File').options?.externalStorage, { directoryId: 1, path: '"Docs/" & Title & "/"' });
  assert.deepEqual(field('Scan').options?.externalStorage, { directoryId: 0, secure: true, fewerFolders: true });
  // Tabularius keeps the data in the database whatever the setting.
  const id = store.addContainer({ filename: 'a.txt', mime: 'text/plain', data: new TextEncoder().encode('hello') });
  assert.equal(new TextDecoder().decode(store.container(id)!.data), 'hello');

  assert.throws(() => store.applyDesign([{ op: 'deleteContainerDirectory', directory: 1 }]), /in use: Docs::File/);
  assert.throws(() => store.applyDesign([{ op: 'deleteContainerDirectory', directory: 0 }]), /default/);
  assert.throws(() => store.applyDesign([{ op: 'updateField', table: 'Docs', field: 'File', options: { externalStorage: { directory: 7, path: '"x/"' } } }]), /Base directory 7 is missing/);
  assert.throws(() => store.applyDesign([{ op: 'updateField', table: 'Docs', field: 'File', options: { externalStorage: { directory: 1 } } }]), /needs a path/);
  assert.throws(() => store.applyDesign([{ op: 'createContainerDirectory', path: '../outside' }]), /\.\./);
  // Turning it off, or making the field text, drops the setting; then the directory can go.
  store.applyDesign([{ op: 'updateField', table: 'Docs', field: 'File', type: 'text' }]);
  assert.equal(field('File').options?.externalStorage, undefined);
  store.applyDesign([{ op: 'updateField', table: 'Docs', field: 'Scan', options: { externalStorage: null } }, { op: 'deleteContainerDirectory', directory: 1 }]);
  assert.equal(field('Scan').options?.externalStorage, undefined);
  assert.deepEqual(store.schema.containerDirectories, [{ id: 0, path: 'Files/Containers/' }]);
  store.close();
});

test('external data sources: file references and ODBC entries, renamed in the steps that name them', () => {
  const store = blank('Sources');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createDataSource', name: 'Invoices', paths: ['File:Invoices', ' fmnet:/server/Invoices ', '', '$$InvoicesPath'] },
    { op: 'createDataSource', name: 'Warehouse', paths: ['odbc:WH'] },
    { op: 'createScript', name: 'Open', text: 'Open File [ “Invoices” ]' },
  ]);
  const [inv, wh] = store.schema.dataSources;
  assert.deepEqual(inv, { id: 1, name: 'Invoices', paths: ['file:Invoices', 'fmnet:/server/Invoices', ':$$InvoicesPath'] });
  assert.deepEqual(wh.paths, ['odbc:WH']);
  assert.equal(store.schema.scripts[0].steps[0].params?.dataSource?.id, inv.id);

  store.applyDesign([{ op: 'updateDataSource', dataSource: 'Invoices', name: 'Billing', paths: ['file:Billing'] }]);
  assert.equal(store.schema.dataSources[0].name, 'Billing');
  assert.equal(store.schema.scripts[0].steps[0].params?.dataSource?.name, 'Billing');
  assert.equal(scriptText(store.schema.scripts[0].steps), 'Open File [ “Billing” ]');

  for (const [paths, msg] of [[[], /needs a path/], [['Invoices'], /isn't a data source path/], [['odbc:A', 'file:B'], /one path/], [[':Name'], /needs a type/]] as const) {
    assert.throws(() => store.applyDesign([{ op: 'createDataSource', name: 'X', paths: [...paths] }]), msg);
  }
  assert.throws(() => store.applyDesign([{ op: 'createDataSource', name: 'billing', paths: ['file:x'] }]), /already/);
  assert.throws(() => store.applyDesign([{ op: 'deleteDataSource', dataSource: 'Billing' }]), /in use: script Open/);
  store.applyDesign([{ op: 'deleteScript', script: 'Open' }, { op: 'deleteDataSource', dataSource: 'Billing' }, { op: 'deleteDataSource', dataSource: 'Warehouse' }]);
  assert.deepEqual(store.schema.dataSources, []);
  store.close();
});

test('custom menus and menu sets: create, follow renames, delete', () => {
  const store = blank('Menus');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createScript', name: 'Go Home', steps: [] },
    { op: 'createCustomMenu', name: 'Tools', items: [
      { script: 'Go Home', title: '"Home"', parameter: 'T::A', shortcut: { key: 'h', modifiers: 4 } },
      { kind: 'separator' },
      { command: 'New Record' },
    ] },
    { op: 'createCustomMenu', name: 'Main', items: [{ submenu: 'Tools', title: '"Tools"' }] },
    { op: 'createMenuSet', name: 'Kiosk', menus: ['Main', 'Tools'] },
    { op: 'setDefaultMenuSet', menuSet: 'Kiosk' },
  ]);
  const [tools, main] = store.schema.customMenus;
  assert.deepEqual(tools.items[0], { kind: 'command', flags: 0x0b, title: '"Home"', scriptId: 1, script: 'Go Home', parameter: 'T::A', shortcut: { key: 'H', modifiers: 4 } });
  assert.deepEqual(tools.items[2], { kind: 'command', flags: 0, commandId: 0xc3ed, command: 'New Record' });
  const set = store.schema.customMenuSets[0];
  assert.equal(set.id, 2);
  assert.deepEqual(set.menuIds, [main.id, tools.id]);
  assert.equal(store.schema.defaultMenuSetId, set.id);

  store.applyDesign([
    { op: 'updateScript', script: 'Go Home', name: 'Start' },
    { op: 'updateField', table: 'T', field: 'A', name: 'B' },
    { op: 'updateCustomMenu', customMenu: 'Tools', name: 'Utilities' },
  ]);
  const [t2, m2] = store.schema.customMenus;
  assert.equal(t2.items[0].script, 'Start');
  assert.equal(t2.items[0].parameter, 'T::B');
  assert.equal(m2.items[0].submenu, 'Utilities');

  assert.throws(() => store.applyDesign([{ op: 'createCustomMenu', name: 'Bad', items: [{ command: 'Fly' }] }]), /Unknown menu command/);
  // Layout Setup's menu set: a set, FileMaker's standard menus (1), or the file's default (0 / none).
  store.applyDesign([{ op: 'createLayout', name: 'Kiosk Screen', occurrence: 'T' }, { op: 'updateLayout', layout: 'Kiosk Screen', design: { menuSetId: set.id } }]);
  const screen = () => store.designs().layouts.find((l) => l.name === 'Kiosk Screen')!;
  assert.equal(screen().menuSetId, set.id);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Kiosk Screen', design: { menuSetId: 99 } }]), /No menu set/);
  store.applyDesign([{ op: 'updateLayout', layout: 'Kiosk Screen', design: { menuSetId: 0 } }]);
  assert.equal(screen().menuSetId, undefined);
  store.applyDesign([{ op: 'updateLayout', layout: 'Kiosk Screen', design: { menuSetId: set.id } }]);
  store.applyDesign([{ op: 'deleteCustomMenu', customMenu: 'Utilities' }, { op: 'deleteMenuSet', menuSet: 'Kiosk' }]);
  assert.equal(screen().menuSetId, undefined);
  assert.deepEqual(store.schema.customMenus[0].items, []);
  assert.equal(store.schema.defaultMenuSetId, undefined);
  store.close();
});

test('deleted tables and fields can be restored, with their data and references', () => {
  const store = blank('Restore');
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'ID', type: 'number' }, { name: 'Name' }, { name: 'Age', type: 'number' }] },
    { op: 'createField', table: 'Contacts', name: 'Label', kind: 'calculation', calculation: 'Name & " (" & Age & ")"' },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'ContactID', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Orders', predicates: [{ left: 'ID', right: 'ContactID' }] },
    { op: 'createField', table: 'Contacts', name: 'Spent', kind: 'calculation', type: 'number', calculation: 'Sum ( Orders::Amount )', options: { unstored: true } },
    { op: 'createScript', name: 'Birthday', text: 'Set Field [ Contacts::Age ; Contacts::Age + 1 ]' },
  ]);
  const ada = store.create('Contacts', { ID: '1', Name: 'Ada', Age: '36' }).recordId;
  store.create('Orders', { ContactID: '1', Amount: '5' });
  store.create('Orders', { ContactID: '1', Amount: '7' });
  const ageId = store.schema.tables[0].fields.find((f) => f.name === 'Age')!.id;

  // Deleting a field keeps its data aside; formulas show it missing meanwhile.
  store.applyDesign([{ op: 'deleteField', table: 'Contacts', field: 'Age' }]);
  const label = () => store.schema.tables[0].fields.find((f) => f.name === 'Label')!.calculation;
  assert.match(label()!, /Field Missing/);
  assert.match(store.schema.scripts[0].steps[0].line!, /Field Missing/);
  const [gone] = store.deletedDesigns();
  assert.deepEqual({ kind: gone.kind, table: gone.table, name: gone.name, records: gone.records }, { kind: 'field', table: 'Contacts', name: 'Age', records: 1 });
  // Its id isn't given to a new field, so restoring brings back the same one.
  store.applyDesign([{ op: 'createField', table: 'Contacts', name: 'Note' }]);
  assert.notEqual(store.schema.tables[0].fields.find((f) => f.name === 'Note')!.id, ageId);
  const later = store.create('Contacts', { ID: '2', Name: 'Grace' }).recordId;

  store.applyDesign([{ op: 'restoreDeleted', deleted: gone.id }]);
  assert.equal(store.schema.tables[0].fields.find((f) => f.name === 'Age')!.id, ageId);
  assert.equal(label(), 'Name & " (" & Age & ")"');
  assert.equal(store.schema.scripts[0].steps[0].line, 'Set Field [ Contacts::Age ; Contacts::Age + 1 ]');
  assert.equal(store.get('Contacts', ada).fieldData.Age, 36);
  assert.equal(store.get('Contacts', ada).fieldData.Label, 'Ada (36)');
  assert.equal(store.get('Contacts', later).fieldData.Age, '');
  assert.deepEqual(store.deletedDesigns(), []);

  // A table: its occurrence, relationship and records come back.
  store.applyDesign([{ op: 'deleteTable', table: 'Orders' }]);
  assert.equal(store.schema.relationships.length, 0);
  assert.match(store.schema.tables[0].fields.find((f) => f.name === 'Spent')!.calculation!, /Table Missing/);
  const orders = store.deletedDesigns()[0];
  assert.deepEqual({ kind: orders.kind, name: orders.name, records: orders.records }, { kind: 'table', name: 'Orders', records: 2 });
  store.applyDesign([{ op: 'restoreDeleted', deleted: orders.id }]);
  assert.equal(store.schema.relationships.length, 1);
  assert.ok(store.schema.tableOccurrences.some((t) => t.name === 'Orders'));
  assert.equal(store.find('Orders').foundCount, 2);
  assert.equal(store.get('Contacts', ada).fieldData.Spent, 12);

  // A newer field with the same name has to be renamed first; emptied ones can't come back.
  store.applyDesign([{ op: 'deleteField', table: 'Contacts', field: 'Name' }, { op: 'createField', table: 'Contacts', name: 'Name' }]);
  const name = store.deletedDesigns()[0];
  assert.throws(() => store.applyDesign([{ op: 'restoreDeleted', deleted: name.id }]), (e: StoreError) => e.code === 960 && /rename it/.test(e.message));
  store.applyDesign([{ op: 'updateField', table: 'Contacts', field: 'Name', name: 'Name 2' }, { op: 'restoreDeleted', deleted: name.id }]);
  assert.equal(store.get('Contacts', ada).fieldData.Name, 'Ada');
  store.applyDesign([{ op: 'deleteField', table: 'Contacts', field: 'Note' }]);
  assert.equal(store.emptyDeleted(), 1);
  assert.throws(() => store.applyDesign([{ op: 'restoreDeleted', deleted: 99 }]), (e: StoreError) => e.code === 101);
});

test('themes and styles: copy a theme, change element defaults, create, rename and delete styles', () => {
  const store = blank('Themes');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createTheme', name: 'House' },
    { op: 'updateTheme', theme: 'House', defaults: { 61: [{ part: 1, state: 1, css: { 'background-color': 'rgb(255 255 255)', 'border-radius': '4px' } }] } },
    { op: 'createStyle', theme: 'House', name: 'Warning', element: 61, rules: [{ part: 1, state: 1, css: { 'background-color': '#fff3c4' } }] },
    { op: 'createTheme', name: 'House Dark', from: 'House' },
  ]);
  const [house, dark] = store.designs().themes;
  assert.deepEqual(dark.styles, house.styles);
  assert.notEqual(dark.id, house.id);
  assert.equal(house.defaults[61][0].css['border-radius'], '4px');

  // A layout using the theme, with a field in the Warning style.
  const design = structuredClone(store.design('T')!);
  design.themeId = house.id;
  const fieldObj = design.objects.find((o) => o.field)!;
  fieldObj.style = { element: 61, name: 'Warning' };
  store.applyDesign([{ op: 'updateLayout', layout: 'T', design }]);

  store.applyDesign([{ op: 'updateStyle', theme: 'House', style: 'Warning', name: 'Alert', rules: [{ part: 1, state: 1, css: { color: 'red' } }] }]);
  const field = () => store.design('T')!.objects.find((o) => o.field)!;
  assert.equal(field().style.name, 'Alert');
  assert.deepEqual(store.designs().themes[0].styles[0], { name: 'Alert', element: 61, rules: [{ part: 1, state: 1, css: { color: 'red' } }] });
  // The copy is its own theme: its style keeps the old name.
  assert.equal(store.designs().themes[1].styles[0].name, 'Warning');

  assert.throws(() => store.applyDesign([{ op: 'createStyle', theme: 'House', name: 'alert', element: 61 }]), (e: StoreError) => e.code === 504);
  assert.throws(() => store.applyDesign([{ op: 'updateStyle', theme: 'House', style: 'Alert', rules: [{ part: 1, state: 1, css: { color: 'red}body{display:none' } }] }]), (e: StoreError) => e.code === 960);
  assert.throws(() => store.applyDesign([{ op: 'deleteTheme', theme: 'House' }]), (e: StoreError) => e.code === 960 && /change their theme/.test(e.message));

  store.applyDesign([{ op: 'deleteStyle', theme: 'House', style: 'Alert' }, { op: 'deleteTheme', theme: 'House Dark' }]);
  assert.equal(field().style.name, undefined);
  assert.equal(field().style.element, 61);
  assert.deepEqual(store.designs().themes.map((t) => t.name), ['House']);
});

test('themes: import a theme exported from another file', () => {
  const a = blank('ThemeA');
  a.applyDesign([
    { op: 'createTheme', name: 'House' },
    { op: 'updateTheme', theme: 'House', defaults: { 61: [{ part: 1, state: 1, css: { 'border-radius': '4px' } }] } },
    { op: 'createStyle', theme: 'House', name: 'Warning', element: 61, rules: [{ part: 1, state: 1, css: { color: 'red' } }] },
  ]);
  const { defaults, styles, contextual } = a.designs().themes[0];
  a.close();
  const b = blank('ThemeB');
  b.applyDesign([{ op: 'createTheme', name: 'House', content: { defaults, styles, contextual } }]);
  const [t] = b.designs().themes;
  assert.deepEqual([t.defaults, t.styles], [defaults, styles]);
  // The log keeps the content, so the import replays without the other file.
  assert.deepEqual((b.designHistory(1)[0].op as { content?: unknown }).content, { defaults, styles });
  assert.throws(() => b.applyDesign([{ op: 'createTheme', name: 'Bad', content: { defaults: {}, styles: [{ name: 'X', rules: [{ part: 1, state: 1, css: { color: 'red}body{x:y' } }] }] } }]), /can't contain/);
  assert.throws(() => b.applyDesign([{ op: 'createTheme', name: 'Bad', content: { styles: [] } as never }]), /defaults and styles/);
  b.close();
});

test('Layout Setup options: views allowed, saving changes, field frames, record indicator', () => {
  const store = blank('Setup');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }, { op: 'createLayout', name: 'Rows', occurrence: 'T' }]);
  const rows = () => store.designs().layouts.find((l) => l.name === 'Rows')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Rows', design: { view: 'list', viewsAllowed: ['table', 'list'], saveRecordChanges: false, recordIndicator: false, fieldFrames: true } }]);
  assert.deepEqual(rows().viewsAllowed, ['list', 'table']);
  assert.equal(rows().saveRecordChanges, false);
  assert.equal(rows().recordIndicator, false);
  // FileMaker's defaults aren't stored: true (or all three views) clears an option.
  assert.equal('fieldFrames' in rows(), false);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Rows', design: { view: 'form', viewsAllowed: ['list'] } }]), /must allow it/);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Rows', design: { viewsAllowed: [] } }]), /one or more/);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Rows', design: { saveRecordChanges: 'no' as never } }]), /true or false/);
  const ddr = designReport(store.schema, store.designs(), { fileName: 'Setup.fmp12' });
  assert.match(ddr, /<Options showRecordIndicator="False" showFieldFramesCurrentRecord="True" showFieldFrames="False" saveRecord="False"\/>/);
  store.applyDesign([{ op: 'updateLayout', layout: 'Rows', design: { viewsAllowed: ['form', 'list', 'table'], saveRecordChanges: true, recordIndicator: true } }]);
  assert.equal(['viewsAllowed', 'saveRecordChanges', 'recordIndicator'].some((k) => k in rows()), false);
  store.close();
});

test('Layout Setup printing: columns and their order; one column or across first are the defaults', () => {
  const store = blank('Columns');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }, { op: 'createLayout', name: 'Labels', occurrence: 'T' }]);
  const labels = () => store.designs().layouts.find((l) => l.name === 'Labels')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Labels', design: { printColumns: { count: 3, order: 'down' } } }]);
  assert.deepEqual(labels().printColumns, { count: 3, order: 'down' });
  store.applyDesign([{ op: 'updateLayout', layout: 'Labels', design: { printColumns: { count: 2, order: 'across' } } }]);
  assert.deepEqual(labels().printColumns, { count: 2 });
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Labels', design: { printColumns: { count: 0 } } }]), /1 to 99 columns/);
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Labels', design: { printColumns: { count: 2, order: 'sideways' as never } } }]), /across first or down first/);
  store.applyDesign([{ op: 'updateLayout', layout: 'Labels', design: { printColumns: { count: 1 } } }]);
  assert.equal('printColumns' in labels(), false);
  store.close();
});

test('fixed page margins leave printable space when the file has page setup', () => {
  const store = blank('FixedMargins');
  store.applyDesign([{ op: 'createTable', name: 'T' }]);
  const margins = { top: 400, bottom: 400, left: 300, right: 300 };
  // Files without page setup retain the existing per-side validation.
  store.applyDesign([{ op: 'updateLayout', layout: 'T', design: { fixedMargins: margins } }]);
  store.schema.pageSetup = { orientation: 'portrait', width: 600, height: 800, margins: { top: 0, bottom: 0, left: 0, right: 0 } };
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'T', design: { fixedMargins: margins } }]), /leave room on the paper/);
  assert.throws(() => store.applyDesign([{ op: 'createLayout', name: 'T Copy', occurrence: 'T', design: { fixedMargins: margins } }]), /leave room on the paper/);
  store.applyDesign([{ op: 'updateLayout', layout: 'T', design: { fixedMargins: { top: 399.9, bottom: 400, left: 299.9, right: 300 } } }]);
  store.close();
});

test('value from last visited record: a new record copies the field from the record named', () => {
  const store = blank('LastVisited');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }, { name: 'City', options: { autoEnter: { lastVisited: true } } }] }]);
  const first = store.create('T', { Name: 'A', City: 'Leeds' }).recordId;
  const city = (id: number) => store.query(`SELECT City FROM T WHERE _fm_record_id = ${id}`)[0].City;
  assert.equal(city(store.create('T', {}, { lastVisited: first }).recordId), 'Leeds');
  assert.equal(city(store.create('T', {}).recordId), null);
  // A value typed for the new record wins.
  assert.equal(city(store.create('T', { City: 'York' }, { lastVisited: first }).recordId), 'York');
  store.close();
});

test('responsive settings: a stacking width on the layout and a hiding width on objects', () => {
  const store = blank('Responsive');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }, { op: 'createLayout', name: 'Phone', occurrence: 'T' }]);
  const phone = () => store.designs().layouts.find((l) => l.name === 'Phone')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Phone', design: { responsive: { stackBelow: 600 } } }]);
  assert.deepEqual(phone().responsive, { stackBelow: 600 });
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Phone', design: { responsive: { stackBelow: -1 } } }]), /stackBelow/);
  const objects = phone().objects.map((o, i) => (i === 0 ? { ...o, responsive: { hideBelow: 'wide' as never } } : o));
  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Phone', design: { objects } }]), /hideBelow/);
  // 0 is a choice (never stack this layout); no width at all is the server's default.
  store.applyDesign([{ op: 'updateLayout', layout: 'Phone', design: { responsive: { stackBelow: 0 } } }]);
  assert.deepEqual(phone().responsive, { stackBelow: 0 });
  store.applyDesign([{ op: 'updateLayout', layout: 'Phone', design: { responsive: {} } }]);
  assert.equal('responsive' in phone(), false);
  store.close();
});

test('a portal can add related records only when its relationship allows creation', () => {
  const s = blank('PortalCreate');
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }], rightCreate: true, leftCreate: false },
  ]);
  const occ = (name: string) => s.schema.tableOccurrences.find((t) => t.name === name)!.id;
  assert.equal(canCreateRelated(s, occ('Customers'), occ('Orders')), true);
  assert.equal(canCreateRelated(s, occ('Orders'), occ('Customers')), false);
  const rel = s.schema.relationships[0].id;
  s.applyDesign([{ op: 'updateRelationship', relationship: rel, rightCreate: false }]);
  assert.equal(canCreateRelated(s, occ('Customers'), occ('Orders')), false);
  s.close();
});

test('extended privileges: create, rename, delete, and the built-in/duplicate name guards', () => {
  const s = blank('ExtPriv');
  s.applyDesign([{ op: 'createExtendedPrivilege', name: 'cloud_sync' }]);
  assert.deepEqual(s.schema.extendedPrivileges.map((e) => e.name), ['fmapp', 'fmwebdirect', 'fmrest', 'cloud_sync']);

  // Can't collide with another catalog entry, or with one of Tabularius's own built-ins, on create or rename.
  assert.throws(() => s.applyDesign([{ op: 'createExtendedPrivilege', name: 'cloud_sync' }]), /already exists/);
  assert.throws(() => s.applyDesign([{ op: 'createExtendedPrivilege', name: 'fmrest' }]), /already exists/);
  assert.throws(() => s.applyDesign([{ op: 'updateExtendedPrivilege', extendedPrivilege: 'cloud_sync', name: 'fmxml' }]), /already exists/);
  // Renaming to its own name (just re-saving) is fine, not a collision with itself.
  s.applyDesign([{ op: 'updateExtendedPrivilege', extendedPrivilege: 'cloud_sync', name: 'cloud_sync' }]);

  s.applyDesign([{ op: 'updateExtendedPrivilege', extendedPrivilege: 'cloud_sync', name: 'cloud_sync_v2' }]);
  assert.deepEqual(s.schema.extendedPrivileges.map((e) => e.name), ['fmapp', 'fmwebdirect', 'fmrest', 'cloud_sync_v2']);

  s.applyDesign([{ op: 'deleteExtendedPrivilege', extendedPrivilege: 'cloud_sync_v2' }]);
  assert.deepEqual(s.schema.extendedPrivileges.map((e) => e.name), ['fmapp', 'fmwebdirect', 'fmrest']);
  assert.throws(() => s.applyDesign([{ op: 'deleteExtendedPrivilege', extendedPrivilege: 'cloud_sync_v2' }]), /missing/);
  s.close();
});

test('extended privileges: a catalog row already named like a built-in (a new file\'s starting catalog, or a real import) can\'t be renamed or deleted', () => {
  const s = blank('ExtPrivBuiltIn');
  // emptySchema() seeds fmapp/fmwebdirect/fmrest as real catalog rows, not just as Tabularius's hardcoded list — renaming or
  // deleting one of those rows would otherwise silently strip that grant from every non-full-access set (a lockout),
  // since Tabularius still treats the name as a built-in regardless of what the catalog says.
  assert.ok(s.schema.extendedPrivileges.some((e) => e.name === 'fmrest'));
  assert.throws(() => s.applyDesign([{ op: 'updateExtendedPrivilege', extendedPrivilege: 'fmrest', name: 'renamed' }]), /Tabularius's own extended privileges/);
  assert.throws(() => s.applyDesign([{ op: 'deleteExtendedPrivilege', extendedPrivilege: 'fmrest' }]), /Tabularius's own extended privileges/);
  assert.deepEqual(s.schema.extendedPrivileges.map((e) => e.name), ['fmapp', 'fmwebdirect', 'fmrest'], 'untouched');
  s.close();
});

test('extended privileges: renaming to a name already granted as a raw, uncataloged string doesn\'t duplicate it', () => {
  const s = blank('ExtPrivDupe');
  s.applyDesign([{ op: 'createExtendedPrivilege', name: 'cloud_sync' }]);
  // A grant that was never registered as its own catalog entry (an import, or a direct savePrivilegeSet) sitting
  // alongside the one we're about to rename into it.
  s.savePrivilegeSet({ name: 'Mixed', records: { view: true, edit: true, create: true, delete: true }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['cloud_sync', 'ad_hoc_undeclared'] });
  s.applyDesign([{ op: 'updateExtendedPrivilege', extendedPrivilege: 'cloud_sync', name: 'ad_hoc_undeclared' }]);
  assert.deepEqual(s.privilegeSet('Mixed')!.extendedPrivileges, ['ad_hoc_undeclared'], 'not listed twice');
  s.close();
});

// These synthetic decoded steps need no production solution file.
test('undecoded options stay visible through Design edits, copying, disabling and save/reopen', () => {
  const name = 'Undecoded Design';
  let store = blank(name);
  try {
    store.applyDesign([{ op: 'createScript', name: 'Imported', steps: [
      { name: 'Revert Transaction', params: { undecodedOptions: ['Condition', 'Error code'] }, line: 'Revert Transaction' },
      { name: 'Set Revert Transaction on Error', params: { undecodedOptions: ['On/Off'] }, line: 'Set Revert Transaction on Error [ Off ]' },
      { name: 'Import Records', params: { undecodedOptions: ['Import mode'], filePaths: ['data.csv'] }, line: 'Import Records [ Add ]' },
    ] }]);
    const shown = () => scriptText(store.schema.scripts.find((s) => s.name === 'Imported')!.steps);
    const original = shown();
    assert.match(original, /Undecoded options: Condition, Error code/);
    assert.match(original, /Undecoded options: On\/Off/);
    assert.match(original, /Mode: Undecoded/);
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: original.replace('data.csv', 'other.csv') + '\n# unrelated edit' }]);
    assert.match(shown(), /other.csv.*Mode: Undecoded/);
    store.applyDesign([{ op: 'createScript', name: 'Copied', text: shown() }]);
    assert.deepEqual(store.schema.scripts.find((s) => s.name === 'Copied')!.steps.slice(0, 3).map((s) => s.params?.undecodedOptions), [['Condition', 'Error code'], ['On/Off'], ['Import mode']]);
    const enabled = shown();
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: enabled.split('\n').map((line) => '// ' + line).join('\n') }]);
    assert.match(shown(), /\/\/ Import Records.*Mode: Undecoded/);
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: shown().replace(/^\/\/ /gm, '') }]);
    assert.equal(shown(), enabled);
    store.close();
    store = new Store(join(dir, `${name}.sqlite`), name);
    assert.equal(shown(), enabled, 'the warning remains after save and reopen');
    assert.throws(() => store.applyDesign([{ op: 'updateScript', script: 'Imported', text: shown().replace('Mode: Undecoded', 'Mode: Undecoded ; Add') }]), /Replace Mode: Undecoded/);
    // Even deleting the warning does not author the binary import's mode.
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: shown().replace(' ; Mode: Undecoded', '') }]);
    assert.match(shown(), /Mode: Undecoded/);
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: [
      'Revert Transaction [ Condition: 0 ; Error code: 5001 ; Error message: "stop" ]',
      'Set Revert Transaction on Error [ Off ]',
      'Import Records [ Source: "other.csv" ; Add ]',
    ].join('\n') }]);
    assert.doesNotMatch(shown(), /Undecoded/);
    assert.equal(store.schema.scripts.find((s) => s.name === 'Imported')!.steps[2].params?.importAction, 'add');
  } finally { store.close(); }
});

test('cached legacy transaction lines cannot hide unresolved retained formulas', () => {
  const store = blank('Legacy diagnostic');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Legacy', steps: [
      { name: 'Revert Transaction', stepId: 207, line: 'Revert Transaction', calculations: ['0'] },
      { name: 'Revert Transaction', params: { slots: { 129: '5001' } }, line: 'Revert Transaction' },
      { name: 'Set Revert Transaction on Error', line: 'Set Revert Transaction on Error [ Off ]' },
    ] }]);
    const steps = store.schema.scripts[0].steps;
    // Simulate stale metadata produced before diagnostic rendering existed.
    steps.forEach((s) => { s.line = s.name; });
    const text = scriptText(steps);
    assert.equal((text.match(/Undecoded options/g) ?? []).length, 3);
    const parsed = parseScriptText(text, store.schema, steps);
    assert.equal(parsed[0], steps[0], 'unchanged-step reuse compares the regenerated diagnostic');
    const fresh = parseScriptText(text, store.schema);
    assert.deepEqual(fresh.map((s) => s.params?.undecodedOptions), [['Option payloads'], ['Option payloads'], ['On/Off']]);
    store.applyDesign([{ op: 'createScript', name: 'No cached line', steps: [{ name: 'Revert Transaction', calculations: ['0'] }] }]);
    const noLine = store.schema.scripts[1].steps[0];
    assert.deepEqual(noLine.calculations, ['0']);
    assert.match(scriptText([noLine]), /Undecoded options/);
  } finally { store.close(); }
});

test('the binary import marker follows the step, not its position', () => {
  const store = blank('Marker provenance');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Imported', steps: [{ name: 'Import Records', params: { undecodedOptions: ['Import mode'], filePaths: ['data.csv'] } }] }]);
    const marks = () => store.schema.scripts[0].steps.map((s) => s.params?.undecodedOptions?.includes('Import mode') === true);
    const text = () => scriptText(store.schema.scripts[0].steps);
    // A step inserted above, with the diagnostic removed in the same edit: the mark moves down with its step.
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: `# note\n${text().replace(' ; Mode: Undecoded', '').replace('Mode: Undecoded', '')}` }]);
    assert.deepEqual(marks(), [false, true]);
    // A new authored import inserted above an untouched marked step does not take the mark.
    store.applyDesign([{ op: 'updateScript', script: 'Imported', text: `Import Records\n${text()}` }]);
    assert.deepEqual(marks(), [false, false, true]);
    // The same through structured edits.
    const specs = store.schema.scripts[0].steps.map((s) => ({ stepId: s.stepId, name: s.name, params: s.params, line: s.line, calculations: s.calculations }));
    store.applyDesign([{ op: 'updateScript', script: 'Imported', steps: [{ name: 'Import Records' }, ...specs] }]);
    assert.deepEqual(marks(), [false, false, false, true]);
  } finally { store.close(); }
});

test('structured Design edits retain the binary import marker until an explicit mode is authored', () => {
  const store = blank('Structured diagnostics');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Imported', steps: [{ name: 'Import Records', params: { undecodedOptions: ['Import mode'] } }] }]);
    store.applyDesign([{ op: 'updateScript', script: 'Imported', steps: [{ name: 'Import Records', params: { filePaths: ['changed.csv'] } }] }]);
    assert.match(scriptText(store.schema.scripts[0].steps), /Mode: Undecoded/);
    store.applyDesign([{ op: 'updateScript', script: 'Imported', steps: [{ name: 'Import Records', params: { filePaths: ['changed.csv'], importAction: 'replace' } }] }]);
    assert.doesNotMatch(scriptText(store.schema.scripts[0].steps), /Undecoded/);
    store.applyDesign([{ op: 'createScript', name: 'Authored', text: 'Import Records' }]);
    assert.equal(scriptText(store.schema.scripts[1].steps), 'Import Records', 'new authored imports retain implicit Add');
  } finally { store.close(); }
});

// Modernize interfaces (server/src/modernize.ts): layouts made from templates beside a file's own, with nothing
// touched that was already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { modernPage } from '../../web/src/page-source.ts';
import { modernizeChange } from '../src/modernize.ts';
import { draftLayoutChange, ordersBefore, previewDesign, undoChanges } from '../src/design-preview.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-modernize-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      fn(store);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function shop(store: Store): void {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'CustomerID' }, { name: 'Name' }, { name: 'City' }, { name: 'Notes' }, { name: 'Active', type: 'number' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'CustomerID' }, { name: 'Status' }, { name: 'Due', type: 'date' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'CustomerTags', fields: [{ name: 'CustomerID' }, { name: 'TagID' }] },
  ] as DesignOp[], { account: 'Admin' });
  store.applyDesign([
    { op: 'createRelationship', left: 'Customers', right: 'Invoices', predicates: [{ left: 'CustomerID', right: 'CustomerID' }] },
  ] as DesignOp[], { account: 'Admin' });
}

test('modernize: each table gets modern and classic layouts, join tables get none, and the result applies cleanly', () => withStore((store) => {
  shop(store);
  const before = store.schema.layouts.map((l) => l.name);
  const r = modernizeChange(store);
  assert.deepEqual(r.layouts.filter((l) => l.table === 'Invoices').map((l) => l.name), [
    'Invoices - Modern list', 'Invoices - Modern detail', 'Invoices - Modern list and detail', 'Invoices - Classic list', 'Invoices - Classic form',
  ]);
  assert.ok(r.skipped.some((s) => s.table === 'CustomerTags' && /join table/.test(s.why)));
  assert.ok(!r.layouts.some((l) => l.table === 'CustomerTags'));

  // The modern pages are real modern layouts: one web viewer with a page that parses, and the form reads Invoices as related records.
  const create = r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[];
  const detail = create.find((c) => c.name === 'Customers - Modern detail')!;
  const page = modernPage(detail.design.objects)!.html;
  assert.doesNotThrow(() => new Function(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')).replace('__PLAN__', '{}')));
  assert.match(page, /"layout":"Invoices - Modern list"/);
  assert.match(page, /"local":"CustomerID","remote":"CustomerID"/);

  // Check finds nothing serious on any of them, and applying adds exactly these layouts, in a folder.
  const issues = previewDesign(store, r.changes).layouts?.flatMap((l) => l.issues.filter((i) => i.severity === 'error')) ?? [];
  assert.deepEqual(issues, []);
  store.applyDesign(r.changes, { account: 'Admin' });
  const after = store.schema.layouts.map((l) => l.name);
  assert.deepEqual(after.filter((n) => !before.includes(n)).sort(), r.layouts.map((l) => l.name).sort());
  assert.ok(before.every((n) => after.includes(n)), 'the file\'s own layouts are still there');
  assert.ok(store.schema.layoutOrder.some((o) => o.kind === 'folder' && o.name === 'Modernized interfaces'));

  // Asking again adds nothing: every layout is already there.
  const again = modernizeChange(store);
  assert.equal(again.layouts.length, 0);
  assert.equal(again.changes.length, 0);
  assert.ok(again.skipped.some((s) => s.style === 'modern-list' && /already a layout/.test(s.why)));
}));

test('modernize: tables and styles can be picked, and wrong names are refused', () => withStore((store) => {
  shop(store);
  const r = modernizeChange(store, { tables: ['invoices'], styles: ['modern-split'], folder: false });
  assert.deepEqual(r.layouts.map((l) => l.name), ['Invoices - Modern list and detail']);
  assert.ok(!r.changes.some((c) => c.op === 'setOrder'));
  assert.throws(() => modernizeChange(store, { tables: ['Nope'] }), /no table "Nope"/);
  assert.throws(() => modernizeChange(store, { styles: ['fancy'] }), /no style "fancy"/);
}));

test('modernize: Undo takes back the layouts and the folder, leaving the layout list as it was', () => withStore((store) => {
  shop(store);
  const names = store.schema.layouts.map((l) => l.name);
  const r = modernizeChange(store);
  const orders = ordersBefore(store, r.changes);
  const { applied } = store.applyDesign(r.changes, { account: 'Admin' });
  const undo = undoChanges(applied, undefined, orders);
  assert.ok(undo, 'a change that creates layouts and sets their order can be undone');
  store.applyDesign(undo!, { account: 'Admin' });
  assert.deepEqual(store.schema.layouts.map((l) => l.name), names);
  assert.deepEqual(store.schema.layoutOrder.map((o) => [o.kind, o.name]), names.map((n) => ['item', n]), 'no folder is left behind');
}));

test('modernize: fromLayouts makes a modern list and detail from each layout of the file, with the fields it shows in its order', () => withStore((store) => {
  shop(store);
  // A layout that shows some of Customers' fields in an order of its own, and one with only a global field.
  const draft = draftLayoutChange(store, { name: 'Customer card', occurrence: 'Customers', view: 'form', fields: ['City', 'Name', 'Notes'] });
  store.applyDesign(draft.changes, { account: 'Admin' });

  const plain = modernizeChange(store, { styles: ['modern-list'], tables: ['Customers'] });
  assert.ok(!plain.layouts.some((l) => /Customer card/.test(l.name)), 'not unless asked for');

  const r = modernizeChange(store, { styles: [], fromLayouts: true });
  const made = r.layouts.find((l) => l.name === 'Customer card - Modern')!;
  assert.ok(made, JSON.stringify(r.layouts.map((l) => l.name)));
  assert.equal(made.table, 'Customers');
  assert.match(made.notes[0], /Made from the layout "Customer card": 3 fields in the order it shows them/);
  assert.equal(made.notes[1], 'Columns: City, Name, Notes.');
  const layout = (r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; occurrence: number; design: { objects: never[] } }[]).find((c) => c.name === 'Customer card - Modern')!;
  const page = modernPage(layout.design.objects)!.html;
  assert.doesNotThrow(() => new Function(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')).replace('__PLAN__', '{}')));
  assert.match(page, /"fields":\[\{"name":"City"[^]*"name":"Name"[^]*"name":"Notes"/);

  // Applies cleanly, and asking again adds nothing; a modern page is not itself followed.
  store.applyDesign(r.changes, { account: 'Admin' });
  assert.ok(store.schema.layouts.some((l) => l.name === 'Customer card - Modern'));
  const again = modernizeChange(store, { styles: [], fromLayouts: true });
  assert.deepEqual(again.layouts, []);
  assert.ok(again.skipped.some((s) => /already a layout "Customer card - Modern"/.test(s.why)));
  assert.ok(!again.skipped.some((s) => /Modern - Modern/.test(s.why)));

  // Only the tables asked for.
  assert.deepEqual(modernizeChange(store, { styles: [], fromLayouts: true, tables: ['Invoices'] }).layouts, []);
  assert.throws(() => modernizeChange(store, { fromLayouts: 'yes' }), /fromLayouts is true or false/);
  assert.throws(() => modernizeChange(store, { styles: [] }), /styles is a list/);
}));

test('modernize: fromLayouts keeps a layout\'s portals as related records under the form, read through a layout that can be reached', () => withStore((store) => {
  shop(store);
  const draft = draftLayoutChange(store, {
    name: 'Customer card', occurrence: 'Customers', view: 'form', fields: ['Name', 'City'],
    portals: [{ occurrence: 'Invoices', fields: ['Number', 'Status', 'Amount'], rows: 5 }],
  });
  store.applyDesign(draft.changes, { account: 'Admin' });
  const pageOf = (r: ReturnType<typeof modernizeChange>) => {
    const layout = (r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[]).find((c) => c.name === 'Customer card - Modern')!;
    return modernPage(layout.design.objects)!.html;
  };

  // With the file's own layout on Invoices to read through, the portal's columns are kept.
  const alone = modernizeChange(store, { styles: [], fromLayouts: true });
  const page = pageOf(alone);
  assert.match(page, /"related":\[\{"label":"Invoices","layout":"[^"]+","local":"CustomerID","remote":"CustomerID","columns":\["Number","Status","Amount"\]\}\]/);
  assert.ok(alone.layouts.find((l) => l.name === 'Customer card - Modern')!.notes.some((n) => /Related records under the form, from the layout's portals: Invoices/.test(n)));

  // When the Invoices modern list is made in the same run, the page reads through that.
  const both = modernizeChange(store, { styles: ['modern-list'], fromLayouts: true });
  assert.match(pageOf(both), /"layout":"Invoices - Modern list"/);

  // The result is a real change: it applies cleanly.
  store.applyDesign(both.changes, { account: 'Admin' });
  assert.ok(store.schema.layouts.some((l) => l.name === 'Customer card - Modern'));
}));

test('modernize: the board and calendar are made only when asked for, from tables that have a status or a date', () => withStore((store) => {
  shop(store);
  // Invoices has Status and Due; Customers has neither a stage nor a date.
  const plain = modernizeChange(store);
  assert.ok(!plain.layouts.some((l) => /board|calendar/i.test(l.name)), 'not unless asked for');
  const r = modernizeChange(store, { styles: ['modern-board', 'modern-calendar'] });
  assert.deepEqual(r.layouts.map((l) => l.name), ['Invoices - Modern board', 'Invoices - Modern calendar']);
  assert.match(r.layouts[0].notes[0], /Columns by Status \(one for each value the records hold\)/);
  assert.match(r.layouts[1].notes[0], /Records placed by Due/);
  assert.ok(r.skipped.some((s) => s.table === 'Customers' && s.style === 'modern-board' && /status or stage/.test(s.why)));
  assert.ok(r.skipped.some((s) => s.table === 'Customers' && s.style === 'modern-calendar' && /date field/.test(s.why)));
  const create = r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[];
  const page = modernPage(create.find((c) => c.name === 'Invoices - Modern calendar')!.design.objects)!.html;
  assert.match(page, /"view":"calendar"/);
  const issues = previewDesign(store, r.changes).layouts?.flatMap((l) => l.issues.filter((i) => i.severity === 'error')) ?? [];
  assert.deepEqual(issues, []);
  store.applyDesign(r.changes, { account: 'Admin' });
  assert.ok(store.schema.layouts.some((l) => l.name === 'Invoices - Modern board'));
}));

test('modernize: a field validated by a value list becomes a pop-up that names the list, whatever kind of list it is', () => withStore((store) => {
  shop(store);
  store.applyDesign([
    { op: 'createValueList', name: 'Statuses', values: ['Open', 'Paid'] },
    { op: 'createValueList', name: 'Cities', field: { occurrence: 'Customers', field: 'City' } },
    { op: 'updateField', table: 'Invoices', field: 'Status', options: { validation: { valueList: 'Statuses' } } },
    { op: 'updateField', table: 'Customers', field: 'City', options: { validation: { valueList: 'Cities' } } },
  ] as DesignOp[], { account: 'Admin' });
  const create = modernizeChange(store).changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[];
  const page = (name: string) => modernPage(create.find((c) => c.name === name)!.design.objects)!.html;
  assert.match(page('Invoices - Modern detail'), /"name":"Status","label":"Status","control":"select","options":\["Open","Paid"\],"list":"Statuses"/);
  // A list taken from a field has no values in the design to bake into the page; the page reads it from the file.
  assert.match(page('Customers - Modern detail'), /"name":"City","label":"City","control":"select","list":"Cities"/);
}));

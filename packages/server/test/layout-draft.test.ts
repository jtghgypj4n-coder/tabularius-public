import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, lintLayout, Store, type DesignOp } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { draftLayoutChange, previewDesign, undoChanges } from '../src/design-preview.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-draft-'));
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

const css = (o: LayoutObject | undefined) => o?.style.rules?.[0]?.css ?? {};

/** A file whose layouts have a look of their own: yellow fields, a red title and a brand bar component in the header. */
function shop(store: Store): void {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'Customer' }, { name: 'Status' }, { name: 'Due', type: 'date' }, { name: 'Amount', type: 'number' }] },
  ] as DesignOp[], { account: 'Admin' });
  const customers = store.design('Customers')!;
  const header = customers.parts.find((p) => p.kind === 'header')!;
  // Everything moves down 30 points to make room for the brand bar at the top of the header.
  const objects: LayoutObject[] = customers.objects.map((o) => ({
    ...o, bounds: { ...o.bounds, top: o.bounds.top + 30, bottom: o.bounds.bottom + 30 },
    style: { ...o.style, rules: o.kind === 'field' ? [{ part: 1, state: 1, css: { 'background-color': '#fef3c7' } }]
      : o.bounds.top < header.height ? [{ part: 1, state: 1, css: { color: '#b42318', 'font-size': '24px' } }] : o.style.rules },
  }));
  const bar: LayoutObject = { id: 900, kind: 'text', type: 2, bounds: { top: 4, left: 20, bottom: 24, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, text: 'Acme Co' };
  const parts = customers.parts.map((p) => (p.kind === 'header' ? { ...p, height: p.height + 30 } : { ...p, top: p.top + 30 }));
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [bar, ...objects], parts } }] as DesignOp[], { account: 'Admin' });
  store.applyDesign([{ op: 'createComponent', name: 'Brand bar', layout: 'Customers', objectIds: [900] }] as DesignOp[], { account: 'Admin' });
}

test('draft layout: a list of open invoices with a total, matching the file', () => withStore((store) => {
  shop(store);
  const { changes, notes, layout } = draftLayoutChange(store, {
    name: 'Open Invoices', occurrence: 'invoices', fields: ['Number', 'Customer', 'Due', 'Amount'], totals: ['Amount'],
    find: { Status: 'Open' }, sort: ['Due'], like: 'Customers',
  });
  assert.equal(layout, 'Open Invoices');
  assert.deepEqual(changes.map((c) => c.op), ['createField', 'createLayout', 'createScript']);
  assert.ok(notes.some((n) => /"Brand bar" component in the header/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /Total Amount in a grand summary/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /"Show Open Invoices" script .* finds the records where Status is Open, sorted by Due/.test(n)), notes.join('\n'));

  // Check runs on the draft before anything is applied, and finds nothing serious.
  const preview = previewDesign(store, changes);
  const drafted = preview.layouts?.find((l) => l.name === 'Open Invoices');
  assert.ok(drafted, 'drawn as a picture');
  assert.deepEqual(drafted.issues.filter((i) => i.severity !== 'info').map((i) => i.message), []);
  assert.ok(!store.schema.layouts.some((l) => l.name === 'Open Invoices'), 'nothing applied yet');

  const { applied } = store.applyDesign(changes, { account: 'Admin' });
  const d = store.design('Open Invoices')!;
  assert.equal(d.view, 'list');
  const parts = d.parts.map((p) => p.kind);
  assert.deepEqual(parts, ['header', 'body', 'trailing-grand-summary', 'footer']);
  // Fields styled as on Customers, the title too.
  const fields = d.objects.filter((o) => o.kind === 'field' && o.bounds.top < d.parts[2].top);
  assert.deepEqual(fields.map((o) => o.field?.field), ['Number', 'Customer', 'Due', 'Amount']);
  for (const f of fields) assert.equal(css(f)['background-color'], '#fef3c7');
  const title = d.objects.find((o) => o.text === 'Open Invoices')!;
  assert.equal(css(title).color, '#b42318');
  // The brand bar sits at the top of the header, as on Customers, with the title below it.
  const copy = d.objects.find((o) => o.component)!;
  assert.equal(copy.bounds.top, 4);
  assert.equal(copy.children?.[0].text, 'Acme Co');
  assert.ok(title.bounds.top >= copy.bounds.bottom);
  // The total sits in the grand summary, under the Amount column.
  const summary = d.parts[2];
  const total = d.objects.find((o) => o.field?.field === 'Total Amount')!;
  const amount = fields.find((o) => o.field?.field === 'Amount')!;
  assert.ok(total.bounds.top >= summary.top && total.bounds.bottom <= summary.top + summary.height);
  assert.equal(total.bounds.left, amount.bounds.left);
  const invoices = store.schema.tables.find((t) => t.name === 'Invoices')!;
  assert.equal(invoices.fields.find((f) => f.name === 'Total Amount')?.kind, 'summary');
  const script = store.schema.scripts.find((s) => s.name === 'Show Open Invoices');
  assert.ok(script && script.steps.length >= 5, 'the find script is made');

  // Undo takes it all back.
  store.applyDesign(undoChanges(applied)!, { account: 'Admin' });
  assert.ok(!store.schema.layouts.some((l) => l.name === 'Open Invoices'));
  assert.ok(!store.schema.tables.find((t) => t.name === 'Invoices')!.fields.some((f) => f.name === 'Total Amount'));
  assert.ok(!store.schema.scripts.some((s) => s.name === 'Show Open Invoices'));
}));

test('draft layout: without like it follows the whole file, and an existing total is reused', () => withStore((store) => {
  shop(store);
  store.applyDesign([{ op: 'createField', table: 'Invoices', name: 'Sum of Amount', kind: 'summary', summary: { type: 'total', field: 'Amount' } }] as DesignOp[], { account: 'Admin' });
  const { changes, notes } = draftLayoutChange(store, { name: 'Invoice list', occurrence: 'Invoices', totals: ['Amount'] });
  assert.deepEqual(changes.map((c) => c.op), ['createLayout'], 'no new summary field');
  assert.ok(notes.some((n) => /Sum of Amount in a grand summary/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /most often are on the file's/.test(n)), notes.join('\n'));
  const form = draftLayoutChange(store, { name: 'Invoice card', occurrence: 'Invoices', view: 'form' });
  store.applyDesign(form.changes, { account: 'Admin' });
  const d = store.design('Invoice card')!;
  assert.equal(d.view, 'form');
  assert.ok(d.objects.some((o) => o.component), 'the header component is placed on forms too');
}));

test('draft layout: requests that cannot work say why', () => withStore((store) => {
  shop(store);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Nope' }), /No table occurrence "Nope"[^]*Customers, Invoices/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', fields: ['Price'] }), /Invoices has no field "Price"; its fields: Number/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', totals: ['Status'] }), /Only number fields can be totalled; Status is text/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', view: 'form', totals: ['Amount'] }), /Totals go on a list layout/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', like: 'Nowhere' }), /No layout "Nowhere"/);
  assert.throws(() => draftLayoutChange(store, { name: ' ', occurrence: 'Invoices' }), /Give the layout a name/);
}));

test('draft layout: an invoice entry form with a line items portal and its total, tidied by Check before it\'s shown', () => withStore((store) => {
  shop(store);
  store.applyDesign([
    { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceNumber' }, { name: 'Item' }, { name: 'Qty', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Number', right: 'InvoiceNumber' }] },
  ] as DesignOp[], { account: 'Admin' });
  const { changes, notes } = draftLayoutChange(store, {
    name: 'Invoice Entry', occurrence: 'Invoices', view: 'form', fields: ['Number', 'Customer', 'Due'],
    portals: [{ occurrence: 'Lines', fields: ['Item', 'Qty', 'Amount'], rows: 6, totals: ['Amount'] }],
  });
  assert.deepEqual(changes.map((c) => c.op), ['createField', 'createLayout']);
  assert.deepEqual(changes[0], { ...changes[0], name: 'Total Amount', kind: 'calculation', calculation: 'Sum ( Lines::Amount )' });
  assert.ok(notes.some((n) => /A portal of Lines \(6 rows: Item, Qty, Amount\), with Total Amount under it/.test(n)), notes.join('\n'));
  const design = (changes[1] as unknown as { design: { objects: LayoutObject[] } }).design;
  const portal = design.objects.find((o) => o.kind === 'portal')!;
  assert.equal(portal.portal!.rows, 6);
  assert.deepEqual(portal.children!.map((c) => c.field!.field), ['Item', 'Qty', 'Amount']);
  const total = design.objects.find((o) => o.field?.field === 'Total Amount')!;
  const amount = portal.children![2];
  assert.ok(total.bounds.top >= portal.bounds.bottom, 'under the portal');
  assert.equal(total.bounds.left, amount.bounds.left, 'under its column');

  const preview = previewDesign(store, changes);
  assert.deepEqual(preview.layouts![0].issues.filter((i) => i.fixable), [], 'nothing left for Fix');
  store.applyDesign(changes, { account: 'Admin' });
  assert.ok(store.design('Invoice Entry'));

  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', view: 'form', portals: [{ occurrence: 'Customers' }] }), /Customers isn't related to Invoices.*related occurrences: Lines/);
}));

test('draft layout: a plain form leaves nothing for Check to fix', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }, { name: 'Body' }] }] as DesignOp[], { account: 'Admin' });
  const { changes, notes } = draftLayoutChange(store, { name: 'Note card', occurrence: 'Notes', view: 'form' });
  const design = (changes.at(-1) as unknown as { design: Record<string, unknown> }).design;
  const whole = { id: 0, name: 'Note card', tableOccurrenceId: store.schema.tableOccurrences[0].id, ...design } as never;
  assert.deepEqual(lintLayout(whole, store.schema).filter((i) => i.fixable), [], notes.join('\n'));
}));

test('draft layout portals: totals work from the layout\'s occurrence, sit under shown columns with labels that fit, and aren\'t made twice', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'Inv' }, { name: 'Item' }, { name: 'Amount', type: 'number' }] },
    { op: 'createOccurrence', name: 'Invoice context', table: 'Invoices' },
    { op: 'createOccurrence', name: 'Lines of Inv', table: 'Lines' },
    { op: 'createRelationship', left: 'Invoice context', right: 'Lines of Inv', predicates: [{ left: 'Number', right: 'Inv' }] },
  ] as DesignOp[], { account: 'Admin' });
  // Related only through the second occurrence: the total must be worked out from there.
  const { changes } = draftLayoutChange(store, {
    name: 'Entry', occurrence: 'Invoice context', view: 'form', fields: ['Number'],
    portals: [{ occurrence: 'Lines of Inv', fields: ['Amount'], totals: ['Amount', 'Amount'] }, { occurrence: 'Lines of Inv', fields: ['Item'], totals: ['Amount'] }],
  });
  assert.equal(changes.filter((c) => c.op === 'createField').length, 1, 'one Total Amount for the same sum');
  store.applyDesign(changes, { account: 'Admin' });
  const r = store.create('Invoices', { Number: '1' });
  store.create('Lines', { Inv: '1', Amount: '3' });
  store.create('Lines', { Inv: '1', Amount: '4' });
  assert.equal(store.get('Invoices', r.recordId).fieldData['Total Amount'], 7);

  const design = store.design('Entry')!;
  const portals = design.objects.filter((o) => o.kind === 'portal');
  assert.deepEqual(portals[1].children!.map((c) => c.field!.field), ['Item', 'Amount'], 'a totalled column is shown');
  for (const p of portals) {
    const amount = p.children!.find((c) => c.field!.field === 'Amount')!;
    const total = design.objects.find((o) => o.field?.field === 'Total Amount' && o.bounds.top >= p.bounds.bottom && o.bounds.top < p.bounds.bottom + 40)!;
    assert.equal(total.bounds.left, amount.bounds.left, 'under its own column');
  }
  for (const o of design.objects) assert.ok(o.bounds.right > o.bounds.left, `${o.kind} ${o.text ?? ''} has a width`);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoice context', view: 'form', portals: 'Lines of Inv' }), /portals is a list/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoice context', view: 'form', portals: [{ occurrence: 'Lines of Inv', fields: ['Invoices::Number'] }] }), /isn't a field of Lines of Inv/);
}));

test('draft layout from a picture: real fields where the picture shows them, styled like the file, one Undo', () => withStore((store) => {
  shop(store);
  store.applyDesign([
    { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceNumber' }, { name: 'Item' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Number', right: 'InvoiceNumber' }] },
  ] as DesignOp[], { account: 'Admin' });
  // As a model reads a screenshot: a title bar, two labelled fields side by side, a line items table, a button.
  const arrangement = {
    width: 601,
    parts: [{ kind: 'body', height: 300 }, { kind: 'header', height: 51 }],
    objects: [
      { kind: 'title', part: 1, left: 19, top: 11, width: 300, height: 27, text: 'Invoice' },
      { kind: 'label', part: 0, left: 20, top: 21, width: 80, height: 19, text: 'Number' },
      { kind: 'field', part: 0, left: 103, top: 20, width: 151, height: 21, field: 'Number' },
      { kind: 'label', part: 0, left: 300, top: 21, width: 80, height: 19, text: 'Customer' },
      { kind: 'field', part: 0, left: 383, top: 20, width: 200, height: 21, field: 'Invoices::Customer' },
      { kind: 'portal', part: 0, left: 20, top: 70, width: 560, height: 150, portal: { occurrence: 'Lines', fields: ['Item', 'Amount'], rows: 6 } },
      { kind: 'button', part: 0, left: 480, top: 260, width: 100, height: 24, text: 'Print' },
      // Past the layout's right edge and the header's bottom: it's kept inside.
      { kind: 'field', part: 1, left: 590, top: 40, width: 100, height: 40, field: 'Due' },
    ],
  };
  const { changes, notes } = draftLayoutChange(store, { name: 'Invoice from picture', occurrence: 'Invoices', view: 'form', like: 'Customers', arrangement });
  assert.deepEqual(changes.map((c) => c.op), ['createLayout']);
  assert.ok(notes.some((n) => /Arranged as the picture shows it/.test(n)) && notes.some((n) => /3 fields, 2 labels, 1 button, 1 portal/.test(n)), notes.join('\n'));
  const preview = previewDesign(store, changes);
  assert.ok(preview.layouts?.some((l) => l.name === 'Invoice from picture'), 'drawn with Check before anything is applied');
  const { applied } = store.applyDesign(changes, { account: 'Admin' });
  const d = store.design('Invoice from picture')!;
  // Header first, then body, whatever order the picture listed them in.
  assert.deepEqual(d.parts.map((p) => [p.kind, p.top, p.height]), [['header', 0, 52], ['body', 52, 300]]);
  const number = d.objects.find((o) => o.field?.field === 'Number')!;
  assert.deepEqual(number.bounds, { top: 52 + 20, left: 104, bottom: 52 + 42, right: 256 });
  assert.equal(css(number)['background-color'], '#fef3c7', 'styled like the file\'s fields');
  const due = d.objects.find((o) => o.field?.field === 'Due')!;
  assert.deepEqual(due.bounds, { top: 12, left: d.width! - 100, bottom: 52, right: d.width! });
  const portal = d.objects.find((o) => o.kind === 'portal')!;
  assert.deepEqual(portal.children?.map((c) => c.field?.field), ['Item', 'Amount']);
  assert.ok(d.objects.some((o) => o.kind === 'button' && o.text === 'Print'));
  store.applyDesign(undoChanges(applied)!, { account: 'Admin' });
  assert.ok(!store.schema.layouts.some((l) => l.name === 'Invoice from picture'));
}));

test('draft layout from a picture: names that aren\'t the file\'s come back with what is', () => withStore((store) => {
  shop(store);
  const one = (o: Record<string, unknown>) => ({ width: 400, parts: [{ kind: 'body', height: 100 }], objects: [{ part: 0, left: 0, top: 0, width: 50, height: 20, ...o }] });
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: one({ kind: 'field', field: 'Total' }) }), /Invoices has no field "Total"; its fields: Number/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: one({ kind: 'field', field: 'Customers::Name' }) }), /Customers isn't related to Invoices/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: one({ kind: 'field', part: 3, field: 'Number' }) }), /part is an index into parts/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: one({ kind: 'sticker' }) }), /kind is one of field, label/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: { width: 400, parts: [{ kind: 'header', height: 50 }], objects: [] } }), /needs a body part/);
  // From the second-opinion review: totals and portals are left to the arrangement; portal columns name the portal's occurrence and fit inside it.
  store.applyDesign([
    { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceNumber' }, { name: 'Number' }, ...Array.from({ length: 21 }, (_, i) => ({ name: `C${i}` }))] },
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Number', right: 'InvoiceNumber' }] },
  ] as DesignOp[], { account: 'Admin' });
  const withTotals = draftLayoutChange(store, { name: 'T', occurrence: 'Invoices', totals: ['Amount'], portals: [{ occurrence: 'Lines', totals: ['Number'] }], arrangement: one({ kind: 'field', field: 'Number' }) });
  assert.deepEqual(withTotals.changes.map((c) => c.op), ['createLayout']);
  const portal = (fields: string[], width = 100, height = 60) => one({ kind: 'portal', width, height, portal: { occurrence: 'Lines', fields } });
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: portal(['Invoices::Number']) }), /"Invoices::Number" isn't a field of Lines/);
  assert.throws(() => draftLayoutChange(store, { name: 'X', occurrence: 'Invoices', arrangement: portal(Array.from({ length: 21 }, (_, i) => `C${i}`)) }), /at most 20 columns/);
  const narrow = draftLayoutChange(store, { name: 'N', occurrence: 'Invoices', arrangement: portal(Array.from({ length: 20 }, (_, i) => `C${i}`), 100, 4) });
  const made = (narrow.changes.at(-1) as unknown as { design: { objects: LayoutObject[] } }).design.objects.find((o) => o.kind === 'portal')!;
  for (const c of made.children!) assert.ok(c.bounds.right <= made.bounds.right && c.bounds.bottom <= made.bounds.bottom && c.bounds.left < c.bounds.right, JSON.stringify([c.bounds, made.bounds]));
}));

test('draft report: monthly sales by region with a chart, the totals only, sorted so the groups show, and undone in one go', () => withStore((store) => {
  shop(store);
  store.applyDesign([{ op: 'createField', table: 'Invoices', name: 'Region' }] as DesignOp[], { account: 'Admin' });
  const { changes, notes } = draftLayoutChange(store, {
    name: 'Sales by Region', occurrence: 'Invoices', groups: ['Region', { field: 'Due', by: 'month' }], totals: ['Amount'], summaryOnly: true,
    chart: { type: 'column', value: 'Amount' },
  });
  assert.deepEqual(changes.map((c) => c.op), ['createField', 'createField', 'createLayout', 'createScript']);
  assert.ok(notes.some((n) => /Grouped by Region, then Due Month/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /column chart of Total Amount by Region/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /sorted by Region, Due Month/.test(n)), notes.join('\n'));
  const preview = previewDesign(store, changes);
  assert.deepEqual(preview.layouts?.find((l) => l.name === 'Sales by Region')?.issues.filter((i) => i.severity !== 'info').map((i) => i.message), []);

  const { applied } = store.applyDesign(changes, { account: 'Admin' });
  const d = store.design('Sales by Region')!;
  assert.deepEqual(d.parts.map((p) => p.kind), ['header', 'leading-grand-summary', 'sub-summary-leading', 'sub-summary-leading', 'body', 'trailing-grand-summary', 'footer']);
  assert.deepEqual(d.parts.filter((p) => p.breakField).map((p) => p.breakField!.field), ['Region', 'Due Month']);
  assert.equal(d.parts.find((p) => p.kind === 'body')!.height, 0);
  const chart = d.objects.find((o) => o.kind === 'chart')!;
  assert.deepEqual({ categories: chart.chart!.categories, data: chart.chart!.series[0].data, grouped: chart.chart!.grouped, source: chart.chart!.source },
    { categories: 'Invoices::Region', data: 'Invoices::Total Amount', grouped: true, source: 'found-set' });
  // Each sub-summary shows its group's value and the total, inside the part.
  for (const p of d.parts.filter((x) => x.breakField)) {
    const inside = d.objects.filter((o) => o.bounds.top >= p.top && o.bounds.bottom <= p.top + p.height).map((o) => o.field?.field);
    assert.deepEqual(inside.sort(), [p.breakField!.field, 'Total Amount'].sort());
  }
  const month = store.schema.tables.find((t) => t.name === 'Invoices')!.fields.find((f) => f.name === 'Due Month')!;
  assert.equal(month.kind, 'calculation');
  const id = store.create('Invoices', { Region: 'West', Due: '3/5/2026', Amount: 10 }).recordId;
  assert.equal(store.get('Invoices', Number(id)).fieldData['Due Month'], '2026-03');
  assert.ok(store.schema.scripts.some((s) => s.name === 'Show Sales by Region'));
  const text = String((changes.find((c) => c.op === 'createScript') as { text: string }).text);
  assert.match(text, /Sort Records \[ Restore; Invoices::Region; ascending; Invoices::Due Month; ascending/);

  store.applyDesign(undoChanges(applied)!, { account: 'Admin' });
  assert.ok(!store.schema.layouts.some((l) => l.name === 'Sales by Region'));
  assert.ok(!store.schema.tables.find((t) => t.name === 'Invoices')!.fields.some((f) => f.name === 'Due Month' || f.name === 'Total Amount'));
  assert.ok(!store.schema.scripts.some((s) => s.name === 'Show Sales by Region'));
}));

test('draft report: requests that cannot work say why', () => withStore((store) => {
  shop(store);
  const bad = (req: Record<string, unknown>, why: RegExp) => assert.throws(() => draftLayoutChange(store, { name: 'R', occurrence: 'Invoices', ...req }), why);
  bad({ groups: [{ field: 'Customer', by: 'month' }] }, /Only a date or timestamp can be grouped by month; Customer is text/);
  bad({ groups: [{ field: 'Due', by: 'week' }] }, /Group dates by month, quarter or year/);
  bad({ summaryOnly: true }, /needs groups/);
  bad({ chart: { value: 'Amount' } }, /A chart needs groups/);
  bad({ groups: ['Customer'], chart: { value: 'Customer' } }, /Only number fields can be totalled/);
  bad({ view: 'form', groups: ['Customer'] }, /go on a list layout/);
}));

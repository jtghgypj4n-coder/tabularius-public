import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusText, createStore, fixLayout, layoutCensus, layoutPerformance, lintLayout, speedMoveFromIdea, speedPlan, Store, storeStats, type DesignOp } from '../src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

function withStore(fn: (store: Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  createStore(join(dir, 'f.sqlite'));
  const store = new Store(join(dir, 'f.sqlite'), 'Perf');
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Invoices with 50 line items each; a list layout of invoices. */
function setUp(store: Store) {
  store.applyDesign([
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Id', type: 'number' }, { name: 'Note' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'InvoiceId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Id', right: 'InvoiceId' }] },
    { op: 'createField', table: 'Invoices', name: 'Lines total', kind: 'calculation', type: 'number', calculation: 'Sum ( Lines::Amount )', options: { unstored: true } },
    { op: 'createField', table: 'Invoices', name: 'Shout', kind: 'calculation', type: 'text', calculation: 'Upper ( Note )', options: { unstored: true } },
    { op: 'createField', table: 'Invoices', name: 'Grand total', kind: 'summary', type: 'number', summary: { type: 'total', field: 'Lines total' } },
  ] as never);
  for (let i = 1; i <= 20; i++) {
    store.create('Invoices', { Id: String(i) });
    for (let j = 0; j < 50; j++) store.create('Lines', { InvoiceId: String(i), Amount: '1' });
  }
  const s = store.schema;
  const to = (n: string) => s.tableOccurrences.find((t) => t.name === n)!.id;
  const fid = (t: string, n: string) => s.tables.find((x) => x.name === t)!.fields.find((x) => x.name === n)!.id;
  const d = store.designs().layouts.find((l) => l.name === 'Invoices')!;
  const body = d.parts.find((p) => p.kind === 'body')!;
  const field = (id: number, t: string, n: string, top: number, left = 120): LayoutObject => ({
    id, kind: 'field', type: 0, bounds: { top, left, bottom: top + 18, right: left + 100 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    field: { tableOccurrenceId: to(t), tableOccurrence: t, fieldId: fid(t, n), field: n, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const objects: LayoutObject[] = [
    field(801, 'Invoices', 'Lines total', body.top + 2),
    field(802, 'Invoices', 'Shout', body.top + 2, 230),
    field(803, 'Invoices', 'Grand total', body.top + 2, 340),
    { id: 804, kind: 'text', type: 0, bounds: { top: body.top + 2, left: 300, bottom: body.top + 20, right: 336 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, text: 'Total' } as LayoutObject,
  ];
  const parts = d.parts.filter((p) => p.kind !== 'footer').map((p) => (p.kind === 'body' ? { ...p, height: 24 } : p));
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { view: 'list', parts, objects, width: 460 } }] as never);
  return store.design(d.id)!;
}

test('Check\'s speed findings: related totals and summaries on every row, with the work estimated from the records', () => withStore((store) => {
  const d = setUp(store);
  const found = layoutPerformance(d, store.schema, storeStats(store));
  const by = (id: number) => found.find((i) => i.objectIds[0] === id);
  // 20 rows on screen, each adding up 50 lines.
  assert.equal(by(801)?.cost, 20 * 50);
  assert.match(by(801)!.message, /unstored calculation that reads a total of related Lines records, on every row/);
  // An unstored calculation on the record's own fields costs nothing worth saying.
  assert.equal(by(802), undefined);
  // The summary adds up its 20 records, each one's Lines total reading 50 lines, on each of 20 rows; Fix can move it.
  assert.ok(by(803)!.fixable);
  assert.equal(by(803)!.cost, 20 * (20 + 20 * 50));
  const lint = lintLayout(d, store.schema, [], storeStats(store)).filter((i) => i.rule === 'slow');
  assert.deepEqual(lint.map((i) => i.severity), ['warning', 'info']);
  // The census counts it by layout id, no names.
  const c = layoutCensus(store);
  assert.deepEqual([c.slow.layouts, c.slow.objects, c.slow.worst], [1, { 'summary on every row': 1 }, 20 * (20 + 20 * 50)]);
  // The costliest layout is the same figure the slowest list gives it.
  assert.equal(c.slow.worst, Math.max(...c.slow.slowest!.map((x) => x.cost)));
  assert.deepEqual(c.slow.slowest, [{ layout: d.id, cost: 20 * (20 + 20 * 50), objects: 1 }]);
  assert.deepEqual(c.byLayout?.find((x) => x.layout === d.id), { layout: d.id, issues: 0, slow: 1, cost: 20 * (20 + 20 * 50) });
  assert.match(censusText(c, 'Perf'), new RegExp(`layout id ${d.id}: about 20,400 reads, 1 slow object`));
  assert.doesNotMatch(censusText(c, 'Perf'), /Lines|Invoices|Grand/);
  // Names only when asked for.
  const named = layoutCensus(store, { names: true });
  assert.equal(named.slow.slowest![0].name, d.name);
  assert.match(censusText(named, 'Perf'), new RegExp(`layout id ${d.id} "${d.name}"`));
  // Without record counts: the same findings as advice, no estimate.
  assert.ok(layoutPerformance(d, store.schema).every((i) => i.cost === undefined && !/record reads/.test(i.message)));
}));

test('Fix moves a total off the rows, with its label, into a new trailing grand summary', () => withStore((store) => {
  const d = setUp(store);
  const issue = lintLayout(d, store.schema).find((i) => i.rule === 'slow' && i.fixable)!;
  const { design, fixed } = fixLayout(d, store.schema, [], [issue]);
  assert.equal(fixed.length, 1);
  const grand = design.parts.find((p) => p.kind === 'trailing-grand-summary')!;
  const body = design.parts.find((p) => p.kind === 'body')!;
  assert.ok(grand.top >= body.top + body.height);
  for (const id of [803, 804]) {
    const o = design.objects.find((x) => x.id === id)!;
    assert.ok(o.bounds.top >= grand.top && o.bounds.bottom <= grand.top + grand.height, `object ${id} in the grand summary`);
  }
  // What was below the body moved down to make room; the layout saves.
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { parts: design.parts, objects: design.objects } }] as never);
  assert.ok(!lintLayout(store.design(d.id)!, store.schema).some((i) => i.rule === 'slow' && i.fixable));
}));

test('Fix all moves two totals into the grand summary one below the other, none into the footer; a total in a group isn\'t offered', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Inv', fields: [{ name: 'Amt', type: 'number' }] },
    { op: 'createField', table: 'Inv', name: 'T1', kind: 'summary', type: 'number', summary: { type: 'total', field: 'Amt' } },
    { op: 'createField', table: 'Inv', name: 'T2', kind: 'summary', type: 'number', summary: { type: 'count', field: 'Amt' } },
  ] as never);
  const s = store.schema;
  const to = s.tableOccurrences.find((t) => t.name === 'Inv')!.id;
  const fid = (n: string) => s.tables.find((x) => x.name === 'Inv')!.fields.find((x) => x.name === n)!.id;
  const d = store.designs().layouts.find((l) => l.name === 'Inv')!;
  const parts = d.parts.map((p) => (p.kind === 'body' ? { ...p, height: 60 } : { ...p }));
  let y = 0;
  for (const p of parts) { p.top = y; y += p.height; }
  const body = parts.find((p) => p.kind === 'body')!;
  const f = (id: number, n: string, top: number, left = 120) => ({ id, kind: 'field', type: 1, bounds: { top, left, bottom: top + 18, right: left + 100 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    field: { tableOccurrenceId: to, tableOccurrence: 'Inv', fieldId: fid(n), field: n, display: 'edit', repetitions: 1 } }) as LayoutObject;
  const group = { id: 3, kind: 'group', type: 8, bounds: { top: body.top + 2, left: 300, bottom: body.top + 20, right: 420 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, children: [f(4, 'T1', body.top + 2, 300)] } as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { view: 'list', parts, objects: [f(1, 'T1', body.top + 2), f(2, 'T2', body.top + 30), group] } }] as never);
  const design0 = store.design(d.id)!;
  const slow = lintLayout(design0, store.schema).filter((i) => i.rule === 'slow');
  assert.deepEqual(slow.filter((i) => i.fixable).map((i) => i.objectIds[0]).sort(), [1, 2]);
  const { design } = fixLayout(design0, store.schema);
  const grand = design.parts.find((p) => p.kind === 'trailing-grand-summary')!;
  const [a, b] = [1, 2].map((id) => design.objects.find((o) => o.id === id)!.bounds);
  for (const x of [a, b]) assert.ok(x.top >= grand.top && x.bottom <= grand.top + grand.height, 'in the grand summary');
  assert.ok(a.bottom <= b.top || b.bottom <= a.top, 'not on top of each other');
  const footer = design.parts.find((p) => p.kind === 'footer');
  if (footer) assert.ok(footer.top >= grand.top + grand.height);
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { parts: design.parts, objects: design.objects } }] as never);
}));

test('Make it faster: a stored calculation for a related total, the summary moved off the rows, each with its cost after', () => withStore((store) => {
  const d = setUp(store);
  const plan = speedPlan(store, d.id);
  assert.equal(plan.before, 20 * 50 + 20 * (20 + 20 * 50));
  const total = plan.moves.find((m) => m.objectIds[0] === 801)!;
  assert.match(total.title, /Invoices::Lines total stored/);
  assert.match(total.caveat!, /not when the related records change/);
  // The stored copy reads nothing when it shows: only the summary is left.
  assert.equal(total.after, 20 * (20 + 20 * 50));
  const summary = plan.moves.find((m) => m.objectIds[0] === 803)!;
  assert.match(summary.title, /grand summary/);
  assert.ok(summary.after < plan.before);
  assert.deepEqual(plan.left, []);
  // Applied, the new field holds each invoice's total already and the layout shows it.
  store.applyDesign(total.changes as DesignOp[], { account: 'Admin' });
  const f = store.schema.tables.find((t) => t.name === 'Invoices')!.fields.find((x) => x.name === 'Lines total stored')!;
  assert.equal(f.options?.unstored ?? false, false);
  assert.equal(Number(store.find('Invoices', { query: [{ Id: '1' }] }).records[0].fieldData['Lines total stored']), 50);
  const shown = store.design(d.id)!.objects.find((o) => o.id === 801)!;
  assert.equal(shown.field?.fieldId, f.id);
  // Nothing more to do for it now.
  assert.equal(speedPlan(store, d.id).moves.filter((m) => m.objectIds[0] === 801).length, 0);
}));

test('Make it faster, an idea from AI: only plain new fields, occurrences and relationships that never create or delete records, each change listed', () => withStore((store) => {
  const d = setUp(store);
  const relId = store.schema.relationships.length;
  const move = speedMoveFromIdea(store, d.id, 'portal filter', {
    title: 'Harmless', objectIds: [801],
    add: [
      { op: 'createOccurrence', id: 9999, name: 'Big lines', table: 'Lines', file: 'Elsewhere', externalTable: 3 },
      { op: 'createRelationship', id: 9998, left: 'Invoices', right: 'Big lines', predicates: [{ left: 'Id', right: 'InvoiceId' }, { left: 'Id', operator: '≤', right: 'Amount' }], leftDelete: true, rightDelete: true, leftCreate: true, rightCreate: true },
      { op: 'createField', table: 'Invoices', name: 'Flag', kind: 'normal', calculation: 'x', options: { global: true, autoEnter: { calculation: 'Delete' }, validation: { required: true } } },
    ] as unknown as DesignOp[],
  });
  const rel = move.changes.find((c) => c.op === 'createRelationship') as unknown as Record<string, unknown>;
  assert.equal(rel.leftDelete, false);
  assert.equal(rel.rightDelete, false);
  assert.equal(rel.leftCreate, false);
  assert.equal(rel.rightCreate, false);
  const occ = move.changes.find((c) => c.op === 'createOccurrence') as unknown as Record<string, unknown>;
  assert.equal(occ.file, undefined);
  assert.equal(occ.externalTable, undefined);
  const field = move.changes.find((c) => c.op === 'createField') as unknown as Record<string, unknown>;
  assert.deepEqual(field.options, { global: true });
  assert.equal(field.calculation, undefined);
  // What the person sees comes from the changes, not the model's title.
  assert.ok(move.details!.some((l) => /New relationship Invoices to Big lines where Invoices::Id = Big lines::InvoiceId and Invoices::Id ≤ Big lines::Amount \(no records are created or deleted/.test(l)), move.details!.join('\n'));
  assert.ok(move.details!.some((l) => /New global field Invoices::Flag/.test(l)));
  assert.ok(move.details!.some((l) => /New table occurrence Big lines, of the table Lines/.test(l)));
  // Saved, the relationship deletes nothing.
  store.applyDesign(move.changes, { account: 'Admin' });
  const saved = store.schema.relationships.slice(relId).find((r) => store.schema.tableOccurrences.find((t) => t.id === r.rightTableOccurrenceId)?.name === 'Big lines')!;
  assert.ok(saved);
  assert.ok(!JSON.stringify(saved).includes('"leftDelete":true') && !JSON.stringify(saved).includes('"rightDelete":true'));
}));

test('Make it faster, an idea from AI: refused when it adds anything else, names objects off the layout, or points at a condition that isn\'t there', () => withStore((store) => {
  const d = setUp(store);
  const idea = (more: object) => ({ title: 't', objectIds: [801], ...more });
  assert.throws(() => speedMoveFromIdea(store, d.id, 'portal filter', idea({ add: [{ op: 'deleteTable', table: 'Lines' }] }) as never), /isn't something a speed-up adds/);
  assert.throws(() => speedMoveFromIdea(store, d.id, 'portal filter', idea({ add: [{ op: 'createField', table: 'Invoices', name: 'S', kind: 'summary', summary: { type: 'total', field: 'Id' } }] }) as never), /plain or calculated/);
  assert.throws(() => speedMoveFromIdea(store, d.id, 'portal filter', idea({ add: [{ op: 'createRelationship', left: 'Invoices', right: 'Lines', predicates: [{ left: 'Id', operator: 'DROP', right: 'InvoiceId' }] }] }) as never), /unknown operator/);
  assert.throws(() => speedMoveFromIdea(store, d.id, 'portal filter', { title: 't', objectIds: [801, 123456], edits: [{ object: 801, tooltip: 'x' }] }), /aren't on Invoices/);
  for (const index of ['__proto__', 5, -1, 0.5]) {
    assert.throws(() => speedMoveFromIdea(store, d.id, 'hide, tooltip or condition', { title: 't', objectIds: [801], edits: [{ object: 801, condition: { index: index as number, formula: '1' } }] }), /has no condition/);
  }
}));

test('Make it faster: no stored total for a summary in a portal row that comes through another occurrence than the portal\'s', () => withStore((store) => {
  const d = setUp(store);
  store.applyDesign([
    { op: 'createField', table: 'Lines', name: 'Id', type: 'number' },
    { op: 'createTable', name: 'Parts', fields: [{ name: 'LineId', type: 'number' }, { name: 'Qty', type: 'number' }] },
    { op: 'createRelationship', left: 'Lines', right: 'Parts', predicates: [{ left: 'Id', right: 'LineId' }] },
    { op: 'createField', table: 'Parts', name: 'Qty total', kind: 'summary', type: 'number', summary: { type: 'total', field: 'Qty' } },
    { op: 'createField', table: 'Lines', name: 'Amount total', kind: 'summary', type: 'number', summary: { type: 'total', field: 'Amount' } },
  ] as never);
  // Enough parts that a total of them on every portal row is worth a word (200 per invoice, 5 rows).
  for (let i = 0; i < 4400; i++) store.create('Parts', { LineId: String(i % 50), Qty: '1' });
  const s = store.schema;
  const to = (n: string) => s.tableOccurrences.find((t) => t.name === n)!.id;
  const fid = (t: string, n: string) => s.tables.find((x) => x.name === t)!.fields.find((x) => x.name === n)!.id;
  const body = d.parts.find((p) => p.kind === 'body')!;
  const field = (id: number, t: string, n: string, left: number): LayoutObject => ({
    id, kind: 'field', type: 0, bounds: { top: body.top + 2, left, bottom: body.top + 20, right: left + 60 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    field: { tableOccurrenceId: to(t), tableOccurrence: t, fieldId: fid(t, n), field: n, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const portal = {
    id: 900, kind: 'portal', type: 0, bounds: { top: body.top + 1, left: 10, bottom: body.top + 23, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
    portal: { tableOccurrenceId: to('Lines'), rows: 5, initialRow: 1, scrollbar: true },
    children: [field(901, 'Parts', 'Qty total', 20), field(902, 'Lines', 'Amount total', 100)],
  } as unknown as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { view: 'form', objects: [portal] } }] as never);
  const plan = speedPlan(store, d.id);
  // Each line's own parts differ row to row: one stored number on the invoice would be wrong.
  assert.ok(!plan.moves.some((m) => m.objectIds.includes(901)), JSON.stringify(plan.moves.map((m) => m.title)));
}));

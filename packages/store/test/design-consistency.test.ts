// Saved designs come out the same however they're reached: applied live, or replayed from the design log (as
// re-importing a file does), and later changes don't quietly undo or detach what earlier ones made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp, type DesignState } from '../src/index.ts';
import { applyOp } from '../src/design.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

const A = { account: 'Admin' };

/** A store, and the design as replaying its log from the start gives it. */
function withStore(fn: (store: Store, replay: () => DesignState) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-consistency-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    const start = structuredClone({ schema: store.schema, designs: store.designs() });
    const replay = () => {
      const st = structuredClone(start) as unknown as DesignState;
      const rows = (store as unknown as { sql: { prepare(q: string): { all(): { op: string }[] } } }).sql.prepare('SELECT op FROM _fm_design_log ORDER BY seq').all();
      for (const r of rows) applyOp(st, JSON.parse(r.op) as DesignOp);
      return st;
    };
    try {
      fn(store, replay);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** As saved (JSON, where a key set to undefined and a missing key are the same). */
const saved = (x: unknown) => JSON.parse(JSON.stringify(x ?? [])) as unknown;
const sameAsReplay = (store: Store, replay: () => DesignState) => {
  const r = replay();
  assert.deepEqual(saved(r.designs.layouts), saved(store.designs().layouts), 'layouts replay as applied');
  assert.deepEqual(saved(r.designs.components), saved(store.designs().components), 'components replay as applied');
};

test('a field id drafted earlier that another change has since taken is refused, not duplicated', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'Amount', type: 'number' }] }] as DesignOp[], A);
  const next = Math.max(...store.schema.tables[0].fields.map((f) => f.id)) + 1;
  store.applyDesign([{ op: 'createField', table: 'Invoices', name: 'Notes' }] as DesignOp[], A);
  assert.throws(() => store.applyDesign([{ op: 'createField', table: 'Invoices', id: next, name: 'Total Amount', kind: 'summary', summary: { type: 'total', field: 'Amount' } }] as DesignOp[], A), /already has a field with id .*draft it again/);
  assert.equal(new Set(store.schema.tables[0].fields.map((f) => f.id)).size, store.schema.tables[0].fields.length);
}));

test('layouts made from a design (phone layouts, drafted ones) don\'t take new fields like generated ones', () => withStore((store, replay) => {
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] }] as DesignOp[], A);
  const form = store.design('Customers')!;
  store.applyDesign([
    { op: 'createLayout', name: 'Customers (phone)', phoneOf: 'Customers' },
    { op: 'createLayout', name: 'Drafted', occurrence: 'Customers', design: { objects: form.objects.slice(0, 2), parts: form.parts } },
  ] as DesignOp[], A);
  const phone = store.design('Customers (phone)')!;
  const drafted = store.design('Drafted')!;
  store.applyDesign([{ op: 'createField', table: 'Customers', name: 'Zip' }] as DesignOp[], A);
  assert.ok(store.design('Customers')!.objects.some((o) => o.field?.field === 'Zip'), 'the generated form takes it');
  assert.equal(store.design('Drafted')!.objects.length, drafted.objects.length, 'the drafted layout doesn\'t');
  // The phone layout follows its desktop layout instead: rebuilt with Zip, stacked at phone width.
  const after = store.design('Customers (phone)')!;
  assert.ok(after.objects.length > phone.objects.length);
  assert.ok(after.objects.every((o) => o.bounds.right <= 390), 'nothing past the phone\'s edge');
  sameAsReplay(store, replay);
}));

test('saving objects of a generated layout as a component replays as it applied', () => withStore((store, replay) => {
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] }] as DesignOp[], A);
  const d = store.design('Customers')!;
  store.applyDesign([{ op: 'createComponent', name: 'Bar', layout: d.id, objectIds: [d.objects[0].id] }] as DesignOp[], A);
  store.applyDesign([{ op: 'createField', table: 'Customers', name: 'Zip' }] as DesignOp[], A);
  sameAsReplay(store, replay);
}));

test('a rename or a component change keeps a phone layout following its desktop layout', () => withStore((store, replay) => {
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] }] as DesignOp[], A);
  const d = store.design('Customers')!;
  store.applyDesign([{ op: 'createComponent', name: 'Bar', layout: d.id, objectIds: [d.objects[0].id] }] as DesignOp[], A);
  store.applyDesign([{ op: 'createLayout', name: 'P', phoneOf: 'Customers' }] as DesignOp[], A);
  const c = store.designs().components![0];
  store.applyDesign([{ op: 'updateField', table: 'Customers', field: 'Name', name: 'FullName' }] as DesignOp[], A);
  store.applyDesign([{ op: 'updateComponent', component: c.id, objects: c.objects.map((o) => ({ ...o, text: 'Changed' })) }] as DesignOp[], A);
  const desktop = store.design('Customers')!;
  const nudged = desktop.objects.map((o) => (o.component ? o : { ...o, bounds: { ...o.bounds, bottom: o.bounds.bottom + 3 } }));
  const { applied } = store.applyDesign([{ op: 'updateLayout', layout: desktop.id, design: { objects: nudged } }] as DesignOp[], A);
  const phone = store.design('P')!;
  assert.ok(applied.some((o) => o.op === 'updateLayout' && (o as { layout: number }).layout === phone.id), 'the phone layout is rebuilt');
  sameAsReplay(store, replay);
}));

test('a component placed on layouts of different tables keeps a rename of one table\'s field', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Total' }] },
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] },
  ] as DesignOp[], A);
  const orders = store.design('Orders')!;
  const one = orders.objects.find((o) => o.kind === 'text')!;
  store.applyDesign([{ op: 'createComponent', name: 'Badge', objects: [{ ...one, id: 1, hide: { formula: 'IsEmpty ( Name )', inFind: false } }] }] as DesignOp[], A);
  const id = store.designs().components![0].id;
  for (const name of ['Orders', 'Customers']) {
    const d = store.design(name)!;
    const copy = { ...one, id: 999, kind: 'group', type: 8, component: { id }, children: [] } as LayoutObject;
    store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { objects: [...d.objects, copy] } }] as DesignOp[], A);
  }
  store.applyDesign([{ op: 'updateField', table: 'Customers', field: 'Name', name: 'FullName' }] as DesignOp[], A);
  const d = store.design('Customers')!;
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { objects: d.objects } }] as DesignOp[], A);
  assert.equal(store.design('Customers')!.objects.find((o) => o.component)!.children![0].hide!.formula, 'IsEmpty ( FullName )');
}));

test('renaming a theme\'s style leaves a component alone when another theme\'s layouts show it too', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTheme', name: 'TA' }, { op: 'createTheme', name: 'TB' },
    { op: 'createStyle', theme: 'TA', name: 'Brand', element: 70 }, { op: 'createStyle', theme: 'TB', name: 'Brand', element: 70 },
    { op: 'createTable', name: 'X', fields: [{ name: 'A' }] }, { op: 'createTable', name: 'Y', fields: [{ name: 'B' }] },
  ] as DesignOp[], A);
  const themes = store.designs().themes;
  const [ta, tb] = ['TA', 'TB'].map((n) => themes.find((t) => t.name === n)!.id);
  const x = store.design('X')!;
  const y = store.design('Y')!;
  const text = { ...x.objects.find((o) => o.kind === 'text')!, id: 1, style: { element: 70, name: 'Brand' } };
  store.applyDesign([{ op: 'createComponent', name: 'C', objects: [text] }] as DesignOp[], A);
  const copy = { ...text, id: 999, kind: 'group', type: 8, style: {}, component: { id: store.designs().components![0].id }, children: [] };
  store.applyDesign([
    { op: 'updateLayout', layout: x.id, design: { themeId: ta, objects: [...x.objects, copy] } },
    { op: 'updateLayout', layout: y.id, design: { themeId: tb, objects: [...y.objects, copy] } },
  ] as DesignOp[], A);
  store.applyDesign([{ op: 'updateStyle', theme: 'TA', style: 'Brand', element: 70, name: 'Brand2' }] as DesignOp[], A);
  const yd = store.design('Y')!;
  store.applyDesign([{ op: 'updateLayout', layout: yd.id, design: { objects: yd.objects } }] as DesignOp[], A);
  assert.equal(store.design('Y')!.objects.find((o) => o.component)!.children![0].style.name, 'Brand', 'TB still has Brand');
}));

test('every save of a layout stays in its history, however many other changes come after', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] }] as DesignOp[], A);
  const d = store.design('Customers')!;
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { ...d, objects: d.objects.slice(1) } }] as DesignOp[], A);
  for (let i = 0; i < 30; i++) store.applyDesign(Array.from({ length: 10 }, (_, j) => ({ op: 'createField', table: 'Customers', name: `F${i}_${j}` })) as DesignOp[], A);
  assert.ok(!store.designHistory().some((e) => e.op.op === 'updateLayout'), 'past the file history\'s latest changes');
  const saves = store.layoutHistory(d.id).filter((e) => e.op.op === 'updateLayout');
  assert.ok(saves.length >= 1);
  assert.equal((saves[0].op as { design: { objects: unknown[] } }).design.objects.length, d.objects.length - 1);
  assert.deepEqual(store.layoutHistory(99999), []);
}));

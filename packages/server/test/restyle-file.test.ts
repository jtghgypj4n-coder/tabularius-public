import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTokens, createStore, phoneFingerprint, PRODUCT_TOKENS, Store, tokenTheme, type DesignOp, type DesignState } from '../../store/src/index.ts';
import { applyOp } from '../../store/src/design.ts';
import type { LayoutDesign } from '../../fmp12/src/index.ts';
import { layoutsBefore, restyleFileChange, undoChanges } from '../src/design-preview.ts';

const A = { account: 'Admin' };

function withStore(fn: (store: Store, replay: () => DesignState) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restyle-file-'));
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

const saved = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

/** Two tables with layouts, local formatting on Customers' field, and a phone layout following Customers. */
function shop(store: Store): void {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'Total', type: 'number' }] },
  ] as DesignOp[], A);
  const c = store.design('Customers')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: {
    objects: c.objects.map((o) => (o.kind === 'field' ? { ...o, style: { ...o.style, rules: [{ part: 1, state: 1, css: { 'background-color': '#fef3c7' } }] } } : o)),
  } }] as DesignOp[], A);
  store.applyDesign([{ op: 'createLayout', name: 'Customers (phone)', phoneOf: 'Customers' }] as DesignOp[], A);
}

test('token theme: checked tokens, the product look for any left out', () => {
  assert.deepEqual(checkTokens(), PRODUCT_TOKENS);
  assert.equal(checkTokens({ accent: '#AA0000' }).accent, '#aa0000');
  assert.throws(() => checkTokens({ accent: 'red' }), /colour like/);
  assert.throws(() => checkTokens({ font: 'x; color: red' }), /font family/);
  assert.throws(() => checkTokens({ size: 500 }), /6 to 72/);
  assert.throws(() => checkTokens({ radius: -1 }), /0 to 40/);
  const theme = tokenTheme(checkTokens({ accent: '#aa0000', radius: 3 }));
  // Buttons take the accent, darker when hovered and pressed; fields have the radius and an accent focus border.
  const button = theme.defaults[80];
  assert.equal(button[0].css['background-color'], '#aa0000');
  assert.ok(button.some((r) => r.state === 2) && button.some((r) => r.state === 3));
  assert.equal(theme.defaults[61][0].css['border-top-left-radius'], '3px');
  assert.equal(theme.defaults[61].find((r) => r.state === 4)?.css['border-top-color'], '#aa0000');
});

test('restyle file: every layout onto a new theme from tokens; the phone layout keeps following; replay and undo agree', () => withStore((store, replay) => {
  shop(store);
  const r = restyleFileChange(store, { tokens: { accent: '#aa0000' }, name: 'Brand', consistent: true });
  assert.equal(r.theme, 'Brand');
  assert.equal(r.changes[0].op, 'createTheme');
  assert.deepEqual(r.layouts.map((l) => l.name).sort(), ['Customers', 'Invoices']);
  assert.ok(r.unchanged.some((u) => u.name === 'Customers (phone)' && /follows Customers/.test(u.why)), JSON.stringify(r.unchanged));
  assert.equal(r.themeContent?.name, 'Brand');
  const customers = r.layouts.find((l) => l.name === 'Customers')!;
  assert.ok(customers.issues && typeof customers.issues.after === 'number');
  // Consistent: Customers' own yellow is gone in the after picture.
  assert.ok(!JSON.stringify(customers.after.objects).includes('#fef3c7'));

  const before = layoutsBefore(store, r.changes);
  // A layout Tabularius made for a table stops taking new fields once it's changed; that isn't put back.
  const layouts = () => saved((store.designs().layouts as (LayoutDesign & { generated?: boolean })[]).map(({ generated: _g, ...d }) => d));
  const was = layouts();
  const { applied } = store.applyDesign(r.changes, A);
  const themeId = store.designs().themes.find((t) => t.name === 'Brand')!.id;
  for (const d of store.designs().layouts) assert.equal(d.themeId, themeId, d.name);
  // The after shown is the after saved.
  assert.deepEqual(saved(store.design('Customers')), saved(customers.after));
  const phone = store.design('Customers (phone)')!;
  assert.equal(phoneFingerprint(phone), phone.phone!.synced, 'the phone layout still follows Customers');
  assert.ok(!JSON.stringify(phone.objects).includes('#fef3c7'), 'and was rebuilt from the restyled Customers');
  // Replaying the log gives the same layouts and themes.
  const st = replay();
  assert.deepEqual(saved(st.designs.layouts), saved(store.designs().layouts));
  assert.deepEqual(saved(st.designs.themes), saved(store.designs().themes));

  // One undo takes it all back, the new theme too.
  const undo = undoChanges(applied, before);
  assert.ok(undo, 'undo is offered');
  store.applyDesign(undo, A);
  assert.deepEqual(layouts(), was);
  assert.ok(!store.designs().themes.some((t) => t.name === 'Brand'));
  const back = store.design('Customers (phone)')!;
  assert.equal(phoneFingerprint(back), back.phone!.synced, 'the phone layout follows again after undo');
}));

test('restyle file: an existing theme, chosen layouts only; a theme name in use gets a number', () => withStore((store) => {
  shop(store);
  store.applyDesign([{ op: 'createTheme', name: 'House', content: tokenTheme(PRODUCT_TOKENS) }] as DesignOp[], A);
  const fresh = restyleFileChange(store, { tokens: {} });
  assert.equal(fresh.theme, 'House 2');
  const invoices = store.design('Invoices')!.id;
  const r = restyleFileChange(store, { theme: 'house', layouts: [invoices] });
  assert.deepEqual(r.layouts.map((l) => l.name), ['Invoices']);
  assert.equal(r.changes.length, 1);
  store.applyDesign(r.changes, A);
  assert.throws(() => restyleFileChange(store, { theme: 'House', layouts: [invoices] }), /already on House/);
  assert.throws(() => restyleFileChange(store, { theme: 'Nope' }), /No theme "Nope"/);
  assert.throws(() => restyleFileChange(store, { tokens: 'blue' }), /tokens is an object/);
}));

test('restyle file: a phone layout edited by hand is restyled on its own', () => withStore((store) => {
  shop(store);
  const p = store.design('Customers (phone)')!;
  store.applyDesign([{ op: 'updateLayout', layout: p.id, design: { objects: p.objects.map((o, i) => (i === 0 ? { ...o, bounds: { ...o.bounds, left: o.bounds.left + 5, right: o.bounds.right + 5 } } : o)) } }] as DesignOp[], A);
  const r = restyleFileChange(store, { tokens: {} });
  assert.ok(r.layouts.some((l) => l.name === 'Customers (phone)'));
}));

test('restyle file (review): undo is kept when a phone layout already on the theme is only rebuilt', () => withStore((store) => {
  shop(store);
  store.applyDesign([{ op: 'createTheme', name: 'X', content: tokenTheme(PRODUCT_TOKENS) }] as DesignOp[], A);
  const x = store.designs().themes.find((t) => t.name === 'X')!.id;
  // Both on X already; Customers keeps its own yellow field, which consistent drops.
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { themeId: x } }] as DesignOp[], A);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers (phone)', design: { themeId: x } }] as DesignOp[], A);
  const p = store.design('Customers (phone)')!;
  assert.deepEqual([p.themeId, phoneFingerprint(p) === p.phone!.synced], [x, true], 'on X and still following');
  const r = restyleFileChange(store, { theme: 'X', consistent: true, layouts: [store.design('Customers')!.id] });
  const before = layoutsBefore(store, r.changes);
  const was = saved(store.design('Customers (phone)'));
  const { applied } = store.applyDesign(r.changes, A);
  assert.ok(applied.some((op) => op.op === 'updateLayout' && op.layout === store.design('Customers (phone)')!.id), 'the phone layout was rebuilt');
  const undo = undoChanges(applied, before);
  assert.ok(undo, 'undo is offered');
  store.applyDesign(undo, A);
  assert.deepEqual(saved(store.design('Customers (phone)')), was);
}));

test('restyle file (review): a layout\'s id, name and occurrence can\'t be nulled away', () => withStore((store) => {
  shop(store);
  for (const k of ['id', 'name', 'tableOccurrenceId', 'width', 'style']) {
    assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { [k]: null } }] as DesignOp[], A), /can't be taken away/, k);
  }
  assert.equal(store.designs().layouts.length, 3);
}));

test('restyle file (review): a stale preview whose new theme id was taken since fails instead of sharing the id', () => withStore((store) => {
  shop(store);
  const r = restyleFileChange(store, { tokens: {}, name: 'Brand' });
  store.applyDesign([{ op: 'createTheme', name: 'Other' }] as DesignOp[], A);
  assert.throws(() => store.applyDesign(r.changes, A), /is taken/);
  assert.equal(new Set(store.designs().themes.map((t) => t.id)).size, store.designs().themes.length);
}));

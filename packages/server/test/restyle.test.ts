import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { layoutsBefore, restyleChange, undoChanges } from '../src/design-preview.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restyle-'));
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

test('restyle: one layout made to look like another, then undone', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'Total', type: 'number' }] },
  ] as DesignOp[], { account: 'Admin' });
  // Customers gets a look of its own: a yellow field, a red title, a dark header.
  const customers = store.design('Customers')!;
  const restyled = customers.objects.map((o) => ({
    ...o, style: {
      ...o.style, rules: o.kind === 'field' ? [{ part: 1, state: 1, css: { 'background-color': '#fef3c7' } }]
        : o.bounds.top < customers.parts[1].top ? [{ part: 1, state: 1, css: { color: '#b42318', 'font-size': '24px' } }] : o.style.rules,
    },
  }));
  const parts = customers.parts.map((p) => (p.kind === 'header' ? { ...p, style: { rules: [{ part: 1, state: 1, css: { 'background-color': '#1d1d1f' } }] } } : p));
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: restyled, parts } }] as DesignOp[], { account: 'Admin' });

  const before = store.design('Invoices')!;
  const { change, notes } = restyleChange(store, { layout: 'Invoices', like: 'Customers' });
  assert.ok(notes.some((n) => /objects? styled as the same kind of object is on Customers/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /1 part styled as on Customers/.test(n)), notes.join('\n'));
  const was = layoutsBefore(store, [change]);
  const { applied } = store.applyDesign([change], { account: 'Admin' });
  const after = store.design('Invoices')!;
  const fields = after.objects.filter((o) => o.kind === 'field');
  assert.equal(fields.length, 2);
  for (const f of fields) assert.equal(css(f)['background-color'], '#fef3c7');
  const title = after.objects.find((o) => o.kind === 'text' && o.bounds.top < after.parts[1].top);
  assert.equal(css(title).color, '#b42318');
  // Labels in the body keep the look labels have on Customers, not the title's.
  const label = after.objects.find((o) => o.kind === 'text' && o.bounds.top >= after.parts[1].top);
  assert.equal(css(label).color, '#55595f');
  assert.equal(after.parts.find((p) => p.kind === 'header')?.style.rules?.[0].css['background-color'], '#1d1d1f');
  // Nothing moved.
  assert.deepEqual(after.objects.map((o) => o.bounds), before.objects.map((o) => o.bounds));

  const undo = undoChanges(applied, was);
  assert.ok(undo, 'a redesign can be undone');
  store.applyDesign(undo!, { account: 'Admin' });
  assert.deepEqual(store.design('Invoices')!.objects, before.objects);
  assert.deepEqual(store.design('Invoices')!.parts, before.parts);
}));

test('restyle: the theme applied consistently drops local formatting', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] }] as DesignOp[], { account: 'Admin' });
  store.applyDesign([{ op: 'createTheme', name: 'Plain' }] as DesignOp[], { account: 'Admin' });
  const { change, notes } = restyleChange(store, { layout: 'Customers', theme: 'plain', consistent: true });
  assert.match(notes[0], /^Theme: none → Plain\.$/);
  assert.ok(notes.some((n) => /^Local formatting dropped in 3 places/.test(n)), notes.join('\n'));
  store.applyDesign([change], { account: 'Admin' });
  const d = store.design('Customers')!;
  assert.equal(d.themeId, store.designs().themes.find((t) => t.name === 'Plain')!.id);
  assert.ok(d.objects.every((o) => !o.style.rules?.length));
  assert.throws(() => restyleChange(store, { layout: 'Customers' }), /Say which layout to look like/);
  assert.throws(() => restyleChange(store, { layout: 'Customers', theme: 'Nope' }), /No theme "Nope"; themes: Plain/);
}));

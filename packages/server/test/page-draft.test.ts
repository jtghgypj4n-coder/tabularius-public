// draftPageChange (server/src/page-draft.ts): the assistant's HTML page turned into a design change, for a new modern
// layout or for the page of one that exists, with the refusals that keep the page offline and the layout a modern one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { FORMULA_LIMIT, modernPage, pageFormula } from '../../web/src/page-source.ts';
import type { LayoutObject } from '../../web/src/types.ts';
import { draftPageChange } from '../src/page-draft.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-page-draft-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] },
        { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }] },
      ] as DesignOp[], { account: 'Admin' });
      fn(store);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PAGE = '<!doctype html><html><body><h1>Sales</h1></body></html>';
const apply = (store: Store, changes: Record<string, unknown>[]) => store.applyDesign(changes as unknown as DesignOp[], { account: 'Admin' });
const pageOf = (store: Store, layout: string) => modernPage(store.design(store.schema.layouts.find((l) => l.name === layout)!.id)!.objects as unknown as LayoutObject[]);

test('a page needs html, and not more than 200,000 characters', () => withStore((store) => {
  assert.throws(() => draftPageChange(store, { name: 'Sales' }), /html is missing/);
  assert.throws(() => draftPageChange(store, { name: 'Sales', html: '   ' }), /html is missing/);
  assert.throws(() => draftPageChange(store, { name: 'Sales', html: 42 }), /html is missing/);
  assert.throws(() => draftPageChange(store, { name: 'Sales', html: 'x'.repeat(200_001) }), /keep it under 200000/);
  assert.doesNotThrow(() => draftPageChange(store, { name: 'Sales', html: 'x'.repeat(200_000) }));
}));

test('a page that loads something from the network is refused; inline and data: pages are not', () => withStore((store) => {
  for (const tag of [
    '<script src="https://cdn.example/x.js"></script>',
    '<script src=//cdn.example/x.js></script>',
    '<LINK rel="stylesheet" href=\'http://fonts.example/a.css\'>',
    '<img src="https://example.com/a.png">',
    '<iframe src="//example.com/"></iframe>',
  ]) {
    assert.throws(() => draftPageChange(store, { name: 'Sales', html: `<body>${tag}</body>` }), /loads something from the network/, tag);
  }
  // Pictures and scripts that travel inside the page are fine, and so is a plain link the person clicks.
  const ok = '<body><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><script>1+1</script><a href="https://example.com/">more</a></body>';
  assert.doesNotThrow(() => draftPageChange(store, { name: 'Sales', html: ok }));
}));

test('a new layout: named, on the first table occurrence unless one is given, with the page as a modern layout', () => withStore((store) => {
  const draft = draftPageChange(store, { name: '  Sales  ', html: `\n${PAGE}\n` });
  assert.equal(draft.layout, 'Sales');
  assert.equal(draft.changes.length, 1);
  assert.equal(draft.changes[0].op, 'createLayout');
  assert.equal(draft.changes[0].name, 'Sales');
  assert.equal(draft.changes[0].occurrence, store.schema.tableOccurrences[0].id);
  assert.match(draft.notes.join(' '), /A modern layout/);
  apply(store, draft.changes);
  assert.equal(pageOf(store, 'Sales')?.html, PAGE);

  const invoices = store.schema.tableOccurrences.find((t) => t.name === 'Invoices')!;
  const second = draftPageChange(store, { name: 'Invoice sales', html: PAGE, occurrence: 'Invoices' });
  assert.equal(second.changes[0].occurrence, invoices.id);
}));

test('a new layout is refused without a name, with a taken name or with an unknown occurrence', () => withStore((store) => {
  assert.throws(() => draftPageChange(store, { html: PAGE }), /name is missing/);
  assert.throws(() => draftPageChange(store, { name: '  ', html: PAGE }), /name is missing/);
  apply(store, draftPageChange(store, { name: 'Sales', html: PAGE }).changes);
  assert.throws(() => draftPageChange(store, { name: 'Sales', html: PAGE }), /already a layout "Sales"/);
  assert.throws(() => draftPageChange(store, { name: 'Other', html: PAGE, occurrence: 'Nowhere' }), /no table occurrence "Nowhere"/);
}));

test('an existing modern layout gets the new page, keeping its viewer and turning the bridge on', () => withStore((store) => {
  apply(store, draftPageChange(store, { name: 'Sales', html: PAGE }).changes);
  const layout = store.schema.layouts.find((l) => l.name === 'Sales')!;
  const before = store.design(layout.id)!.objects;
  const next = '<!doctype html><html><body><h1>Sales, new</h1></body></html>';
  const draft = draftPageChange(store, { layout: 'Sales', html: next });
  assert.equal(draft.layout, 'Sales');
  assert.deepEqual(draft.notes, ['Replaces the page of "Sales".']);
  assert.equal(draft.changes.length, 1);
  assert.equal(draft.changes[0].op, 'updateLayout');
  assert.equal(draft.changes[0].layout, layout.id);
  const objects = (draft.changes[0].design as { objects: { webUrl?: string; webOptions?: { jsBridge?: boolean; encodeUrl?: boolean } }[] }).objects;
  assert.equal(objects.length, before.length);
  assert.equal(objects[0].webUrl, pageFormula(next));
  assert.equal(objects[0].webOptions?.jsBridge, true);
  assert.equal(objects[0].webOptions?.encodeUrl, false);
  apply(store, draft.changes);
  assert.equal(pageOf(store, 'Sales')?.html, next);
}));

test('an existing layout must exist and be a modern one', () => withStore((store) => {
  assert.throws(() => draftPageChange(store, { layout: 'Nowhere', html: PAGE }), /no layout "Nowhere"/);
  // A table's own layout is a classic one: its objects are fields, not one web viewer showing a page.
  const classic = store.schema.layouts.find((l) => l.name === 'Customers')!;
  assert.ok(classic);
  assert.throws(() => draftPageChange(store, { layout: 'Customers', html: PAGE }), /"Customers" is not a modern layout/);
}));

test('a page too long for FileMaker Pro is still drafted, with a note saying so', () => withStore((store) => {
  const html = `<body>${'a'.repeat(FORMULA_LIMIT)}</body>`;
  const draft = draftPageChange(store, { name: 'Big', html });
  assert.equal(draft.changes[0].op, 'createLayout');
  assert.equal(draft.notes.length, 2);
  assert.match(draft.notes[0], new RegExp(`FileMaker Pro takes up to ${FORMULA_LIMIT.toLocaleString().replace(/[,.]/g, '\\$&')}`));
  const small = draftPageChange(store, { name: 'Small', html: PAGE });
  assert.equal(small.notes.length, 1);
}));

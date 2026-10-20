import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../src/index.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-phone-'));
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

test('phone layouts: stacked from a desktop layout, kept in step until edited by hand', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }, { name: 'Phone' }] }] as DesignOp[], { account: 'Admin' });
  const { applied: ops } = store.applyDesign([{ op: 'createLayout', name: 'Customers (phone)', phoneOf: 'Customers' }] as DesignOp[], { account: 'Admin' });
  // Logged as the design it starts with, so replaying the log makes the same layout.
  assert.equal(ops[0].op, 'createLayout');
  assert.ok((ops[0] as { design?: unknown }).design && !('phoneOf' in ops[0]));
  const phone = store.design('Customers (phone)')!;
  assert.equal(phone.width, 390);
  // Already one column, so the server's default stacking width must not stack it again.
  assert.deepEqual(phone.responsive, { stackBelow: 0 });
  assert.equal(phone.phone?.of, store.design('Customers')!.id);
  assert.equal(phone.tableOccurrenceId, store.design('Customers')!.tableOccurrenceId);
  // One column, inside the phone's width, fields tall enough to tap, nothing overlapping.
  for (const o of phone.objects) assert.ok(o.bounds.left === 12 && o.bounds.right <= 378, JSON.stringify(o.bounds));
  for (const f of phone.objects.filter((o) => o.kind === 'field')) assert.ok(f.bounds.bottom - f.bounds.top >= 44);
  const sorted = [...phone.objects].sort((a, b) => a.bounds.top - b.bounds.top);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].bounds.top >= sorted[i - 1].bounds.bottom);

  // A field added on the desktop layout shows up on the phone layout, in the same change.
  const desktop = store.design('Customers')!;
  const field = desktop.objects.find((o) => o.kind === 'field')!;
  const added = { ...structuredClone(field), id: 900, bounds: { ...field.bounds, top: field.bounds.top + 200, bottom: field.bounds.bottom + 200 } };
  const r = store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...desktop.objects, added] } }] as DesignOp[], { account: 'Admin' });
  assert.deepEqual(r.applied.map((o) => [o.op, (o as { layout?: number }).layout]), [['updateLayout', desktop.id], ['updateLayout', phone.id]]);
  assert.ok(store.design('Customers (phone)')!.objects.some((o) => o.id === 900));

  // Edited by hand, it stays as edited when the desktop layout changes again...
  const mine = store.design('Customers (phone)')!;
  store.applyDesign([{ op: 'updateLayout', layout: mine.id, design: { objects: mine.objects.filter((o) => o.id !== 900) } }] as DesignOp[], { account: 'Admin' });
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: desktop.objects } }] as DesignOp[], { account: 'Admin' });
  assert.ok(!store.design('Customers (phone)')!.objects.some((o) => o.id === 900));
  const kept = store.design('Customers (phone)')!.objects.length;
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...desktop.objects, added] } }] as DesignOp[], { account: 'Admin' });
  assert.equal(store.design('Customers (phone)')!.objects.length, kept);
  // ...until rebuilt, which also starts it following again.
  store.applyDesign([{ op: 'updateLayout', layout: mine.id, rebuildPhone: true }] as DesignOp[], { account: 'Admin' });
  assert.ok(store.design('Customers (phone)')!.objects.some((o) => o.id === 900));
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: desktop.objects } }] as DesignOp[], { account: 'Admin' });
  assert.ok(!store.design('Customers (phone)')!.objects.some((o) => o.id === 900));

  assert.throws(() => store.applyDesign([{ op: 'updateLayout', layout: 'Customers', rebuildPhone: true }] as DesignOp[]), /isn't a phone layout/);
}));

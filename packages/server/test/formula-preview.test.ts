// previewFormula (server/src/formula-preview.ts): a formula's results on a few records while it is being written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { previewFormula } from '../src/formula-preview.ts';

function withStore(fn: (store: Store, ids: number[], occurrence: number) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-formula-preview-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] },
        { op: 'createTable', name: 'Empty', fields: [{ name: 'Name' }] },
      ] as DesignOp[], { account: 'Admin' });
      const ids = ['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Gus'].map((Name) => store.create('Customers', { Name }).recordId);
      const occurrence = store.schema.layouts.find((l) => l.name === 'Customers')!.tableOccurrenceId!;
      fn(store, ids, occurrence);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('no occurrence, or none a layout shows, gives no preview', () => withStore((store) => {
  assert.equal(previewFormula(store, undefined, '1'), undefined);
  assert.equal(previewFormula(store, 999_999, '1'), undefined);
}));

test('an occurrence with no records gives no preview', () => withStore((store) => {
  const empty = store.schema.layouts.find((l) => l.name === 'Empty')!.tableOccurrenceId;
  assert.equal(previewFormula(store, empty, '1'), undefined);
}));

test('the formula is worked out on the first five records, in order', () => withStore((store, ids, occ) => {
  const p = previewFormula(store, occ, 'Customers::Name & "!"')!;
  assert.equal(p.layout, 'Customers');
  assert.deepEqual(p.results.map((r) => r.value), ['Ann!', 'Bob!', 'Cy!', 'Di!', 'Ed!']);
  assert.deepEqual(p.results.map((r) => r.recordId), ids.slice(0, 5));
  assert.equal(previewFormula(store, occ, '1', {}, 2)!.results.length, 2, 'a smaller limit');
}));

test('the record the person is looking at comes first, only when it is on that layout', () => withStore((store, ids, occ) => {
  const at = ids[3];
  const p = previewFormula(store, occ, 'Customers::Name', { layout: 'Customers', recordId: at })!;
  assert.equal(p.results[0].recordId, at);
  assert.equal(p.results[0].value, 'Di');
  assert.equal(p.results.length, 5);
  assert.equal(new Set(p.results.map((r) => r.recordId)).size, 5, 'not listed twice');
  // Another layout, or an id that is not a whole number: the plain order.
  assert.equal(previewFormula(store, occ, '1', { layout: 'Empty', recordId: at })!.results[0].recordId, ids[0]);
  assert.equal(previewFormula(store, occ, '1', { layout: 'Customers', recordId: '4' })!.results[0].recordId, ids[0]);
}));

test('a formula that fails shows its error on each record, and a long result is cut', () => withStore((store, _ids, occ) => {
  const bad = previewFormula(store, occ, 'Customers::NoSuchField')!;
  assert.ok(bad.results.every((r) => r.value === undefined && typeof r.error === 'string' && r.error.length > 0 && r.error.length <= 300));
  const long = previewFormula(store, occ, `"${'x'.repeat(600)}"`, {}, 1)!;
  assert.equal(long.results[0].value!.length, 501);
  assert.ok(long.results[0].value!.endsWith('…'));
}));

test('a preview changes nothing', () => withStore((store, ids, occ) => {
  previewFormula(store, occ, 'Customers::Name');
  assert.equal(store.findIds(store.layout('Customers')).length, ids.length);
}));

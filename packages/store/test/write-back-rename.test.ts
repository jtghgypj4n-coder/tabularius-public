import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writeBackKit } from '../src/index.ts';

test('renaming a date field does not report edits to field types', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-writeback-rename-'));
  try {
    const path = join(dir, 't.sqlite');
    createStore(path);
    const store = new Store(path, 'T');
    try {
      store.applyDesign([{ op: 'createTable', name: 'T', fields: [
        { name: 'date', type: 'date' }, { name: 'Created', type: 'date' },
      ] }]);
      const before = structuredClone(store.schema);
      store.applyDesign([{ op: 'updateField', table: 'T', field: 'date', name: 'Day' }]);
      assert.deepEqual(writeBackKit(before, store.schema).byHand, ['Rename field "T::date" to "Day".']);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('field renames follow calculations once, including a rotation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-writeback-rename-'));
  try {
    const path = join(dir, 't.sqlite');
    createStore(path);
    const store = new Store(path, 'T');
    try {
      store.applyDesign([{ op: 'createTable', name: 'T', fields: [
        { name: 'Total', type: 'text' }, { name: 'Gross', type: 'text' },
        { name: 'Label', type: 'text', kind: 'calculation', calculation: 'Total & "x"' },
      ] }]);
      const before = structuredClone(store.schema);
      store.applyDesign([{ op: 'updateField', table: 'T', field: 'Total', name: 'Amount' }]);
      assert.equal(store.schema.tables.find((table) => table.name === 'T')?.fields.find((field) => field.name === 'Label')?.calculation,
        'Amount & "x"');
      assert.deepEqual(writeBackKit(before, store.schema).byHand, ['Rename field "T::Total" to "Amount".']);
      store.applyDesign([{ op: 'updateField', table: 'T', field: 'Gross', name: 'Net' }]);
      store.applyDesign([{ op: 'updateField', table: 'T', field: 'Amount', name: 'Gross' }]);
      assert.equal(store.schema.tables.find((table) => table.name === 'T')?.fields.find((field) => field.name === 'Label')?.calculation,
        'Gross & "x"');
      assert.deepEqual(writeBackKit(before, store.schema).byHand, [
        'Rename field "T::Total" to "Gross".',
        'Rename field "T::Gross" to "Net".',
      ]);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

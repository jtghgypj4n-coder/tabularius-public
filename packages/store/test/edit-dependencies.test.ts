import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type FieldSpec } from '../src/index.ts';

test('pending dependency discovery is linear and reused for unrelated reads', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-edit-deps-'));
  const path = join(dir, 'C.sqlite');
  createStore(path);
  const store = new Store(path, 'C');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const count = 300;
  const fields: FieldSpec[] = [{ name: 'Amount', type: 'number' }, { name: 'Note' }];
  for (let i = count; i > 0; i--) fields.push({ name: `C${i}`, type: 'number', kind: 'calculation', calculation: `${i === 1 ? 'Amount' : `C${i - 1}`} + 1` });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields }]);
  const id = store.create('Items', { Amount: 2, Note: 'plain' }).recordId;
  const table = store.schema.tables.find((x) => x.name === 'Items')!;
  const original = store.calc.formula.bind(store.calc);
  let visits = 0;
  t.mock.method(store.calc, 'formula', (...args: Parameters<typeof original>) => { visits++; return original(...args); });
  const affected = store.calc.editedCalculations(table, ['Amount']);
  assert.equal(affected.size, count, 'the entire reversed chain is discovered');
  assert.ok(visits <= count * 2, `dependency discovery visited ${visits} formulas for ${count} fields`);
  visits = 0;
  for (let i = 0; i < 10; i++) {
    assert.equal(store.get('Items', id, 'iso', undefined, undefined, { fields: ['Note'], edits: { Amount: 5 } }).fieldData.Note, 'plain');
  }
  assert.equal(visits, 0, 'unrelated reads reuse the dependency graph');
  assert.equal(store.get('Items', id, 'iso', undefined, undefined, { fields: ['C300'], edits: { Amount: 5 } }).fieldData.C300, 305);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Extra', type: 'number', kind: 'calculation', calculation: 'C300 + 1' }]);
  assert.equal(store.get('Items', id, 'iso', undefined, undefined, { fields: ['Extra'], edits: { Amount: 5 } }).fieldData.Extra, 306, 'design changes rebuild the graph');
});

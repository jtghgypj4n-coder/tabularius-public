import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import type { Table, Field } from '../../fmp12/src/index.ts';

// What a new record's serial field draws from; the record itself is not needed.
const nextSerial = (store: Store, t: Table, f: Field) =>
  (store.calc as unknown as { nextSerial(t: Table, f: Field): string | undefined }).nextSerial(t, f);

function file(run: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-proto-'));
  const path = join(dir, 'Test.sqlite');
  createStore(path);
  const store = new Store(path, 'Test');
  try { run(store); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

// Names that are properties of every object; a table or field may be called any of them.
const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

test('serial numbers and globals are kept per table and field, whatever the names are', () => {
  for (const table of NAMES) {
    for (const field of NAMES) file((store) => {
      store.applyDesign([{ op: 'createTable', name: table, fields: [
        { name: field, type: 'number', options: { autoEnter: { serial: { next: '5', increment: 1 } } } },
        { name: 'G', options: { global: true } },
      ] }]);
      const t = store.schema.tables[0];
      const serial = t.fields[0];
      const g = t.fields[1];
      assert.equal(store.calc.peekSerial(t, serial), '5');
      assert.equal(nextSerial(store, t, serial), '5');
      assert.equal(nextSerial(store, t, serial), '6');
      assert.equal(store.calc.peekSerial(t, serial), '7');
      assert.equal(store.calc.setNextSerial(t, serial, '40'), true);
      assert.equal(store.calc.peekSerial(t, serial), '40');
      assert.equal(store.calc.globalValue(t, g), null);
      store.calc.setGlobal(t, g, 'kept');
      assert.equal(store.calc.globalValue(t, g), 'kept');
    });
  }
});

test('a table or field named like an object property does not change objects in the process', () => {
  const marks = ['polluted', 'G', 'Serial'];
  const clean = () => marks.every((m) => !(m in {}) && !Object.hasOwn(Object, m));
  assert.equal(clean(), true);
  try {
    for (const table of ['__proto__', 'constructor']) file((store) => {
      store.applyDesign([{ op: 'createTable', name: table, fields: [
        { name: 'polluted', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
        { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
        { name: 'G', options: { global: true } },
      ] }]);
      const t = store.schema.tables[0];
      nextSerial(store, t, t.fields[0]);
      store.calc.setNextSerial(t, t.fields[1], '9');
      store.calc.setGlobal(t, t.fields[2], 'x');
      assert.equal(store.calc.peekSerial(t, t.fields[0]), '2');
      assert.equal(store.calc.globalValue(t, t.fields[2]), 'x');
    });
    assert.equal(clean(), true);
  } finally {
    for (const m of marks) { delete (Object.prototype as Record<string, unknown>)[m]; delete (Object as unknown as Record<string, unknown>)[m]; }
  }
});

test('stored serials and globals survive a reopen when the table is named like an object property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-proto-'));
  const path = join(dir, 'Test.sqlite');
  createStore(path);
  let store = new Store(path, 'Test');
  try {
    store.applyDesign([{ op: 'createTable', name: '__proto__', fields: [
      { name: 'S', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
      { name: 'G', options: { global: true } },
    ] }]);
    nextSerial(store, store.schema.tables[0], store.schema.tables[0].fields[0]);
    store.calc.setGlobal(store.schema.tables[0], store.schema.tables[0].fields[1], 'v');
    store.close();
    store = new Store(path, 'Test');
    const t = store.schema.tables[0];
    assert.equal(store.calc.peekSerial(t, t.fields[0]), '2');
    assert.equal(store.calc.globalValue(t, t.fields[1]), 'v');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('records in a table with an ordinary name still draw serials', () => file((store) => {
  store.applyDesign([{ op: 'createTable', name: 'Plain', fields: [
    { name: 'N', type: 'number', options: { autoEnter: { serial: { next: '3', increment: 2 } } } },
  ] }]);
  const a = store.create('Plain', {}).recordId;
  const b = store.create('Plain', {}).recordId;
  assert.deepEqual([a, b].map((id) => store.get('Plain', id).fieldData.N), [3, 5]);
}));

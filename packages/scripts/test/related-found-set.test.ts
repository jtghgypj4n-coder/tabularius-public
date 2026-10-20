// Go to Related Record [ Match all records in the found set ] follows every record of the found set, however many,
// through relationships with several match fields and through comparative ones (<, ≤, >, ≥, ≠). It used to stop
// after the first 1,000 records there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

test('Go to Related Record from a found set of 1,200 reaches all their related records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-gtrr-all-'));
  createStore(join(dir, 'G.sqlite'));
  const store = new Store(join(dir, 'G.sqlite'), 'G');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Region', type: 'text' }, { name: 'No', type: 'number' }] },
      { op: 'createTable', name: 'Lines', fields: [{ name: 'Region', type: 'text' }, { name: 'No', type: 'number' }] },
      { op: 'createTable', name: 'Notes', fields: [{ name: 'No', type: 'number' }] },
      // Two match fields, and a comparative pair that comes to equality.
      { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'Region', right: 'Region' }, { left: 'No', right: 'No' }] },
      { op: 'createRelationship', left: 'Orders', right: 'Notes', predicates: [{ left: 'No', right: 'No', operator: '≤' }, { left: 'No', right: 'No', operator: '≥' }] },
    ] as never);
    for (let i = 1; i <= 1200; i++) {
      store.create('Orders', { Region: i % 2 ? 'N' : 'S', No: String(i) });
      store.create('Lines', { Region: i % 2 ? 'N' : 'S', No: String(i) });
      store.create('Lines', { Region: i % 2 ? 'S' : 'N', No: String(i) }); // same No, the other region: not related
      store.create('Notes', { No: String(i) });
    }
    const go = async (table: string) => {
      const name = `To ${table}`;
      store.applyDesign([{ op: 'createScript', name, text: `Go to Layout [ “Orders” ]\nShow All Records\nGo to Related Record [ Show only related records ; Match all records in the found set ; From table: “${table}” ; Using layout: “${table}” ]\nExit Script [ Text Result: Get ( LastError ) & "/" & Get ( FoundCount ) ]` }] as never);
      return (await runScript(store, store.schema.scripts.find((s) => s.name === name)!)).result;
    };
    assert.equal(await go('Lines'), '0/1200');
    assert.equal(await go('Notes'), '0/1200');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

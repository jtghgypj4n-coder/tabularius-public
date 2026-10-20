// LookupNext ( sourceField ; Lower|Higher ): the related value, or with no related record the one whose match value
// is the next lower or higher, in a field's calculation and in a script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-lookupnext-'));
  createStore(join(dir, 'L.sqlite'));
  store = new Store(join(dir, 'L.sqlite'), 'L');
  store.applyDesign([
    { op: 'createTable', name: 'Shipments', fields: [{ name: 'Weight', type: 'number' },
      { name: 'Lower', kind: 'calculation', type: 'number', calculation: 'LookupNext ( Rates::Price ; Lower )', options: { unstored: true } },
      { name: 'Higher', kind: 'calculation', type: 'number', calculation: 'LookupNext ( Rates::Price ; Higher )', options: { unstored: true } },
      { name: 'Exact', kind: 'calculation', type: 'number', calculation: 'Lookup ( Rates::Price ; -1 )', options: { unstored: true } }] },
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Weight', type: 'number' }, { name: 'Price', type: 'number' }] },
  ] as never);
  store.applyDesign([{ op: 'createRelationship', left: 'Shipments', right: 'Rates', predicates: [{ left: 'Weight', right: 'Weight' }] }] as never);
  for (const [w, p] of [[1, 5], [5, 9], [10, 14]]) store.create('Rates', { Weight: String(w), Price: String(p) });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const read = (weight: string) => {
  const id = store.create('Shipments', { Weight: weight }).recordId;
  const d = store.get('Shipments', id).fieldData;
  return [d.Lower, d.Higher, d.Exact].join('|');
};

test('a calculation field takes the next lower or higher match when none is exact', () => {
  assert.equal(read('5'), '9|9|9');
  assert.equal(read('7'), '9|14|-1');
  assert.equal(read('0'), '|5|-1');
  assert.equal(read('11'), '14||-1');
});

test('a script gets the same, from the record as the script left it', async () => {
  const id = store.create('Shipments', { Weight: '2' }).recordId;
  const steps = parseScriptText('Set Field [ Shipments::Weight ; 6 ]\nExit Script [ Text Result: LookupNext ( Rates::Price ; Lower ) & "|" & LookupNext ( Rates::Price ; Higher ) ]', store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
  const r = await runScript(store, { id: 1, name: 'l', steps } as Script, { layout: 'Shipments', foundSet: [id] });
  assert.equal(r.error, 0);
  assert.equal(r.result, '9|14');
});

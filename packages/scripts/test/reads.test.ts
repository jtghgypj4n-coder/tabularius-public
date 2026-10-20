import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  createStore(join(dir, 'Reads.sqlite'));
  store = new Store(join(dir, 'Reads.sqlite'), 'Reads');
  store.applyDesign([{ op: 'createTable', name: 'Quotes', fields: [{ name: 'Id', type: 'number' }] }]);
  const table = 'Quotes';
  store.applyDesign([
    // A slow unstored calculation, like a private sample's months-of-contact calculation.
    { op: 'createField', table, name: 'Slow', type: 'number', kind: 'calculation', options: { unstored: true }, calculation: 'While ( [ i = Id ] ; i < 40000 ; [ i = i + 1 ] ; i )' },
    { op: 'createField', table, name: 'Ids', type: 'text', kind: 'summary', summary: { type: 'list', field: 'Id' } },
  ]);
  for (let i = 1; i <= 150; i++) store.create('Quotes', { Id: String(i) });
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

test('reading one field or a summary leaves the record\'s other unstored calculations alone', async () => {
  const ids = store.findIds('Quotes');
  const s = { id: 9999, name: 'test', steps: [
    { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$ids', value: 'Quotes::Ids' } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'ValueCount ( $ids ) & "/" & Quotes::Id' } },
  ] } as Script;
  const started = process.cpuUsage();
  const r = await runScript(store, s, { layout: 'Quotes', foundSet: ids });
  assert.equal(r.result, '150/1');
  // Computing Slow for each of the 150 records takes seconds; none of it is needed.
  const elapsed = process.cpuUsage(started);
  const cpuMs = (elapsed.user + elapsed.system) / 1000;
  assert.ok(cpuMs < 1500, `used ${cpuMs.toFixed(1)} ms of CPU`);
  // Asked for, the calculation is still computed.
  assert.equal(store.get(store.occurrence('Quotes'), ids[0], 'iso', undefined, undefined, { fields: ['Slow'] }).fieldData.Slow, 40000);
  assert.deepEqual(Object.keys(store.get('Quotes', ids[0], 'iso', undefined, undefined, { fields: ['Id'] }).fieldData), ['Id']);
});

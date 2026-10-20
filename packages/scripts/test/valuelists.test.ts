import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-vl-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

test('ValueListItems gives a field list\'s values, related ones for the current record', async () => {
  createStore(join(dir, 'Lists.sqlite'));
  const store = new Store(join(dir, 'Lists.sqlite'), 'Lists');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Product' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createValueList', name: 'Names', field: { occurrence: 'Customers', field: 'Name' } },
    { op: 'createValueList', name: 'Bought', field: { occurrence: 'Orders', field: 'Product', related: 'Customers' } },
  ]);
  store.create('Customers', { Id: '1', Name: 'Zed' });
  store.create('Customers', { Id: '2', Name: 'Ada' });
  for (const [c, p] of [[1, 'Tea'], [2, 'Cake']]) store.create('Orders', { CustomerId: String(c), Product: String(p) });
  const r = await runScript(store, { id: 9999, name: 'test', steps: [
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'ValueListItems ( Get ( FileName ) ; "Names" ) & "|" & ValueListItems ( Get ( FileName ) ; "Bought" )' } },
  ] } as Script, { layout: 'Customers' });
  assert.equal(r.result, 'Ada\rZed|Tea');
  store.close();
});

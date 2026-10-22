// A table occurrence's color is drawn into the Relationships graph as a style: only a color is accepted, not a
// declaration that could follow one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('createOccurrence and updateOccurrence take a color and nothing else', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tab-color-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createStore(join(dir, 'T.sqlite'));
  const store = new Store(join(dir, 'T.sqlite'), 'T');
  t.after(() => store.close());
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }]);
  const colors = () => store.schema.tableOccurrences.map((o) => o.color);
  const hostile = ['red;cursor:url(https://evil.example/beacon.png),auto', 'url(https://evil.example/x.png)', 'red}body{display:none', '#fff;stroke:red', 'rgb(1 2 3);x:y'];
  for (const color of hostile) {
    assert.throws(() => store.applyDesign([{ op: 'updateOccurrence', occurrence: 'People', color }]), /color/, color);
    assert.throws(() => store.applyDesign([{ op: 'createOccurrence', name: 'Copy', table: 'People', color }]), /color/, color);
  }
  assert.deepEqual(colors(), [undefined]);
  for (const color of ['#c7d7ee', '#fff', 'rgb(199 215 238)', 'rgba(1, 2, 3, 0.5)', 'steelblue']) {
    store.applyDesign([{ op: 'updateOccurrence', occurrence: 'People', color }]);
    assert.deepEqual(colors(), [color]);
  }
  store.applyDesign([{ op: 'updateOccurrence', occurrence: 'People', color: '' }]);
  assert.ok(!store.schema.tableOccurrences[0].color);
});

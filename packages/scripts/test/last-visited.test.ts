// Auto-enter "value from last visited record": New Record copies the field from the record the window was on.
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-last-visited-'));
  createStore(join(dir, 'L.sqlite'));
  store = new Store(join(dir, 'L.sqlite'), 'L');
  store.applyDesign([{ op: 'createTable', name: 'Visits', fields: [{ name: 'Name' }, { name: 'City', options: { autoEnter: { lastVisited: true } } }] }]);
  store.create('Visits', { Name: 'A', City: 'Leeds' });
  store.create('Visits', { Name: 'B', City: 'York' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const run = (text: string) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout: 'Visits', foundSet: store.findIds('Visits') });

test('New Record takes the value from the record the window was on', async () => {
  const r = await run(`
    Go to Record/Request/Page [ First ]
    New Record/Request
    Set Variable [ $first ; Value: Visits::City ]
    Go to Record/Request/Page [ 2 ]
    New Record/Request
    Exit Script [ Result: $first & "/" & Visits::City & "/" & Visits::Name ]`);
  assert.equal(r.result, 'Leeds/York/');
});

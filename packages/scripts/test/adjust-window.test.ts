// Adjust Window. As in FileMaker WebDirect ("only the Resize to Fit option is available, which works with cards"),
// Resize to Fit gives a card back its layout's own size; other options and other windows are left as they are.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript, type OpenWindow } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-adjust-'));
  createStore(join(dir, 'W.sqlite'));
  store = new Store(join(dir, 'W.sqlite'), 'W');
  store.applyDesign([{ op: 'createTable', name: 'Main', fields: [{ name: 'Name', type: 'text' }] }]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const main: OpenWindow = { id: 'MAIN-1', name: 'W', style: 'document', layout: 'Main' };
const card: OpenWindow = { id: 'CARD-1', name: 'Card', style: 'card', layout: 'Main', height: 300, width: 400, top: 10, left: 20 };
const run = (lines: string[], start: OpenWindow) => {
  store.applyDesign([{ op: 'createScript', name: `t${Date.now()}${Math.random()}`, text: lines.join('\n') }]);
  const s = store.schema.scripts[store.schema.scripts.length - 1];
  return runScript(store, s.name, { layout: 'Main', startWindow: start, openWindows: [main, card], });
};

test('Resize to Fit drops a card\'s own size and keeps its place', async () => {
  const r = await run(['Adjust Window [ Resize to Fit ]'], card);
  assert.equal(r.error, 0);
  assert.deepEqual(r.window && { height: r.window.height, width: r.window.width, top: r.window.top, left: r.window.left }, { height: undefined, width: undefined, top: 10, left: 20 });
});

test('Maximize leaves a card as it is', async () => {
  const r = await run(['Adjust Window [ Maximize ]'], card);
  assert.deepEqual(r.window && { height: r.window.height, width: r.window.width }, { height: 300, width: 400 });
});

test('Freeze Window and Refresh Window tell the client, so a dialog opens over the screen as it was', async () => {
  const r = await run(['Freeze Window', 'Refresh Window'], main);
  assert.equal(r.error, 0);
  assert.deepEqual(r.actions.map((a) => a.step), ['Freeze Window', 'Refresh Window']);
});

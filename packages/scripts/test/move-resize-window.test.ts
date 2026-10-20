// Move/Resize Window. In a web browser, as in FileMaker WebDirect ("this script step is supported only for cards"),
// it sizes and places a card (or another window drawn over the one behind it), and leaves a document window, which
// fills the browser window, as it is. A value left empty keeps the window's own (Claris).
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-move-resize-'));
  createStore(join(dir, 'W.sqlite'));
  store = new Store(join(dir, 'W.sqlite'), 'W');
  store.applyDesign([{ op: 'createTable', name: 'Main', fields: [{ name: 'Name', type: 'text' }] }]);
  store.create('Main', { Name: 'one' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const main: OpenWindow = { id: 'MAIN-1', name: 'W', style: 'document', layout: 'Main' };
const size = 'Get ( WindowHeight ) & "," & Get ( WindowWidth ) & "," & Get ( WindowTop ) & "," & Get ( WindowLeft )';
const run = (lines: string[], opts: Parameters<typeof runScript>[2] = {}) => {
  store.applyDesign([{ op: 'createScript', name: `t${Date.now()}${Math.random()}`, text: lines.join('\n') }]);
  const s = store.schema.scripts[store.schema.scripts.length - 1];
  return runScript(store, s.name, { layout: 'Main', startWindow: main, openWindows: [main], ...opts });
};

test('a card is moved and resized; a value left out keeps what the card had; the result tells the browser', async () => {
  const r = await run([
    'New Window [ Style: Card ; "Card" ; 300 ; 400 ; 10 ; 20 ]',
    `Set Variable [ $before ; Value: ${size} ]`,
    'Move/Resize Window [ Current Window ; Height: 200 ; Width:  ; Top: 30 ]',
    `Exit Script [ Text Result: $before & "|" & ${size} ]`,
  ]);
  assert.equal(r.error, 0);
  assert.equal(r.result, '300,400,10,20|200,400,30,20');
  assert.deepEqual(r.window && { height: r.window.height, width: r.window.width, top: r.window.top, left: r.window.left }, { height: 200, width: 400, top: 30, left: 20 });
});

test('a window is found by name, then by its UUID, ignoring case; one that is not open is error 112', async () => {
  const r = await run([
    'Set Error Capture [ On ]',
    'New Window [ Style: Card ; "Card" ; 300 ; 400 ]',
    'Move/Resize Window [ Name: "CARD" ; Height: 250 ]',
    'Move/Resize Window [ Name: Lower ( Get ( WindowUUID ) ) ; Width: 350 ]',
    'Move/Resize Window [ Name: "Nowhere" ; Height: 100 ]',
    `Exit Script [ Text Result: Get ( LastError ) & "|" & ${size} ]`,
  ]);
  assert.equal(r.result, '112|250,350,0,0');
});

test("a document window isn't moved or resized: it fills the browser window", async () => {
  const r = await run([
    'Move/Resize Window [ Current Window ; Height: 200 ; Width: 300 ; Top: 5 ; Left: 5 ]',
    `Exit Script [ Text Result: Get ( LastError ) & "|" & ${size} ]`,
  ], { window: { device: 1, width: 1200, height: 800, contentWidth: 1200, contentHeight: 760, screenWidth: 1440, screenHeight: 900, scale: 2, orientation: 0 } });
  assert.equal(r.result, '0|800,1200,0,0');
  assert.deepEqual(r.window, { id: 'MAIN-1', name: 'W', style: 'document' });
});

test('a card keeps the size and place an earlier run gave it, and is never made smaller than 50 points', async () => {
  const card: OpenWindow = { id: 'CARD-1', name: 'Card', style: 'card', layout: 'Main', height: 300, width: 400, top: 10, left: 20 };
  const r = await run([
    'Move/Resize Window [ Current Window ; Height: 0 ; Width: -10 ]',
    `Exit Script [ Text Result: ${size} ]`,
  ], { startWindow: card, openWindows: [main, card] });
  assert.equal(r.result, '50,50,10,20');
});

test("OnLayoutSizeChange runs when a window opens and when Move/Resize Window changes its size, not when it only moves it", async () => {
  store.applyDesign([{ op: 'createScript', name: 'Sized', text: 'Set Variable [ $$log ; Value: $$log & Get ( WindowHeight ) & ";" ]' }]);
  const sized = store.schema.scripts.find((s) => s.name === 'Sized')!.id;
  store.applyDesign([{ op: 'updateLayout', layout: 'Main', design: { triggers: [{ event: 'OnLayoutSizeChange', scriptId: sized }] } }] as never);
  try {
    const r = await run([
      'Set Variable [ $$log ; Value: "" ]',
      'Move/Resize Window [ Current Window ; Height: 200 ]',
      'New Window [ Style: Card ; "Card" ; 300 ; 400 ]',
      'Move/Resize Window [ Current Window ; Top: 50 ; Left: 50 ]',
      'Move/Resize Window [ Current Window ; Height: 250 ]',
      'Move/Resize Window [ Current Window ; Height: 250 ]',
      'Exit Script [ Text Result: $$log ]',
    ]);
    assert.equal(r.result, '300;250;');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Main', design: { triggers: [] } }] as never);
  }
});

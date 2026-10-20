// Show/Hide Text Ruler, Allow Formatting Bar and Enable Touch Keyboard set a state of the active window, and Set Layout
// Object Animation one for the script, that Get ( TextRulerVisible / AllowFormattingBarState / TouchKeyboardState /
// ScriptAnimationState ) read back. Each is 0 until a script sets it (Claris: these functions return 0 where the
// feature isn't supported, as on a server). Claris pages: Get ( TextRulerVisible ), Get ( AllowFormattingBarState ),
// Get ( TouchKeyboardState ), Get ( ScriptAnimationState ) return 1 for true, else 0; Set Layout Object Animation
// "affects all script-initiated animations in all windows"; Allow Formatting Bar "only affects the active window".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stepLine } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-chrome-'));
  createStore(join(dir, 'W.sqlite'));
  store = new Store(join(dir, 'W.sqlite'), 'W');
  store.applyDesign([{ op: 'createTable', name: 'Main', fields: [{ name: 'Name', type: 'text' }] }]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (lines: string[]) => {
  store.applyDesign([{ op: 'createScript', name: `t${Date.now()}${Math.random()}`, text: lines.join('\n') }]);
  const s = store.schema.scripts[store.schema.scripts.length - 1];
  return runScript(store, s.name, { layout: 'Main', startWindow: { id: 'MAIN-1', name: 'W', style: 'document', layout: 'Main' }, openWindows: [{ id: 'MAIN-1', name: 'W', style: 'document', layout: 'Main' }] });
};
const states = 'Get ( TextRulerVisible ) & Get ( AllowFormattingBarState ) & Get ( TouchKeyboardState ) & Get ( ScriptAnimationState )';

test('each state is 0 until a script sets it, then reads back what the step set, Toggle included', async () => {
  const r = await run([
    `Set Variable [ $a ; Value: ${states} ]`,
    'Show/Hide Text Ruler [ Show ]',
    'Allow Formatting Bar [ On ]',
    'Enable Touch Keyboard [ On ]',
    'Set Layout Object Animation [ On ]',
    `Set Variable [ $b ; Value: ${states} ]`,
    'Show/Hide Text Ruler [ Toggle ]',
    'Enable Touch Keyboard [ Toggle ]',
    'Allow Formatting Bar [ Off ]',
    `Set Variable [ $c ; Value: ${states} ]`,
    'Show/Hide Text Ruler [ Toggle ]',
    'Show/Hide Text Ruler [ Hide ]',
    'Set Layout Object Animation [ Off ]',
    'Enable Touch Keyboard [ Off ]',
    `Set Variable [ $d ; Value: ${states} ]`,
    'Exit Script [ Text Result: List ( $a ; $b ; $c ; $d ) ]',
  ]);
  assert.equal(r.error, 0);
  assert.deepEqual(r.result.split('\r'), ['0000', '1111', '0001', '0000']);
});

test('the text ruler, formatting bar and touch keyboard belong to a window; the animation setting to the script', async () => {
  const r = await run([
    'Show/Hide Text Ruler [ Show ]',
    'Allow Formatting Bar [ On ]',
    'Enable Touch Keyboard [ On ]',
    'Set Layout Object Animation [ On ]',
    'New Window [ "Other" ]',
    `Set Variable [ $other ; Value: ${states} ]`,
    'Allow Formatting Bar [ On ]',
    'Select Window [ Name: "W" ]',
    `Set Variable [ $first ; Value: ${states} ]`,
    'Select Window [ Name: "Other" ]',
    `Set Variable [ $again ; Value: ${states} ]`,
    'Exit Script [ Text Result: List ( $other ; $first ; $again ) ]',
  ]);
  assert.equal(r.error, 0);
  assert.deepEqual(r.result.split('\r'), ['0001', '1111', '0101']);
});

test('the steps read back as the script text they came from', () => {
  for (const line of ['Show/Hide Text Ruler [ Show ]', 'Show/Hide Text Ruler [ Toggle ]', 'Allow Formatting Bar [ Off ]', 'Enable Touch Keyboard [ Toggle ]', 'Enable Touch Keyboard [ On ]', 'Set Layout Object Animation [ On ]']) {
    const step = parseScriptText(line, store.schema)[0];
    assert.equal(stepLine(step.name ?? line.split(' [')[0], step.params), line);
  }
});

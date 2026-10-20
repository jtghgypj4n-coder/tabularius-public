// A script that opens another hosted file (Open File, or Perform Script of one of its scripts) opens it as a person
// would: on its "Switch to layout", running its OnFirstWindowOpen script. Close File runs its OnLastWindowClose.
// Both used to open and close the file without running either.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

let dir: string;
let a: Store;
let b: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-open-file-triggers-'));
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  a = open('A');
  b = open('B');
  b.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] },
    { op: 'createLayout', name: 'Home', occurrence: 'Other' },
    // Global variables belong to the file they are set in, so each script reports through its own file's.
    { op: 'createScript', name: 'Startup', text: 'Set Variable [ $$opened ; Value: $$opened + 1 ]\nSet Variable [ $$layout ; Value: Get ( LayoutName ) ]' },
    { op: 'createScript', name: 'Shutdown', text: 'Set Variable [ $$closed ; Value: $$closed + 1 ]' },
    { op: 'createScript', name: 'Report', text: 'Exit Script [ Text Result: $$opened & "|" & $$layout & "|" & $$closed ]' },
    { op: 'createScript', name: 'Where', text: 'Exit Script [ Text Result: Get ( LayoutName ) ]' },
  ]);
  b.applyDesign([{ op: 'setFileOptions', openLayout: 'Home', onFirstWindowOpen: 'Startup', onLastWindowClose: 'Shutdown' }]);
  a.applyDesign([
    { op: 'createTable', name: 'Here', fields: [{ name: 'Name' }] },
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
  ]);
  a.resolveFile = (name) => name === 'B' ? b : undefined;
});

after(() => {
  a?.close();
  b?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('Open File runs the file\'s OnFirstWindowOpen once, on its Switch to layout, and the script stays in its window', async () => {
  a.applyDesign([{ op: 'createScript', name: 'OpenTwice', text: [
    'Open File [ “B” ]',
    'Open File [ “B” ]',
    'Perform Script [ Specified: By name ; "B::Report" ]',
    'Exit Script [ Text Result: Get ( ScriptResult ) & "|" & Get ( LayoutName ) ]',
  ].join('\n') }]);
  assert.equal((await runScript(a, 'OpenTwice', { layout: 'Here' })).result, '1|Home||Here');
});

test('Perform Script in a file that isn\'t open opens it first: its OnFirstWindowOpen runs before the script', async () => {
  a.applyDesign([{ op: 'createScript', name: 'CallB', text: [
    'Perform Script [ Specified: By name ; "B::Where" ]',
    'Set Variable [ $where ; Value: Get ( ScriptResult ) ]',
    'Perform Script [ Specified: By name ; "B::Report" ]',
    'Exit Script [ Text Result: $where & "|" & Get ( ScriptResult ) ]',
  ].join('\n') }]);
  assert.equal((await runScript(a, 'CallB', { layout: 'Here' })).result, 'Home|1|Home|');
});

test('Close File runs the file\'s OnLastWindowClose before closing its window; a file not open runs nothing', async () => {
  a.applyDesign([{ op: 'createScript', name: 'OpenClose', text: [
    'Close File [ “B” ]',
    'Open File [ “B” ]',
    'Close File [ “B” ]',
    // Opened again: a new first window, so OnFirstWindowOpen runs again.
    'Perform Script [ Specified: By name ; "B::Report" ]',
    'Exit Script [ Text Result: Get ( ScriptResult ) ]',
  ].join('\n') }]);
  assert.equal((await runScript(a, 'OpenClose', { layout: 'Here' })).result, '2|Home|1');
});

test('Close Window on another file\'s last window runs its OnLastWindowClose first', async () => {
  a.applyDesign([{ op: 'createScript', name: 'CloseWindow', text: [
    'Open File [ “B” ]',
    'Close Window [ Name: "B" ]',
    'Perform Script [ Specified: By name ; "B::Report" ]',
    'Exit Script [ Text Result: Get ( ScriptResult ) ]',
  ].join('\n') }]);
  assert.equal((await runScript(a, 'CloseWindow', { layout: 'Here' })).result, '2|Home|1');
});

test('with no Switch to layout the file opens on its first layout, and the trigger still runs', async () => {
  b.applyDesign([{ op: 'setFileOptions', openLayout: null }]);
  try {
    a.applyDesign([{ op: 'createScript', name: 'NoLayout', text: 'Open File [ “B” ]\nPerform Script [ Specified: By name ; "B::Report" ]\nExit Script [ Text Result: Get ( ScriptResult ) ]' }]);
    assert.equal((await runScript(a, 'NoLayout', { layout: 'Here' })).result, '1|Items|');
  } finally {
    b.applyDesign([{ op: 'setFileOptions', openLayout: 'Home' }]);
  }
});

test('an OnFirstWindowOpen script that closes its own window leaves the file open on a plain window, not run again', async () => {
  const path = join(dir, 'C.sqlite');
  createStore(path);
  const c = new Store(path, 'C');
  try {
    c.applyDesign([
      { op: 'createTable', name: 'Rows', fields: [{ name: 'Name' }] },
      { op: 'createScript', name: 'Startup', text: 'Set Variable [ $$cOpened ; Value: $$cOpened + 1 ]\nClose Window [ Current Window ]' },
      { op: 'createScript', name: 'Add', text: 'New Record/Request\nSet Field [ Rows::Name ; "added" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LayoutName ) & "|" & $$cOpened & "|" & Get ( WindowName ) ]' },
    ]);
    c.applyDesign([{ op: 'setFileOptions', onFirstWindowOpen: 'Startup' }]);
    a.applyDesign([{ op: 'createDataSource', name: 'C', paths: ['file:C'] }]);
    a.resolveFile = (name) => name === 'B' ? b : name === 'C' ? c : undefined;
    a.applyDesign([{ op: 'createScript', name: 'CallC', text: [
      'Perform Script [ Specified: By name ; "C::Add" ]',
      'Set Variable [ $first ; Value: Get ( ScriptResult ) ]',
      'Perform Script [ Specified: By name ; "C::Add" ]',
      'Exit Script [ Text Result: $first & "/" & Get ( ScriptResult ) & "/" & Get ( LayoutName ) ]',
    ].join('\n') }]);
    assert.equal((await runScript(a, 'CallC', { layout: 'Here' })).result, 'Rows|1|C/Rows|1|C/Here');
    assert.equal(c.findIds('Rows').length, 2);
  } finally {
    a.resolveFile = (name) => name === 'B' ? b : undefined;
    c.close();
  }
});

// File steps that fail on the disk answer with Claris's file codes instead of ending the script, Import Records
// reports wrong types and empty files with their own codes, Go to Record/Request in Find mode honours Exit after
// last, and Move/Resize Window runs the resized window's OnLayoutSizeChange in that window.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type OpenWindow, type RunOptions } from '../src/index.ts';

let dir: string;
let docs: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-r15-engine-'));
  docs = join(dir, 'Documents');
  mkdirSync(join(docs, 'adir'), { recursive: true });
  createStore(join(dir, 'R.sqlite'));
  store = new Store(join(dir, 'R.sqlite'), 'R');
  store.applyDesign([{ op: 'createTable', name: 'Main', fields: [{ name: 'Name', type: 'text' }] }]);
  store.create('Main', { Name: 'one' });
  store.create('Main', { Name: 'two' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const run = (text: string, opts: RunOptions = {}) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout: 'Main', documents: docs, ...opts });

test('Create Data File where a folder is, or with a name the system refuses: 800 and 850, and the script goes on', async () => {
  const r = await run(`
    Set Error Capture [ On ]
    Create Data File [ “adir” ; Create folders: On ]
    Set Variable [ $a ; Value: Get ( LastError ) ]
    Create Data File [ “${'x'.repeat(300)}” ; Create folders: On ]
    Set Variable [ $b ; Value: Get ( LastError ) ]
    Exit Script [ Text Result: $a & "|" & $b ]`);
  assert.equal(r.error, 0);
  assert.equal(r.result, '800|850');
});

test('a file step that fails on the disk without error capture shows its code, not a Node message', async () => {
  const r = await run('Create Data File [ “adir” ; Create folders: On ]', { trace: true });
  assert.equal(r.error, 800);
  const message = [...(r.trace ?? [])].reverse().find((t) => t.error)?.message ?? '';
  assert.match(message, /could not be created/);
  assert.doesNotMatch(message, /\/Documents|adir/);
});

const importFile = (name: string, bytes: Uint8Array | string, format?: string) => {
  writeFileSync(join(docs, name), bytes);
  return runScript(store, { id: 9998, name: 'imp', steps: [
    { stepId: 35, name: 'Import Records', enabled: true, params: { noDialog: true, tableOccurrence: { id: 0, name: 'Main' }, filePaths: [`file:${name}`], ...(format ? { importFormat: format } : {}) } },
  ] } as Script, { layout: 'Main', documents: docs, foundSet: [] });
};
const count = () => Number(store.query('SELECT COUNT(*) AS n FROM Main')[0].n);

test('Import Records: an unknown type or a damaged workbook is 700, an empty file 731 and nothing is added', async () => {
  const before = count();
  assert.equal((await importFile('notes.dat', 'a,b\n1,2\n')).error, 700);
  assert.equal((await importFile('broken.xlsx', 'this is not a zip file')).error, 700);
  assert.equal((await importFile('empty.csv', '')).error, 731);
  assert.equal((await importFile('blank.csv', '﻿ \n')).error, 731);
  assert.equal(count(), before);
  // A file with lines in it still imports (a header line comes in as a record, as before).
  assert.equal((await importFile('one.csv', 'Name\nthree\n')).error, 0);
  assert.equal(count(), before + 2);
});

test('Go to Record/Request in Find mode leaves the loop after the last request when asked to; without it the request stays', async () => {
  const r = await run(`
    Enter Find Mode [ Pause: Off ]
    New Record/Request
    Go to Record/Request/Page [ First ]
    Set Variable [ $n ; Value: 0 ]
    Loop
      Set Variable [ $n ; Value: $n + 1 ]
      Go to Record/Request/Page [ Next ; Exit after last ]
    End Loop
    Exit Script [ Text Result: $n ]`);
  assert.equal(r.error, 0);
  assert.equal(r.result, '2');
  const stay = await run(`
    Enter Find Mode [ Pause: Off ]
    New Record/Request
    Go to Record/Request/Page [ Last ]
    Go to Record/Request/Page [ Next ]
    Exit Script [ Text Result: Get ( LastError ) & "|" & Get ( RecordNumber ) ]`);
  assert.equal(stay.result, '0|2');
});

test('Move/Resize Window on another window by name runs that window\'s OnLayoutSizeChange in it, only when the size changed', async () => {
  store.applyDesign([{ op: 'createScript', name: 'Sized', text: 'Set Variable [ $$log ; Value: $$log & Get ( WindowName ) & ":" & Get ( WindowHeight ) & ";" ]' }]);
  const sized = store.schema.scripts.find((s) => s.name === 'Sized')!.id;
  store.applyDesign([{ op: 'updateLayout', layout: 'Main', design: { triggers: [{ event: 'OnLayoutSizeChange', scriptId: sized }] } }] as never);
  const main: OpenWindow = { id: 'MAIN-1', name: 'W', style: 'document', layout: 'Main' };
  try {
    const r = await run(`
      Set Variable [ $$log ; Value: "" ]
      New Window [ Style: Card ; "Card" ; 300 ; 400 ]
      Select Window [ Name: "W" ; Current file ]
      Move/Resize Window [ Name: "Card" ; Height: 250 ]
      Move/Resize Window [ Name: "Card" ; Top: 5 ; Left: 5 ]
      Move/Resize Window [ Name: "Card" ; Height: 250 ]
      Exit Script [ Text Result: $$log ]`, { startWindow: main, openWindows: [main] });
    assert.equal(r.result, 'Card:300;Card:250;');
  } finally {
    store.applyDesign([{ op: 'updateLayout', layout: 'Main', design: { triggers: [] } }] as never);
  }
});

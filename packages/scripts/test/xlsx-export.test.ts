// Excel output: dates, times and timestamps are real cells with a format, the header row is bold,
// frozen and filterable, and what is written reads back through Import Records' reader.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { evaluateText } from '@tabularius/calc';
import { isoCell, readXlsx, serialOf, unzip, xlsx } from '../src/xlsx.ts';
import { runScript } from '../src/index.ts';
import { validateSavedExcel } from './xlsx-opc-validator.ts';

const part = (bytes: Uint8Array, name: string) => new TextDecoder().decode(unzip(bytes).get(name));

test('typed cells: a date, time and timestamp are numbers with a format, a header is bold, frozen and filterable', () => {
  const bytes = xlsx([
    ['Name', 'Born', 'At', 'Seen'],
    ['Ann', isoCell('2026-10-15', 'date'), isoCell('13:45:30', 'time'), isoCell('2026-10-15T13:45:00', 'timestamp')],
    ['Bo <&>', 'not a date', 7, ''],
  ], 'People', { header: true });
  const sheet = part(bytes, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<pane ySplit="1" [^>]*state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A1:D3"\/>/);
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sheet, /<c r="B2" s="2"><v>46310<\/v><\/c>/);
  assert.match(sheet, /<c r="C2" s="3"><v>0\.5732638/);
  assert.match(sheet, /<c r="D2" s="4"><v>46310\.5729166/);
  assert.match(sheet, /<col min="1" max="1" width="8" customWidth="1"\/>/);
  assert.match(sheet, /<col min="2" max="2" width="12" customWidth="1"\/>/);
  assert.match(part(bytes, 'xl/styles.xml'), /formatCode="yyyy\\-mm\\-dd"/);
  assert.match(part(bytes, 'xl/workbook.xml'), /_xlnm\._FilterDatabase[^>]*>'People'!\$A\$1:\$D\$3</);
  // Without a header there is no filter, no frozen row and no bold.
  const plain = part(xlsx([['a', 'b']]), 'xl/worksheets/sheet1.xml');
  assert.doesNotMatch(plain, /autoFilter|pane|s="1"/);
  // What is written reads back: the serials, the text, the numbers.
  assert.deepEqual(readXlsx(bytes)[2], ['Bo <&>', 'not a date', 7]);
  assert.deepEqual(readXlsx(bytes)[1].slice(0, 2), ['Ann', 46310]);
});

test('a table name of control characters or spaces falls back to Sheet1, not an empty sheet name', () => {
  for (const name of ['\u0001\u0002', '   ', '']) {
    const workbook = part(xlsx([['a']], name), 'xl/workbook.xml');
    assert.match(workbook, /<sheet name="Sheet1"/, JSON.stringify(name));
  }
});

test('ISO text that is not a real date stays text', () => {
  assert.equal(isoCell('2026-13-40', 'date'), '2026-13-40');
  assert.equal(isoCell('soon', 'time'), 'soon');
  assert.deepEqual(isoCell('1899-12-30', 'date'), { serial: 0, kind: 'date' });
  assert.deepEqual(isoCell('2026-10-15 00:00:00', 'timestamp'), { serial: 46310, kind: 'timestamp' });
});

test('FileMaker day, time and timestamp numbers become the same Excel serials', () => {
  const n = (calc: string) => Number(evaluateText(calc));
  assert.equal(serialOf.date(n('GetAsNumber ( Date ( 10 ; 15 ; 2026 ) )')).serial, 46310);
  assert.equal(serialOf.date(n('GetAsNumber ( Date ( 12 ; 30 ; 1899 ) )')).serial, 0);
  assert.equal(serialOf.time(n('GetAsNumber ( Time ( 12 ; 0 ; 0 ) )')).serial, 0.5);
  assert.equal(serialOf.timestamp(n('GetAsNumber ( Timestamp ( Date ( 10 ; 15 ; 2026 ) ; Time ( 12 ; 0 ; 0 ) ) )')).serial, 46310.5);
});

let dir: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-xlsx-'));
  createStore(join(dir, 'X.sqlite'));
  store = new Store(join(dir, 'X.sqlite'), 'X');
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [
    { name: 'Title', type: 'text' }, { name: 'Day', type: 'date' }, { name: 'Start', type: 'time' }, { name: 'Made', type: 'timestamp' }, { name: 'Cost', type: 'number' },
  ] }]);
  store.create('Events', { Title: 'Launch', Day: '10/15/2026', Start: '13:45:00', Made: '10/15/2026 12:00:00', Cost: '9.5' });
  store.create('Events', { Title: 'No date' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Save Records as Excel writes dates, times and timestamps as typed cells', async () => {
  const text = 'Save Records as Excel [ With dialog: Off ; "events.xlsx" ]';
  const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params }));
  const r = await runScript(store, { id: 1, name: 't', steps } as Script, { layout: 'Events', foundSet: store.findIds('Events'), documents: dir });
  assert.equal(r.error, 0, r.trace?.map((t) => t.message).join());
  const bytes = readFileSync(join(dir, 'events.xlsx'));
  validateSavedExcel(bytes);
  const sheet = part(bytes, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="B1" s="2"><v>46310<\/v><\/c>/);
  assert.match(sheet, /<c r="C1" s="3"><v>0\.5729166/);
  assert.match(sheet, /<c r="D1" s="4"><v>46310\.5<\/v><\/c>/);
  assert.match(sheet, /<c r="E1"><v>9\.5<\/v><\/c>/);
  // An empty date is an empty cell, not a typed one.
  assert.doesNotMatch(sheet, /<c r="B2"/);
  assert.deepEqual(readXlsx(bytes)[0].slice(0, 3), ['Launch', 46310, 0.5729166666666666]);
});

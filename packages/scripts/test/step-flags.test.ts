// Step options kept in the flags word of a script step's record in an .fmp12 file, numbered
// as Save as XML's <Options> numbers them (bit 8 is byte 26 & 0x01): Create folders (bit 9) on
// the steps that write a file, Append to existing PDF (bit 8), Append line feed (bit 9 of Write
// to Data File) and Select (bit 12) on the Insert steps. Before, files lost them, so a file's
// Export Records into a new folder failed with "Create folders is off".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { decodeStepParams, stepLine } from '../../fmp12/src/script-params.ts';
import { runScript } from '../src/index.ts';

const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined };
/** A 28-byte step record: step id at 20-21, choice at 22-23, flags at 24-27. */
const rec = (id: number, flags: string, choice = 0) => new Uint8Array(Buffer.from('0'.repeat(40) + id.toString(16).padStart(4, '0') + choice.toString(16).padStart(4, '0') + flags, 'hex'));
const decode = (id: number, flags: string, choice = 0) => decodeStepParams(id, rec(id, flags, choice), undefined, ctx) ?? {};

test('Create folders is read from bit 9 on the steps that write a file', () => {
  for (const id of [36, 132, 144, 152, 190, 37]) {
    assert.equal(decode(id, '00000200').createFolders, true, `step ${id}`);
    assert.equal(decode(id, '00000000').createFolders, undefined, `step ${id}`);
  }
  assert.equal(stepLine('Export Records', decode(36, '00000280')), 'Export Records [ With dialog: Off ; Create folders: On ]');
  assert.equal(stepLine('Save Records as PDF', decode(144, '00000280')), 'Save Records as PDF [ With dialog: Off ; Records being browsed ; Create folders: On ]');
  assert.equal(stepLine('Create Data File', decode(190, '00000200')), 'Create Data File [ Create folders: On ]');
});

test('Save Records as PDF Append, Write to Data File Append line feed and the Insert steps\' Select are read', () => {
  assert.equal(decode(144, '00000100').appendPdf, true);
  assert.equal(decode(152, '00000100').appendPdf, undefined, 'Snapshot Link has no Append');
  assert.equal(stepLine('Save Records as PDF', decode(144, '00000380')), 'Save Records as PDF [ With dialog: Off ; Append ; Records being browsed ; Create folders: On ]');
  assert.equal(decode(192, '00000200', 2).appendLineFeed, true);
  assert.equal(decode(192, '00000000', 2).appendLineFeed, undefined);
  assert.equal(decode(193, '00000200').appendLineFeed, undefined, 'Read from Data File has no such option');
  for (const [id, name] of [[11, 'Insert from Index'], [12, 'Insert from Last Visited'], [13, 'Insert Current Date'], [14, 'Insert Current Time'], [60, 'Insert Current User Name']] as const) {
    assert.equal(stepLine(name, decode(id, '00001000')), `${name} [ Select ]`);
    assert.equal(stepLine(name, decode(id, '00000000')), name);
  }
});

test('Export Field Contents keeps Create folders in script text and makes the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-step-flags-'));
  const docs = join(dir, 'Documents');
  createStore(join(dir, 'F.sqlite'));
  const store = new Store(join(dir, 'F.sqlite'), 'F');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Body', type: 'text' }] }]);
    store.create('Notes', { Body: 'hello' });
    store.applyDesign([
      { op: 'createScript', name: 'Folders on', text: 'Set Error Capture [ On ]\nExport Field Contents [ Notes::Body ; “file:/Users/x/Documents/out/new/body.txt” ; Create folders: On ]\nExit Script [ Text Result: Get ( LastError ) ]' },
      { op: 'createScript', name: 'Folders off', text: 'Set Error Capture [ On ]\nExport Field Contents [ Notes::Body ; “file:/Users/x/Documents/other/body.txt” ]\nExit Script [ Text Result: Get ( LastError ) ]' },
    ]);
    const on = store.schema.scripts.find((s) => s.name === 'Folders on')!;
    assert.equal(stepLine(on.steps[1].name, on.steps[1].params), 'Export Field Contents [ Notes::Body ; “file:/Users/x/Documents/out/new/body.txt” ; Create folders: On ]');
    const r = await runScript(store, 'Folders on', { layout: 'Notes', documents: docs });
    assert.equal(r.result, '0');
    assert.equal(readFileSync(join(docs, 'out', 'new', 'body.txt'), 'utf8'), 'hello');
    const off = await runScript(store, 'Folders off', { layout: 'Notes', documents: docs });
    assert.notEqual(off.result, '0');
    assert.equal(existsSync(join(docs, 'other')), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

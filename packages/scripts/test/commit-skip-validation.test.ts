// Commit Records/Requests [ Skip data entry validation ] commits a record whose
// "Only during data entry" checks fail, while fields validated "Always" are
// still checked (Claris help, Commit Records/Requests: "This option only skips
// validation for fields set with the Only during data entry validation option").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designSnippet, snippetChanges, Store } from '@tabularius/store';
import { scriptText } from '../../fmp12/src/index.ts';
import { runScript } from '../src/index.ts';

function withStore(fn: (store: Store, run: (text: string) => Promise<string>) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-commit-skip-'));
    createStore(join(dir, 'S.sqlite'));
    const store = new Store(join(dir, 'S.sqlite'), 'S');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [
        { name: 'Code', type: 'text', options: { validation: { notEmpty: true } } }, // only during data entry
        { name: 'Qty', type: 'number', options: { validation: { always: true, range: { min: '1', max: '10' } } } },
      ] }]);
      let n = 0;
      await fn(store, async (text) => {
        const name = `Script ${++n}`;
        store.applyDesign([{ op: 'createScript', name, text }]);
        return String((await runScript(store, name, { layout: 'Orders' })).result);
      });
    } finally {
      store.close();
      rmSync(dir, { recursive: true });
    }
  };
}

const report = 'Set Variable [ $e ; Value: Get ( LastError ) ]\nRevert Record/Request [ With dialog: Off ]\nExit Script [ Text Result: $e & "/" & Get ( TotalRecordCount ) ]';

test('Skip data entry validation commits past "Only during data entry" checks', withStore(async (store, run) => {
  assert.equal(await run(`Set Error Capture [ On ]\nNew Record/Request\nSet Field [ Orders::Qty ; 2 ]\nCommit Records/Requests [ With dialog: Off ]\n${report}`), '509/0');
  assert.equal(await run(`Set Error Capture [ On ]\nNew Record/Request\nSet Field [ Orders::Qty ; 2 ]\nCommit Records/Requests [ With dialog: Off ; Skip data entry validation ]\n${report}`), '0/1');
  assert.equal(store.findIds('Orders').length, 1);
}));

test('Skip data entry validation still checks fields validated "Always"', withStore(async (_store, run) => {
  assert.equal(await run(`Set Error Capture [ On ]\nNew Record/Request\nSet Field [ Orders::Code ; "A1" ]\nSet Field [ Orders::Qty ; 50 ]\nCommit Records/Requests [ Skip data entry validation ]\n${report}`), '503/0');
}));

test('Skip data entry validation reads and writes as FileMaker text and clipboard XML', withStore(async (store) => {
  store.applyDesign([{ op: 'createScript', name: 'Save', text: 'Commit Records/Requests [ With dialog: Off ; Skip data entry validation ; Override ESS locking conflicts ]\nCommit Records/Requests [ With dialog: Off ]' }]);
  const save = store.schema.scripts.find((s) => s.name === 'Save')!;
  const text = 'Commit Records/Requests [ With dialog: Off ; Skip data entry validation ]\nCommit Records/Requests [ With dialog: Off ]';
  assert.equal(scriptText(save.steps), text);
  const { xml, notes } = designSnippet(store.schema, { scripts: [save.id] });
  assert.deepEqual(notes, []);
  assert.match(xml, /<NoInteract state="True"\/><Option state="True"\/><ESSForceCommit state="False"\/>/);
  assert.match(xml, /<NoInteract state="True"\/><Option state="False"\/><ESSForceCommit state="False"\/>/);
  store.applyDesign([{ op: 'deleteScript', script: save.id }]);
  store.applyDesign(snippetChanges(xml, store.schema).changes);
  assert.equal(scriptText(store.schema.scripts.find((s) => s.name === 'Save')!.steps), text);
}));

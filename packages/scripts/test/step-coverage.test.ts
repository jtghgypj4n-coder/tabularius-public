// Steps and functions the public sample files use that Tabularius didn't run before: design functions for
// AI prompts (GetTableDDL, BaseTableNames), GetRecordIDsFromFoundSet, Save Records as Snapshot Link, and
// steps only FileMaker Pro can do, which give error 3 with a reason, as FileMaker Server does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-coverage-'));
  createStore(join(dir, 'C.sqlite'));
  store = new Store(join(dir, 'C.sqlite'), 'C');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'id', type: 'number' }, { name: 'Name', type: 'text', comment: 'Full name' }] },
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'id', type: 'number' }, { name: 'CustomerID', type: 'number' }, { name: 'Due', type: 'date' }] },
  ]);
  store.applyDesign([{ op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerID', right: 'id' }] }]);
  for (let i = 1; i <= 3; i++) store.create('Customers', { id: String(i), Name: `c${i}` });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const script = (text: string) => ({
  id: 9999, name: 'test',
  steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script);

test('GetTableDDL describes tables with their types, comments and keys; BaseTableNames lists base tables', async () => {
  const r = await runScript(store, script('Exit Script [ Text Result: GetTableDDL ( "[\\"Invoices\\",\\"Customers\\"]" ; False ) & "¶--¶" & BaseTableNames ( "C" ) ]'), { layout: 'Customers' });
  assert.equal(r.error, 0);
  const [ddl, names] = r.result.split('\r--\r');
  assert.match(ddl, /^CREATE TABLE "Invoices" \(\n  "id" numeric,\n  "CustomerID" numeric,\n  "Due" date,\n  FOREIGN KEY \("CustomerID"\) REFERENCES "Customers" \("id"\)\n\);/);
  assert.match(ddl, /"Name" varchar\(255\) \/\* Full name \*\//);
  assert.equal(names, 'Customers\rInvoices');
  const plain = await runScript(store, script('Exit Script [ Text Result: GetTableDDL ( "[\\"Invoices\\",\\"Customers\\"]" ; True ) ]'), { layout: 'Customers' });
  assert.doesNotMatch(plain.result, /FOREIGN KEY/);
  // An account sees only the tables and fields it can read.
  store.savePrivilegeSet({
    name: 'NoInvoices', records: { view: true, edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: [],
    tables: { Invoices: { view: false, edit: false, create: false, delete: false }, Customers: { view: true, edit: false, create: false, delete: false, fields: { Name: 'none' } } },
  });
  store.setPassword('ddl-reader', 'ddl-reader-password', 'NoInvoices');
  const limited = await runScript(store, script('Exit Script [ Text Result: GetTableDDL ( "[\\"Invoices\\",\\"Customers\\"]" ; False ) ]'), { layout: 'Customers', account: 'ddl-reader', privileges: store.privileges('ddl-reader') });
  assert.match(limited.result, /CREATE TABLE "Customers"/);
  assert.doesNotMatch(limited.result, /Invoices|"Name"/);
});

test('GetRecordIDsFromFoundSet lists the found set as a list or a JSON array', async () => {
  const ids = store.findIds('Customers');
  const r = await runScript(store, script('Exit Script [ Text Result: GetRecordIDsFromFoundSet ( 0 ) & "|" & GetRecordIDsFromFoundSet ( 1 ) & "|" & GetRecordIDsFromFoundSet ( 2 ) ]'), { layout: 'Customers' });
  assert.equal(r.result, `${ids.join('\r')}|${JSON.stringify(ids.map(String))}|${JSON.stringify(ids)}`);
});

test('Save Records as Snapshot Link writes the found set to an .fmpsl file', async () => {
  const documents = mkdtempSync(join(tmpdir(), 'tabularius-coverage-docs-'));
  try {
    const r = await runScript(store, script('Save Records as Snapshot Link [ With dialog: Off ; “links.fmpsl” ; Records being browsed ; Create folders: Off ]\nExit Script [ Text Result: Get ( LastError ) ]'), { layout: 'Customers', documents });
    assert.equal(r.result, '0');
    const xml = readFileSync(join(documents, 'links.fmpsl'), 'utf8');
    assert.match(xml, /<Rows type="nativeIDList" rowCount="3" baseTableId="\d+">\d+ \d+ \d+<\/Rows>/);
    assert.match(xml, /<Mode value="browseMode">/);
    // Current record: only the record the window is on.
    const ids = store.findIds('Customers');
    const one = await runScript(store, script('Go to Record/Request/Page [ Last ]\nSave Records as Snapshot Link [ With dialog: Off ; “one.fmpsl” ; Current record ; Create folders: Off ]\nExit Script [ Text Result: Get ( LastError ) ]'), { layout: 'Customers', documents });
    assert.equal(one.result, '0');
    const only = readFileSync(join(documents, 'one.fmpsl'), 'utf8');
    assert.match(only, new RegExp(`<Rows type="nativeIDList" rowCount="1" baseTableId="\\d+">${ids[2]}</Rows>`));
    assert.match(only, new RegExp(`<SelectedRow type="nativeID" id="${ids[2]}">`));
  } finally {
    rmSync(documents, { recursive: true, force: true });
  }
});

test('steps only FileMaker Pro can do give error 3 and say why; screen-only steps are skipped', async () => {
  const r = await runScript(store, script('Perform AppleScript [ "beep" ]\nSet Variable [ $a ; Value: Get ( LastError ) ]\nSet Dictionary [ ]\nUndo/Redo [ Undo ]\nOpen Help\nExit Script [ Text Result: $a & "/" & Get ( LastError ) ]'), { layout: 'Customers', trace: true });
  assert.equal(r.result, '3/0');
  assert.match(r.trace!.find((t) => t.error)?.message ?? '', /only in FileMaker Pro on a Mac/);
});

test('client-only steps set LastError to 3, trace the reason, and continue with error capture on or off', async () => {
  const names = ['Print Setup', 'Open Hosts', 'Open Upload to Host', 'Open Favorites', 'Open File Options', 'Open Sharing', 'Open Settings'];
  for (const name of names) {
    for (const capture of ['On', 'Off']) {
      const r = await runScript(store, script(`Set Error Capture [ ${capture} ]\n${name}\nExit Script [ Text Result: Get ( LastError ) ]`), { layout: 'Customers', trace: true });
      assert.equal(r.error, 3, `${name}, error capture ${capture}: LastError remains the final run error`);
      assert.equal(r.result, '3', `${name}, error capture ${capture}: LastError`);
      assert.ok(r.trace?.some((entry) => entry.index === 1 && entry.error === 3), `${name}: trace records error 3`);
    }
  }
});

test('Core ML is not on the server, and RAG steps offline: error 3, saying why', async () => {
  for (const [stepId, name, reason] of [[202, 'Configure Machine Learning Model', /Core ML/], [219, 'Perform RAG Action', /run offline/]] as const) {
    const r = await runScript(store, { id: 9000 + stepId, name: 'x', steps: [{ stepId, name, enabled: true }] } as never, { layout: 'Customers', trace: true });
    assert.equal(r.error, 3, name);
    assert.match(r.trace!.find((t) => t.error)?.message ?? '', reason);
  }
});

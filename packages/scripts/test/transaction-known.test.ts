// Transactions and records as the script engine does them today, one test each, for the combinations the model-based test
// (transaction-model.test.ts) does not leave to chance: the two bugs it found, and the KNOWN table of behaviour Claris does
// not spell out. A KNOWN row pins what this repo does, names the Claris page that would settle it, and says "unverified"
// until someone has checked it against FileMaker; changing a row's behaviour means checking that page, not the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

async function withItems(fn: (run: (text: string) => Promise<string>, store: Store) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-known-'));
  createStore(join(dir, 'K.sqlite'));
  const store = new Store(join(dir, 'K.sqlite'), 'K');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
      { name: 'Name', type: 'text' },
      { name: 'Qty', type: 'number', options: { validation: { always: true, range: { min: '0', max: '100' } } } },
    ] }]);
    let n = 0;
    const run = async (text: string) => {
      const name = `Script ${++n}`;
      store.applyDesign([{ op: 'createScript', name, text }]);
      return String((await runScript(store, name, { layout: 'Items' })).result);
    };
    await fn(run, store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const make = (name: string) => `New Record/Request\nSet Field [ Items::Name ; "${name}" ]\nCommit Records/Requests [ With dialog: Off ]`;
const WHERE = 'Get ( FoundCount ) & "/" & Get ( RecordNumber ) & "/" & Items::Name';

test('KNOWN: Revert Record/Request on a new record deletes it and leaves the last record of the found set current, as deleting the last record does (Claris "Revert Record/Request": silent, unverified; it may go back to the record the person was on)', () => withItems(async (run) => {
  await run(`${make('a')}\n${make('b')}\n${make('c')}`);
  assert.equal(await run(`Go to Record/Request/Page [ First ]\nNew Record/Request\nRevert Record/Request [ With dialog: Off ]\nExit Script [ Text Result: ${WHERE} ]`), '3/3/c');
  assert.equal(await run(`Set Error Capture [ On ]\nGo to Record/Request/Page [ First ]\nNew Record/Request\nSet Field [ Items::Qty ; 500 ]\nCommit Records/Requests [ With dialog: Off ]\nRevert Record/Request [ With dialog: Off ]\nExit Script [ Text Result: ${WHERE} ]`), '3/3/c');
}));

test('KNOWN: a transaction reverted while on a record it made leaves the last record current (Claris "Revert Transaction": silent, unverified; the existing transactions test pins the same)', () => withItems(async (run) => {
  await run(`${make('a')}\n${make('b')}\n${make('c')}`);
  assert.equal(await run(`Go to Record/Request/Page [ Next ]\nOpen Transaction\n${make('d')}\nRevert Transaction\nCommit Transaction\nExit Script [ Text Result: ${WHERE} ]`), '3/3/c');
}));

// ---------------------------------------------------------------------------------------------------- KNOWN
// Each row: what the repo does, the Claris page that would settle it, and whether anyone has checked.

test('KNOWN: Go to Next Record at the last record, Exit after last off, sets error 101 and stays (Claris "Go to Record/Request/Page": unverified; it may wrap)', () => withItems(async (run) => {
  await run(`${make('a')}\n${make('b')}`);
  assert.equal(await run(`Set Error Capture [ On ]\nGo to Record/Request/Page [ Last ]\nGo to Record/Request/Page [ Next ; Exit after last: Off ]\nExit Script [ Text Result: Get ( LastError ) & "/" & ${WHERE} ]`), '101/2/2/b');
}));

test('KNOWN: committing a record whose value is unchanged still counts as a modification (Claris "Get ( RecordModificationCount )": unverified)', () => withItems(async (run, store) => {
  await run(make('a'));
  const mods = () => store.select('SELECT _fm_mod_id FROM "Items"', [], 5).rows[0]![0];
  assert.equal(mods(), 1);
  await run('Set Field [ Items::Name ; "a" ]\nCommit Records/Requests [ With dialog: Off ]');
  assert.equal(mods(), 2);
  await run('Commit Records/Requests [ With dialog: Off ]');
  assert.equal(mods(), 2, 'a commit with nothing changed does not');
}));

test('KNOWN: Open Transaction inside a transaction is error 3 and the outer one stays open; a subscript cannot commit its caller\'s (Claris "Open Transaction": unverified)', () => withItems(async (run, store) => {
  store.applyDesign([{ op: 'createScript', name: 'Inner', text: 'Open Transaction\nSet Variable [ $$log ; Value: $$log & "open:" & Get ( LastError ) & " " ]\nCommit Transaction\nSet Variable [ $$log ; Value: $$log & "commit:" & Get ( LastError ) & " " ]' }]);
  assert.equal(await run('Set Error Capture [ On ]\nSet Variable [ $$log ; "" ]\nOpen Transaction\nPerform Script [ Specified: By name ; "Inner" ]\nSet Variable [ $open ; Get ( TransactionOpenState ) ]\nCommit Transaction\nExit Script [ Text Result: $$log & "still open:" & $open & " after:" & Get ( TransactionOpenState ) ]'), 'open:3 commit:3 still open:1 after:0');
}));

test('KNOWN: Revert Transaction with no transaction open is error 3 (Claris "Revert Transaction": unverified)', () => withItems(async (run) => {
  assert.equal(await run('Set Error Capture [ On ]\nRevert Transaction\nExit Script [ Text Result: Get ( LastError ) ]'), '3');
  assert.equal(await run('Set Error Capture [ On ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]'), '3');
}));

test('KNOWN: Revert Transaction brings back records the transaction deleted but not into the found set; records it made leave the found set (Claris "Revert Transaction": silent, unverified)', () => withItems(async (run) => {
  await run(`${make('a')}\n${make('b')}`);
  assert.equal(await run('Open Transaction\nDelete All Records [ With dialog: Off ]\nRevert Transaction\nCommit Transaction\nExit Script [ Text Result: Get ( FoundCount ) ]'), '0');
  assert.equal(await run('Exit Script [ Text Result: Get ( FoundCount ) ]'), '2', 'the records are back');
}));

test('KNOWN: a record deleted last gives its record id to the next one made (row ids; Claris "Get ( RecordID )": unverified, FileMaker is believed not to reuse them)', () => withItems(async (run) => {
  await run(make('a'));
  assert.equal(await run('Delete Record/Request [ With dialog: Off ]\nNew Record/Request\nExit Script [ Text Result: Get ( RecordID ) ]'), '1');
}));

test('KNOWN: a script that ends with its transaction open keeps none of it, and Exit Script inside reverts too (Claris "Open Transaction": unverified for both)', () => withItems(async (run, store) => {
  await run(make('a'));
  await run('Open Transaction\nSet Field [ Items::Name ; "ended" ]');
  assert.equal(store.select('SELECT Name FROM "Items"', [], 5).rows[0]![0], 'a');
  await run('Open Transaction\nSet Field [ Items::Name ; "exited" ]\nExit Script [ Text Result: "x" ]\nCommit Transaction');
  assert.equal(store.select('SELECT Name FROM "Items"', [], 5).rows[0]![0], 'a');
}));

test('KNOWN: Revert Transaction\'s custom error is kept as Get ( LastError ) for 5000 to 5499; any other code is 0 (Claris "Revert Transaction": range unverified)', () => withItems(async (run) => {
  assert.equal(await run('Set Error Capture [ On ]\nOpen Transaction\nRevert Transaction [ Error code: 5001 ; Error message: "no" ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]'), '5001');
  assert.equal(await run('Set Error Capture [ On ]\nOpen Transaction\nRevert Transaction [ Error code: 17 ; Error message: "no" ]\nCommit Transaction\nExit Script [ Text Result: Get ( LastError ) ]'), '0');
}));

test('KNOWN: Set Revert Transaction on Error is On at the start of a script and lasts for that script and its subscripts (Claris "Set Revert Transaction on Error": unverified for the default)', () => withItems(async (run) => {
  assert.equal(await run('Exit Script [ Text Result: Get ( RevertTransactionOnErrorState ) ]'), '1');
  assert.equal(await run('Set Revert Transaction on Error [ Off ]\nExit Script [ Text Result: Get ( RevertTransactionOnErrorState ) ]'), '0');
}));

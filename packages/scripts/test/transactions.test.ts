import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { importFmp12, parseScriptText, Store, StoreError, writer, endTransaction, type Transaction } from '@tabularius/store';
import { runScript } from '../src/index.ts';

// Flicks' modules layout has a unique validation on LIBRARY_CODE::name.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const LAYOUT = 'WV Framework - Modules';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-'));
  importFmp12(fixture, join(dir, 'Flicks.sqlite'));
  store = new Store(join(dir, 'Flicks.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

const names = () => store.query('SELECT name FROM LIBRARY_CODE ORDER BY _fm_record_id').map((r) => String(r.name));
const run = (text: string) => runScript(store, script(text), { layout: LAYOUT, foundSet: store.findIds(LAYOUT) });

test('a commit that fails validation leaves the record open with its edits; Revert puts it back', { skip }, async () => {
  const [first, , , last] = [names()[0], 0, 0, names().at(-1)];
  const r = await run(`
    Set Error Capture [ On ]
    Go to Record/Request/Page [ Last ]
    Set Field [ LIBRARY_CODE::name ; "${first}" ]
    Commit Records/Requests [ With dialog: Off ]
    Set Variable [ $failed ; Value: Get ( LastError ) & "/" & Get ( RecordOpenState ) & "/" & LIBRARY_CODE::name ]
    Revert Record/Request [ With dialog: Off ]
    Exit Script [ Result: $failed & "|" & Get ( RecordOpenState ) & "/" & LIBRARY_CODE::name ]
  `);
  assert.equal(r.result, `504/2/${first}|0/${last}`);
  assert.equal(names().at(-1), last);
});

test('Commit Transaction keeps every change; Revert Transaction undoes them all and goes on after Commit Transaction', { skip }, async () => {
  const before = names();
  const kept = await run(`
    Open Transaction
    Go to Record/Request/Page [ First ]
    Set Field [ LIBRARY_CODE::name ; "tx-first" ]
    New Record/Request
    Set Field [ LIBRARY_CODE::name ; "tx-new" ]
    Set Variable [ $open ; Value: Get ( TransactionOpenState ) ]
    Commit Transaction
    Exit Script [ Result: $open & "/" & Get ( TransactionOpenState ) & "/" & Get ( LastError ) ]
  `);
  assert.equal(kept.result, '1/0/0');
  assert.deepEqual(names(), ['tx-first', ...before.slice(1), 'tx-new']);

  const now = names();
  const count = store.findIds(LAYOUT).length;
  const reverted = await run(`
    Set Error Capture [ On ]
    Open Transaction
    Go to Record/Request/Page [ First ]
    Set Field [ LIBRARY_CODE::name ; "never" ]
    New Record/Request
    Set Field [ LIBRARY_CODE::name ; "never-new" ]
    Revert Transaction [ Condition: Get ( FoundCount ) > 0 ; Error code: 5001 ; Error message: "Changed my mind" ]
    Set Variable [ $skipped ; Value: "ran" ]
    Commit Transaction
    Exit Script [ Result: Get ( LastError ) & "/" & Get ( LastErrorDetail ) & "/" & $skipped & "/" & Get ( FoundCount ) & "/" & LIBRARY_CODE::name ]
  `);
  // The new record is gone, so the found set is back to its size, on its last record.
  assert.equal(reverted.result, `5001/Changed my mind//${count}/${now.at(-1)}`);
  assert.deepEqual(names(), now);
});

test('a validation error reverts the transaction, unless Set Revert Transaction on Error is off', { skip }, async () => {
  const now = names();
  const r = await run(`
    Set Error Capture [ On ]
    Open Transaction
    Go to Record/Request/Page [ First ]
    Set Field [ LIBRARY_CODE::name ; "changed-then-reverted" ]
    Go to Record/Request/Page [ Last ]
    Set Field [ LIBRARY_CODE::name ; "${now[1]}" ]
    Commit Records/Requests [ With dialog: Off ]
    Set Variable [ $skipped ; Value: "ran" ]
    Commit Transaction
    Exit Script [ Result: Get ( LastError ) & "/" & $skipped & "/" & Get ( TransactionOpenState ) ]
  `);
  assert.equal(r.result, '504//0');
  assert.deepEqual(names(), now);

  const off = await run(`
    Set Error Capture [ On ]
    Set Revert Transaction on Error [ Off ]
    Open Transaction
    Go to Record/Request/Page [ Last ]
    Set Field [ LIBRARY_CODE::name ; "${now[1]}" ]
    Commit Records/Requests [ With dialog: Off ]
    Set Variable [ $error ; Value: Get ( LastError ) ]
    Revert Record/Request [ With dialog: Off ]
    Set Field [ LIBRARY_CODE::name ; "fixed-in-tx" ]
    Commit Transaction
    Exit Script [ Result: $error & "/" & Get ( LastError ) & "/" & Get ( RevertTransactionOnErrorState ) ]
  `);
  assert.equal(off.result, '504/0/0');
  assert.equal(names().at(-1), 'fixed-in-tx');
});

test('a script that ends or halts inside a transaction keeps none of it; Revert and Commit Transaction outside one give error 3', { skip }, async () => {
  const now = names();
  await run(`
    Open Transaction
    Set Field [ LIBRARY_CODE::name ; "exit-inside" ]
    Exit Script [ Result: 1 ]
    Commit Transaction
  `);
  await run(`
    Open Transaction
    Set Field [ LIBRARY_CODE::name ; "halt-inside" ]
    Commit Records/Requests [ With dialog: Off ]
    Halt Script
    Commit Transaction
  `);
  assert.deepEqual(names(), now);
  const r = await run(`
    Set Error Capture [ On ]
    Revert Transaction
    Set Variable [ $a ; Value: Get ( LastError ) ]
    Commit Transaction
    Exit Script [ Result: $a & "/" & Get ( LastError ) ]
  `);
  assert.equal(r.result, '3/3');
});

test('while a transaction holds a file, other writers get 301; afterwards they write again', { skip }, () => {
  const id = store.findIds(LAYOUT)[0];
  const tx: Transaction = { files: new Map() };
  writer.run({ owner: 'a', transaction: { open: tx } }, () => store.update(LAYOUT, id, { name: 'in tx' }));
  assert.throws(() => writer.run({ owner: 'b' }, () => store.update(LAYOUT, id, { name: 'other' })), (e: StoreError) => e.code === 301);
  endTransaction(tx, false);
  writer.run({ owner: 'b' }, () => store.update(LAYOUT, id, { name: 'other' }));
  assert.equal(store.query(`SELECT name FROM LIBRARY_CODE WHERE _fm_record_id = ${id}`)[0].name, 'other');
});

test('subscripts: their Open and Commit Transaction give error 3, and an error in one reverts the caller\'s transaction', { skip }, async () => {
  const now = names();
  store.applyDesign([
    { op: 'createScript', id: 9001, name: 'tx nested', text: [
      'Open Transaction',
      'Set Variable [ $$opened ; Value: Get ( LastError ) ]',
      'Commit Transaction',
      'Set Variable [ $$committed ; Value: Get ( LastError ) ]',
    ].join('\n') },
    { op: 'createScript', id: 9002, name: 'tx duplicate', text: [
      'Go to Record/Request/Page [ Last ]',
      `Set Field [ LIBRARY_CODE::name ; "${now[1]}" ]`,
      'Commit Records/Requests [ With dialog: Off ]',
      'Set Variable [ $$after ; Value: "ran" ]',
    ].join('\n') },
  ]);
  const r = await run(`
    Set Error Capture [ On ]
    Open Transaction
    Go to Record/Request/Page [ First ]
    Set Field [ LIBRARY_CODE::name ; "changed-then-reverted" ]
    Perform Script [ “tx nested” ]
    Perform Script [ “tx duplicate” ]
    Set Variable [ $skipped ; Value: "ran" ]
    Commit Transaction
    Exit Script [ Result: Get ( LastError ) & "/" & $$opened & "/" & $$committed & "/" & $$after & "/" & $skipped ]
  `);
  assert.equal(r.result, '504/3/3//');
  assert.deepEqual(names(), now);
});

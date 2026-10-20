// Open Transaction [ Skip data entry validation ; Skip auto-enter options ], as Claris documents
// them: inside the transaction only fields validated "Always" are checked, and no auto-enter
// option runs (also overriding Import Records' own Perform auto-enter options). Both options, and
// Commit Records/Requests' Skip data entry validation, are read from .fmp12 step flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { decodeStepParams, stepLine } from '../../fmp12/src/script-params.ts';
import { runScript } from '../src/index.ts';

function withStore(fn: (store: Store, run: (text: string) => Promise<string>) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-options-'));
    createStore(join(dir, 'T.sqlite'));
    const store = new Store(join(dir, 'T.sqlite'), 'T');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [
        { name: 'Name', type: 'text' },
        { name: 'Code', type: 'text', options: { validation: { notEmpty: true } } },
        { name: 'Qty', type: 'number', options: { validation: { always: true, range: { min: '1', max: '10' } } } },
        { name: 'CreatedBy', type: 'text', options: { autoEnter: { value: 'creationAccountName' } } },
      ] }]);
      let n = 0;
      await fn(store, async (text) => {
        const name = `Script ${++n}`;
        store.applyDesign([{ op: 'createScript', name, text }]);
        return String((await runScript(store, name, { layout: 'Orders', account: 'Ann' })).result);
      });
    } finally {
      store.close();
      rmSync(dir, { recursive: true });
    }
  };
}

const rows = (store: Store) => store.findIds('Orders').map((id) => store.row(store.layout('Orders'), id));

test('Skip data entry validation lets the transaction commit past "only during data entry" checks', withStore(async (store, run) => {
  const plain = await run([
    'Set Error Capture [ On ]',
    'Open Transaction',
    'New Record/Request',
    'Set Field [ Orders::Name ; "A" ]',
    'Commit Transaction',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n'));
  assert.equal(plain, '509');
  assert.equal(rows(store).length, 0);

  const skipped = await run([
    'Set Error Capture [ On ]',
    'Open Transaction [ Skip data entry validation ]',
    'New Record/Request',
    'Set Field [ Orders::Name ; "B" ]',
    'Commit Transaction',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n'));
  assert.equal(skipped, '0');
  assert.deepEqual(rows(store).map((r) => r.Name), ['B']);
}));

test('Skip data entry validation still checks "Always" fields, which revert the transaction', withStore(async (store, run) => {
  const r = await run([
    'Set Error Capture [ On ]',
    'Open Transaction [ Skip data entry validation ]',
    'New Record/Request',
    'Set Field [ Orders::Qty ; 50 ]',
    'Commit Transaction',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n'));
  assert.notEqual(r, '0');
  assert.equal(rows(store).length, 0);
}));

test('Skip auto-enter options leaves auto-enter fields alone inside the transaction only', withStore(async (store, run) => {
  const r = await run([
    'Open Transaction [ Skip auto-enter options ; Skip data entry validation ]',
    'New Record/Request',
    'Set Field [ Orders::Name ; "inside" ]',
    'Commit Transaction',
    'New Record/Request',
    'Set Field [ Orders::Name ; "outside" ]',
    'Set Field [ Orders::Code ; "X" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n'));
  assert.equal(r, '0');
  const byName = Object.fromEntries(rows(store).map((x) => [x.Name, x.CreatedBy]));
  assert.ok(!byName.inside, 'no auto-enter inside the transaction');
  assert.equal(byName.outside, 'Ann');
}));

test('Open Transaction and Commit Records/Requests skip options are read from file step flags and script text', () => {
  const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined };
  // Flags word at 24-27: bit 8 (byte 26 & 0x01) Skip data entry validation, bit 12 (byte 26 & 0x10) Skip auto-enter options.
  const rec = (flags: string) => new Uint8Array(Buffer.from('0'.repeat(40) + '00cd' + '0000' + flags, 'hex'));
  assert.equal(stepLine('Open Transaction', decodeStepParams(205, rec('00001100'), undefined, ctx)), 'Open Transaction [ Skip auto-enter options ; Skip data entry validation ]');
  assert.equal(stepLine('Open Transaction', decodeStepParams(205, rec('00000100'), undefined, ctx)), 'Open Transaction [ Skip data entry validation ]');
  assert.equal(stepLine('Open Transaction', decodeStepParams(205, rec('00000000'), undefined, ctx)), 'Open Transaction');
  // Commit Records/Requests: the same bit 8; 0x80 in byte 27 is With dialog: Off.
  const commit = (flags: string) => new Uint8Array(Buffer.from('0'.repeat(40) + '004b' + '0000' + flags, 'hex'));
  assert.equal(stepLine('Commit Records/Requests', decodeStepParams(75, commit('00000180'), undefined, ctx)), 'Commit Records/Requests [ With dialog: Off ; Skip data entry validation ]');
  assert.equal(stepLine('Commit Records/Requests', decodeStepParams(75, commit('00000080'), undefined, ctx)), 'Commit Records/Requests [ With dialog: Off ]');
});

for (const options of ['Condition', 'Error code', 'Calculations', 'Option payloads']) test(`Undecoded Revert Transaction returns 3 without reverting or unwinding (${options})`, withStore(async (store, run) => {
  const result = await run([
    'Set Error Capture [ On ]',
    'Open Transaction [ Skip data entry validation ]',
    'New Record/Request',
    'Set Field [ Orders::Name ; "kept" ]',
    `Revert Transaction [ Undecoded options: ${options} ]`,
    'Set Variable [ $status ; Value: Get ( LastError ) & "/" & Get ( LastErrorDetail ) & "/" & Get ( TransactionOpenState ) ]',
    'Commit Transaction',
    'Exit Script [ Result: $status ]',
  ].join('\n'));
  assert.equal(result, '3/Revert Transaction cannot run because its imported condition or error options are not decoded. Re-enter the intended options in script text or structured parameters. This step did not revert the transaction./1');
  assert.deepEqual(rows(store).map((r) => r.Name), ['kept']);
}));

for (const on of [true, false]) test(`Undecoded transaction state leaves the current setting unchanged (${on})`, withStore(async (store, run) => {
  const result = await run([
    `Set Revert Transaction on Error [ ${on ? 'On' : 'Off'} ]`,
    'Set Revert Transaction on Error [ Undecoded options: On/Off ]',
    'Exit Script [ Result: Get ( LastError ) & "/" & Get ( LastErrorDetail ) & "/" & Get ( RevertTransactionOnErrorState ) ]',
  ].join('\n'));
  assert.equal(result, `3/Set Revert Transaction on Error cannot run because its On/Off option is unspecified or not decoded. Specify On or Off explicitly. The current setting was not changed./${on ? 1 : 0}`);
  const bare = await run(`Set Revert Transaction on Error [ ${on ? 'On' : 'Off'} ]\nSet Revert Transaction on Error\nExit Script [ Result: Get ( LastError ) & "/" & Get ( RevertTransactionOnErrorState ) ]`);
  assert.equal(bare, `3/${on ? 1 : 0}`);
}));

test('Legacy Revert Transaction slots and unassigned calculations cannot become conditions', withStore(async (store) => {
  for (const retained of [{ params: { slots: { 128: '0' } } }, { calculations: ['0'] }]) {
    store.applyDesign([{ op: 'createScript', name: 'Legacy ' + JSON.stringify(retained), steps: [
      { name: 'Open Transaction', params: { skipValidation: true } },
      { name: 'New Record/Request' },
      { name: 'Set Field', params: { field: { tableOccurrence: { id: 0, name: 'Orders' }, field: { id: 0, name: 'Name' } }, calculation: '"legacy kept"' } },
      { name: 'Revert Transaction', stepId: 207, enabled: true, line: 'Revert Transaction', ...retained },
      { name: 'Set Variable', params: { variable: '$e', value: 'Get ( LastError ) & "/" & Get ( TransactionOpenState )' } },
      { name: 'Commit Transaction' },
      { name: 'Exit Script', params: { calculation: '$e' } },
    ] }]);
    const script = store.schema.scripts.at(-1)!;
    const result = await runScript(store, script, { layout: 'Orders' });
    assert.equal(result.result, '3/1');
  }
  assert.equal(rows(store).length, 2);
}));

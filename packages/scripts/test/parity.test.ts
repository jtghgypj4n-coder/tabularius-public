// FileMaker behaviour the engine has to match: error codes and Get ( LastError ),
// commits that fail validation, and Exit Script results across Perform Script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-parity-'));
  createStore(join(dir, 'P.sqlite'));
  store = new Store(join(dir, 'P.sqlite'), 'P');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
    { name: 'Name', type: 'text', options: { validation: { always: true, notEmpty: true } } },
    { name: 'Code', type: 'text', options: { validation: { always: true, unique: true } } },
    { name: 'Qty', type: 'number', options: { validation: { always: true, range: { min: '1', max: '10' } } } },
    { name: 'Short', type: 'text', options: { validation: { always: true, maxLength: 3 } } },
    { name: 'Even', type: 'number', options: { validation: { always: true, calculation: 'Mod ( Even ; 2 ) = 0' } } },
  ] }]);
  store.create('Items', { Name: 'one', Code: 'A', Qty: '1', Short: 'a', Even: '2' });
  store.create('Items', { Name: 'two', Code: 'B', Qty: '2', Short: 'b', Even: '4' });
  const sub = (name: string, text: string) => ({ op: 'createScript' as const, name, text });
  store.applyDesign([
    sub('Returns', 'Exit Script [ Text Result: Get ( ScriptParameter ) & "!" ]'),
    sub('Returns nothing', 'Set Variable [ $x ; Value: 1 ]'),
    sub('Fails', 'Set Error Capture [ On ]\nGo to Layout [ Layout Name: "Nowhere" ]'),
    sub('Halts', 'Halt Script'),
    sub('Nested', 'Perform Script [ “Returns” ; Parameter: "inner" ]\nExit Script [ Text Result: "outer+" & Get ( ScriptResult ) ]'),
  ]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const steps = (text: string) => parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
  .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
const run = (text: string) => runScript(store, { id: 9999, name: 'test', steps: steps(text) } as Script, { layout: 'Items', foundSet: store.findIds('Items') });
const names = () => store.query('SELECT Name FROM Items ORDER BY _fm_record_id').map((r) => String(r.Name));

test('Get ( LastError ) is the last step\'s error, and the next step that works sets it back to 0', async () => {
  const r = await run(`
    Set Error Capture [ On ]
    Go to Record/Request/Page [ 99 ]
    Set Variable [ $a ; Value: Get ( LastError ) ]
    Set Variable [ $b ; Value: Get ( LastError ) ]
    Go to Layout [ Layout Name: "Nowhere" ]
    Set Variable [ $c ; Value: Get ( LastError ) ]
    Go to Record/Request/Page [ First ]
    Exit Script [ Text Result: $a & "/" & $b & "/" & $c & "/" & Get ( LastError ) ]`);
  assert.equal(r.result, '101/0/105/0');
});

test('a subscript\'s error is the caller\'s Get ( LastError ) after Perform Script', async () => {
  const r = await run(`
    Set Error Capture [ On ]
    Perform Script [ “Fails” ]
    Exit Script [ Text Result: Get ( LastError ) ]`);
  assert.equal(r.result, '105');
});

test('commits that fail validation give FileMaker\'s codes and keep the record open', async () => {
  const cases: [string, string, number][] = [
    ['Name', '""', 509],
    ['Code', '"B"', 504],
    ['Qty', '42', 503],
    ['Short', '"long"', 511],
    ['Even', '3', 507],
  ];
  for (const [field, value, code] of cases) {
    const r = await run(`
      Set Error Capture [ On ]
      Go to Record/Request/Page [ First ]
      Set Field [ Items::${field} ; ${value} ]
      Commit Records/Requests [ With dialog: Off ]
      Set Variable [ $e ; Value: Get ( LastError ) & "/" & Get ( RecordOpenState ) ]
      Revert Record/Request [ With dialog: Off ]
      Exit Script [ Text Result: $e & "/" & Get ( RecordOpenState ) ]`);
    // 2: an existing record with changes not yet committed.
    assert.equal(r.result, `${code}/2/0`, field);
  }
  assert.deepEqual(names(), ['one', 'two']);
});

test('a script that ends with a failed commit leaves nothing saved', async () => {
  await run(`
    Set Error Capture [ On ]
    Go to Record/Request/Page [ First ]
    Set Field [ Items::Name ; "changed" ]
    Set Field [ Items::Code ; "B" ]`);
  assert.deepEqual(names(), ['one', 'two']);
});

test('Exit Script results reach the caller through Get ( ScriptResult ), as text', async () => {
  const r = await run(`
    Perform Script [ “Returns” ; Parameter: 1 + 1 ]
    Set Variable [ $a ; Value: Get ( ScriptResult ) ]
    Set Variable [ $still ; Value: Get ( ScriptResult ) ]
    Perform Script [ “Returns nothing” ]
    Set Variable [ $b ; Value: Get ( ScriptResult ) ]
    Perform Script [ “Nested” ]
    Exit Script [ Text Result: $a & "|" & $still & "|" & $b & "|" & Get ( ScriptResult ) ]`);
  // A result stays until the next Perform Script; one that exits without a result clears it.
  assert.equal(r.result, '2!|2!||outer+inner!');
});

test('Halt Script in a subscript stops the caller too, with no result', async () => {
  const r = await run(`
    Perform Script [ “Halts” ]
    Exit Script [ Text Result: "not reached" ]`);
  assert.equal(r.halted, true);
  assert.equal(r.result, '');
});

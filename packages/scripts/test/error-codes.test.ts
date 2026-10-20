// Get ( LastError ) after failing steps, against Claris's error list
// (help.claris.com/en/pro-help/content/error-codes.html). docs/error-codes.md
// has the same table with where each expectation comes from.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { ERR } from '@tabularius/calc';
import { createStore, errorMeaning, parseScriptText, Store } from '@tabularius/store';
import { ERROR, runScript, type RunOptions } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-error-codes-'));
  createStore(join(dir, 'E.sqlite'));
  store = new Store(join(dir, 'E.sqlite'), 'E');
  store.applyDesign([
    { op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'ClientId', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createTable', name: 'Empty', fields: [{ name: 'X', type: 'text' }] },
    { op: 'createRelationship', left: 'Clients', right: 'Orders', predicates: [{ left: 'Id', right: 'ClientId', operator: '=' }] },
    { op: 'createField', table: 'Clients', name: 'Shout', type: 'text', kind: 'calculation', calculation: 'Name & "!"' },
  ] as never);
  store.create('Clients', { Name: 'A', Id: '1' });
  store.create('Clients', { Name: 'B', Id: '2' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const run = (text: string, opts: RunOptions = {}) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout: 'Clients', trace: true, ...opts });

const empty = 'Go to Layout [ “Empty” ]\nShow All Records\n';
const CASES: [string, string, number][] = [
  ['Go to Record [ Next ] on the last record', 'Go to Record/Request/Page [ Last ]\nGo to Record/Request/Page [ Next ]', 101],
  ['Go to Record [ Previous ] on the first record', 'Go to Record/Request/Page [ First ]\nGo to Record/Request/Page [ Previous ]', 101],
  ['Go to Record [ First ] with no records', `${empty}Go to Record/Request/Page [ First ]`, 101],
  ['Go to Layout by a name that is not there', 'Go to Layout [ Layout Name: "Nope" ]', 105],
  ['Perform Find with no match', 'Enter Find Mode [ Pause: Off ]\nSet Field [ Clients::Name ; "zzz" ]\nPerform Find []', 401],
  ['Perform Find with no criteria', 'Enter Find Mode [ Pause: Off ]\nPerform Find []', 400],
  ['Constrain Found Set with no match', 'Enter Find Mode [ Pause: Off ]\nSet Field [ Clients::Name ; "zzz" ]\nConstrain Found Set []', 401],
  ['Set Field into a calculation field', 'Set Field [ Clients::Shout ; 1 ]', 201],
  ['Set Field with no current record', `${empty}Set Field [ Empty::X ; 1 ]`, 101],
  ['Set Field By Name, a field that is not there', 'Set Field By Name [ "Clients::Nope" ; 1 ]', 102],
  ['Delete Record with no records', `${empty}Delete Record/Request [ With dialog: Off ]`, 101],
  ['Omit Record with no records', `${empty}Omit Record`, 101],
  ['Select Window, a window that is not there', 'Select Window [ Name: "Nope" ; Current file ]', 112],
  ['Close Window, a window that is not there', 'Close Window [ Name: "Nope" ; Current file ]', 112],
  ['Go to Object, an object that is not there', 'Go to Object [ Object Name: "nope" ]', 116],
  ['Go to Field, a field not on the layout', 'Go to Field [ Orders::Total ]', 102],
  ['Go to Related Record, none related to the record', 'Go to Related Record [ Show only related records ; From table: “Orders” ; Using layout: “Orders” ]', 101],
  ['Go to Related Record, none related to the found set', 'Go to Related Record [ Show only related records ; Match all records in current found set ; From table: “Orders” ; Using layout: “Orders” ]', 401],
  ['Revert Transaction with a custom code', 'Open Transaction\nRevert Transaction [ Condition: 1 ; Error code: 5001 ; Error message: "x" ]\nCommit Transaction', 5001],
  ['Re-Login with a wrong password', 'Re-Login [ Account Name: "Admin" ; Password: "wrong" ; With dialog: Off ]', 212],
  ['A calculation that ends too soon', 'Set Variable [ $x ; Value: Evaluate ( "1 +" ) ]\nSet Variable [ $e ; Value: EvaluationError ( Evaluate ( "1 +" ) ) ]\nExit Script [ Result: $e ]', 0],
];

for (const [what, text, code] of CASES) {
  test(`${what}: ${code}`, async () => {
    const r = await run(text);
    assert.equal(r.error, code, [...(r.trace ?? [])].reverse().find((t) => t.error)?.message);
  });
}

test('EvaluationError gives the calculation codes in Claris\'s list', async () => {
  const codes = await run(`Exit Script [ Result: List (
    EvaluationError ( Evaluate ( "Left ( \\"a\\" )" ) ) ;
    EvaluationError ( Evaluate ( "Abs ( 1 ; 2 )" ) ) ;
    EvaluationError ( Evaluate ( "1 +" ) ) ;
    EvaluationError ( Evaluate ( "Nope ( 1 )" ) )
  ) ]`);
  assert.deepEqual(String(codes.result).split(/\r|\n/), ['1201', '1202', '1203', '1208']);
});

test('Insert from URL: a malformed URL is 1630, another protocol 1626', async () => {
  const network = async () => new Response('x');
  assert.equal((await run('Insert from URL [ $r ; "not a url" ]', { network, [TEST_ONLY_CUSTOM_FETCH]: true })).error, 1630);
  assert.equal((await run('Insert from URL [ $r ; "ftp://example.com/file" ]', { network, [TEST_ONLY_CUSTOM_FETCH]: true })).error, 1626);
  assert.equal((await run('Insert from URL [ $r ; "https://example.com/" ]', { network, [TEST_ONLY_CUSTOM_FETCH]: true })).error, 0);
});

test('Send Mail in outbound test mode: a copy that fails to send is 1506', async () => {
  const r = await run('Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "someone@example.com" ; Subject: "s" ; Message: "m" ]', {
    outbound: { allowHosts: [], record: () => {}, redirectTo: 'tester@example.invalid', deliver: async () => { throw new Error('refused'); } },
  });
  assert.equal(r.error, 1506);
});

test('every code the engine and calculations report has a meaning in Claris\'s list', () => {
  for (const code of [...Object.values(ERROR), ...Object.values(ERR)]) assert.ok(errorMeaning(code), `no meaning for ${code}`);
  assert.equal(errorMeaning(5042), 'Custom error from Revert Transaction');
});

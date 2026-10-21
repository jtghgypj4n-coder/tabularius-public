// "Why did this script fail?": explain_script_failure runs the script again on a throwaway copy, offline, and reports
// the failing step, the steps before it, the variables and field values there, and hints. The live file never changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { stepDiff } from '../src/design-preview.ts';
import { createStore, Store } from '../../store/src/index.ts';
import { explainScriptFailure } from '../src/script-failure.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-why-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([
    // Sets a summary field, after making a record: the record must not appear in the live file.
    { op: 'createScript', name: 'Stamp', text: 'Go to Layout [ "Congress" ]\nNew Record/Request\nSet Field [ Congress::Name ; "Temporary" ]\nSet Variable [ $v ; Value: Congress::Name ]\nSet Variable [ $apiPassword ; Value: Left ( \"Zephyr-secret-key\" ; 13 ) ]\nSet Field [ Congress::Comp_C_Average ; $v ]' },
    { op: 'createScript', name: 'Nobody', text: 'Go to Layout [ "Congress" ]\nEnter Find Mode [ Pause: Off ]\nSet Field [ Congress::State ; "ZZ" ]\nPerform Find []' },
    { op: 'createScript', name: 'Calls it', text: 'Set Variable [ $$from ; Value: "outer" ]\nPerform Script [ "Nobody" ]' },
    { op: 'createScript', name: 'Fine', text: 'Set Variable [ $x ; Value: 1 ]' },
    // A made-up access key written into a script: such scripts are never run again, as in test-scripts.
    { op: 'createScript', name: 'Keyed', text: 'Set Variable [ $key ; Value: "AKIA' + 'ABCDEFGHIJKLMNOP" ]\nSet Field [ Congress::Comp_C_Average ; 1 ]' },
  ] as never);
  store.savePrivilegeSet({
    name: 'Clerk', records: { view: true, edit: true, create: true, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let n = 0;
async function why(args: Record<string, unknown>, auth?: string): Promise<{ error: boolean; text: string; data: any }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      ...(auth ? { authorization: 'Basic ' + btoa(auth) } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name: 'explain_script_failure', arguments: { database: 'Charts', ...args } } }),
  });
  const result = (await res.json()).result;
  const text = result.content[0].text as string;
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { error: !!result.isError, text, data };
}

test('the failing step, what the error means, the steps before it, the values there, and a hint', { skip }, async () => {
  const count = store.find('Congress', { limit: 0 }).foundCount;
  const r = await why({ script: 'Stamp', layout: 'Congress' });
  assert.equal(r.error, false, r.text);
  const w = r.data;
  assert.equal(w.outcome, 'error');
  assert.equal(w.error, 201);
  assert.equal(w.meaning, "Field can't be modified");
  assert.deepEqual(w.step, { script: 'Stamp', number: 6, line: 'Set Field [ Congress::Comp_C_Average ; $v ]' });
  assert.deepEqual(w.before.map((b: { number: number }) => b.number), [1, 2, 3, 4, 5]);
  assert.equal(w.variables.locals.$v, 'Temporary');
  // A secret-looking variable is hidden from the model, in the variables and in the steps.
  assert.equal(w.variables.locals.$apiPassword, '‹hidden from AI tools›');
  assert.doesNotMatch(JSON.stringify(w), /Zephyr-secret/);
  const field = w.fields.find((f: { name: string }) => f.name === 'Congress::Comp_C_Average');
  assert.equal(field.kind, 'summary');
  assert.ok(w.hints.some((h: string) => /Comp_C_Average is a summary field, so a script can't set it/.test(h)), w.hints.join('\n'));
  assert.match(w.ranOn, /copy of the file, offline/);
  // The record it made was on the copy.
  assert.equal(store.find('Congress', { limit: 0 }).foundCount, count);
  assert.equal(store.find('Congress', { query: [{ Name: '==Temporary' }], limit: 0 }).foundCount, 0);
});

test('a find that matches nothing, in a subscript: the stack, and how to handle no matches', { skip }, async () => {
  const r = await why({ script: 'Calls it' });
  assert.equal(r.error, false, r.text);
  const w = r.data;
  assert.equal(w.error, 401);
  assert.equal(w.step.script, 'Nobody');
  assert.equal(w.step.number, 4);
  assert.deepEqual(w.stack, [{ script: 'Calls it', step: 2 }, { script: 'Nobody', step: 4 }]);
  assert.equal(w.variables.globals.$$from, 'outer');
  assert.ok(w.before.some((b: { line: string }) => /Set Field \[ Congress::State ; "ZZ" \]/.test(b.line)));
  assert.ok(w.hints.some((h: string) => /The find matched no records \(by State\)\. If that can happen, turn on Set Error Capture/.test(h)), w.hints.join('\n'));
});

test('a script that runs cleanly says so; a missing script suggests the closest name', { skip }, async () => {
  const ok = await why({ script: 'Fine' });
  assert.equal(ok.data.outcome, 'ok');
  const missing = await why({ script: 'Nobdy' });
  assert.equal(missing.error, true);
  assert.match(missing.text, /did you mean "Nobody"/);
});

test('a script with credentials written into it is never run again', { skip }, async () => {
  const r = await why({ script: 'Keyed' });
  assert.equal(r.data.outcome, 'skipped');
  assert.match(r.data.hints[0], /credentials written into it/);
  assert.doesNotMatch(r.text, new RegExp('AKIA' + 'ABCDEFGHIJKLMNOP'));
});

test('an account that can\'t see scripts\' design can\'t use it', { skip }, async () => {
  const r = await why({ script: 'Stamp' }, 'Clerk:pw');
  assert.equal(r.error, true);
  assert.match(r.text, /Insufficient privileges/);
});

test('a script\'s changed steps as a diff, with a step of context either side', () => {
  assert.deepEqual(stepDiff(['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['A', 'B', 'C', 'X', 'E', 'F', 'G', 'H']), [
    '  3. C', '- D', '+ 4. X', '  5. E', '  …', '  7. G', '+ 8. H',
  ]);
  assert.deepEqual(stepDiff(['A'], ['A']), []);
});

test('a non-secret script literal stays visible while matching field, SQL and calc reads stay redacted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-literal-redaction-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const local = new Store(path, 'Local');
  try {
    local.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Password' }, { name: 'Note' }] },
      { op: 'createField', table: 'T', name: 'Hint', kind: 'calculation', type: 'text', calculation: 'Left ( Password ; 9 )' },
      { op: 'createScript', name: 'Overlap', text: [
        'Set Variable [ $early ; Value: "Temporary" ]',
        'Set Variable [ $apiPassword ; Value: Left ( "Temporary-secret" ; 16 ) ]',
        'Set Variable [ $literal ; Value: "Temporary" ]',
        'Set Variable [ $$literal ; Value: ( "Temporary" ) ]',
        'Set Variable [ $repeat[1 + 1] ; Value: "Temporary" ]',
        'Set Variable [ $repeat ; Value: T::Note ]',
        'Set Variable [ $overwritten ; Value: "Temporary" ]',
        'Set Variable [ $OVERWRITTEN ; Value: T::Note ]',
        'Set Variable [ $$overwritten ; Value: "Temporary" ]',
        'Set Variable [ $$overwritten ; Value: T::Note ]',
        'Set Variable [ $assigned ; Value: "Temporary" ]',
        'Set Variable [ $effect ; Value: Let ( $assigned = T::Note ; 1 ) ]',
        'Set Field [ T::Note ; "Temporary" ]',
        'Set Variable [ $field ; Value: T::Note ]',
        'Set Variable [ $sql ; Value: Left ( ExecuteSQL ( "SELECT Pa" & "ssword FROM T" ; "" ; "" ) ; 9 ) ]',
        'Set Variable [ $calc ; Value: T::Hint ]',
        'Set Field [ T::Hint ; "ordinary" ]',
      ].join('\n') },
    ]);
    const row = local.create('T', { Password: 'Temporary-secret', Note: 'Temporary' });
    const result = await explainScriptFailure(local, { script: 'Overlap', layout: 'T', recordId: Number(row.recordId) }, { account: 'Admin' });
    assert.equal(result.outcome, 'error');
    assert.equal(result.error, 201);
    const vars = result.variables!.locals;
    for (const name of ['$field', '$sql', '$calc', '$repeat', '$OVERWRITTEN', '$assigned']) assert.equal(vars[name], '‹redacted›', name);
    assert.equal(vars.$apiPassword, '‹hidden from AI tools›');
    assert.equal(vars.$early, 'Temporary');
    assert.equal(vars.$literal, 'Temporary');
    assert.equal(vars['$repeat[2]'], 'Temporary');
    assert.equal(result.variables!.globals.$$literal, 'Temporary');
    assert.equal(result.variables!.globals.$$overwritten, '‹redacted›');
  } finally {
    local.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

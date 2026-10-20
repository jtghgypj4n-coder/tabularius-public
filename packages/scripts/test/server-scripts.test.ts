// Perform Script on Server: a session of its own on the server, as the
// caller's account, with the result passed back only when waited for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStore, Store, writer } from '@tabularius/store';
import { runScript, type ServerQueue } from '../src/index.ts';
import { decodeStepParams, stepLine } from '../../fmp12/src/script-params.ts';
import { kid, parseXml, stepSpec } from '../../store/src/snippet.ts';
import { stepXml } from '../../store/src/snippet-xml.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-psos-'));
  createStore(join(dir, 'Jobs.sqlite'));
  store = new Store(join(dir, 'Jobs.sqlite'), 'Jobs');
  store.applyDesign([{ op: 'createTable', name: 'Things', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }] }]);
  for (let i = 1; i <= 3; i++) store.create('Things', { Id: String(i), Name: `thing ${i}` });
  const psos = (script: { id: number; name: string }, wait = true) => ({ stepId: 164, name: 'Perform Script on Server', enabled: true, params: { script, parameter: '"hi"', ...(wait ? {} : { wait: false }) } });
  store.applyDesign([
    { op: 'createScript', id: 10, name: 'Report', text: [
      'Exit Script [ Text Result: Get ( ScriptParameter ) & "|" & $$caller & "|" & Get ( FoundCount ) & "|" & Get ( AccountName ) ]',
    ].join('\n') },
    { op: 'createScript', id: 11, name: 'Edit first', text: [
      'Set Field [ Things::Name ; "edited on the server" ]',
      // A record someone else is editing fails at Set Field (301), as in FileMaker.
      'Set Variable [ $e ; Value: Get ( LastError ) ]',
      'Commit Records/Requests [ With dialog: Off ]',
      'Exit Script [ Text Result: Max ( $e ; Get ( LastError ) ) ]',
    ].join('\n') },
    { op: 'createScript', id: 1, name: 'Ask', steps: [
      { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$$caller', value: '"mine"' } },
      psos({ id: 10, name: 'Report' }),
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( ScriptResult ) & "/" & Get ( LastError )' } },
    ] },
    { op: 'createScript', id: 2, name: 'Edit', steps: [
      psos({ id: 11, name: 'Edit first' }),
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( ScriptResult )' } },
    ] },
    { op: 'createScript', id: 3, name: 'Fire and forget', steps: [
      psos({ id: 11, name: 'Edit first' }, false),
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: '"carried on:" & Get ( ScriptResult )' } },
    ] },
  ]);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const first = () => store.findIds('Things')[0];
const name = () => String(store.get('Things', first()).fieldData.Name);

test('the server script starts fresh, as the same account, and its result comes back', async () => {
  const r = await runScript(store, 'Ask', { account: 'Ann', layout: 'Things', foundSet: [first()] });
  // Its parameter, none of the caller's globals or found set, the caller's account.
  assert.equal(r.result, 'hi||3|Ann/0');
});

test("records the caller is editing are locked to the server script too", async () => {
  const owner = 'client-session';
  assert.ok(store.locks.acquire('Things', first(), owner, 'Ann').ok);
  const r = await writer.run({ owner, account: 'Ann' }, () => runScript(store, 'Edit', { account: 'Ann', layout: 'Things' }));
  assert.equal(r.result, '301', 'record in use by another user');
  assert.equal(name(), 'thing 1');
  store.locks.release('Things', first(), owner);
});

test('without waiting, the caller carries on and the server script still runs', async () => {
  const queue: ServerQueue & { ran: number } = { ran: 0, run(script) { this.ran++; return script(); } };
  const r = await runScript(store, 'Fire and forget', { account: 'Ann', layout: 'Things', serverQueue: queue });
  assert.equal(r.result, 'carried on:', 'no result without waiting');
  assert.equal(queue.ran, 1, 'it took its turn in the server queue');
  for (let i = 0; i < 40 && name() !== 'edited on the server'; i++) await sleep(25);
  assert.equal(name(), 'edited on the server');
});

test('Wait for completion: Off written in script text runs without waiting', async () => {
  store.applyDesign([{ op: 'createScript', name: 'No wait from text', text: [
    'Perform Script on Server [ “Report” ; Parameter: "hi" ; Wait for completion: Off ]',
    'Exit Script [ Text Result: "carried on:" & Get ( ScriptResult ) ]',
  ].join('\n') }]);
  const script = store.schema.scripts.find((x) => x.name === 'No wait from text')!;
  assert.equal(script.steps[0].params?.wait, false);
  assert.equal(stepLine(script.steps[0].name, script.steps[0].params), 'Perform Script on Server [ “Report” ; Parameter: "hi" ; Wait for completion: Off ]');
  const queue: ServerQueue & { ran: number } = { ran: 0, run(job) { this.ran++; return job(); } };
  const r = await runScript(store, 'No wait from text', { account: 'Ann', layout: 'Things', serverQueue: queue });
  assert.equal(r.result, 'carried on:');
  assert.equal(queue.ran, 1);
  // "On" is the default and needs no option.
  store.applyDesign([{ op: 'createScript', name: 'Wait from text', text: 'Perform Script on Server [ “Report” ; Wait for completion: On ]' }]);
  assert.equal(store.schema.scripts.find((x) => x.name === 'Wait from text')!.steps[0].params?.wait, undefined);
});

test('Wait for completion is read from file step flags and clipboard XML, and written back', () => {
  const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: (id: number) => (id === 10 ? 'Report' : undefined), tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined };
  // 28-byte step record: script reference [2][1][id] at 6, step id at 20-21, flags at 24-27; byte 26 & 0x01 (bit 8) means Wait for completion is off.
  const rec = (flags: string) => new Uint8Array(Buffer.from('000000000000' + '02010a' + '0'.repeat(22) + '00a4' + '0000' + flags, 'hex'));
  assert.equal(decodeStepParams(164, rec('00000100'), undefined, ctx)?.wait, false);
  assert.equal(decodeStepParams(164, rec('00004000'), undefined, ctx)?.wait, undefined);
  assert.equal(decodeStepParams(148, rec('00000100'), undefined, ctx)?.wait, undefined, 'Install OnTimer Script has no such option');

  const schema = { tables: [], tableOccurrences: [], layouts: [], scripts: [{ id: 10, name: 'Report' }], valueLists: [] } as never;
  const paste = (xml: string) => {
    const notes: string[] = [];
    return { params: stepSpec(kid(parseXml(xml), 'Step')!, { schema, notes, scripts: new Map() }).params, notes };
  };
  const off = paste('<Step enable="True" id="164" name="Perform Script on Server"><WaitForCompletion state="False"/><Script id="10" name="Report"/></Step>');
  assert.equal(off.params?.wait, false);
  assert.deepEqual(off.notes, []);
  const on = paste('<Step enable="True" id="164" name="Perform Script on Server"><WaitForCompletion state="True"/><Script id="10" name="Report"/></Step>');
  assert.equal(on.params?.wait, undefined);
  assert.deepEqual(on.notes, []);
  const xml = stepXml(schema, { stepId: 164, name: 'Perform Script on Server', enabled: true, params: { script: { id: 10, name: 'Report' }, wait: false } } as never, []);
  assert.match(xml, /<WaitForCompletion state="False"\/>/);
  assert.equal(paste(xml).params?.wait, false);
});

test('with a callback, the caller carries on and the callback runs afterwards with the server script\'s result', async () => {
  store.applyDesign([
    { op: 'createScript', name: 'Called back', text: [
      'Set Field [ Things::Name ; Get ( ScriptResult ) & "/" & Get ( ScriptParameter ) & "/" & $$order ]',
      'Commit Records/Requests [ With dialog: Off ]',
    ].join('\n') },
    { op: 'createScript', name: 'With callback', text: [
      'Perform Script on Server with Callback [ “Report” ; Parameter: "srv" ; Callback script: “Called back” ; Parameter: "cb" ; State: Continue ]',
      'Set Variable [ $$order ; Value: "caller first" ]',
      'Exit Script [ Text Result: "done:" & Get ( ScriptResult ) ]',
    ].join('\n') },
  ]);
  const r = await runScript(store, 'With callback', { account: 'Ann', layout: 'Things', foundSet: [first()] });
  assert.equal(r.error, 0);
  assert.equal(r.result, 'done:');
  assert.equal(name(), 'srv||3|Ann/cb/caller first');
});

test('the callback\'s parameter is worked out when the callback runs, where the caller\'s $variables have no value', async () => {
  store.applyDesign([
    { op: 'createScript', name: 'Echo', text: 'Set Field [ Things::Name ; Get ( ScriptParameter ) ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Late parameter', text: [
      'Set Variable [ $local ; Value: "mine" ]',
      'Set Variable [ $$late ; Value: "before" ]',
      'Perform Script on Server with Callback [ “Report” ; Parameter: "srv" ; Callback script: “Echo” ; Parameter: $$late & "/" & $local & "/" & Get ( ScriptResult ) ; State: Continue ]',
      'Set Variable [ $$late ; Value: "after" ]',
    ].join('\n') },
  ]);
  const r = await runScript(store, 'Late parameter', { account: 'Ann', layout: 'Things', foundSet: [first()] });
  assert.equal(r.error, 0);
  // $$late as it was at the end, no $local, and the server script's result.
  assert.equal(name(), 'after//srv||3|Ann');
});

// Outbound test mode: a script looping over a blocked service is stopped with a
// message naming it, and each run reports the outside services it tried.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { describeOutside, runScript, testScripts, type OutboundTest, type OutboxEntry } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-outbound-loop-'));
  createStore(join(dir, 'L.sqlite'));
  store = new Store(join(dir, 'L.sqlite'), 'L');
  store.applyDesign([{ op: 'createTable', name: 'Campaigns', fields: [{ name: 'Id', type: 'text' }] }]);
  store.applyDesign([
    // Like a private sample's delete script: one call per record, looping until the service answers.
    { op: 'createScript', name: 'Delete campaigns', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nInsert from URL [ $r ; "https://api.adserver.example/v1/campaign/" & $i ]\nExit Loop If [ $r = "done" ]\nEnd Loop' },
    { op: 'createScript', name: 'Few calls', text: 'Insert from URL [ $a ; "https://api.adserver.example/one" ]\nInsert from URL [ $b ; "https://api.adserver.example/two" ]\nOpen URL [ "https://www.example.com/" ]\nOpen URL [ $empty ]\nExit Script [ Text Result: "ok" ]' },
    { op: 'createScript', name: 'Server side', text: 'Perform Script on Server [ “Delete campaigns” ]\nSet Variable [ $after ; Value: 1 ]\nExit Script [ Text Result: "carried on" ]' },
  ]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

function testMode(extra: Partial<OutboundTest> = {}): { mode: OutboundTest; entries: OutboxEntry[] } {
  const entries: OutboxEntry[] = [];
  return { entries, mode: { allowHosts: [], record: (e) => entries.push(e), ...extra } };
}

test('a script calling a blocked host over and over is stopped, naming the host', async () => {
  const { mode, entries } = testMode();
  const r = await runScript(store, 'Delete campaigns', { outbound: mode, network: false });
  assert.equal(r.halted, true);
  assert.equal(entries.length, 100);
  const halt = r.actions.find((a) => a.step === 'Halt Script');
  assert.match(String((halt as { reason?: string }).reason), /keeps calling api\.adserver\.example, which test mode blocks \(100 calls\)/);
  assert.deepEqual(r.outside, [{ host: 'api.adserver.example', via: ['Insert from URL'], calls: 100, sent: 0 }]);
  // The limit can be set.
  const few = testMode({ refusedCallLimit: 5 });
  await runScript(store, 'Delete campaigns', { outbound: few.mode, network: false });
  assert.equal(few.entries.length, 5);
});

test('test-scripts counts it as stalled, says why, and lists what each script tried', async () => {
  const { mode } = testMode();
  const results = await testScripts(store, { scripts: ['Delete campaigns', 'Few calls'], outbound: mode });
  const loop = results.find((r) => r.script === 'Delete campaigns')!;
  assert.equal(loop.outcome, 'stalled');
  assert.match(loop.message ?? '', /^refused-call limit reached: the script keeps calling api\.adserver\.example/);
  const few = results.find((r) => r.script === 'Few calls')!;
  assert.equal(few.outcome, 'ok');
  assert.deepEqual(few.outside?.map((o) => [o.host, o.calls, o.sent, o.via.join()]), [
    ['api.adserver.example', 2, 0, 'Insert from URL'],
    ['www.example.com', 1, 0, 'Open URL'],
    ['', 1, 0, 'Open URL'],
  ]);
  assert.equal(describeOutside(few.outside!, 1),
    'Tried api.adserver.example 2 times (all blocked), www.example.com once (blocked), a web address with no host (probably built from an empty field) once (blocked); wrote 1 email (captured in the outbox)');
  assert.equal(describeOutside([], 2), 'Wrote 2 emails (captured in the outbox)');
});

test('calls made by a script on the server count too, and stop the caller', async () => {
  const { mode, entries } = testMode();
  const r = await runScript(store, 'Server side', { outbound: mode, network: false });
  assert.equal(entries.length, 100);
  assert.equal(r.outside?.[0].calls, 100);
  assert.equal(r.halted, true);
  assert.notEqual(r.result, 'carried on');
});

test('without test mode nothing is counted', async () => {
  const r = await runScript(store, 'Few calls', { network: false });
  assert.equal(r.outside, undefined);
});

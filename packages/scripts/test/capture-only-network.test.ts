// A capture-only file never reaches the network, even on a server that lets scripts do so: Insert from
// URL is refused outright, and in outbound test mode the request is recorded but never sent, whatever hosts
// the test allows. A script on the server started from such a file counts too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript, setCaptureOnlyDefaults, type OutboxEntry } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let heldFile: Store;
let shop: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-heldFile-network-'));
  const make = (name: string) => {
    createStore(join(dir, `${name}.sqlite`));
    const s = new Store(join(dir, `${name}.sqlite`), name);
    s.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'x' }] },
      { op: 'createScript', name: 'Fetch', text: 'Insert from URL [ $r ; "https://api.example.com/v1" ]\nExit Script [ Text Result: $r ]' },
    ]);
    return s;
  };
  heldFile = make('Held_Sample');
  shop = make('Shop');
});
after(() => {
  heldFile?.close();
  shop?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A network that records what it was asked for. */
function net() {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response('reached');
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

test('a capture-only file is refused the network, whatever the server allows', async () => {
  const { urls, fetch } = net();
  const r = await runScript(heldFile, 'Fetch', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, trace: true });
  assert.equal(r.error, 3);
  assert.match(r.trace?.find((t) => t.message)?.message ?? '', /capture-only/);
  assert.deepEqual(urls, []);
  // Any other file still can.
  assert.equal((await runScript(shop, 'Fetch', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch })).result, 'reached');
});

test('in outbound test mode its request is recorded and never sent, even to an allowed host', async () => {
  const { urls, fetch } = net();
  const entries: OutboxEntry[] = [];
  const r = await runScript(heldFile, 'Fetch', { [TEST_ONLY_CUSTOM_FETCH]: true, network: false, outbound: { allowHosts: ['api.example.com'], record: (e) => entries.push(e), fetch } });
  assert.equal(r.result, '');
  assert.deepEqual(urls, []);
  assert.equal(entries.length, 1);
  assert.equal((entries[0] as { allowed?: boolean }).allowed, false);
});

test('a script on the server started from a capture-only file is refused too', async () => {
  const { urls, fetch } = net();
  const r = await runScript(shop, 'Fetch', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, callerFiles: ['Held_Sample'], trace: true });
  assert.equal(r.error, 3);
  assert.deepEqual(urls, []);
});

test('a capture-only script that has returned still can\'t steer a request (its result carries its data)', async () => {
  for (const onServer of [false, true]) {
    const { urls, fetch } = net();
    shop.resolveFile = (n) => (n.toLowerCase() === 'held_sample' ? heldFile : undefined);
    heldFile.resolveFile = () => undefined;
    if (!shop.schema.dataSources.some((d) => d.name === 'Held_Sample')) shop.applyDesign([{ op: 'createDataSource', name: 'Held_Sample', paths: ['file:Held_Sample'] } as never]);
    const ds = shop.schema.dataSources.find((d) => d.name === 'Held_Sample')!;
    heldFile.schema.scripts.push({ id: 7001, name: 'hand back', steps: [
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: '"https://api.example.com/?from=heldFile"' } },
    ] } as never);
    const r = await runScript(shop, { id: 9999, name: 'caller', steps: [
      { stepId: onServer ? 164 : 1, name: onServer ? 'Perform Script on Server' : 'Perform Script', enabled: true, params: { script: { id: 7001, name: 'hand back', file: { id: ds.id, name: 'Held_Sample' } } } },
      { stepId: 160, name: 'Insert from URL', enabled: true, params: { variable: '$r', calculation: 'Get ( ScriptResult )' } },
    ] } as never, { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, trace: true });
    heldFile.schema.scripts.pop();
    assert.equal(r.error, 3, `${onServer ? 'on server' : 'Perform Script'}: ${r.trace?.find((t) => t.message)?.message}`);
    assert.deepEqual(urls, []);
  }
});

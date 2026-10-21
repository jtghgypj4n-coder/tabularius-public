// BaseElements' web and mail functions run where scripts may reach the network (the file's Script network switch), through the
// same guarded transport as Insert from URL, and give ? and error 3 where they may not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript, type OutgoingMail } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

let dir: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'be-network-'));
  createStore(join(dir, 'Shop.sqlite'));
  store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
});
after(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const script = (n: string, text: string) => store.applyDesign([{ op: 'createScript', name: n, text }]);

function net() {
  const seen: { url: string; method?: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
    return new Response('{"ok":true}', { status: 201, headers: { 'x-thing': 'yes' } });
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

test('BE_HTTP_GET and POST make real requests where scripts may reach the network, and the response functions read them', async () => {
  script('Web', [
    'Set Variable [ $get ; Value: BE_HTTP_GET ( "https://api.example.com/a" ; "" ; "ann" ; "pw" ) ]',
    'Set Variable [ $code ; Value: BE_HTTP_ResponseCode ]',
    'Set Variable [ $has ; Value: BE_HTTP_ResponseHeaders ( "X-Thing" ) ]',
    'Set Variable [ $h ; Value: BE_HTTP_SetCustomHeader ( "X-Key" ; "k1" ) ]',
    'Set Variable [ $post ; Value: BE_HTTP_POST ( "https://api.example.com/b" ; "a=1&b=2" ) & "|" & BE_GetLastError ]',
    'Exit Script [ Text Result: $get & "|" & $code & "|" & $has & "|" & $post ]',
  ].join('\n'));
  const { seen, fetch } = net();
  const r = await runScript(store, 'Web', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, trace: true });
  assert.equal(r.result, '{"ok":true}|201|1|{"ok":true}|0', JSON.stringify(r.trace));
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers.authorization, `Basic ${Buffer.from('ann:pw').toString('base64')}`);
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].body, 'a=1&b=2');
  assert.equal(seen[1].headers['x-key'], 'k1');
  assert.equal(seen[1].headers['content-type'], 'application/x-www-form-urlencoded');
});

test('where scripts may not reach the network the web functions give ?, and nothing is sent', async () => {
  script('WebOff', 'Set Variable [ $r ; Value: BE_HTTP_GET ( "https://api.example.com/a" ) & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]');
  const { seen, fetch } = net();
  assert.equal((await runScript(store, 'WebOff', { [TEST_ONLY_CUSTOM_FETCH]: true, network: false })).result, '?|3');
  // The network is on for the run but a file it reaches is not allowed it.
  assert.equal((await runScript(store, 'WebOff', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, networkFiles: () => false })).result, '?');
  assert.deepEqual(seen, []);
});

test('BE_SMTPSend sends through the server\'s mail where sending is set up and scripts may use the network', async () => {
  script('Mail', 'Set Variable [ $r ; Value: BE_SMTPSend ( "me@example.com" ; "you@example.com" ; "Hi" ; "Body" ) & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]');
  const sent: OutgoingMail[] = [];
  const mail = async (m: OutgoingMail) => { sent.push(m); };
  const { fetch } = net();
  const on = await runScript(store, 'Mail', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, mail });
  assert.equal(on.result, '|0');
  assert.deepEqual(sent.map((m) => [m.to, m.subject, m.text]), [[['you@example.com'], 'Hi', 'Body']]);
  // No network for the run, or no mail set up: nothing is sent.
  assert.equal((await runScript(store, 'Mail', { network: false, mail })).result, '?|3');
  assert.equal((await runScript(store, 'Mail', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch })).result, '?|3');
  assert.equal(sent.length, 1);
});

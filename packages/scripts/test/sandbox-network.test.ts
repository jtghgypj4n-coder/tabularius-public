import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, parseScriptText } from '../../store/src/index.ts';
import { runScript, type RunOptions, type OutboxEntry } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';
import { PluginManifest } from '../../plugins/src/manifest.ts';
import { sandboxedCalls } from '../../plugins/src/sandboxed.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { body, calls, grep, owner, parse, source } from './sandbox-support.ts';

let dir: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-network-'));
  createStore(join(dir, 'Network.sqlite'));
  store = new Store(join(dir, 'Network.sqlite'), 'Network');
});
after(async () => { await stopJavaScript(); store?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
const quote = (s: string) => JSON.stringify(s);
async function insert(url: string, options: RunOptions = {}, curl = '') {
  const text = `Set Error Capture [ On ]\nInsert from URL [ $answer ; ${quote(url)} ]\nExit Script [ Get ( LastError ) & "|" & $answer ]`;
  const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
  if (curl) steps[1].params = { ...steps[1].params, slots: { 129: quote(curl) } };
  return runScript(store, { id: 999, name: 'Probe', steps }, { trace: true, [TEST_ONLY_CUSTOM_FETCH]: true, ...options });
}

test('the offline switch covers URLs, cURL options and connection URLs before any transport', async (t) => {
  const sent: string[] = [];
  const network: typeof fetch = async (url) => { sent.push(String(url)); return new Response('sent'); };
  t.mock.method(globalThis, 'fetch', network);
  for (const network of [undefined, false]) for (const url of ['https://allowed.example/', 'connection://approved/path']) {
    const run = await insert(url, { network }, '--request POST --data payload');
    assert.equal(run.result, '3|');
    assert.match(JSON.stringify(run.trace), /Network access is off/);
  }
  assert.deepEqual(sent, []);
  assert.equal((await insert('https://allowed.example/', { network })).result, '0|sent');
  assert.deepEqual(sent, ['https://allowed.example/']);
});

test('a file whose network access is off refuses web requests in the words it was given, wherever it is on the call stack', async () => {
  const sent: string[] = [];
  const network: typeof fetch = async (url) => { sent.push(String(url)); return new Response('sent'); };
  const url = 'https://allowed.example/';
  const networkOff = (file: string) => `Network access is off for "${file}". Turn it on in the admin console.`;
  // No network for the run: the message names the file that started it.
  const none = await insert(url, { network: false, networkOff });
  assert.equal(none.result, '3|');
  assert.match(JSON.stringify(none.trace), /off for \\"Network\\"\. Turn it on in the admin console/);
  // The network is on, but a file the run reaches is not allowed it.
  for (const options of [{ callerFiles: ['Elsewhere'] }, { networkFiles: () => false }]) {
    const run = await insert(url, { network, networkFiles: (file: string) => file === 'Network' && !('callerFiles' in options), networkOff, ...options });
    assert.equal(run.result, '3|');
    assert.match(JSON.stringify(run.trace), /Network access is off for/);
  }
  assert.match(JSON.stringify((await insert(url, { network, networkFiles: (file: string) => file !== 'Elsewhere', networkOff, callerFiles: ['Elsewhere'] })).trace), /\\"Elsewhere\\"/);
  // A run that starts in a file with no network and reaches an allowed one names the file that is off.
  const started = await insert(url, { network: false, networkFiles: (file: string) => file !== 'Elsewhere', networkOff, callerFiles: ['Elsewhere'] });
  assert.match(JSON.stringify(started.trace), /\\"Elsewhere\\"/);
  assert.deepEqual(sent, []);
  // Every file allowed: the request goes out.
  assert.equal((await insert(url, { network, networkFiles: () => true, networkOff })).result, '0|sent');
  assert.deepEqual(sent, [url]);
});

test('URL and cURL requests refuse non-web protocols and malformed addresses before fetch', async () => {
  const sent: string[] = [];
  const network: typeof fetch = async (url) => { sent.push(String(url)); return new Response('sent'); };
  for (const curl of ['', '--location --proxy http://allowed.example --resolve allowed.example:80:127.0.0.1']) {
    for (const url of ['file:///etc/passwd', 'ftp://allowed.example/a', 'gopher://allowed.example/', 'data:text/plain,secret']) {
      assert.equal((await insert(url, { network }, curl)).result, '1626|', url);
    }
    for (const url of ['not a URL', 'https://[broken']) assert.equal((await insert(url, { network }, curl)).result, '1630|', url);
  }
  assert.deepEqual(sent, []);
});

test('outbound address filtering covers initial requests, credentials, suffix tricks and every redirect', async () => {
  const sent: string[] = [];
  const entries: OutboxEntry[] = [];
  const network: typeof fetch = async (url, init) => {
    sent.push(String(url));
    assert.equal(init?.redirect, 'manual');
    return String(url).endsWith('/redirect')
      ? new Response('', { status: 302, headers: { location: 'https://denied.example/secret' } }) : new Response('allowed');
  };
  const outbound = { allowHosts: ['allowed.example', 'amazonaws.com', 'aws'], fetch: network, record: (e: OutboxEntry) => entries.push(e) };
  for (const curl of ['', '--location --request POST --data payload']) {
    for (const url of ['https://denied.example/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/',
      'https://allowed.example.evil.test/', 'https://allowed.example@denied.example/', 'https://bucket.amazonaws.com/', 'https://BUCKET.AMAZONAWS.COM./', 'https://service.aws/']) {
      entries.length = 0;
      assert.equal((await insert(url, { outbound }, curl)).result, '0|');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].kind === 'http' && entries[0].allowed, false, url);
    }
  }
  assert.deepEqual(sent, []);
  assert.equal((await insert('https://sub.allowed.example/', { outbound })).result, '0|allowed');
  const redirected = await insert('https://allowed.example/redirect', { outbound }, '--location');
  assert.equal(redirected.result, '1631|');
  assert.match(JSON.stringify(redirected.trace), /redirected to denied.example, which is not allowed/);
  assert.deepEqual(sent, ['https://sub.allowed.example/', 'https://allowed.example/redirect']);
});

test('third-party HTTP requests obey the offline switch and manifest addresses on every hop', async () => {
  const manifest = PluginManifest.parse({ id: 'org.test.network', name: 'Network', version: '1.0.0', api: '^1.0', publisher: 'Test', main: 'main.js',
    functions: [{ name: 'Probe', min: 1 }], permissions: { network: ['allowed.example', '*.sub.example'] } });
  const call = sandboxedCalls(manifest, 'const functions = { Probe: (url) => { const r = tabularius.http.request({url}); return r.error || r.body; } };').Probe;
  store.plugin = () => ({ min: 1, call });
  store.pluginsUseNetwork = () => true;
  const sent: string[] = [];
  const network: typeof fetch = async (url) => {
    sent.push(String(url));
    return String(url).endsWith('/redirect') ? new Response('', { status: 302, headers: { location: 'https://denied.example/' } }) : new Response('allowed');
  };
  const run = (url: string, options: RunOptions) => runScript(store, { id: 1, name: 'Plugin network', steps: [
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: `Probe ( ${quote(url)} )` } },
  ] }, { [TEST_ONLY_CUSTOM_FETCH]: true, ...options });
  assert.equal((await run('https://allowed.example/', {})).result, '?');
  assert.equal((await run('https://allowed.example/', { network: false })).result, '?');
  for (const url of ['file://allowed.example/data', 'https://denied.example/', 'https://allowed.example.evil.test/', 'https://allowed.example@denied.example/', 'https://sub.example/']) {
    assert.equal((await run(url, { network })).result, '?', url);
  }
  assert.deepEqual(sent, []);
  assert.equal((await run('https://child.sub.example/', { network })).result, 'allowed');
  assert.match((await run('https://allowed.example/redirect', { network })).result, /redirected to denied.example, which the plug-in may not reach/);
  assert.deepEqual(sent, ['https://child.sub.example/', 'https://allowed.example/redirect']);
});

test('source grep inventories network entry points and their guard calls', (t) => {
  const entries = grep('packages/scripts/src', /(?:private async insert(?:FromUrl|ViaConnection)|case 160:)/g);
  t.diagnostic(JSON.stringify(entries));
  assert.deepEqual(entries.map((e) => e.match).sort(), ['case 160:', 'private async insertFromUrl', 'private async insertViaConnection'].sort());
  const transports = grep('packages/scripts/src', /\b(?:fetchWithCurlAuth|doFetch|fetch)\s*\(/g);
  t.diagnostic(JSON.stringify(transports));
  assert.deepEqual(transports.map((e) => `${e.file}:${e.match}`), [
    'doFetch(', 'doFetch(', 'doFetch(', 'fetchWithCurlAuth(', 'doFetch(', 'fetchWithCurlAuth(', 'fetchWithCurlAuth(', 'doFetch(', 'doFetch(',
  ].map((call) => `packages/scripts/src/engine.ts:${call}`), 'new network transports need guard coverage');
  const tree = parse(source('packages/scripts/src/engine.ts'));
  const entry = body(tree, 'insertFromUrl');
  assert.equal(calls(entry, /^this\.requireScriptNetwork$/).length, 1);
  assert.equal(calls(entry, /^requireScriptUrl$/).length, 1);
  assert.ok(calls(entry, /^this\.requireScriptNetwork$/)[0].pos < calls(entry, /^this\.insertViaConnection$/)[0].pos);
  assert.equal(calls(entry, /^hostAllowed$/).length, 2, 'initial address and redirect');
  assert.deepEqual(calls(tree, /^this\.insertFromUrl$/).map(owner), ['step']);
  assert.deepEqual(calls(tree, /^this\.insertViaConnection$/).map(owner), ['insertFromUrl']);
  // Any additional transport call needs an explicit guard review, even in a newly added method.
  assert.deepEqual(calls(tree, /^fetchWithCurlAuth$/).map(owner), ['insertFromUrl', 'insertFromUrl']);
  assert.deepEqual(calls(tree, /^doFetch$/).map(owner), ['fetchForPlugin', 'fetchForPlugin', 'fetchForPlugin', 'insertFromUrl', 'fetchWithCurlAuth', 'fetchWithCurlAuth']);
  assert.equal(calls(body(tree, 'pluginNetwork'), /^this\.mayFetch$/).length, 1);
  assert.equal(calls(body(tree, 'fetchForPlugin'), /^ask\.allows$/).length, 4, 'plug-in and CURL initial addresses and redirects');
  assert.equal(calls(body(tree, 'fetchForPlugin'), /^this\.scriptFetch$/).length, 1);
  assert.equal(calls(body(tree, 'scriptFetch'), /^guardedFetcher$/).length, 1, 'real network uses the shared guard');
  const host = body(parse(source('packages/plugins/src/sandboxed.ts')), 'pluginHost');
  assert.equal(calls(host, /^pluginAllowsUrl$/).length, 1);
  assert.equal(calls(host, /^allows$/).length, 1, 'initial address');
  assert.match(calls(host, /^env\.ctx\.network\.fetch$/)[0].arguments[1].getText(), /\ballows\b/, 'redirects inherit the same guard');
});

// A plug-in allowed to reach web hosts makes real requests where scripts may use the network (the host makes each
// one and runs the step again), only to the hosts its plugin.json lists, and never from a capture-only file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { PluginRegistry, readPlugin } from '../../plugins/src/index.ts';
import { runScript, setCaptureOnlyDefaults } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let store: Store;
let heldFile: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-net-'));
  createStore(join(dir, 'Shop.sqlite'));
  store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  const d = join(dir, 'web');
  mkdirSync(d);
  writeFileSync(join(d, 'plugin.json'), JSON.stringify({
    id: 'org.example.web', name: 'Web', version: '1.0.0', api: '^1.0', publisher: 'Example', main: 'main.js',
    permissions: { network: ['api.example.com'] }, functions: [{ name: 'Web_Get', min: 1, max: 1 }, { name: 'Web_Post', min: 2, max: 2 }],
  }));
  writeFileSync(join(d, 'main.js'), `const functions = {
    Web_Get: (url) => { const r = tabularius.http.request({ url, headers: { Authorization: 'Bearer abc' } }); return r.error ? 'error: ' + r.error : r.status + ':' + r.body; },
    Web_Post: (url, body) => { const r = tabularius.http.request({ method: 'POST', url, body }); return r.status + ':' + r.body; },
  };`);
  const reg = new PluginRegistry();
  const { manifest, calls } = readPlugin(d);
  reg.install(manifest, calls);
  reg.enable('Shop', manifest.id);
  store.plugin = reg.lookup('Shop');
  store.pluginsUseNetwork = () => reg.usesNetwork('Shop');
  // A capture-only file (named by prefix) with the same plug-in on.
  createStore(join(dir, 'Held_Test.sqlite'));
  heldFile = new Store(join(dir, 'Held_Test.sqlite'), 'Held_Test');
  heldFile.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  reg.enable('Held_Test', 'org.example.web');
  heldFile.plugin = reg.lookup('Held_Test');
  heldFile.pluginsUseNetwork = () => reg.usesNetwork('Held_Test');
});
after(async () => {
  await stopJavaScript();
  store?.close();
  heldFile?.close();
  rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }
function fakeWeb(routes: Record<string, () => Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
    const route = routes[String(url)];
    return route ? route() : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fn, seen };
}
const run = async (formula: string, opts: Record<string, unknown>) =>
  (await runScript(store, script(`Exit Script [ Text Result: ${formula} ]`), { layout: 'Items', [TEST_ONLY_CUSTOM_FETCH]: true, ...opts })).result;

test('a plug-in makes its web request once, for the hosts it lists, and gets the answer', async () => {
  const web = fakeWeb({ 'https://api.example.com/a': () => new Response('hello', { status: 200 }), 'https://api.example.com/p': () => new Response('made', { status: 201 }) });
  assert.equal(await run('Web_Get ( "https://api.example.com/a" ) & "/" & Web_Get ( "https://api.example.com/a" )', { network: web.fetch }), '200:hello/200:hello');
  // The same request twice in a step is made once, and the plug-in's own headers go with it.
  assert.equal(web.seen.length, 1);
  assert.equal(web.seen[0].headers.authorization, 'Bearer abc');
  assert.equal(await run('Web_Post ( "https://api.example.com/p" ; "x=1" )', { network: web.fetch }), '201:made');
  assert.deepEqual(web.seen.slice(1).map((s) => [s.method, s.body]), [['POST', 'x=1']]);
  // A later step asks afresh.
  assert.equal(await run('Web_Get ( "https://api.example.com/a" )', { network: web.fetch }), '200:hello');
  assert.equal(web.seen.length, 3);
});

test('a plug-in can\'t reach hosts it didn\'t list, even by a redirect', async () => {
  const web = fakeWeb({ 'https://api.example.com/r': () => new Response('', { status: 302, headers: { location: 'https://evil.example.org/x' } }) });
  assert.equal(await run('Web_Get ( "https://evil.example.org/x" )', { network: web.fetch }), '?');
  assert.equal(web.seen.length, 0);
  assert.match(await run('Web_Get ( "https://api.example.com/r" )', { network: web.fetch }), /^error: redirected to evil\.example\.org, which the plug-in may not reach$/);
  assert.deepEqual(web.seen.map((s) => s.url), ['https://api.example.com/r']);
});

test('a redirect hop gives its response body back before the next request', async () => {
  // An unread body holds its pool slot, so a chain of redirects would otherwise run the account out of slots.
  let cancelled = 0;
  const hop = (to: string) => () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('moved')); }, cancel() { cancelled++; } }), { status: 302, headers: { location: to } });
  const web = fakeWeb({
    'https://api.example.com/a': hop('https://api.example.com/b'),
    'https://api.example.com/b': hop('https://api.example.com/c'),
    'https://api.example.com/c': () => new Response('done'),
  });
  assert.equal(await run('Web_Get ( "https://api.example.com/a" )', { network: web.fetch }), '200:done');
  assert.equal(cancelled, 2);
});

test('without the network option, or in outbound test mode, nothing is sent', async () => {
  const web = fakeWeb({ 'https://api.example.com/a': () => new Response('hello') });
  assert.equal(await run('Web_Get ( "https://api.example.com/a" )', {}), '?');
  const outbox: unknown[] = [];
  const answer = await run('Web_Get ( "https://api.example.com/a" )', { network: web.fetch, outbound: { allowHosts: [], record: (e: unknown) => { outbox.push(e); } } });
  assert.equal(answer, '0:');
  assert.equal(web.seen.length, 0);
  assert.equal(outbox.length, 1);
});

test('a capture-only file never reaches the network through a plug-in', async () => {
  const web = fakeWeb({ 'https://api.example.com/a': () => new Response('hello') });
  const r = await runScript(heldFile, script('Exit Script [ Text Result: Web_Get ( "https://api.example.com/a" ) ]'), { layout: 'Items', [TEST_ONLY_CUSTOM_FETCH]: true, network: web.fetch });
  assert.equal(r.result, '?');
  assert.equal(web.seen.length, 0);
});

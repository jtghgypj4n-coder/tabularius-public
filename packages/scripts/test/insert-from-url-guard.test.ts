// Insert from URL with the real network (network: true) goes through the outbound guard: a script cannot reach the
// machine's own network unless an administrator listed the host, and can never reach link-local or metadata addresses.
// The servers here are on loopback, which is the point.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

let dir: string;
let store: Store;
let server: Server;
let port: number;
let hits = 0;
const target = (path = '') => `http://127.0.0.1:${port}${path}`;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-insert-url-guard-'));
  createStore(join(dir, 'G.sqlite'));
  store = new Store(join(dir, 'G.sqlite'), 'G');
  store.applyDesign([{ op: 'createTable', name: 'Files', fields: [{ name: 'Note', type: 'text' }] }] as never);
  store.create('Files', { Note: '' });
  server = createServer((req, res) => {
    hits++;
    if (req.url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    res.end('inside');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  store?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const run = (text: string, opts: RunOptions = {}) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout: 'Files', foundSet: store.findIds('Files'), ...opts });

/** Why the step that failed failed, from the run's trace. */
const why = (r: { trace?: { message?: string }[] }) => r.trace?.map((l) => l.message).filter(Boolean).join('; ') ?? '';

const insert = (url: string) => `
  Set Error Capture [ On ]
  Insert from URL [ $r ; "${url}" ]
  Exit Script [ Text Result: Get ( LastError ) & "|" & $r ]
`;

test('with the network on and nothing listed, a script cannot reach loopback', async () => {
  hits = 0;
  const r = await run(insert(target('/')), { network: true });
  assert.equal(r.result, '1631|', 'a network error, and no response');
  assert.equal(hits, 0, 'nothing reached the server');
  // The message says why (the error text is in the script's debugger and the run's log).
  const asked = await run(`Insert from URL [ $r ; "${target('/')}" ]`, { network: true, trace: true });
  assert.equal(asked.error, 1631);
  assert.match(why(asked), /own network/);
});

test('an administrator\'s list lets a script reach the host or range it names, and nothing else on the own network', async () => {
  hits = 0;
  assert.equal((await run(insert(target('/')), { network: true, networkAllow: ['127.0.0.1'] })).result, '0|inside');
  assert.equal((await run(insert(target('/')), { network: true, networkAllow: ['127.0.0.0/8'] })).result, '0|inside');
  assert.equal((await run(insert(target('/')), { network: true, networkAllow: ['10.0.0.0/8', 'intranet.example'] })).result, '1631|');
  assert.equal(hits, 2);
});

test('link-local and metadata addresses are never reached, listed or not, directly or through a redirect', async () => {
  const all = { network: true, trace: true, networkAllow: ['169.254.169.254', '169.254.0.0/16', '127.0.0.1', '*.internal', 'metadata.google.internal'] } as const;
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://[fd00:ec2::254]/', 'http://metadata.google.internal/', 'http://2852039166/', 'http://[::ffff:a9fe:a9fe]/']) {
    assert.equal((await run(insert(url), all)).result, '1631|', url);
  }
  hits = 0;
  const redirected = await run(`Insert from URL [ $r ; "${target('/to-metadata')}" ]`, all);
  assert.equal(redirected.error, 1631);
  // (The run's log shows a generic message here: the real text mentions credentials, which a step's log never carries.)
  assert.equal(hits, 1, 'the first hop was made; the redirect to the metadata address was not followed');
});

test('a function given with the test-only capability is the caller\'s own and is used as it is', async () => {
  const seen: string[] = [];
  const own = (async (url: string | URL) => { seen.push(String(url)); return new Response('stand-in'); }) as typeof fetch;
  assert.equal((await run(insert('http://127.0.0.1:1/'), { network: own, [TEST_ONLY_CUSTOM_FETCH]: true })).result, '0|stand-in');
  assert.deepEqual(seen, ['http://127.0.0.1:1/']);
});

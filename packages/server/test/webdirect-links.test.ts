// A WebDirect-style link, /fmi/webd/<file>?script=<name>&param=<text>&$name=<value>: the server hands it to the web client,
// which runs the script after sign-in, but only for an account whose privilege set has fmurlscript.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, Store } from '../../store/src/index.ts';
import { parseLinkedScript } from '../../web/src/url-script.ts';

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-webdirect-links-'));
  createStore(join(dir, 'My File' + STORE_EXT));
  const s = new Store(join(dir, 'My File' + STORE_EXT), 'My File');
  s.applyDesign([
    { op: 'createTable', name: 'Home', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Text Result: Get ( ScriptParameter ) & "|" & $city & "|" & $n ]' },
  ]);
  s.create('Home', { Name: 'x' });
  const open = { view: true, edit: true, create: true, delete: true };
  s.savePrivilegeSet({ name: 'Linker', records: open, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: ['fmapp', 'fmrest', 'fmurlscript'] } as never);
  s.savePrivilegeSet({ name: 'Plain', records: open, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: ['fmapp', 'fmrest'] } as never);
  s.setPassword('Linker', 'pw', 'Linker');
  s.setPassword('Plain', 'pw', 'Plain');
  s.close();
  const r = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = r.server;
  base = r.url;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/My%20File/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}` };
}
const run = async (auth: Record<string, string>, body: unknown) => {
  const r = await fetch(`${base}/tabularius/app/v1/databases/My%20File/layouts/Home/button`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() as any };
};

test('the link opens the web client on that file and carries the script, parameter and variables', async () => {
  const r = await fetch(`${base}/fmi/webd/My%20File?script=Echo&param=a%20b&%24city=Oslo&%24%24global=no&ignored=1`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location')!, base);
  assert.equal(to.pathname, '/app/');
  assert.equal(to.searchParams.get('db'), 'My File');
  assert.equal(to.searchParams.get('script'), 'Echo');
  assert.equal(to.searchParams.get('param'), 'a b');
  assert.equal(to.searchParams.get('$city'), 'Oslo');
  assert.equal(to.searchParams.has('$$global'), false);
  assert.equal(to.searchParams.has('ignored'), false);
  // Just the file name opens the file, with no script.
  const plain = await fetch(`${base}/fmi/webd/My%20File`, { redirect: 'manual' });
  assert.equal(new URL(plain.headers.get('location')!, base).search, '?db=My+File');
  assert.equal((await fetch(`${base}/fmi/webd/%E0%A4%A`, { redirect: 'manual' })).status, 400);
});

test('the web client reads the link back, variables named with their $', () => {
  assert.deepEqual(parseLinkedScript('?db=F&script=Echo&param=hi&%24city=Oslo&x=1'), { script: 'Echo', parameter: 'hi', variables: { $city: 'Oslo' } });
  assert.equal(parseLinkedScript('?db=F'), undefined);
});

test('a script run from a link needs fmurlscript, and starts with its parameter and variables', async () => {
  const ok = await run(await login('Linker'), { urlScript: true, script: 'Echo', parameter: 'p', variables: { $city: 'Oslo', $n: '7', $$g: 'no', bad: 'x' }, mode: 'browse' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.result, 'p|Oslo|7');
  const denied = await run(await login('Plain'), { urlScript: true, script: 'Echo', mode: 'browse' });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));
  assert.match(JSON.stringify(denied.json), /fmurlscript/);
  const missing = await run(await login('Linker'), { urlScript: true, script: 'Nope', mode: 'browse' });
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
});

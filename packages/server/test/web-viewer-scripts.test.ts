// FileMaker.PerformScript in a web viewer's page (a modern layout): the window asks the server to run a script by
// name, which it does only for a web viewer set to "Allow JavaScript to perform FileMaker scripts", with the page's
// parameter as text, and as the signed-in account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, Store } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;

const viewer = (id: number, jsBridge: boolean) => ({
  id, kind: 'web-viewer', type: 13, external: 'WEBV', bounds: { top: 0, left: 0, bottom: 200, right: 400 },
  anchors: { left: true, top: true, right: true, bottom: true }, style: {},
  webUrl: '"data:text/html,<p>Hi</p>"',
  webOptions: { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge },
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-webviewer-scripts-'));
  createStore(join(dir, 'P' + STORE_EXT));
  const s = new Store(join(dir, 'P' + STORE_EXT), 'P');
  s.applyDesign([
    { op: 'createTable', name: 'Home', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Echo', text: 'Exit Script [ Text Result: "got " & Get ( ScriptParameter ) & " on " & Get ( LayoutName ) ]' },
    { op: 'createScript', name: 'Secret', text: 'Exit Script [ Text Result: "ran" ]' },
  ]);
  s.applyDesign([{ op: 'updateLayout', layout: 'Home', design: { objects: [viewer(1, true), viewer(2, false)] } }] as never);
  s.create('Home', { Name: 'x' });
  s.setPassword('Admin', 'pw', '[Full Access]');
  s.savePrivilegeSet({ name: 'No scripts', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
  s.setPassword('Clerk', 'pw', 'No scripts');
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
  const r = await fetch(`${base}/fmi/data/vLatest/databases/P/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}` };
}
async function post(body: unknown, auth: Record<string, string>): Promise<{ status: number; json: any }> {
  const r = await fetch(`${base}/tabularius/app/v1/databases/P/layouts/Home/button`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

test('a page in a web viewer that allows it runs a script by name, its parameter taken as text', async () => {
  const auth = await login('Admin');
  // A formula-looking parameter stays text: the page sent it, nobody wrote it as a calculation.
  const r = await post({ webViewer: 1, script: 'Echo', parameter: 'Get ( AccountName )', mode: 'browse' }, auth);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.error, 0, JSON.stringify(r.json));
  assert.equal(r.json.result, 'got Get ( AccountName ) on Home');
});

test('a web viewer without "Allow JavaScript to perform FileMaker scripts" runs nothing', async () => {
  const auth = await login('Admin');
  const off = await post({ webViewer: 2, script: 'Echo', parameter: 'x', mode: 'browse' }, auth);
  assert.equal(off.status, 403, JSON.stringify(off.json));
  const nowhere = await post({ webViewer: 99, script: 'Echo', parameter: 'x', mode: 'browse' }, auth);
  assert.equal(nowhere.status, 403, JSON.stringify(nowhere.json));
  const missing = await post({ webViewer: 1, script: 'Nope', mode: 'browse' }, auth);
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
});

test("the account's privileges decide whether a page's script runs", async () => {
  const auth = await login('Clerk');
  const r = await post({ webViewer: 1, script: 'Secret', mode: 'browse' }, auth);
  assert.notEqual(r.json.result, 'ran', JSON.stringify(r.json));
});

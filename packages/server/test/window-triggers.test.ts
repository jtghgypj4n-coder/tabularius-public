// File Options' OnWindowOpen and OnWindowClose: set in design mode, announced to the web client in the layouts answer,
// and run by name as the client opens a window or closes one (the close script's False result keeps the window open).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let token: string;
let store: ReturnType<Awaited<ReturnType<typeof serve>>['host']['get']> & {};

const call = async (path: string, init: RequestInit = {}) => (await fetch(`${base}/tabularius/app/v1/databases/Alpha/${path}`, {
  ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
})).json() as Promise<any>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-window-triggers-'));
  createStore(join(dir, 'Alpha' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Alpha')!;
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.applyDesign([
    { op: 'createTable', name: 'Things', fields: [{ name: 'Name' }] },
    { op: 'createLayout', name: 'Home', occurrence: 'Things' },
    { op: 'createScript', name: 'Opened', text: 'Set Variable [ $$opened ; Value: "yes" ]\nExit Script [ Text Result: "opened" ]' },
    { op: 'createScript', name: 'Closing', text: 'Exit Script [ Text Result: 0 ]' },
  ]);
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Alpha/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
  });
  token = ((await login.json()) as { response: { token: string } }).response.token;
  store.applyDesign([{ op: 'setFileOptions', onWindowOpen: 'Opened', onWindowClose: 'Closing' }]);
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test('the layouts answer says the file has window triggers, and the client runs them by name', async () => {
  const menu = await call('layouts');
  assert.equal(menu.onWindowOpen, true);
  assert.equal(menu.onWindowClose, true);
  const opened = await call('layouts/Home/button', { method: 'POST', body: JSON.stringify({ trigger: 'OnWindowOpen', mode: 'browse' }) });
  assert.equal(opened.error, 0, opened.message);
  assert.equal(opened.script, 'Opened');
  assert.equal(opened.result, 'opened');
  const closing = await call('layouts/Home/button', { method: 'POST', body: JSON.stringify({ trigger: 'OnWindowClose', mode: 'browse' }) });
  assert.equal(closing.script, 'Closing');
  assert.equal(closing.result, '0');
});

test('a file without the options answers neither flag, and the trigger is refused', async () => {
  store.applyDesign([{ op: 'setFileOptions', onWindowOpen: null, onWindowClose: null }]);
  const menu = await call('layouts');
  assert.equal(menu.onWindowOpen, undefined);
  assert.equal(menu.onWindowClose, undefined);
  const none = await call('layouts/Home/button', { method: 'POST', body: JSON.stringify({ trigger: 'OnWindowClose', mode: 'browse' }) });
  assert.equal(none.error.code, 3);
});

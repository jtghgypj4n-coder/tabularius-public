// The server's version is shown to signed-in users (Help > About) and not on the public health route.
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

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-about-'));
  createStore(join(dir, 'Alpha' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  s.host.get('Alpha')!.setPassword('Admin', 'pw', '[Full Access]');
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test('the version is in the signed-in menu answer and not on the public health route', async () => {
  const health = await (await fetch(`${base}/tabularius/health`)).text();
  assert.doesNotMatch(health, /version/);
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Alpha/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
  });
  const { token } = (await login.json() as { response: { token: string } }).response;
  const menu = await fetch(`${base}/tabularius/app/v1/databases/Alpha/layouts`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(menu.status, 200);
  assert.match(((await menu.json()) as { version: string }).version, /^\d+\.\d+\.\d+/);
  const anonymous = await fetch(`${base}/tabularius/app/v1/databases/Alpha/layouts`);
  assert.equal(anonymous.status >= 400, true);
  assert.doesNotMatch(await anonymous.text(), /\d+\.\d+\.\d+/);
});

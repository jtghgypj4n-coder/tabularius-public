import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp } from '../../store/src/index.ts';

// validateSession's isSessionInUse is true while a call made with that token is still running, and false otherwise.
let dir: string;
let server: Server;
let base: string;
let token: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-in-use-'));
  createStore(join(dir, 'Busy' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  const store = s.host.get('Busy')!;
  store.setPassword('Admin', 'pw');
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createScript', name: 'Slow', text: 'Pause/Resume Script [ Duration (seconds): 1 ]\nExit Script [ "done" ]' },
  ] as DesignOp[]);
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Busy/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' });
  token = ((await login.json()) as { response: { token: string } }).response.token;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const inUse = async () => ((await (await fetch(`${base}/fmi/data/vLatest/validateSession`, { headers: { authorization: `Bearer ${token}` } })).json()) as { response: { isSessionInUse: boolean } }).response.isSessionInUse;

test('isSessionInUse is true while a call on the session is running', async () => {
  assert.equal(await inUse(), false);
  const slow = fetch(`${base}/fmi/data/vLatest/databases/Busy/layouts/T/script/Slow`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) {
    seen = await inUse();
    if (!seen) await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(seen, true, 'the running script shows the session in use');
  const done = (await slow) as { response: { scriptResult: string } };
  assert.equal(done.response.scriptResult, 'done');
  assert.equal(await inUse(), false, 'and not once it has answered');
});

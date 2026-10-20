// Install OnTimer Script with a script from another hosted file: the window's timer runs it as Perform Script does,
// with the parameter worked out in the window that installed it, and the account's privileges in that file.
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

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ontimer-file-'));
  const open = (name: string) => {
    createStore(join(dir, name + STORE_EXT));
    return new Store(join(dir, name + STORE_EXT), name);
  };
  const b = open('B');
  b.applyDesign([
    { op: 'createScript', name: 'Tick', text: 'Set Variable [ $$ticks ; Value: $$ticks + 1 ]\nExit Script [ Text Result: Get ( ScriptParameter ) & "/" & $$ticks & "@" & Get ( FileName ) ]' },
    { op: 'createScript', name: 'Secret', text: 'Exit Script [ Text Result: "ran" ]' },
  ]);
  b.setPassword('Admin', 'pw', '[Full Access]');
  b.savePrivilegeSet({ name: 'No scripts', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] } as never);
  b.setPassword('Clerk', 'pw', 'No scripts');
  const tick = b.schema.scripts.find((s) => s.name === 'Tick')!.id;
  const secret = b.schema.scripts.find((s) => s.name === 'Secret')!.id;
  b.close();
  const a = open('A');
  a.applyDesign([
    { op: 'createTable', name: 'Home', fields: [{ name: 'Name' }] },
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
  ]);
  const source = a.schema.dataSources.find((d) => d.name === 'B')!;
  const install = (script: { id: number; name: string }) => ({
    stepId: 148, name: 'Install OnTimer Script', enabled: true,
    params: { script: { ...script, file: { id: source.id, name: 'B' } }, parameter: 'Get ( LayoutName ) & "!"', calculation: '0.5' },
  });
  a.applyDesign([
    { op: 'createScript', name: 'Start', steps: [install({ id: tick, name: 'Tick' })] },
    { op: 'createScript', name: 'Start Secret', steps: [install({ id: secret, name: 'Secret' })] },
  ] as never);
  a.create('Home', { Name: 'x' });
  a.setPassword('Admin', 'pw', '[Full Access]');
  a.setPassword('Clerk', 'pw', '[Full Access]');
  const id = (name: string) => a.schema.scripts.find((s) => s.name === name)!.id;
  a.applyDesign([{ op: 'updateLayout', layout: 'Home', design: { triggers: [
    { event: 'OnModeEnter', scriptId: id('Start') },
    { event: 'OnModeExit', scriptId: id('Start Secret') },
  ] } }] as never);
  a.close();
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/A/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  return { authorization: `Bearer ${(await r.json()).response.token}` };
}
async function post(body: unknown, auth: Record<string, string>): Promise<any> {
  const r = await fetch(`${base}/tabularius/app/v1/databases/A/layouts/Home/button`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

test('a timer on another file\'s script runs it there, with the parameter worked out in this window', async () => {
  const auth = await login('Admin');
  const started = await post({ trigger: 'OnModeEnter', mode: 'browse' }, auth);
  const install = started.actions.find((a: any) => a.step === 'Install OnTimer Script');
  assert.equal(install.interval, 0.5, JSON.stringify(started));
  assert.equal(install.timerScript, 'Tick');
  assert.match(install.timer, /^[0-9a-f]{16}$/);
  assert.equal(install.timerFile, undefined);
  const first = await post({ timer: install.timer, mode: 'browse' }, auth);
  assert.equal(first.error, 0, JSON.stringify(first));
  assert.match(String(first.result), /^Home!\/1@B/);
});

test('the account\'s privileges in the other file decide whether the timer\'s script runs', async () => {
  const auth = await login('Clerk');
  const started = await post({ trigger: 'OnModeExit', mode: 'browse' }, auth);
  const install = started.actions.find((a: any) => a.step === 'Install OnTimer Script');
  const r = await post({ timer: install.timer, mode: 'browse' }, auth);
  assert.equal(r.error, 9, JSON.stringify(r));
  assert.notEqual(r.result, 'ran');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { ScriptSession } from '../../scripts/src/index.ts';
import { DebugApi } from '../src/debug.ts';
import type { Host } from '../src/host.ts';
import type { DataApi, Session } from '../src/dataapi.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

test('debug Current reads the paused execution store and returns the ended-run fallback signal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-debug-current-'));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path);
  const session: Session = { token: 'test-session', db: 'Shop', account: 'Admin', client: 'rest', started: Date.now(), lastUsed: performance.now(), scripts: new ScriptSession() };
  const host = { get: (name: string) => name === 'Shop' ? store : undefined, scriptOptions: () => ({}) } as unknown as Host;
  const dataApi = { authorize: () => session, alive: () => true, endListeners: new Set() } as unknown as DataApi;
  const debug = new DebugApi(host, dataApi);
  let storeOpen = true;
  const call = async (method: string, pathAndQuery: string, body?: unknown) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = Object.assign(Readable.from(bytes ? [bytes] : []), { method, url: pathAndQuery, headers: {} }) as IncomingMessage;
    let status = 0, text = '';
    const res = { writeHead: (code: number) => { status = code; }, end: (value: string) => { text = value; } } as unknown as ServerResponse;
    await debug.handle(req, res, new URL(`http://test${pathAndQuery}`));
    return { status, body: JSON.parse(text) as Record<string, any> };
  };
  try {
    store.setPassword('Admin', 'admin-password-1', '[Full Access]');
    const full = store.privilegeSet('[Full Access]')!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] },
      { op: 'createScript', name: 'Pause here', text: 'Exit Script [ "done" ]' },
    ]);
    const created = store.create('Items', { Name: 'before scratch' });
    const scratch = await call('POST', '/tabularius/debug/v1/databases/Shop/runs', { script: 'Pause here', layout: 'Items', recordId: created.recordId });
    assert.equal(scratch.status, 201, JSON.stringify(scratch.body));
    store.update('Items', created.recordId, { Name: 'hosted changed' });
    const scratchCurrent = await call('GET', `/tabularius/debug/v1/databases/Shop/runs/${scratch.body.id}/current?layout=Items&recordId=${created.recordId}`);
    assert.equal(scratchCurrent.body.fields.Name, 'before scratch', 'paused scratch execution is isolated from later hosted edits');

    const live = await call('POST', '/tabularius/debug/v1/databases/Shop/runs', { script: 'Pause here', layout: 'Items', recordId: created.recordId, scratch: false });
    assert.equal(live.status, 201);
    const liveCurrent = await call('GET', `/tabularius/debug/v1/databases/Shop/runs/${live.body.id}/current?layout=Items&recordId=${created.recordId}`);
    assert.equal(liveCurrent.body.fields.Name, 'hosted changed', 'scratch:false reads the hosted store');
    await call('POST', `/tabularius/debug/v1/databases/Shop/runs/${scratch.body.id}/continue`, {});
    const ended = await call('GET', `/tabularius/debug/v1/databases/Shop/runs/${scratch.body.id}/current?layout=Items&recordId=${created.recordId}`);
    assert.equal(ended.status, 409, 'the client gets the expected no-longer-paused signal and falls back to window Current');
    assert.equal(ended.body.error.code, 3);
  } finally {
    debug.stop();
    if (storeOpen) store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

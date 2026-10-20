// The starter solutions as a server hosts them: every layout answers through the Data API as the Staff account, Staff can
// edit but not delete, and the Read only account can look but a script it runs changes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { STARTER_NAMES, applyStarter, createStore } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Awaited<ReturnType<typeof serve>>['host'];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-starters-hosted-'));
  for (const name of STARTER_NAMES) createStore(join(dir, name + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  for (const name of STARTER_NAMES) {
    const store = host.get(name)!;
    applyStarter(store, name);
    store.setPassword('Admin', 'pw', '[Full Access]');
    store.setPassword('sam', 'pw', 'Staff');
    store.setPassword('rae', 'pw', 'Read only');
  }
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const tokens = new Map<string, string>();
async function token(db: string, user: string): Promise<string> {
  const key = `${db}/${user}`;
  if (!tokens.has(key)) {
    const r = await fetch(`${base}/fmi/data/vLatest/databases/${encodeURIComponent(db)}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${user}:pw`), 'content-type': 'application/json' }, body: '{}' });
    const body = await r.json() as { response: { token: string } };
    tokens.set(key, body.response.token);
  }
  return tokens.get(key)!;
}

async function call(db: string, user: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/${encodeURIComponent(db)}${path}`, {
    method, headers: { authorization: 'Bearer ' + await token(db, user), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test('every layout of every starter answers through the Data API as Staff and as Read only', async () => {
  for (const name of STARTER_NAMES) {
    const layouts = host.get(name)!.schema.layouts.map((l) => l.name);
    assert.ok(layouts.length >= 5, name);
    for (const user of ['sam', 'rae']) {
      for (const layout of layouts) {
        const l = encodeURIComponent(layout);
        const meta = await call(name, user, `/layouts/${l}`);
        assert.equal(meta.status, 200, `${name}/${layout} as ${user}: ${JSON.stringify(meta.body.messages)}`);
        assert.ok(meta.body.response.fieldMetaData.length > 0, `${name}/${layout} has fields`);
        const records = await call(name, user, `/layouts/${l}/records?_limit=3`);
        assert.equal(records.status, 200, `${name}/${layout} as ${user}: ${JSON.stringify(records.body.messages)}`);
        assert.ok(records.body.response.data.length > 0, `${name}/${layout} shows sample records`);
      }
    }
  }
});

test('Staff can add and change records but not delete; Read only can do none of them', async () => {
  const first: Record<string, { table: string; data: Record<string, string> }> = {
    crm: { table: 'Companies', data: { Name: 'New company' } },
    inventory: { table: 'Products', data: { SKU: 'X-1', Name: 'New product' } },
    invoicing: { table: 'Customers', data: { Name: 'New customer' } },
    tasks: { table: 'Projects', data: { Name: 'New project' } },
    booking: { table: 'Resources', data: { Name: 'New room' } },
  };
  for (const name of STARTER_NAMES) {
    const { table, data } = first[name];
    const made = await call(name, 'sam', `/layouts/${encodeURIComponent(table)}/records`, 'POST', { fieldData: data });
    assert.equal(made.status, 200, `${name}: ${JSON.stringify(made.body.messages)}`);
    const id = made.body.response.recordId;
    const edit = await call(name, 'sam', `/layouts/${encodeURIComponent(table)}/records/${id}`, 'PATCH', { fieldData: { Notes: 'changed' } });
    assert.equal(edit.status, 200, `${name}: ${JSON.stringify(edit.body.messages)}`);
    const del = await call(name, 'sam', `/layouts/${encodeURIComponent(table)}/records/${id}`, 'DELETE');
    assert.notEqual(del.status, 200, `${name}: Staff must not delete`);
    assert.equal((await call(name, 'rae', `/layouts/${encodeURIComponent(table)}/records`, 'POST', { fieldData: data })).status !== 200, true, `${name}: Read only must not add`);
    assert.notEqual((await call(name, 'rae', `/layouts/${encodeURIComponent(table)}/records/${id}`, 'PATCH', { fieldData: { Notes: 'x' } })).status, 200, `${name}: Read only must not edit`);
  }
});

test('a script run by Read only changes nothing', async () => {
  const before = host.get('tasks')!.get('Tasks', 2).fieldData.Status;
  const r = await call('tasks', 'rae', '/layouts/Tasks/records/2?script=' + encodeURIComponent('Mark done'));
  assert.equal(host.get('tasks')!.get('Tasks', 2).fieldData.Status, before, JSON.stringify(r.body));
  const staff = await call('tasks', 'sam', '/layouts/Tasks/records/2?script=' + encodeURIComponent('Mark done'));
  assert.equal(staff.status, 200, JSON.stringify(staff.body.messages));
  assert.equal(host.get('tasks')!.get('Tasks', 2).fieldData.Status, 'Done');
});

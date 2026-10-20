import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

test('a SQLite write lock returns Data API 301 with 503 and Retry-After', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-api-lock-'));
  const path = join(dir, 'Busy' + STORE_EXT);
  createStore(path);
  const serving = await serve({ dir, port: 0, watch: false, log: () => {} });
  let locker: DatabaseSync | undefined;
  try {
    const store = serving.host.get('Busy')!;
    store.setPassword('Admin', 'pw');
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Value' }] }]);
    const login = await fetch(`${serving.url}/fmi/data/vLatest/databases/Busy/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(login.status, 200);
    const token = ((await login.json()) as { response: { token: string } }).response.token;
    store.sql.exec('PRAGMA busy_timeout = 20');
    locker = new DatabaseSync(path);
    locker.exec('BEGIN IMMEDIATE');
    const response = await fetch(`${serving.url}/fmi/data/vLatest/databases/Busy/layouts/T/records`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fieldData: { Value: 'blocked' } }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal(((await response.json()) as { messages: { code: string }[] }).messages[0].code, '301');
    locker.exec('ROLLBACK');
    const retry = await fetch(`${serving.url}/fmi/data/vLatest/databases/Busy/layouts/T/records`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fieldData: { Value: 'saved' } }),
    });
    assert.equal(retry.status, 200);
  } finally {
    if (locker?.isTransaction) locker.exec('ROLLBACK');
    locker?.close();
    await new Promise<void>((resolve) => serving.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

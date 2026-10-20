// The admin console checks a file for stale stored calculations, refreshes the chosen ones and undoes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { serve } from '../src/index.ts';

test('/tabularius/admin/v1/stale-calcs finds, refreshes and undoes, as the admin console', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-stale-admin-'));
  const path = join(dir, `Shop${STORE_EXT}`);
  createStore(path);
  const made = new Store(path, 'Shop');
  made.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'OrderId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'Orders', name: 'Total', kind: 'calculation', type: 'number', calculation: 'ExecuteSQL ( "SELECT SUM(Amount) FROM Lines WHERE OrderId = ?" ; "" ; "" ; Id )' },
  ]);
  made.create('Orders', { Id: '1' });
  made.create('Lines', { OrderId: '1', Amount: '7' });
  made.close();
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const get = () => fetch(`${s.url}/tabularius/admin/v1/stale-calcs?database=shop`, { headers: { connection: 'close' } }).then((r) => r.json());
    const post = (sub: string, body: unknown) => fetch(`${s.url}/tabularius/admin/v1/stale-calcs/${sub}`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) });

    const found = await get();
    assert.equal(found.stale, 1);
    assert.deepEqual(found.fields[0].examples, [{ recordId: 1, stored: null, now: '7' }]);
    assert.deepEqual(found.history, []);

    const r = await post('refresh', { database: 'Shop', fields: [{ table: 'Orders', field: 'Total' }] });
    assert.equal(r.status, 200);
    const batch = await r.json();
    assert.equal(batch.changes, 1);
    assert.equal(batch.history[0].account, 'admin console');
    assert.equal((await get()).stale, 0);
    const store = s.host.get('Shop')!;
    assert.equal(store.auditLog({ table: 'Orders' }).at(-1)!.account, 'admin console');

    const u = await post('undo', { database: 'Shop', id: batch.id });
    assert.deepEqual((await u.json()).undone, 1);
    assert.equal((await get()).stale, 1);

    assert.equal((await post('refresh', { database: 'Shop', fields: [] })).status, 400);
    assert.equal((await post('undo', { database: 'Shop', id: batch.id })).status, 400);
    assert.equal((await post('refresh', { database: 'Nope', fields: [] })).status, 404);
  } finally {
    s.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => s.server.close((error) => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

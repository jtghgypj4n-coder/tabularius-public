import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { describeRecord } from '../src/record-context.ts';

test('native Data API and OData expose id while compat JSON keeps its original shape', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-uuid-http-'));
  for (const mode of ['native', 'compat'] as const) {
    const path = join(dir, `${mode}.openhbam.sqlite`);
    createStore(path, { mode });
    const store = new Store(path, mode);
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }, ...(mode === 'native' ? [{ name: 'id' }] : [])] }]);
      const full = store.privilegeSets().find((p) => p.id === 1)!;
      store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest', 'fmodata'] });
      store.setPassword('Admin', 'pw', full.name);
    } finally { store.close(); }
  }
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    for (const mode of ['native', 'compat'] as const) {
      const api = `${hosted.url}/fmi/data/vLatest/databases/${mode}`;
      const login = await fetch(`${api}/sessions`, { method: 'POST', headers: { authorization: `Basic ${btoa('Admin:pw')}` } });
      assert.equal(login.status, 200);
      const token = (await login.json() as { response: { token: string } }).response.token;
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const made = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: JSON.stringify({ fieldData: { Title: 'A', ...(mode === 'native' ? { id: 'user-value' } : {}) } }) });
      assert.equal(made.status, 200, await made.clone().text());
      const created = (await made.json() as { response: Record<string, unknown> }).response;
      const list = (await (await fetch(`${api}/layouts/Items/records`, { headers })).json() as { response: { data: Record<string, unknown>[] } }).response.data[0];
      if (mode === 'native') {
        assert.match(String(created.id), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.equal(list.id, created.id);
        assert.deepEqual(list.fieldData, { Title: 'A', id: 'user-value' });
        assert.equal(describeRecord(hosted.host.get(mode)!, 'Items', 1).id, created.id);
      } else {
        assert.deepEqual(created, { recordId: '1', modId: '0' });
        assert.deepEqual(list, { fieldData: { Title: 'A' }, portalData: {}, recordId: '1', modId: '0' });
      }
      const odata = `${hosted.url}/fmi/odata/v4/${mode}`;
      const row = await fetch(`${odata}/Items(1)`, { headers: { authorization: `Basic ${btoa('Admin:pw')}` } });
      assert.equal(row.status, 200, await row.clone().text());
      const entity = await row.json() as Record<string, unknown>;
      assert.equal(entity.ROWID, 1);
      if (mode === 'native') {
        // The UUID is ROWUUID, beside ROWID and ROWMODID; a field a person called id keeps its name and its value.
        assert.equal(entity.ROWUUID, (created as Record<string, unknown>).id);
        assert.equal(entity.id, 'user-value');
        assert.equal(Object.hasOwn(entity, 'id_2'), false);
        const selected = await fetch(`${odata}/Items(1)?$select=id`, { headers: { authorization: `Basic ${btoa('Admin:pw')}` } });
        assert.equal(selected.status, 200);
        const picked = await selected.json() as Record<string, unknown>;
        assert.equal(picked.id, 'user-value');
        assert.equal(picked.ROWUUID, (created as Record<string, unknown>).id);
        const metadata = await (await fetch(`${odata}/$metadata`, { headers: { authorization: `Basic ${btoa('Admin:pw')}` } })).text();
        assert.match(metadata, /Property Name="ROWUUID" Type="Edm.Guid" Nullable="false"/);
        assert.match(metadata, /Property Name="id" /);
      }
      else assert.equal(Object.hasOwn(entity, 'ROWUUID'), false);
      if (mode === 'native') {
        const exported = await fetch(`${hosted.url}/tabularius/app/v1/databases/${mode}/layouts/Items/export`, {
          method: 'POST', headers, body: JSON.stringify({ fields: ['Title'], format: 'csv', ids: [1], fieldNames: true }),
        });
        assert.equal(exported.status, 200, await exported.clone().text());
        assert.equal(await exported.text(), '"Title"\r\n"A"\r\n');
      }
    }
  } finally {
    await new Promise<void>((resolve) => hosted.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

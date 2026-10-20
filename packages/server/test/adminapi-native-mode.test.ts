import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import { askServer } from '../../cli/src/ask-server.ts';
import { modernizeChange } from '../src/modernize.ts';

test('Admin API reports native mode while open and closed; Data API serves ISO dates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-admin-native-'));
  try {
    const path = join(dir, 'Native.openhbam.sqlite');
    createStore(path, { mode: 'native' });
    const store = new Store(path, 'Native');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }, { name: 'When', type: 'timestamp' }] }]);
      store.setPassword('Admin', 'pw');
      store.create('Events', { Day: '2026-10-16', When: '2026-10-16T12:30:00' });
    } finally { store.close(); }
    createStore(join(dir, 'Old.openhbam.sqlite'));
    setAdminPassword(dir, 'secret');
    const hosted = await serve({ dir, port: 0, log: () => {} });
    try {
      const request = async (route: string, init: RequestInit = {}) => {
        const response = await fetch(hosted.url + route, init);
        return { status: response.status, body: await response.json() as Record<string, any> };
      };
      const login = await request('/fmi/admin/api/v2/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
      assert.equal(login.status, 200);
      const auth = { authorization: `Bearer ${login.body.response.token}` };
      const all = async () => (await request('/fmi/admin/api/v2/databases', { headers: auth })).body.response.databases as Record<string, unknown>[];
      const list = async () => (await all()).find((d) => d.filename === 'Native.fmp12')!;
      const opened = await list();
      assert.equal(opened.fileMode, 'native');
      const compat = (await all()).find((d) => d.filename === 'Old.fmp12')!;
      assert.equal('fileMode' in compat, false, 'a compat file keeps the FileMaker Server shape');
      const patched = await request(`/fmi/admin/api/v2/databases/${compat.id}`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'NORMAL' }) });
      assert.equal('fileMode' in patched.body.response, false, JSON.stringify(patched.body));
      const session = await request('/fmi/data/vLatest/databases/Native/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
      assert.equal(session.status, 200, JSON.stringify(session.body));
      const data = await request('/fmi/data/vLatest/databases/Native/layouts/Events/records', { headers: { authorization: `Bearer ${session.body.response.token}` } });
      assert.equal(data.body.response.data[0].fieldData.Day, '2026-10-16');
      assert.equal(data.body.response.data[0].fieldData.When, '2026-10-16T12:30:00');
      const records = (body: unknown) => request('/fmi/data/vLatest/databases/Native/layouts/Events/records', { method: 'POST', headers: { authorization: `Bearer ${session.body.response.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const refused = await records({ fieldData: { Day: '10/16/2026' } });
      assert.equal(refused.status, 400, JSON.stringify(refused.body)); // validation refusals (code 500) are HTTP 400 on main
      assert.equal(refused.body.messages[0].code, '500');
      assert.match(refused.body.messages[0].message, /Field "Day" must be an ISO 8601 date/);
      assert.equal((await records({ fieldData: { When: '2026-10-17 09:00:00' } })).status, 200, 'a space between date and time reads too');
      // A .fmp12 of the same name doesn't make a native file one to convert again.
      writeFileSync(join(dir, 'Native.fmp12'), 'not a FileMaker file');
      for (const route of ['reconvert-preview', 'reconvert']) {
        // As tabularius reconvert asks the running server.
        const r = await askServer(dir, 'POST', `/tabularius/admin/v1/files/Native/${route}`, { force: true });
        const body = r.body as { error?: string };
        assert.notEqual(r.status, 200, route);
        assert.match(String(body.error), /native file .* can't be converted again/, route);
      }
      assert.equal((await list()).status, 'NORMAL', 'still open');
      await request(`/fmi/admin/api/v2/databases/${opened.id}`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'CLOSED' }) });
      assert.equal((await list()).fileMode, 'native');
    } finally { await new Promise<void>((resolve) => hosted.server.close(() => resolve())); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('modern layouts made for a native file send ISO dates; a compat file\'s pages are made as before', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-modern-native-'));
  try {
    const pages: Record<string, string> = {};
    for (const mode of ['native', 'compat'] as const) {
      const path = join(dir, `${mode}.openhbam.sqlite`);
      createStore(path, mode === 'native' ? { mode } : undefined);
      const store = new Store(path, mode);
      try {
        store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title' }, { name: 'Day', type: 'date' }] }]);
        pages[mode] = JSON.stringify(modernizeChange(store).changes);
      } finally { store.close(); }
    }
    // The plan is in the page's script, quoted once per level it is embedded at.
    assert.match(pages.native, /\\+"native\\+":true\}/);
    assert.doesNotMatch(pages.compat, /\\+"native\\+":/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

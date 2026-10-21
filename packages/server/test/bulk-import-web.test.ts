import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

test('large web Add previews a bounded sample and streams every generated row with session progress', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-bulk-web-import-'));
  createStore(join(dir, 'Scale' + STORE_EXT));
  let server: Server | undefined;
  try {
    const hosted = await serve({ dir, port: 0, watch: false, log: () => {} });
    server = hosted.server;
    const store = hosted.host.get('Scale')!;
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    store.setPassword('Admin', 'pw', '[Full Access]');
    store.setPassword('Other', 'pw', '[Full Access]');
    const login = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Scale/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
    });
    const token = (await login.json()).response.token as string;
    const otherLogin = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Scale/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('Other:pw'), 'content-type': 'application/json' }, body: '{}',
    });
    const otherToken = (await otherLogin.json()).response.token as string;
    const csv = 'Name\r\n' + Array.from({ length: 20_001 }, (_, i) => `Synthetic ${i}`).join('\r\n') + '\r\n';
    const form = () => { const f = new FormData(); f.append('upload', new Blob([csv], { type: 'text/csv' }), 'rows.csv'); return f; };
    const endpoint = `${hosted.url}/tabularius/app/v1/databases/Scale/layouts/Items/import`;
    const headers = { authorization: `Bearer ${token}` };
    const previewResponse = await fetch(`${endpoint}?plan=1`, { method: 'POST', headers, body: form() });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.rows, 20_001);
    assert.equal(preview.sampledRows, 2000);
    assert.equal(preview.columns[0].field, 'Name');
    const plan = { headerRow: preview.headerRow, columns: preview.columns.map((c: { column: number; field: string | null; transforms: string[] }) => ({ column: c.column, field: c.field, transforms: c.transforms })), keys: [] };
    const imported = fetch(`${endpoint}?columns=${encodeURIComponent(JSON.stringify(plan))}`, { method: 'POST', headers, body: form() });
    let sawProgress = false;
    for (let i = 0; i < 50 && !sawProgress; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const r = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/runs/progress`, { headers });
      assert.equal(r.status, 200);
      sawProgress = (await r.json()).runs.some((x: { operation: string }) => x.operation === 'Import Records');
    }
    assert.equal(sawProgress, true);
    const otherProgress = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/runs/progress`, { headers: { authorization: `Bearer ${otherToken}` } });
    assert.equal(otherProgress.status, 200);
    assert.deepEqual((await otherProgress.json()).runs, []);
    const anonymous = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/runs/progress`);
    assert.equal(anonymous.status, 401);
    const response = await imported;
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.imported, 20_001);
    assert.equal(result.stopped, undefined);
    assert.equal((store.sql.prepare('SELECT count(*) AS n FROM Items').get() as { n: number }).n, 20_001);
    const done = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/runs/progress`, { headers });
    assert.deepEqual((await done.json()).runs, []);
  } finally {
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// #1377: generated workbench files, loopback HTTP only, no CLI or subprocesses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Workbench } from './patterns/framework.ts';

test('workbench closes three generations of servers, including a failed sign-in', { timeout: 30_000 }, async () => {
  const workbench = new Workbench();
  const store = workbench.file('Generated');
  store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Value' }] }]);
  store.create('Rows', { Value: 'synthetic' });
  const urls: string[] = [];
  const stores = [];
  try {
    for (const password of ['pw', 'wrong', 'pw']) {
      const api = await workbench.api('Generated', 'Admin', password);
      urls.push(workbench.url);
      stores.push(workbench.hosted('Generated'));
      const result = await api.get('/layouts/Rows/records');
      assert.equal(result.status, password === 'wrong' ? 401 : 200);
    }
    assert.equal(new Set(urls).size, 3, 'three distinct listeners were exercised');
    await workbench.close();
    assert.equal(existsSync(workbench.dir), false);
    // Node HTTP server.close: "Stops the server from accepting new connections".
    // https://nodejs.org/api/http.html#serverclosecallback
    for (const url of urls) await assert.rejects(fetch(`${url}/tabularius/health`, { signal: AbortSignal.timeout(3000) }));
    for (const hosted of stores) assert.throws(() => hosted.sql.prepare('SELECT 1'));
    await workbench.close(); // cleanup remains safe when called again
  } finally {
    await workbench.close();
  }
});

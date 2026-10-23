// Fresh-process measurement only; called with a generated folder by bench-wide.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

// Measure release-style startup without the checkout's optional git subprocess.
// Prime the version cache with only that .git existence check masked, then restore fs.
const exists = fs.existsSync;
const checkout = fileURLToPath(new URL('../.git', import.meta.url));
try {
  fs.existsSync = ((path) => String(path) !== checkout && exists(path)) as typeof exists;
  syncBuiltinESMExports();
  (await import('../packages/server/src/version.ts')).serverCommit();
} finally { fs.existsSync = exists; syncBuiltinESMExports(); }

const { Store } = await import('../packages/store/src/index.ts');
const { Host } = await import('../packages/server/src/host.ts');
const { serve } = await import('../packages/server/src/index.ts');
const timings: Record<string, number> = { schemaLoadMs: 0, designLoadMs: 0, hostedOpenMs: 0 };
const reads = { schema: 0, designs: 0 };
const meta = Store.prototype['meta'];
Store.prototype['meta'] = function (key: string) {
  const start = performance.now();
  try { return meta.call(this, key); } finally {
    if (key === 'schema' || key === 'designs') {
      if (key === 'schema') timings.schemaLoadMs += performance.now() - start;
      reads[key]++;
    }
  }
};
const design = Store.prototype.design, themes = Store.prototype.themes;
Store.prototype.design = function (layout) {
  const start = performance.now();
  try { return design.call(this, layout); } finally { timings.designLoadMs += performance.now() - start; }
};
Store.prototype.themes = function () {
  const start = performance.now();
  try { return themes.call(this); } finally { timings.designLoadMs += performance.now() - start; }
};
const add = Host.prototype.add;
Host.prototype.add = function (path: string) {
  const start = performance.now();
  try { return add.call(this, path); } finally { timings.hostedOpenMs += performance.now() - start; }
};
const server = await serve({ dir: process.argv[2], hostname: '127.0.0.1', port: 0, watch: false, checkFiles: false, log: () => {} });
timings.processToListeningMs = performance.now();
const memoryAfterStart = process.memoryUsage();
try {
  const api = `${server.url}/fmi/data/vLatest/databases/Wide`;
  const login = await fetch(`${api}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`Admin:${['wide', 'benchmark'].join('-')}`) } });
  assert.equal(login.status, 200);
  const token = (await login.json() as { response: { token: string } }).response.token;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'accept-encoding': 'identity' };
  async function request(name: string, url: string, body?: unknown) {
    const start = performance.now();
    const response = await fetch(url, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
    const json = JSON.parse(text);
    if (url.startsWith(api)) {
      assert.equal(json.messages[0].code, '0', name);
      assert.ok(json.response);
    } else {
      assert.equal(json.database, 'Wide', name);
      if (name === 'bootstrapMs') {
        assert.ok(Array.isArray(json.layouts) && json.layouts.length > 0);
        assert.ok(Array.isArray(json.scripts) && json.scripts.length > 0);
      } else {
        assert.equal(json.layout.name, 'Table1 Page1');
        assert.ok(Array.isArray(json.design.objects) && json.design.objects.length > 0);
      }
    }
    timings[name] = performance.now() - start;
    return { response: json.response ?? json, bytes: Buffer.byteLength(text) };
  }
  const layouts = await request('layoutListMs', `${api}/layouts`);
  assert.ok(layouts.response.layouts.length > 0);
  const page = await request('firstPageMs', `${api}/layouts/Table1%20Page1/records?_limit=50`);
  assert.ok(page.response.data.length > 0);
  const store = server.host.get('Wide')!;
  const indexedPlan = store.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM Table1 WHERE Id = 1').all() as { detail: string }[];
  const scanPlan = store.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM Table1 WHERE Scan = 1').all() as { detail: string }[];
  assert.ok(indexedPlan.some((r) => /SEARCH.*wide_id_1/.test(r.detail)));
  assert.ok(scanPlan.some((r) => /SCAN Table1/.test(r.detail)));
  const indexed = await request('indexedFindMs', `${api}/layouts/Table1%20Page1/_find`, { query: [{ Id: '1' }], limit: 50 });
  assert.equal(indexed.response.dataInfo.foundCount, 1);
  const unindexed = await request('unindexedFindMs', `${api}/layouts/Table1%20Page1/_find`, { query: [{ Scan: '1' }], limit: 50 });
  assert.equal(unindexed.response.dataInfo.foundCount, Math.floor((page.response.dataInfo.totalRecordCount + 99) / 100));
  assert.match(JSON.stringify(store.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM Table1 WHERE Scan = 1').all()), /SCAN Table1/);
  const bootstrap = await request('bootstrapMs', `${server.url}/tabularius/app/v1/databases/Wide/layouts`);
  const design = await request('firstLayoutMs', `${server.url}/tabularius/app/v1/databases/Wide/layouts/Table1%20Page1`);
  timings.firstUseTotalMs = performance.now();
  console.log(JSON.stringify({ timings, metadataReads: reads, memoryAfterStart, bootstrapBytes: bootstrap.bytes, firstLayoutBytes: design.bytes,
    firstPageRecords: page.response.data.length, layoutCount: layouts.response.layouts.length }));
} finally {
  await new Promise<void>((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()));
  Store.prototype['meta'] = meta;
  Store.prototype.design = design;
  Store.prototype.themes = themes;
  Host.prototype.add = add;
}

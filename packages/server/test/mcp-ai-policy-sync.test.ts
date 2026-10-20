import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';

test('sync status without a database cannot expose protected record identifiers; legacy status is unchanged', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-sync-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }] }]);
  const sync = { list: () => [{ database: 'Shop', setup: { server: 'http://localhost', database: 'Remote', tables: [{ localTable: 'Items' }] },
    last: { at: 'now', tables: [], conflicts: [{ table: 'Items', uuid: 'protected-record-id', kind: 'both', clashes: [] }], moreConflicts: 0 } }], logOf: () => [] };
  const schedules = { all: () => [], syncAlerts: () => [] };
  const server = createMcpServer(host, { admin: true }, { sync: sync as never, schedules: schedules as never });
  const client = new Client({ name: 'policy-sync', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const call = () => client.callTool({ name: 'sync_status', arguments: {} });
  const refused = await call();
  assert.doesNotMatch(JSON.stringify(refused), /protected-record-id/);
  const named = await client.callTool({ name: 'sync_status', arguments: { database: 'Shop' } });
  assert.match(JSON.stringify(named), /AI policy.*refused/i);
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  const before = await call(); assert.match(JSON.stringify(before), /protected-record-id/);
  store.setAiPolicy(false); assert.deepEqual(await call(), before);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';

test('run_script executes for a limited account without exposing Full Access traces', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-trace-'));
  const host = new Host(dir, () => {}, { background: false });
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = host.create('Local');
  store.setAiPolicy(false);
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Restricted' }] },
    { op: 'createScript', name: 'Jump', text: 'Go to Layout [ Layout Name: T::Restricted ]\nExit Script [ Text Result: Get ( LastError ) ]' },
  ]);
  const layout = store.schema.layouts[0].name;
  const canary = 'private-layout-canary-73';
  store.create(layout, { Restricted: canary });
  store.schema.scripts.find((script) => script.name === 'Jump')!.fullAccess = true;
  store.savePrivilegeSet({
    name: 'Limited', records: { view: true, edit: false, create: false, delete: false },
    tables: { T: { view: true, edit: false, create: false, delete: false, fields: { Restricted: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('Limited', 'pw', 'Limited');
  store.setPassword('Admin', 'pw', '[Full Access]');

  const callAs = async (account: string, trace: boolean) => {
    const server = createMcpServer(host, { account, database: 'Local' });
    const client = new Client({ name: 'trace-privilege-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const response = await client.callTool({ name: 'run_script', arguments: { database: 'Local', script: 'Jump', layout, trace } });
      assert.ok(!response.isError, JSON.stringify(response.content));
      return JSON.parse((response.content as { text: string }[])[0].text) as Record<string, any>;
    } finally {
      await client.close();
      await server.close();
    }
  };

  const limited = await callAs('Limited', true);
  assert.equal(limited.result, '105', JSON.stringify(limited));
  assert.equal(limited.error, 105);
  assert.equal(limited.trace, undefined);
  assert.match(limited.traceRefusal, /debugging needs \[Full Access\]/);
  assert.ok(!JSON.stringify(limited).includes(canary), 'trace must not quote a hidden field value');

  const ordinary = await callAs('Limited', false);
  assert.equal(ordinary.result, '105');
  assert.equal(ordinary.traceRefusal, undefined);
  const full = await callAs('Admin', true);
  assert.ok(full.trace?.some((line: { message?: string }) => line.message?.includes(canary)), JSON.stringify(full));
  assert.equal(full.traceRefusal, undefined);
});

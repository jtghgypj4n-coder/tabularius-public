import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../../store/src/index.ts';
import type { DebugPoint } from '../../scripts/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';

for (const capture of ['On', 'Off']) test(`MCP final Beep account refusal returns isError, Error Capture ${capture}`, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-execution-refusal-'));
  createStore(join(dir, 'Local.openhbam.sqlite'));
  const host = new Host(dir);
  const store = host.get('Local')!;
  store.setAiPolicy(false); // the final-step refusal under test, not the AI policy
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value' }] },
    { op: 'createScript', name: 'Caller', text: `Set Error Capture [ ${capture} ]\nSet Field [ T::Value ; "pending" ]\nBeep` },
  ]);
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.setPassword('Worker', 'pw', '[Full Access]');
  const { recordId } = store.create('T', { Value: 'original' });
  const server = createMcpServer(host, { account: 'Worker', password: 'pw' });
  const client = new Client({ name: 'execution-refusal-test', version: '1.0.0' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const options = host.scriptOptions();
  let revoked = false;
  host.scriptOptions = () => ({ ...options, debug: async (point: DebugPoint) => {
    if (point.index === 2) {
      assert.equal(point.pending().fields.Value, 'pending');
      store.setAccountActive('Worker', false);
      revoked = true;
    }
  } });
  const result = await client.callTool({ name: 'run_script', arguments: { database: 'Local', layout: 'T', script: 'Caller', trace: true } });
  assert.equal(revoked, true);
  assert.equal(store.get('T', recordId).fieldData.Value, 'original');
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.match(JSON.stringify(result.content), /212|inactive/i);
});

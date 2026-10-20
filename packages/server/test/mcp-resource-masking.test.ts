// MCP resources mask personal data in JSON the way the matching tools do, even after an escaped newline or tab, and
// leave the same security-log records the tools do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';

test('a number after a newline or tab in a layout or schema comment is masked in the resource as in the tool, and logged', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-resource-mask-'));
  const host = new Host(dir, () => {}, { background: false });
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = host.create('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'Status', type: 'text', comment: 'Escalate to owner:\n555-867-5309 or SSN\t123-45-6789' }] },
    { op: 'createScript', name: 'Call', text: '# Call 555-867-5309' },
  ]);
  store.setPassword('Admin', 'pw');
  store.setPiiIsolation(true);
  const server = createMcpServer(host, { account: 'Admin', database: 'Shop' });
  const client = new Client({ name: 'mask-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const layout = store.schema.layouts[0].name;
  const leaks = (text: string) => /555-867-5309|123-45-6789/.test(text);

  const read = async (uri: string) => (await client.readResource({ uri })).contents[0] as { text: string };
  const layoutBody = (await read(`tabularius://Shop/layouts/${encodeURIComponent(layout)}`)).text;
  const schemaBody = (await read('tabularius://Shop/schema')).text;
  const scriptBody = (await read('tabularius://Shop/scripts/Call')).text;
  assert.ok(!leaks(layoutBody), layoutBody);
  assert.ok(!leaks(schemaBody), schemaBody);
  assert.ok(!leaks(scriptBody), scriptBody);
  const tool = await client.callTool({ name: 'describe_layout', arguments: { database: 'Shop', layout } });
  assert.ok(!leaks((tool.content as { text: string }[])[0].text));
  assert.deepEqual(JSON.parse(layoutBody), JSON.parse((tool.content as { text: string }[])[0].text));

  const via = (e: { changes?: unknown }) => (e.changes as { via?: string; blocked?: boolean })?.via;
  const events = store.securityEvents({ kind: 'ai-data-masked', limit: 200 });
  assert.ok(events.some((e) => via(e) === 'MCP resource'), 'a masked resource read is recorded');
  const before = events.length;
  await assert.rejects(client.readResource({ uri: 'tabularius://Shop/audit' }), /Personal data isolation/);
  const after = store.securityEvents({ kind: 'ai-data-masked', limit: 200 });
  assert.ok(after.length > before);
  assert.ok(after.some((e) => via(e) === 'MCP resource audit_log'), 'a refused resource read is recorded');
});

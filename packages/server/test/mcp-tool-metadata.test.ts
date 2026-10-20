// Every MCP tool tells a client what it is called and what each input means, and says whether it changes anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serve } from '../src/index.ts';
import { toolTitle } from '../src/mcp-hints.ts';
import { SERVER_VERSION } from '../src/version.ts';

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-metadata-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('initialize reports the server version to an MCP client', async () => {
  const client = new Client({ name: 'metadata-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    assert.deepEqual(client.getServerVersion(), { name: 'tabularius', version: SERVER_VERSION });
  } finally {
    await client.close();
  }
});

test('every tool has a title, a described input for each property, and annotations', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const tools = (await res.json()).result.tools as { name: string; title?: string; annotations?: Record<string, unknown>; inputSchema: { properties?: Record<string, { description?: string }> } }[];
  assert.ok(tools.length > 80, `${tools.length} tools listed`);
  const bare: string[] = [];
  for (const t of tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.ok(t.annotations && Object.keys(t.annotations).length, `${t.name} says whether it changes anything (annotations)`);
    for (const [prop, schema] of Object.entries(t.inputSchema.properties ?? {})) if (!schema.description) bare.push(`${t.name}.${prop}`);
  }
  assert.deepEqual(bare, [], 'inputs with no description: add them to the tool or to mcp-hints.ts');
});

test('titles read as words', () => {
  assert.equal(toolTitle('find_records'), 'Find records');
  assert.equal(toolTitle('sql_query'), 'SQL query');
  assert.equal(toolTitle('paste_from_filemaker'), 'Paste from FileMaker');
});

// Structured tool output: find_records, get_record, describe_database, describe_layout and summarize_records declare an
// outputSchema and answer with structuredContent as well as the JSON text, and the two say the same thing. Other tools
// stay text-only.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';

const STRUCTURED = ['describe_database', 'describe_layout', 'find_records', 'get_record', 'summarize_records'];

async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-structured-'));
  createStore(join(dir, 'Sales.openhbam.sqlite'));
  const host = new Host(dir);
  const sales = host.get('Sales')!;
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  sales.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  sales.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Customer' }, { name: 'Total', type: 'number' }, { name: 'Password' }] },
  ]);
  sales.create('Orders', { Customer: 'Acme', Total: '10', Password: 'hunter2-secret' });
  sales.create('Orders', { Customer: 'Acme', Total: '5', Password: 'x' });
  sales.create('Orders', { Customer: 'Bolt', Total: '7', Password: 'y' });
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'structured-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  // The client checks each answer against the schema it learns from the tool list, as a real client does.
  await client.listTools();
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: { database: 'Sales', ...args } });
  const text = (r.content as { type: string; text: string }[])[0]!.text;
  return { text, structured: r.structuredContent as Record<string, any> | undefined, isError: r.isError };
}

test('only the five read tools declare an output schema', async (t) => {
  const client = await setup(t);
  const { tools } = await client.listTools();
  const declared = tools.filter((x) => x.outputSchema).map((x) => x.name).sort();
  assert.deepEqual(declared, STRUCTURED);
  assert.equal(tools.find((x) => x.name === 'find_records')!.outputSchema!.type, 'object');
});

test('each answers with structuredContent that matches its text', async (t) => {
  const client = await setup(t);
  const found = await call(client, 'find_records', { layout: 'Orders', limit: 2 });
  assert.equal(found.structured!.foundCount, 3);
  assert.equal(found.structured!.records.length, 2);
  assert.deepEqual(found.structured, JSON.parse(found.text));

  const id = found.structured!.records[0].recordId;
  const one = await call(client, 'get_record', { layout: 'Orders', recordId: id });
  assert.equal(one.structured!.fieldData.Customer, 'Acme');
  assert.deepEqual(one.structured, JSON.parse(one.text));

  const schema = await call(client, 'describe_database', {});
  assert.ok(schema.structured!.tables.some((x: { name: string }) => x.name === 'Orders'));
  assert.deepEqual(schema.structured, JSON.parse(schema.text));

  const layout = await call(client, 'describe_layout', { layout: 'Orders' });
  assert.equal(layout.structured!.table, 'Orders');
  assert.ok(layout.structured!.fields.some((f: { name: string }) => f.name === 'Customer'));
  assert.deepEqual(layout.structured, JSON.parse(layout.text));

  const sum = await call(client, 'summarize_records', { layout: 'Orders', groupBy: ['Customer'], measures: [{ field: 'Total', fn: 'sum' }] });
  assert.equal(sum.structured!.foundCount, 3);
  assert.equal(sum.structured!.groups.length, 2);
  assert.deepEqual(sum.structured, JSON.parse(sum.text));
});

test('structuredContent carries the same hiding as the text, and an error has none', async (t) => {
  const client = await setup(t);
  const found = await call(client, 'find_records', { layout: 'Orders' });
  assert.ok(!found.text.includes('hunter2-secret'));
  assert.ok(!JSON.stringify(found.structured).includes('hunter2-secret'));

  const missing = await call(client, 'find_records', { layout: 'No such layout' });
  assert.equal(missing.isError, true);
  assert.equal(missing.structured, undefined);
});

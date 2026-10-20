// MCP tools refuse input that would otherwise be dropped, ignored or read as "nothing found": bad base64, an empty
// update, a stale modId on portal-only edits, a search with no word, and lists of unbounded length.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import type { Store } from '../../store/src/index.ts';

let dir: string;
let host: Host;
let store: Store;
let client: Client;
let server: ReturnType<typeof createMcpServer>;
let layout: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-input-'));
  host = new Host(dir, () => {}, { background: false });
  store = host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Pic', type: 'container' }] }]);
  store.setPassword('Admin', 'pw');
  layout = store.schema.layouts[0].name;
  store.create(layout, { Name: 'apple' });
  server = createMcpServer(host, { account: 'Admin', database: 'Shop' });
  client = new Client({ name: 'input-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
});
after(async () => {
  await client?.close();
  await server?.close();
  await host?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const r = await client.callTool({ name, arguments: { database: 'Shop', ...args } });
  return { isError: !!r.isError, text: (r.content as { text: string }[])[0].text };
}
const upload = (data: string, filename = 'a.txt') => call('upload_container', { layout, recordId: 1, field: 'Pic', filename, data });

test('upload_container refuses bad characters, empty data and an empty filename, and takes a good file', async () => {
  for (const [data, filename] of [['@@not base64@@', 'a.txt'], ['', 'a.txt'], ['  \n ', 'a.txt'], ['aGVsbG8=', ''], ['aGVsbG8=', '   '], ['aGVs=bG8', 'a.txt'], ['AAAAA', 'a.txt']] as const) {
    const r = await upload(data, filename);
    assert.equal(r.isError, true, `${JSON.stringify(data)} ${JSON.stringify(filename)}`);
    assert.match(r.text, /base64|filename/i);
  }
  assert.equal((await upload('aGVs\nbG8=')).isError, false);
});

test('upload_container refuses a file by the length of its text, before decoding it', async () => {
  const r = await upload('A'.repeat(139_810_136 + 2048));
  assert.equal(r.isError, true);
  assert.match(r.text, /100 MB/);
});

test('update_record: a stale modId stops portal-only edits, and an empty call says there is nothing to change', async () => {
  const got = await call('get_record', { layout, recordId: 1 });
  assert.equal(got.isError, false, got.text);
  const current = JSON.parse(got.text).modId;
  const stale = Number(current) + 5;
  const portalOnly = await call('update_record', { layout, recordId: 1, modId: stale, deleteRelated: ['Items.1'] });
  assert.equal(portalOnly.isError, true);
  assert.match(portalOnly.text, /modification id|306/i);
  // With a field edit too, the stale modId still stops the portal row from going before the field update fails.
  const both = await call('update_record', { layout, recordId: 1, modId: stale, fieldData: { Name: 'x' }, deleteRelated: ['Items.1'] });
  assert.equal(both.isError, true);
  assert.match(both.text, /modification id|306/i);
  const after = await call('get_record', { layout, recordId: 1 });
  assert.equal(JSON.parse(after.text).portalData?.Items?.length, JSON.parse(got.text).portalData?.Items?.length, 'the portal row is still there');
  const empty = await call('update_record', { layout, recordId: 1 });
  assert.equal(empty.isError, true);
  assert.match(empty.text, /Nothing to change/);
  const emptyFields = await call('update_record', { layout, recordId: 1, fieldData: {} });
  assert.equal(emptyFields.isError, true);
  const ok = await call('update_record', { layout, recordId: 1, fieldData: { Name: 'pear' } });
  assert.equal(ok.isError, false, ok.text);
});

test('search_records with no letter or digit is an error, not an empty answer', async () => {
  for (const text of ['   ', '!!!', '']) {
    const r = await call('search_records', { text });
    assert.equal(r.isError, true, JSON.stringify(text));
    assert.match(r.text, /at least one word/);
  }
  const found = await call('search_records', { text: 'pear' });
  assert.equal(found.isError, false);
  assert.ok(JSON.parse(found.text).hits.length >= 1);
});

test('lists with no upper bound are refused past a limit that the message names', async () => {
  const requests = (n: number) => Array.from({ length: n }, () => ({ Name: 'x' }));
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['find_records', { layout, query: requests(1000) }, /at most 50 find requests/i],
    ['find_records', { layout, sort: Array.from({ length: 21 }, () => ({ fieldName: 'Name' })) }, /at most 20 fields/i],
    ['update_records', { layout, query: requests(51), fieldData: { Name: 'y' }, dryRun: true }, /at most 50 find requests/i],
    ['summarize_records', { layout, query: requests(51) }, /at most 50 find requests/i],
    ['fix_data_problems', { layout, fixes: Array.from({ length: 201 }, () => ({ field: 'Name', from: 'a', to: 'b' })) }, /at most 200 fixes/i],
    ['search_records', { text: 'pear', tables: Array.from({ length: 201 }, () => 'Items') }, /at most 200 tables/i],
  ];
  for (const [name, args, message] of cases) {
    const r = await call(name, args);
    assert.equal(r.isError, true, name);
    assert.match(r.text, message, name);
  }
  // Within the limit still works.
  assert.equal((await call('find_records', { layout, query: requests(50) })).isError, false);
});

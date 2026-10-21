// What a caller reads when the server itself fails: a fault of the server's own (a file path, a table in a SQLite error, a
// bug's message) is logged and not described; the errors the code throws on purpose still reach the caller as written.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, StoreError } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { FAULT_MESSAGE, callerText, isFault } from '../src/fault-log.ts';
import { providerText, scrubKeys } from '../src/assistant.ts';

const caught = (f: () => void): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  return undefined;
};

test('isFault: file-system, SQLite and JavaScript faults are, written errors are not', () => {
  const fs = caught(() => readFileSync('/nonexistent/secret-folder/x'));
  assert.match((fs as Error).message, /secret-folder/);
  assert.equal(isFault(fs), true);
  const sqlite = caught(() => new DatabaseSync(':memory:').exec('SELEC 1'));
  assert.equal(isFault(sqlite), true);
  assert.equal(isFault(sqlite, { sql: true }), false, 'a caller\'s own SQL gets its SQLite error');
  assert.equal(isFault(new TypeError("Cannot read properties of undefined (reading 'x')")), true);
  assert.equal(isFault(new RangeError('x')), true);
  assert.equal(isFault(new Error('There is no layout "Nope"')), false);
  assert.equal(isFault(new StoreError(102, 'Field "Nope" is missing')), false);
  assert.equal(isFault('a string'), false);
  assert.equal(isFault(Object.assign(new Error('x'), { code: 802 })), false);
});

test('providerText: a refused key says only that, and key-like text is taken out', () => {
  assert.equal(providerText(401, 'invalid x-api-key sk' + '-ant-api03-abcdefgh'), 'the provider did not accept this server\'s key');
  assert.equal(providerText(429, 'Rate limited; Incorrect API key provided: sk-proj-****abcd. Bearer abc.def'), 'Rate limited; Incorrect API key provided: (key) (key)');
  assert.equal(providerText(500, undefined), 'HTTP 500');
  assert.equal(providerText(400, 'x'.repeat(900)).length, 500);
});

async function mcp(t: TestContext, broken: (host: Host) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-error-text-'));
  createStore(join(dir, 'Sales.openhbam.sqlite'));
  const host = new Host(dir);
  host.get('Sales')!.setAiPolicy(false);
  host.get('Sales')!.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'A' }] }]);
  broken(host);
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'error-text', version: '1.0.0' });
  const logged: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => { logged.push(...a); };
  t.after(async () => {
    console.error = log;
    await client.close();
    await server.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const text = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
    return { error: r.isError === true, text: r.content.map((c) => c.text).join('\n') };
  };
  return { text, logged };
}

test('an MCP tool that fails inside the server says so without the cause, which is logged', async (t) => {
  const { text, logged } = await mcp(t, (host) => {
    host.get('Sales')!.find = () => { throw Object.assign(new Error("ENOENT: no such file or directory, open '/srv/tabularius/Files/Sales/private.png'"), { code: 'ENOENT', syscall: 'open', path: '/srv/tabularius/Files/Sales/private.png' }); };
  });
  const r = await text('find_records', { database: 'Sales', layout: 'Orders', query: [{ A: '*' }] });
  assert.equal(r.error, true);
  assert.equal(r.text, FAULT_MESSAGE);
  assert.ok(logged.some((x) => x instanceof Error && /private\.png/.test(x.message)), 'the cause is in the log');
});

test('errors the code throws on purpose, and a caller\'s own SQL errors, still reach the caller', async (t) => {
  const { text } = await mcp(t, () => {});
  const missing = await text('find_records', { database: 'Sales', layout: 'Nope', query: [{ A: '*' }] });
  assert.equal(missing.error, true, missing.text);
  assert.match(missing.text, /Nope/);
  const sql = await text('sql_query', { database: 'Sales', sql: 'SELECT FROM' });
  assert.equal(sql.error, true, sql.text);
  assert.match(sql.text, /syntax error/);
});

test('callerText and scrubKeys: faults are replaced, written text stays, key tails are taken out', () => {
  const log = console.error;
  console.error = () => {};
  try {
    assert.equal(callerText(caught(() => readFileSync('/nonexistent/secret-folder/x'))), FAULT_MESSAGE);
  } finally {
    console.error = log;
  }
  assert.equal(callerText(new Error('Layout "Nope" is missing')), 'Layout "Nope" is missing');
  assert.equal(providerText(403, 'This model is not available in your region'), 'This model is not available in your region');
  assert.equal(scrubKeys('bad key ********abcd and AIzaSyA1234567890abcdef'), 'bad key (key) and (key)');
});

test('an MCP design tool and a resource that fail inside the server do not send the cause either', async (t) => {
  const { text, logged } = await mcp(t, (host) => {
    host.get('Sales')!.applyDesign = () => { throw Object.assign(new Error("EACCES: permission denied, open '/srv/tabularius/Sales.sqlite'"), { code: 'EACCES', syscall: 'open', path: '/srv/tabularius/Sales.sqlite' }); };
  });
  const r = await text('change_design', { database: 'Sales', changes: [{ op: 'createTable', name: 'T2' }] });
  assert.equal(r.error, true);
  assert.ok(!/srv\/tabularius/.test(r.text), r.text);
  assert.ok(logged.length > 0);
});

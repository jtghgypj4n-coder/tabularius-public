import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { createStore, type Store } from '../../store/src/index.ts';

// Design mode reads another hosted file's tables (so a layout or value list can use an occurrence of its table) only
// for an account that may design that file too, and for AI only where AI may read it. Everything below is built here.
const keys = ['fmrest', 'fmodata', 'fmxdbc', 'fmmcp', 'fmapp', 'fmwebdirect'];
const refusal = /another file that isn't hosted here or that this account can't design|is not hosted here or this account can't design it/;
let dir: string;
let server: Server;
let base: string;
let ui: Store;
let ui2: Store;
let ui3: Store;
let data: Store;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sep-access-'));
  for (const name of ['UI', 'UI2', 'UI3', 'Data']) createStore(join(dir, `${name}.openhbam.sqlite`));
  const served = await serve({ dir, port: 0, hostname: '127.0.0.1', sqlPort: 0, watch: false, log: () => {} });
  server = served.server;
  base = served.url;
  [ui, ui2, ui3, data] = ['UI', 'UI2', 'UI3', 'Data'].map((n) => served.host.get(n)!);
  for (const store of [ui, ui2, ui3, data]) {
    store.setAiPolicy(false);
    store.savePrivilegeSet({ ...store.privilegeSet('[Full Access]')!, extendedPrivileges: keys });
  }
  data.applyDesign([
    { op: 'createTable', name: 'Secrets', fields: [{ name: 'SSN', type: 'text' }, { name: 'Salary', type: 'text' }] },
    { op: 'createValueList', name: 'Cities', values: ['Oslo', 'Rome'] },
  ]);
  data.setPassword('Admin', 'pw', '[Full Access]');
  data.setPassword('Both', 'pw', '[Full Access]');
  ui.setPassword('Des', 'pw', '[Full Access]');
  ui.setPassword('Both', 'pw', '[Full Access]');
  ui2.setPassword('Des', 'pw', '[Full Access]');
  ui2.setPassword('Both', 'pw', '[Full Access]');
  ui3.setPassword('Both', 'pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const tableId = () => data.schema.tables[0].id;
const listId = () => data.schema.valueLists[0].id;
const fieldId = (name: string) => data.schema.tables[0].fields.find((f) => f.name === name)!.id;
const fieldNames = (store: Store, layout: string) => (store.designs().layouts.find((l) => l.name === layout)?.objects ?? []).filter((o) => o.kind === 'field').map((o) => o.field!.field);

/** The design route, as an account of the interface file (an API token). */
async function route(store: Store, account: string, changes: unknown[], preview = false) {
  const r = await fetch(`${base}/tabularius/design/v1/databases/${store.name}${preview ? '?preview=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${store.createApiToken(account)}` },
    body: JSON.stringify({ changes }),
  });
  const text = await r.text();
  return { status: r.status, text, data: JSON.parse(text) as any };
}

let n = 0;
/** change_design over MCP, as `account` (password "pw"). */
async function mcp(account: string, database: string, changes: unknown[], tool = 'change_design') {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(`${account}:pw`) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name: tool, arguments: { database, changes } } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error) }] };
  return { error: !!result.isError, text: result.content[0].text as string };
}

const source = [{ op: 'createDataSource', name: 'Data', paths: ['file:Data'] }];
const occurrence = () => [{ op: 'createOccurrence', name: 'Secrets', file: 'Data', externalTable: tableId() }];

test('design route: Full Access on the interface file alone gets no field names of the data file', async () => {
  const made = await route(ui, 'Des', [...source, ...occurrence(), { op: 'createLayout', name: 'Seen', occurrence: 'Secrets' }]);
  assert.equal(made.status, 200, made.text);
  assert.deepEqual(fieldNames(ui, 'Seen'), [], 'a layout for a table this account cannot design has no fields');
  assert.doesNotMatch(JSON.stringify(ui.designs()) + JSON.stringify(ui.schema), /SSN|Salary/);
});

test('design route: a value list from a field or a list of a file the account cannot design is refused, and says the same for real and made-up ids', async () => {
  const asked = [
    [{ op: 'createValueList', name: 'F1', field: { occurrence: 'Secrets', field: fieldId('SSN') } }],
    [{ op: 'createValueList', name: 'F2', field: { occurrence: 'Secrets', field: 424242 } }],
    [{ op: 'createValueList', name: 'F3', field: { occurrence: 'Secrets', field: 'NoSuchField' } }],
    [{ op: 'createValueList', name: 'E1', external: { file: 'Data', valueList: listId() } }],
    [{ op: 'createValueList', name: 'E2', external: { file: 'Data', valueList: 424242 } }],
  ];
  const messages: string[] = [];
  for (const changes of asked) {
    const r = await route(ui, 'Des', changes);
    assert.equal(r.status, 400, r.text);
    assert.match(r.data.error.message, refusal);
    messages.push(r.data.error.message.replace(/value list \d+/, ''));
  }
  // The message does not depend on whether the field, table or list exists in the other file.
  assert.deepEqual([...new Set(messages.slice(0, 3))].length, 1, messages.join('\n'));
  assert.deepEqual([...new Set(messages.slice(3))].length, 1, messages.join('\n'));
  assert.equal(ui.schema.valueLists.length, 0);
  const preview = await route(ui, 'Des', asked[0], true);
  assert.equal(preview.status, 400, 'the preview reads no more than the change');
});

test('design route: an account that may design both files gets the fields and can use the lists', async () => {
  const made = await route(ui, 'Both', [{ op: 'createLayout', name: 'Both', occurrence: 'Secrets' }, { op: 'createValueList', name: 'Where', external: { file: 'Data', valueList: listId() } }, { op: 'createValueList', name: 'Ssn', field: { occurrence: 'Secrets', field: fieldId('SSN') } }]);
  assert.equal(made.status, 200, made.text);
  assert.deepEqual(fieldNames(ui, 'Both'), ['SSN', 'Salary']);
  assert.equal(ui.schema.valueLists.length, 2);
  const missing = await route(ui, 'Both', [{ op: 'createValueList', name: 'Gone', external: { file: 'Data', valueList: 424242 } }]);
  assert.equal(missing.status, 400);
  assert.match(missing.data.error.message, /has no value list 424242/);
});

test('MCP change_design: an identity without an account on the data file gets no fields and no value list, even when the data source is made in the same batch', async () => {
  const sameBatch = await mcp('Des', 'UI2', [...source, ...occurrence(), { op: 'createLayout', name: 'Seen', occurrence: 'Secrets' }]);
  assert.equal(sameBatch.error, false, sameBatch.text);
  assert.deepEqual(fieldNames(ui2, 'Seen'), []);
  for (const changes of [
    [{ op: 'createValueList', name: 'F', field: { occurrence: 'Secrets', field: fieldId('SSN') } }],
    [{ op: 'createValueList', name: 'E', external: { file: 'Data', valueList: 424242 } }],
  ]) {
    const r = await mcp('Des', 'UI2', changes);
    assert.equal(r.error, true, r.text);
    assert.match(r.text, refusal);
  }
  assert.equal(ui2.schema.valueLists.length, 0);
  const tried = await mcp('Des', 'UI2', [{ op: 'createValueList', name: 'F', field: { occurrence: 'Secrets', field: fieldId('SSN') } }], 'try_design_change');
  assert.equal(tried.error, true, tried.text);
});

test('MCP change_design: with AI off on the data file, an account that may design both files gets none of its fields, including when the data source is made in the same batch', async () => {
  data.setAiAllowed(false);
  try {
    // A file that already uses the data file is closed to AI altogether.
    const closed = await mcp('Both', 'UI2', [{ op: 'createLayout', name: 'AiOff', occurrence: 'Secrets' }]);
    assert.equal(closed.error, true, closed.text);
    // One that gains the data source in the same call is not seen as using it yet; the data file is still not read.
    const sameBatch = await mcp('Both', 'UI3', [...source, ...occurrence(), { op: 'createLayout', name: 'AiOff', occurrence: 'Secrets' }]);
    assert.equal(sameBatch.error, false, sameBatch.text);
    assert.deepEqual(fieldNames(ui3, 'AiOff'), []);
    const list = await mcp('Both', 'UI3', [{ op: 'createValueList', name: 'AiOffList', external: { file: 'Data', valueList: listId() } }]);
    assert.equal(list.error, true, list.text);
  } finally {
    data.setAiAllowed(true);
  }
  const on = await mcp('Both', 'UI3', [{ op: 'createLayout', name: 'AiOn', occurrence: 'Secrets' }]);
  assert.equal(on.error, false, on.text);
  assert.deepEqual(fieldNames(ui3, 'AiOn'), ['SSN', 'Salary'], 'the same call with AI on reads the file');
});

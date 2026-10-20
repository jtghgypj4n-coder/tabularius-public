// AI output and read-audit parity across record, aggregate, search, script and export routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
let token: string;
let webToken: string;
let id: number;
const basic = 'Basic ' + btoa('Admin:pw');
const reads = () => store.auditLog({ table: 'People', kind: 'read' });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-parity-'));
  createStore(join(dir, 'AuditParity' + STORE_EXT));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = served.server;
  base = served.url;
  store = served.host.get('AuditParity')!;
  store.setAiPolicy(false); // the secret-field masking under test, not the AI policy's refusal
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Status' }, { name: 'Password' }] }] as DesignOp[]);
  id = store.create('People', { Name: 'Ada', Status: 'Active', Password: 'synthetic-secret-123' }).recordId;
  store.applyDesign([{ op: 'createScript', name: 'RevealPassword', text: 'Exit Script [ ExecuteSQL ( "SELECT Password FROM People" ; "" ; "" ) ]' }] as DesignOp[]);
  store.applyDesign([{ op: 'createScript', name: 'ReturnStatus', text: 'Exit Script [ "ok" ]' }] as DesignOp[]);
  store.applyDesign([{ op: 'createScript', name: 'DynamicPassword', text: 'Exit Script [ GetField ( "Pass" & "word" ) ]' }] as DesignOp[]);
  store.applyDesign([{ op: 'createScript', name: 'DynamicSqlPassword', text: 'Exit Script [ ExecuteSQL ( "SELECT Pass" & "word FROM People" ; "" ; "" ) ]' }] as DesignOp[]);
  store.applyDesign([{ op: 'createScript', name: 'DialogPassword', text: 'Show Custom Dialog [ "Read" ; GetField ( "Pass" & "word" ) ]\nExit Script [ "done" ]' }] as DesignOp[]);
  store.applyDesign([{ op: 'createScript', name: 'MentionToken', text: 'Exit Script [ "token is a word" ]' }] as DesignOp[]);
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmapp', 'fmodata', 'fmmcp'])] });
  store.setPassword('Admin', 'pw', full.name);
  const login = await fetch(`${base}/fmi/data/vLatest/databases/AuditParity/sessions`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(login.status, 200, await login.clone().text());
  token = (await login.json()).response.token;
  const webLogin = await fetch(`${base}/fmi/data/vLatest/databases/AuditParity/sessions`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', 'x-tabularius-client': 'web' }, body: '{}',
  });
  assert.equal(webLogin.status, 200, await webLogin.clone().text());
  webToken = (await webLogin.json()).response.token;
  store.setAuditSettings({ logReads: true });
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('OData property reads are audited like Data API record reads', async () => {
  const baseline = reads().length;
  const control = await fetch(`${base}/fmi/data/vLatest/databases/AuditParity/layouts/People/records/${id}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(control.status, 200, await control.clone().text());
  assert.equal(reads().length, baseline + 1);
  const before = reads().length;
  const response = await fetch(`${base}/fmi/odata/v4/AuditParity/People(${id})/Name`, { headers: { authorization: basic } });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).value, 'Ada');
  assert.equal(reads().length, before + 1, 'property read must log its record');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'odata']);
  const raw = await fetch(`${base}/fmi/odata/v4/AuditParity/People(${id})/Name/$value`, { headers: { authorization: basic } });
  assert.equal(raw.status, 200, await raw.clone().text());
  assert.equal(await raw.text(), 'Ada');
  assert.equal(reads().length, before + 2, '$value must log the same record');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'odata']);
});

test('OData aggregates are audited like Data API finds', async () => {
  const before = reads().length;
  const path = '/fmi/odata/v4/AuditParity/People?$apply=' + encodeURIComponent('groupby((Status),aggregate($count as Total))');
  const response = await fetch(base + path, { headers: { authorization: basic } });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).value.map((r: { Status: string; Total: number }) => [r.Status, r.Total]), [['Active', 1]]);
  assert.equal(reads().length, before + 1, 'aggregate must log the rows it consumed');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'odata']);
});

test('web client export is audited like Data API record reads', async () => {
  const before = reads().length;
  const response = await fetch(`${base}/tabularius/app/v1/databases/AuditParity/layouts/People/export`, {
    method: 'POST', headers: { authorization: `Bearer ${webToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: ['Name'], ids: [id], format: 'csv' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(await response.text(), /Ada/);
  assert.equal(reads().length, before + 1, 'export must log its source record');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'web']);
});

test('MCP summarize_records is audited like MCP find_records', async () => {
  const before = reads().length;
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'summarize_records', arguments: { database: 'AuditParity', layout: 'People', groupBy: ['Status'] } } }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(JSON.parse(result.content[0].text).foundCount, 1);
  assert.equal(reads().length, before + 1, 'aggregate must log the rows it consumed');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'mcp']);
});

test('MCP summaries hide secret group keys and measures', async () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'AuditParity', layout: 'People', ...args } } }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  const record = await call('get_record', { recordId: id });
  assert.equal(record.isError, undefined, JSON.stringify(record));
  assert.doesNotMatch(JSON.stringify(record), /synthetic-secret-123/);
  const summary = await call('summarize_records', { groupBy: ['Password'] });
  assert.equal(summary.isError, undefined, JSON.stringify(summary));
  assert.doesNotMatch(JSON.stringify(summary), /synthetic-secret-123/, 'aggregate must redact secret field values');
  assert.match(JSON.stringify(summary), /hidden from AI tools/);
  const measure = await call('summarize_records', { measures: [{ field: 'Password', fn: 'min' }] });
  assert.equal(measure.isError, undefined, JSON.stringify(measure));
  assert.doesNotMatch(JSON.stringify(measure), /synthetic-secret-123/);
});

test('MCP word search does not search secret fields', async () => {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_records', arguments: { database: 'AuditParity', text: 'synthetic-secret-12' } } }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(JSON.parse(result.content[0].text).hits.length, 0, 'a secret field is not searched, so a prefix of it finds nothing');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-123/, 'search result must redact the matching secret');
});

test('MCP dashboard previews hide secret categories', async () => {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_dashboard', arguments: {
      database: 'AuditParity', name: 'Secret preview', preview: true,
      widgets: [
        { title: 'By password', kind: 'chart', chart: 'bar', layout: 'People', groupBy: ['Password'] },
        { title: 'Password table', kind: 'table', layout: 'People', groupBy: ['Password'] },
        { title: 'First password', kind: 'number', layout: 'People', measure: { field: 'Password', fn: 'min' } },
      ],
    } } }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-123/, 'dashboard must redact secret categories');
});

test('MCP saved dashboards hide secret categories when read back', async () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'AuditParity', ...args } } }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return result;
  };
  const saved = await call('save_dashboard', { name: 'Secret saved chart', widgets: [{ title: 'By password', kind: 'chart', chart: 'bar', layout: 'People', groupBy: ['Password'] }] });
  assert.doesNotMatch(JSON.stringify(saved), /synthetic-secret-123/);
  const read = await call('get_dashboard', { dashboard: 'Secret saved chart' });
  assert.doesNotMatch(JSON.stringify(read), /synthetic-secret-123/);
});

test('MCP dashboard previews and saved reads audit each summarized record', async () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'AuditParity', ...args } } }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
  };
  const widgets = [{ title: 'By status', kind: 'chart', chart: 'bar', layout: 'People', groupBy: ['Status'] }];
  const before = reads().length;
  await call('save_dashboard', { name: 'Audited preview', preview: true, widgets });
  assert.equal(reads().length, before + 1, 'preview must audit its summarized record');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'mcp']);
  await call('save_dashboard', { name: 'Audited saved dashboard', widgets });
  assert.equal(reads().length, before + 2, 'save must audit its summarized record');
  await call('get_dashboard', { dashboard: 'Audited saved dashboard' });
  assert.equal(reads().length, before + 3, 'get must audit its summarized record');
  assert.deepEqual([reads().at(-1)?.recordId, reads().at(-1)?.surface], [id, 'mcp']);
});

test('MCP script results hide values read from secret fields', async () => {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'AuditParity', script: 'RevealPassword' } } }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-123/, 'script result must redact the secret');
  const safe = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'AuditParity', script: 'ReturnStatus' } } }),
  });
  assert.equal(safe.status, 200, await safe.clone().text());
  const ordinary = JSON.parse((await safe.json()).result.content[0].text);
  assert.equal(ordinary.result, 'ok');
  assert.equal(ordinary.trace, undefined);
});

test('MCP scripts that read a secret field return no output, even through computed names or dialogs, and harmless token text is kept', async () => {
  const call = async (script: string) => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'AuditParity', script } } }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-123/);
    return JSON.parse(result.content[0].text);
  };
  // A run that read a secret returns no output at all: a transformed secret (Upper, Middle, Base64Encode) can't be matched.
  const computed = await call('DynamicPassword');
  assert.match(computed.note, /the script read a secret field/);
  assert.equal(computed.result, undefined);
  const sql = await call('DynamicSqlPassword');
  assert.match(sql.note, /ExecuteSQL query may have read a secret field/);
  assert.equal(sql.result, undefined, 'SQL output is withheld when field reads cannot be traced');
  const dialog = await call('DialogPassword');
  assert.match(dialog.note, /the script read a secret field/);
  assert.equal(dialog.actions, undefined);
  assert.equal(dialog.result, undefined);
  assert.equal((await call('MentionToken')).result, 'token is a word');
});

test('personal data isolation still refuses derived MCP tools', async () => {
  store.setPiiIsolation(true, { account: 'test' });
  try {
    for (const [name, args] of [
      ['search_records', { text: 'Ada' }],
      ['summarize_records', { layout: 'People', groupBy: ['Status'] }],
      ['save_dashboard', { name: 'Isolated preview', preview: true, widgets: [{ title: 'By status', kind: 'chart', chart: 'bar', layout: 'People', groupBy: ['Status'] }] }],
      ['run_script', { script: 'ReturnStatus' }],
    ] as const) {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'AuditParity', ...args } } }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).result.isError, true, name);
    }
  } finally {
    store.setPiiIsolation(false, { account: 'test' });
  }
});

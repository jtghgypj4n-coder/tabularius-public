import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

// What a person does in the web client, an AI client can do over MCP: portal rows, files in containers,
// the script debugger, layout objects and triggers, FileMaker's clipboard, security, and trying a change offline.

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let host: Host;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-parity-'));
  copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'Charts.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let id = 0;
async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; value: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  });
  const body = await r.json();
  const text = body.result.content[0].text as string;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { isError: !!body.result.isError, text, value };
}

test('MCP: portal rows are edited and deleted through the parent record', { skip }, async () => {
  const layout = 'Related records • Pie';
  const before = (await call('get_record', { layout, recordId: 1 })).value;
  const rows = before.portalData['NW SalespersonCustomers'];
  const [first, second] = rows;
  const r = await call('update_record', {
    layout, recordId: 1,
    portalData: { 'NW SalespersonCustomers': [{ recordId: first.recordId, 'NW SalespersonCustomers::Salesperson': 'Ada Lovelace' }] },
    deleteRelated: [`NW SalespersonCustomers.${second.recordId}`],
  });
  assert.equal(r.isError, false, r.text);
  const after = (await call('get_record', { layout, recordId: 1 })).value.portalData['NW SalespersonCustomers'];
  assert.equal(after.find((x: { recordId: string }) => x.recordId === first.recordId)['NW SalespersonCustomers::Salesperson'], 'Ada Lovelace');
  assert.ok(!after.some((x: { recordId: string }) => x.recordId === second.recordId));
});

test('MCP: files go into container fields', { skip }, async () => {
  { const c = await call('change_design', { changes: [{ op: 'createField', table: 'Congress', name: 'Photo', type: 'container' }] }); assert.equal(c.isError, false, c.text); }
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const r = await call('upload_container', { layout: 'Congress', recordId: 1, field: 'Photo', filename: 'dot.png', mime: 'image/png', data: png });
  assert.equal(r.isError, false, r.text);
  const record = (await call('get_record', { layout: 'Congress', recordId: 1 })).value;
  const url = record.fieldData.Photo as string;
  assert.match(url, /containers\//);
  const file = await call('get_container', { container: url });
  assert.equal(file.isError, false, file.text);
});

test('MCP: the debugger stops at breakpoints with variables and watch formulas, offline', { skip }, async () => {
  const text = 'Set Variable [ $n ; Value: 1 ]\nSet Variable [ $n ; Value: $n + 1 ]\nInsert from URL [ $page ; "https://example.com" ]\nExit Script [ Result: $n ]';
  { const c = await call('change_design', { changes: [{ op: 'createScript', name: 'Count up', text }] }); assert.equal(c.isError, false, c.text); }
  const r = await call('debug_script', { script: 'Count up', breakpoints: [{ step: 2 }, { step: 4 }], watch: ['$n * 10', 'Get ( ScriptName )'] });
  assert.equal(r.isError, false, r.text);
  const [a, b] = r.value.stops;
  assert.equal(a.step, 2);
  assert.match(JSON.stringify(a.variables), /\$n[^\n]*1/);
  assert.deepEqual(a.watch.map((w: { value: string }) => w.value), ['10', 'Count up']);
  assert.equal(b.step, 4);
  // Insert from URL never reached the network: the step failed in the sandbox.
  assert.notEqual(b.lastError, 0);
  assert.equal(r.value.result.result, '2');
});

test('MCP: layout objects and triggers change one at a time', { skip }, async () => {
  const design = (await call('get_layout_design', { layout: 'Congress' })).value;
  const target = design.objects[0];
  const bounds = { ...target.bounds, left: target.bounds.left + 5, right: target.bounds.right + 5 };
  const r = await call('edit_layout_objects', {
    layout: 'Congress',
    set: [{ object: target.id, changes: { bounds } }],
    add: [{ kind: 'text', text: 'Added by AI', bounds: { top: 2, left: 2, bottom: 20, right: 120 } }],
    triggers: [{ event: 'OnRecordLoad', script: 'Count up' }],
  });
  assert.equal(r.isError, false, r.text);
  const after = (await call('get_layout_design', { layout: 'Congress' })).value;
  assert.deepEqual(after.objects.find((o: { id: number }) => o.id === target.id).bounds, bounds);
  const added = after.objects.find((o: { text?: string }) => o.text === 'Added by AI');
  assert.ok(added && added.id > 0);
  assert.equal(after.triggers[0].event, 'OnRecordLoad');
  assert.equal(after.triggers[0].script, 'Count up');
  assert.equal((await call('edit_layout_objects', { layout: 'Congress', remove: [added.id] })).isError, false);
  assert.ok(!(await call('get_layout_design', { layout: 'Congress' })).value.objects.some((o: { text?: string }) => o.text === 'Added by AI'));
  assert.match((await call('edit_layout_objects', { layout: 'Congress', remove: [999999] })).text, /no object 999999/);
});

test('MCP: FileMaker clipboard both ways', { skip }, async () => {
  const script = host.get('Charts')!.schema.scripts.find((s) => s.name === 'Count up')!;
  const copied = await call('copy_for_filemaker', { scripts: [script.id] });
  assert.equal(copied.isError, false, copied.text);
  assert.match(copied.value.xml, /<fmxmlsnippet type="FMObjectList">/);
  const pasted = await call('paste_from_filemaker', { xml: copied.value.xml });
  assert.equal(pasted.isError, false, pasted.text);
  assert.match(JSON.stringify(pasted.value), /createScript/);
});

test('MCP: try a change on a copy, offline, without changing the file', { skip }, async () => {
  const r = await call('try_design_change', {
    changes: [{ op: 'createScript', name: 'Mail it', text: 'Send Mail [ Send via E-mail Client ; With dialog: Off ; To: "a@example.com" ]' }],
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.value.runs[0].script, 'Mail it');
  assert.match(r.value.runs[0].run.message, /never sends email/);
  assert.ok(!host.get('Charts')!.schema.scripts.some((s) => s.name === 'Mail it'));
  assert.match((await call('try_design_change', { changes: [{ op: 'deleteTable', table: 'Nope' }] })).text, /Nope/);
});

test('MCP: images and security', { skip }, async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const added = await call('add_image', { filename: 'dot.png', mime: 'image/png', data: png });
  assert.equal(added.isError, false, added.text);
  assert.ok((await call('list_images', {})).value.some((i: { id: number }) => i.id === added.value.id));

  assert.match((await call('change_security', { changes: [{ op: 'setAccount', name: 'Temp', password: 'x', privilegeSet: '[Read-Only Access]' }] })).text, /Passwords are not set/);
  const sec = await call('change_security', { changes: [{ op: 'setAccount', name: '[Guest]', privilegeSet: '[Data Entry Only]' }] });
  assert.equal(sec.isError, false, sec.text);
  assert.ok(sec.value.accounts.some((a: { name: string; privilegeSet: string }) => a.name === '[Guest]' && a.privilegeSet === '[Data Entry Only]'), JSON.stringify(sec.value.accounts));
  assert.ok(!JSON.stringify(sec.value).includes('"password"'));
});

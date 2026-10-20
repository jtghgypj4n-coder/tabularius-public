// "What changed on this record, and why?": a record's audit trail grouped into events, each change saying how it came
// about where the design shows it, and which automation or data cleanup made it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { recordHistory } from '../src/record-history.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
let id: number;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-history-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'Invoices', fields: [
    { name: 'Customer', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'Total', type: 'number' },
    { name: 'Paid Note', type: 'text', calculation: 'If ( Status = "Paid" ; "Paid in full" ; "" )', options: { autoEnter: { calculation: true, replaceExisting: true } } },
    { name: 'Changed', type: 'timestamp', options: { autoEnter: { value: 'modificationTimestamp' } } },
    { name: 'Portal Password', type: 'text' },
  ] }] as never);
  id = Number(store.create('Invoices', { Customer: 'Acme', Status: 'Open', Total: '120', 'Portal Password': 'hunter2' }, { account: 'Admin' }).recordId);
  store.update('Invoices', id, { Status: 'Paid' }, undefined, { account: 'Admin' });
  store.update('Invoices', id, { Total: '125' }, undefined, { account: 'Bea' });
  store.setPassword('Admin', 'pw');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('events newest first, with who, when, from and to, and how each change came about', { skip }, () => {
  const h = recordHistory(store, 'Invoices', id);
  assert.deepEqual(h.events.map((e) => [e.kind, e.account]), [['changed', 'Bea'], ['changed', 'Admin'], ['created', 'Admin']]);
  const paid = h.events[1];
  const status = paid.changes.find((c) => c.field === 'Status')!;
  assert.deepEqual([status.from, status.to, status.how], ['Open', 'Paid', undefined]);
  const note = paid.changes.find((c) => c.field === 'Paid Note')!;
  assert.equal(note.to, 'Paid in full');
  assert.equal(note.how, 'worked out by its auto-enter calculation from Status');
  const stamp = paid.changes.find((c) => c.field === 'Changed');
  if (stamp) assert.equal(stamp.how, 'stamped with the modification time');
  // Secret-looking fields are hidden.
  const created = h.events[2];
  assert.equal(created.changes.find((c) => c.field === 'Portal Password')!.to, '‹hidden from AI tools›');
  assert.doesNotMatch(JSON.stringify(h), /hunter2/);
  // Fields a reader may not see are left out.
  const narrow = recordHistory(store, 'Invoices', id, { hideField: (f) => f === 'Total' });
  assert.ok(!JSON.stringify(narrow).includes('"Total"'));
  // Nor does a visible field's note name a hidden one it was worked out from.
  const noStatus = recordHistory(store, 'Invoices', id, { hideField: (f) => f === 'Status' });
  assert.ok(!JSON.stringify(noStatus).includes('Status'));
  assert.equal(noStatus.events[1].changes.find((c) => c.field === 'Paid Note')!.how, 'worked out by its auto-enter calculation');
  // Tables the reader may not see are left out of "alongside".
  assert.ok(!JSON.stringify(recordHistory(store, 'Invoices', id, { hideTable: () => true })).includes('alongside'));
});

test('as an MCP tool for [Full Access], and audit_log hides secrets too', { skip }, async () => {
  const call = async (name: string, args: Record<string, unknown>) => (await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa('Admin:pw') },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  })).json()).result.content[0].text as string;
  const h = JSON.parse(await call('explain_record_history', { layout: 'Invoices', recordId: id }));
  assert.equal(h.events.length, 3);
  assert.doesNotMatch(await call('audit_log', { table: 'Invoices', recordId: id }), /hunter2/);
});

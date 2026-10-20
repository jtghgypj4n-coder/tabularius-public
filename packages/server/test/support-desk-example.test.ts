// examples/support-desk: a ticket list an AI app triages over MCP. The example is built with `tabularius design-apply`, hosted, and
// worked as an AI agent account would: read the new tickets, preview a change to a batch, apply it with the count it expects,
// undo it, and find out that it cannot delete anything or close a ticket that is marked for review.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { Store } from '../../store/src/index.ts';

const main = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'support-desk');

let dir: string;
let server: Server;
let base: string;
let store: Store;

const TICKETS: [string, string][] = [
  ['Invoice 1042 charged twice', 'billing@acme.example'],
  ['Invoice missing for March', 'ap@globex.example'],
  ['App crashes when I export', 'sam@initech.example'],
  ['How do I add a user?', 'pat@umbrella.example'],
  ['Refund request, please call me', 'lee@hooli.example'],
];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-support-desk-'));
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
  assert.equal(run('new', dir, 'Helpdesk').status, 0);
  const applied = run('design-apply', dir, 'Helpdesk', example, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  const seed = new Store(join(dir, 'Helpdesk.openhbam.sqlite'), 'Helpdesk');
  for (const [Subject, From] of TICKETS) seed.create('Tickets', { Subject, From, Message: `${Subject}.` });
  seed.close();

  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Helpdesk')!;
  store.setAiPolicy(false); // the example's agent privileges under test, not the AI policy
  // The README's AI agent: reads and edits tickets, cannot create or delete them, and may use AI apps (fmmcp).
  store.savePrivilegeSet({
    name: 'Support agent',
    records: { view: true, edit: true, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  store.setPassword('triage', 'pw', 'Support agent');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function tool(name: string, args: unknown): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: 'Basic ' + btoa('triage:pw'),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error ?? body) }] };
  const text: string = result.content?.[0]?.text ?? '';
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { isError: !!result.isError, data, text };
}

const column = (field: string) => (store.query(`SELECT "${field}" AS v FROM Tickets ORDER BY _fm_record_id`) as { v: unknown }[]).map((r) => r.v ?? '');

test('an AI agent reads the new tickets, previews and applies a triage, and the change can be undone', async () => {
  const found = await tool('find_records', { database: 'Helpdesk', layout: 'Tickets', query: [{ Status: '=New' }], limit: 50 });
  assert.equal(found.isError, false, found.text);
  assert.equal(found.data.records.length, 5);

  // Billing tickets: the two invoices. A preview first, then the same change with the count the agent expects.
  const change = { database: 'Helpdesk', layout: 'Tickets', query: [{ Subject: 'Invoice*' }], fieldData: { Category: 'Billing', Priority: 'High' } };
  const preview = await tool('update_records', { ...change, dryRun: true });
  assert.equal(preview.isError, false, preview.text);
  assert.equal(preview.data.dryRun, true);
  assert.equal(preview.data.matched, 2);
  assert.ok(column('Category').every((v) => !v));

  const wrong = await tool('update_records', { ...change, expectCount: 3 });
  assert.equal(wrong.isError, true, 'a find that gives a different number than expected changes nothing');
  assert.ok(column('Category').every((v) => !v));

  const applied = await tool('update_records', { ...change, expectCount: 2 });
  assert.equal(applied.isError, false, applied.text);
  assert.ok(applied.data.id, 'the batch has an id to undo it by');
  assert.deepEqual(column('Category'), ['Billing', 'Billing', '', '', '']);
  assert.deepEqual(column('Priority'), ['High', 'High', '', '', '']);

  const undone = await tool('undo_data_fix', { database: 'Helpdesk', id: applied.data.id });
  assert.equal(undone.isError, false, undone.text);
  assert.ok(column('Category').every((v) => !v));
});

test('the agent cannot delete a ticket, and a ticket marked for review is not closed', async () => {
  const deleted = await tool('delete_record', { database: 'Helpdesk', layout: 'Tickets', recordId: 1 });
  assert.equal(deleted.isError, true);
  assert.equal(column('ID').length, 5);

  // The script runs on the first record of the layout. Marked for review, that ticket is not closed.
  const flagged = await tool('update_record', { database: 'Helpdesk', layout: 'Tickets', recordId: 1, fieldData: { 'Needs Review': 1, 'Draft Reply': 'Hello, we are sorry about the double charge. We have refunded the second one.' } });
  assert.equal(flagged.isError, false, flagged.text);
  let closed = await tool('run_script', { database: 'Helpdesk', layout: 'Tickets', script: 'Close ticket' });
  assert.equal(closed.isError, false, closed.text);
  assert.equal(closed.data.result, 'needs review');
  assert.equal(column('Status')[0], 'New', 'a ticket marked for review stays open');

  // Once a person has read it and cleared the mark, it closes.
  const cleared = await tool('update_record', { database: 'Helpdesk', layout: 'Tickets', recordId: 1, fieldData: { 'Needs Review': '' } });
  assert.equal(cleared.isError, false, cleared.text);
  closed = await tool('run_script', { database: 'Helpdesk', layout: 'Tickets', script: 'Close ticket' });
  assert.equal(closed.isError, false, closed.text);
  assert.equal(column('Status')[0], 'Closed');
  assert.deepEqual(column('Status').slice(1), ['New', 'New', 'New', 'New']);
});

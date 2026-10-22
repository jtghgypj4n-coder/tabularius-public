// Automations: a trigger on a table's records runs a script on the record, on the server, for every change
// whoever makes it. Tried first on a throwaway copy, offline; its own changes set off nothing, so no loops.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { writer, type PrivilegeDefinition, type Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;
let store: Store;

const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: true, edit: true, create: true, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'],
};

const MARK_PAID = [
  'Set Field [ Invoices::PaidDate ; Get ( CurrentDate ) ]',
  'Set Variable [ $customer ; Value: Invoices::CustomerID ]',
  'Set Variable [ $invoice ; Value: Invoices::InvoiceID ]',
  'Go to Layout [ "Notes" ]',
  'New Record/Request',
  'Set Field [ Notes::CustomerID ; $customer ]',
  'Set Field [ Notes::Text ; "Invoice " & $invoice & " paid" ]',
  'Commit Records/Requests [ With dialog: Off ]',
].join('\n');

const ids: number[] = [];
before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-automations-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'InvoiceID', type: 'text' }, { name: 'CustomerID', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'PaidDate', type: 'date' }, { name: 'Amount', type: 'number' }, { name: 'Touched', type: 'number' }] },
    { op: 'createTable', name: 'Notes', fields: [{ name: 'CustomerID', type: 'text' }, { name: 'Text', type: 'text' }] },
  ] as never);
  for (const [inv, cust] of [['I1', 'C1'], ['I2', 'C2'], ['I3', 'C1']]) ids.push(store.create('Invoices', { InvoiceID: inv, CustomerID: cust, Status: 'Open', Amount: 100 }).recordId);
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'pw');
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let id = 0;
async function mcp(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; value: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  });
  const result = (await r.json()).result;
  const text = result.content[0].text as string;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { isError: !!result.isError, text, value };
}

const PAID = {
  name: 'Invoice paid', layout: 'Invoices', on: 'update', fields: ['Status'], condition: 'Status = "Paid"',
  scriptText: { name: 'Mark invoice paid', text: MARK_PAID },
};
const notes = () => store.select('SELECT CustomerID, Text FROM "Notes" ORDER BY _fm_record_id', [], 100).rows;
const value = (field: string, rid: number) => store.select(`SELECT "${field}" FROM "Invoices" WHERE _fm_record_id = ?`, [rid], 1).rows[0]?.[0];

async function setStatus(account: string, rid: number, data: Record<string, unknown>): Promise<void> {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
  });
  const token = (await login.json()).response.token;
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Invoices/records/${rid}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ fieldData: data }),
  });
  assert.equal(r.status, 200, await r.text());
  await host.automations!.idle(store);
}

test('automations: tried on a copy first, offline, with the change that sets it off', { skip }, async () => {
  const r = await mcp('try_automation', { ...PAID, test: { Status: 'Paid' } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.value.trigger, 'When a record in Invoices is changed, and the change is to Status, if Status = "Paid": run "Mark invoice paid" on that record (from layout Invoices) as Admin');
  const d = r.value.dryRun;
  assert.equal(d.outcome, 'ok', JSON.stringify(d));
  assert.equal(d.conditionTrue, true);
  assert.deepEqual(d.setOff, [`Status: "Open" → "Paid" on record ${ids[0]}`]);
  assert.match(d.changes[0], new RegExp(`^Sets Invoices::PaidDate to "\\d{4}-\\d{2}-\\d{2}" on record ${ids[0]}$`));
  assert.match(d.changes.join('\n'), /Creates a Notes record/);
  assert.match(d.changes.join('\n'), /Notes::Text to "Invoice I1 paid"|Text "Invoice I1 paid"/);
  // The live file wasn't touched: no script, no note, no paid date.
  assert.equal(store.schema.scripts.some((s) => s.name === 'Mark invoice paid'), false);
  assert.deepEqual(notes(), []);
  assert.equal(value('PaidDate', ids[0]), null);
  // A condition that doesn't parse, or a field that isn't there, is refused.
  assert.match((await mcp('try_automation', { ...PAID, condition: 'Status = ' })).text, /condition/);
  assert.match((await mcp('try_automation', { ...PAID, fields: ['Nope'] })).text, /Field "Nope" isn't in Invoices/);
});

test('automations: once saved, any client\'s change sets it off, on the server', { skip }, async () => {
  const saved = await mcp('save_automation', PAID);
  assert.equal(saved.isError, false, saved.text);
  assert.ok(store.schema.scripts.some((s) => s.name === 'Mark invoice paid'));
  // A change to another field, or to a status that isn't Paid, sets nothing off.
  await setStatus('Clerk', ids[0], { Amount: 120 });
  await setStatus('Clerk', ids[0], { Status: 'Sent' });
  assert.deepEqual(notes(), []);
  // Marked paid through the Data API by a clerk: the paid date is set and the customer gets a note.
  await setStatus('Clerk', ids[0], { Status: 'Paid' });
  assert.match(String(value('PaidDate', ids[0])), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(notes(), [['C1', 'Invoice I1 paid']]);
  // As a script on the server changes it too.
  store.update('Invoices', ids[1], { Status: 'Paid' });
  await host.automations!.idle(store);
  assert.deepEqual(notes().at(-1), ['C2', 'Invoice I2 paid']);
  const listed = await mcp('list_automations', {});
  const runs = listed.value.automations[0].runs;
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((x: { outcome: string }) => x.outcome), ['ok', 'ok']);
});

test('automations: an automation\'s own changes set off nothing, so it can\'t loop', { skip }, async () => {
  const r = await mcp('save_automation', {
    name: 'Count changes', layout: 'Invoices', on: 'update',
    scriptText: { name: 'Touch', text: 'Set Field [ Invoices::Touched ; Invoices::Touched + 1 ]\nCommit Records/Requests [ With dialog: Off ]' },
  });
  assert.equal(r.isError, false, r.text);
  await setStatus('Admin', ids[2], { Amount: 5 });
  assert.equal(value('Touched', ids[2]), 1);
  const listed = (await mcp('list_automations', {})).value.automations.find((a: { name: string }) => a.name === 'Count changes');
  assert.equal(listed.runs.length, 1);
  // Turned off, it runs no more.
  await mcp('save_automation', { name: 'Count changes', layout: 'Invoices', on: 'update', script: 'Touch', enabled: false, replace: true });
  await setStatus('Admin', ids[2], { Amount: 6 });
  assert.equal(value('Touched', ids[2]), 1);
  assert.equal((await mcp('delete_automation', { automation: 'Count changes' })).value.deleted, 'Count changes');
});

test('automations: mail and web steps stay off in the dry run, and automations need [Full Access]', { skip }, async () => {
  const r = await mcp('try_automation', {
    name: 'Tell them', layout: 'Invoices', on: 'create',
    scriptText: { name: 'Mail receipt', text: 'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "client@example.com" ; Subject: "Paid" ; Message: "Thanks" ]' },
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.value.dryRun.outbound[0], /^Send Mail \[ Send via SMTP Server .*: not done in the dry run \(error 3\)$/);
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Clerk:pw') }, body: '{}',
  });
  const token = (await login.json()).response.token;
  const denied = await fetch(`${base}/tabularius/automations/v1/databases/Charts`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(denied.status, 403);
});

test('automations: AI steps get no model, even on a server with AI on (AI apps can save automations)', { skip }, async () => {
  const asked: string[] = [];
  host.scriptAi = { refusal: () => undefined, generate: async (r) => (asked.push(r.messages.at(-1)!.content), 'ok') };
  try {
    const script = store.schema.scripts.find((s) => s.name === 'Mark invoice paid')!;
    store.applyDesign([{ op: 'updateScript', script: script.id, steps: [
      { stepId: 212, name: 'Configure AI Account', enabled: true, params: { ai: { accountName: '"a"' } } },
      { stepId: 220, name: 'Generate Response from Model', enabled: true, params: { ai: { accountName: '"a"', model: '"m"', input: 'Invoices::CustomerID' }, variable: '$r' } },
      ...script.steps,
    ] } as never]);
    await setStatus('Clerk', ids[2], { Status: 'Paid' });
    assert.deepEqual(asked, []);
  } finally {
    host.scriptAi = undefined;
  }
});

test('automations: a step that found the record open in another window is a warning, not OK, and names who has it', { skip }, async () => {
  const r = await mcp('save_automation', {
    name: 'Stamp touched', layout: 'Invoices', on: 'update', fields: ['Amount'],
    scriptText: { name: 'Stamp', text: 'Set Field [ Invoices::Touched ; 7 ]\nCommit Records/Requests [ With dialog: Off ]' },
  });
  assert.equal(r.isError, false, r.text);
  const runs = async () => (await mcp('list_automations', {})).value.automations.find((a: { name: string }) => a.name === 'Stamp touched').runs;
  try {
    // Clerk has the record open in a window (a lock held by that session); its own save sets the automation off.
    store.locks.acquire('Invoices', ids[1], 'clerk-window', 'Clerk');
    writer.run({ owner: 'clerk-window', account: 'Clerk' }, () => store.update('Invoices', ids[1], { Amount: 31 }));
    await host.automations!.idle(store);
    assert.notEqual(value('Touched', ids[1]), 7, 'the lock stopped the script from changing the record');
    const [warned] = await runs();
    assert.equal(warned.outcome, 'warning');
    assert.equal(warned.error, 301);
    assert.match(warned.message, /Set Field \[ Invoices::Touched ; 7 \] did not change the record: Record is in use by another user \(Clerk\)/);
    // With the window closed, the same save runs the automation through.
    store.locks.release('Invoices', ids[1], 'clerk-window');
    writer.run({ owner: 'clerk-window', account: 'Clerk' }, () => store.update('Invoices', ids[1], { Amount: 32 }));
    await host.automations!.idle(store);
    assert.equal(value('Touched', ids[1]), 7);
    assert.equal((await runs())[0].outcome, 'ok');
  } finally {
    store.locks.release('Invoices', ids[1], 'clerk-window');
    await mcp('delete_automation', { automation: 'Stamp touched' });
  }
});

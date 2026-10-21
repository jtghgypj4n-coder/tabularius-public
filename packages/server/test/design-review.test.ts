// Pending design changes (design-review.ts): staged by one person, looked over, applied all or some by another.
// Each is described with its text before and after and what a rename or delete would break; one the design would
// refuse says why; one on a thing someone else changed since it was staged is a conflict, left alone until overridden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-review-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.get('Shop')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  store.setPassword('Ann', 'pw', '[Full Access]');
  store.setPassword('Sam', 'pw', '[Full Access]');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function token(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
  });
  return (await r.json() as { response: { token: string } }).response.token;
}

async function call(account: string, method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${base}/tabularius/design/v1/databases/Shop${path}`, {
    method, headers: { authorization: `Bearer ${await token(account)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = { status: r.status, ...(await r.json()) };
  return out;
}

test('staged changes are reviewed with who staged them, a description, the text before and after, and what a rename would break', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const store = host.get('Shop')!;
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Qty', type: 'number' }, { name: 'Price', type: 'number' }, { name: 'Total', kind: 'calculation', calculation: 'Qty * Price' }] },
    { op: 'createScript', name: 'Tidy', text: 'Show Custom Dialog [ "Hi" ]\nBeep' },
  ] as never, { account: 'Ann' });
  const staged = await call('Sam', 'POST', '/pending', { changes: [
    { op: 'updateField', table: 'Orders', field: 'Total', calculation: 'Qty * Price * 1.2' },
    { op: 'updateScript', script: 'Tidy', text: 'Show Custom Dialog [ "Hi" ]\nBeep\nExit Script [ ]' },
    { op: 'updateField', table: 'Orders', field: 'Qty', name: 'Quantity' },
  ] });
  assert.equal(staged.status, 200);
  const [calc, script, rename] = staged.changes;
  assert.equal(calc.by, 'Sam');
  assert.equal(calc.title, 'Change field Orders::Total');
  assert.deepEqual(calc.object, { kind: 'field', label: 'field', name: 'Orders::Total' });
  assert.deepEqual(calc.diffs, [{ label: 'Calculation', before: 'Qty * Price', after: 'Qty * Price * 1.2' }]);
  assert.equal(script.diffs[0].label, 'Script');
  assert.equal(script.diffs[0].after, 'Show Custom Dialog [ "Hi" ]\nBeep\nExit Script');
  assert.equal(rename.title, 'Rename field Orders::Qty to Quantity');
  assert.equal(rename.impact.change, 'rename');
  assert.equal(rename.status, 'ready');
  assert.deepEqual(staged.changes.map((c: { conflicts: unknown[] }) => c.conflicts.length), [0, 0, 0]);
  // Nothing is changed until it is applied.
  assert.equal(store.schema.scripts.find((s) => s.name === 'Tidy')!.steps.length, 2);
  const discarded = await call('Sam', 'POST', '/pending/discard', {});
  assert.equal(discarded.discarded, 3);
  assert.deepEqual(discarded.changes, []);
});

test('a change the design would refuse is blocked with its reason, and leaves the others to apply', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const store = host.get('Shop')!;
  await call('Sam', 'POST', '/pending', { changes: [
    { op: 'createField', table: 'Orders', name: 'Note' },
    { op: 'createField', table: 'Orders', name: 'Note' },
    { op: 'createField', table: 'Nowhere', name: 'X' },
  ] });
  const review = (await call('Sam', 'GET', '/pending')).changes;
  assert.deepEqual(review.map((c: { status: string }) => c.status), ['ready', 'blocked', 'blocked']);
  assert.match(review[1].message, /Note/);
  const r = await call('Ann', 'POST', '/pending/apply', {});
  assert.deepEqual(r.result.applied.map((a: { title: string }) => a.title), ['Add field Orders::Note']);
  assert.equal(r.result.blocked.length, 2);
  assert.equal(r.result.remaining, 2);
  assert.ok(store.schema.tables.find((t) => t.name === 'Orders')!.fields.some((f) => f.name === 'Note'));
  assert.equal(r.changes.length, 2);
  await call('Ann', 'POST', '/pending/discard', {});
});

test('a selection applies in order; a change that needs one left out is blocked, and the rest wait', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const staged = await call('Sam', 'POST', '/pending', { changes: [
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Body' }] },
    { op: 'createField', table: 'Notes', name: 'Author' },
    { op: 'createScript', name: 'Hello', text: 'Beep' },
  ] });
  const [table, field, script] = staged.staged;
  const r = await call('Ann', 'POST', '/pending/apply', { ids: [field, script] });
  assert.deepEqual(r.result.applied.map((a: { id: number }) => a.id), [script]);
  assert.equal(r.result.blocked[0].id, field);
  assert.equal(r.result.remaining, 2);
  const again = await call('Ann', 'POST', '/pending/apply', { ids: [table, field] });
  assert.deepEqual(again.result.applied.map((a: { id: number }) => a.id), [table, field]);
  assert.equal(again.result.remaining, 0);
  assert.ok(host.get('Shop')!.schema.tables.find((t) => t.name === 'Notes')!.fields.some((f) => f.name === 'Author'));
});

test('someone else changing the same thing after it was staged is a conflict, named, and left until overridden', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const store = host.get('Shop')!;
  const staged = await call('Sam', 'POST', '/pending', { changes: [
    { op: 'updateScript', script: 'Tidy', text: 'Beep\nBeep\nBeep' },
    { op: 'createScript', name: 'Elsewhere', text: 'Beep' },
  ] });
  // Ann changes the script after Sam staged his version.
  store.applyDesign([{ op: 'updateScript', script: 'Tidy', text: 'Show Custom Dialog [ "Changed" ]' }] as never, { account: 'Ann' });
  const review = (await call('Sam', 'GET', '/pending')).changes;
  assert.equal(review[0].conflicts.length, 1);
  assert.equal(review[0].conflicts[0].account, 'Ann');
  assert.equal(review[0].conflicts[0].what, 'Change script Tidy');
  assert.equal(review[1].conflicts.length, 0);
  // The review shows the script as it is now as the "before", so the conflict is visible in the diff too.
  assert.ok(review[0].diffs[0].before.includes('Changed'));
  const r = await call('Sam', 'POST', '/pending/apply', {});
  assert.deepEqual(r.result.applied.map((a: { id: number }) => a.id), [staged.staged[1]]);
  assert.equal(r.result.conflicts[0].id, staged.staged[0]);
  assert.equal(r.result.conflicts[0].conflicts[0].account, 'Ann');
  assert.ok(store.schema.scripts.find((s) => s.name === 'Tidy')!.steps.length === 1, 'the script is as Ann left it');
  const forced = await call('Sam', 'POST', '/pending/apply', { overrideConflicts: [staged.staged[0]] });
  assert.equal(forced.result.applied.length, 1);
  assert.equal(store.schema.scripts.find((s) => s.name === 'Tidy')!.steps.length, 3);
});

test('applying some changes does not make the others conflict with them; a table delete conflicts with a change to its field', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const store = host.get('Shop')!;
  const staged = await call('Sam', 'POST', '/pending', { changes: [
    { op: 'updateScript', script: 'Hello', text: 'Beep\nBeep' },
    { op: 'updateScript', script: 'Hello', text: 'Beep\nBeep\nBeep' },
    { op: 'deleteTable', table: 'Notes' },
  ] });
  const first = await call('Sam', 'POST', '/pending/apply', { ids: [staged.staged[0]] });
  assert.equal(first.result.applied.length, 1);
  assert.equal(first.changes[0].conflicts.length, 0, 'what this list applied is not someone else\'s change');
  store.applyDesign([{ op: 'createField', table: 'Notes', name: 'Late' }] as never, { account: 'Ann' });
  const review = (await call('Sam', 'GET', '/pending')).changes;
  assert.equal(review[1].conflicts.length, 1, 'the table was changed under the delete');
  assert.equal(review[1].conflicts[0].what, 'Add field Notes::Late');
  assert.equal(review[1].impact.change, 'delete');
  await call('Sam', 'POST', '/pending/discard', { ids: [staged.staged[2]] });
  const left = (await call('Sam', 'GET', '/pending')).changes;
  assert.equal(left.length, 1);
});

test('staging needs a list of changes, each an object with an op', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const bad = await call('Ann', 'POST', '/pending', { changes: 'no' });
  assert.equal(bad.status, 400);
  const empty = await call('Ann', 'POST', '/pending', { changes: [] });
  assert.equal(empty.status, 400);
  const notOps = await call('Ann', 'POST', '/pending', { changes: [3] });
  assert.equal(notOps.status, 400);
});

test('AR-server-mcp-ai-05 pending review includes cross-file impact only with full access to the contributing file', async () => {
  await call('Ann', 'POST', '/pending/discard', {});
  const store = host.get('Shop')!;
  store.applyDesign([
    { op: 'createTable', name: 'ReviewCustomers', fields: [{ name: 'Name' }] },
  ]);
  const table = store.schema.tables.find((t) => t.name === 'ReviewCustomers')!;
  const field = table.fields.find((f) => f.name === 'Name')!;
  for (const name of ['ReviewPermitted', 'ReviewRestricted', 'ReviewAbsent']) {
    const other = host.create(name);
    other.applyDesign([
      { op: 'createDataSource', name: 'Shop', paths: ['file:Shop'] },
      { op: 'createOccurrence', name: `${name}Reference`, file: 'Shop', externalTable: table.id },
    ]);
    const occurrence = other.schema.tableOccurrences.find((o) => o.name === `${name}Reference`)!;
    other.applyDesign([{ op: 'createLayout', name: `${name}Card`, occurrence: occurrence.id, design: { objects: [
      { id: 1, kind: 'field', type: 1, bounds: { top: 10, left: 10, bottom: 32, right: 200 },
        anchors: { left: true, top: true, right: false, bottom: false }, style: {},
        field: { tableOccurrenceId: occurrence.id, fieldId: field.id, tableOccurrence: occurrence.name,
          field: field.name, display: 'edit', repetitions: 1 } },
    ] } }]);
    other.savePrivilegeSet({
      name: 'ReviewReader', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
    });
    if (name !== 'ReviewAbsent') {
      other.setPassword('Ann', 'pw', name === 'ReviewPermitted' ? '[Full Access]' : 'ReviewReader');
    }
    other.setPassword('Sam', 'pw', 'ReviewReader');
  }

  for (const change of ['rename', 'delete'] as const) {
    const staged = await call('Ann', 'POST', '/pending', { changes: [
      change === 'rename'
        ? { op: 'updateField', table: table.id, field: field.id, name: 'FullName' }
        : { op: 'deleteTable', table: table.id },
    ] });
    const reviews = [
      staged,
      await call('Ann', 'GET', '/pending'),
      await call('Ann', 'POST', '/pending/apply', { ids: [] }),
      await call('Ann', 'POST', '/pending/discard', { ids: [] }),
    ];
    for (const review of reviews) {
      assert.equal(review.status, 200);
      assert.equal(review.changes.length, 1);
      assert.equal(review.changes[0].status, 'ready');
      assert.equal(review.changes[0].impact.change, change);
      assert.ok(review.changes[0].impact.summary.includes(
        `1 other hosted file (ReviewPermitted) reaches into it ${change === 'delete' ? 'and would break' : 'by id and follows the rename'}.`,
      ), `pending review preserves the permitted cross-file warning: ${JSON.stringify(review.changes[0].impact)}`);
      assert.doesNotMatch(JSON.stringify(review), /ReviewRestricted|ReviewAbsent/);
    }
    const restricted = await call('Sam', 'GET', '/pending');
    assert.equal(restricted.status, 200);
    assert.equal(restricted.changes.length, 1);
    assert.doesNotMatch(JSON.stringify(restricted), /ReviewPermitted|ReviewRestricted|ReviewAbsent|other hosted file/);
    assert.equal(store.schema.tables.find((t) => t.id === table.id)!.name, 'ReviewCustomers');
    assert.equal(store.schema.tables.find((t) => t.id === table.id)!.fields.find((f) => f.id === field.id)!.name, 'Name');
    await call('Ann', 'POST', '/pending/discard', {});
  }
});

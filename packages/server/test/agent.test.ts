// Agent mode: a plan of steps the assistant proposed, checked against the file, dry-run on a copy, run one approved
// step at a time as the signed-in account (its privileges apply; scripts offline), and taken back with one Undo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { AgentError, checkPlan, describeStep, MAX_STEPS } from '../src/agent.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let listener: Server;
let hits = 0;
let base: string;
let store: Store;

const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: true, edit: false, create: false, delete: false },
  tables: { Invoices: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' } } },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
};

const ids: Record<string, number> = {};
before(async () => {
  if (skip) return;
  listener = createServer((_req, res) => {
    hits++;
    res.end('reached');
  });
  await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
  const port = (listener.address() as { port: number }).port;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'Note', type: 'text' },
      // A stored calculation and a modification stamp follow by themselves: Undo neither sets nor compares them.
      { name: 'Up', type: 'text', kind: 'calculation', calculation: 'Upper ( Status )' },
      { name: 'Changed', type: 'timestamp', options: { autoEnter: { value: 'modificationTimestamp' } } },
      { name: 'Secret', type: 'text' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Number', type: 'text' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'Order', type: 'text' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'Number', right: 'Order' }], rightDelete: true },
    { op: 'createScript', name: 'Stamp', text: 'Go to Record/Request/Page [ First ]\nLoop\n  Set Field [ Invoices::Note ; "stamped" ]\n  Go to Record/Request/Page [ Next ; Exit after last: On ]\nEnd Loop' },
    { op: 'createScript', name: 'Phone home', text: `Insert from URL [ Invoices::Note ; "http://127.0.0.1:${port}/" ]` },
  ] as never);
  const add = (key: string, Status: string) => (ids[key] = store.create('Invoices', { Number: key, Status }).recordId);
  add('A1', 'Overdue');
  add('A2', 'Overdue');
  add('A3', 'Paid');
  add('V1', 'Void');
  add('V2', 'Void');
  store.create('Orders', { Number: 'O1' });
  store.create('Lines', { Order: 'O1' });
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'pw');
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  listener?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
  });
  return { authorization: `Bearer ${(await r.json()).response.token}`, 'content-type': 'application/json' };
}
const api = async (headers: Record<string, string>, path: string, body?: unknown) => {
  const r = await fetch(`${base}/tabularius/agent/v1/databases/Charts${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json() };
};
const row = (id: number) => store.sql.prepare('SELECT * FROM "Invoices" WHERE _fm_record_id = ?').get(id) as Record<string, unknown> | undefined;
const count = () => (store.sql.prepare('SELECT COUNT(*) AS n FROM "Invoices"').get() as { n: number }).n;

const collections = {
  summary: 'Send overdue invoices to collections',
  layout: 'Invoices',
  steps: [
    { kind: 'find', query: [{ Status: 'Overdue' }], why: 'The overdue ones' },
    { kind: 'set', field: 'status', value: 'Collections' },
    { kind: 'script', script: 'stamp' },
    { kind: 'create', fieldData: { Number: 'C9', Status: 'Collections' } },
  ],
};

test('agent: a plan is checked against the file and the account, with names put right', { skip }, () => {
  const plan = checkPlan(store, collections, undefined);
  assert.equal(plan.steps[1].kind === 'set' && plan.steps[1].field, 'Status');
  assert.equal(plan.steps[2].kind === 'script' && plan.steps[2].script, 'Stamp');
  assert.deepEqual(plan.steps.map(describeStep), [
    'Find records on Invoices: Status Overdue', 'Set Status to "Collections" in every record found',
    'Run the script "Stamp" on the records found', 'Make a record with Number "C9", Status "Collections"',
  ]);
  const bad = (p: unknown, re: RegExp) => assert.throws(() => checkPlan(store, p, undefined), (e: Error) => e instanceof AgentError && re.test(e.message));
  bad({ layout: 'Invoices', steps: [] }, /at least one step/);
  bad({ layout: 'Nowhere', steps: [{ kind: 'delete' }] }, /No layout "Nowhere"/);
  bad({ layout: 'Invoices', steps: [{ kind: 'set', field: 'Colour', value: 'x' }] }, /Step 1: no field "Colour"/);
  bad({ layout: 'Invoices', steps: [{ kind: 'find', query: [{ Colour: 'x' }] }] }, /no field "Colour"/);
  bad({ layout: 'Invoices', steps: [{ kind: 'script', script: 'Format disk' }] }, /no script "Format disk"/);
  bad({ layout: 'Invoices', steps: [{ kind: 'launch' }] }, /a step is find, set/);
  // A field the account can't see is no more there for a plan than for anything else.
  assert.doesNotThrow(() => checkPlan(store, { layout: 'Invoices', steps: [{ kind: 'set', field: 'Secret', value: 'x' }] }, undefined));
  assert.throws(() => checkPlan(store, { layout: 'Invoices', steps: [{ kind: 'set', field: 'Secret', value: 'x' }] }, store.privileges('Clerk')), /no field "Secret"/);
  bad({ layout: 'Invoices', steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ kind: 'delete' })) }, /at most/);
});

test('agent: a dry run does every step on a copy and changes nothing', { skip }, async () => {
  const admin = await login('Admin');
  const before = count();
  const r = await api(admin, '/dry-run', { plan: collections });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.results.map((x: { outcome: string }) => x.outcome), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(r.body.results[0].found, 2);
  assert.equal(r.body.results[1].changed, 2);
  assert.equal(r.body.results[2].changed, 2);
  assert.equal(r.body.results[3].created, 1);
  assert.ok(r.body.results[1].records.records.some((c: { fields: { after: string }[] }) => c.fields.some((f) => f.after === 'Collections')));
  assert.equal(count(), before);
  assert.equal(row(ids.A1)!.Status, 'Overdue');
  assert.equal(row(ids.A1)!.Note, null);
});

test('agent: approved steps run in order for real, and one Undo takes the whole run back', { skip }, async () => {
  const admin = await login('Admin');
  const before = count();
  let state: unknown;
  let run: string | undefined;
  for (let step = 0; step < collections.steps.length; step++) {
    // The same account, elsewhere, between steps: not part of the run.
    if (step === 2) store.update('Invoices', ids.A3, { Note: 'someone else' }, undefined, { account: 'Admin' });
    const r = await api(admin, '/step', { plan: collections, step, ...(state ? { state } : {}), ...(run ? { run } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.result.outcome, 'ok');
    state = r.body.state;
    if (r.body.run) run = r.body.run;
  }
  assert.ok(run);
  assert.equal(row(ids.A1)!.Status, 'Collections');
  assert.equal(row(ids.A1)!.Up, 'COLLECTIONS');
  assert.equal(row(ids.A2)!.Note, 'stamped');
  assert.equal(row(ids.A3)!.Status, 'Paid');
  assert.equal(count(), before + 1);
  // The run is kept as one batch, its summary saying how far it got.
  const u = await api(admin, `/runs/${run}/undo`);
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.skipped, []);
  assert.equal(count(), before);
  assert.equal(row(ids.A1)!.Status, 'Overdue');
  assert.equal(row(ids.A1)!.Up, 'OVERDUE');
  assert.equal(row(ids.A1)!.Note, null);
  assert.equal(row(ids.A2)!.Status, 'Overdue');
  // What someone else did meanwhile stays.
  assert.equal(row(ids.A3)!.Note, 'someone else');
  assert.equal((await api(admin, `/runs/${run}/undo`)).status, 400);
});

test('agent: deleted records come back with Undo', { skip }, async () => {
  const admin = await login('Admin');
  const plan = { summary: 'Clear out void invoices', layout: 'Invoices', steps: [{ kind: 'find', query: [{ Status: 'Void' }] }, { kind: 'delete' }] };
  const one = await api(admin, '/step', { plan, step: 0 });
  const two = await api(admin, '/step', { plan, step: 1, state: one.body.state });
  assert.equal(two.body.result.deleted, 2);
  assert.equal(row(ids.V1), undefined);
  const u = await api(admin, `/runs/${two.body.run}/undo`);
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(row(ids.V1)!.Status, 'Void');
  assert.equal(row(ids.V2)!.Number, 'V2');
});

test('agent: a record made in a run and changed by a later step goes with Undo', { skip }, async (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  const admin = await login('Admin');
  const before = count();
  const plan = { summary: 'Make and mark', layout: 'Invoices', steps: [{ kind: 'find', query: [{ Number: 'zzz' }] }, { kind: 'create', fieldData: { Number: 'N1', Status: 'New' } }, { kind: 'set', field: 'Status', value: 'Sent' }] };
  let state: unknown;
  let run: string | undefined;
  for (let step = 0; step < plan.steps.length; step++) {
    t.mock.timers.setTime(now + (step + 1) * 1100); // so the modification stamp moves
    const r = await api(admin, '/step', { plan, step, ...(state ? { state } : {}), ...(run ? { run } : {}) });
    assert.equal(r.body.result.outcome, 'ok', JSON.stringify(r.body));
    state = r.body.state;
    run = r.body.run ?? run;
  }
  assert.equal(count(), before + 1);
  const u = await api(admin, `/runs/${run}/undo`);
  assert.deepEqual(u.body, { undone: 2, skipped: [] });
  assert.equal(count(), before);
});

test('agent: a delete that would take related records with it is refused, with nothing deleted', { skip }, async () => {
  const admin = await login('Admin');
  const plan = { summary: 'Clear orders', layout: 'Orders', steps: [{ kind: 'delete' }] };
  const r = await api(admin, '/step', { plan, step: 0 });
  assert.equal(r.body.result.outcome, 'error');
  assert.match(r.body.result.message, /also deletes related records/);
  assert.equal((store.sql.prepare('SELECT COUNT(*) AS n FROM "Lines"').get() as { n: number }).n, 1);
});

test('agent: steps run with the account\'s privileges, and a run is the account\'s own', { skip }, async () => {
  const admin = await login('Admin');
  const clerkH = await login('Clerk');
  const r = await api(clerkH, '/step', { plan: collections, step: 1, state: { layout: 'Invoices', foundSet: [ids.A1, ids.A2] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.outcome, 'error');
  assert.equal(r.body.run, undefined);
  assert.equal(row(ids.A1)!.Status, 'Overdue');
  // Another account's run can't be added to.
  const mine = await api(admin, '/step', { plan: collections, step: 1, state: { layout: 'Invoices', foundSet: [ids.A3] } });
  assert.ok(mine.body.run);
  const theirs = await api(clerkH, '/step', { plan: collections, step: 2, state: { layout: 'Invoices', foundSet: [] }, run: mine.body.run });
  assert.equal(theirs.status, 400);
  assert.match(theirs.body.error.message, /No such run/);
  // Nor undone by it.
  const steal = await api(clerkH, `/runs/${mine.body.run}/undo`);
  assert.equal(steal.status, 400);
  assert.match(steal.body.error.message, /Only the account that made these changes/);
  assert.equal(row(ids.A3)!.Status, 'Collections');
  assert.equal((await api(admin, `/runs/${mine.body.run}/undo`)).status, 200);
  assert.equal(row(ids.A3)!.Status, 'Paid');
  // Without a session, nothing.
  assert.equal((await api({ 'content-type': 'application/json' }, '/dry-run', { plan: collections })).status, 401);
});

test('agent: scripts run offline', { skip }, async () => {
  const admin = await login('Admin');
  const plan = { summary: 'Check in', layout: 'Invoices', steps: [{ kind: 'find', query: [{ Number: 'A3' }] }, { kind: 'script', script: 'Phone home' }] };
  const dry = await api(admin, '/dry-run', { plan });
  assert.equal(dry.status, 200);
  const one = await api(admin, '/step', { plan, step: 0 });
  const two = await api(admin, '/step', { plan, step: 1, state: one.body.state });
  // Insert from URL is refused (error 3, command unavailable), on the copy and for real.
  assert.equal(dry.body.results[1].outcome, 'error');
  assert.match(two.body.result.message, /error 3/);
  assert.equal(hits, 0);
  assert.notEqual(row(ids.A3)!.Note, 'reached');
});

test('agent: nothing runs when AI is off for the file', { skip }, async () => {
  const admin = await login('Admin');
  store.setAiAllowed(false);
  try {
    const r = await api(admin, '/dry-run', { plan: collections });
    assert.equal(r.status, 403);
    assert.match(r.body.error.message, /AI is turned off/);
  } finally {
    store.setAiAllowed(true);
  }
});

test('agent: a plan far too large is refused with 413, and the server carries on', { skip }, async () => {
  const headers = await login('Admin');
  const r = await fetch(`${base}/tabularius/agent/v1/databases/Charts/dry-run`, { method: 'POST', headers, body: JSON.stringify({ plan: { summary: 'x'.repeat(20 * 1024 * 1024) } }) });
  assert.equal(r.status, 413);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/sign-in-info`)).status, 200);
});

// Time travel in the script debugger: a run recorded on a scratch copy, step by step, to step back and forth
// through afterwards; each step's variables, found set and what it did to records, Set Field edits included.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, type Host } from '../src/index.ts';
import { RECORD_STEPS } from '../../scripts/src/index.ts';
import type { PrivilegeDefinition } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-time-travel-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  const store = host.create('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }] },
    { op: 'createScript', name: 'Tidy', text: [
      'Set Variable [ $n ; Value: 0 ]',
      'Set Variable [ $$seen ; Value: "yes" ]',
      'Go to Record/Request/Page [ First ]',
      'Loop',
      'Set Field [ Items::Status ; "done" & $n ]',
      'Set Variable [ $n ; Value: $n + 1 ]',
      'Go to Record/Request/Page [ Next ; Exit after last: On ]',
      'End Loop',
      'New Record/Request',
      'Set Field [ Items::Name ; "added" ]',
      'Commit Records/Requests [ With dialog: Off ]',
      'Exit Script [ Text Result: Get ( FoundCount ) ]',
    ].join('\n') },
    { op: 'createScript', name: 'Forever', text: 'Loop\nSet Variable [ $i ; Value: $i + 1 ]\nEnd Loop' },
  ]);
  for (const n of ['a', 'b']) store.create('Items', { Name: n, Status: 'open' });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'] } as PrivilegeDefinition);
  store.setPassword('Reader', 'pw', 'Reader');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  const body = await r.json();
  return { authorization: `Bearer ${body.response.token}`, 'content-type': 'application/json' };
}
const record = (auth: Record<string, string>, body: unknown) =>
  fetch(`${base}/tabularius/debug/v1/databases/Shop/recordings`, { method: 'POST', headers: auth, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

test('a recorded run has each step\'s state before it and what it did, and the hosted file is untouched', async () => {
  const admin = await login('Admin');
  const r = await record(admin, { script: 'Tidy', layout: 'Items' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const steps = r.body.steps as { index: number; line: string; foundCount: number; recordId?: number; variables?: { locals: Record<string, string>; globals: Record<string, string> };
    edits?: { table: string; recordId?: number; field: string; value: string }[]; changes?: { table: string; recordId: number; kind: string; fields: { field: string; before: string; after: string }[] }[] }[];
  assert.equal(r.body.done.result, '3');
  assert.equal(steps.length, r.body.done.steps);

  // The Set Field steps are where Status changed (before the record was saved), each on its record, in order.
  const sets = steps.filter((s) => s.edits?.some((e) => e.field === 'Status'));
  assert.deepEqual(sets.map((s) => s.edits!.map((e) => [e.recordId, e.value])[0]), [[1, 'done0'], [2, 'done1']]);
  assert.ok(sets.every((s) => s.line.startsWith('Set Field')));
  // Saving shows on the step that left the record, with the value before and after.
  const saved = steps.find((s) => s.changes?.some((c) => c.recordId === 1))!;
  assert.match(saved.line, /^Go to Record/);
  assert.deepEqual(saved.changes![0].fields, [{ field: 'Status', before: 'open', after: 'done0' }]);
  const created = steps.find((s) => s.changes?.some((c) => c.kind === 'create'))!;
  assert.match(created.line, /^New Record/);

  // Before each step: its variables (left out when unchanged) and found set.
  assert.equal(steps[0].variables!.locals.$n, undefined);
  assert.equal(steps[1].variables!.locals.$n, '0');
  assert.equal(steps[2].variables!.globals.$$seen, 'yes');
  assert.equal(steps[3].variables, undefined);
  assert.equal(steps.at(-1)!.foundCount, 3);

  // It ran on a copy: the hosted records are as they were, and the session's globals didn't change.
  const store = host.get('Shop')!;
  assert.deepEqual(store.query('SELECT Status FROM Items ORDER BY _fm_record_id').map((x) => x.Status), ['open', 'open']);
  const g = await fetch(`${base}/tabularius/debug/v1/databases/Shop/current?layout=Items`, { headers: admin }).then((x) => x.json());
  assert.equal(g.variables.$$seen, undefined);
});

test('a run that never ends stops at the recording limit and says so', async () => {
  const r = await record(await login('Admin'), { script: 'Forever', layout: 'Items' });
  assert.equal(r.status, 200);
  assert.equal(r.body.stopped, true);
  assert.ok(r.body.steps.length <= RECORD_STEPS);
});

test('only full access can record a run', async () => {
  const r = await record(await login('Reader'), { script: 'Tidy', layout: 'Items' });
  assert.equal(r.status, 403);
});

test('recording a script that is not there is a bad request, not a server error', async () => {
  const admin = await login('Admin');
  for (const body of [{ layout: 'Items' }, { script: 'No such script', layout: 'Items' }]) {
    const r = await record(admin, body);
    assert.equal(r.status, 400, JSON.stringify(r.body));
  }
});

// Automations on deleted records: the script runs on the server whoever deleted it, given the record as JSON
// (only the fields the run-as account can see); its own deletes set off nothing; it can be tried on a copy
// first. A capture-only file never has automations, saved or run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setCaptureOnlyDefaults } from '../../scripts/src/index.ts';
import { serve, type Host } from '../src/index.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let server: Server;
let base: string;
let host: Host;
let shop: Store;

const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: true, edit: true, create: true, delete: true },
  tables: { Items: { view: true, edit: true, create: true, delete: true, fields: { Secret: 'none' } } },
  layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
};

const NOTE = [
  'Set Variable [ $p ; Value: Get ( ScriptParameter ) ]',
  'Go to Layout [ "Log" ]',
  'New Record/Request',
  'Set Field [ Log::Text ; JSONGetElement ( $p ; "fields.Name" ) & "|" & JSONGetElement ( $p ; "recordId" ) & "|" & JSONGetElement ( $p ; "fields.Secret" ) & "|" & Get ( FoundCount ) ]',
  'Commit Records/Requests [ With dialog: Off ]',
  // Deleting another record from the automation's own script sets nothing off: no loops.
  'Go to Layout [ "Items" ]',
  'Show All Records',
  'Go to Record/Request/Page [ First ]',
  'Delete Record/Request [ With dialog: Off ]',
].join('\n');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-automation-deletes-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  for (const name of ['Shop', 'Held_Sample']) {
    const store = host.create(name);
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Secret' }] },
      { op: 'createTable', name: 'Log', fields: [{ name: 'Text' }] },
      { op: 'createScript', name: 'Note it', text: NOTE },
    ]);
    store.setPassword('Admin', 'pw');
    store.savePrivilegeSet(clerk);
    store.setPassword('Clerk', 'pw', 'Clerk');
    for (const n of ['a', 'b', 'c', 'd']) store.create('Items', { Name: n, Secret: `s-${n}` });
  }
  shop = host.get('Shop')!;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(db: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}' });
  return { authorization: `Bearer ${(await r.json()).response.token}` };
}
const call = async (db: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/tabularius/automations/v1/databases/${db}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(await login(db)) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
const log = () => shop.query('SELECT Text FROM Log ORDER BY _fm_record_id').map((r) => (r as { Text: string }).Text);
const names = () => shop.query('SELECT Name FROM Items ORDER BY _fm_record_id').map((r) => (r as { Name: string }).Name);

test('a deleted record sets off its automation, with the record as JSON; the script\'s own deletes don\'t', async () => {
  const spec = { name: 'Note deletions', layout: 'Items', on: 'delete', script: 'Note it', account: 'Clerk' };
  const refused = await call('Shop', '', { automation: { ...spec, condition: 'Name = "a"' } });
  assert.equal(refused.status, 400);
  assert.match(JSON.stringify(refused.body), /deleted record as JSON/);

  // Tried on a copy first: the hosted file is untouched.
  const tried = await call('Shop', '?dryRun=1', { automation: spec });
  assert.equal(tried.status, 200, JSON.stringify(tried.body));
  assert.equal(tried.body.dryRun.outcome, 'ok', JSON.stringify(tried.body.dryRun));
  assert.match(tried.body.trigger, /is deleted/);
  assert.ok(tried.body.dryRun.changes.some((c: string) => /Sets Log::Text to "a\|1\|\|1"/.test(c)), JSON.stringify(tried.body.dryRun.changes));
  assert.deepEqual(log(), []);
  assert.deepEqual(names(), ['a', 'b', 'c', 'd']);

  const saved = await call('Shop', '', { automation: spec });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  shop.delete('Items', 3, { account: 'Admin' });
  await host.automations!.idle(shop);
  // Name and record id given; Secret left out (Clerk can't see it).
  assert.deepEqual(log(), ['c|3||1']);
  // The script deleted record 1 too, and that set off nothing more.
  assert.deepEqual(names(), ['b', 'd']);
  const runs = (await call('Shop', '')).body.automations[0].runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'ok');
});

test('a capture-only file never has automations', async () => {
  const spec = { name: 'x', layout: 'Items', on: 'delete', script: 'Note it', account: 'Admin' };
  for (const path of ['', '?dryRun=1']) {
    const r = await call('Held_Sample', path, { automation: spec });
    assert.equal(r.status, 400, path);
    assert.match(JSON.stringify(r.body), /capture-only/);
  }
});

test('a delete that a script reverts sets nothing off', async () => {
  shop.applyDesign([{ op: 'createScript', name: 'Undo delete', text: 'Open Transaction\nGo to Layout [ "Items" ]\nShow All Records\nDelete Record/Request [ With dialog: Off ]\nRevert Transaction\nCommit Transaction' }]);
  const before = log().length;
  const left = names();
  const { runScript } = await import('../../scripts/src/index.ts');
  const r = await runScript(shop, 'Undo delete', { account: 'Admin' });
  assert.equal(r.error, 0);
  await host.automations!.idle(shop);
  assert.deepEqual(names(), left, 'the delete was reverted');
  assert.equal(log().length, before, 'and the automation didn\'t run');
  const runs = (await call('Shop', '')).body.automations[0].runs;
  assert.match(runs[0].message ?? '', /undone/);
});

test('a file the server names as a capture-only can\'t save automations either', async () => {
  const { saveAutomation } = await import('../src/automations.ts');
  const spec = { name: 'x', layout: 'Items', on: 'delete', script: 'Note it', account: 'Admin' };
  assert.throws(() => saveAutomation(shop, spec, 'Admin', ['Sho']), /capture-only/);
});

// Masking in workflows that read or move records on an account's behalf: the assistant's plan steps (what a run
// reports changing), data cleanup merges (the keys they move related records by), and "ask about this record"
// (related records). A masked field's value is in none of what they return.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../../store/src/index.ts';
import type { TablePrivileges } from '../../store/src/index.ts';
import { checkPlan, runApprovedStep } from '../src/agent.ts';
import { applyCleanup, CleanupError } from '../src/cleanup.ts';
import { describeRecord } from '../src/record-context.ts';
import { deletedFields } from '../src/automations.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

const all: TablePrivileges = { view: true, edit: true, create: true, delete: true };
const common = { layouts: 'modifiable' as const, valueLists: 'viewOnly' as const, scripts: 'viewOnly' as const, extendedPrivileges: [] };
const open = { view: true, edit: true, create: true, delete: true };

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mask-flows-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  store.savePrivilegeSet({ name: 'NameMasked', records: all, ...common, tables: { Congress: { ...open, fields: { Name: 'masked' } } } });
  store.setPassword('maria', 'pw-maria-1234', 'NameMasked');
  // Customers' key is masked; the control set reads it.
  store.savePrivilegeSet({ name: 'KeyMasked', records: all, ...common, tables: { 'NW Customers': { ...open, fields: { Customer: 'masked' } } } });
  store.setPassword('kim', 'pw-kim-12345', 'KeyMasked');
  store.savePrivilegeSet({ name: 'KeyOpen', records: all, ...common });
  store.setPassword('olga', 'pw-olga-1234', 'KeyOpen');
  // A related table's field is masked.
  store.savePrivilegeSet({ name: 'RelatedMasked', records: all, ...common, tables: { 'NW SalespersonCustomers': { ...open, fields: { Salesperson: 'masked' } } } });
  store.setPassword('rae', 'pw-rae-12345', 'RelatedMasked');
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

test('what a plan\'s delete step reports leaves out the masked field of the record it deleted', { skip }, async () => {
  const p = store.privileges('maria');
  const id = Number(store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Name = 'Jo Bonner'`)[0].id);
  const plan = checkPlan(store, { layout: 'Congress', summary: 'Remove one', steps: [{ kind: 'find', query: [{ State: 'Alabama', District: '1', Chamber: 'House' }] }, { kind: 'delete' }] }, p);
  const who = { account: 'maria', privileges: p };
  const found = await runApprovedStep(store, plan, 0, undefined, undefined, who);
  assert.deepEqual(found.state.foundSet, [id]);
  const done = await runApprovedStep(store, plan, 1, found.state, found.run, who);
  assert.equal(done.result.outcome, 'ok', done.result.message);
  assert.equal(done.result.deleted, 1);
  const fields = done.result.records!.records[0].fields;
  assert.ok(fields.some((f) => f.field === 'State' && f.before === 'Alabama'), 'the fields it may read are reported');
  assert.ok(!fields.some((f) => f.field === 'Name'), 'the masked one is not');
  assert.ok(!JSON.stringify(done.result).includes('Bonner'));
  assert.equal(store.query(`SELECT count(*) AS n FROM Congress WHERE _fm_record_id = ${id}`)[0].n, 0, 'and it is gone');
});

test('a cleanup merge moves related records only by a key the account can read', { skip }, () => {
  const ids = (name: string) => Number(store.query(`SELECT _fm_record_id AS id FROM "NW Customers" WHERE Customer = '${name}'`)[0].id);
  const keep = ids('Save-a-lot Markets');
  const remove = ids('Wartian Herkku');
  const merge = { layout: 'NW Customers', dryRun: true as const, merges: [{ keep, remove: [remove] }] };
  // The control reads the key, and sees the values it would move.
  const ok = applyCleanup(store, merge, { account: 'olga', privileges: store.privileges('olga') });
  assert.ok(ok.changes.length > 0 && ok.changes.some((c) => 'from' in c && c.from === 'Wartian Herkku'), 'the preview names the key values');
  // With the key masked it would print them: it is refused, with the field's name only.
  assert.throws(() => applyCleanup(store, merge, { account: 'kim', privileges: store.privileges('kim') }), (e) => {
    assert.ok(e instanceof CleanupError);
    assert.match(e.message, /NW Customers::Customer/);
    assert.ok(!/Wartian|Save-a-lot/.test(e.message));
    return true;
  });
});

test('"ask about this record" shows a related record\'s masked field as its stand-in', { skip }, () => {
  const id = Number(store.query(`SELECT _fm_record_id AS id FROM "NW Customers" WHERE Customer = 'Save-a-lot Markets'`)[0].id);
  const names = store.query('SELECT DISTINCT Salesperson AS s FROM "NW SalespersonCustomers"').map((r) => String(r.s)).filter((n) => n.includes(' '));
  const ctx = describeRecord(store, 'NW Customers', id, { privileges: store.privileges('rae'), limit: 20 });
  const group = ctx.related.find((g) => g.table === 'NW SalespersonCustomers')!;
  assert.ok(group.records.length > 0);
  for (const r of group.records) {
    assert.ok(String(r.fields.Salesperson).includes('•'), 'a stand-in');
    assert.ok(r.fields.Customer, 'the open fields are there');
  }
  const text = JSON.stringify(ctx);
  assert.deepEqual(names.filter((n) => text.includes(n)), [], 'no real salesperson name');
  // The control set sees them.
  assert.ok(names.some((n) => JSON.stringify(describeRecord(store, 'NW Customers', id, { privileges: store.privileges('olga'), limit: 20 })).includes(n)));
});

test('a delete automation\'s parameter leaves out a masked field of the deleted record', { skip }, () => {
  const values = { Name: 'Jo Bonner', State: 'Alabama' };
  assert.deepEqual(deletedFields(values, 'Congress', store.privileges('maria')), { State: 'Alabama' });
  assert.deepEqual(deletedFields(values, 'Congress'), values, 'full access gets them all');
});

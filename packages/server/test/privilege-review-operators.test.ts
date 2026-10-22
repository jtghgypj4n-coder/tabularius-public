// A calculation that reads a hidden table after `and`, `or` or `not` still counts as reading it: the table occurrence
// is found as the longest end of the words before the `::` that is one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { reviewPrivileges } from '../src/privilege-review.ts';

test('the calc-reads-hidden check sees a hidden table named after and, or, not or a number', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tab-privrev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => store.close());
  const calcs: Record<string, string> = {
    Plain: '1 + Secrets::Amount',
    AndRead: 'Name = "x" and Secrets::Amount > 0',
    OrRead: 'Name = "x" or Secrets::Amount > 0',
    NotRead: 'not Secrets::Amount',
    NumberAnd: '0 and Payments::Amount',
    Spaced: 'Name = "x" and Terms and Conditions::Amount > 0',
    Own: 'Name = "x" and Customers::Name',
  };
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Secrets', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'Payments', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'Terms and Conditions', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Secrets', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Payments', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Terms and Conditions', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    ...Object.entries(calcs).map(([name, calculation]) => ({ op: 'createField', table: 'Customers', name, type: 'number', kind: 'calculation', calculation, options: { unstored: true } })),
  ] as never);
  const none = { view: false, edit: false, create: false, delete: false };
  store.savePrivilegeSet({
    name: 'Sales', records: none, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
    tables: { Customers: { view: true, edit: false, create: false, delete: false } },
  } as never);
  const found = reviewPrivileges(store).findings.filter((f) => f.kind === 'calc-reads-hidden').map((f) => f.field).sort();
  assert.deepEqual(found, ['AndRead', 'NotRead', 'NumberAnd', 'OrRead', 'Plain', 'Spaced']);
});

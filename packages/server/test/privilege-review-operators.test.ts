// A calculation that reads a table the privilege set can't view is found by what the calculation engine reads, not by
// a pattern over the text: after `and`, `or` or `not`, in a long table name, past a quote mark in a comment, beside a
// table named like an expression, and by the functions that read anything (Evaluate, GetField, ExecuteSQL).
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
    LongName: 'Name = "x" and A B C D E F G H I J::Amount > 0',
    Decoy: '1 and Secrets::Amount',
    Comment: '/* 5" */ Secrets::Amount',
    InText: 'Name & "Secrets::Amount"',
    Eval: 'Evaluate ( "Secrets::Amount" )',
    GetF: 'GetField ( "Secrets::Amount" )',
    Sql: 'ExecuteSQL ( "SELECT Amount FROM Secrets" ; "" ; "" )',
    Dollar: 'Let ( x = "1" ; x & Secrets::Amount )',
    // A calculation that uses a calculation the set can't see (Inner reads Secrets), directly and through another.
    Inner: 'Secrets::Amount',
    Chain: 'Inner + 0',
    Chain2: 'Chain * 2',
    // A custom function that calls Evaluate, one that reads a table, and one that calls another.
    ViaEval: 'EvalOf ( "Secrets::Amount" )',
    ViaDeep: 'Wrapper ( 1 )',
    Loop: 'LoopA ( 1 )',
    Harmless: 'Double ( Id )',
  };
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Secrets', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'Payments', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'Terms and Conditions', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createTable', name: 'A B C D E F G H I J', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    // Visible, and named so that a pattern over the text mistakes `1 and Secrets::Amount` for a read of it.
    { op: 'createTable', name: '1 and Secrets', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Amount', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Secrets', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Payments', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Terms and Conditions', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Customers', right: 'A B C D E F G H I J', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createRelationship', left: 'Customers', right: '1 and Secrets', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createCustomFunction', name: 'EvalOf', parameters: ['x'], formula: 'Evaluate ( x )' },
    { op: 'createCustomFunction', name: 'Wrapper', parameters: ['x'], formula: 'EvalOf ( "Secrets::Amount" ) + x' },
    { op: 'createCustomFunction', name: 'LoopA', parameters: ['x'], formula: 'LoopB ( x )' },
    { op: 'createCustomFunction', name: 'LoopB', parameters: ['x'], formula: 'LoopA ( x )' },
    { op: 'createCustomFunction', name: 'Double', parameters: ['n'], formula: 'n * 2' },
    ...Object.entries(calcs).map(([name, calculation]) => ({ op: 'createField', table: 'Customers', name, type: 'number', kind: 'calculation', calculation, options: { unstored: true } })),
  ] as never);
  const none = { view: false, edit: false, create: false, delete: false };
  store.savePrivilegeSet({
    name: 'Sales', records: none, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
    tables: {
      Customers: { view: true, edit: false, create: false, delete: false },
      '1 and Secrets': { view: true, edit: false, create: false, delete: false },
    },
  } as never);
  const found = reviewPrivileges(store).findings.filter((f) => f.kind === 'calc-reads-hidden').map((f) => f.field).sort();
  // Own reads its own table; InText only has the words in a text; Dollar's `x & Secrets::Amount` reads Secrets.
  assert.deepEqual(found, ['AndRead', 'Chain', 'Chain2', 'Comment', 'Decoy', 'Dollar', 'Eval', 'GetF', 'Inner', 'LongName', 'NotRead', 'NumberAnd', 'OrRead', 'Plain', 'Spaced', 'Sql', 'ViaDeep', 'ViaEval']);
});

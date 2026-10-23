// Explain This Value runs a stored calculation again to show its steps. Under an account's privileges it must show nothing the account
// may not read: not a hidden or masked field of the record itself, and not another record the view rule hides.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, explainField, Store, type Privileges } from '../src/index.ts';

const KEYS = { layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] } as const;
// Each gives a length, so the stored value of the calculation (which the account may read, as it may any visible field) holds no secret.
const OWN: Record<string, string> = {
  Len: 'Length ( Secret )', Lookup: 'Length ( Lookup ( Secret ) )', Nth: 'Length ( GetNthRecord ( Secret ; 1 ) )', Let: 'Let ( [ v = Secret ] ; Length ( v ) )',
  Left: 'Length ( Left ( Secret ; 3 ) )', Upper: 'Length ( Upper ( Secret ) )', GetField: 'Length ( GetField ( "Secret" ) )', Evaluate: 'Length ( Evaluate ( "Secret" ) )',
  List: 'Length ( List ( Secret ; Title ) )', Qualified: 'Length ( Orders::Secret )',
};
const OTHERS: Record<string, string> = {
  SelfJoin: 'Length ( Self::Secret )', Last: 'Length ( Last ( Self::Secret ) )', Sql: 'Length ( ExecuteSQL ( "SELECT Secret FROM Orders WHERE Id = 2" ; "" ; "" ) )',
  ListAll: 'Length ( List ( Self::Secret ) )',
};

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-explain-privileges-'));
  createStore(join(dir, 'Shop.sqlite'));
  const store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'Title' }, { name: 'Secret' }] },
    { op: 'createOccurrence', name: 'Self', table: 'Orders' },
    { op: 'createRelationship', left: 'Orders', right: 'Self', predicates: [{ left: 'Title', right: 'Title' }] },
    ...Object.entries({ ...OWN, ...OTHERS }).map(([name, calculation]) => ({ op: 'createField', table: 'Orders', name: `C${name}`, kind: 'calculation', type: 'text', calculation })),
    { op: 'createField', table: 'Orders', name: 'CPlain', kind: 'calculation', type: 'text', calculation: 'Length ( Title )' },
    { op: 'createField', table: 'Orders', name: 'CMid', kind: 'calculation', type: 'number', calculation: 'Length ( Secret )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'CTop', kind: 'calculation', type: 'number', calculation: 'CMid + 1' },
    { op: 'createTable', name: 'Cust', fields: [{ name: 'Name' }, { name: 'S2' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Cust', predicates: [{ left: 'Title', right: 'Name' }] },
    { op: 'createCustomFunction', name: 'Peek', parameters: ['x'], formula: 'Evaluate ( x )' },
    { op: 'createField', table: 'Orders', name: 'CRel', kind: 'calculation', type: 'text', calculation: 'Length ( Cust::S2 )' },
    { op: 'createField', table: 'Orders', name: 'CCount', kind: 'calculation', type: 'text', calculation: 'Count ( Cust::S2 )' },
    { op: 'createField', table: 'Orders', name: 'CCf', kind: 'calculation', type: 'text', calculation: 'Length ( Peek ( "Secret" ) )' },
    { op: 'createField', table: 'Orders', name: 'CSql2', kind: 'calculation', type: 'text', calculation: 'Length ( ExecuteSQL ( "SELECT Secret FROM Orders" ; "" ; "" ) )' },
    { op: 'createField', table: 'Orders', name: 'Num', type: 'number' },
    { op: 'createField', table: 'Orders', name: 'Tot', kind: 'summary', summary: { type: 'total', field: 'Num' } },
    { op: 'createField', table: 'Orders', name: 'CSum', kind: 'calculation', type: 'text', calculation: 'Tot + 1' },
    { op: 'createField', table: 'Orders', name: 'CMidEval', kind: 'calculation', type: 'number', calculation: 'Length ( Evaluate ( "Secret" ) )' },
    { op: 'createField', table: 'Orders', name: 'CTopEval', kind: 'calculation', type: 'text', calculation: 'CMidEval + 1' },
    { op: 'createField', table: 'Orders', name: 'G', type: 'number', options: { global: true } },
    { op: 'createField', table: 'Orders', name: 'CSteer', kind: 'calculation', type: 'text', calculation: 'If ( Num > G ; "hi" ; "lo" )' },
    { op: 'createField', table: 'Orders', name: 'CUnstored', kind: 'calculation', type: 'text', calculation: 'Length ( Secret )', options: { unstored: true } },
  ] as never);
  const first = store.create('Orders', { Id: '1', Title: 'grp', Secret: 'SENTINEL-R1-ABCDEFGH' }).recordId;
  store.create('Orders', { Id: '2', Title: 'grp', Secret: 'SENTINEL-R2-ABCDEFGH' });
  store.create('Cust', { Name: 'grp', S2: 'SENTINEL-S2-ABCDEFGH' });
  const account = (name: string, records: object, fields: object = {}, tables: object = {}) => {
    store.savePrivilegeSet({ name, records: { view: true, edit: false, create: false, delete: false, fields }, tables: { Orders: { ...records, edit: false, create: false, delete: false, fields }, ...tables }, ...KEYS } as never);
    return store.privilegesForSet(name);
  };
  const explained = (name: string, pv?: Privileges) => {
    const table = store.schema.tables.find((x) => x.name === 'Orders')!;
    const rec = { store, table, row: store.row(store.layout('Orders'), first) };
    return explainField(store, table, table.fields.find((f) => f.name === `C${name}`)!, rec, pv ? { privileges: pv, account: pv.account } : {});
  };
  const explain = (name: string, pv?: Privileges) => JSON.stringify(explained(name, pv));
  return { store, account, explain, explained };
}

for (const [label, kind] of [['hidden', 'none'], ['masked', 'masked']] as const) {
  test(`explain shows nothing of a ${label} field of the record itself, in steps, result or references`, (t) => {
    const { account, explain, explained } = setup(t);
    const pv = account(`Own-${kind}`, { view: true }, { Secret: kind });
    for (const name of Object.keys(OWN)) {
      assert.match(explain(name), /SENTINEL-R1/, `control: ${name} shows the field to an account with no limits`);
      assert.doesNotMatch(explain(name, pv), /SENTINEL/, name);
      // The stored value stands as the result, with a note that the steps are worked out without the fields it may not read, and no
      // verdict on whether it is still current (that yes or no would depend on the hidden field).
      const e = explained(name, pv);
      assert.equal(e.result, e.value, `${name}: the result is the stored value`);
      assert.match((e.notes ?? []).join(' '), /hidden from you/, name);
      assert.equal(e.matchesStored, undefined, name);
      assert.equal(e.notEvaluated, undefined, `${name}: a hidden field is not said to be empty`);
    }
  });

  test(`explain of a calculation that reads no ${label} field is shown in full, though the table has one`, (t) => {
    const { account, explain, explained } = setup(t);
    const pv = account(`Plain-${kind}`, { view: true }, { Secret: kind });
    const e = explained('Plain', pv);
    assert.doesNotMatch(explain('Plain', pv), /SENTINEL/);
    assert.equal(e.result, '3');
    assert.equal(e.matchesStored, true);
    assert.equal(e.notes, undefined);
    assert.ok(e.steps?.steps?.length, 'its steps are shown');
  });

  test(`explain of an unstored calculation over a ${label} field is worked out under the privileges, with no stored value to stand in`, (t) => {
    const { account, explain, explained } = setup(t);
    const pv = account(`Unstored-${kind}`, { view: true }, { Secret: kind });
    assert.match(explain('Unstored'), /SENTINEL-R1/, 'control: with no limits the step shows the field');
    assert.doesNotMatch(explain('Unstored', pv), /SENTINEL/);
    const e = explained('Unstored', pv);
    assert.equal(e.result, '0', 'a field the account may not read counts as empty');
    assert.equal(e.notes, undefined, 'nothing stands in for it, so there is nothing to note');
    assert.equal(e.matchesStored, undefined);
  });
}

test('explain shows nothing of the records the account\'s view rule hides, in steps, result or references', (t) => {
  const { account, explain } = setup(t);
  const pv = account('Row-rule', { view: 'Id = 1' });
  for (const name of Object.keys(OTHERS)) {
    assert.doesNotMatch(explain(name, pv), /SENTINEL-R2/, name);
    assert.match(explain(name), /\b20\b|SENTINEL-R2/, `control: ${name} reaches the other record when there are no limits`);
  }
});

test('the verdict on a calculation over a hidden field cannot be steered to find the field, whatever the account changes', (t) => {
  const { store, account, explained } = setup(t);
  // Num is hidden; CSteer was stored "hi" when Num was 37. G is a global the account may set to any guess.
  const row = store.sql.prepare('SELECT _fm_record_id AS id FROM Orders WHERE Id = 1').get() as { id: number };
  store.sql.prepare('UPDATE Orders SET Num = 37, CSteer = ? WHERE _fm_record_id = ?').run('hi', row.id);
  const pv = account('Steer', { view: true }, { Num: 'none' });
  const seen = [5, 36, 37, 38, 1000].map((guess) => {
    store.setGlobalField('Orders::G', guess, pv);
    const e = explained('Steer', pv);
    // What the account is told about the stored value (the references show the guess it just set, which it knows).
    return JSON.stringify([e.value, e.result, e.matchesStored, e.notEvaluated, e.notes, e.error, e.references?.find((r) => r.field === 'Num')]);
  });
  assert.equal(new Set(seen).size, 1, 'the same answer for every guess');
  assert.equal(explained('Steer', pv).matchesStored, undefined);
  assert.doesNotMatch(seen[0], /37/);
});

test('a calculation that reaches a hidden field only through another calculation is treated like one that names it', (t) => {
  const { account, explain, explained } = setup(t);
  const pv = account('Through', { view: true }, { Secret: 'none' });
  assert.doesNotMatch(explain('Top', pv), /SENTINEL/);
  const e = explained('Top', pv);
  assert.equal(e.result, e.value);
  assert.equal(e.matchesStored, undefined);
  assert.match((e.notes ?? []).join(' '), /hidden from you/);
});

// Each reads a field the account may not, though by a route the table's own references do not show; the result is the stored value
// and no verdict is given, whichever table the field is in.
const BLIND_CASES: [string, string, object, object][] = [
  ['a related field of another table, the one table with a hidden field', 'Rel', {}, { Cust: { view: true, edit: false, create: false, delete: false, fields: { S2: 'none' } } }],
  ['a count over a related hidden field', 'Count', {}, { Cust: { view: true, edit: false, create: false, delete: false, fields: { S2: 'none' } } }],
  ['a custom function that calls Evaluate', 'Cf', { Secret: 'none' }, {}],
  ['ExecuteSQL', 'Sql2', { Secret: 'none' }, {}],
  ['a summary over a hidden field', 'Sum', { Num: 'none' }, {}],
  ['a stored calculation behind it that uses Evaluate', 'TopEval', { Secret: 'none' }, {}],
];
for (const [label, name, fields, tables] of BLIND_CASES) {
  test(`explain gives no verdict and the stored value for a calculation that reads a field the account may not: ${label}`, (t) => {
    const { account, explain, explained } = setup(t);
    const pv = account(`Blind-${name}`, { view: true }, fields, tables);
    assert.doesNotMatch(explain(name, pv), /SENTINEL/);
    const e = explained(name, pv);
    assert.equal(e.result, e.value, 'the result is the stored value');
    assert.equal(e.matchesStored, undefined);
    assert.match((e.notes ?? []).join(' '), /hidden from you/);
  });
}

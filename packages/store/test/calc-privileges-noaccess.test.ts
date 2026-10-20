import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';

function setup(t: TestContext, access: 'none' | 'masked' | 'viewOnly') {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calc-noaccess-'));
  const path = join(dir, 'Scratch.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Public' }, { name: 'Secret' }] },
    { op: 'createField', table: 'T', name: 'UCalc', type: 'text', kind: 'calculation', calculation: 'Secret & Public', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Chained', type: 'text', kind: 'calculation', calculation: 'UCalc & "!"', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Global', options: { global: true } },
    { op: 'createField', table: 'T', name: 'Repeated', options: { repetitions: 2 } },
    { op: 'createOccurrence', name: 'Alias', table: 'T' },
  ]);
  const id = Number(store.create('T', { Public: '|visible', Secret: 'TOPSECRET', Global: 'GLOBALVALUE', 'Repeated(1)': 'FIRST', 'Repeated(2)': 'SECOND' }).recordId);
  store.savePrivilegeSet({
    name: 'Reader', records: { view: true, edit: false, create: false, delete: false, fields: { Secret: access, Global: access, Repeated: access } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
  });
  const privileges = store.privilegesForSet('Reader');
  return { store, id, privileges };
}

for (const access of ['none', 'masked', 'viewOnly'] as const) {
  test(`${access}: same-record unstored calculation in get and find respects field access`, (t) => {
    const { store, id, privileges } = setup(t, access);
    const expected = access === 'viewOnly' ? 'TOPSECRET|visible' : '|visible';
    assert.equal(store.get('T', id, 'us', undefined, privileges).fieldData.UCalc, expected);
    assert.equal(store.find('T', { privileges }).records[0].fieldData.UCalc, expected);
    assert.equal(store.get('T', id).fieldData.UCalc, 'TOPSECRET|visible');
  });

  test(`${access}: evaluate cannot extract a same-record hidden field through an unstored calculation`, (t) => {
    const { store, id, privileges } = setup(t, access);
    const expected = access === 'viewOnly' ? 'TOPSECRET|visible' : '|visible';
    assert.equal(store.evaluate('T', 'UCalc', id, { privileges }).value, expected);
    assert.equal(store.evaluate('T', 'UCalc', id).value, 'TOPSECRET|visible');
  });

  test(`${access}: direct, qualified, dynamic, aggregate, global and repeating reads use the same field rule`, (t) => {
    const { store, id, privileges } = setup(t, access);
    const formulas = ['Secret', 'T::Secret', 'GetField ( "T::Secret" )', 'Evaluate ( "Secret" )',
      'List ( Secret )', 'List ( T::Secret )', 'Global', 'Repeated[2]', 'List ( Alias::Global )', 'Chained'];
    const visible = ['TOPSECRET', 'TOPSECRET', 'TOPSECRET', 'TOPSECRET', 'TOPSECRET', 'TOPSECRET',
      'GLOBALVALUE', 'SECOND', 'GLOBALVALUE', 'TOPSECRET|visible!'];
    const expected = access === 'viewOnly' ? visible : [...Array(9).fill(''), '|visible!'];
    for (const [i, formula] of formulas.entries()) {
      assert.equal(store.evaluate('T', formula, id, { privileges }).value, expected[i], formula);
      assert.equal(store.evaluate('T', formula, id).value, visible[i], `full access: ${formula}`);
    }
    // These are the evaluation entry points used for screen formulas and charts.
    const text = (v: { value: unknown } | undefined) => String(v?.value ?? '');
    assert.deepEqual(store.evaluateEach('T', formulas, id, { privileges }).map(text), expected);
    assert.deepEqual(store.evaluateRows('T', formulas, { ids: [id] }, { privileges }).map((row) => row.map(text)), [expected]);
  });
}

test('stored calculations, auto-enter, validation and record-access rules still use full data', (t) => {
  const { store, id } = setup(t, 'none');
  store.applyDesign([
    { op: 'createField', table: 'T', name: 'Stored', type: 'text', kind: 'calculation', calculation: 'Secret & Public' },
    { op: 'createField', table: 'T', name: 'Auto', calculation: 'Secret & Public', options: { autoEnter: { calculation: true, replaceExisting: true } } },
    { op: 'updateField', table: 'T', field: 'Public', options: { validation: { calculation: 'Secret = "TOPSECRET"', always: true } } },
  ]);
  store.savePrivilegeSet({ ...store.privilegeSet('Reader')!, records: {
    view: 'Secret = "TOPSECRET"', edit: 'Secret = "TOPSECRET"', create: false, delete: false, fields: { Secret: 'none' },
  }, layouts: 'modifiable' });
  const privileges = store.privilegesForSet('Reader');
  store.update('T', id, { Public: '|edited' }, undefined, { privileges });
  const row = store.get('T', id, 'us', undefined, privileges).fieldData;
  assert.equal(row.UCalc, '|edited');
  assert.equal(row.Stored, 'TOPSECRET|edited');
  assert.equal(row.Auto, 'TOPSECRET|edited');
  assert.ok(!('Secret' in row));
});

test('value-list validation retains file-level membership even when list records are hidden', (t) => {
  const { store, id } = setup(t, 'none');
  store.applyDesign([
    { op: 'createTable', name: 'Choices', fields: [{ name: 'Value' }] },
    { op: 'createValueList', name: 'Choices', field: { occurrence: 'Choices', field: 'Value' } },
  ]);
  store.create('Choices', { Value: 'HIDDENCHOICE' });
  const list = store.schema.valueLists.find((v) => v.name === 'Choices')!;
  store.applyDesign([{ op: 'createField', table: 'T', name: 'Choice', options: { validation: { valueList: list.id, always: true } } }]);
  store.savePrivilegeSet({ ...store.privilegeSet('Reader')!,
    records: { view: true, edit: true, create: false, delete: false },
    tables: { Choices: { view: false, edit: false, create: false, delete: false } }, layouts: 'modifiable',
  });
  const privileges = store.privilegesForSet('Reader');
  assert.deepEqual(store.valueListItems(list.id, undefined, privileges), []);
  assert.doesNotThrow(() => store.update('T', id, { Choice: 'HIDDENCHOICE' }, undefined, { privileges }));
  assert.throws(() => store.update('T', id, { Choice: 'ABSENTCHOICE' }, undefined, { privileges }),
    (e) => e instanceof StoreError && e.code === 506);
  assert.equal(store.get('T', id).fieldData.Choice, 'HIDDENCHOICE');
});

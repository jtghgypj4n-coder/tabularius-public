import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, PrivilegeError, explainAccessDenial, type PrivilegeDefinition, type Rule, type RuleOutcome } from '../src/index.ts';
import { accessDenialContext } from '../src/access-denial.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };
const SECRET = 'hidden-value-6bbbc46c';
const SUBMITTED = 'submitted-value-390b2cba';

function blank(t: TestContext, name = 'Scratch'): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-denial-'));
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  const store = new Store(path, name);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [
    { name: 'A' }, { name: 'Secret' }, { name: 'Global', options: { global: true } }, { name: 'File', type: 'container' },
  ] }]);
  return store;
}

function privileges(store: Store, changes: Partial<PrivilegeDefinition> = {}, account = 'clerk') {
  store.savePrivilegeSet({ name: 'Clerk', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: [], ...changes });
  store.setPassword(account, 'pw', changes.name ?? 'Clerk');
  return store.privileges(account);
}

function refused(fn: () => unknown, code = 200): StoreError {
  try { fn(); } catch (e) {
    assert.ok(e instanceof StoreError);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail('expected a refusal');
}

test('table overrides and defaults capture the permission that refused the attempted operation', (t) => {
  const s = blank(t);
  const id = s.create('T', { A: 'readable', Secret: SECRET }).recordId;
  let p = privileges(s, { records: { ...OPEN, edit: false, delete: false } });
  const edit = refused(() => s.update('T', id, { A: SUBMITTED }, undefined, { privileges: p }));
  assert.equal(edit.message, 'Record access is denied');
  assert.equal(edit.denial?.location, 'records.edit');
  assert.equal(edit.denial?.source, 'records');
  assert.equal(edit.denial?.operation, 'edit');
  assert.equal(refused(() => s.delete('T', id, { privileges: p })).denial?.permission, 'delete');

  p = privileges(s, { tables: { T: { ...OPEN, view: 'Secret = "allowed"', edit: false, delete: false } } });
  for (const [operation, fn] of [
    ['edit', () => s.update('T', id, { A: SUBMITTED }, undefined, { privileges: p })],
    ['edit', () => s.checkEditable('T', id, p)],
    ['delete', () => s.delete('T', id, { privileges: p })],
    ['view', () => s.get('T', id, 'us', undefined, p)],
    ['create', () => s.duplicate('T', id, { privileges: p })],
  ] as const) {
    const e = refused(fn);
    assert.equal(e.denial?.operation, operation);
    assert.equal(e.denial?.permission, 'view');
    assert.equal(e.denial?.location, 'tables.T.view');
    assert.equal(e.denial?.outcome, 'false');
    const text = JSON.stringify(e.denial) + JSON.stringify(explainAccessDenial(e.denial!));
    for (const value of [SECRET, SUBMITTED, 'Secret =', 'recordId', '_fm_record_id']) assert.ok(!text.includes(value));
  }
  const snapshot = explainAccessDenial(edit.denial!);
  s.savePrivilegeSet({ ...p.set, records: { ...OPEN } });
  assert.deepEqual(explainAccessDenial(edit.denial!), snapshot);
  assert.ok(Object.isFrozen(edit.denial));
  assert.ok(!snapshot.explanation.includes('records.edit'));
  assert.match(explainAccessDenial(edit.denial!, true).explanation, /records.edit/);
  assert.equal(s.get('T', id).fieldData.Secret, SECRET);
});

test('create, field and layout restrictions stay distinct, including containers and globals', (t) => {
  const s = blank(t);
  const id = s.create('T', { A: 'readable' }).recordId;
  let p = privileges(s, { tables: { T: { ...OPEN, create: false, fields: { A: 'viewOnly', File: 'viewOnly' } } } });
  assert.equal(refused(() => s.create('T', {}, { privileges: p })).denial?.location, 'tables.T.create');
  const field = refused(() => s.update('T', id, { A: SUBMITTED }, undefined, { privileges: p }), 201);
  assert.equal(field.denial?.location, 'tables.T.fields.A');
  assert.equal(field.denial?.source, 'field');
  const container = refused(() => s.setContainer('T', id, 'File', 1, { filename: SUBMITTED, mime: 'text/plain', data: Buffer.from(SECRET) }, { privileges: p }), 201);
  assert.equal(container.denial?.permission, 'field-write');
  assert.ok(!JSON.stringify(container.denial).includes(SUBMITTED));
  p = privileges(s, { records: { ...OPEN, edit: false, fields: { Global: 'viewOnly' } } });
  s.update('T', id, { Global: 'global allowed' }, undefined, { privileges: p });
  assert.equal(refused(() => s.update('T', id, { A: SUBMITTED }, undefined, { privileges: p })).denial?.permission, 'edit');
  p = privileges(s, { layoutAccess: { T: { layout: 'viewOnly', records: 'viewOnly' } } });
  assert.equal(refused(() => s.update('T', id, {}, undefined, { privileges: p })).denial?.location, 'layoutAccess.T.records');
});

test('hidden fields and layouts have no denial context, including fieldsDefault', (t) => {
  const s = blank(t);
  const id = s.create('T', { Secret: SECRET }).recordId;
  s.applyDesign([{ op: 'createLayout', name: 'Closed', occurrence: 'T' }]);
  const p = privileges(s, { records: { ...OPEN, fields: { A: 'modifiable' }, fieldsDefault: 'none' },
    layouts: 'none', layoutAccess: { T: { layout: 'modifiable', records: 'modifiable' } } });
  const shape = (e: StoreError) => ({ code: e.code, message: e.message.replace(/"[^"]+"/, '"object"'), ...(e.denial ? { denial: e.denial } : {}) });
  assert.deepEqual(shape(refused(() => s.get('Closed', id, 'us', undefined, p), 105)), shape(refused(() => s.get('Absent', id, 'us', undefined, p), 105)));
  assert.deepEqual(shape(refused(() => s.find('T', { query: [{ Secret: SECRET }], privileges: p }), 102)),
    shape(refused(() => s.find('T', { query: [{ Absent: SECRET }], privileges: p }), 102)));
  assert.equal(refused(() => s.update('T', id, { Secret: SUBMITTED }, undefined, { privileges: p }), 201).denial, undefined);
  assert.ok(!('Secret' in s.get('T', id, 'us', undefined, p).fieldData));
});

test('limited rules evaluate once in short-circuit order, and evaluation failures disclose the same explanation', (t) => {
  const s = blank(t);
  const id = s.create('T', { A: 'record-label-sentinel', Secret: SECRET }).recordId;
  const p = privileges(s, { records: { ...OPEN, view: '0', edit: '1' } });
  const evaluator = s as unknown as { ruleOutcome: (table: unknown, rule: Rule, row: unknown, account: string) => RuleOutcome };
  const original = evaluator.ruleOutcome.bind(s);
  const calls: Rule[] = [];
  evaluator.ruleOutcome = (...args) => { calls.push(args[1]); return original(...args); };
  const denied = refused(() => s.checkEditable('T', id, p));
  assert.deepEqual(calls, ['0']);
  const q = privileges(s, { records: { ...OPEN, view: '1', edit: '0' } });
  calls.length = 0;
  assert.equal(refused(() => s.checkEditable('T', id, q)).denial?.permission, 'edit');
  assert.deepEqual(calls, ['1', '0']);
  const broken = privileges(s, { records: { ...OPEN, view: 'exception-sentinel (' } });
  const failure = refused(() => s.get('T', id, 'us', undefined, broken));
  assert.equal(failure.denial?.outcome, 'evaluation-failure');
  assert.deepEqual(explainAccessDenial(failure.denial!), explainAccessDenial({ ...denied.denial!, operation: 'view' }));
  assert.ok(!JSON.stringify(failure.denial).includes('exception-sentinel'));
  const result = s.find('T', { privileges: p });
  assert.equal(result.records.length, 0);
  assert.ok(!JSON.stringify(result).includes('denial'));
  assert.deepEqual(s.getMany('T', [id], [id], { privileges: p }), []);
});

test('accounts sharing a set keep independent outcomes; untagged errors stay untagged', (t) => {
  const s = blank(t);
  const id = s.create('T', { A: 'alice' }).recordId;
  const alice = privileges(s, { records: { ...OPEN, view: 'A = Get ( AccountName )' } }, 'alice');
  s.setPassword('bob', 'pw', 'Clerk');
  const bob = s.privileges('bob');
  assert.equal(s.get('T', id, 'us', undefined, alice).fieldData.A, 'alice');
  assert.equal(refused(() => s.get('T', id, 'us', undefined, bob)).denial?.permission, 'view');
  assert.equal(s.get('T', id, 'us', undefined, alice).fieldData.A, 'alice');
  assert.equal(refused(() => s.get('T', 987654321), 101).denial, undefined);
  s.applyDesign([{ op: 'createField', table: 'T', name: 'Calculated', kind: 'calculation', calculation: '1' }]);
  assert.equal(refused(() => s.update('T', id, { Calculated: SUBMITTED }), 201).denial, undefined);
  assert.throws(() => bob.checkScript('Closed'), (e) => e instanceof PrivilegeError && e.code === 9 && e.denial?.source === 'scripts');
});

test('cross-file checks capture the owning file and its effective privilege set', (t) => {
  const a = blank(t, 'A');
  const b = blank(t, 'B');
  const id = b.create('T', { Secret: SECRET }).recordId;
  privileges(b, { name: 'OwnerRules', records: { ...OPEN, edit: false } });
  b.setPassword('clerk', 'pw', 'OwnerRules');
  a.resolveFile = (name) => name === 'B' ? b : undefined;
  a.applyDesign([
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
    { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
    { op: 'createLayout', name: 'External', occurrence: 'External' },
  ]);
  const p = privileges(a);
  const e = refused(() => a.update('External', id, { A: SUBMITTED }, undefined, { privileges: p }));
  assert.equal(e.denial?.database, 'B');
  assert.equal(e.denial?.privilegeSet, 'OwnerRules');
  assert.equal(e.denial?.location, 'records.edit');
  assert.deepEqual(accessDenialContext(e.denial!), { file: b, account: 'clerk' });
  assert.ok(!JSON.stringify(e.denial).includes(b.path));
  assert.deepEqual(accessDenialContext(b.privileges('clerk').extendedDenial(['fmmcp'])!), { file: b, account: 'clerk' });
});

test('concealed and nonexistent write targets precede every tagged denial, regardless of payload order', (t) => {
  const s = blank(t);
  const id = s.create('T', { A: 'original', Secret: SECRET }).recordId;
  for (const edit of [false, true]) {
    const p = privileges(s, { records: { ...OPEN, edit, create: false, fields: { Secret: 'none', A: 'viewOnly' } },
      layoutAccess: { T: { layout: 'viewOnly', records: 'viewOnly' } } });
    for (const create of [false, true]) for (const first of [false, true]) {
      const check = (target: string) => {
        const data = first ? { [target]: SUBMITTED, A: SUBMITTED } : { A: SUBMITTED, [target]: SUBMITTED };
        const e = refused(() => create ? s.create('T', data, { privileges: p }) : s.update('T', id, data, undefined, { privileges: p }), 201);
        assert.equal(e.denial, undefined);
        return { code: e.code, message: e.message.replace(/Secret|Absent/g, 'target') };
      };
      assert.deepEqual(check('Secret'), check('Absent'));
    }
  }
  assert.equal(s.get('T', id).fieldData.A, 'original');
  assert.equal(s.findIds('T').length, 1);
});

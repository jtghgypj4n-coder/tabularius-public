import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { Privileges, type PrivilegeDefinition } from '../src/privileges.ts';
import { accessReport, diffPrivilegeSet, explainAccess } from '../src/access-report.ts';
import type { Schema } from '../../fmp12/src/index.ts';

const definition = (): PrivilegeDefinition => ({
  name: 'Restricted',
  records: { view: true, edit: false, create: false, delete: false, fields: {}, fieldsDefault: 'none' },
  tables: {}, layouts: 'none', layoutAccess: {}, scripts: 'none', scriptAccess: {},
  valueLists: 'none', valueListAccess: {}, extendedPrivileges: [],
});
const oracle = (set: PrivilegeDefinition): Privileges => new Privileges('', set, null, () => { throw new Error('Unexpected file'); });
const schema = { tables: [], layouts: [], scripts: [], valueLists: [] } as unknown as Schema;

test('AR-store-security-01: saved policy redacts a synthetic record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privilege-defaults-'));
  const path = join(dir, 'test.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'constructor' }, { name: 'ordinary' }] }]);
    const record = store.create('T', { constructor: 'synthetic-value', ordinary: 'ordinary-value' });
    store.savePrivilegeSet({ ...definition(), layouts: 'viewOnly' });
    const privileges = store.privilegesForSet('Restricted');
    assert.deepEqual(store.get('T', Number(record.recordId), 'us', undefined, privileges).fieldData, {});
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  test(`AR-store-security-01: absent entry ${name}`, () => {
    const set = definition(), p = oracle(set);
    assert.equal(p.table(name), set.records);
    assert.equal(p.fieldAccess('T', name), 'none');
    assert.equal(p.valueList(name), 'none');
    assert.throws(() => p.checkScript(name), { code: 9 });
    assert.throws(() => p.checkLayout(name), { code: 105 });
    assert.equal(p.recordDenial(name, 'edit', 'edit')?.source, 'records');
    assert.equal(p.fieldDenial(name, name, 'write')?.source, 'fieldsDefault');
    const report = accessReport(p, { ...schema, tables: [{ name, fields: [] }] } as unknown as Schema);
    assert.equal(report.tables[0].default, true);
  });

  test(`AR-store-security-01: explicit entry ${name}`, () => {
    const set = definition();
    set.tables = { [name]: { ...set.records, fields: { [name]: 'masked' }, masks: {} } };
    set.scriptAccess = { [name]: 'viewOnly' };
    set.valueListAccess = { [name]: 'viewOnly' };
    set.layoutAccess = { [name]: { layout: 'viewOnly', records: 'none' } };
    const p = oracle(set);
    assert.equal(p.fieldAccess(name, name), 'masked');
    assert.equal(p.field(name, name), 'none');
    assert.deepEqual(p.mask(name, name), { kind: 'last4' });
    set.tables[name].masks = { [name]: { kind: 'placeholder', text: 'hidden' } };
    assert.deepEqual(p.mask(name, name), { kind: 'placeholder', text: 'hidden' });
    assert.doesNotThrow(() => p.checkScript(name));
    assert.doesNotThrow(() => p.checkLayout(name));
    assert.throws(() => p.checkLayout(name, true), { code: 200 });
    assert.equal(p.valueList(name), 'viewOnly');
  });
}

test('AR-store-security-01: custom prototypes do not supply entries', () => {
  const set = definition();
  set.tables = Object.create({ T: { view: true, edit: true, create: true, delete: true } });
  set.records.fields = Object.create({ ordinary: 'modifiable' });
  set.scriptAccess = Object.create({ ordinary: 'modifiable' });
  set.layoutAccess = Object.create({ ordinary: { layout: 'modifiable', records: 'modifiable' } });
  set.valueListAccess = Object.create({ ordinary: 'modifiable' });
  const p = oracle(set);
  assert.equal(p.table('T'), set.records);
  assert.equal(p.fieldAccess('T', 'ordinary'), 'none');
  assert.equal(p.valueList('ordinary'), 'none');
  assert.throws(() => p.checkScript('ordinary'), { code: 9 });
  assert.throws(() => p.checkLayout('ordinary'), { code: 105 });
});

test('AR-store-security-01: invalid effective levels are denied', () => {
  const set = definition();
  delete set.records.fieldsDefault;
  set.records.fields = { ordinary: 'unexpected' } as never;
  set.scriptAccess = { ordinary: 'unexpected' } as never;
  set.layoutAccess = { ordinary: { layout: 'unexpected', records: 'unexpected' } } as never;
  set.valueListAccess = { ordinary: 'unexpected' } as never;
  const p = oracle(set);
  assert.equal(p.fieldAccess('T', 'ordinary'), 'none');
  assert.equal(p.readsEverything, false);
  assert.equal(p.valueList('ordinary'), 'none');
  assert.throws(() => p.checkScript('ordinary'), { code: 9 });
  assert.throws(() => p.checkLayout('ordinary'), { code: 105 });
});

test('AR-store-security-03: default field fallback changes in both directions', () => {
  const base = definition(), proposed = structuredClone(base);
  delete proposed.records.fieldsDefault;
  assert.equal(oracle(base).fieldAccess('T', 'ordinary'), 'none');
  assert.equal(oracle(proposed).fieldAccess('T', 'ordinary'), 'modifiable');
  assert.deepEqual(diffPrivilegeSet(proposed, base), [{ area: 'records', detail: 'default fields not listed → modifiable' }]);
  assert.deepEqual(diffPrivilegeSet(base, proposed), [{ area: 'records', detail: 'default fields not listed → no access' }]);
});

test('AR-store-security-03: named fields use their own side of the default', () => {
  for (const name of ['ordinary', 'constructor', '__proto__']) {
    const base = definition(), proposed = structuredClone(base);
    base.records.fields = { [name]: 'viewOnly' };
    assert.deepEqual(diffPrivilegeSet(proposed, base), [{ area: 'records', detail: `default field "${name}" → none` }]);
    assert.deepEqual(diffPrivilegeSet(base, proposed), [{ area: 'records', detail: `default field "${name}" → viewOnly` }]);
    base.records.fields = { [name]: 'none' };
    assert.deepEqual(diffPrivilegeSet(proposed, base), []);
  }
});

for (const extendedPrivileges of [[], ['Fmrest', 'CustomKeyword'], ['FMMCP']]) {
  test(`AR-store-security-07: effective surfaces ${JSON.stringify(extendedPrivileges)}`, () => {
    for (const identity of [{ name: '[Full Access]' }, { name: 'Administrator', id: 1 }, { name: 'Restricted' }]) {
      const p = oracle({ ...definition(), ...identity, extendedPrivileges });
      const report = accessReport(p, schema), explanation = explainAccess(report);
      assert.ok(!report.extendedPrivileges.includes('(all)'));
      for (const keyword of [...extendedPrivileges, 'fmrest', 'fmmcp', 'fmapp', 'fmodata']) {
        assert.equal(report.extendedPrivileges.some((e) => e.toLowerCase() === keyword.toLowerCase()), p.has(keyword), keyword);
      }
      for (const surface of explanation.surfaces) assert.equal(surface.allowed, p.has(surface.surface), surface.surface);
      assert.deepEqual(p.set.extendedPrivileges, extendedPrivileges);
    }
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Privileges, type PrivilegeDefinition } from '../../store/src/privileges.ts';
import type { Store } from '../../store/src/index.ts';
import { narrowPrivileges, scoped } from '../src/token-scope.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };
const definition: PrivilegeDefinition = { name: 'Limited', records: OPEN, layouts: 'modifiable', scripts: 'modifiable', valueLists: 'viewOnly', extendedPrivileges: ['fmrest'] };
function files(extra: Partial<PrivilegeDefinition> = {}) {
  const store = { schema: { layouts: [{ name: 'People' }, { name: 'Other' }, { name: 'Broken' }] },
    layout: (name: string) => { if (name !== 'People' && name !== 'Other') throw new Error('no table'); return { table: name }; },
  } as unknown as Store;
  const other = {} as Store;
  let a: Privileges, b: Privileges;
  const accountIn = (file: unknown) => { if (file === store) return a; if (file === other) return b; throw new Error('unknown file'); };
  a = new Privileges('Ann', { ...definition, ...extra }, store, accountIn);
  b = new Privileges('Ann', { ...definition, name: '[Full Access]', id: 1 }, other, accountIn);
  return { store, other, a, b };
}

test('only nonempty layout scopes or read-only scopes restrict a token', () => {
  const { store, a } = files();
  for (const scope of [undefined, {}, { readOnly: false }, { layouts: [] }, { readOnly: false, layouts: [] }]) {
    assert.equal(scoped(scope), false); assert.equal(narrowPrivileges(store, a, scope), a);
  }
  for (const scope of [{ readOnly: true }, { layouts: ['People'] }, { readOnly: false, layouts: ['People'] }, { readOnly: true, layouts: [] }]) assert.equal(scoped(scope), true);
});

test('read-only tokens preserve existing restrictions and deny every write and script grant', () => {
  const { store, a } = files({ id: 7, records: { ...OPEN, fields: { Secret: 'masked' } },
    tables: { Hidden: { ...OPEN, view: false }, Restricted: { ...OPEN, edit: false } },
    layoutAccess: { Read: { layout: 'viewOnly', records: 'modifiable' }, Hidden: { layout: 'none', records: 'none' }, Existing: { layout: 'viewOnly', records: 'viewOnly' } },
    scriptAccess: { Run: 'modifiable' },
  });
  const p = narrowPrivileges(store, a, { readOnly: true });
  assert.equal(p.full, false); assert.equal(p.set.id, undefined);
  assert.equal(p.fieldAccess('People', 'Secret'), 'masked');
  for (const table of ['People', 'Restricted', 'Hidden']) {
    assert.equal(p.table(table).create, false); assert.equal(p.table(table).edit, false); assert.equal(p.table(table).delete, false);
  }
  assert.equal(p.table('Hidden').view, false);
  assert.deepEqual(p.layout('Read'), { layout: 'viewOnly', records: 'viewOnly' });
  assert.deepEqual(p.layout('Hidden'), { layout: 'none', records: 'none' });
  assert.deepEqual(p.layout('Existing'), { layout: 'viewOnly', records: 'viewOnly' });
  assert.equal(p.script('Run'), 'none'); assert.equal(p.script('Other'), 'none');
  assert.equal(a.table('People').edit, true, 'narrowing does not modify the account definition');
  const full = files({ id: 1, name: '[Full Access]', records: { ...OPEN, view: false } });
  const limitedFull = narrowPrivileges(full.store, full.a, { readOnly: true });
  assert.equal(limitedFull.full, false); assert.equal(limitedFull.table('People').view, true);
  assert.equal(limitedFull.table('People').edit, false); assert.equal(limitedFull.layout('People').layout, 'viewOnly');
});

test('layout scopes canonicalize known names and never grant unknown layouts or unrelated tables', () => {
  const { store, a } = files({ records: { ...OPEN, edit: false } });
  const p = narrowPrivileges(store, a, { layouts: ['pEoPlE', 'Missing', 'Broken'] });
  assert.deepEqual(Object.keys(p.set.layoutAccess!).sort(), ['Broken', 'People']);
  assert.deepEqual(p.layout('People'), a.layout('People'));
  for (const name of ['Other', 'Missing', 'undefined']) assert.equal(p.layout(name).layout, 'none', name);
  assert.deepEqual(p.table('People'), a.table('People'));
  assert.equal(p.table('Other').view, false); assert.equal(p.table('Broken').view, false);
});

test('scope ceilings are stable across file cycles, retain read-only limits, and apply layout names only to their file', () => {
  for (const readOnly of [false, true]) {
    const { store, other, a } = files();
    const p = narrowPrivileges(store, a, { layouts: ['People'], readOnly });
    assert.equal(p.ceiling!(p), p, 'applying the same ceiling twice is idempotent');
    assert.equal(p.ceiling!(a), p, 'the original account uses its existing narrowed instance');
    const abroad = p.in(other);
    assert.equal(p.in(other), abroad);
    assert.equal(abroad.in(store), p, 'a cross-file cycle cannot lose or multiply the ceiling');
    assert.equal(abroad.table('Foreign').view, true);
    assert.equal(abroad.table('Foreign').edit, !readOnly);
    assert.equal(abroad.full, !readOnly);
    assert.equal(abroad.script('Run'), readOnly ? 'none' : 'modifiable');
    assert.equal(p.layout('Other').layout, 'none');
  }
});

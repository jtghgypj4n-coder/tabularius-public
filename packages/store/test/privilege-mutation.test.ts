import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Privileges, PrivilegeError, countObjectUse, isFullAccess, type PrivilegeDefinition, type TablePrivileges } from '../src/privileges.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };
const base: PrivilegeDefinition = { name: 'Limited', records: OPEN, layouts: 'none', scripts: 'none', valueLists: 'none', extendedPrivileges: [] };
const file = { name: 'A' };
const make = (extra: Partial<PrivilegeDefinition> = {}, capture = true, account = 'Ann', owner: unknown = file) =>
  new Privileges(account, { ...base, ...extra }, owner, () => { throw new Error('unexpected destination'); }, capture);
const denied = (fn: () => void, code: number, details: Record<string, unknown> = {}) => assert.throws(fn, (e: unknown) => {
  if (!(e instanceof PrivilegeError) || e.code !== code) return false;
  for (const [key, value] of Object.entries(details)) assert.deepEqual((e.denial as unknown as Record<string, unknown>)?.[key], value);
  return true;
});

test('privilege identity and ceilings preserve the destination account rather than the source grants', () => {
  const other = {}, destination = make({ records: { ...OPEN, edit: false } }, true, 'Ann', other);
  const p = new Privileges('Ann', base, file, (to) => { assert.equal(to, other); return destination; });
  assert.equal(p.in(file), p); assert.equal(p.in(other), destination);
  const cap = make({ records: { ...OPEN, create: false, edit: false, delete: false } }, true, 'Ann', other);
  const limited = p.withCeiling(() => cap);
  assert.equal(limited.in(other), cap); assert.equal(limited.in(file), limited);
  assert.equal(p.name, 'Limited');
  assert.match(p.fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(p.fingerprint, make().fingerprint);
  assert.notEqual(p.fingerprint, make({ records: { ...OPEN, edit: false } }).fingerprint);
});

test('unrestricted reads require every default, table and field to be visible', () => {
  assert.equal(make().readsEverything, true);
  for (const records of [
    { ...OPEN, view: false }, { ...OPEN, view: '1' }, { ...OPEN, fieldsDefault: 'none' as const },
    { ...OPEN, fields: { Secret: 'none' as const } }, { ...OPEN, fields: { Secret: 'masked' as const } },
  ]) {
    assert.equal(make({ records }).readsEverything, false);
    assert.equal(make({ tables: { Private: records } }).readsEverything, false);
  }
  assert.equal(make({ records: { ...OPEN, fields: { Visible: 'viewOnly' } } }).readsEverything, true);
  const full = make({ id: 1, records: { ...OPEN, view: false }, tables: { Private: { ...OPEN, view: false } } });
  assert.equal(full.readsEverything, true);
});

test('full access and extended privileges have independent, explicit gates', () => {
  assert.equal(isFullAccess({ id: 1, name: 'Localized' }), true);
  assert.equal(isFullAccess({ name: '[Full Access]' }), true);
  assert.equal(isFullAccess({ id: 2, name: 'Limited' }), false);
  const limited = make({ extendedPrivileges: ['FmRest'] }), full = make({ id: 1, records: { ...OPEN, view: false }, menuCommands: 'minimum' });
  assert.equal(limited.has('fmrest'), true); assert.equal(limited.has('FMREST'), true);
  assert.equal(limited.has('fmmcp'), false); assert.equal(limited.has('fmxml'), false);
  assert.equal(full.has('fmmcp'), true); assert.equal(full.has('fmrest'), false);
  for (const name of ['listed', 'unlisted']) {
    assert.deepEqual(full.layout(name), { layout: 'modifiable', records: 'modifiable' });
    assert.equal(full.script(name), 'modifiable'); assert.equal(full.valueList(name), 'modifiable');
    assert.deepEqual(full.table(name), OPEN); assert.equal(full.fieldAccess(name, 'secret'), 'modifiable');
  }
  assert.equal(full.menuCommands, 'all');
  assert.equal(make().menuCommands, 'all'); assert.equal(make({ menuCommands: 'minimum' }).menuCommands, 'minimum');
});

test('layout, script and value-list overrides keep read, write and missing-object decisions distinct', () => {
  const p = make({ layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly',
    layoutAccess: { Hidden: { layout: 'none', records: 'none' }, Read: { layout: 'viewOnly', records: 'viewOnly' }, Blocked: { layout: 'viewOnly', records: 'none' } },
    scriptAccess: { Hidden: 'none', Edit: 'modifiable' }, valueListAccess: { Hidden: 'none', Edit: 'modifiable' } });
  assert.deepEqual(p.layout('Other'), { layout: 'viewOnly', records: 'modifiable' });
  assert.equal(p.script('Other'), 'viewOnly'); assert.equal(p.script('Edit'), 'modifiable');
  assert.equal(p.valueList('Other'), 'viewOnly'); assert.equal(p.valueList('Hidden'), 'none'); assert.equal(p.valueList('Edit'), 'modifiable');
  denied(() => p.checkLayout('Hidden'), 105); denied(() => make().checkLayout('Absent'), 105);
  p.checkLayout('Read'); denied(() => p.checkLayout('Read', true), 200, { ruleKind: 'view-only', source: 'layout' }); denied(() => p.checkLayout('Blocked', true), 200, { ruleKind: 'none' });
  p.checkLayout('Other', true);
  denied(() => p.checkScript('Hidden'), 9, { source: 'script', location: 'scriptAccess.Hidden' }); denied(() => make().checkScript('Absent'), 9, { source: 'scripts', location: 'scripts' }); p.checkScript('Edit');
});

test('import admission distinguishes creation, editing, planning, and add-remaining', () => {
  const cases: [boolean, boolean | string, 'add' | 'update' | 'replace' | 'plan', boolean, boolean][] = [
    [false, false, 'add', false, false], [true, false, 'add', false, true], [false, true, 'add', false, false],
    [false, false, 'plan', false, false], [false, true, 'plan', false, true], [true, false, 'plan', false, true],
    [true, false, 'update', false, false], [true, false, 'replace', false, false], [true, false, 'update', true, true],
    [false, false, 'replace', true, false], [false, true, 'update', true, true], [false, true, 'replace', false, true],
    [false, '1', 'update', false, true],
  ];
  for (const [create, edit, action, remaining, allowed] of cases) {
    const p = make({ records: { ...OPEN, create, edit } });
    if (allowed) assert.doesNotThrow(() => p.checkImport('T', action, remaining));
    else denied(() => p.checkImport('T', action, remaining), 200, { permission: { add: 'create', plan: 'create', update: 'edit', replace: 'edit' }[action] });
  }
});

test('denials retain their owning policy, selected rule and required privileges; suppressed capture stays absent', () => {
  const restricted: TablePrivileges = { ...OPEN, edit: '0', fields: { A: 'viewOnly' }, fieldsDefault: 'none' };
  const p = make({ tables: { T: restricted } });
  const d = p.recordDenial('T', 'edit', 'edit')!;
  assert.equal(d.database, 'A'); assert.equal(d.privilegeSet, 'Limited'); assert.equal(d.policyFingerprint, p.fingerprint);
  assert.equal(d.source, 'table'); assert.equal(d.location, 'tables.T.edit'); assert.equal(d.ruleKind, 'limited');
  assert.equal(make({ records: { ...OPEN, edit: false } }).recordDenial('T', 'edit', 'edit')!.ruleKind, 'none');
  assert.equal(p.fieldDenial('T', 'A', 'write')!.source, 'field');
  assert.equal(p.fieldDenial('T', 'Other', 'write')!.source, 'fieldsDefault');
  assert.deepEqual(p.extendedDenial(['fmrest', 'fmmcp'])!.requiredPrivileges, ['fmrest', 'fmmcp']);
  assert.equal(make({}, false).recordDenial('T', 'edit', 'edit'), undefined);
  assert.equal(make({}, false).extendedDenial(['fmrest']), undefined);
  assert.equal(make({}, true, 'Ann', { name: 42 }).recordDenial('T', 'edit', 'edit')!.database, undefined);
});

test('object-use evidence counts successful real-account checks but not full access or preview identities', () => {
  const owner = {}, uses: unknown[][] = [];
  countObjectUse(owner, (...args) => uses.push(args));
  const extra = { layouts: 'viewOnly', scripts: 'viewOnly' } as const;
  make(extra, true, 'Ann', owner).checkLayout('L'); make(extra, true, 'Ann', owner).checkScript('S');
  assert.deepEqual(uses, [['Ann', 'Limited', 'layout', 'L'], ['Ann', 'Limited', 'script', 'S']]);
  for (const account of ['', '[view as Limited]']) make(extra, true, account, owner).checkScript('S');
  make({ ...extra, id: 1 }, true, 'Admin', owner).checkLayout('L');
  for (const value of [null, undefined, 7]) assert.doesNotThrow(() => make(extra, true, 'Ann', value).checkScript('S'));
  assert.equal(uses.length, 2);
});

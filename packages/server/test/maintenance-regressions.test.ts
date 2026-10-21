import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { applyCleanup, cleanupHistory, scanData, undoCleanup, updateMany } from '../src/cleanup.ts';
import { storable } from '../src/optimization.ts';
import { applyFix } from '../src/optimization-fix.ts';

function made(): { store: Store; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-maintenance-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  return { store, done: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

function parents(store: Store, compound = true): { keep: number; remove: number } {
  store.applyDesign([
    { op: 'createTable', name: 'Parents', fields: [{ name: 'Key' }, { name: 'Category' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Children', fields: [{ name: 'Key' }, { name: 'Category' }] },
    { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: compound
      ? [{ left: 'Key', right: 'Key' }, { left: 'Category', right: 'Category' }]
      : [{ left: 'Key', right: 'Key' }], rightDelete: true },
  ] as never);
  const keep = Number(store.create('Parents', { Key: 'A', Category: 'one', Name: 'Same Name' }).recordId);
  const remove = Number(store.create('Parents', { Key: 'B', Category: 'one', Name: 'Same Name' }).recordId);
  store.create('Children', { Key: 'B', Category: 'one' });
  return { keep, remove };
}

test('AR-server-backup-ops-02', () => {
  const { store, done } = made();
  try {
    const { keep, remove } = parents(store);
    assert.throws(() => applyCleanup(store, { layout: 'Parents',
      fixes: [{ field: 'Name', from: 'Same Name', to: 'Changed' }], merges: [{ keep, remove: [remove] }] }, {}));
    assert.equal(store.recordCount('Parents'), 2);
    assert.equal(store.recordCount('Children'), 1);
    assert.equal((store.sql.prepare('SELECT count(*) AS n FROM Parents WHERE Name = ?').get('Same Name') as { n: number }).n, 2);
    assert.deepEqual(cleanupHistory(store), []);
  } finally { done(); }
});

test('AR-server-backup-ops-07 case 1', () => {
  const { store, done } = made();
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as never);
    const id = Number(store.create('People', { Name: 'Before' }).recordId);
    cleanupHistory(store);
    store.sql.exec("CREATE TRIGGER reject_cleanup BEFORE INSERT ON _fm_cleanup BEGIN SELECT RAISE(FAIL, 'injected'); END");
    assert.throws(() => applyCleanup(store, { layout: 'People', fixes: [{ field: 'Name', from: 'Before', to: 'After' }] }, {}), /injected/);
    assert.equal((store.sql.prepare('SELECT Name FROM People WHERE _fm_record_id = ?').get(id) as { Name: string }).Name, 'Before');
    assert.deepEqual(cleanupHistory(store), []);
  } finally { done(); }
});

test('AR-server-backup-ops-07 case 2', () => {
  const { store, done } = made();
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as never);
    store.create('People', { Name: 'Before' });
    cleanupHistory(store);
    store.sql.exec("CREATE TRIGGER reject_cleanup BEFORE INSERT ON _fm_cleanup BEGIN SELECT RAISE(FAIL, 'injected'); END");
    assert.throws(() => updateMany(store, { layout: 'People', fieldData: { Name: 'After' }, expectCount: 1 }, {}), /injected/);
    assert.equal((store.sql.prepare('SELECT Name FROM People').get() as { Name: string }).Name, 'Before');
  } finally { done(); }
});

test('AR-server-backup-ops-07 case 3', () => {
  const { store, done } = made();
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as never);
    store.create('People', { Name: 'Before' });
    const batch = applyCleanup(store, { layout: 'People', fixes: [{ field: 'Name', from: 'Before', to: 'After' }] }, {});
    if ('dryRun' in batch) throw new Error('expected a committed batch');
    store.sql.exec("CREATE TRIGGER reject_undo BEFORE UPDATE ON _fm_cleanup BEGIN SELECT RAISE(FAIL, 'injected'); END");
    assert.throws(() => undoCleanup(store, batch.id, {}), /injected/);
    assert.equal((store.sql.prepare('SELECT Name FROM People').get() as { Name: string }).Name, 'After');
    assert.equal(cleanupHistory(store)[0].undone, undefined);
  } finally { done(); }
});

test('AR-server-backup-ops-09 case 1', () => {
  const { store, done } = made();
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Events', fields: [{ name: 'Name' }] },
      { op: 'createCustomFunction', name: 'ClockValue', parameters: [], formula: 'Get ( CurrentTimestamp )' },
      { op: 'createCustomFunction', name: 'WrappedClock', parameters: [], formula: 'ClockValue()' },
      { op: 'createField', table: 'Events', name: 'SeenAt', kind: 'calculation', type: 'timestamp', calculation: 'WrappedClock()', options: { unstored: true } },
    ] as never);
    const table = store.schema.tables.find((t) => t.name === 'Events')!;
    const field = table.fields.find((f) => f.name === 'SeenAt')!;
    assert.equal(storable(store, table, field), false);
    assert.throws(() => applyFix(store, 'store-calculation', { items: ['Events::SeenAt'] }));
    assert.equal(field.options?.unstored, true);
  } finally { done(); }
});

test('AR-server-backup-ops-09 case 2', () => {
  const { store, done } = made();
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Events', fields: [{ name: 'Base' }, { name: 'GlobalValue', options: { global: true } }] },
      { op: 'createField', table: 'Events', name: 'Clock', kind: 'calculation', type: 'text', calculation: 'Get ( CurrentDate )', options: { unstored: true } },
      { op: 'createField', table: 'Events', name: 'ThroughField', kind: 'calculation', type: 'text', calculation: 'Clock', options: { unstored: true } },
      { op: 'createField', table: 'Events', name: 'ThroughGlobal', kind: 'calculation', type: 'text', calculation: 'GlobalValue', options: { unstored: true } },
      { op: 'createField', table: 'Events', name: 'UnknownCall', kind: 'calculation', type: 'text', calculation: 'NotAvailable(Base)', options: { unstored: true } },
      { op: 'createCustomFunction', name: 'LoopA', parameters: [], formula: 'LoopB()' },
      { op: 'createCustomFunction', name: 'LoopB', parameters: [], formula: 'LoopA()' },
      { op: 'createField', table: 'Events', name: 'ThroughCycle', kind: 'calculation', type: 'text', calculation: 'LoopA()', options: { unstored: true } },
    ] as never);
    const t = store.schema.tables.find((x) => x.name === 'Events')!;
    for (const name of ['ThroughField', 'ThroughGlobal', 'UnknownCall', 'ThroughCycle']) {
      assert.equal(storable(store, t, t.fields.find((f) => f.name === name)!), false, name);
    }
  } finally { done(); }
});

test('AR-server-backup-ops-13 case 1', () => {
  const { store, done } = made();
  try {
    const { keep, remove } = parents(store, false);
    store.savePrivilegeSet({ name: 'ParentsOnly', records: { view: false, edit: false, create: false, delete: false },
      tables: { Parents: { view: true, edit: false, create: false, delete: false } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
    store.setPassword('reader', 'password1234', 'ParentsOnly');
    const restricted = scanData(store, { layout: 'Parents', checks: ['duplicates'] }, store.privileges('reader'));
    const group = restricted.duplicates.find((g) => g.records.some((r) => r.recordId === keep) && g.records.some((r) => r.recordId === remove));
    assert.ok(group);
    assert.deepEqual(group.related, []);
    assert.ok(!JSON.stringify(restricted).includes('Children'));
    const unrestricted = scanData(store, { layout: 'Parents', checks: ['duplicates'] });
    assert.ok(unrestricted.duplicates.some((g) => g.related.some((r) => r.table === 'Children' && r.records === 1)));
  } finally { done(); }
});

test('AR-server-backup-ops-13 case 2', () => {
  const { store, done } = made();
  try {
    parents(store, false);
    store.create('Children', { Key: 'B', Category: 'hidden' });
    const access = { view: true as const, edit: false as const, create: false as const, delete: false as const };
    store.savePrivilegeSet({ name: 'LimitedChildren', records: access,
      tables: { Children: { ...access, view: 'Category = "one"' } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
    store.setPassword('limited', 'password1234', 'LimitedChildren');
    const visible = scanData(store, { layout: 'Parents', checks: ['duplicates'] }, store.privileges('limited'));
    assert.equal(visible.duplicates[0].related[0].records, 1);
    assert.equal(scanData(store, { layout: 'Parents', checks: ['duplicates'] }).duplicates[0].related[0].records, 2);
    store.savePrivilegeSet({ name: 'HiddenChildKey', records: access,
      tables: { Children: { ...access, fields: { Key: 'none' } } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
    store.setPassword('hidden', 'password1234', 'HiddenChildKey');
    const hidden = scanData(store, { layout: 'Parents', checks: ['duplicates'] }, store.privileges('hidden'));
    assert.deepEqual(hidden.duplicates[0].related, []);
  } finally { done(); }
});

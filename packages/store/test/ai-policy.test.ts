import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, StoreError, type DesignOp } from '../src/index.ts';
import { applyOp, DesignError } from '../src/design.ts';

test('new native and compat files enable policy; missing metadata stays off; toggles survive reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-ai-policy-'));
  try {
    for (const mode of ['native', 'compat'] as const) {
      const path = join(dir, `${mode}.sqlite`);
      createStore(path, { mode });
      let s = new Store(path, mode);
      assert.equal(s.aiPolicy, true);
      s.setAiPolicy(false); s.close(); s = new Store(path, mode);
      assert.equal(s.aiPolicy, false);
      s.setAiPolicy(true); s.close(); s = new Store(path, mode);
      assert.equal(s.aiPolicy, true); s.close();
      const sql = new DatabaseSync(path);
      sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'"); sql.close();
      s = new Store(path, mode); assert.equal(s.aiPolicy, false); s.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AI-visible exceptions round-trip including Full Access without granting ordinary access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-ai-visible-'));
  try {
    const path = join(dir, 'file.sqlite'); createStore(path);
    let s = new Store(path, 'File');
    s.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Password' }] }]);
    const full = s.privilegeSets().find((p) => p.id === 1)!;
    s.savePrivilegeSet({ ...full, aiVisible: { People: ['Password'] } });
    s.savePrivilegeSet({ name: 'None', records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], aiVisible: { People: true } });
    s.close(); s = new Store(path, 'File');
    assert.deepEqual(s.privileges('Admin').set.aiVisible, { People: ['Password'] });
    assert.equal(s.privilegeSets().find((p) => p.name === 'None')!.records.view, false);
    s.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AI visibility follows field and table identities through rename, delete and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-ai-visible-renames-'));
  const path = join(dir, 'file.sqlite'); createStore(path);
  let store = new Store(path, 'File');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }, { name: 'Name' }] }]);
    const full = store.privileges('Admin').set;
    store.savePrivilegeSet({ ...full, aiVisible: { iTeMs: ['pAsSwOrD'] } });
    store.savePrivilegeSet({ name: 'None', records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], aiVisible: { Items: ['Password'] } });
    store.savePrivilegeSet({ name: 'Blanket', records: full.records, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], aiVisible: { Items: true } });
    const changes: DesignOp[] = [
      { op: 'updateField', table: 'Items', field: 'Password', name: 'Hint' },
      { op: 'renameTable', table: 'Items', name: 'Renamed' },
    ];
    const checked = store.checkDesign(changes);
    assert.deepEqual(checked.privileges.find((p) => p.id === 1)!.aiVisible, { Renamed: ['Hint'] });
    assert.deepEqual(store.privileges('Admin').set.aiVisible, { iTeMs: ['pAsSwOrD'] }, 'preview cannot write');
    store.applyDesign(changes);
    store.close(); store = new Store(path, 'File');
    for (const name of [full.name, 'None']) assert.deepEqual(store.privilegeSet(name)!.aiVisible, { Renamed: ['Hint'] });
    assert.deepEqual(store.privilegeSet('Blanket')!.aiVisible, { Renamed: true });
    store.applyDesign([{ op: 'deleteField', table: 'Renamed', field: 'Hint' }, { op: 'createField', table: 'Renamed', name: 'Hint' }]);
    assert.deepEqual(store.privileges('Admin').set.aiVisible, { Renamed: [] }, 'a recreated field must not inherit the deleted field mark');
    store.applyDesign([{ op: 'deleteTable', table: 'Renamed' }, { op: 'createTable', name: 'Renamed' }]);
    for (const name of [full.name, 'None', 'Blanket']) assert.deepEqual(store.privilegeSet(name)!.aiVisible, {}, 'a recreated table must not inherit old marks');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a rename cannot attach stale target-name AI visibility to an unmarked identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-ai-visible-stale-'));
  const path = join(dir, 'file.sqlite'); createStore(path);
  const store = new Store(path, 'File');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }, { name: 'Name' }] }]);
    const full = store.privileges('Admin').set;
    store.savePrivilegeSet({ ...full, aiVisible: { Items: ['Hint', 'Name'], Renamed: true } });
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Password', name: 'Hint' }]);
    assert.deepEqual(store.privileges('Admin').set.aiVisible, { Items: ['Name'], Renamed: true });
    store.applyDesign([{ op: 'renameTable', table: 'Items', name: 'Renamed' }]);
    assert.deepEqual(store.privileges('Admin').set.aiVisible, { Renamed: ['Name'] });
    store.savePrivilegeSet({ ...full, aiVisible: { Destination: true } });
    store.applyDesign([{ op: 'renameTable', table: 'Renamed', name: 'Destination' }]);
    assert.deepEqual(store.privileges('Admin').set.aiVisible, {});
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('restoreDeleted requires a recorded deletion and ignores caller patches when restoring one', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'store-ai-restore-'));
  const path = join(dir, 'file.sqlite'); createStore(path);
  const store = new Store(path, 'File');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  const patch = { leaves: [{ path: ['privileges', { id: 1 }, 'aiVisible'], before: { Items: true } }], removed: [] };
  const changes: DesignOp[] = [
    { op: 'createField', table: 'Items', name: 'Uncommitted' },
    { op: 'restoreDeleted', deleted: 999999, patch },
  ];
  const before = structuredClone(store.schema);
  for (const apply of [() => store.checkDesign(changes), () => store.applyDesign(changes)]) {
    assert.throws(apply, (e: StoreError) => e.code === 101 && /Nothing deleted/.test(e.message));
    assert.deepEqual(store.schema, before, 'the entire batch must stay unapplied');
    assert.equal(store.privileges('Admin').set.aiVisible, undefined);
  }
  store.create('Items', { Name: 'kept-value' });
  store.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Name' }]);
  store.applyDesign([{ op: 'restoreDeleted', deleted: store.deletedDesigns()[0].id, patch }]);
  assert.equal(store.get('Items', 1).fieldData.Name, 'kept-value');
  assert.equal(store.privileges('Admin').set.aiVisible, undefined, 'only the stored deletion patch is used');
});

test('a recorded restore remains replayable after its deleted entry is consumed, but not as a live request', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'store-ai-restore-replay-'));
  const path = join(dir, 'file.sqlite'); createStore(path);
  const store = new Store(path, 'File');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Label', kind: 'calculation', calculation: 'Upper ( Name )' }] }]);
  const fields = structuredClone(store.schema.tables[0].fields);
  const designs = structuredClone(store.designs());
  const remove: DesignOp[] = [{ op: 'deleteField', table: 'Items', field: 'Name' }];
  const state = store.checkDesign(remove);
  store.applyDesign(remove);
  const [restore] = store.applyDesign([{ op: 'restoreDeleted', deleted: store.deletedDesigns()[0].id }]).applied;
  assert.equal(restore.op, 'restoreDeleted');
  if (restore.op !== 'restoreDeleted' || !restore.patch) assert.fail('the design log must retain the recorded restore patch');
  assert.equal(store.deletedDesigns().length, 0);
  assert.throws(() => applyOp(state, restore), (e: DesignError) => e.code === 101);
  assert.throws(() => store.checkDesign([restore]), (e: StoreError) => e.code === 101);
  applyOp(state, restore, () => ({ patch: restore.patch! }));
  assert.deepEqual(state.schema.tables[0].fields, fields);
  assert.deepEqual(state.designs, designs, 'the recorded patch restores layout references as well as fields and formulas');
});

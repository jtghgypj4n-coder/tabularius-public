// Privilege sets key per-object access (layouts, scripts, value lists, tables,
// fields) by NAME, and record-access rules are formulas. A design rename or
// delete has to follow through to them, or a "no access" restriction is left
// orphaned under the old name and the renamed object silently falls back to the
// set's blanket level — a privilege escalation. Deletes must drop the entry;
// renames must re-key it (and rewrite rule calcs). A security-health finding
// surfaces orphaned keys already sitting in a converted file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), 'tabularius-priv-rename-')); });
after(() => { if (dir) rmSync(dir, { recursive: true }); });

let n = 0;
/**
 * A scratch solution: table People (Name, Party), an extra layout "Report", a
 * script "Export", a value list "Parties", and a non-full set "Limited" that
 * denies all four and limits People to Party = "D", with Party hidden.
 */
function fixture(): Store {
  const path = join(dir, `s${n++}.sqlite`);
  createStore(path);
  const store = new Store(path);
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Party' }] },
    { op: 'createLayout', name: 'Report', occurrence: 'People' },
    { op: 'createScript', name: 'Export', steps: [] },
    { op: 'createValueList', name: 'Parties', values: ['D', 'R'] },
  ]);
  store.savePrivilegeSet({
    name: 'Limited',
    records: { view: true, edit: true, create: true, delete: true },
    tables: { People: { view: 'Party = "D"', edit: true, create: true, delete: true, fields: { Party: 'none' } } },
    layouts: 'viewOnly',
    layoutAccess: { Report: { layout: 'none', records: 'none' } },
    valueLists: 'viewOnly',
    valueListAccess: { Parties: 'none' },
    scripts: 'viewOnly',
    scriptAccess: { Export: 'none' },
    extendedPrivileges: ['fmmcp', 'cloud_sync'],
  });
  store.applyDesign([{ op: 'createExtendedPrivilege', name: 'cloud_sync' }]);
  return store;
}

function withStore(fn: (store: Store) => void): void {
  const store = fixture();
  try { fn(store); } finally { store.close(); }
}

test('renaming a layout re-keys its access entry (no escalation)', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'updateLayout', layout: 'Report', name: 'Report 2' }]);
    const set = store.privilegeSet('Limited')!;
    assert.deepEqual(Object.keys(set.layoutAccess ?? {}), ['Report 2'], 'key moved to the new name');
    // The live privilege check keeps the restriction instead of falling back to the blanket "viewOnly".
    assert.equal(store.privilegesForSet('Limited').layout('Report 2').layout, 'none');
  });
});

test('deleting a layout drops its access entry', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'deleteLayout', layout: 'Report' }]);
    assert.deepEqual(store.privilegeSet('Limited')!.layoutAccess ?? {}, {});
  });
});

test('renaming a script re-keys its access entry (no escalation)', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'updateScript', script: 'Export', name: 'Export 2' }]);
    const set = store.privilegeSet('Limited')!;
    assert.deepEqual(Object.keys(set.scriptAccess ?? {}), ['Export 2']);
    assert.equal(store.privilegesForSet('Limited').script('Export 2'), 'none');
  });
});

test('deleting a script drops its access entry', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'deleteScript', script: 'Export' }]);
    assert.deepEqual(store.privilegeSet('Limited')!.scriptAccess ?? {}, {});
  });
});

test('renaming a value list re-keys its access entry (no escalation)', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'updateValueList', valueList: 'Parties', name: 'Parties 2' }]);
    const set = store.privilegeSet('Limited')!;
    assert.deepEqual(Object.keys(set.valueListAccess ?? {}), ['Parties 2']);
    assert.equal(store.privilegesForSet('Limited').valueList('Parties 2'), 'none');
  });
});

test('deleting a value list drops its access entry', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'deleteValueList', valueList: 'Parties' }]);
    assert.deepEqual(store.privilegeSet('Limited')!.valueListAccess ?? {}, {});
  });
});

test('renaming a base table re-keys its per-table privileges', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'renameTable', table: 'People', name: 'Humans' }]);
    const set = store.privilegeSet('Limited')!;
    assert.deepEqual(Object.keys(set.tables ?? {}), ['Humans'], 'table entry moved');
    assert.equal(set.tables!.Humans.fields?.Party, 'none', 'field restriction kept');
    // The live check still limits Humans rather than falling back to the blanket "view all".
    const p = store.privilegesForSet('Limited');
    assert.equal(p.table('Humans').view, 'Party = "D"');
    assert.equal(p.field('Humans', 'Party'), 'none');
  });
});

test('deleting a base table drops its per-table privileges', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'deleteTable', table: 'People' }]);
    const set = store.privilegeSet('Limited')!;
    assert.equal(set.tables?.People, undefined, 'the whole entry (and its field keys) is gone');
  });
});

test('renaming a field re-keys its access and rewrites record-access rule calcs', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'updateField', table: 'People', field: 'Party', name: 'Affiliation' }]);
    const tp = store.privilegeSet('Limited')!.tables!.People;
    // The field-level "none" follows the rename...
    assert.equal(tp.fields?.Affiliation, 'none');
    assert.equal(tp.fields?.Party, undefined);
    // ...and the record-limit rule now names the new field, so it keeps matching.
    assert.equal(tp.view, 'Affiliation = "D"');
    assert.equal(store.privilegesForSet('Limited').field('People', 'Affiliation'), 'none');
  });
});

test('deleting a field drops its access entry and marks the rule calc as missing', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'deleteField', table: 'People', field: 'Party' }]);
    const tp = store.privilegeSet('Limited')!.tables!.People;
    assert.equal(tp.fields?.Party, undefined);
    // The rule referenced the now-deleted field; it is marked missing (fails closed) rather than silently naming a gone field.
    assert.match(tp.view as string, /Field Missing/);
  });
});

test('renaming an extended privilege re-keys its grant (no lockout)', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'updateExtendedPrivilege', extendedPrivilege: 'cloud_sync', name: 'cloud_sync_v2' }]);
    const set = store.privilegeSet('Limited')!;
    assert.deepEqual(set.extendedPrivileges, ['fmmcp', 'cloud_sync_v2'], 'the grant followed the rename, not left behind under the old name');
  });
});

test('deleting an extended privilege drops its grant', () => {
  withStore((store) => {
    store.applyDesign([{ op: 'deleteExtendedPrivilege', extendedPrivilege: 'cloud_sync' }]);
    const set = store.privilegeSet('Limited')!;
    assert.deepEqual(set.extendedPrivileges, ['fmmcp']);
  });
});

test('[Full Access] is never rewritten', () => {
  withStore((store) => {
    const before = JSON.stringify(store.privilegeSets().find((p) => p.id === 1));
    store.applyDesign([{ op: 'renameTable', table: 'People', name: 'Humans' }]);
    assert.equal(JSON.stringify(store.privilegeSets().find((p) => p.id === 1)), before);
  });
});

test('security health flags access keys left behind by an earlier rename', () => {
  withStore((store) => {
    // Simulate a file converted before the fix: a set restricting objects by names that no longer exist.
    store.savePrivilegeSet({
      name: 'Stale',
      records: { view: true, edit: true, create: true, delete: true },
      tables: { People: { view: true, edit: true, create: true, delete: true, fields: { Ghost: 'none' } }, Gone: { view: false, edit: false, create: false, delete: false } },
      layouts: 'viewOnly',
      layoutAccess: { 'Old Layout': { layout: 'none', records: 'none' } },
      valueLists: 'viewOnly',
      scripts: 'viewOnly',
      scriptAccess: { 'Old Script': 'none' },
      extendedPrivileges: [],
    });
    const orphaned = store.securityHealth().orphanedAccessKeys.find((o) => o.set === 'Stale')!;
    assert.ok(orphaned, 'the stale set is flagged');
    assert.deepEqual(orphaned.layouts, ['Old Layout']);
    assert.deepEqual(orphaned.scripts, ['Old Script']);
    assert.deepEqual(orphaned.tables, ['Gone']);
    assert.deepEqual(orphaned.fields, [{ table: 'People', fields: ['Ghost'] }]);
    // The "Limited" set names only live objects, so it is not flagged.
    assert.equal(store.securityHealth().orphanedAccessKeys.some((o) => o.set === 'Limited'), false);
  });
});

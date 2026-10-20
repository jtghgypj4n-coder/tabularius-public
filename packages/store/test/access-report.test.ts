// The ground-truth access report and the no-op privilege-set diff behind the
// "ask about access" tools: every answer is grounded in these facts (the exact
// rule, verbatim) and a proposed set is only ever shown as a diff — nothing here
// changes the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, type PrivilegeDefinition } from '../src/index.ts';
import { accessReport, diffPrivilegeSet } from '../src/access-report.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-access-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

const viewer: PrivilegeDefinition = {
  name: 'Viewer',
  records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  extendedPrivileges: ['fmapp'],
};

test('accessReport reports a set\'s record rules as plain facts', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(viewer);
    const r = store.accessReport('Viewer');
    assert.equal(r.privilegeSet, 'Viewer');
    assert.equal(r.fullAccess, false);
    assert.deepEqual(r.extendedPrivileges, ['fmapp']);
    assert.equal(r.menuCommands, 'all');
    // Every table falls under the default rule: may view, may not edit/create/delete.
    assert.deepEqual(r.defaultRecords.view, { allowed: true });
    assert.deepEqual(r.defaultRecords.edit, { allowed: false });
    assert.equal(r.defaultRecords.create, false);
    const congress = r.tables.find((t) => t.table === 'Congress')!;
    assert.equal(congress.default, true, 'no per-table entry, so it is the default');
    assert.deepEqual(congress.view, { allowed: true });
    assert.deepEqual(congress.delete, { allowed: false });
  });
});

test('accessReport quotes a per-record rule verbatim', { skip }, () => {
  withStore((store) => {
    const rule = 'Congress::State = "NY"';
    store.savePrivilegeSet({
      ...viewer,
      tables: { Congress: { view: rule, edit: false, create: false, delete: false } },
    });
    const r = store.accessReport('Viewer');
    const congress = r.tables.find((t) => t.table === 'Congress')!;
    assert.equal(congress.default, undefined, 'it has its own entry now');
    assert.deepEqual(congress.view, { allowed: 'limited', rule }, 'the calculation is cited exactly');
  });
});

test('accessReport lists restricted fields', { skip }, () => {
  withStore((store) => {
    const field = store.schema.tables.find((t) => t.name === 'Grades')!.fields[0].name;
    store.savePrivilegeSet({
      ...viewer,
      tables: { Grades: { view: true, edit: false, create: false, delete: false, fields: { [field]: 'none' } } },
    });
    const r = store.accessReport('Viewer');
    const grades = r.tables.find((t) => t.table === 'Grades')!;
    assert.deepEqual(grades.fields, [{ field, access: 'none' }]);
  });
});

test('accessReport reports [Full Access] with effective extended privileges', { skip }, () => {
  withStore((store) => {
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    const r = store.accessReport(full.name);
    assert.equal(r.fullAccess, true);
    const p = store.privilegesForSet(full.name);
    assert.deepEqual(new Set(r.extendedPrivileges.map((e) => e.toLowerCase())), new Set([...full.extendedPrivileges.map((e) => e.toLowerCase()), 'fmmcp']));
    for (const keyword of ['fmrest', 'fmapp', 'fmmcp', 'fmodata', 'fmxml', 'fmxdbc']) {
      assert.equal(r.extendedPrivileges.some((e) => e.toLowerCase() === keyword), p.has(keyword), keyword);
    }
    assert.equal(r.layouts.default, 'modifiable');
    assert.deepEqual(r.layouts.exceptions, []);
    assert.ok(r.tables.every((t) => t.view.allowed === true && t.create === true));
  });
});

test('accessReport throws for an unknown set', { skip }, () => {
  withStore((store) => {
    assert.throws(() => store.accessReport('Nope'), /No privilege set "Nope"/);
  });
});

test('diffPrivilegeSet describes a new set against no access', () => {
  const changes = diffPrivilegeSet(viewer);
  const detail = changes.map((c) => c.detail).join('\n');
  assert.ok(changes.some((c) => c.area === 'records'), 'the default record rule changed from no access');
  assert.match(detail, /view yes/);
  assert.ok(changes.some((c) => c.area === 'layouts' && /viewOnly/.test(c.detail)));
  assert.ok(changes.some((c) => c.area === 'extendedPrivileges' && /grant fmapp/.test(c.detail)));
});

test('diffPrivilegeSet shows only the delta against a base', () => {
  const proposed: PrivilegeDefinition = {
    ...viewer,
    comment: 'can now edit',
    records: { view: true, edit: true, create: false, delete: false },
    extendedPrivileges: ['fmapp', 'fmrest'],
  };
  const changes = diffPrivilegeSet(proposed, viewer);
  const areas = changes.map((c) => c.area);
  assert.ok(areas.includes('records'), 'records changed');
  assert.ok(changes.some((c) => c.area === 'extendedPrivileges' && /grant fmrest/.test(c.detail)));
  assert.ok(changes.some((c) => c.area === 'comment'));
  // Layouts/scripts/value lists are unchanged, so no line for them.
  assert.ok(!areas.includes('layouts'));
  assert.ok(!areas.includes('scripts'));
});

test('store.diffPrivilegeSet validates and never saves', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(viewer);
    const before = store.privilegeSet('Viewer')!;
    const out = store.diffPrivilegeSet({ ...viewer, records: { view: true, edit: true, create: true, delete: false } }, 'Viewer');
    assert.equal(out.valid, true);
    assert.ok(out.changes.some((c) => c.area === 'records'));
    // The stored set is untouched: the diff is a preview only.
    assert.deepEqual(store.privilegeSet('Viewer')!.records, before.records);
  });
});

test('store.diffPrivilegeSet rejects an invalid proposal', { skip }, () => {
  withStore((store) => {
    assert.throws(() => store.diffPrivilegeSet({ name: 'Bad', records: { view: 'maybe' } }));
  });
});

// Queue 10.3: the diff now covers per-table fields and the per-object exception
// maps (layoutAccess/scriptAccess/valueListAccess), not just the default levels —
// so a compare of two sets that differ only there is not silently shown as equal.
test('diffPrivilegeSet covers field, layout, script and value-list exceptions', () => {
  const base: PrivilegeDefinition = {
    name: 'Set', records: { view: true, edit: false, create: false, delete: false },
    tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
    layoutAccess: { Dashboard: { layout: 'viewOnly', records: 'viewOnly' } },
    scriptAccess: { Nightly: 'none' },
    valueListAccess: { States: 'none' },
    extendedPrivileges: [],
  };
  const proposed: PrivilegeDefinition = {
    ...base,
    tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'viewOnly' } } },
    layoutAccess: { Dashboard: { layout: 'modifiable', records: 'modifiable' } },
    scriptAccess: { Nightly: 'viewOnly' },
    valueListAccess: {},
  };
  const changes = diffPrivilegeSet(proposed, base);
  const detail = changes.map((c) => c.detail).join('\n');
  assert.match(detail, /Congress\.Secret field → viewOnly/);
  assert.ok(changes.some((c) => c.area === 'layouts' && /layout "Dashboard" → layout modifiable, records modifiable/.test(c.detail)));
  assert.ok(changes.some((c) => c.area === 'scripts' && /script "Nightly" → viewOnly/.test(c.detail)));
  // States override ('none') removed → it now follows the 'viewOnly' default: an effective change.
  assert.ok(changes.some((c) => c.area === 'valueLists' && /value list "States" → viewOnly/.test(c.detail)));
});

// Regression (cold review): the default-table field map (records.fields) applies
// to every table with no rule of its own and must be diffed — missing it would
// report two sets as identical while one hides a field across all tables.
test('diffPrivilegeSet catches a difference only in default-table field access', () => {
  const a: PrivilegeDefinition = {
    name: 'S', records: { view: true, edit: true, create: false, delete: false, fields: { SSN: 'none' } },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
  };
  const b: PrivilegeDefinition = { ...a, records: { view: true, edit: true, create: false, delete: false } }; // SSN now modifiable everywhere
  const changes = diffPrivilegeSet(b, a);
  assert.ok(changes.some((c) => c.area === 'records' && /default field "SSN" → modifiable/.test(c.detail)), 'the hidden-field difference is reported, not missed');
  // And the reverse is reported too (symmetry).
  assert.ok(diffPrivilegeSet(a, b).some((c) => /default field "SSN" → none/.test(c.detail)));
});

// Regression (cold review): an override pinned to the same level as the default
// is not an effective difference and must not be reported.
test('diffPrivilegeSet does not report an exception equal to the default', () => {
  const a: PrivilegeDefinition = {
    name: 'S', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
    scriptAccess: {}, valueListAccess: {}, extendedPrivileges: [],
  };
  const b: PrivilegeDefinition = {
    ...a,
    scriptAccess: { Nightly: 'viewOnly' },      // pinned to the 'viewOnly' default
    valueListAccess: { States: 'viewOnly' },    // pinned to the 'viewOnly' default
    layoutAccess: { Dash: { layout: 'viewOnly', records: 'modifiable' } }, // equals the computed default
  };
  const changes = diffPrivilegeSet(b, a);
  assert.deepEqual(changes, [], 'overrides equal to the default are not differences');
});

test('two identical sets diff to nothing, and the compare omits the rename line', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({ ...viewer, name: 'A' });
    store.savePrivilegeSet({ ...viewer, name: 'B' });
    const out = store.comparePrivilegeSets('A', 'B');
    assert.equal(out.a, 'A');
    assert.equal(out.b, 'B');
    assert.deepEqual(out.changes, [], 'same access, and no spurious name/rename change');
  });
});

test('comparePrivilegeSets reports the delta and rejects an unknown set', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({ ...viewer, name: 'A' });
    store.savePrivilegeSet({ ...viewer, name: 'B', records: { view: true, edit: true, create: false, delete: false }, extendedPrivileges: ['fmapp', 'fmrest'] });
    const out = store.comparePrivilegeSets('A', 'B');
    assert.ok(out.changes.some((c) => c.area === 'records'));
    assert.ok(out.changes.some((c) => c.area === 'extendedPrivileges' && /grant fmrest/.test(c.detail)));
    assert.ok(!out.changes.some((c) => c.area === 'name'), 'no rename line in a two-set compare');
    assert.throws(() => store.comparePrivilegeSets('A', 'Nope'), /No privilege set "Nope"/);
  });
});

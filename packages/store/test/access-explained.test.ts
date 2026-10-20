// "View as": everything an account or privilege set can open and change, said
// in plain English with a reason for every denial. The facts come from
// accessReport; this layer turns each rule, field level, layout/script level
// and extended privilege into a sentence, and adds an account entry point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

/** Build Charts with a custom "Sales" set: limited view on Congress, one view-only
 *  field, no other tables visible, one openable (view-only) layout and one runnable
 *  script, and only the Data API extended privilege. Bind an account to it. */
function sales(): { store: Store; dir: string; congressField: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-viewas-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  const congressField = store.schema.tables.find((t) => t.name === 'Congress')!.fields[0].name;
  store.savePrivilegeSet({
    name: 'Sales',
    records: { view: true, edit: false, create: false, delete: false }, // every other table: view only
    tables: {
      Congress: { view: 'Get(AccountName) = "seller"', edit: false, create: false, delete: false, fields: { [congressField]: 'viewOnly' } },
    },
    layouts: 'none',
    layoutAccess: { Congress: { layout: 'modifiable', records: 'viewOnly' } },
    valueLists: 'none',
    scripts: 'none',
    scriptAccess: { 'Show Senate': 'viewOnly' },
    extendedPrivileges: ['fmrest'],
  });
  store.setPassword('seller', 'seller-pw-123', 'Sales');
  return { store, dir, congressField };
}

test('a privilege set: a reason for every table, field, layout, script and surface', { skip }, () => {
  const { store, dir, congressField } = sales();
  try {
    const x = store.accessExplained({ privilegeSet: 'Sales' });
    assert.equal(x.target, 'privilege set "Sales"');
    assert.equal(x.privilegeSet, 'Sales');
    assert.equal(x.fullAccess, false);

    const congress = x.tables.find((t) => t.table === 'Congress')!;
    assert.equal(congress.view.allowed, 'limited');
    assert.match(congress.view.why, /only records where this rule is true: Get\(AccountName\)/);
    assert.equal(congress.view.rule, 'Get(AccountName) = "seller"');
    assert.equal(congress.edit.allowed, false);
    assert.match(congress.edit.why, /can't edit any record in Congress/);
    assert.equal(congress.create.allowed, false);
    const field = congress.fields.find((f) => f.field === congressField)!;
    assert.equal(field.access, 'viewOnly');
    assert.match(field.why, /can see this field but not change it/);

    // A table with no entry of its own: the default (view: true) applies.
    const other = x.tables.find((t) => t.table === 'US Population')!;
    assert.equal(other.default, true);
    assert.equal(other.view.allowed, true);
    assert.match(other.view.why, /can see every record in US Population/);
    assert.equal(other.edit.allowed, false);

    // Surfaces: granted vs not, each with a plain reason.
    const rest = x.surfaces.find((s) => s.surface === 'fmrest')!;
    assert.equal(rest.allowed, true);
    assert.match(rest.why, /Data API/);
    const mcp = x.surfaces.find((s) => s.surface === 'fmmcp')!;
    assert.equal(mcp.allowed, false);
    assert.match(mcp.why, /needs the fmmcp extended privilege/);

    const layout = x.layouts.exceptions.find((l) => l.layout === 'Congress')!;
    assert.equal(layout.canOpen, true);
    assert.equal(layout.canEditRecords, false);
    assert.match(layout.why, /only view its records/);

    const script = x.scripts.exceptions.find((s) => s.script === 'Show Senate')!;
    assert.match(script.why, /can run this script/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('an account is viewed through its own set, named in the summary', { skip }, () => {
  const { store, dir } = sales();
  try {
    const x = store.accessExplained({ account: 'seller' });
    assert.equal(x.target, 'account "seller" (privilege set "Sales")');
    assert.equal(x.privilegeSet, 'Sales');
    assert.match(x.summary, /can see records in \d+ of \d+ tables/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a full-access account says so plainly', { skip }, () => {
  const { store, dir } = sales();
  try {
    const x = store.accessExplained({ account: 'Admin' });
    assert.equal(x.fullAccess, true);
    assert.match(x.summary, /full access/);
    const p = store.privileges('Admin');
    for (const surface of x.surfaces) assert.equal(surface.allowed, p.has(surface.surface), surface.surface);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('an unknown account, or neither account nor set, is a clear error', { skip }, () => {
  const { store, dir } = sales();
  try {
    assert.throws(() => store.accessExplained({ account: 'nobody' }), /No account "nobody"/);
    assert.throws(() => store.accessExplained({}), /account or a privilege set/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// Regression (cold review of Queue 10.2): a field set to "none" on a table the
// set CAN view must not be explained as "the set can't view records" — that
// table shows View = Yes; only the one field is hidden. And a custom-rule table
// must not be flagged as following the default. And a non-canonical extended
// privilege keyword (e.g. "Fmrest") is still enforced, so its surface is allowed.
test('a hidden field on a viewable table, a custom-rule flag, and odd-case surfaces', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-viewas-reg-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  const congress = store.schema.tables.find((t) => t.name === 'Congress')!;
  const hidden = congress.fields[0].name;
  store.savePrivilegeSet({
    name: 'OddCase',
    records: { view: true, edit: false, create: false, delete: false },
    // Congress is viewable, but one field is set to no access at all.
    tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { [hidden]: 'none' } } },
    layouts: 'none', valueLists: 'none', scripts: 'none',
    extendedPrivileges: ['Fmrest'], // non-canonical case; has() matches it case-insensitively
  });
  try {
    const x = store.accessExplained({ privilegeSet: 'OddCase' });

    // The table is viewable — the hidden field's reason must say so, not claim the table is invisible.
    const t = x.tables.find((tt) => tt.table === 'Congress')!;
    assert.equal(t.view.allowed, true);
    assert.notEqual(t.default, true, 'a table with its own rule is not flagged as following the default');
    const f = t.fields.find((ff) => ff.field === hidden)!;
    assert.equal(f.access, 'none');
    assert.match(f.why, /hidden for this set/);
    assert.doesNotMatch(f.why, /can't view records/);

    // A table with no rule of its own IS flagged as following the default.
    const other = x.tables.find((tt) => tt.table === 'US Population')!;
    assert.equal(other.default, true);

    // The odd-cased keyword is enforced, so the Data API surface is allowed.
    const rest = x.surfaces.find((s) => s.surface === 'fmrest')!;
    assert.equal(rest.allowed, true, 'a non-canonical "Fmrest" keyword still grants the Data API');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

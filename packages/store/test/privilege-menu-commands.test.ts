// "Available menu commands" and per-layout record access round-trip through
// savePrivilegeSet, validate, and the Privileges helper — the model behind the
// Manage Security editor's parity with FileMaker's Edit Privilege Set dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, type PrivilegeDefinition } from '../src/index.ts';
import { validateDefinition } from '../src/privileges.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-menucmd-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

const base: PrivilegeDefinition = {
  name: 'Viewer',
  records: { view: true, edit: false, create: false, delete: false },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly',
  extendedPrivileges: ['fmapp'],
};

test('menuCommands and per-layout record access round-trip through save/load', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({
      ...base,
      menuCommands: 'minimum',
      // A layout the account can open, but only to view records through.
      layoutAccess: { Congress: { layout: 'modifiable', records: 'viewOnly' } },
    });
    store.setPassword('Viewer', 'pw', 'Viewer');
    const back = store.privilegeSets().find((p) => p.name === 'Viewer')!;
    assert.equal(back.menuCommands, 'minimum');
    assert.deepEqual(back.layoutAccess, { Congress: { layout: 'modifiable', records: 'viewOnly' } });

    const pv = store.privileges('Viewer');
    assert.equal(pv.menuCommands, 'minimum');
    assert.deepEqual(pv.layout('Congress'), { layout: 'modifiable', records: 'viewOnly' });
    // A layout with no override falls back to the default level, records modifiable.
    assert.equal(pv.layout('Grades').layout, 'viewOnly');
  });
});

test('menuCommands defaults to all, and [Full Access] is always all', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet(base); // no menuCommands
    store.setPassword('Viewer', 'pw', 'Viewer');
    assert.equal(store.privileges('Viewer').menuCommands, 'all', 'absent means all');

    const full = store.privilegeSets().find((p) => p.id === 1)!;
    // Even if someone tries to pin a level on [Full Access], it is dropped on
    // save (the getter returns 'all' for full access regardless).
    store.savePrivilegeSet({ ...full, menuCommands: 'minimum' } as PrivilegeDefinition);
    assert.equal(store.privilegeSet(full.name)!.menuCommands, undefined, '[Full Access] stores no level');
  });
});

test('an unknown menuCommands value is rejected', { skip }, () => {
  assert.throws(() => validateDefinition({ ...base, menuCommands: 'some' }), /menuCommands must be all, editing or minimum/);
  // The three valid levels pass.
  for (const level of ['all', 'editing', 'minimum'] as const) {
    assert.equal(validateDefinition({ ...base, menuCommands: level }).menuCommands, level);
  }
});

// Get ( AccountExtendedPrivileges ) returns the keywords the signed-in
// account's privilege set carries — standard and custom — so a solution can
// gate features on a custom extended privilege the way FileMaker does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, extendedPrivilegesOf } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('Get(AccountExtendedPrivileges) lists the account set\'s keywords, custom ones included', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-extpriv-'));
  importFmp12(fixture, join(dir, 'C.sqlite'));
  const store = new Store(join(dir, 'C.sqlite'));
  try {
    // A limited set carrying a custom keyword alongside a standard one.
    store.savePrivilegeSet({
      name: 'Exporter',
      records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'none', scripts: 'viewOnly',
      extendedPrivileges: ['fmrest', 'canExport'],
    });
    store.setPassword('clerk', 'pw', 'Exporter');

    assert.deepEqual(extendedPrivilegesOf(store, 'clerk'), ['fmrest', 'canExport']);

    const list = store.evaluate('Congress', 'Get ( AccountExtendedPrivileges )', undefined, { account: 'clerk' });
    assert.deepEqual(list.value.split('\r').sort(), ['canExport', 'fmrest']);

    // The idiom a solution uses to gate on a custom keyword.
    const gated = store.evaluate('Congress',
      'not IsEmpty ( FilterValues ( Get ( AccountExtendedPrivileges ) ; "canExport" ) )', undefined, { account: 'clerk' });
    assert.equal(gated.value, '1');
    const denied = store.evaluate('Congress',
      'not IsEmpty ( FilterValues ( Get ( AccountExtendedPrivileges ) ; "canAdmin" ) )', undefined, { account: 'clerk' });
    assert.equal(denied.value, '0');

    // Revoking the keyword is reflected at once (Tabularius's saved set wins).
    store.savePrivilegeSet({
      name: 'Exporter',
      records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'none', scripts: 'viewOnly',
      extendedPrivileges: ['fmrest'],
    });
    assert.deepEqual(extendedPrivilegesOf(store, 'clerk'), ['fmrest']);
    const after = store.evaluate('Congress', 'Get ( AccountExtendedPrivileges )', undefined, { account: 'clerk' });
    assert.equal(after.value, 'fmrest');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('an account with no privilege set has no extended privileges', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-extpriv2-'));
  importFmp12(fixture, join(dir, 'C.sqlite'));
  const store = new Store(join(dir, 'C.sqlite'));
  try {
    assert.deepEqual(extendedPrivilegesOf(store, 'nobody'), []);
    const r = store.evaluate('Congress', 'Get ( AccountExtendedPrivileges )', undefined, { account: 'nobody' });
    assert.equal(r.value, '');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

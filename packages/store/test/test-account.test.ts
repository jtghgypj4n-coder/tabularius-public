// "Test this account": every layout and script, as the account's own privileges
// would actually meet them, including script steps that reach for a layout or
// script it can't use. Builds on "view as" (access-explained.test.ts), but walks
// the whole file instead of explaining one target.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), 'tabularius-test-account-')); });
after(() => { if (dir) rmSync(dir, { recursive: true }); });

function blank(name: string): Store {
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  return new Store(path, name);
}

test('every layout and script, with the scripts that try to jump somewhere this account can\'t reach', () => {
  const store = blank('Scratch');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createLayout', name: 'Open', occurrence: 'T' },
    { op: 'createLayout', name: 'Closed', occurrence: 'T' },
    { op: 'createScript', name: 'Helper' },
  ]);
  store.applyDesign([{ op: 'createScript', name: 'Jump', text: 'Go to Layout [Closed]\nPerform Script [Helper]' }]);
  store.savePrivilegeSet({
    name: 'Limited',
    records: { view: true, edit: true, create: true, delete: true },
    layouts: 'none',
    layoutAccess: { Open: { layout: 'modifiable', records: 'modifiable' } },
    valueLists: 'none',
    scripts: 'none',
    scriptAccess: { Jump: 'viewOnly' },
    extendedPrivileges: [],
  });
  store.setPassword('tester', 'tester-pw-123', 'Limited');

  const result = store.testAccount('tester');
  assert.equal(result.account, 'tester');
  assert.equal(result.privilegeSet, 'Limited');

  const open = result.layouts.find((l) => l.layout === 'Open')!;
  assert.equal(open.access, 'modifiable');
  const closed = result.layouts.find((l) => l.layout === 'Closed')!;
  assert.equal(closed.access, 'none');

  const jump = result.scripts.find((s) => s.script === 'Jump')!;
  assert.equal(jump.access, 'viewOnly', 'runnable, just not editable');
  assert.deepEqual(jump.blocked, [
    { line: 1, step: 'Go to Layout', target: 'layout', name: 'Closed' },
    { line: 2, step: 'Perform Script', target: 'script', name: 'Helper' },
  ]);

  const helper = result.scripts.find((s) => s.script === 'Helper')!;
  assert.equal(helper.access, 'none', 'not granted on its own, even though Jump performs it');
  assert.deepEqual(helper.blocked, [], 'a script this account can\'t run at all is not walked for its own steps');
});

test('a disabled step is skipped, and a script this account can\'t run isn\'t walked for blocked steps', () => {
  const store = blank('Disabled');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
    { op: 'createLayout', name: 'Closed', occurrence: 'T' },
  ]);
  store.applyDesign([{ op: 'createScript', name: 'Runnable', text: 'Go to Layout [Closed]' }]);
  store.applyDesign([{ op: 'createScript', name: 'NotRunnable', text: 'Go to Layout [Closed]' }]);
  // Disable the one step in "Runnable" so it isn't reported as blocked.
  const script = store.schema.scripts.find((s) => s.name === 'Runnable')!;
  store.applyDesign([{ op: 'updateScript', script: script.id, steps: [{ ...script.steps[0], enabled: false }] }]);
  store.savePrivilegeSet({
    name: 'NoLayouts',
    records: { view: true, edit: true, create: true, delete: true },
    layouts: 'none', valueLists: 'none',
    scripts: 'none', scriptAccess: { Runnable: 'viewOnly' },
    extendedPrivileges: [],
  });
  store.setPassword('tester2', 'tester-pw-123', 'NoLayouts');

  const result = store.testAccount('tester2');
  const runnable = result.scripts.find((s) => s.script === 'Runnable')!;
  assert.deepEqual(runnable.blocked, [], 'the disabled step is never reached');
  const notRunnable = result.scripts.find((s) => s.script === 'NotRunnable')!;
  assert.equal(notRunnable.access, 'none');
  assert.deepEqual(notRunnable.blocked, [], 'not granted, so never walked for its steps');
});

test('an unknown account is a clear error', () => {
  const store = blank('Unknown');
  assert.throws(() => store.testAccount('nobody'), (e) => e instanceof StoreError && /No account "nobody"/.test(e.message));
});

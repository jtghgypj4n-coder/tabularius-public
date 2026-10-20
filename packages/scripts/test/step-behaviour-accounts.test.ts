import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('accounts');
h.store.savePrivilegeSet({ name: 'Step Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
h.store.setPassword('Admin', 'admin-password', '[Full Access]');
after(h.close);

test('account steps add and deactivate an account, and report duplicate names through LastError', async () => {
  const cases = [
    { step: 'Add Account [ Account Name: "script-reader" ; Password: "pw" ; Privilege Set: "Step Readers" ]', expect: 'script-reader' },
    { step: 'Enable Account [ Account Name: "script-reader" ; Deactivate ]', expect: 'inactive' },
  ];
  for (const c of cases) {
    const r = await h.run(`${c.step}\nExit Script [ Text Result: Get ( LastError ) ]`, {
      account: 'Admin', privileges: h.store.privileges('Admin'),
    });
    assert.equal(r.result, '0');
    const account = h.store.accounts().find((a) => a.name === 'script-reader');
    assert.ok(account);
    if (c.expect === 'inactive') assert.equal(account.inactive, true);
    else assert.equal(account.name, c.expect);
  }
  // Claris doesn't name Add Account's duplicate-name code; assert only a nonzero current engine result.
  const duplicate = await h.run('Set Error Capture [ On ]\nAdd Account [ Account Name: "script-reader" ; Password: "pw" ; Privilege Set: "Step Readers" ]\nExit Script [ Text Result: Get ( LastError ) ]', {
    account: 'Admin', privileges: h.store.privileges('Admin'),
  });
  assert.notEqual(Number(duplicate.result), 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { reviewPrivileges } from '../src/privilege-review.ts';

test('constant record rules on empty and populated tables are reviewed by their value', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tab-privrev-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  t.after(() => store.close());
  store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }] }]);
  const check = (rule: string) => {
    store.savePrivilegeSet({
      name: 'Sales', records: { view: false, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [],
      tables: { Orders: { view: rule, edit: false, create: false, delete: false } },
    });
    return reviewPrivileges(store).findings.some((f) => f.kind === 'always-true-rule' && f.privilegeSet === 'Sales' && f.table === 'Orders');
  };
  assert.equal(check('1 = 0'), false);
  assert.equal(check('1 = 1'), true);
  assert.equal(check('1 +'), false, 'unreadable rules are skipped');
  for (let i = 1; i <= 3; i++) store.create('Orders', { Id: String(i) });
  assert.equal(check('1 = 0'), false);
  assert.equal(check('1 = 1'), true);
});

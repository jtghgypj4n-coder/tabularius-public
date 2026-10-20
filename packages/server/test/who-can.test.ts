// "Who can see this?": accounts grouped by privilege set, with record rules, hidden fields and the AI tool's gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/index.ts';
import { whoCan } from '../src/who-can.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('who can see a table and a field, by privilege set', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-whocan-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir, () => {});
  t.after(() => { host.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  const store = host.get('Charts')!;
  const table = [...store.schema.tables].sort((a, b) => b.fields.length - a.fields.length)[0];
  const [first, second] = table.fields.map((f) => f.name);
  const open = { view: true, edit: true, create: true, delete: false };
  store.savePrivilegeSet({ name: 'Staff', records: open, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'], tables: { [table.name]: { ...open, fields: { [first]: 'none', [second]: 'viewOnly' } } } });
  store.savePrivilegeSet({ name: 'Looker', records: { view: 'Get ( AccountName ) = "x"', edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.savePrivilegeSet({ name: 'Blind', records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('sam', 'sam-pw-1234', 'Staff');
  store.setPassword('sue', 'sue-pw-1234', 'Staff');
  store.setPassword('lee', 'lee-pw-1234', 'Looker');
  store.setPassword('bo', 'bo-pw-1234', 'Blind');
  store.setPassword('gone', 'gone-pw-1234', 'Staff');
  store.setAccountActive('gone', false);

  const r = whoCan(store, table.name.toUpperCase());
  const by = (n: string) => r.sets.find((s) => s.privilegeSet === n)!;
  assert.deepEqual(by('Staff').accounts, ['sam', 'sue'], 'a disabled account is not counted');
  assert.equal(by('Staff').view, 'all records');
  assert.equal(by('Staff').delete, 'no');
  assert.deepEqual(by('Staff').hiddenFields, [first]);
  assert.deepEqual(by('Staff').readOnlyFields, [second]);
  assert.equal(by('Looker').view, 'some records', 'a record rule reads as some records');
  assert.equal(by('Blind').view, 'no');
  assert.ok(r.canSee.includes('sam') && r.canSee.includes('lee') && !r.canSee.includes('bo') && !r.canSee.includes('gone'));
  assert.match(by('Staff').says, new RegExp(`^Staff \\(sam, sue\\) can see all records, change all records, add new ones and not delete; cannot see ${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.$`));

  // One field alone: hidden from Staff, visible to Looker's rule-limited rows.
  const f = whoCan(store, table.name, first);
  const fs = (n: string) => f.sets.find((s) => s.privilegeSet === n)!;
  assert.equal(fs('Staff').view, 'no');
  assert.equal(fs('Looker').view, 'some records');
  assert.ok(!f.canSee.includes('sam'));
  const g = whoCan(store, table.name, second);
  assert.equal(g.sets.find((s) => s.privilegeSet === 'Staff')!.edit, 'no', 'a view-only field can be seen, not changed');

  assert.throws(() => whoCan(store, 'Nope'), /No table named/);
  assert.throws(() => whoCan(store, table.name, 'Nope'), /No field/);
  // Names only: no record values anywhere in the answer.
  assert.ok(!JSON.stringify(r).includes('"values"'));
});

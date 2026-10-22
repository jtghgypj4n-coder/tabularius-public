// An omit request leaves out the records that match; a record whose field is empty does not match, so it stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('omitting on a field leaves the records whose field is empty', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tab-omit-'));
  const path = join(dir, 'F.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Status' }, { name: 'Number', type: 'number' }, { name: 'Day', type: 'date' }] }]);
  const a = store.create('Items', { Status: 'active', Number: 1, Day: '2026-01-01' }).recordId;
  const b = store.create('Items', { Status: 'inactive', Number: 2, Day: '2026-01-02' }).recordId;
  const c = store.create('Items', {}).recordId;
  const ids = (query: Record<string, string | number>[]) => store.find('Items', { query }).records.map((r) => r.recordId).sort((x, y) => x - y);
  assert.deepEqual(ids([{ Number: '2', omit: 'true' }]), [a, c], 'number, equality');
  assert.deepEqual(ids([{ Number: '==2', omit: 'true' }]), [a, c], 'number, ==');
  assert.deepEqual(ids([{ Day: '2026-01-02', omit: 'true' }]), [a, c], 'date');
  assert.deepEqual(ids([{ Status: '==inactive', omit: 'true' }]), [a, c], 'text, ==');
  assert.deepEqual(ids([{ Status: 'inactive', omit: 'true' }]), [a, c], 'text');
  assert.deepEqual(ids([{ Number: '>1', omit: 'true' }]), [a, c], 'range, as before');
  assert.deepEqual(ids([{ Status: '*' }, { Number: '2', omit: 'true' }]), [a], 'a find then an omit: only records with a status');
  assert.deepEqual(ids([{ Number: '2' }]), [b], 'the same criterion without omit is unchanged');
});

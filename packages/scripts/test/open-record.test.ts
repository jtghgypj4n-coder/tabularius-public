// Open Record/Request: FileMaker's 301 when another user is editing the
// record, and 200 when the account may view the record but not edit it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-open-'));
  createStore(join(dir, 'Jobs.sqlite'));
  store = new Store(join(dir, 'Jobs.sqlite'), 'Jobs');
  store.applyDesign([{ op: 'createTable', name: 'Things', fields: [{ name: 'Id', type: 'number' }, { name: 'Name', type: 'text' }] }]);
  for (let i = 1; i <= 2; i++) store.create('Things', { Id: String(i), Name: `thing ${i}` });
  store.applyDesign([{ op: 'createScript', id: 1, name: 'Open', text: [
    'Set Error Capture [ On ]',
    'Open Record/Request',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n') }]);
  const common = { layouts: 'modifiable' as const, valueLists: 'none' as const, scripts: 'viewOnly' as const, extendedPrivileges: [] };
  store.savePrivilegeSet({ name: 'ReadOnly', ...common, records: { view: true, edit: false, create: false, delete: false } });
  store.savePrivilegeSet({ name: 'Editor', ...common, records: { view: true, edit: true, create: true, delete: true } });
  store.setPassword('reader', 'reader-pw-1234', 'ReadOnly');
  store.setPassword('editor', 'editor-pw-1234', 'Editor');
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const first = () => store.findIds('Things')[0];
const open = (account?: string) =>
  runScript(store, 'Open', { layout: 'Things', foundSet: [first()], ...(account ? { account, privileges: store.privileges(account) } : {}) });

test('opening a record no one else is editing succeeds', async () => {
  assert.equal((await open()).result, '0');
  assert.equal((await open('editor')).result, '0');
});

test('a record another user is editing gives 301', async () => {
  assert.ok(store.locks.acquire('Things', first(), 'someone-else', 'Bea').ok);
  try {
    assert.equal((await open('editor')).result, '301');
    // The caller's own lock is no obstacle.
    assert.equal((await writer.run({ owner: 'someone-else', account: 'Bea' }, () => open('editor'))).result, '0');
  } finally {
    store.locks.release('Things', first(), 'someone-else');
  }
});

test('an account that may only view records gives 200', async () => {
  assert.equal((await open('reader')).result, '200');
});

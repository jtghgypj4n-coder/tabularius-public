import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, verifyRecordAudit, writer } from '@tabularius/store';
import { runScript } from '../src/index.ts';

function withStore(run: (store: Store, path: string, ids: number[]) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-windows-'));
    const path = join(dir, 'Items.sqlite');
    createStore(path);
    const store = new Store(path, 'Items');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
      const ids = ['one', 'two', 'three'].map((Name) => store.create('Items', { Name }).recordId);
      await run(store, path, ids);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

// Claris: https://help.claris.com/en/pro-help/content/open-transaction.html
// Actions in another window commit outside the originating window's transaction.
test('a different window commits to the same file while originating writes remain pending and revert', withStore(async (store, path, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Window writes', text: [
    'Open Transaction',
    'Set Field [ Items::Name ; "pending" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'New Window [ "Outside" ]',
    'Go to Record/Request/Page [ Last ]',
    'Set Field [ Items::Name ; "outside" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Select Window [ Name: "Items" ]',
    'Revert Transaction',
    'Commit Transaction',
  ].join('\n') }]);
  let inspected = false;
  const result = await writer.run({ owner: 'session-a', account: 'Ann' }, () => runScript(store, 'Window writes', {
    layout: 'Items', foundSet: ids, recordId: ids[0], account: 'Ann',
    debug: (point) => {
      if (point.index !== 7) return;
      const peer = new DatabaseSync(path, { readOnly: true });
      try {
        const rows = peer.prepare('SELECT Name FROM Items ORDER BY _fm_record_id').all() as { Name: string }[];
        assert.deepEqual(rows.map((row) => row.Name), ['one', 'two', 'outside']);
        inspected = true;
      } finally { peer.close(); }
    },
  }));
  assert.equal(result.error, 0);
  assert.equal(inspected, true);
  assert.deepEqual(ids.map((id) => store.get('Items', id).fieldData.Name), ['one', 'two', 'outside']);
  assert.equal(verifyRecordAudit(path).ok, true);
}));

test('another window cannot edit the record held by the originating transaction, even with the same session', withStore(async (store, _path, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Locked window', text: [
    'Set Error Capture [ On ]',
    'Set Revert Transaction on Error [ Off ]',
    'Open Transaction',
    'Set Field [ Items::Name ; "pending" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Go to Record/Request/Page [ Next ]',
    'New Window [ "Outside" ]',
    'Go to Record/Request/Page [ First ]',
    'Set Field [ Items::Name ; "refused" ]',
    'Set Variable [ $error ; Value: Get ( LastError ) ]',
    'Select Window [ Name: "Items" ]',
    'Revert Transaction',
    'Commit Transaction',
    'Exit Script [ Result: $error ]',
  ].join('\n') }]);
  const result = await writer.run({ owner: 'session-a', account: 'Ann' }, () => runScript(store, 'Locked window', {
    layout: 'Items', foundSet: ids, recordId: ids[0], account: 'Ann',
  }));
  assert.equal(result.result, '301');
  assert.equal(store.get('Items', ids[0]).fieldData.Name, 'one');
}));

test('an outside creation keeps a distinct ID from the transaction creation and survives its revert', withStore(async (store, path, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Two new records', text: [
    'Open Transaction',
    'New Record/Request',
    'Set Field [ Items::Name ; "pending new" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'New Window [ "Outside" ]',
    'New Record/Request',
    'Set Field [ Items::Name ; "outside new" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Select Window [ Name: "Items" ]',
    'Revert Transaction',
    'Commit Transaction',
  ].join('\n') }]);
  const result = await runScript(store, 'Two new records', { layout: 'Items', foundSet: ids, recordId: ids[0] });
  assert.equal(result.error, 0);
  const records = store.findIds('Items');
  assert.deepEqual(records, [...ids, ids[2] + 2]);
  assert.equal(store.get('Items', records.at(-1)!).fieldData.Name, 'outside new');
  assert.equal(verifyRecordAudit(path).ok, true);
}));

test('repeated outside writes stay committed when the originating transaction commits later', withStore(async (store, path, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Repeated outside writes', text: [
    'Open Transaction',
    'Set Field [ Items::Name ; "inside" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'New Window [ "Outside" ]',
    'Go to Record/Request/Page [ Last ]',
    'Set Field [ Items::Name ; "outside last" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Go to Record/Request/Page [ Previous ]',
    'Set Field [ Items::Name ; "outside middle" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Select Window [ Name: "Items" ]',
    'Commit Transaction',
  ].join('\n') }]);
  const audited: number[] = [];
  const result = await writer.run({ onAudit: (_file, seq) => audited.push(seq) }, () => runScript(store, 'Repeated outside writes', {
    layout: 'Items', foundSet: ids, recordId: ids[0],
  }));
  assert.equal(result.error, 0);
  assert.deepEqual(ids.map((id) => store.get('Items', id).fieldData.Name), ['inside', 'outside middle', 'outside last']);
  assert.deepEqual(audited.sort((a, b) => a - b), store.auditLog({ script: 'Repeated outside writes' }).map((entry) => entry.seq).sort((a, b) => a - b));
  assert.equal(verifyRecordAudit(path).ok, true);
}));

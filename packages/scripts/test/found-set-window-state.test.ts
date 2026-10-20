import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

function withStore(fn: (store: Store, ids: number[]) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-found-window-'));
    const path = join(dir, 'Test.sqlite');
    createStore(path);
    const store = new Store(path, 'Test');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
        { name: 'Name', type: 'text' }, { name: 'Group', type: 'text' },
      ] }]);
      const ids = ['C', 'A', 'B'].map((name, i) => Number(store.create('Items', { Name: name, Group: i === 1 ? 'Other' : 'Keep' }).recordId));
      store.applyDesign([
        { op: 'createLayout', name: 'Same table', occurrence: 'Items' },
        { op: 'createOccurrence', name: 'Items alias', table: 'Items' },
        { op: 'createLayout', name: 'Alias layout', occurrence: 'Items alias' },
      ] as never);
      await fn(store, ids);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('omitted and sorted set, current record survive layouts of the same table, including another occurrence', withStore(async (store, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Layout tour', text: [
    'Sort Records [ Restore; Items::Name; ascending; With dialog: Off ]',
    'Go to Record/Request/Page [ First ]',
    'Omit Record',
    'Go to Record/Request/Page [ Last ]',
    'Go to Layout [ "Same table" ]',
    'Go to Layout [ "Items" ]',
    'Go to Layout [ "Alias layout" ]',
  ].join('\n') }]);
  const r = await runScript(store, 'Layout tour', { layout: 'Items', foundSet: ids });
  assert.equal(r.error, 0);
  assert.deepEqual(r.foundSet, [ids[2], ids[0]]);
  assert.equal(r.recordId, ids[0]);
  assert.deepEqual(r.sort, [{ fieldName: 'Name', sortOrder: 'ascend' }]);
}));

test('replacing the set on an alias layout also updates the original layout', withStore(async (store, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Replace set', text: [
    'Go to Layout [ "Alias layout" ]',
    'Show All Records',
    'Go to Layout [ "Items" ]',
  ].join('\n') }]);
  const r = await runScript(store, 'Replace set', { layout: 'Items', foundSet: [ids[2]] });
  assert.equal(r.error, 0);
  assert.deepEqual(r.foundSet, ids);
}));

test('a subscript changes its caller window; a new window copies then separates set, sort and current record', withStore(async (store, ids) => {
  store.applyDesign([
    { op: 'createScript', name: 'Child', text: 'Omit Record\nGo to Record/Request/Page [ Last ]' },
    { op: 'createScript', name: 'Windows', text: [
      'Sort Records [ Restore; Items::Name; ascending; With dialog: Off ]',
      'Go to Record/Request/Page [ First ]',
      'Perform Script [ “Child” ]',
      'New Window [ "Second" ]',
      'Set Variable [ $copy ; Value: Get ( FoundCount ) & "/" & Get ( RecordNumber ) ]',
      'Show All Records',
      'Unsort Records',
      'Go to Record/Request/Page [ First ]',
      'Select Window [ Name: "Test" ]',
      'Exit Script [ Text Result: $copy ]',
    ].join('\n') },
  ]);
  const r = await runScript(store, 'Windows', { layout: 'Items', foundSet: ids });
  assert.equal(r.error, 0);
  assert.equal(r.result, '2/2');
  assert.deepEqual(r.foundSet, [ids[2], ids[0]]);
  assert.equal(r.recordId, ids[0]);
  assert.deepEqual(r.sort, [{ fieldName: 'Name', sortOrder: 'ascend' }]);
}));

test('a new record joins another window showing all records but stays omitted from a subset', withStore(async (store, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Create across windows', text: [
    'New Window [ "All A" ]',
    'New Window [ "All B" ]',
    'Select Window [ Name: "Test" ]',
    'Omit Record',
    'New Window [ "Subset" ]',
    'Select Window [ Name: "All A" ]',
    'New Record/Request',
    'Set Field [ Items::Name ; "new" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Set Variable [ $all ; Value: Get ( FoundCount ) ]',
    'Select Window [ Name: "All B" ]',
    'Set Variable [ $other ; Value: Get ( FoundCount ) ]',
    'Select Window [ Name: "Subset" ]',
    'Exit Script [ Text Result: $all & "/" & $other & "/" & Get ( FoundCount ) ]',
  ].join('\n') }]);
  const r = await runScript(store, 'Create across windows', { layout: 'Items', foundSet: ids, recordId: ids[0] });
  assert.equal(r.error, 0);
  assert.equal(r.result, '4/4/2');
  assert.deepEqual(r.foundSet, [ids[1], ids[2]]);
}));

test('a supplied background window showing all records gains a new record without moving its current record', withStore(async (store, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Create for background', text: [
    'New Record/Request',
    'Set Field [ Items::Name ; "new" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Select Window [ Name: "Background" ]',
    'Go to Layout [ "Items" ]',
  ].join('\n') }]);
  const front = { id: 'A', name: 'Front', layout: 'Items' };
  const background = { id: 'B', name: 'Background', layout: 'Items', foundSet: ids, recordId: ids[1] };
  const r = await runScript(store, 'Create for background', {
    layout: 'Items', foundSet: ids, recordId: ids[0], startWindow: front, openWindows: [background, front],
  });
  assert.equal(r.error, 0);
  assert.equal(r.window?.id, 'B');
  assert.equal(r.foundSet?.length, 4);
  assert.equal(r.recordId, ids[1]);
}));

test('Show Omitted Only complements the window set', withStore(async (store, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Omitted', text: [
    'Omit Record', 'Show Omitted Only',
  ].join('\n') }]);
  const r = await runScript(store, 'Omitted', { layout: 'Items', foundSet: [ids[1], ids[0]], recordId: ids[1] });
  assert.equal(r.error, 0);
  assert.deepEqual(r.foundSet, [ids[1], ids[2]]);
}));

test('a server script called inside a transaction commits in its separate session', withStore(async (store, ids) => {
  store.applyDesign([
    { op: 'createScript', name: 'Server edit', text: 'Set Field [ Items::Name ; "server" ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'createScript', name: 'Caller transaction', text: [
      'Set Error Capture [ On ]',
      'Open Transaction',
      'Perform Script on Server [ “Server edit” ; Wait for completion: On ]',
      'Set Field [ Items::Name ; "rolled back" ]',
      'Revert Transaction [ Error code: 5002 ]',
      'Commit Transaction',
    ].join('\n') },
  ]);
  const r = await runScript(store, 'Caller transaction', { layout: 'Items', foundSet: ids, recordId: ids[2] });
  assert.equal(r.error, 5002);
  assert.equal(store.get('Items', ids[0]).fieldData.Name, 'server');
  assert.equal(store.get('Items', ids[2]).fieldData.Name, 'B');
}));

test('another window commits outside the originating transaction, which remains open when selected again', withStore(async (store, ids) => {
  store.applyDesign([{ op: 'createScript', name: 'Window transaction', text: [
    'Set Error Capture [ On ]',
    'Open Transaction',
    'New Window [ "Outside" ]',
    'Go to Record/Request/Page [ Last ]',
    'Set Field [ Items::Name ; "persists" ]',
    'Commit Records/Requests [ With dialog: Off ]',
    'Select Window [ Name: "Test" ]',
    'Set Field [ Items::Name ; "rolled back" ]',
    'Revert Transaction [ Error code: 5001 ]',
    'Commit Transaction',
  ].join('\n') }]);
  const r = await runScript(store, 'Window transaction', { layout: 'Items', foundSet: ids, recordId: ids[0] });
  assert.equal(r.error, 5001);
  assert.equal(store.get('Items', ids[0]).fieldData.Name, 'C');
  assert.equal(store.get('Items', ids[2]).fieldData.Name, 'persists');
}));

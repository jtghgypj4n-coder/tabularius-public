// A required field is checked when a script's new record is committed, not at
// New Record (a private sample's record-creating script failed at New Record with 509),
// and test-scripts runs signed in as the file's own full-access account, so
// Get ( AccountName ) gives a name as it would in FileMaker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript, testScripts } from '../src/index.ts';

test('test-scripts fills Get ( AccountName ) from the file\'s full-access account', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-testrun-account-'));
  createStore(join(dir, 'C.sqlite'));
  const store = new Store(join(dir, 'C.sqlite'), 'C');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Campaigns', fields: [
      { name: 'Name', type: 'text' },
      { name: 'CreatedBy', type: 'text', options: { autoEnter: { value: 'creationAccountName' }, validation: { always: true, notEmpty: true } } },
    ] }]);
    store.applyDesign([{ op: 'createScript', name: 'New campaign', text: 'New Record/Request\nSet Field [ Campaigns::Name ; "Spring" ]\nSet Field [ Campaigns::CreatedBy ; Get ( AccountName ) ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Campaigns::CreatedBy ]' }]);
    // No account: nothing to fill the field with, as before.
    const [none] = await testScripts(store, { scripts: ['New campaign'] });
    assert.equal(none.error, 509);
    store.setPassword('Manager', 'not-used-here', '[Full Access]');
    const [r] = await testScripts(store, { scripts: ['New campaign'] });
    assert.equal(r.outcome, 'ok', r.message);
    assert.equal(r.error, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('New Record leaves required fields to the commit, which fails when they are still empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-new-record-'));
  createStore(join(dir, 'N.sqlite'));
  const store = new Store(join(dir, 'N.sqlite'), 'N');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [
      { name: 'Code', type: 'text', options: { validation: { always: true, notEmpty: true } } },
    ] }]);
    let n = 0;
    const run = async (text: string) => {
      const name = `Script ${++n}`;
      store.applyDesign([{ op: 'createScript', name, text }]);
      return runScript(store, name, { layout: 'Orders' });
    };
    const set = await run('New Record/Request\nSet Field [ Orders::Code ; "A1" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) & "/" & Orders::Code ]');
    assert.equal(set.result, '0/A1');
    const empty = await run('Set Error Capture [ On ]\nNew Record/Request\nCommit Records/Requests [ With dialog: Off ]\nSet Variable [ $e ; Value: Get ( LastError ) ]\nRevert Record/Request [ With dialog: Off ]\nExit Script [ Text Result: $e & "/" & Get ( FoundCount ) ]');
    assert.equal(empty.result, '509/1');
    assert.equal(store.findIds('Orders').length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

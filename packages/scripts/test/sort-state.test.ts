import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

// Get ( SortState ): 0 not sorted, 1 sorted, 2 semi-sorted (Claris Pro Help "Get(SortState)").
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sortstate-'));
  createStore(join(dir, 'S.sqlite'));
  const s = new Store(join(dir, 'S.sqlite'), 'S');
  t.after(() => { s.close(); rmSync(dir, { recursive: true }); });
  s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }]);
  const ids = ['b', 'a', 'c'].map((a) => s.create('T', { A: a }).recordId);
  let n = 0;
  return async (text: string) => {
    const name = `Run ${++n}`;
    s.applyDesign([{ op: 'createScript', name, text }]);
    return runScript(s, name, { layout: 'T', foundSet: ids, recordId: ids[0] });
  };
}
const state = 'Set Variable [ $s ; Value: $s & Get ( SortState ) ]';
const sort = 'Sort Records [ Restore; T::A; ascending; With dialog: Off ]';

test('Get ( SortState ): 0 before a sort, 1 after it, 2 once a record is created or changed, 0 after Unsort', async (t) => {
  const run = await setup(t);
  const r = await run([state, sort, state, 'New Record/Request', state, sort, state, 'Set Field [ T::A ; "z" ]', 'Commit Records/Requests [ With dialog: Off ]', state, 'Unsort Records', state, 'Exit Script [ Text Result: $s ]'].join('\n'));
  assert.equal(r.error, 0);
  assert.equal(r.result, '012120');
});

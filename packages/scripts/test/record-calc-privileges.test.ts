// Record-level "limited" privileges — view, edit and delete rules that are
// calculations — must hold inside scripts too, not only on the Data API. A
// script running without full access edits and deletes through the same store
// checks, so a per-record edit or delete calc decides each write.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-rcpriv-'));
  importFmp12(fixture, join(dir, 'C.sqlite'));
  store = new Store(join(dir, 'C.sqlite'));
  // Sees every record; may edit only Democrats, delete only the lone independent.
  store.savePrivilegeSet({
    name: 'Steward',
    records: { view: true, edit: 'Party = "D"', create: false, delete: 'Party = "I"' },
    layouts: 'viewOnly', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('steward', 'pw', 'Steward');
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const id = (where: string) => Number((store.query(`SELECT _fm_record_id AS id FROM Congress WHERE ${where} LIMIT 1`)[0] as { id: number }).id);
const stateOf = (rid: number) => (store.query(`SELECT State FROM Congress WHERE _fm_record_id = ${rid}`)[0] as { State: string } | undefined)?.State;
const exists = (rid: number) => Number((store.query(`SELECT count(*) AS n FROM Congress WHERE _fm_record_id = ${rid}`)[0] as { n: number }).n) === 1;

const SetFieldByName = (field: string, value: string): ScriptStep =>
  ({ stepId: 147, name: 'Set Field By Name', enabled: true, params: { fieldName: `"${field}"`, calculation: `"${value}"` } as StepParams });
const Commit: ScriptStep = { stepId: 75, name: 'Commit Records/Requests', enabled: true, params: {} as StepParams };
const DeleteRecord: ScriptStep = { stepId: 9, name: 'Delete Record/Request', enabled: true, params: {} as StepParams };
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const run = (s: Script, rid: number) =>
  runScript(store, s, { layout: 'Congress', account: 'steward', privileges: store.privileges('steward'), foundSet: [rid] });

test('a script edits a record the edit calc allows, and is refused on one it forbids', { skip }, async () => {
  const democrat = id(`Party = 'D'`);
  const republican = id(`Party = 'R'`);

  const ok = await run(script(SetFieldByName('State', 'ZZ'), Commit), democrat);
  assert.equal(ok.error, 0, 'editing a record the calc allows succeeds');
  assert.equal(stateOf(democrat), 'ZZ', 'the change was written');

  const denied = await run(script(SetFieldByName('State', 'ZZ'), Commit), republican);
  assert.equal(denied.error, 200, 'editing a record the calc forbids is denied');
  assert.notEqual(stateOf(republican), 'ZZ', 'the forbidden record was not written');
});

test('a script deletes a record the delete calc allows, and is refused on one it forbids', { skip }, async () => {
  const democrat = id(`Party = 'D'`);
  const denied = await run(script(DeleteRecord), democrat);
  assert.equal(denied.error, 200, 'deleting a record the calc forbids is denied');
  assert.ok(exists(democrat), 'the record is still there');

  const independent = id(`Party = 'I'`);
  const ok = await run(script(DeleteRecord), independent);
  assert.equal(ok.error, 0, 'deleting a record the calc allows succeeds');
  assert.ok(!exists(independent), 'the record is gone');
});

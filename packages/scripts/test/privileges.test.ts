import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store, type PrivilegeDefinition } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

// Democrats only; edits only to Californians; no ACLU scores; names view only.
const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: false, edit: false, create: false, delete: false },
  tables: {
    Congress: { view: 'Party = "D"', edit: 'State = "California"', create: true, delete: false, fields: { ACLU: 'none', Name: 'viewOnly' } },
  },
  layouts: 'modifiable',
  layoutAccess: { Grades: { layout: 'none', records: 'none' } },
  valueLists: 'viewOnly',
  scripts: 'viewOnly',
  scriptAccess: { 'Show House': 'none' },
  extendedPrivileges: ['fmrest'],
};

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  store.savePrivilegeSet(clerk);
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const count = (where: string) => Number(store.query(`SELECT count(*) AS n FROM Congress WHERE ${where}`)[0].n);
const firstId = (where: string) => Number(store.query(`SELECT _fm_record_id AS id FROM Congress WHERE ${where} LIMIT 1`)[0].id);
const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (fullAccess: boolean, ...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps, ...(fullAccess ? { fullAccess } : {}) } as Script);
const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'Congress' }, field: { id: 0, name } });
const ShowAll = step(23, 'Show All Records');
const SetField = (name: string, calculation: string) => step(76, 'Set Field', { field: field(name), calculation });
const Commit = step(75, 'Commit Records/Requests');
const ExitScript = (c: string) => step(103, 'Exit Script', { calculation: c });
const ErrorCapture = step(86, 'Set Error Capture', { on: true } as StepParams);

const run = (s: Script, opts: { foundSet?: number[] } = {}) =>
  runScript(store, s, { layout: 'Congress', account: 'Clerk', privileges: store.privileges('Clerk'), ...opts });

test('scripts work within the account\'s privilege set', { skip }, async () => {
  const shown = await run(script(false, ShowAll, ExitScript('Get ( FoundCount ) & "|" & Get ( CurrentPrivilegeSetName ) & "|" & Congress::ACLU')));
  assert.equal(shown.result, `${count(`Party = 'D'`)}|Clerk|`, 'only viewable records, no ACLU score');

  const name = await run(script(false, ErrorCapture, SetField('Name', '"x"'), Commit, ExitScript('Get ( LastError )')), { foundSet: [firstId(`Party = 'D' AND State = 'California'`)] });
  assert.equal(name.result, '201', 'view-only field');

  const id = firstId(`Party = 'D' AND State <> 'California'`);
  const state = await run(script(false, ErrorCapture, SetField('State', '"Nevada"'), Commit, ExitScript('Get ( LastError )')), { foundSet: [id] });
  assert.equal(state.result, '200', 'edit rule');
  assert.notEqual(store.query(`SELECT State FROM Congress WHERE _fm_record_id = ${id}`)[0].State, 'Nevada');

  const layout = await run(script(false, ErrorCapture, step(6, 'Go to Layout', { layout: { id: 0, name: 'Grades' }, layoutDestination: 'named' } as StepParams), ExitScript('Get ( LastError ) & "|" & Get ( LayoutName )')));
  assert.equal(layout.result, '105|Congress', 'hidden layout');

  const house = store.schema.scripts.find((x) => x.name === 'Show House')!;
  const perform = step(1, 'Perform Script', { script: { id: house.id, name: house.name } } as StepParams);
  assert.equal((await run(script(false, ErrorCapture, perform, ExitScript('Get ( LastError )')))).result, '9', 'no access to the subscript');
  assert.equal((await run(script(true, ErrorCapture, perform, ExitScript('Get ( LastError )')))).result, '0', 'a full access script may call it');
});

test('"Run script with full access privileges" lifts the limits for that script only', { skip }, async () => {
  const r = await run(script(true, ShowAll, ExitScript('Get ( FoundCount ) & "|" & Get ( CurrentPrivilegeSetName ) & "|" & Get ( AccountPrivilegeSetName ) & "|" & ( Congress::ACLU <> "" )')));
  assert.equal(r.result, `${count('1 = 1')}|[Full Access]|Clerk|1`);
});

test('the reader decodes the full access option', { skip }, () => {
  // None of Charts' scripts set it; the option is key 241 on the script (see docs/research/fmp12-format.md).
  assert.ok(store.schema.scripts.every((s) => !s.fullAccess));
});

test('edits a full access script leaves uncommitted are written when the run ends', { skip }, async () => {
  const id = firstId(`Party = 'D' AND State <> 'California'`);
  const r = await run(script(true, SetField('State', '"Nevada"')), { foundSet: [id] });
  assert.equal(r.error, 0);
  assert.equal(store.query(`SELECT State FROM Congress WHERE _fm_record_id = ${id}`)[0].State, 'Nevada');
});

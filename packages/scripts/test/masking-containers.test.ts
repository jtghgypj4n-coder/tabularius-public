// A container field an account sees only as a stand-in is not readable by a script: Export Field Contents, Copy and
// printing give nothing of its file (a container has no stand-in that could show part of it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'DEMO_drawers.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;
let firstId: number;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mask-container-'));
  importFmp12(fixture, join(dir, 'D.sqlite'));
  store = new Store(join(dir, 'D.sqlite'));
  store.savePrivilegeSet({
    name: 'MaskedFile',
    records: { view: false, edit: false, create: false, delete: false },
    tables: { RECORD: { view: true, edit: false, create: false, delete: false, fields: { field_container_01: 'masked' } } },
    layouts: 'viewOnly', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('masked', 'pw', 'MaskedFile');
  firstId = Number(store.query('SELECT _fm_record_id AS id FROM RECORD LIMIT 1')[0].id);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps, fullAccess: false } as Script);
const container = { tableOccurrence: { id: 0, name: 'RECORD' }, field: { id: 0, name: 'field_container_01' }, repetition: 1 };
const run = (account: string | undefined, ...steps: ScriptStep[]) =>
  runScript(store, script(...steps), { layout: 'RECORD', foundSet: [firstId], ...(account ? { account, privileges: store.privileges(account) } : { account: 'Admin' }) });

test('Export Field Contents and Copy give nothing of a masked container', { skip }, async () => {
  const steps = [step(132, 'Export Field Contents', { field: container } as StepParams), step(47, 'Copy', { field: container } as StepParams)];
  const full = await run(undefined, ...steps);
  assert.ok(full.actions.some((a) => a.step === 'Export Field Contents' && a.filename), 'full access can export the file');
  assert.match(String(full.actions.find((a) => a.step === 'Copy')?.clipboard), /\.(jpg|jpeg|png|pdf)/i);
  const r = await run('masked', ...steps);
  assert.ok(!r.actions.some((a) => a.step === 'Export Field Contents'), 'no export is offered');
  assert.equal(r.actions.find((a) => a.step === 'Copy')?.clipboard, '', 'and nothing is copied');
});

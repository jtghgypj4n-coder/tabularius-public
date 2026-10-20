// A script running without full access cannot read a container field it has
// no access to. Container fields read straight from the store, so they need
// their own field-level check beyond the redaction that covers other fields.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  dir = mkdtempSync(join(tmpdir(), 'tabularius-cpriv-'));
  importFmp12(fixture, join(dir, 'D.sqlite'));
  store = new Store(join(dir, 'D.sqlite'));
  // A set that can see RECORD rows but not the container field.
  store.savePrivilegeSet({
    name: 'NoFile',
    records: { view: false, edit: false, create: false, delete: false },
    tables: { RECORD: { view: true, edit: false, create: false, delete: false, fields: { field_container_01: 'none' } } },
    layouts: 'viewOnly', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('limited', 'pw', 'NoFile');
  firstId = Number(store.query('SELECT _fm_record_id AS id FROM RECORD LIMIT 1')[0].id);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const ExitScript = (c: string): ScriptStep => ({ stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: c } as StepParams });
const script = (fullAccess: boolean, ...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps, ...(fullAccess ? { fullAccess } : {}) } as Script);
const fieldRef = (name: string) => ({ tableOccurrence: { id: 0, name: 'RECORD' }, field: { id: 0, name }, repetition: 1 });
const ExportRecords = (file: string, ...names: string[]): ScriptStep =>
  ({ stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [file], exportFormat: 'COMS', exportFields: names.map(fieldRef) } as unknown as StepParams });

test('a limited account can\'t read a no-access container through a script', { skip }, async () => {
  // A container in a text context reads as its file name. [Full Access] sees it;
  // the limited set, which has no access to the field, reads nothing.
  const read = (c: string) => ExitScript(c);

  const asFull = await runScript(store, script(true, read('RECORD::field_container_01 & "" & IsEmpty ( RECORD::field_container_01 )')),
    { layout: 'RECORD', account: 'Admin', foundSet: [firstId] });
  assert.match(String(asFull.result), /\.(jpg|jpeg|png|pdf)/i);
  assert.ok(asFull.result!.endsWith('0'), 'a full-access script sees the container as not empty');

  const asLimited = await runScript(store, script(false, read('RECORD::field_container_01 & "" & IsEmpty ( RECORD::field_container_01 )')),
    { layout: 'RECORD', account: 'limited', privileges: store.privileges('limited'), foundSet: [firstId] });
  assert.equal(asLimited.result, '1', 'the no-access container reads empty, so IsEmpty is true and no file name leaks');
});

test('Export Records leaves a no-access container empty', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-exp-'));
  try {
    await runScript(store, script(false, ExportRecords('out.csv', 'name', 'field_container_01')),
      { layout: 'RECORD', account: 'limited', privileges: store.privileges('limited'), foundSet: [firstId], documents: docs });
    const csv = readFileSync(join(docs, 'out.csv'), 'utf8').trim();
    // Two columns: a visible one and the no-access container. The container cell is empty.
    const [name, container] = csv.split('\n')[0].split('","').map((c) => c.replace(/^"|"$/g, ''));
    assert.ok(name.length > 0, 'the visible field exports its value');
    assert.equal(container, '', 'the no-access container exports nothing');
  } finally {
    rmSync(docs, { recursive: true });
  }
});

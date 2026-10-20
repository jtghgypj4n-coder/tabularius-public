// Masking in scripts: a script run by an account that sees a field only as a stand-in never reads its value. A
// masked field reads as empty (like a hidden one) through fields, GetField, Evaluate, ExecuteSQL, exports, PDFs,
// sorts, containers and imports; it is never written, and its stand-in is never copied anywhere as if it were the value.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;
/** The first record by id, and the record whose Name sorts first. */
let firstId: number;
let firstName: string;
let aName: { id: number; name: string };

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mask-script-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  const common = { layouts: 'modifiable' as const, valueLists: 'viewOnly' as const, scripts: 'modifiable' as const, extendedPrivileges: [] };
  const open = { view: true, edit: true, create: true, delete: false };
  // Name is masked (last four characters); State is a placeholder; ACLU is hidden.
  store.savePrivilegeSet({
    name: 'Masked', records: { view: false, edit: false, create: false, delete: false }, ...common,
    tables: { Congress: { ...open, fields: { Name: 'masked', State: 'masked', ACLU: 'none' }, masks: { State: { kind: 'placeholder', text: 'Hidden' } } } },
  });
  store.setPassword('maria', 'maria-pw-1234', 'Masked');
  firstId = Number(store.query('SELECT _fm_record_id AS id FROM Congress ORDER BY _fm_record_id LIMIT 1')[0].id);
  firstName = String(store.query(`SELECT Name FROM Congress WHERE _fm_record_id = ${firstId}`)[0].Name);
  const a = store.query('SELECT _fm_record_id AS id, Name FROM Congress ORDER BY Name COLLATE NOCASE LIMIT 1')[0];
  aName = { id: Number(a.id), name: String(a.Name) };
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const ExitScript = (c: string) => step(103, 'Exit Script', { calculation: c });
const fieldRef = (name: string) => ({ tableOccurrence: { id: 0, name: 'Congress' }, field: { id: 0, name }, repetition: 1 });
const ids = () => store.findIds('Congress');

const as = (account: string, docs: string | undefined, ...steps: ScriptStep[]) => asOn(account, docs, ids(), ...steps);
const asOn = (account: string, docs: string | undefined, foundSet: number[], ...steps: ScriptStep[]) =>
  runScript(store, script(...steps), {
    layout: 'Congress', account, foundSet, ...(account === 'maria' ? { privileges: store.privileges('maria') } : {}), ...(docs ? { documents: docs } : {}),
  });

test('a masked field reads as empty through fields, GetField, Evaluate and ExecuteSQL', { skip }, async () => {
  const read = ExitScript(
    `Congress::Name & "|" & GetField ( "Name" ) & "|" & Evaluate ( "Congress::Name" ) & "|" & Congress::State & "|" & ` +
    `ExecuteSQL ( "SELECT Name FROM Congress WHERE State = 'Alabama'" ; "" ; "" ) & "|" & ` +
    // A count on the real value would show whether it matches: it must not.
    `ExecuteSQL ( "SELECT COUNT(*) FROM Congress WHERE Name = '${firstName.replace(/'/g, "''")}'" ; "" ; "" ) & "|" & Congress::Party`);
  const full = await as('Admin', undefined, read);
  assert.ok(String(full.result).startsWith(`${firstName}|${firstName}|${firstName}|`), `full access reads the name: ${full.result}`);
  const r = await as('maria', undefined, read);
  const [name, getField, evaluated, state, sql, count, party] = String(r.result).split('|');
  assert.deepEqual([name, getField, evaluated, state], ['', '', '', ''], 'the stand-in is not the value a script reads either');
  assert.equal(sql, '', 'ExecuteSQL reads a masked column as empty');
  assert.equal(count, '0', 'and cannot be matched on it');
  assert.ok(party.length > 0, 'fields that are not masked still read');
});

test('Export Records, JSONL and PDF leave a masked field empty', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-mask-export-'));
  try {
    const exportBoth = (file: string) => step(36, 'Export Records', { filePaths: [file], exportFormat: 'COMS', exportFields: [fieldRef('Name'), fieldRef('Party')] });
    const toPdf = (file: string) => step(144, 'Save Records as PDF', { filePaths: [file] });
    const few = ids().slice(0, 3);
    const admin = await asOn('Admin', docs, few, exportBoth('admin.csv'), toPdf('admin.pdf'));
    assert.equal(admin.error, 0);
    assert.ok(readFileSync(join(docs, 'admin.csv'), 'utf8').includes(firstName), 'full access exports the names');
    const r = await asOn('maria', docs, few, exportBoth('maria.csv'), toPdf('maria.pdf'));
    assert.equal(r.error, 0);
    const csv = readFileSync(join(docs, 'maria.csv'), 'utf8');
    assert.ok(!csv.includes(firstName) && !csv.includes(firstName.slice(-6)), 'no name in the export');
    assert.ok(csv.split('\r\n')[0].startsWith('"",'), 'the Name column is empty');
    assert.ok(!readFileSync(join(docs, 'maria.pdf')).includes(firstName), 'no name in the PDF');
  } finally {
    rmSync(docs, { recursive: true, force: true });
  }
});

test('Sort Records by a masked field does not put the records in the order of their values', { skip }, async () => {
  const sorted = ExitScript('Get ( RecordID )');
  const sort = step(39, 'Sort Records', { noDialog: true, sort: [{ field: fieldRef('Name') as never, order: 'ascending' }] } as never);
  const first = step(16, 'Go to Record/Request/Page', { location: 'first' });
  const full = await as('Admin', undefined, sort, first, sorted);
  assert.equal(Number(full.result), aName.id, 'full access sorts by name');
  assert.notEqual(aName.id, firstId, 'the fixture has its first name somewhere else, so this test can tell');
  const r = await as('maria', undefined, sort, first, sorted);
  assert.equal(Number(r.result), firstId, 'a masked field sorts as empty: the records stay in record order');
});

test('a masked field cannot be set by a script', { skip }, async () => {
  const set = [
    step(86, 'Set Error Capture', { on: true }),
    step(76, 'Set Field', { field: fieldRef('Name') as never, calculation: '"Changed"' } as never),
    step(75, 'Commit Records/Requests', { noDialog: true } as never),
    ExitScript('Get ( LastError )'),
  ];
  const r = await as('maria', undefined, ...set);
  assert.notEqual(r.result, '0', 'the write is refused');
  assert.equal(store.query(`SELECT Name FROM Congress WHERE _fm_record_id = ${firstId}`)[0].Name, firstName, 'and nothing changed');
});

test('Import Records from a hosted FileMaker file brings a masked field in empty, not as its stand-in', { skip }, async () => {
  const congress = store.schema.tables.find((t) => t.name === 'Congress')!;
  const to = store.schema.tableOccurrences.find((t) => t.name === 'Congress')!;
  const id = (name: string) => congress.fields.find((f) => f.name === name)!.id;
  const ref = (name: string) => ({ tableOccurrence: { id: to.id, name: 'Congress' }, field: { id: id(name), name } });
  const lastBefore = Number(store.query('SELECT max(_fm_record_id) AS m FROM Congress')[0].m);
  const importName = step(35, 'Import Records', {
    noDialog: true, importFormat: 'FMPR', filePaths: ['file:Charts.fmp12'], tableOccurrence: { id: to.id, name: 'Congress' },
    importSource: { tableOccurrenceId: to.id, fieldIds: [id('Name')] },
    // Name -> Chamber: a field maria may write, so what lands in it is what was read.
    fieldMapping: [{ field: ref('Chamber'), import: true }],
  });
  const r = await as('maria', undefined, importName, ExitScript('Get ( LastError )'));
  assert.equal(r.result, '0');
  const added = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE _fm_record_id > ${lastBefore}`)[0].n);
  assert.ok(added > 0, 'records were imported');
  const chambers = store.query(`SELECT DISTINCT Chamber AS c FROM Congress WHERE _fm_record_id > ${lastBefore}`).map((x) => String(x.c ?? ''));
  assert.deepEqual(chambers.filter((c) => c !== ''), [], 'no name, and no stand-in, was written into the imported records');
});

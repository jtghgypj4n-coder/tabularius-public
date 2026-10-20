// Tests against the public sample files; run `npm run fixtures` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, FmpError, FmpFile } from '../src/index.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const path = (f: string) => join(dir, f);
const skip = existsSync(path('FMburgh_2012_11_07_Database.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

test('header and block chain', { skip }, () => {
  const db = FmpDatabase.open(path('Charts.fmp12'));
  assert.equal(db.file.header.format, 'HBAM7');
  assert.equal(db.file.header.creator, 'Pro 12.0');
  assert.equal(db.file.blockCount, 668);
  let leaves = 0;
  for (const _ of db.file.leaves()) leaves++;
  assert.ok(leaves > 100);
});

test('text after the last block (a consistency check log) is ignored', { skip }, () => {
  const bytes = readFileSync(path('Charts.fmp12'));
  const log = new TextEncoder().encode('2026-07-19 18:12:40.488 -0400\t\t0\t*** Completed consistency check, checked 668 block(s)\n');
  const db = new FmpDatabase(new Uint8Array([...bytes, ...log]));
  assert.equal(db.file.blockCount, 668);
  assert.equal(db.schema.tables.length, FmpDatabase.open(path('Charts.fmp12')).schema.tables.length);
});

test('every chunk decodes without errors', { skip }, () => {
  for (const f of ['Charts.fmp12', 'FMburgh_2012_11_07_Database.fmp12', 'PortableCode39-2.fmp12', 'Standards.fmp12']) {
    const errors: string[] = [];
    for (const _ of new FmpFile(FmpDatabase.open(path(f)).file.source).chunks((b, e) => errors.push(`${b.id}: ${e.message}`)));
    assert.deepEqual(errors, [], f);
  }
});

test('schema: tables, field kinds and types', { skip }, () => {
  const s = FmpDatabase.open(path('FMburgh_2012_11_07_Database.fmp12')).schema;
  assert.deepEqual(s.tables.map((t) => t.name), ['Basic', 'Comics_Normalized', 'Comics_Muddled', 'Orders_Schema', 'Orders_Script', 'Comics_Entry']);
  const entry = s.tables.find((t) => t.name === 'Comics_Entry')!;
  const f = Object.fromEntries(entry.fields.map((x) => [x.name, `${x.kind}/${x.type}`]));
  assert.equal(f.DateCollected, 'normal/date');
  assert.equal(f.Volume, 'normal/number');
  assert.equal(f.y_TitleCount, 'summary/number');
  const charts = FmpDatabase.open(path('Charts.fmp12')).schema;
  const calc = charts.tables.flatMap((t) => t.fields).find((x) => x.name === 'Total Sales')!;
  assert.equal(calc.kind, 'calculation');
});

test('schema: table occurrences, layouts, scripts, value lists', { skip }, () => {
  const s = FmpDatabase.open(path('FMburgh_2012_11_07_Database.fmp12')).schema;
  assert.deepEqual(s.tableOccurrences.map((t) => [t.name, t.baseTableId]).slice(0, 2), [['Basic', 129], ['Comics_Normalized', 130]]);
  const layout = s.layouts.find((l) => l.name === 'DE - Orders - Schema')!;
  assert.equal(layout.tableOccurrenceId, 132);
  // Layouts with no fields on them still name their occurrence.
  assert.equal(s.layouts.find((l) => l.name === 'Main Menu')!.tableOccurrenceId, 129);
  assert.equal(s.layouts.find((l) => l.name === 'DE - Orders')!.tableOccurrenceId, 133);
  assert.ok(!s.layouts.some((l) => l.name === '-' || l.name === 'COMIC TITLES'), 'folders and separators are not layouts');
  const script = s.scripts.find((x) => x.name === 'Duplicate Comic Book Title')!;
  assert.deepEqual(script.steps.map((x) => x.name), ['Duplicate Record/Request', '# (comment)', 'Set Field', '# (comment)', 'Exit Script']);
  assert.deepEqual(s.valueLists.find((v) => v.name === 'Comic_Status')!.values, ['Active', 'Inactive']);
  assert.deepEqual(s.dataSources, [{ id: 1, name: 'Preferences', paths: ['file:Preferences'] }]);
});

test('schema: security, custom functions, comments in scripts', { skip }, () => {
  const s = FmpDatabase.open(path('Standards.fmp12')).schema;
  assert.deepEqual(s.privilegeSets.map((p) => p.name), ['[Full Access]', '[Data Entry Only]', '[Read-Only Access]']);
  assert.ok(s.accounts.some((a) => a.name === 'Admin'));
  assert.deepEqual(s.customFunctions.find((c) => c.name === 'SetError')!.parameters, ['type', 'num', 'dialog', 'capture', 'halt']);
  const startup = s.scripts.find((x) => x.name === 'Startup')!;
  assert.ok(startup.steps.some((x) => x.text?.includes('Perform any startup steps')));
  const defaults = s.tables.find((t) => t.name === 'Defaults')!;
  assert.equal(defaults.fields.find((f) => f.name === 'id')!.comment, 'primary key');
  const install = s.scripts.find((x) => x.name === 'Developer Install Menu')!.steps.find((x) => x.stepId === 142)!;
  assert.deepEqual(install.params, { menuSet: { id: 3, name: 'Developer' }, fileDefault: true });
  assert.equal(install.line, 'Install Menu Set [ “Developer” ; Use as file default ]');
});

test('records: typed values and record ids beyond the two-byte range', { skip }, () => {
  const db = FmpDatabase.open(path('FMburgh_2012_11_07_Database.fmp12'));
  const first = db.records('Comics_Entry').next().value!;
  assert.deepEqual(first, { recordId: 1, fields: {} }); // an empty record still exists
  const rows = [...db.records('Comics_Entry')];
  assert.deepEqual(rows[1].fields, {
    Title: 'Amazing Fantasy', DateCollected: '2012-11-07', Type: 'Regular Series', Status: 'Active',
    Publisher: 'Marvel Comics Group', __kp_ComicId: '1', Volume: 1,
  });
  const ids = [...db.rawRecords('Orders_Schema')].map((r) => r.id);
  assert.equal(ids.length, 17911);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Math.max(...ids), 18305);
});

test('relationships: creation and deletion options per side', { skip: existsSync(path('Flicks.fmp12')) && existsSync(path('InterMediator_TestDB.fmp12')) ? false : 'fixtures missing' }, () => {
  const options = (file: string) => FmpDatabase.open(path(file)).schema.relationships
    .filter((r) => r.leftCreate || r.rightCreate || r.leftDelete || r.rightDelete)
    .map((r) => [r.leftTableOccurrence, r.rightTableOccurrence, !!r.leftCreate, !!r.rightCreate, !!r.leftDelete, !!r.rightDelete]);
  // Flicks' Design Report: RightTable cascadeCreate="True" on movie.TITLE~display only.
  assert.deepEqual(options('Flicks.fmp12'), [['MOVIE', 'movie.TITLE~display', false, true, false, false]]);
  assert.deepEqual(options('InterMediator_TestDB.fmp12'), [
    ['person_to', 'contact_to', false, true, false, false],
    ['person_to', 'history_to', false, true, false, false],
    ['registeredcontext', 'registeredpks', false, false, false, true],
  ]);
});

test('rejects files that are not FileMaker files', () => {
  assert.throws(() => new FmpFile(new Uint8Array(8192)), FmpError);
});

test('file options: the layout the file opens on and its window script triggers', { skip }, () => {
  assert.deepEqual(FmpDatabase.open(path('FMburgh_2012_11_07_Database.fmp12')).schema.fileOptions, { openLayoutId: 1, openLayout: 'Main Menu' });
  assert.deepEqual(FmpDatabase.open(path('Charts.fmp12')).schema.fileOptions, {
    onFirstWindowOpen: { scriptId: 7, script: '[trg] set layoutlist' }, openLayoutId: 36, openLayout: 'Chart Types • Choosing',
  });
});

test('page setup: paper, orientation and printer margins from the Mac page format', { skip: existsSync(path('Standards.fmp12')) && existsSync(path('Charts.fmp12')) && existsSync(path('InterMediator_TestDB.fmp12')) ? false : 'fixtures missing' }, () => {
  assert.deepEqual(FmpDatabase.open(path('Standards.fmp12')).schema.pageSetup, {
    orientation: 'landscape', paper: 'arch-b', width: 1296, height: 864, margins: { top: 18, left: 18, bottom: 18, right: 18 },
  });
  assert.deepEqual(FmpDatabase.open(path('Charts.fmp12')).schema.pageSetup, {
    orientation: 'portrait', paper: 'na-letter', width: 612, height: 792, margins: { top: 18, left: 18, bottom: 40, right: 18 },
  });
  assert.equal(FmpDatabase.open(path('InterMediator_TestDB.fmp12')).schema.pageSetup?.paper, 'iso-a4');
});

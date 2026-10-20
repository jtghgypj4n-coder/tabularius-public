// A privilege set that forbids exporting or printing must stop the matching
// script steps — Export Records / Save a Copy, and Save Records as PDF — so an
// imported "no export"/"no print" set is enforced, not silently ignored.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Privileges, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;
let firstId: number;

const RECORDS = { view: true, edit: true, create: true, delete: true };
before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-expriv-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  const commonSet = { records: RECORDS, layouts: 'modifiable' as const, valueLists: 'none' as const, scripts: 'none' as const, extendedPrivileges: [] };
  store.savePrivilegeSet({ name: 'NoExport', ...commonSet, exporting: false });
  store.savePrivilegeSet({ name: 'NoPrint', ...commonSet, printing: false });
  store.savePrivilegeSet({ name: 'MayExport', ...commonSet, exporting: true });
  for (const n of ['noexp', 'noprint', 'mayexp']) store.setPassword(n, `${n}-pw-1234`, { noexp: 'NoExport', noprint: 'NoPrint', mayexp: 'MayExport' }[n]!);
  firstId = Number(store.query('SELECT _fm_record_id AS id FROM Congress LIMIT 1')[0].id);
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const fieldRef = (name: string) => ({ tableOccurrence: { id: 0, name: 'Congress' }, field: { id: 0, name }, repetition: 1 });
const ExportRecords = (file: string): ScriptStep =>
  ({ stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [file], exportFormat: 'COMS', exportFields: [fieldRef('Name')] } as unknown as StepParams });
const SaveAsPdf = (file: string): ScriptStep =>
  ({ stepId: 144, name: 'Save Records as PDF', enabled: true, params: { filePaths: [file] } as unknown as StepParams });
const SaveAsJsonl = (file: string): ScriptStep =>
  ({ stepId: 225, name: 'Save Records as JSONL', enabled: true, params: { filePaths: [file] } as unknown as StepParams });
const ExportFieldContents = (): ScriptStep =>
  ({ stepId: 132, name: 'Export Field Contents', enabled: true, params: { field: fieldRef('Name') } as unknown as StepParams });
const SnapshotLink = (file: string): ScriptStep =>
  ({ stepId: 152, name: 'Save Records as Snapshot Link', enabled: true, params: { filePaths: [file] } as unknown as StepParams });

const run = (account: string, step: ScriptStep, docs: string) =>
  runScript(store, script(step), { layout: 'Congress', account, privileges: store.privileges(account), foundSet: [firstId], documents: docs });

test('Export Records is refused (error 9), with no file written, when the set forbids exporting', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-exp-'));
  try {
    const r = await run('noexp', ExportRecords('out.csv'), docs);
    assert.equal(r.error, 9, 'the privilege error');
    assert.equal(existsSync(join(docs, 'out.csv')), false, 'no export file is written');
  } finally { rmSync(docs, { recursive: true }); }
});

test('Save Records as PDF is refused (error 9), with no file written, when the set forbids printing', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-pdf-'));
  try {
    const r = await run('noprint', SaveAsPdf('out.pdf'), docs);
    assert.equal(r.error, 9, 'the privilege error');
    assert.equal(existsSync(join(docs, 'out.pdf')), false, 'no PDF is written');
  } finally { rmSync(docs, { recursive: true }); }
});

test('the other record-export steps are refused too: Save Records as JSONL, Export Field Contents, Snapshot Link', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-exp2-'));
  try {
    const jsonl = await run('noexp', SaveAsJsonl('dump.jsonl'), docs);
    assert.equal(jsonl.error, 9, 'Save Records as JSONL is gated');
    assert.equal(existsSync(join(docs, 'dump.jsonl')), false, 'no JSONL dump of the found set is written');

    const fieldOut = await run('noexp', ExportFieldContents(), docs);
    assert.equal(fieldOut.error, 9, 'Export Field Contents is gated');

    const snap = await run('noexp', SnapshotLink('out.fmpsl'), docs);
    assert.equal(snap.error, 9, 'Save Records as Snapshot Link is gated');
    assert.equal(existsSync(join(docs, 'out.fmpsl')), false, 'no snapshot link is written');
  } finally { rmSync(docs, { recursive: true }); }
});

test('a set that allows exporting still exports (the gate does not over-block)', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-ok-'));
  try {
    const r = await run('mayexp', ExportRecords('out.csv'), docs);
    assert.equal(r.error, 0, 'no error');
    assert.equal(existsSync(join(docs, 'out.csv')), true, 'the export file is written');
  } finally { rmSync(docs, { recursive: true }); }
});

test('the gate asks the file being exported from, not the file the script started in', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-xfile-'));
  try {
    // A script that started in another file where this account may export, now running in Charts, where it may not.
    const origin = new Privileges('noexp', store.privilegeSet('MayExport')!, {} /* another file */, (file) => (file === store ? store.privileges('noexp') : (undefined as never)));
    const r = await runScript(store, script(ExportRecords('out.csv')), { layout: 'Congress', account: 'noexp', privileges: origin, foundSet: [firstId], documents: docs });
    assert.equal(r.error, 9, 'the current file\'s set decides');
    assert.equal(existsSync(join(docs, 'out.csv')), false);
  } finally { rmSync(docs, { recursive: true }); }
});

test('the Print step is refused when the set forbids printing', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-print-'));
  try {
    const print: ScriptStep = { stepId: 43, name: 'Print', enabled: true, params: {} as unknown as StepParams };
    const denied = await run('noprint', print, docs);
    assert.equal(denied.error, 9);
    const allowed = await run('mayexp', print, docs);
    assert.equal(allowed.error, 0, 'a set that may print still gets the print dialog');
  } finally { rmSync(docs, { recursive: true }); }
});

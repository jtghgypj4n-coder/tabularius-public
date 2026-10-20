// Export Records to a .xml file writes FileMaker XML (FMPXMLRESULT) and to a
// .html file writes an HTML table, each holding the found set in order.
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
let ids: number[];
let names: string[];

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-expxml-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
  const rows = store.query('SELECT _fm_record_id AS id, Name FROM Congress ORDER BY _fm_record_id LIMIT 3');
  ids = rows.map((r) => Number(r.id));
  names = rows.map((r) => String(r.Name ?? ''));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const fieldRef = (name: string) => ({ tableOccurrence: { id: 0, name: 'Congress' }, field: { id: 0, name }, repetition: 1 });
const ExportRecords = (file: string, exportFormat?: string): ScriptStep =>
  ({ stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [file], exportFormat, exportFields: [fieldRef('Name')] } as unknown as StepParams });
const run = (step: ScriptStep, docs: string) => runScript(store, script(step), { layout: 'Congress', foundSet: ids, documents: docs });
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('Export Records to .xml writes FMPXMLRESULT with the fields and found set', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-exp-'));
  try {
    // The format code the step saved is overridden by the .xml name.
    const r = await run(ExportRecords('out.xml', 'COMS'), docs);
    assert.equal(r.error, 0);
    const xml = readFileSync(join(docs, 'out.xml'), 'utf8');
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><FMPXMLRESULT xmlns="http:\/\/www.filemaker.com\/fmpxmlresult">/);
    assert.match(xml, /<METADATA><FIELD EMPTYOK="YES" MAXREPEAT="1" NAME="Name" TYPE="TEXT"\/><\/METADATA>/);
    assert.match(xml, new RegExp(`<RESULTSET FOUND="${ids.length}">`));
    const rows = [...xml.matchAll(/<ROW MODID="0" RECORDID="(\d+)"><COL><DATA>(.*?)<\/DATA><\/COL><\/ROW>/g)];
    assert.deepEqual(rows.map((m) => Number(m[1])), ids);
    assert.deepEqual(rows.map((m) => m[2]), names.map(esc));
  } finally { rmSync(docs, { recursive: true }); }
});

test('Export Records to .html writes a table with a heading row and a row per record', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-exp-'));
  try {
    const r = await run(ExportRecords('out.html'), docs);
    assert.equal(r.error, 0);
    const html = readFileSync(join(docs, 'out.html'), 'utf8');
    assert.match(html, /<table border="1">\n<tr><th>Name<\/th><\/tr>\n/);
    const cells = [...html.matchAll(/<tr><td>(.*?)<\/td><\/tr>/g)].map((m) => m[1]);
    assert.deepEqual(cells, names.map(esc));
  } finally { rmSync(docs, { recursive: true }); }
});

test('Export Records still refuses formats it cannot write (error 3)', { skip }, async () => {
  const docs = mkdtempSync(join(tmpdir(), 'tabularius-exp-'));
  try {
    const r = await run(ExportRecords('out.dbf'), docs);
    assert.equal(r.error, 3);
  } finally { rmSync(docs, { recursive: true }); }
});

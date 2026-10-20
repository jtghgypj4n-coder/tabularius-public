// What Import Records and the web client's import read: text saved as UTF-16 or Windows-1252, semicolon and
// pipe files, a quote that never closes, FileMaker XML with line breaks, CDATA and the dates its DATEFORMAT
// describes, Excel workbooks with several sheets, the 1904 date system and phonetic runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, StepParams } from '@tabularius/fmp12';
import { createStore, Store, fmpXmlResult } from '@tabularius/store';
import { importFileRows, runScript } from '../src/index.ts';
import { readXlsx, xlsxSheetNames } from '../src/xlsx.ts';
import { workbook } from './workbook-parts.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const utf16le = (s: string, bom = true) => new Uint8Array([...(bom ? [0xff, 0xfe] : []), ...Buffer.from(s, 'utf16le')]);
const utf16be = (s: string) => { const le = Buffer.from(s, 'utf16le'); return new Uint8Array([0xfe, 0xff, ...le.map((_, i) => le[i ^ 1])]); };

test('text saved as UTF-16 (either byte order) or Windows-1252 is read as the text it holds', () => {
  const csv = 'Name,City\r\nZoë,Köln\r\n€5,naïve\r\n';
  const want = [['Name', 'City'], ['Zoë', 'Köln'], ['€5', 'naïve']];
  assert.deepEqual(importFileRows('a.csv', utf16le(csv)), want);
  assert.deepEqual(importFileRows('a.csv', utf16be(csv)), want);
  assert.deepEqual(importFileRows('a.csv', new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(csv)])), want);
  assert.deepEqual(importFileRows('a.csv', bytes(csv)), want);
  // Windows-1252: é is 0xE9 alone (not valid UTF-8), € is 0x80, ’ is 0x92.
  assert.deepEqual(importFileRows('a.csv', new Uint8Array(Buffer.from('Name\r\nZo\xeb \x80 5 \x92\r\n', 'latin1'))), [['Name'], ['Zoë € 5 ’']]);
});

test('a semicolon or pipe file comes in as columns; a .txt is tab-separated unless every line says otherwise', () => {
  assert.deepEqual(importFileRows('a.csv', bytes('a;b\r\n1;2\r\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(importFileRows('a.csv', bytes('a|b\r\n1|2\r\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(importFileRows('a.csv', bytes('a,b\r\n1,2\r\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(importFileRows('a.txt', bytes('a\tb\r\n1\t2\r\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(importFileRows('a.txt', bytes('a;b\r\n1;2\r\n')), [['a', 'b'], ['1', '2']]);
  // Prose with a comma or a stray semicolon stays one column.
  assert.deepEqual(importFileRows('a.txt', bytes('Hello, world\r\nOne; two\r\nthree\r\n')), [['Hello, world'], ['One; two'], ['three']]);
  // The step's own format wins over the file's name.
  assert.deepEqual(importFileRows('a.csv', bytes('a;b,c\r\n'), 'COMS'), [['a;b', 'c']]);
  assert.deepEqual(importFileRows('a.txt', bytes('a,b\tc\r\n'), 'TABS'), [['a,b', 'c']]);
});

test('a quote that is never closed is reported with its row', () => {
  const notices: string[] = [];
  const rows = importFileRows('a.csv', bytes('a,b\r\n1,"two\r\n3,4\r\n'), undefined, undefined, { notices });
  assert.equal(rows.length, 2);
  assert.match(notices[0], /row 2 is never closed/);
  const clean: string[] = [];
  importFileRows('a.csv', bytes('a,"b"\r\n'), undefined, undefined, { notices: clean });
  assert.deepEqual(clean, []);
});

test('Export Records as UTF-16 starts with a byte order mark and reads back through Import Records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-utf16-'));
  createStore(join(dir, 'R.sqlite'));
  const store = new Store(join(dir, 'R.sqlite'), 'R');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Code' }, { name: 'Note' }] }]);
    const ids = ['Zoë', '日本語', 'plain'].map((note, i) => store.create('Rows', { Code: `r${i}`, Note: note }).recordId);
    const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Rows' }, field: { id: 0, name } });
    const exported = await runScript(store, { id: 1, name: 'Export', steps: [
      { stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: ['out.csv'], exportFormat: 'COMS', encoding: 'utf-16', exportFields: [ref('Code'), ref('Note')] } as StepParams },
    ] } as Script, { layout: 'Rows', foundSet: ids, documents: dir });
    assert.equal(exported.error, 0);
    const file = readFileSync(join(dir, 'out.csv'));
    assert.deepEqual([...file.subarray(0, 2)], [0xff, 0xfe]);
    const imported = await runScript(store, { id: 2, name: 'Import', steps: [
      { stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: ['out.csv'], importFormat: 'COMS', importAction: 'add', fieldMapping: [{ field: ref('Code'), import: true }, { field: ref('Note'), import: true }] } as StepParams },
    ] } as Script, { layout: 'Rows', documents: dir });
    assert.equal(imported.error, 0);
    assert.deepEqual(imported.foundSet!.map((id) => store.get('Rows', id).fieldData.Note), ['Zoë', '日本語', 'plain']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an XML export imported again keeps its line breaks, and CDATA and character references come back as text', () => {
  const xml = fmpXmlResult('R', [{ name: 'Note', type: 'text' }], [{ recordId: 1, modId: 0, cells: [['one\r\ntwo\nthree']] }]);
  assert.match(xml, /&#13;/);
  // The writer ends every line with a return (FileMaker's paragraph mark), as &#13;; it reads back as one.
  assert.deepEqual(importFileRows('a.xml', bytes(xml)), [['one\rtwo\rthree']]);
  const hand = '<FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult"><METADATA><FIELD NAME="A" TYPE="TEXT"/></METADATA><RESULTSET><ROW><COL><DATA><![CDATA[a < b & <c>]]></DATA></COL></ROW><ROW><COL><DATA>x&#10;y&#x41;&amp;</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>';
  assert.deepEqual(importFileRows('a.xml', bytes(hand)), [['a < b & <c>'], ['x\nyA&']]);
});

test('FileMaker XML dates and times are read by the file\'s DATEFORMAT and TIMEFORMAT', () => {
  const file = (date: string, time: string, ...cells: string[][]) => bytes(`<FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult"><DATABASE DATEFORMAT="${date}" TIMEFORMAT="${time}" NAME="x"/><METADATA><FIELD NAME="D" TYPE="DATE"/><FIELD NAME="T" TYPE="TIME"/><FIELD NAME="S" TYPE="TIMESTAMP"/><FIELD NAME="N" TYPE="TEXT"/></METADATA><RESULTSET>${cells.map((r) => `<ROW>${r.map((v) => `<COL><DATA>${v}</DATA></COL>`).join('')}</ROW>`).join('')}</RESULTSET></FMPXMLRESULT>`);
  assert.deepEqual(importFileRows('a.xml', file('M/d/yyyy', 'h:mm:ss a', ['3/5/2024', '2:30:15 PM', '3/5/2024 2:30:15 PM', '3/5/2024'])), [['2024-03-05', '14:30:15', '2024-03-05T14:30:15', '3/5/2024']]);
  assert.deepEqual(importFileRows('a.xml', file('dd.MM.yyyy', 'HH:mm:ss', ['05.03.2024', '09:05:00', '05.03.2024 09:05:00', ''])), [['2024-03-05', '09:05:00', '2024-03-05T09:05:00', '']]);
  assert.deepEqual(importFileRows('a.xml', file('yyyy-MM-dd', 'HH:mm:ss', ['2024-03-05', '12:00:00', '2024-03-05 12:00:00', 'x'])), [['2024-03-05', '12:00:00', '2024-03-05T12:00:00', 'x']]);
  // 12 AM is midnight, 12 PM noon; a date that is not on the calendar, or does not fit the format, is left as it came.
  assert.deepEqual(importFileRows('a.xml', file('MMM d, yyyy', 'h:mm a', ['Feb 30, 2024', '12:05 AM', 'Mar 5, 2024 12:05 PM', 'n'])), [['Feb 30, 2024', '00:05:00', '2024-03-05T12:05:00', 'n']]);
});

const sheetRows = (...rows: string[][]) => rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('');

test('an Excel workbook is read from the sheet named, or the first', () => {
  const book = workbook([{ name: 'Stock', rows: sheetRows(['a', 'b']) }, { name: 'Sales', rows: sheetRows(['c', 'd']) }]);
  assert.deepEqual(xlsxSheetNames(book), ['Stock', 'Sales']);
  assert.deepEqual(importFileRows('b.xlsx', book), [['a', 'b']]);
  assert.deepEqual(importFileRows('b.xlsx', book, undefined, undefined, { worksheet: 'Sales' }), [['c', 'd']]);
  assert.deepEqual(readXlsx(book, 'sales'), [['c', 'd']]);
  assert.throws(() => importFileRows('b.xlsx', book, undefined, undefined, { worksheet: 'Nope' }), (e: unknown) => (e as { code?: number }).code === 715);
});

test('a workbook that counts days from 1904 reads its dates as the same days; numbers stay numbers', () => {
  const styles = '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>';
  const rows = '<row r="1"><c r="A1" s="1"><v>1000</v></c><c r="B1" s="2"><v>1000</v></c><c r="C1" s="0"><v>1000</v></c></row>';
  const in1904 = workbook([{ name: 'S', rows }], { props: '<workbookPr date1904="1"/>', styles });
  assert.deepEqual(readXlsx(in1904), [[2462, 2462, 1000]]);
  const in1900 = workbook([{ name: 'S', rows }], { styles });
  assert.deepEqual(readXlsx(in1900), [[1000, 1000, 1000]]);
});

test('phonetic guide runs in Excel text are not part of the text; typed date cells and entities are read', () => {
  const shared = '<si><t>漢字</t><rPh sb="0" eb="2"><t>カンジ</t></rPh><phoneticPr fontId="1"/></si><si><r><t>a &amp; b</t></r></si>';
  const rows = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>松</t><rPh sb="0" eb="1"><t>マツ</t></rPh></is></c><c r="D1" t="d"><v>2024-03-05T00:00:00</v></c><c r="E1" t="e"><v>#DIV/0!</v></c></row>';
  assert.deepEqual(readXlsx(workbook([{ name: 'S', rows }], { sharedStrings: shared })), [['漢字', 'a & b', '松', '2024-03-05T00:00:00', '#DIV/0!']]);
});

test('Import Records says error 715 for a worksheet the workbook does not have', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sheet-'));
  createStore(join(dir, 'R.sqlite'));
  const store = new Store(join(dir, 'R.sqlite'), 'R');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Code' }, { name: 'Note' }] }]);
    writeFileSync(join(dir, 'b.xlsx'), workbook([{ name: 'Stock', rows: sheetRows(['x', 'one']) }, { name: 'Sales', rows: sheetRows(['y', 'two']) }]));
    const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Rows' }, field: { id: 0, name } });
    const run = (worksheet?: string) => runScript(store, { id: 2, name: 'Import', steps: [
      { stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: ['b.xlsx'], importFormat: 'XLXS', importAction: 'add', ...(worksheet ? { worksheet } : {}), fieldMapping: [{ field: ref('Code'), import: true }, { field: ref('Note'), import: true }] } as StepParams },
    ] } as Script, { layout: 'Rows', documents: dir });
    const sales = await run('Sales');
    assert.equal(sales.error, 0);
    assert.deepEqual(sales.foundSet!.map((id) => store.get('Rows', id).fieldData.Note), ['two']);
    assert.equal((await run('Missing')).error, 715);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

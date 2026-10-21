import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { createStore, Store, parseDelimited } from '@tabularius/store';
import { importFileRows, runScript } from '../src/index.ts';
import { readXlsx, SheetLimitError, unzip, xlsx } from '../src/xlsx.ts';
import { validateSavedExcel } from './xlsx-opc-validator.ts';
import { zipOf } from './workbook-parts.ts';

const stubDir = mkdtempSync(join(tmpdir(), 'openhbam-export-path-'));
const marker = join(stubDir, 'called');
const priorPath = process.env.PATH;
for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
  const path = join(stubDir, command);
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${command}' >> '${marker}'\nexit 99\n`);
  chmodSync(path, 0o755);
}
process.env.PATH = stubDir;
after(() => {
  process.env.PATH = priorPath;
  assert.equal(existsSync(marker), false, 'a forbidden child process was launched');
  rmSync(stubDir, { recursive: true, force: true });
});

const FIELDS = ['Text', 'Huge', 'Number', 'NegativeZero', 'Day', 'Clock', 'Stamp', 'BooleanValue', 'Container', 'Empty', 'Zero', 'Formula', 'Apostrophe', 'Unicode'] as const;
const LONG = 'L'.repeat(32_767);
const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Rows' }, field: { id: 0, name } });
const step = (id: number, name: string, file: string, format: string): ScriptStep => ({
  stepId: id, name, enabled: true,
  params: { filePaths: [file], exportFormat: format, exportFields: FIELDS.map(ref) } as StepParams,
});
const run = (store: Store, dir: string, ids: number[], entry: ScriptStep) => runScript(store,
  { id: 991, name: 'Fidelity export', steps: [entry] } as Script, { layout: 'Rows', foundSet: ids, documents: dir });

test('Save Records as Excel is a valid OPC workbook and its imported rows retain supported values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-fidelity-'));
  createStore(join(dir, 'Synthetic.sqlite'));
  const store = new Store(join(dir, 'Synthetic.sqlite'), 'Synthetic');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: FIELDS.map((name) => ({ name,
      type: name === 'Number' || name === 'NegativeZero' || name === 'BooleanValue' || name === 'Zero' ? 'number'
        : name === 'Day' ? 'date' : name === 'Clock' ? 'time' : name === 'Stamp' ? 'timestamp'
        : name === 'Container' ? 'container' : 'text',
    })) }]);
    const id = store.create('Rows', {
      Text: 'first\nsecond\rthird', Huge: LONG, Number: '1e21', NegativeZero: '-0', Day: '10/15/2026',
      Clock: '13:45:30', Stamp: '10/15/2026 13:45:30', BooleanValue: '1', Empty: '', Zero: '0',
      Formula: '=1+1', Apostrophe: "'literal", Unicode: '日本語 Ω 🎉',
    }).recordId;
    store.setContainer('Rows', id, 'Container', 1, { filename: 'reference.png', mime: 'image/png', data: Uint8Array.of(1, 2, 3) });
    const ids = [id];
    const excel = await run(store, dir, ids, step(143, 'Save Records as Excel', 'out.xlsx', 'XLXE'));
    assert.equal(excel.error, 0, excel.trace?.map((t) => t.message).join());
    const bytes = readFileSync(join(dir, 'out.xlsx'));
    const cells = validateSavedExcel(bytes);
    const sheetXml = Buffer.from(unzip(bytes).get('xl/worksheets/sheet1.xml')!).toString('utf8');
    assert.match(sheetXml, /first&#13;second&#13;third/);
    assert.doesNotMatch(sheetXml, /first\rsecond/);
    assert.equal(cells.get('B1'), LONG);
    assert.equal(cells.get('I1'), 'reference.png');
    assert.equal(cells.get('L1'), '=1+1');
    const imported = importFileRows('out.xlsx', bytes, 'XLXE');
    assert.deepEqual(imported, readXlsx(bytes));
    assert.equal(imported[0][0], 'first\rsecond\rthird');
    assert.equal(imported[0][1], LONG);
    assert.equal(imported[0][2], 1e21);
    assert.equal(imported[0][3], 0); // The numeric store canonicalizes -0 at ingestion.
    assert.equal(imported[0][4], 46310);
    assert.ok(Math.abs(Number(imported[0][5]) - (13 * 3600 + 45 * 60 + 30) / 86_400) < 1e-12);
    assert.ok(Math.abs(Number(imported[0][6]) - (46310 + (13 * 3600 + 45 * 60 + 30) / 86_400)) < 1e-9);
    assert.equal(imported[0][7], 1);
    assert.equal(imported[0][9], '');
    assert.equal(imported[0][10], 0);
    assert.equal(imported[0][11], '=1+1');
    assert.equal(imported[0][12], "'literal");
    assert.equal(imported[0][13], '日本語 Ω 🎉');

    const importBack = (file: string, format: string) => runScript(store, {
      id: 992, name: 'Fidelity import', steps: [{ stepId: 35, name: 'Import Records', enabled: true,
        params: { filePaths: [file], importFormat: format, importAction: 'add', fieldMapping: FIELDS.map((name) => ({ field: ref(name), import: name !== 'Container' })) } as StepParams,
      }],
    } as Script, { layout: 'Rows', documents: dir });
    const excelBack = await importBack('out.xlsx', 'XLXE');
    assert.equal(excelBack.error, 0, excelBack.trace?.map((t) => t.message).join());
    const excelRecord = store.get('Rows', excelBack.foundSet![0]).fieldData;
    assert.equal(excelRecord.Text, 'first\rsecond\rthird');
    assert.equal(excelRecord.Huge, LONG);
    assert.equal(excelRecord.Formula, '=1+1');
    assert.equal(excelRecord.Unicode, '日本語 Ω 🎉');

    for (const [format, file] of [['COMS', 'out.csv'], ['TABS', 'out.tab'], ['MRGE', 'out.mer'], ['XML', 'out.xml'], ['HTML', 'out.html']] as const) {
      const exported = await run(store, dir, ids, step(36, 'Export Records', file, format));
      assert.equal(exported.error, 0, `${format}: ${exported.trace?.map((t) => t.message).join()}`);
      const raw = readFileSync(join(dir, file), 'utf8');
      assert.ok(raw.includes('reference.png'), format);
      assert.ok(raw.includes('日本語 Ω 🎉'), format);
      assert.ok(raw.includes(LONG), format);
      if (format === 'HTML') {
        assert.match(raw, /<table border="1">/);
        assert.match(raw, /<td>=1\+1<\/td>/);
        const body = /<tr>([\s\S]*?)<\/tr>\s*<\/table>/.exec(raw)?.[1];
        assert.ok(body, 'HTML row');
        const htmlCells = [...body.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
        assert.equal(htmlCells.length, FIELDS.length);
        assert.equal(htmlCells[1], LONG);
        assert.equal(htmlCells[11], '=1+1');
      } else {
        const rows = importFileRows(file, readFileSync(join(dir, file)), format);
        const values = format === 'MRGE' ? rows[1] : rows[0];
        assert.equal(values[1], LONG, format);
        assert.equal(values[8], 'reference.png', format);
        assert.equal(values[3], '0', format);
        assert.equal(values[11], format === 'XML' ? '=1+1' : "'=1+1", format);
        assert.equal(values[12], "'literal", format);
        assert.equal(values[13], '日本語 Ω 🎉', format);
        const back = await importBack(file, format);
        assert.equal(back.error, 0, `${format} import: ${back.trace?.map((t) => t.message).join()}`);
        const record = store.get('Rows', back.foundSet![0]).fieldData;
        assert.equal(record.Huge, LONG, format);
        assert.equal(record.Unicode, '日本語 Ω 🎉', format);
        assert.equal(record.Formula, format === 'XML' ? '=1+1' : "'=1+1", format);
      }
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('script CSV, TSV and Merge exports guard formulas and control prefixes without changing numeric signs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-formula-'));
  createStore(join(dir, 'Synthetic.sqlite'));
  const store = new Store(join(dir, 'Synthetic.sqlite'), 'Synthetic');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Value' }, { name: 'Signed', type: 'number' }] }]);
    const prefixes = ['=', '+', '-', '@', '\t', '\r'];
    const ids = prefixes.map((p) => store.create('Rows', { Value: `${p}1+1`, Signed: '-42' }).recordId);
    for (const [format, file, sep] of [['COMS', 'formula.csv', ','], ['TABS', 'formula.tab', '\t'], ['MRGE', 'formula.mer', ',']] as const) {
      const exportStep = { ...step(36, 'Export Records', file, format), params: { filePaths: [file], exportFormat: format, exportFields: [ref('Value'), ref('Signed')] } as StepParams };
      assert.equal((await run(store, dir, ids, exportStep)).error, 0);
      const rows = parseDelimited(readFileSync(join(dir, file), 'utf8'), sep);
      const values = format === 'MRGE' ? rows.slice(1) : rows;
      assert.deepEqual(values.map((r) => r[0]), prefixes.map((p) => `'${p === '\t' && format === 'TABS' ? ' ' : p === '\r' ? '\v' : p}1+1`));
      assert.deepEqual(values.map((r) => r[1]), prefixes.map(() => '-42'));
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Excel writer refuses a row beyond 1,048,576 before building a package', () => {
  assert.throws(() => xlsx(new Array(1_048_577)), SheetLimitError);
});

test('the Excel writer and reader preserve negative zero when supplied directly', () => {
  const bytes = xlsx([[-0]]);
  validateSavedExcel(bytes);
  assert.ok(Object.is(readXlsx(bytes)[0][0], -0));
});

test('the OPC checker refuses a package whose central CRC is wrong', () => {
  const bytes = Buffer.from(xlsx([['valid']]));
  const directory = bytes.readUInt32LE(bytes.length - 6);
  bytes.writeUInt32LE(0, directory + 16);
  assert.throws(() => validateSavedExcel(bytes), /ZIP CRC/);
});

test('the OPC checker resolves shared strings and rejects an invalid shared-string index', () => {
  const parts = Object.fromEntries([...unzip(xlsx([['valid']]))].map(([name, value]) => [name, Buffer.from(value).toString('utf8')]));
  parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  parts['xl/_rels/workbook.xml.rels'] = parts['xl/_rels/workbook.xml.rels'].replace('</Relationships>', '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
  parts['xl/sharedStrings.xml'] = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>valid</t></si></sst>';
  parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace('<c r="A1" t="inlineStr"><is><t xml:space="preserve">valid</t></is></c>', '<c r="A1" t="s"><v>0</v></c>');
  assert.equal(validateSavedExcel(zipOf(parts)).get('A1'), 'valid');
  parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace('<v>0</v>', '<v>1</v>');
  assert.throws(() => validateSavedExcel(zipOf(parts)), /shared string index/);
});

test('the Excel writer makes a valid sheet name from forbidden characters and edge apostrophes', () => {
  assert.equal(validateSavedExcel(xlsx([['A&B']], "'bad?/name'")).get('A1'), 'A&B');
});

test('Excel writer refuses a column beyond XFD', () => {
  assert.throws(() => xlsx([new Array(16_385)]), SheetLimitError);
});

test('Excel writer refuses a cell longer than 32,767 characters', () => {
  assert.throws(() => xlsx([['x'.repeat(32_768)]]), SheetLimitError);
});

test('Save Records as Excel refuses an oversized cell without leaving a partial file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-excel-limit-'));
  createStore(join(dir, 'Synthetic.sqlite'));
  const store = new Store(join(dir, 'Synthetic.sqlite'), 'Synthetic');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Text' }] }]);
    const id = store.create('Rows', { Text: 'x'.repeat(32_768) }).recordId;
    const result = await run(store, dir, [id], { stepId: 143, name: 'Save Records as Excel', enabled: true, params: { filePaths: ['over.xlsx'], exportFormat: 'XLXE' } as StepParams });
    assert.notEqual(result.error, 0);
    assert.equal(existsSync(join(dir, 'over.xlsx')), false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

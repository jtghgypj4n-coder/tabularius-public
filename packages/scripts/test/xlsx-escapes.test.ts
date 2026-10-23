import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../../calc/src/zip.ts';
import { readXlsx, unzip, xlsx } from '../src/xlsx.ts';

test('reader decodes OOXML cell escapes once', () => {
  const parts = unzip(xlsx([['seed']]));
  parts.set('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row r="1">'
    + '<c r="A1" t="inlineStr"><is><t>a_x000D_\nb</t></is></c>'
    + '<c r="B1" t="inlineStr"><is><t>x_x005F_x0041_y</t></is></c>'
    + '</row></sheetData></worksheet>'));
  assert.deepEqual(readXlsx(zip([...parts].map(([name, data]) => ({ name, data })))), [['a\r\nb', 'x_x0041_y']]);
});

test('inline, formula string and shared string cells decode OOXML escapes', () => {
  const parts = unzip(xlsx([['seed']]));
  parts.set('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row r="1">'
    + '<c r="A1" t="inlineStr"><is><t>in_x0009_line</t></is></c>'
    + '<c r="B1" t="str"><v>str_x0009_line</v></c>'
    + '<c r="C1" t="s"><v>0</v></c>'
    + '</row></sheetData></worksheet>'));
  parts.set('xl/sharedStrings.xml', Buffer.from('<sst><si><r><t>shared_x00</t></r><r><t>09_line</t></r></si></sst>'));
  const bytes = zip([...parts].map(([name, data]) => ({ name, data })));
  assert.deepEqual(readXlsx(bytes), [['in\tline', 'str\tline', 'shared\tline']]);
});

test('writer preserves literal escape-looking text, and malformed escapes stay literal', () => {
  assert.deepEqual(readXlsx(xlsx([['_x0041_', '_x00ZZ_', '_x41_', '_x000D_']])), [['_x0041_', '_x00ZZ_', '_x41_', '_x000D_']]);
});

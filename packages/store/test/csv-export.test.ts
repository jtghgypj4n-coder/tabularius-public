import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvField, formulaGuard, parseDelimited, stripFormulaGuard, visibleControls } from '../src/index.ts';
import { createStore, Store } from '../src/index.ts';

test('CSV fields neutralize formula prefixes after whitespace and controls', () => {
  for (const formula of ['=', '+', '-', '@']) assert.equal(csvField(`${formula}1+1`), `'${formula}1+1`);
  for (const prefix of ['\t', '\r', '\n', '\v', ' \t', '\u0001', '\u007f', '\u0085']) {
    const text = `${prefix}=1+1`;
    const parsed = parseDelimited(csvField(text), ',')[0][0];
    assert.equal(parsed, `'${visibleControls(text)}`);
  }
  for (const prefix of [' ', '\u00a0', '\ufeff']) assert.equal(csvField(`${prefix}=1`), `'${prefix}=1`);
});

test('a formula-like value in a typed field is neutralised, and what is stored for a date field stays text', () => {
  for (const type of ['number', 'date', 'time', 'timestamp', 'boolean', 'integer', 'decimal']) {
    assert.equal(csvField('=1+1', { type }), "'=1+1");
  }
  assert.equal(csvField('-42', { type: 'number' }), '-42');
  assert.equal(csvField('-1+1', { type: 'date' }), "'-1+1");
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-csv-'));
  const path = join(dir, 'typed.sqlite');
  let store: Store | undefined;
  try {
    createStore(path);
    store = new Store(path, 'Typed');
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'D', type: 'date' }] }] as never);
    store.create('T', { D: '=1+1' });
    const value = String(store.select('SELECT D FROM T').rows[0][0]);
    assert.equal(csvField(value, { type: 'date' }), "'=1+1");
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a legitimate negative time, date or timestamp keeps its minus sign, and anything else that starts with one does not', () => {
  assert.equal(csvField('-01:30:00', { type: 'time' }), '-01:30:00');
  assert.equal(csvField('-0:05', { type: 'time' }), '-0:05');
  assert.equal(csvField('-0001-01-01', { type: 'date' }), '-0001-01-01');
  assert.equal(csvField('-0001-01-01 12:00:00.5', { type: 'timestamp' }), '-0001-01-01 12:00:00.5');
  for (const [text, type] of [['-01:30:00', 'number'], ['-0001-01-01', 'time'], ['-01:30:00', 'text'], ['-1+1', 'time'], ['-1+1', 'date'], ['-cmd|calc', 'timestamp'], ['-01:30:00 x', 'time'], ['=1+1', 'time'], ['@SUM(1)', 'number']]) {
    assert.equal(csvField(text, { type }), `'${text}`, `${type} ${text}`);
  }
});

test('CSV fields preserve cell text and quote after neutralization', () => {
  for (const text of ['', 'café', "'already", '-42', '\t=1,"x"\n']) {
    const parsed = text === '' ? '' : parseDelimited(csvField(text), ',')[0][0];
    assert.equal(parsed, /^[\t\r\n\v\u0000-\u001f\u007f-\u009f]|^[-=+@]/u.test(text) ? `'${visibleControls(text)}` : text);
  }
});

test('a number, date or time field keeps its minus sign; text that looks like a number is still neutralised', () => {
  assert.equal(csvField('-42', { type: 'number' }), '-42');
  assert.equal(csvField('-0.5', { type: 'number', quoteAll: true }), '"-0.5"');
  assert.equal(csvField('-42', { type: 'text' }), "'-42");
  assert.equal(csvField('-42'), "'-42");
  // Whatever the type, a text value that is a command stays neutralised; only a non-text field is a number.
  assert.equal(csvField('=1+1', { type: 'text' }), "'=1+1");
});

test('the apostrophe an export put in front of a formula-like value is taken off for a number, date or time field only', () => {
  assert.equal(stripFormulaGuard("'-42", 'number'), '-42');
  assert.equal(stripFormulaGuard("'-42", 'text'), "'-42");
  assert.equal(stripFormulaGuard("'-42", undefined), "'-42");
  assert.equal(stripFormulaGuard("'42", 'number'), "'42");
  assert.equal(stripFormulaGuard("'quoted", 'number'), "'quoted");
  assert.equal(stripFormulaGuard(7, 'number'), 7);
  assert.equal(formulaGuard('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(formulaGuard('plain'), 'plain');
});

test('control characters are written as visible \\uXXXX escapes, never dropped; line breaks stay and a literal backslash is left alone', () => {
  assert.equal(visibleControls('a\tb\u0007c\u0000d\u007fe\u0085f'), 'a\\u0009b\\u0007c\\u0000d\\u007fe\\u0085f');
  assert.equal(visibleControls('plain, with "quotes"\r\nand C:\\path'), 'plain, with "quotes"\r\nand C:\\path');
  assert.equal(csvField('x\u0007y'), 'x\\u0007y');
  assert.equal(csvField('C\tD', { quoteAll: true }), '"C\\u0009D"');
  assert.equal(csvField('\t=1+1'), "'\\u0009=1+1");
  assert.equal(csvField('a\r\nb\tc'), '"a\r\nb\\u0009c"');
  // An export that writes a return as a vertical tab asks for it; the vertical tab it writes is not escaped.
  assert.equal(csvField('a\r\nb\u000bc', { quoteAll: true, lineBreak: '\v' }), '"a\vb\\u000bc"');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvField, formulaGuard, parseDelimited, stripFormulaGuard } from '../src/index.ts';
import { createStore, Store } from '../src/index.ts';

test('CSV fields neutralize formula prefixes after whitespace and controls', () => {
  for (const formula of ['=', '+', '-', '@']) assert.equal(csvField(`${formula}1+1`), `'${formula}1+1`);
  for (const prefix of ['\t', '\r', '\n', '\v', ' \t', '\u0001', '\u007f', '\u0085']) {
    const text = `${prefix}=1+1`;
    const parsed = parseDelimited(csvField(text), ',')[0][0];
    assert.equal(parsed, `'${text}`);
  }
  for (const prefix of [' ', '\u00a0', '\ufeff']) assert.equal(csvField(`${prefix}=1`), `'${prefix}=1`);
});

test('AR-store-design-io-13', () => {
  for (const type of ['number', 'date', 'time', 'timestamp', 'boolean', 'integer', 'decimal']) {
    assert.equal(csvField('=1+1', { type }), "'=1+1");
  }
  assert.equal(csvField('-42', { type: 'number' }), '-42');
  assert.equal(csvField('-2024-01-01', { type: 'date' }), "'-2024-01-01");
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

test('CSV fields preserve cell text and quote after neutralization', () => {
  for (const text of ['', 'café', "'already", '-42', '\t=1,"x"\n']) {
    const parsed = text === '' ? '' : parseDelimited(csvField(text), ',')[0][0];
    assert.equal(parsed, /^[\t\r\n\v\u0000-\u001f\u007f-\u009f]|^[-=+@]/u.test(text) ? `'${text}` : text);
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

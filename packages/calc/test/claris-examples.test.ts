// The worked examples on Claris's help pages for these functions, run through the engine. A page's own example is the
// expected result; where a page gives none, the case isn't here. (Source: help.claris.com, Claris FileMaker Pro help, 2026-10.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, NameTable, type CalcContext } from '../src/index.ts';
import { INVENTORY } from './function-inventory.data.ts';
import { CASES, KNOWN_UNVERIFIED, PAGE } from './claris-examples.data.ts';

const ctx: CalcContext = {
  names: new NameTable({ fields: [], occurrences: [] }),
  occurrence: 'T',
  field: (ref: { field: string }) => {
    // FileMaker treats URLPath as a symbolic constant; the current parser reads this bare token as a field name.
    if (ref.field.toLowerCase() === 'urlpath') return { type: 'number', value: 3 };
    throw new Error('no fields');
  },
  related: () => [],
  now: () => new Date(2026, 9, 15, 14, 30, 0),
} as never;

for (const [fn, cases] of Object.entries(CASES)) {
  test(`Claris examples: ${fn}`, () => {
    for (const [formula, expected] of cases) assert.equal(evaluateText(formula, ctx), expected, `${formula} (Claris: ${PAGE(fn)})`);
  });
}
test('Claris examples whose required FileMaker runtime state is unavailable stay explicitly unverified', () => {
  assert.ok(KNOWN_UNVERIFIED.length > 0);
  for (const row of KNOWN_UNVERIFIED) {
    assert.equal(row.status, 'unverified');
    assert.ok(row.pageUrl.startsWith('https://help.claris.com/en/pro-help/content/'));
    assert.equal(row.pageUrl, INVENTORY.find(({ name }) => name === row.function)?.pageUrl);
    assert.ok(row.expression.length > 0 && row.result.length > 0);
  }
});
test('a return inside Quote is written with a backslash before it (Claris shows \\¶) and reads back as a return', () => {
  assert.equal(evaluateText('Quote ( "abc¶" )', ctx), '"abc\\\r"');
  assert.equal(evaluateText('Evaluate ( Quote ( "a¶b" ) ) = "a¶b"', ctx), '1');
});

test('text functions count a character outside the basic plane (an emoji) as one', () => {
  const t = (f: string) => evaluateText(f, ctx);
  assert.equal(t('Length ( "a👍b" )'), '3');
  assert.equal(t('Left ( "a👍b" ; 2 )'), 'a👍');
  assert.equal(t('Right ( "a👍b" ; 2 )'), '👍b');
  assert.equal(t('Middle ( "a👍b" ; 2 ; 1 )'), '👍');
  assert.equal(t('Middle ( "a👍b" ; 3 ; 5 )'), 'b');
  assert.equal(t('Position ( "😀😁" ; "😁" ; 1 ; 1 )'), '2');
  assert.equal(t('Position ( "a😀b😀" ; "😀" ; 1 ; 2 )'), '4');
  assert.equal(t('Position ( "a😀b😀" ; "😀" ; 4 ; -1 )'), '4');
  assert.equal(t('Position ( "a😀b😀" ; "b" ; 3 ; 1 )'), '3');
  assert.equal(t('Replace ( "a👍b" ; 2 ; 1 ; "X" )'), 'aXb');
  assert.equal(t('Replace ( "a👍b" ; 3 ; 1 ; "X" )'), 'a👍X');
});

// Claris writes a return as ¶ on its pages; the engine's value is a real return.
const R = (s: string) => s.replace(/¶/g, '\r');
const VALUE_AND_JSON: [string, string][] = [
  ['LeftValues ( "Plaid¶Canvas¶Suitcase" ; 2 )', 'Plaid¶Canvas¶'],
  ['FilterValues ( "Plaid¶Canvas¶Suitcase" ; "Plaid¶Canvas" )', 'Plaid¶Canvas¶'],
  ['FilterValues ( "Small¶Medium¶Large" ; "Medium¶Small" )', 'Small¶Medium¶'],
  ['SortValues ( "34¶600¶18¶29" ; -2 )', '600¶34¶29¶18¶'],
  ['SortValues ( "red¶green¶blue¶GREEN¶yellow¶" )', 'blue¶green¶GREEN¶red¶yellow¶'],
  ['UniqueValues ( "34¶600¶18¶600¶18.0" ; 2 )', '34¶600¶18¶'],
  ['UniqueValues ( "RED¶green¶red¶yellow¶" )', 'RED¶green¶yellow¶'],
  ['JSONSetElement ( "{ \\"a\\" : 11 }" ; "b" ; 22.23 ; JSONNumber )', '{"a":11,"b":22.23}'],
  ['JSONSetElement ( "[]" ; [ "[+].a" ; 5 ; JSONNumber ] ; [ "[:].b" ; 6 ; JSONNumber ] )', '[{"a":5,"b":6}]'],
  ['JSONGetElement ( "{ \\"a\\" : 11, \\"b\\" : 22, \\"c\\" : 33 }" ; "b" )', '22'],
  ['JSONGetElement ( "[ true, false, true ]" ; 1 )', '0'],
  ['JSONGetElement ( "[ true, false, true ]" ; 0 )', '1'],
  ['JSONGetElement ( "[ 1, 2, 3, 5 ]" ; "[:]" )', '5'],
  ['JSONGetElement ( "{\\"bakery\\":{\\"product\\":[{\\"product.name\\":\\"Donuts\\"}]}}" ; "[\'bakery\'][\'product\'][0][\'product.name\']" )', 'Donuts'],
];
test('value-list and JSON examples from Claris pages', () => {
  const withNames = { ...ctx, names: new NameTable({ fields: ['Qty'], occurrences: [] }), field: () => ({ type: 'text', value: '' }) } as never;
  for (const [formula, expected] of VALUE_AND_JSON) assert.equal(evaluateText(R(formula).replace(/\r/g, '¶'), withNames), R(expected), formula);
});

// Date and time functions. Claris shows times with AM/PM; the engine writes the file's 24-hour form, so the
// timestamp rows are compared as the same moment in that form.
const DATE_TIME: [string, string][] = [
  ['DayName ( Date ( 10 ; 7 ; 2019 ) )', 'Monday'],
  ['DayName ( "10/7/2019" )', 'Monday'],
  ['Date ( 10 ; 10 ; 2019 )', '10/10/2019'],
  ['Date ( 13 ; 1 ; 2019 )', '1/1/2020'],
  ['Date ( 6 ; 0 ; 2019 )', '5/31/2019'],
  ['Date ( 6 ; -2 ; 2019 )', '5/29/2019'],
  ['Date ( 7 ; 12 ; 2019 ) - Date ( 7 ; 2 ; 2019 )', '10'],
  ['Date ( 10.9 ; 10.9 ; 2019 )', '10/10/2019'],
  ['Time ( 4 ; 14 ; 32 )', '4:14:32'],
  ['Time ( 4.5 ; 10 ; 30 )', '4:40:30'],
  ['Time ( 4 ; 15 ; 70 )', '4:16:10'],
  ['MonthName ( "6/6/2019" )', 'June'],
  ['DayOfWeek ( "10/8/2019" )', '3'],
  ['DayOfWeek ( Date ( 10 ; 9 ; 2019 ) )', '4'],
  ['Timestamp ( Date ( 10 ; 21 ; 2019 ) ; Time ( 9 ; 10 ; 30 ) )', '10/21/2019 9:10:30'],
  ['Timestamp ( Date ( 10 ; 21 ; 2019 ) ; Time ( 13 ; 10 ; 30 ) )', '10/21/2019 13:10:30'],
  ['Timestamp ( Date ( 10 ; 21 ; 2019 ) ; Time ( 10 ; 65 ; 5 ) )', '10/21/2019 11:05:05'],
  ['Timestamp ( Date ( 10 ; 35 ; 2019 ) ; Time ( 4 ; 5 ; 6 ) )', '11/4/2019 4:05:06'],
];
test('date and time examples from Claris pages', () => {
  for (const [formula, expected] of DATE_TIME) assert.equal(evaluateText(formula, ctx), expected, formula);
});

// Value lists and JSON listing: the last pass of Claris examples.
const J = '{"bakery":{"product":[{"category":"Breads","id":"FB1","name":"Donuts","price":1.99,"special":true,"stock":43}]}}';
const LISTS: [string, string][] = [
  ['ValueCount ( "Item 1¶Item 2¶Item 3¶" )', '3'],
  ['ValueCount ( "Item 1¶Item 2¶Item 3¶¶" )', '4'],
  ['ValueCount ( "a b c" )', '3'], // line separator and paragraph separator end a value too
  ['RightValues ( "Plaid¶Canvas¶Suitcase" ; 2 )', 'Canvas¶Suitcase¶'],
  ['MiddleValues ( "Plaid¶Canvas¶Suitcase" ; 2 ; 1 )', 'Canvas¶'],
  ['MiddleValues ( "Sophie¶Bill¶John" ; 2 ; 2 )', 'Bill¶John¶'],
  ['RightValues ( "Sophie¶Bill¶John" ; 1 )', 'John¶'],
  ['GetValue ( "London¶Paris¶Hong Kong" ; 2 )', 'Paris'],
  ['JSONListKeys ( "{ \\"a\\" : 11, \\"b\\" : 22, \\"c\\" : 33 }" ; "" )', 'a¶b¶c'],
  ['JSONListValues ( "{ \\"a\\" : 11, \\"b\\" : 22, \\"c\\" : 33 }" ; "" )', '11¶22¶33'],
  [`JSONListKeys ( ${JSON.stringify(J)} ; "bakery.product" )`, '0'],
  [`JSONListKeys ( ${JSON.stringify(J)} ; "bakery.product[0]" )`, 'category¶id¶name¶price¶special¶stock'],
  [`JSONListValues ( ${JSON.stringify(J)} ; "bakery.product[0]" )`, 'Breads¶FB1¶Donuts¶1.99¶1¶43'], // true is 1
];
test('value-list and JSON listing examples from Claris pages', () => {
  const withNames = { ...ctx, names: new NameTable({ fields: ['Qty'], occurrences: [] }), field: () => ({ type: 'text', value: '' }) } as never;
  for (const [formula, expected] of LISTS) assert.equal(evaluateText(formula, withNames), expected.replace(/¶/g, '\r'), formula);
});

// Numbers and finance: the Claris examples whose answers are given to enough digits to compare.
const NUMBERS: [string, string][] = [
  ['Round ( Variance ( 5 ; 6 ; 7 ; 8 ) ; 8 )', '1.66666667'],
  ['Round ( Variance ( 70 ; 71 ; 70 ; 74 ; 75 ; 73 ; 72 ) ; 8 )', '3.80952381'],
  ['Round ( Variance ( 55 ; 80 ; 75 ; 40 ; 65 ; 50 ; 95 ) ; 8 )', '361.9047619'],
  ['Variance ( 3 )', '?'], // the variance of a single value is not defined
  ['StDev ( 3 )', '?'],
  ['Round ( StDev ( 5 ; 6 ; 7 ; 8 ) ; 8 )', '1.29099445'],
  ['Round ( PMT ( 21000 ; .069/12 ; 48 ) ; 2 )', '501.9'],
  ['Round ( FV ( 50 ; .11/12 ; 5 * 12 ) ; 8 )', '3975.90398429'],
  ['Round ( FV ( 500 ; .11/5 ; 60 ) ; 8 )', '61141.6513079'],
  ['Truncate ( PV ( 500 ; .05 ; 5 ) ; 8 )', '2164.73833531'],
  ['FV ( 100 ; 0 ; 10 )', '1000'], // a rate of 0 is payment * periods
  ['Round ( 14.5 ; 0 )', '15'],
  ['Round ( 29343.98 ; -3 )', '29000'],
  ['Truncate ( -14.6 ; 0 )', '-14'],
  ['Truncate ( 29343.98 ; -3 )', '29000'],
  ['Ceiling ( -1.25 )', '-1'],
  ['Mod ( 210 ; 4 )', '2'],
  ['Combination ( 5 ; 2 )', '10'],
  ['Factorial ( 10 ; 3 )', '720'],
];
test('number and finance examples from Claris pages', () => {
  for (const [formula, expected] of NUMBERS) assert.equal(evaluateText(formula, ctx), expected, formula);
});

// Conversion and date/time pieces: answers worked out from the rules on the Claris pages (no digits truncated).
const CONVERT: [string, string][] = [
  ['GetAsNumber ( "$1,234.56" )', '1234.56'],
  ['GetAsNumber ( "abc123def456" )', '123456'],
  ['GetAsNumber ( "-12.5x" )', '-12.5'],
  ['GetAsBoolean ( 5 )', '1'],
  ['GetAsBoolean ( 0 )', '0'],
  ['GetAsBoolean ( "" )', '0'],
  ['GetAsTime ( "2:30:15 PM" )', '14:30:15'],
  ['GetAsTime ( 3600 )', '1:00:00'],
  ['Hour ( Time ( 14 ; 30 ; 0 ) )', '14'],
  ['Hour ( 90000 )', '25'],
  ['MonthName ( Date ( 3 ; 15 ; 2026 ) )', 'March'],
  ['WeekOfYear ( Date ( 1 ; 1 ; 2026 ) )', '1'],
  ['WeekOfYearFiscal ( Date ( 1 ; 1 ; 2026 ) ; 2 )', '1'], // Monday start: the week of Dec 29 holds four January days
  ['WeekOfYearFiscal ( Date ( 1 ; 1 ; 2026 ) ; 1 )', '53'], // Sunday start: only three, so it belongs to last year
  ['WeekOfYearFiscal ( Date ( 12 ; 30 ; 2026 ) ; 1 )', '52'],
];
test('conversion and date-part examples', () => {
  for (const [formula, expected] of CONVERT) assert.equal(evaluateText(formula, ctx), expected, formula);
});

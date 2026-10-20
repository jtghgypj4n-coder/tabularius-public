import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValue } from '../src/format.ts';
import type { DataFormat, TimeFormat } from '../src/types.ts';

const text = (value: string, type: string, format: DataFormat) => formatValue(value, type, format)?.text;

test('number formats', () => {
  const currency: DataFormat = { number: { decimalPoint: '.', decimals: 2, thousands: ',', notation: '$', leading: true, negativeColor: 'rgb(255 0 0)' } };
  assert.deepEqual(formatValue('1234567.5', 'number', currency), { text: '$1,234,567.50', color: undefined });
  assert.deepEqual(formatValue('-3', 'number', currency), { text: '-$3.00', color: 'rgb(255 0 0)' });
  assert.equal(text('-3', 'number', { number: { ...currency.number!, outside: true, negativeStyle: 2 } }), '$(3.00)');
  assert.equal(text('-3', 'number', { number: { decimalPoint: ',', notation: ' €', negativeStyle: 1 } }), '3 €-');
  assert.equal(text('0.125', 'number', { number: { decimalPoint: '.', decimals: 1, notation: '%' } }), '12.5%');
  assert.equal(text('0', 'number', { number: { decimalPoint: '.', blankIfZero: true } }), '');
  assert.equal(text('2', 'number', { number: { decimalPoint: '.', boolean: { true: 'Yes', false: 'No' } } }), 'Yes');
  assert.equal(text('12', 'text', currency), undefined);
  assert.equal(text('abc', 'number', currency), undefined);
});

test('date formats', () => {
  const base = { monthPad: '', dayPad: '', separator: '/' };
  assert.equal(text('12/25/2014', 'date', { date: { ...base, style: 2 } }), '12/25/2014');
  assert.equal(text('01/05/2025', 'date', { date: { ...base, style: 2 } }), '1/5/2025');
  assert.equal(text('01/05/2025', 'date', { date: { ...base, monthPad: '0', dayPad: '0', style: 7 } }), '01/05/2025');
  assert.equal(text('12/25/2014', 'date', { date: { ...base, style: 3 } }), 'Dec 25, 2014');
  assert.equal(text('12/25/2014', 'date', { date: { ...base, style: 6 } }), 'Thursday, December 25, 2014');
  assert.equal(text('12/25/2014', 'date', { date: { ...base, style: 1, elements: [5, 1, 0, 0], separators: ['', ' ', '', '', ''] } }), 'Dec 25');
  assert.equal(text('12/25/2014', 'date', { date: { ...base, style: 1, elements: [8, 4, 1, 0], separators: ['', '-', '-', '', ''] } }), '2014-12-25');
});

test('time and timestamp formats', () => {
  const t: TimeFormat = { minutes: true, seconds: false, h24: false, hourPad: '', minSecPad: '0', separator: ':', am: ' AM', pm: ' PM', prefix: false };
  assert.equal(text('09:00:00', 'time', { time: t }), '9:00 AM');
  assert.equal(text('00:30:00', 'time', { time: t }), '12:30 AM');
  assert.equal(text('17:05:09', 'time', { time: { ...t, seconds: true } }), '5:05:09 PM');
  assert.equal(text('17:05:09', 'time', { time: { ...t, h24: true, hourPad: '0', am: '', pm: '' } }), '17:05');
  assert.equal(text('30:00:00', 'time', { time: t }), '30:00');
  assert.equal(text('12/25/2014 17:05:09', 'timestamp', { time: t, date: { monthPad: '', dayPad: '', separator: '/', style: 3 } }), 'Dec 25, 2014 5:05 PM');
  assert.equal(text('12/25/2014 17:05:09', 'timestamp', { time: t }), '12/25/2014 5:05 PM');
});

test('numbers are rounded by their decimal digits and never written with an exponent', () => {
  const fixed = (decimals: number) => ({ number: { decimalPoint: '.', decimals } }) as DataFormat;
  const loose = { number: { decimalPoint: '.' } } as DataFormat;
  assert.equal(text('1.005', 'number', fixed(2)), '1.01', 'not the 1.00 the binary value gives');
  assert.equal(text('2.675', 'number', fixed(2)), '2.68');
  assert.equal(text('-1.005', 'number', fixed(2)), '-1.01');
  assert.equal(text('789.78', 'number', fixed(3)), '789.780');
  assert.equal(text('789.78', 'number', fixed(0)), '790');
  assert.equal(text('0.5', 'number', fixed(0)), '1');
  assert.equal(text('0.4999', 'number', fixed(0)), '0');
  assert.equal(text('999.996', 'number', fixed(2)), '1000.00', 'a carry through every digit');
  assert.equal(text('9.9996', 'number', fixed(2)), '10.00');
  assert.equal(text('1e-7', 'number', loose), '0.0000001');
  assert.equal(text('1e-12', 'number', loose), '0.000000000001');
  assert.equal(text('-1e-12', 'number', loose), '-0.000000000001');
  assert.equal(text('0.1234567890123456', 'number', loose), '0.123456789');
  assert.equal(text('-0.1234567890123456', 'number', loose), '-0.123456789');
  assert.equal(Number(text(String(Number.MIN_VALUE), 'number', loose)), Number.MIN_VALUE);
  assert.equal(text('1e-12', 'number', fixed(2)), '0.00');
  assert.equal(text('1e-14', 'number', { number: { decimalPoint: ',', notation: '%' } }), '0,000000000001%');
  assert.equal(text('0.0000012', 'number', loose), '0.0000012');
  assert.equal(text('1e-7', 'number', fixed(9)), '0.000000100');
  assert.equal(text('1e21', 'number', loose), '1000000000000000000000');
  assert.equal(text('1.5e21', 'number', { number: { decimalPoint: '.', thousands: ',' } } as DataFormat), '1,500,000,000,000,000,000,000');
  assert.equal(text('12.50', 'number', loose), '12.5');
  assert.equal(text('295612.99135', 'number', loose), '295612.99135');
  assert.equal(text('-29749880.43027', 'number', loose), '-29749880.43027');
  assert.equal(text('1e15', 'number', loose), '1000000000000000');
  assert.equal(text('0.07', 'number', { number: { decimalPoint: '.', notation: '%' } } as DataFormat), '7%', 'not 7.000000000000001%');
  assert.equal(text('1.005', 'number', { number: { decimalPoint: '.', decimals: 1, notation: '%' } } as DataFormat), '100.5%');
  assert.equal(text('0.1234567', 'number', { number: { decimalPoint: ',', decimals: 2, notation: '%' } } as DataFormat), '12,35%');
});

test('default number formatting matches main across a seeded corpus, except tiny nonzero values', () => {
  const loose: DataFormat = { number: { decimalPoint: '.' } };
  let seed = 0x51f15e;
  for (let i = 0; i < 10_000; i++) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const value = i % 1000 === 0 ? (i % 2000 ? '-1e-12' : '1e-12') : String((seed - 0x8000_0000) / 1_000_000);
    const actual = text(value, 'number', loose);
    if (Math.abs(Number(value)) < 5e-11 && Number(value) !== 0) {
      assert.equal(actual, i % 2000 ? '-0.000000000001' : '0.000000000001', `tiny nonzero value at index ${i}`);
      continue;
    }
    // Main's default formatter rounds the absolute value to ten places, then adds the sign.
    const x = Number(value);
    const expected = (x < 0 ? '-' : '') + String(Math.round(Math.abs(x) * 1e10) / 1e10);
    assert.equal(actual, expected, `main formatter at index ${i}: ${value}`);
  }
});

test('a negative duration keeps its sign, also below an hour, and is not read as a time of day', () => {
  const t: TimeFormat = { minutes: true, seconds: true, h24: false, hourPad: '', minSecPad: '0', separator: ':', am: ' AM', pm: ' PM', prefix: false };
  assert.equal(text('-0:30:00', 'time', { time: t }), '-0:30:00');
  assert.equal(text('-1:30:00', 'time', { time: t }), '-1:30:00');
  assert.equal(text('-0:05:09', 'time', { time: { ...t, hourPad: '0', h24: true, am: '', pm: '' } }), '-00:05:09');
  assert.equal(text('0:30:00', 'time', { time: t }), '12:30:00 AM', 'a positive one is unchanged');
});

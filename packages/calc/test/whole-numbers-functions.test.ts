import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { evaluateText } from '../src/index.ts';
import { decimalSum, formatNumber, tidy } from '../src/values.ts';

const run = (formula: string) => evaluateText(formula);
const b = (n: bigint) => n.toString();
const capped = (n: bigint) => n.toString().replace(/^[-]?\d{401,}$/, '?');
const floorDiv = (x: bigint, y: bigint) => {
  const q = x / y, r = x % y;
  return r !== 0n && (r < 0n) !== (y < 0n) ? q - 1n : q;
};
const rounded = (x: bigint, places: number, half: boolean) => {
  const scale = 10n ** BigInt(-places);
  const magnitude = x < 0n ? -x : x;
  const q = magnitude / scale + (half && magnitude % scale * 2n >= scale ? 1n : 0n);
  return (x < 0n ? -q : q) * scale;
};

test('recorded small and empty input results stay unchanged', () => {
  const cases: [string, string][] = [
    ['Abs ( "" )', ''], ['Int ( "" )', ''], ['Floor ( "" )', ''], ['Ceiling ( "" )', ''],
    ['Sign ( "" )', ''], ['Round ( "" ; 0 )', ''], ['Truncate ( "" ; 0 )', ''],
    ['Mod ( "" ; 3 )', ''], ['Div ( "" ; 3 )', ''], ['Sum ( "" )', '0'],
    ['Average ( "" )', ''], ['GetAsNumber ( "" )', ''],
    ['Abs ( "abc" )', ''], ['Mod ( "abc" ; 3 )', ''], ['GetAsNumber ( "abc" )', ''],
    ['Abs ( -7 )', '7'], ['Int ( -2.7 )', '-2'], ['Floor ( -2.7 )', '-3'],
    ['Ceiling ( -2.7 )', '-2'], ['Mod ( -7 ; -3 )', '-1'], ['Div ( -7 ; -3 )', '2'],
    ['Round ( -25 ; -1 )', '-30'], ['Truncate ( -25 ; -1 )', '-20'],
    ['Sum ( 2 ; 3 )', '5'], ['Average ( 2 ; 3 )', '2.5'], ['2 ^ 3', '8'], ['8 / 2', '4'],
  ];
  for (const [formula, expected] of cases) assert.equal(run(formula), expected, formula);
});

test('whole-number functions retain digits through 400 digits', () => {
  const operands = [2n ** 53n + 1n, 10n ** 20n + 7n, BigInt('1234567890'.repeat(4)), BigInt('9'.repeat(400))];
  for (const positive of operands) for (const x of [positive, -positive]) {
    const n = b(x), abs = x < 0n ? -x : x;
    const cases: [string, string][] = [
      [`Abs ( ${n} )`, b(abs)], [`Int ( ${n} )`, n], [`Floor ( ${n} )`, n],
      [`Ceiling ( ${n} )`, n], [`Sign ( ${n} )`, b(x < 0n ? -1n : 1n)],
      [`GetAsNumber ( "${n}" )`, n], [`Round ( ${n} ; 0 )`, n],
      [`Truncate ( ${n} ; 0 )`, n], [`Round ( ${n} ; 2 )`, n],
      [`Truncate ( ${n} ; 2 )`, n], [`${n} ^ 0`, '1'], [`${n} ^ 1`, n],
    ];
    for (const places of [-1, -15]) {
      cases.push([`Round ( ${n} ; ${places} )`, capped(rounded(x, places, true))]);
      cases.push([`Truncate ( ${n} ; ${places} )`, capped(rounded(x, places, false))]);
    }
    for (const divisor of [7n, -7n]) {
      cases.push([`Mod ( ${n} ; ${divisor} )`, b(x - divisor * floorDiv(x, divisor))]);
      cases.push([`Div ( ${n} ; ${divisor} )`, b(floorDiv(x, divisor))]);
    }
    cases.push([`Sum ( ${n} ; ${n} )`, capped(x * 2n)]);
    cases.push([`Average ( ${n} ; ${n} )`, n]);
    for (const [formula, expected] of cases) assert.equal(run(formula), expected, formula.slice(0, 90));
  }
  const n401 = '9'.repeat(401);
  for (const name of ['Abs', 'Int', 'Floor', 'Ceiling', 'Sign', 'GetAsNumber']) {
    assert.equal(run(`${name} ( "${n401}" )`), '?', name);
    assert.equal(run(`${name} ( ${n401} )`), '?', name);
  }
  for (const formula of [
    `Mod ( ${n401} ; 7 )`, `Div ( ${n401} ; 7 )`, `Round ( ${n401} ; -1 )`,
    `Truncate ( ${n401} ; -1 )`, `Sum ( ${n401} ; 1 )`,
    `Average ( ${n401} ; 1 )`, `${n401} ^ 2`, `${n401} / 7`,
    `${n401} ^ 0`, `"${n401}" ^ 0`, `0 ^ ${n401}`,
  ]) assert.equal(run(formula), '?', formula.slice(0, 30));
  assert.equal(run(`Round ( "" ; "${n401}" )`), '');
  assert.equal(run(`GetAsNumber ( "+${operands[1]}" )`), b(operands[1]));
});

test('division, powers, rounding, and aggregate limits', () => {
  const x = 10n ** 20n + 7n, y = 2n ** 53n + 1n;
  const cases: [string, string][] = [
    [`${x * 10n} / 10`, b(x)], [`${x} / 0`, '?'], [`Mod ( ${x} ; 0 )`, '?'], [`Div ( ${x} ; 0 )`, '?'],
    [`${x} ^ 2`, b(x ** 2n)], [`2 ^ 30`, b(2n ** 30n)],
    ['2 ^ 1328', b(2n ** 1328n)], ['2 ^ 1329', '?'],
    [`Sum ( ${x} ; ${y} ; -${x} )`, b(y)],
    [`Average ( ${x} ; ${x} ; ${x} )`, b(x)],
    [`Average ( ${x} ; ${x + 1n} )`, formatNumber(decimalSum([Number(x), Number(x + 1n)]) / 2)],
    [`Round ( ${x} ; -100000000 )`, '0'], [`Truncate ( ${x} ; -100000000 )`, '0'],
    [`Round ( -123456789012345678901234567895 ; -1 )`, b(rounded(-123456789012345678901234567895n, -1, true))],
  ];
  for (const [formula, expected] of cases) assert.equal(run(formula), expected, formula);
  const start = performance.now();
  assert.equal(run('2 ^ 100000000'), '?');
  assert.ok(performance.now() - start < 1000);
});

test('2,000 fixed-seed small cases match the previous double expressions', () => {
  let seed = 0x431ef;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % 2001) - 1000;
  const oldRound = (n: number, places: number, half: boolean) => {
    const scale = 10 ** places;
    const magnitude = Number((Math.abs(n) * scale).toPrecision(15));
    return (half ? Math.floor(magnitude + 0.5) : Math.floor(magnitude)) / scale * Math.sign(n);
  };
  for (let i = 0; i < 2000; i++) {
    const x = next(), y = next() || 1, places = [-1, 0, 1][i % 3];
    const cases: [string, number][] = [
      [`Abs ( ${x} )`, Math.abs(x)], [`Int ( ${x} )`, Math.trunc(x)],
      [`Floor ( ${x} )`, Math.floor(x)], [`Ceiling ( ${x} )`, Math.ceil(x)],
      [`Sign ( ${x} )`, Math.sign(x)], [`Mod ( ${x} ; ${y} )`, x - y * Math.floor(x / y)],
      [`Div ( ${x} ; ${y} )`, Math.floor(x / y)],
      [`Round ( ${x} ; ${places} )`, oldRound(x, places, true)],
      [`Truncate ( ${x} ; ${places} )`, oldRound(x, places, false)],
      [`Sum ( ${x} ; ${y} )`, decimalSum([x, y])],
      [`Average ( ${x} ; ${y} )`, decimalSum([x, y]) / 2],
      [`GetAsNumber ( "${x}" )`, x], [`${x} / ${y}`, tidy(x / y)],
      [`${x} ^ 2`, tidy(Math.pow(x, 2))],
    ];
    for (const [formula, expected] of cases) assert.equal(run(formula), formatNumber(expected), formula);
  }
});

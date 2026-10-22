// Text and number checks in the MBS functions run in time linear in the text: a long run of blanks or digits that
// ends in another character must not make a pattern retry from every position. Each case uses a text long enough
// that a quadratic match would take minutes, and a generous limit that a linear one meets by a wide margin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MBS_TEXT } from '../src/mbs-text.ts';
import { MBS_JSON } from '../src/mbs-json.ts';
import { trimValue } from '../src/mbs-list.ts';
import { evaluateText } from '../src/index.ts';

const N = 300_000;
const LIMIT_MS = 5000;
const A = (text: string) => ({ text, number: false });
function quick<T>(f: () => T): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < LIMIT_MS, 'took too long: the pattern backtracks');
  return r;
}

test('Text.RightTrim and Text.Trim on a long run of blanks before another character', () => {
  const s = ' '.repeat(N) + 'x';
  assert.equal(quick(() => MBS_TEXT['text.righttrim']([s])), s);
  assert.equal(quick(() => MBS_TEXT['text.righttrim'](['x' + ' '.repeat(N)])), 'x');
  assert.equal(quick(() => MBS_TEXT['text.trim']([s])), 'x');
});

test('List trimming on a long run of blanks before another character', () => {
  const s = 'x' + ' '.repeat(N) + 'x';
  assert.equal(quick(() => trimValue(s)), s);
  assert.equal(trimValue(' \t x \t '), 'x');
  assert.equal(trimValue(' \t '), '');
  assert.equal(trimValue(''), '');
});

test('JSON.CreateNumber and the integer parameters on a long run of digits before a letter', () => {
  const s = '1'.repeat(N) + 'x';
  assert.throws(() => quick(() => MBS_JSON['json.createnumber']([A(s)], {})), /is not a number/);
  assert.equal(MBS_JSON['json.createnumber']([A('.5')], {}) !== undefined, true);
});

test('JMESPath to_number on a long run of digits before a letter', () => {
  const doc = JSON.stringify([ '1'.repeat(N) + 'x' ]);
  const out = quick(() => MBS_JSON['json.search']([A(doc), A('to_number([0])')], {}));
  assert.ok(out === undefined || typeof out === 'string' || typeof out === 'object');
  assert.equal(evaluateText('MBS ( "JSON.Search" ; "[\\"12\\"]" ; "to_number([0])" )', {}), '12');
});

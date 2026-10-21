import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkFormula, compile, evaluateText, fieldRefs, fieldSpans, nodeText, parse } from '../src/index.ts';

test('AR-calc-core-04', () => {
  // https://help.claris.com/en/pro-help/content/round.html
  // https://help.claris.com/en/pro-help/content/truncate.html
  assert.equal(evaluateText('Round (1234567890123456; 0)'), '1234567890123456');
  assert.equal(evaluateText('Truncate (1234567890123456; 0)'), '1234567890123456');
  assert.equal(evaluateText('Round (12345678901234567890; 0)'), '12345678901234567890');
  assert.equal(evaluateText('Truncate (12345678901234567890; 0)'), '12345678901234567890');
  assert.equal(evaluateText('Round (1234567890123456; -1)'), '1234567890123460');
  assert.equal(evaluateText('Truncate (1234567890123456; -1)'), '1234567890123450');
  assert.equal(evaluateText('Round (1.005; 2)'), '1.01');
  assert.equal(evaluateText('Truncate (12345678901234.56; 1)'), '12345678901234.5');
});

test('AR-calc-core-05', () => {
  // https://help.claris.com/en/pro-help/content/setprecision.html
  // https://help.claris.com/en/pro-help/content/average.html
  // https://help.claris.com/en/pro-help/content/abs.html
  // https://help.claris.com/en/pro-help/content/variancep.html
  for (const [ordinary, precise, expected] of [
    ['Average ("abc"; 10)', 'SetPrecision (Average ("abc"; 10); 16)', '10'],
    ['Sum ("abc"; 10)', 'SetPrecision (Sum ("abc"; 10); 16)', '10'],
    ['Abs ("abc")', 'SetPrecision (Abs ("abc"); 16)', ''],
    ['VarianceP (""; 1; 3)', 'SetPrecision (VarianceP (""; 1; 3); 16)', '1'],
    ['Count ("abc"; "")', 'SetPrecision (Count ("abc"; ""); 16)', '1'],
  ]) {
    assert.equal(evaluateText(ordinary), expected);
    assert.equal(evaluateText(precise), expected);
  }
});

test('AR-calc-core-07', () => {
  // https://help.claris.com/en/pro-help/content/uniquevalues.html
  assert.equal(evaluateText('UniqueValues ("I¶i¶ı"; 1; "Turkish")'), 'I\ri\r');
  assert.equal(evaluateText('UniqueValues ("a¶A"; 1; "Unicode_Raw")'), 'a\rA\r');
  assert.equal(evaluateText('UniqueValues ("a¶A"; 1; " Unicode_Raw ")'), 'a\rA\r');
});

test('AR-calc-core-09', () => {
  // https://help.claris.com/en/pro-help/content/using-custom-functions.html
  assert.deepEqual(checkFormula('first value + 1', { parameters: ['first value'] }), { ok: true });
  assert.deepEqual(checkFormula('first value + 1', { parameters: [' first value '] }), { ok: true });
  assert.deepEqual(fieldRefs(parse('first value + 1', undefined, ['first value'])), [{ name: 'first value' }]);
  const printed = nodeText(parse('first value + 1', undefined, ['first value']));
  assert.deepEqual(checkFormula(printed, { parameters: ['first value'] }), { ok: true });
  assert.equal(evaluateText('F (4)', { customFunction: (name) => name === 'F' ? { parameters: ['first value'], formula: printed } : undefined }), '5');
});

test('AR-calc-core-10', () => {
  // https://help.claris.com/en/pro-help/content/get-foundcount.html
  // https://help.claris.com/en/pro-help/content/let.html
  assert.deepEqual(fieldSpans('Get (FoundCount)', { fields: ['FoundCount'] }), []);
  assert.deepEqual(fieldSpans('Let (Foo = 1; Foo)', { fields: ['Foo'] }), []);
  assert.deepEqual(fieldSpans('Foo + Get (FoundCount)', { fields: ['Foo', 'FoundCount'] }), [
    { at: 0, end: 3, name: 'Foo' },
  ]);
  assert.deepEqual(fieldSpans('Orders::Foo + Foo', { fields: ['Foo'], occurrences: [['Orders', ['Foo']]] }), [
    { at: 0, end: 11, occurrence: 'Orders', name: 'Foo' },
    { at: 14, end: 17, name: 'Foo' },
  ]);
});

test('AR-calc-core-11', () => {
  // https://help.claris.com/en/pro-help/content/while.html
  const formula = 'While ([i = 0]; i < 3; [i = i + 1]; i)';
  assert.deepEqual(fieldRefs(parse(formula)), []);
  assert.deepEqual(compile(formula).fields, []);
});

test('AR-calc-core-12', () => {
  // https://help.claris.com/en/pro-help/content/position.html
  assert.equal(evaluateText('Position ("a"; "a"; 1; -2)'), '0');
  const child = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    'import { evaluateText } from "./packages/calc/src/index.ts"; process.stdout.write(evaluateText("Position (\\"a\\"; \\"a\\"; 1; -100000000000000000000)"));',
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 8000 });
  assert.equal(child.status, 0, String(child.error ?? child.stderr));
  assert.equal(child.stdout, '0');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { evaluate, evaluateText, EMPTY, markExecutionRefusal, text } from '../src/index.ts';

const entry = new URL('../src/index.ts', import.meta.url).href;
const evaluator = new URL('../src/evaluate.ts', import.meta.url).href;
const textBudget = new URL('../src/text-budget.ts', import.meta.url).href;
function child(source: string): void {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    import { evaluate, evaluateText, compile, parse, fieldRefs, checkFormula, nodeText, CalcError, Env, text, rethrowExecutionRefusal } from ${JSON.stringify(entry)};
    import { EVALUATION_LIMIT } from ${JSON.stringify(evaluator)};
    import { MAX_TEXT_RESULT } from ${JSON.stringify(textBudget)};
    const marked = (e) => { assert.throws(() => rethrowExecutionRefusal(e), x => x === e); return true; };
    ${source}
  `], { timeout: 10_000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

for (const [index, formula] of ['Factorial (1e20)', 'Combination (10; 1e20)'].entries()) {
  test(`AR-calc-core-01 input ${index + 1}`, () => child(`
    assert.throws(() => evaluateText(${JSON.stringify(formula)}), marked);
  `));
}
test('AR-calc-core-01 decimal argument', () => child(`
  assert.equal(evaluateText('SetPrecision (Factorial (3; 1e20); 16)'), '6');
`));
for (const operation of ['Factorial(100)', 'Combination(100; 50)']) for (const precise of [false, true]) {
  const expr = (s: string) => precise ? `SetPrecision(${s}; 16)` : s;
  test(`AR-calc-core-01 steps ${operation} ${precise}`, () => child(`
    mock.method(performance, 'now', () => 0);
    EVALUATION_LIMIT.steps = 1000;
    assert.throws(() => evaluateText(${JSON.stringify(expr(`While([i=0]; i<30; [r=${operation}; i=i+1]; i)`))}), marked);
    assert.equal(evaluateText('1+1'), '2');
  `));
  test(`AR-calc-core-01 clock ${operation} ${precise}`, () => child(`
    let now = 0;
    mock.method(performance, 'now', () => now += 100);
    if (typeof process.threadCpuUsage === 'function') mock.method(process, 'threadCpuUsage', () => ({ user: (now += 100) * 1000, system: 0 }));
    assert.throws(() => evaluateText(${JSON.stringify(expr(operation))}), marked);
  `));
}

test('AR-calc-core-01 ordinary results', () => {
  for (const [formula, expected] of [
    ['Factorial(0)', '1'], ['Factorial(10; 3)', '720'], ['Factorial(3; 1e20)', '6'],
    ['Combination(5; 2)', '10'], ['Combination(5; 0)', '1'], ['Combination(5; 5)', '1'],
  ]) {
    assert.equal(evaluateText(formula), expected);
    assert.equal(evaluateText(`SetPrecision(${formula}; 16)`), expected);
  }
});

test('AR-calc-core-01 review: preserve ordinary numeric edge results', () => {
  for (const [formula, expected] of [
    ['Factorial(-1)', '1'], ['Factorial(-0.5)', '1'], ['Factorial(5; -1)', '1'],
    ['Combination(5; 10)', '0'], ['Combination(10; -1)', '1'], ['Combination(-5; 2)', '15'],
    ['Factorial(10; 2.5)', '720'], ['Factorial(10.5; 3)', '720'], ['Combination(5.5; 2.5)', '10'],
  ]) assert.equal(evaluateText(formula), expected, formula);
});

test('AR-calc-core-01 review: large numeric loops sample the clock in bounded batches', () => child(`
  let clocks = 0;
  mock.method(performance, 'now', () => { clocks++; return 0; });
  if (typeof process.threadCpuUsage === 'function') {
    mock.method(process, 'threadCpuUsage', () => { clocks++; return { user: 0, system: 0 }; });
  }
  for (const formula of ['Combination(1000000; 500000)', 'Factorial(500000)']) {
    clocks = 0;
    assert.equal(evaluateText(formula), '?'); // The numeric result still overflows.
    assert.ok(clocks > 1000 && clocks < 100000, formula + ': ' + clocks + ' clock reads');
  }
`));

test('AR-calc-core-01 review: numeric batches charge every iteration including the tail', () => child(`
  mock.method(performance, 'now', () => 0);
  if (typeof process.threadCpuUsage === 'function') {
    mock.method(process, 'threadCpuUsage', () => ({ user: 0, system: 0 }));
  }
  for (const [formula, steps, expected] of [
    ['Factorial(19; 2.5)', 5, '5814'],
    ['Combination(19; 2.5)', 4, '162'],
    ['Factorial(19)', 20, '121645100408832000'],
    ['Combination(38; 19)', 21, '35345263800'],
  ]) {
    EVALUATION_LIMIT.steps = steps;
    assert.equal(evaluateText(formula), expected, formula);
    EVALUATION_LIMIT.steps = steps - 1;
    assert.throws(() => evaluateText(formula), marked, formula);
  }
`));

test('AR-calc-core-01 review: 20000 While iterations with Factorial stay inside the step budget', () => child(`
  // Isolate step accounting from runner load; the existing clock tests exercise deadlines.
  mock.method(performance, 'now', () => 0);
  if (typeof process.threadCpuUsage === 'function') {
    mock.method(process, 'threadCpuUsage', () => ({ user: 0, system: 0 }));
  }
  for (const operation of ['Factorial(5)', 'SetPrecision(Factorial(5); 16)']) {
    assert.equal(evaluateText('While([i=0; r=0]; i<20000; [r=' + operation + '; i=i+1]; i & "|" & r)'), '20000|120');
  }
`));

for (const [index, formula] of ['F & F', 'Replace (F; 1; 0; F)', 'List (F; F)'].entries()) {
  test(`AR-calc-core-02 input ${index + 1}`, () => child(`
    const ctx = { field: () => text('x'.repeat(4_000_001)) };
    assert.throws(() => evaluateText(${JSON.stringify(`Length (${formula})`)}, ctx), marked);
  `));
}
test('AR-calc-core-02 boundaries', () => child(`
  const ctx = { field: () => text('x'.repeat(MAX_TEXT_RESULT / 2)) };
  assert.equal(evaluateText('Length(F & F)', ctx), String(MAX_TEXT_RESULT));
  assert.equal(evaluateText('Length(Replace(F; 1; 0; F))', ctx), String(MAX_TEXT_RESULT));
  assert.equal(evaluateText('Length(List(F; Left(F; Length(F)-1)))', ctx), String(MAX_TEXT_RESULT));
  assert.equal(evaluateText('Replace("a😀b"; 2; 1; "z")'), 'azb');
  assert.equal(evaluateText('List(""; "a"; ""; "b")'), 'a\\r' + 'b');
`));

test('AR-calc-core-03 MBS', () => {
  const refusal = new RangeError('host denied');
  markExecutionRefusal(refusal);
  assert.throws(() => evaluateText('MBS ("Text.Length"; Secret)', { field: () => { throw refusal; } }), e => e === refusal);
  assert.match(evaluateText('MBS ("Text.Length"; Secret)', { field: () => { throw new RangeError('ordinary'); } }), /^\[MBS\] ERROR:/);
});
test('AR-calc-core-03 BE', () => {
  for (const refusal of [new Error('host denied'), new RangeError('host denied')]) {
    markExecutionRefusal(refusal);
    assert.throws(() => evaluateText('BE_XMLStripNodes ("in"; "out"; "x")', {
      files: { read: () => Buffer.from('<root/>'), size: () => 7, write: () => { throw refusal; } },
    }), e => e === refusal);
  }
  assert.equal(evaluateText('BE_XMLStripNodes ("in"; "out"; "x")', {
    files: { read: () => Buffer.from('<root/>'), size: () => 7, write: () => { throw new Error('ordinary'); } },
  }), '?');
});

for (const consumer of ['compile(src)', 'checkFormula(src)', 'evaluateText(src)', 'fieldRefs(parse(src))', 'nodeText(parse(src))', 'evaluateText("Evaluate(F)", { field: () => text(src) })']) {
  test(`AR-calc-core-06 ${consumer}`, () => child(`
    const src = Array(10_000).fill('1').join('+');
    try {
      const value = ${consumer};
      if (typeof value === 'string') assert.ok(value === '10000' || value === '?');
      if (value && 'ok' in Object(value)) assert.equal(value.ok, false);
    } catch (e) { assert.ok(e instanceof CalcError, String(e)); }
  `));
}

test('AR-calc-core-06 boundaries', () => child(`
  const src = Array(1025).fill('1').join('+');
  assert.equal(compile(src).evaluate().value, 1025);
  assert.deepEqual(checkFormula(src), { ok: true });
  assert.equal(evaluateText(src), '1025');
  assert.equal(evaluateText(nodeText(parse(src))), '1025');
  const deep = src + '+1';
  assert.throws(() => compile(deep), CalcError);
  assert.equal(checkFormula(deep).ok, false);
  assert.equal(evaluateText(deep), '?');
  const env = new Env({});
  assert.throws(() => env.v(parse(deep)), CalcError);
  assert.equal(env.v(parse('1+1')).value, 2);
`));

for (const [label, operand, operator, expected] of [
  ['sum', '1', '+', '1000'],
  ['concatenation', '"a"', '&', 'a'.repeat(1000)],
  ['and', '1', ' and ', '1'],
]) {
  test(`AR-calc-core-06 review: 1000-term ${label} works across consumers`, () => child(`
    const src = Array(1000).fill(${JSON.stringify(operand)}).join(${JSON.stringify(operator)});
    const expected = ${JSON.stringify(expected)};
    assert.equal(String(compile(src).evaluate().value), expected);
    assert.deepEqual(checkFormula(src), { ok: true });
    assert.equal(evaluateText(src), expected);
    assert.equal(evaluateText(src, { trace: () => {} }), expected);
    assert.deepEqual(fieldRefs(parse(src)), []);
    assert.equal(evaluateText(nodeText(parse(src))), expected);
    assert.equal(evaluateText('Evaluate(F)', { field: () => text(src) }), expected);
  `));
}

test('AR-calc-core-06 review: 300 nested If calls remain usable', () => child(`
  const src = 'If(1;'.repeat(300) + '7' + ')'.repeat(300);
  assert.equal(compile(src).evaluate().value, 7);
  assert.deepEqual(checkFormula(src), { ok: true });
  assert.equal(evaluateText(src), '7');
  assert.equal(evaluateText(src, { trace: () => {} }), '7');
  assert.deepEqual(fieldRefs(parse(src)), []);
  assert.equal(evaluateText(nodeText(parse(src))), '7');
  assert.equal(evaluateText('Evaluate(F)', { field: () => text(src) }), '7');
`));

test('AR-calc-core-06 review: call and scope depth is bounded before visitors overflow', () => child(`
  for (const prefix of ['If(1;', 'Let(a=1;']) {
    const src = prefix.repeat(512) + '1' + ')'.repeat(512);
    assert.equal(compile(src).evaluate().value, 1);
    assert.deepEqual(checkFormula(src), { ok: true });
    assert.equal(evaluateText(src, { trace: () => {} }), '1');
    assert.deepEqual(fieldRefs(parse(src)), []);
    assert.equal(evaluateText(nodeText(parse(src))), '1');
    const deep = prefix + src + ')';
    assert.throws(() => compile(deep), CalcError);
    assert.equal(checkFormula(deep).ok, false);
    assert.equal(evaluateText(deep), '?');
    assert.throws(() => fieldRefs(parse(deep)), CalcError);
    assert.throws(() => nodeText(parse(deep)), CalcError);
  }
`));

for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
  test(`AR-calc-core-08 ${name}`, () => {
    assert.deepEqual(evaluate(`Get (${name})`), EMPTY);
    assert.deepEqual(evaluate(`Evaluate("Get (${name})")`), EMPTY);
    assert.deepEqual(evaluate(`Get (${name})`, { get: () => text('host') }), text('host'));
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { asText, CalcError, evaluate, evaluateText, num, parse, nodeText } from '../src/index.ts';

const result = (formula: string) => evaluateText(formula);

test('Claris SetPrecision examples and unchanged plain arithmetic', () => {
  assert.equal(result('SetPrecision(5/9;30)'), '0.555555555555555555555555555556');
  assert.equal(result('SetPrecision(1.321321321321321321321321321;0)'), '1.3213213213213213');
  assert.equal(result('SetPrecision(If(field1>5;Exp(50);Average(5/9;1/7;5/7));25)'), '?');
  const formula = 'SetPrecision(If(field1>5;Exp(50);Average(5/9;1/7;5/7));25)';
  const context = (n: number) => ({ field: () => num(n) });
  assert.equal(asText(evaluate(formula, context(6))), '5184705528587072464087.4533229334853848274691006');
  assert.equal(asText(evaluate(formula, context(5))), '0.4708994708994708994708995');
  assert.equal(result('5/9'), '0.5555555555555556');
  assert.equal(result('SetPrecision(1/3*3;30)'), '1');
  assert.equal(result('SetPrecision(If(1;5/9;MissingField);30)'), '0.555555555555555555555555555556');
  assert.equal(result('SetPrecision(Case(1;5/9;MissingField);30)'), '0.555555555555555555555555555556');
});

function roundedRatio(a: bigint, b: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  const q = (a * scale * 2n / b + 1n) / 2n;
  const whole = q / scale, fraction = (q % scale).toString().padStart(places, '0').replace(/0+$/, '');
  return `${whole}${fraction ? '.' + fraction : ''}`;
}

test('generated rational arithmetic agrees with independent BigInt division', () => {
  for (let i = 1; i <= 32; i++) {
    const a = BigInt(i * 37 + 5), b = BigInt(i * 13 + 7);
    assert.equal(result(`SetPrecision(${a}/${b};50)`), roundedRatio(a, b, 50));
    assert.equal(result(`SetPrecision((${a}+${b})/${b};50)`), roundedRatio(a + b, b, 50));
  }
});

function sqrtScaled(n: bigint, places: number): string {
  const target = n * 10n ** BigInt(2 * places + 2);
  let x = 1n << BigInt(Math.ceil(target.toString(2).length / 2));
  while (true) {
    const next = (x + target / x) / 2n;
    if (next >= x) break;
    x = next;
  }
  const rounded = (x + 5n) / 10n;
  const scale = 10n ** BigInt(places);
  return `${rounded / scale}.${(rounded % scale).toString().padStart(places, '0')}`;
}

test('square root powers agree with independent BigInt Newton reference', () => {
  for (const n of [2n, 3n, 5n, 17n]) {
    assert.equal(result(`SetPrecision(${n}^0.5;50)`), sqrtScaled(n, 50));
  }
  assert.equal(result('SetPrecision(2^0.5;400)'), sqrtScaled(2n, 400).replace(/0+$/, '').replace(/\.$/, ''));
});

test('documented numeric and aggregate functions retain decimal inputs', () => {
  assert.equal(result('SetPrecision(Sqrt(2);50)'), sqrtScaled(2n, 50));
  assert.equal(result('SetPrecision(Exp(Ln(2));50)'), '2');
  assert.equal(result('SetPrecision(Sum(0.1;0.2;0.3);50)'), '0.6');
  assert.equal(result('SetPrecision(Average(1/3;2/3);50)'), '0.5');
  assert.equal(result('SetPrecision(Div(7;3)+Mod(7;3);30)'), '3');
  assert.equal(result('SetPrecision(Round(5/9;3);30)'), '0.556');
  assert.equal(result('SetPrecision(Truncate(5/9;3);30)'), '0.555');
  assert.equal(result('SetPrecision(Let([x=5/9];x+x);30)'), '1.111111111111111111111111111111');
  assert.equal(result('SetPrecision(1/0+1;30)'), '?');
  assert.equal(result('SetPrecision(Pi;50)'), '3.14159265358979323846264338327950288419716939937511');
  assert.equal(result('SetPrecision(Radians(180);50)'), result('SetPrecision(Pi;50)'));
  assert.equal(result('SetPrecision(GetAsNumber("1.2345678901234567890123456789")*2;30)'), '2.4691357802469135780246913578');
  assert.equal(result('SetPrecision(Min("B";"A");30)'), 'A');
});

test('a bounded high-precision loop can make 100 Exp calls', () => {
  assert.equal(result('SetPrecision(While([i=0;x=0];i<100;[i=i+1;x=Exp(0.5)];x);400)').slice(0, 21),
    '1.6487212707001281468');
});

test('runaway high-precision work shares the While evaluation budget', () => {
  const plain = () => evaluate('While([i=0];1;[i=i+1];i)');
  let budgetError: unknown;
  try { plain(); } catch (e) { budgetError = e; }
  assert.ok(budgetError instanceof CalcError);
  for (const operation of ['Exp(0.5)', 'Ln(2)', '2^0.5', 'Sqrt(2)', '1/7']) {
    const formula = `SetPrecision(While([i=0;x=0];1;[i=i+1;x=${operation}];x);400)`;
    const start = performance.now();
    assert.throws(() => evaluate(formula), (e: unknown) =>
      e instanceof CalcError && e.code === budgetError.code && e.message === budgetError.message, operation);
    // The implementation's 1.3 s deadline leaves over 3x timing headroom here for busy CI hosts.
    assert.ok(performance.now() - start < 4200, `${operation} exceeded the calculation budget`);
  }
});

test('SetPrecision parameterized calculation round trips through script text', () => {
  for (const formula of ['SetPrecision(5/9;30)', 'SetPrecision(Sqrt(2);50)', 'SetPrecision(If(1;1/3;0);25)', 'SetPrecision(1.321321321321321321321321321;0)', 'SetPrecision(Pi;50)', 'SetPrecision(1e3/3;30)']) {
    assert.equal(result(nodeText(parse(formula))), result(formula));
  }
});

test('unsupported decimal values show a calculation error instead of throwing', () => {
  for (const formula of ['SetPrecision(1e2000;20)', 'SetPrecision(Ln(10^1000);30)', 'SetPrecision(Sqrt(1/0);30)']) {
    assert.equal(result(formula), '?', formula);
  }
});

test('date, time, and timestamp values retain their arithmetic meaning', () => {
  assert.equal(result('SetPrecision(Date(1;1;2020)+1;30)'), result('Date(1;1;2020)+1'));
  assert.equal(Number(result('SetPrecision(Time(1;2;3)/7;30)')), Number(result('Time(1;2;3)/7')));
  const timestamp = 'Timestamp(Date(1;1;2020);Time(1;2;3))+1';
  assert.equal(result(`SetPrecision(${timestamp};30)`), result(timestamp));
});

test('text operands use normal FileMaker number conversion', () => {
  for (const [plain, precise] of [
    ['"$12.5"+1', '13.5'], ['"1,234.5"+1', '1235.5'],
    ['"12abc3"*2', '246'], ['"1e3"+0', '13'],
  ]) {
    assert.equal(result(`SetPrecision(${plain};30)`), precise);
    assert.equal(result(plain), precise);
  }
});

test('numbers crossing into text lose guard digits at the requested precision', () => {
  const third = '0.333333333333333333333333333333';
  assert.equal(result('SetPrecision("abc" & 1/3;30)'), `abc${third}`);
  assert.equal(result('SetPrecision(Length(1/3);30)'), String(third.length));
  assert.equal(result('SetPrecision(GetAsText(1/3);30)'), third);
  assert.equal(result(`SetPrecision(1/3 = "${third}";30)`), '1');
});

test('zero and negative base powers follow ordinary arithmetic', () => {
  for (const formula of ['0^0.5', '0^0', '0^-1', '(-2)^3', '(-2)^2', '(-2)^0.5']) {
    assert.equal(result(`SetPrecision(${formula};20)`), result(formula), formula);
  }
});

test('large literals and custom function RangeErrors do not become recursion errors', () => {
  assert.equal(result('SetPrecision(1e999+1;20)'), result('1e999'));
  const ctx = { customFunction: (name: string) => name === 'Bad' ? {
    parameters: ['x'], formula: '-x',
  } : undefined };
  assert.throws(() => evaluate('SetPrecision(Bad(1/0);30)', ctx), (e: unknown) =>
    e instanceof CalcError && !/recursed too deeply/.test(e.message));
  assert.equal(evaluateText('SetPrecision(Bad(1/0);30)', ctx), '?');
  assert.equal(nodeText(parse('1e3')), '1000');
});

test('large integer powers preserve finite results and underflow', () => {
  const cases = [
    ['1^20000', '1'],
    ['0.5^20000', '0'],
    ['(-1)^10001', '-1'],
    ['1.0001^-20000', '0.13534881653937754818'],
    ['1.0000001^1000000', '1.10517091254979341664'],
    ['(-1)^-10001', '-1'],
  ];
  for (const [expression, expected] of cases) {
    const start = performance.now();
    assert.equal(result(`SetPrecision(${expression};20)`), expected, expression);
    assert.ok(performance.now() - start < 1000, `${expression} took over 1 s`);
    const highPrecisionStart = performance.now();
    assert.ok(result(`SetPrecision(${expression};400)`).startsWith(expected.includes('.') ? expected.slice(0, -1) : expected), expression);
    assert.ok(performance.now() - highPrecisionStart < 1000, `${expression} at 400 places took over 1 s`);
  }
});

test('long period finance functions retain decimal precision', () => {
  const start = performance.now();
  const fv = result('SetPrecision(FV(100;0.0001;10001);400)');
  assert.ok(fv.startsWith('1718417.74141790738652406844138063785076743403148564289045'));
  assert.equal(fv.split('.')[1]?.length, 400);
  assert.ok(performance.now() - start < 1000, 'FV took over 1 s');
  assert.equal(result('SetPrecision(PMT(100;0.0001;10001);20)'), '0.01581930677214072635');
  assert.equal(result('SetPrecision(PV(100;0.0001;10001);20)'), '632138.95172770351975402283');
  for (const name of ['PMT', 'PV']) {
    const highPrecisionStart = performance.now();
    assert.notEqual(result(`SetPrecision(${name}(100;0.0001;10001);400)`), '?');
    assert.ok(performance.now() - highPrecisionStart < 1000, `${name} at 400 places took over 1 s`);
  }
});

test('large negative exponential underflows without overflowing its reciprocal', () => {
  const start = performance.now();
  assert.equal(result('SetPrecision(Exp(-10000);20)'), '0');
  assert.equal(result('SetPrecision(Exp(-10000);400)'), '0');
  assert.ok(performance.now() - start < 1000, 'Exp(-10000) took over 1 s');
});

test('literal and computed magnitudes share the same cap', () => {
  for (const expression of ['1e399', '1e400', '1e300*1e101', '2^1329', '1e398*10']) {
    assert.equal(result(`SetPrecision(${expression};20)`), '?', expression);
  }
  const withinCap = result('SetPrecision(9e398;20)');
  assert.equal(withinCap, '9' + '0'.repeat(398));
  assert.equal(result('SetPrecision(9e398*1;20)'), withinCap);
  assert.equal(result('SetPrecision(1e-10000;20)'), '0');
});

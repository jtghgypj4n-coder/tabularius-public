import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCalc } from '../../fmp12/src/calc.ts';
import { evaluate, parse, asText } from '../src/index.ts';
import { unknownCalcTokens } from '../src/unknown.ts';

const decode = (hex: string) => decodeCalc(Buffer.from(hex.replaceAll(' ', ''), 'hex')).text;

for (const id of ['39', '89', 'a2', 'fb0a', 'fd01', 'c8', '1d000015464d44520002', '1d000015464d44520006', '1d000015464d4452000d']) {
  test(`undecoded function ${id}: bare and called nodes return ? without evaluating arguments or dispatching`, () => {
    const marker = decode(id);
    const forbidden = () => { throw new Error('must not dispatch'); };
    for (const formula of [marker, `${marker}()`, `${marker}(1 / 0 ; Let ($secret = 1 ; $secret))`]) {
      assert.equal(parse(formula).k, 'call');
      assert.equal(asText(evaluate(formula, { plugin: forbidden, customFunction: forbidden, field: forbidden, setVariable: forbidden })), '?');
    }
  });
}

for (const id of ['73', '22', '79', '6a', '36', '5d', '4d']) {
  test(`undecoded Get ${id}: returns ? before consulting host defaults`, () => {
    const formula = decode(`9b 04 9c${id} 05`);
    assert.equal(asText(evaluate(formula, { get: () => { throw new Error('must not dispatch'); } })), '?');
  });
}

test('unknown markers remain lazy; literals that look like markers are ordinary text', () => {
  assert.equal(asText(evaluate('If ( 0 ; ⟨fn:39⟩ ( 1 / 0 ) ; "safe" )')), 'safe');
  assert.equal(asText(evaluate('"⟨fn:39⟩"')), '⟨fn:39⟩');
  assert.throws(() => evaluate('MisspelledFunction()'), /cannot be found/);
  assert.throws(() => evaluate('<Function Missing>()'), /cannot be found/);
});

test('unknown tokens in custom-function tail positions skip resolution and arguments with or without tracing', () => {
  const forbidden = () => { throw new Error('must not dispatch'); };
  for (const marker of ['⟨fn:39⟩', '⟨FMDR:2⟩']) {
    for (const body of [marker, `${marker}(Let ($secret = 1 ; $secret))`, `If ( 1 ; ${marker}(Missing::Field) ; 0 )`, `Case ( 0 ; 0 ; ${marker}(1 / 0) )`]) {
      for (const trace of [undefined, () => {}]) {
        const notices: string[] = [];
        assert.equal(asText(evaluate('Wrapper()', {
          plugin: (name) => name === 'Wrapper' ? undefined : forbidden(),
          customFunction: (name) => name === 'Wrapper' ? { parameters: [], formula: body } : forbidden(),
          field: forbidden,
          setVariable: forbidden,
          notice: (message) => notices.push(message),
          trace,
        })), '?');
        assert.deepEqual(notices, [`Unknown function ${marker}: skipped; returns ?`]);
      }
    }
  }
});

test('collecting unknown-token shapes does not reorder a calculation tree', () => {
  const node = parse('⟨fn:39⟩ ( Get ( ⟨get:73⟩ ) ; ⟨FMDR:2⟩ ( "x" ) )');
  const before = structuredClone(node);
  unknownCalcTokens(node);
  assert.deepEqual(node, before);
});

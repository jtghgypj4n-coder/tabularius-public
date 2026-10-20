import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parser.ts';

test('calculation nesting limit counts levels rather than expression calls', () => {
  const mixed = (n: number) => '(1 + '.repeat(n) + '1' + ')'.repeat(n);
  assert.doesNotThrow(() => parse(mixed(1000)));
  assert.throws(() => parse(mixed(1001)), /Calculation is nested more than 1,000 levels deep/);
  assert.doesNotThrow(() => parse('1 + '.repeat(1500) + '1'));
});

test('a long run of text after "; word" without "=" is read in linear time', () => {
  // Found by the fuzz harness: the spaced Let-name scan was quadratic, about 4 s for this 25 KB shape.
  for (const tail of [' '.repeat(200_000), `"${'('.repeat(200_000)}"`]) {
    const started = performance.now();
    assert.throws(() => parse(`Let ( [ a = 1 ; é ${tail} ] ; a )`), /"=" expected/);
    assert.ok(performance.now() - started < 2000, `took ${Math.round(performance.now() - started)} ms`);
  }
  assert.equal(parse(`Let ( [ a = 1 ; b = "${' '.repeat(200_000)}" ] ; a )`).k, 'let');
  assert.throws(() => parse(`1 ;é "syn${'('.repeat(25_000)}`), /A text constant must end with a quotation mark/);
});

test('spaced Let names remain valid beyond 200 characters', () => {
  for (const length of [199, 200, 201, 256, 2048]) {
    const name = `a ${'b'.repeat(length - 2)}`;
    const result = parse(`Let ( [ ${name} = 7 ; next = ${name} + 1 ] ; next )`);
    assert.equal(result.k, 'let');
    if (result.k === 'let') {
      assert.equal(result.binds[0][0], name);
      assert.deepEqual(result.binds[1][1], { k: 'bin', op: '+', a: { k: 'var', name }, b: { k: 'num', value: 1 } });
    }
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '../src/parser.ts';
import { nodeText } from '../src/explain.ts';

for (const source of ['(not 0)+1', '1e999', '12345678901234567890', 'Pi()', 'While([x=0];x<2;[x=x+1];x)']) {
  test(`nodeText preserves the tree for ${source}`, () => {
    const tree = parse(source);
    assert.deepEqual(parse(nodeText(tree)), tree);
  });
}

test('nodeText distinguishes a literal pilcrow from a carriage return', () => {
  for (const source of ['"a\\¶b"', '"a¶b"', '"a\\¶b¶c"']) {
    const tree = parse(source);
    assert.deepEqual(parse(nodeText(tree)), tree, source);
  }
});

test('nodeText keeps a line feed inside a string apart from a carriage return', () => {
  for (const source of ['"a\\\nb"', '"a\nb"']) {
    const tree = parse(source);
    assert.deepEqual(parse(nodeText(tree)), tree, JSON.stringify(source));
  }
});

test('seeded nested expressions keep their parse trees through display text', () => {
  const atoms = ['0', '1e999', '12345678901234567890', 'Pi()', 'not 0',
    'While([x=0];x<2;[x=x+1];x)', 'Let([x=2];x+1)', '"a¶b"'];
  const operators = ['+', '-', '*', '/', '^', '&', '=', 'and', 'or'];
  let seed = 0x5eed;
  const next = (limit: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit);
  for (let i = 0; i < 128; i++) {
    const left = atoms[next(atoms.length)];
    const right = atoms[next(atoms.length)];
    const source = `(${left}) ${operators[next(operators.length)]} (${right})`;
    const tree = parse(source);
    assert.deepEqual(parse(nodeText(tree)), tree, source);
  }
});

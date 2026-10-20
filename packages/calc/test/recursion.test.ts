import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateText, type CalcContext, type CustomFunctionDef } from '../src/index.ts';

const defs = new Map<string, CustomFunctionDef>([
  // Not a tail call: the sum waits for the call below it.
  ['sum1', { parameters: ['n'], formula: 'If ( n <= 0 ; 0 ; n + Sum1 ( n - 1 ) )' }],
  // Tail calls: the answer is the call, through If or Case, with the running total passed along.
  ['sum2', { parameters: ['n', 'acc'], formula: 'If ( n <= 0 ; acc ; Sum2 ( n - 1 ; acc + n ) )' }],
  ['sum3', { parameters: ['n', 'acc'], formula: 'Case ( n = 0 ; acc ; n < 0 ; "negative" ; Sum3 ( n - 1 ; acc + n ) )' }],
  // A tail call from inside a Let still works (it just isn't taken as a loop).
  ['sum4', { parameters: ['n', 'acc'], formula: 'Let ( next = acc + n ; If ( n <= 0 ; acc ; Sum4 ( n - 1 ; next ) ) )' }],
  // The arguments of a tail call are read in the caller's scope, and the callee sees only its own parameters.
  ['swap', { parameters: ['a', 'b', 'times'], formula: 'If ( times = 0 ; a & "," & b ; Swap ( b ; a ; times - 1 ) )' }],
]);
const ctx: CalcContext = { customFunction: (name) => defs.get(name.toLowerCase()) };

test('a custom function that ends in a call to itself can recurse as deep as FileMaker allows', () => {
  assert.equal(evaluateText('Sum2 ( 9990 ; 0 )', ctx), '49905045');
  assert.equal(evaluateText('Sum3 ( 9990 ; 0 )', ctx), '49905045');
  assert.equal(evaluateText('Sum3 ( -1 ; 0 )', ctx), 'negative');
  assert.equal(evaluateText('Swap ( "x" ; "y" ; 5001 )', ctx), 'y,x');
});

test('FileMaker\'s limit of 10,000 levels still ends a runaway function, and SetRecursion lowers it', () => {
  assert.throws(() => evaluate('Sum2 ( 10100 ; 0 )', ctx), /recursed too deeply/);
  assert.throws(() => evaluate('SetRecursion ( Sum2 ( 50 ; 0 ) ; 20 )', ctx), /recursed too deeply/);
  assert.equal(evaluateText('SetRecursion ( Sum2 ( 50 ; 0 ) ; 100 )', ctx), '1275');
});

test('a function that waits for its own call still works as far as the server\'s stack allows, and says where it stopped', () => {
  assert.equal(evaluateText('Sum1 ( 500 )', ctx), '125250');
  assert.equal(evaluateText('Sum4 ( 200 ; 0 )', ctx), '20100');
  assert.throws(() => evaluate('Sum1 ( 9000 )', ctx), /recursed too deeply \(this server's stack ran out at level \d+; FileMaker allows 10000\)/);
});

test('the debugger\'s trace still sees every step of a recursive function', () => {
  let steps = 0;
  assert.equal(evaluateText('Sum2 ( 20 ; 0 )', { ...ctx, trace: () => { steps++; } }), '210');
  assert.ok(steps > 100, `${steps} steps traced`);
});

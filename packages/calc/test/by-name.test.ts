import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byNameReads, BY_NAME_FUNCTIONS, NameTable, parse, type Node } from '../src/index.ts';

const names = new NameTable({ fields: ['Party', 'x'], occurrences: [['Congress', ['Party', 'Name']]] });
const reads = (formula: string) => byNameReads(parse(formula, names));

test('only actual by-name calls enable text collection', () => {
  for (const formula of [
    'Upper ( Party ) // Evaluate ( "Party" )',
    'Let ( x = "Party" ; 1 ) // GetField',
    'Case ( 1 ; "GetField ( x )" )',
    'Upper ( Party ) /* GetField ( "Party" ) */',
    '"Congress::Par" & "ty"',
  ]) assert.deepEqual(reads(formula), { calls: [], texts: [] }, formula);
});

test('literal names, concatenation and Let bindings are collected without evaluation', () => {
  for (const formula of [
    'GetField ( "Congress::Par" & "ty" )',
    'Let ( f = "Congress::Party" ; GetField ( f ) )',
    'Let ( f = ( "Congress::Par" & "ty" ) ; GetField ( f ) )',
    'GetField ( "Congress::Party" )',
  ]) {
    const result = reads(formula);
    assert.deepEqual(result.calls, ['getfield']);
    assert.ok(result.texts.includes('Congress::Party'), formula);
    assert.ok(!result.incomplete, formula);
  }
  assert.deepEqual(reads('Evaluate ( "Party" )'), { calls: ['evaluate'], texts: ['Party'] });
  assert.deepEqual(reads('ExecuteSQL ( "SELECT Party FROM Congress" ; "" ; "" )'), {
    calls: ['executesql'], texts: ['SELECT Party FROM Congress', ''],
  });
  assert.ok(reads('GetField ( "Party" & 001 )').texts.includes('Party1'), 'numeric literal spelling is not its text value');
  assert.ok(reads('GetField ( "Party" & 1e2 )').texts.includes('Party100'));
  assert.ok(reads('GetField ( "Congress::P\\arty" )').texts.includes('Congress::Party'), 'strings come from decoded AST values');
});

test('computed arguments are unknown even when their input contains a literal', () => {
  // Upper is never run: its literal is retained, but its computed return value is unknown.
  const upper = reads('GetField ( Upper ( "Party" ) )');
  assert.deepEqual(upper.calls, ['getfield']);
  assert.deepEqual(upper.texts, ['Party']);
  assert.equal(upper.incomplete, true);
  assert.equal(reads('GetField ( x )').incomplete, true);
  assert.equal(reads('GetField ( "Congress::" & x )').incomplete, true);
  assert.equal(reads('Let ( f = Upper ( "Party" ) ; GetField ( f ) )').incomplete, true);
  assert.ok(!reads('Upper ( "noise" ) & GetField ( "Party" )').incomplete,
    'an unrelated computed result is not an unknown name argument');
});

test('Let bindings are sequential, case insensitive, scoped and shadowed', () => {
  assert.ok(!reads('Let ( [ f = "Party" ; g = f ] ; GetField ( G ) )').incomplete);
  assert.equal(reads('Let ( f = "Party" ; Let ( f = x ; GetField ( f ) ) )').incomplete, true);
  assert.ok(!reads('Let ( f = "Party" ; Let ( f = x ; 1 ) & GetField ( f ) )').incomplete);
  assert.equal(reads('Let ( f = "Party" ; 1 ) & GetField ( f )').incomplete, true);
});

test('all by-name functions, repetitions and While payloads are visited', () => {
  for (const name of BY_NAME_FUNCTIONS) assert.deepEqual(reads(`${name} ( "Party" )`).calls, [name]);
  for (const formula of [
    'x[GetField ( "Party" )]',
    '$x[GetField ( "Party" )]',
    '-GetField ( "Party" )',
    'Let ( $x[GetField ( "Party" )] = 1 ; Get ( CurrentDate ) )',
    'While ( [ f = "Party" ] ; GetField ( f ) ; [ f = x ] ; GetField ( f ) )',
  ]) assert.ok(reads(formula).calls.includes('getfield'), formula);
  assert.equal(reads('While ( [ f = "Party" ] ; GetField ( f ) ; [ f = x ] ; 0 )').incomplete, true,
    'loop-carried names cannot be treated as their initial constant value');
});

test('large concatenations and deeply nested trees are bounded and do not recurse', () => {
  const result = reads(`GetField ( ${Array(5000).fill('"abcdefghijklmnop"').join(' & ')} )`);
  assert.deepEqual(result.calls, ['getfield']);
  assert.equal(result.incomplete, true);
  assert.ok(result.texts.every((s) => s.length <= 64 * 1024));
  let deep: Node = { k: 'call', name: 'GetField', args: [{ k: 'str', value: 'Party' }] };
  for (let i = 0; i < 5000; i++) deep = { k: 'unary', op: '-', a: deep };
  assert.deepEqual(byNameReads(deep).calls, ['getfield']);
  assert.equal(reads(`GetField ( "${'x'.repeat(32768)}" & "${'y'.repeat(32769)}" )`).incomplete, true);
});

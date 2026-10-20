import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NameTable, evaluateText, type CalcContext, type Value } from '../src/index.ts';

// Claris's examples for JSONParse and JSONParsedState (FileMaker 2025). Variables hold the very value they were
// given, as the script engine's do, so a parsed copy stays with it.
function context(): CalcContext {
  const vars = new Map<string, Value>();
  return {
    names: new NameTable({ fields: [] }),
    variable: (name) => vars.get(name.toLowerCase()),
    setVariable: (name, _rep, value) => void vars.set(name.toLowerCase(), value),
  };
}
const t = (f: string, ctx = context()) => evaluateText(f, ctx);

test('JSONParse gives valid JSON back unchanged and "?" with the reason for anything else', () => {
  assert.equal(t('JSONParse ( "[3]" )'), '[3]');
  assert.equal(t('JSONParse ( "{\\"b\\": 1,  \\"a\\": 2}" )'), '{"b": 1,  "a": 2}');
  assert.match(t('JSONParse ( "[3" )'), /^\? \S/);
  assert.match(t('JSONParse ( "" )'), /^\? /);
  assert.match(t('JSONParse ( Pi )'), /^\? /);
});

test('JSONParsedState tells parsed JSON from text, as in Claris\'s examples', () => {
  assert.equal(t('Let ( $a = JSONParse ( "[3" ) ; JSONParsedState ( $a ) )'), '-1');
  assert.equal(t('Let ( $a = "[3]" ; JSONParsedState ( $a ) )'), '0');
  assert.equal(t('JSONParsedState ( JSONParse ( Pi ) )'), '-1');
  assert.equal(t('Let ( $a = JSONSetElement ( "" ; "a" ; "b" ; JSONString ) ; JSONParsedState ( $a ) )'), '3');
  assert.equal(t('Let ( $a = JSONParse ( "[3]" ) ; JSONParsedState ( $a ) )'), '4');
  assert.equal(t('JSONParsedState ( JSONParse ( "" ) )'), '-1');
  // Text made from parsed JSON is text again; a Let name keeps the parsed copy like a variable.
  assert.equal(t('Let ( a = JSONParse ( "{}" ) ; JSONParsedState ( a ) & JSONParsedState ( a & "" ) )'), '30');
  // A variable keeps it from one calculation to the next.
  const ctx = context();
  t('Let ( $$json = JSONParse ( "{\\"list\\":[1,2]}" ) ; "" )', ctx);
  assert.equal(t('JSONParsedState ( $$json ) & "," & JSONGetElement ( $$json ; "list[1]" )', ctx), '3,2');
});

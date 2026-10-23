// The device is asked where it is only when a step's calculation really calls
// Location or LocationValues: not for the word in a dialog's text, and also when
// a custom function calls it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Schema, ScriptStep } from '../../fmp12/src/index.ts';
import { stepLocates } from '../src/location-use.ts';

const schema = (customFunctions: { name: string; formula: string }[] = []) => ({ customFunctions } as unknown as Schema);
const step = (params: Record<string, unknown>) => ({ id: 0, name: 'Set Variable', enabled: true, params } as unknown as ScriptStep);

test('a call in a calculation asks; the word in quoted text does not', () => {
  const s = schema();
  assert.equal(stepLocates(step({ variable: '$w', value: 'Location ( 10 ; 5 )' }), s), true);
  assert.equal(stepLocates(step({ variable: '$w', value: 'GetValue ( LocationValues ( 10 ; 5 ) ; 4 )' }), s), true);
  assert.equal(stepLocates(step({ title: '"Your Location (approximate)"', message: '"Share Location ( 10 ; 5 )? We never do."' }), s), false);
  assert.equal(stepLocates(step({ value: 'Let ( x = 1 ; "Location ( x )" & x )' }), s), false);
  assert.equal(stepLocates(step({ value: 'Get ( AccountName )' }), s), false);
  assert.equal(stepLocates(step({ value: 'Location & " (field)"' }), s), false, 'a field named Location is read, not called');
});

test('custom functions that call Location are followed, through other functions and recursion', () => {
  const s = schema([
    { name: 'Here', formula: 'Location ( 30 ; 10 )' },
    { name: 'HereText', formula: '"lat/long: " & Here' },
    { name: 'Countdown', formula: 'If ( n > 0 ; Countdown ( n - 1 ) ; HereText )' },
    { name: 'Greeting', formula: '"Location ( unused )"' },
  ]);
  assert.equal(stepLocates(step({ value: 'HereText' }), s), true);
  assert.equal(stepLocates(step({ value: 'Countdown ( 3 )' }), s), true);
  assert.equal(stepLocates(step({ value: 'Greeting' }), s), false);
});

test('a cycle does not cache a false result for a reachable custom function', () => {
  const s = schema([
    { name: 'A', formula: 'B ( 1 ) + C ( 1 )' },
    { name: 'B', formula: 'A ( 1 )' },
    { name: 'C', formula: 'Location ( 1 )' },
  ]);
  assert.equal(stepLocates(step({ value: 'A ( 1 )' }), s), true);
  assert.equal(stepLocates(step({ value: 'B ( 1 )' }), s), true);
});

test('editing a custom function invalidates both function and step results', () => {
  const s = schema([{ name: 'Where', formula: '"nowhere"' }]);
  const call = step({ variable: '$x', value: 'Where' });
  assert.equal(stepLocates(call, s), false);
  s.customFunctions[0].formula = 'Location ( 1 )';
  assert.equal(stepLocates(call, s), true);
  s.customFunctions[0].formula = '"nowhere"';
  assert.equal(stepLocates(call, s), false);
});

test('editing a called custom function invalidates its caller', () => {
  const s = schema([{ name: 'Outer', formula: 'Inner ( 1 )' }, { name: 'Inner', formula: '"nowhere"' }]);
  const call = step({ value: 'Outer ( 1 )' });
  assert.equal(stepLocates(call, s), false);
  s.customFunctions[1].formula = 'Location ( 1 )';
  assert.equal(stepLocates(call, s), true);
});

test('Evaluate of text that names Location asks, as the text becomes a call', () => {
  assert.equal(stepLocates(step({ value: 'Evaluate ( "Location ( 10 ; 5 )" )' }), schema()), true);
});

test('a parameter that is not a formula falls back to the text outside its quotes', () => {
  // An unbalanced formula the parser rejects, with a real call outside the quotes.
  assert.equal(stepLocates(step({ value: 'Location ( 10 ; 5 ) & "' }), schema()), true);
  assert.equal(stepLocates(step({ value: '"Location ( 1 )" ) (' }), schema()), false);
});

test('asking about many steps does not serialize the custom functions each time', (t) => {
  const s = schema([{ name: 'Here', formula: 'Location ( 30 ; 10 )' }, { name: 'Plain', formula: '1 + 1' }]);
  const stringify = t.mock.method(JSON, 'stringify');
  for (let i = 0; i < 50; i++) stepLocates(step({ value: `Plain + ${i}` }), s);
  assert.equal(stringify.mock.callCount(), 0);
  // An edited function is still noticed.
  s.customFunctions[1].formula = 'Here';
  assert.equal(stepLocates(step({ value: 'Plain' }), s), true);
});

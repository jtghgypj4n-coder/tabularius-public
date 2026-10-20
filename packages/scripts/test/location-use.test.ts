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

test('Evaluate of text that names Location asks, as the text becomes a call', () => {
  assert.equal(stepLocates(step({ value: 'Evaluate ( "Location ( 10 ; 5 )" )' }), schema()), true);
});

test('a parameter that is not a formula falls back to the text outside its quotes', () => {
  // An unbalanced formula the parser rejects, with a real call outside the quotes.
  assert.equal(stepLocates(step({ value: 'Location ( 10 ; 5 ) & "' }), schema()), true);
  assert.equal(stepLocates(step({ value: '"Location ( 1 )" ) (' }), schema()), false);
});

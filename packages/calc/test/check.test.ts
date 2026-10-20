import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormula, type CheckResult } from '../src/index.ts';

const names = { fields: ['First Name', 'Total'], occurrences: [['Orders', ['Total', 'CustomerID']], ['Other File', []]] as [string, string[]][] };
const customFunctions = [['Double', ['x']], ['Pi2', []]] as [string, string[]][];
const check = (f: string, more = {}) => checkFormula(f, { names, customFunctions, unresolved: ['Other File'], ...more });
const error = (r: CheckResult) => (r.ok ? 'ok' : `${r.code} ${r.message} @${r.at}`);

test('formula check accepts what FileMaker accepts', () => {
  for (const f of [
    'Upper ( First Name )',
    'Sum ( Orders::Total ) * 2',
    'Let ( [ a = 1 ; b = a + 1 ] ; b * Total )',
    // A Let name is known in its own value, where it is still empty.
    'Let ( RowData = JSONGetElement ( RowData ; "a" ) ; RowData )',
    'While ( [ i = 0 ; out = "" ] ; i < 3 ; [ i = i + 1 ; out = out & i ] ; out )',
    'Double ( 2 ) + Pi2 + Pi + Random + Self',
    'Get ( FoundCount ) + $x + $$y',
    'Other File::Anything',
    '/* only a comment */',
  ]) assert.equal(error(check(f)), 'ok', f);
  assert.equal(error(check('x * 2', { parameters: ['x'] })), 'ok');
});

test('formula check reports the first error and where it is', () => {
  assert.equal(error(check('Total + Orders::Nope')), '102 The field "Orders::Nope" cannot be found @8');
  assert.equal(error(check('Nope::Total')), '1209 The table "Nope" cannot be found @0');
  assert.equal(error(check('1 + Lastname')), '102 The field "Lastname" cannot be found @4');
  assert.equal(error(check('Upperr ( 1 )')), '1208 The function "Upperr" cannot be found @0');
  assert.equal(error(check('Left ( "a" )')), '1201 Too few parameters in Left @0');
  assert.equal(error(check('Double ( 1 ; 2 )')), '1202 Too many parameters in Double @0');
  assert.equal(error(check('Double * 2')), '1201 "Double" needs parameters in parentheses @0');
  assert.equal(error(check('1 + ')), '1203 The calculation ends too soon @undefined');
  assert.equal(error(check('If ( 1 ; 2 ) 3')), '1208 Operator expected @13');
  assert.equal(error(check('x * y', { parameters: ['x'] })), '102 The field "y" cannot be found @4');
});

test('formula check accepts plug-in functions that aren\'t installed', () => {
  assert.equal(error(check('GetAsNumber ( EmailVersion ) < 1.61')), 'ok');
  assert.equal(error(check('EmailReadMessageValue ( "from" )')), 'ok');
  assert.equal(error(check('EmailReadMessageValue ( Nope )')), '102 The field "Nope" cannot be found @24');
});

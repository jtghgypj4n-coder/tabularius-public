// MBS ( "JSON.…" ) against the examples on MBS's own function pages (mbsplugins.eu). The pages show results
// flattened onto one line, so JSON is compared by content (compact) unless the layout itself is the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';
import { MBS_JSON, compact, parseJson, pretty } from '../src/mbs-json.ts';
import { MbsError } from '../src/mbs-text.ts';

/** A FileMaker text literal: quotes and backslashes escaped, a CR written as ¶. */
const q = (s: string) => '"' + s.replace(/[\\"¶]/g, (x) => '\\' + x).replace(/\r/g, '¶') + '"';
const fm = (c: CalcContext, name: string, ...args: (string | number)[]) =>
  evaluateText(`MBS ( ${[q(name), ...args.map((a) => (typeof a === 'number' ? String(a) : q(a)))].join(' ; ')} )`, c);
/** Called directly: numbers are FileMaker numbers, text is text. */
const direct = (scope: object) => (name: string, ...args: (string | number)[]) =>
  MBS_JSON[name.toLowerCase()](args.map((a) => ({ text: String(a), number: typeof a === 'number' })), scope);
const same = (got: string | number, want: string) => assert.equal(compact(parseJson(String(got))), compact(parseJson(want)));

test('AR-calc-extensions-08 JSON reference bulk and depth failures preserve the reference', () => {
  const j = direct({});
  const ref = j('JSON.Parse', '[]');
  assert.throws(() => j('JSON.AddNumberToArray', ref, 1, 'not-a-number'), MbsError);
  assert.equal(j('JSON.Compact', ref), '[]');
  const deep = '['.repeat(510) + '0' + ']'.repeat(510);
  const nested = j('JSON.Parse', '[[0]]');
  assert.throws(() => j('JSON.SetPathItem', nested, '0\r0', deep), /nested too deeply/);
  assert.equal(j('JSON.Compact', nested), '[[0]]');
});

test('MBS JSON: building objects and arrays, as the pages show', () => {
  const j = direct({});
  same(j('JSON.AddStringToObject', '{}', 'hello', 'world', 'test', 'entry'), '{"hello":"world","test":"entry"}');
  same(j('JSON.AddStringToObject', '{}', 'test', 'Hello World'), '{"test":"Hello World"}');
  same(j('JSON.AddItemToObject', '{}', 'Values', '[1,2]', 'Name', '{"FirstName":"Heinz"}'), '{"Values":[1,2],"Name":{"FirstName":"Heinz"}}');
  // Large numbers keep every digit.
  assert.equal(compact(parseJson(String(j('JSON.AddItemToObject', '{}', 'test', '12063660878882855000013426248015578834577')))), '{"test":12063660878882855000013426248015578834577}');
  same(j('JSON.AddItemToArray', '[1,2,3]', j('JSON.CreateNumber', 4)), '[1,2,3,4]');
  same(j('JSON.AddItemToArray', '[]', '1', '2', '"Heinz"'), '[1,2,"Heinz"]');
  same(j('JSON.AddItemToArray', '[]', 67), '[67]');
  same(j('JSON.AddNumberToObject', '{}', 'hello', 1, 'test', 5), '{"hello":1,"test":5}');
  same(j('JSON.AddStringToArray', '["1","2","3"]', '4'), '["1","2","3","4"]');
  same(j('JSON.AddNumberToArray', '[]', 1, 2, 3, 4), '[1,2,3,4]');
  same(j('JSON.AddValueToObject', '{}', 'Hello', 'World', 'test', 123, 'a', 'abc'), '{"Hello":"World","test":123,"a":"abc"}');
  // FileMaker's true is the number 1.
  same(j('JSON.AddValueToArray', '[]', 1, 2, 3, 'Hello', 1), '[1,2,3,"Hello",1]');
  assert.equal(j('JSON.CreateObject'), '{}');
  assert.equal(j('JSON.CreateArray'), '[]');
  assert.equal(j('JSON.CreateValue', 123), '123');
  assert.equal(j('JSON.CreateValue', 'Hello\rWorld\ttest'), '"Hello\\rWorld\\ttest"');
  same(j('JSON.ReplaceItemInObject', '{"key":"value"}', 'key', '"Hello"'), '{"key":"Hello"}');
  // Adding a key that's there replaces it (MBS 16.2).
  same(j('JSON.AddNumberToObject', '{"a":1}', 'a', 2), '{"a":2}');
  // The two people the AddItemToArray page builds.
  const joe = j('JSON.AddStringToObject', '{}', 'FirstName', 'Joe', 'LastName', 'Miller');
  const zoe = j('JSON.AddStringToObject', '{}', 'FirstName', 'Zoe', 'LastName', 'Jones');
  const people = j('JSON.AddItemToArray', '[]', joe, zoe);
  const all = j('JSON.AddStringToObject', j('JSON.AddItemToObject', '{}', 'people', people), 'count', '2');
  same(all, '{"people":[{"FirstName":"Joe","LastName":"Miller"},{"FirstName":"Zoe","LastName":"Jones"}],"count":"2"}');
});

test('MBS JSON: GetPathItem and SetPathItem, with list paths and FileMaker paths', () => {
  const j = direct({});
  const people = '{"people":[{"first":"Christian","last":"Schmitz","city":"Nickenich"}]}';
  assert.equal(j('JSON.GetPathItem', people, 'people\r0\rlast'), '"Schmitz"');
  assert.equal(j('JSON.GetPathItem', people, 'people\r0\rlast', 1), 'Schmitz');
  assert.equal(j('JSON.GetPathItem', '{"IDs":[1,5,8,2,5]}', 'IDs\r#'), 5);
  assert.equal(j('JSON.GetPathItem', people, 'people[0]last'), '"Schmitz"');
  assert.equal(j('JSON.GetPathItem', '{"people":{"best":{"first":"Christian"}}}', '.people.best.first', 3), 'Christian');
  assert.equal(j('JSON.GetPathItem', '[1,2,3]', '.[2]'), '3');
  assert.equal(j('JSON.GetPathItem', '{"people":{"best.friend":{"first":"Christian"}}}', "['people']['best.friend']['first']", 3), 'Christian');
  // Missing: an error, or empty with flag 2 (bad JSON too).
  assert.throws(() => j('JSON.GetPathItem', people, 'nobody'), MbsError);
  assert.equal(j('JSON.GetPathItem', people, 'nobody', 2), '');
  assert.equal(j('JSON.GetPathItem', '{bad', 'x', 2), '');

  same(j('JSON.SetPathItem', people, 'people\r0\rcountry', '"Germany"'),
    '{"people":[{"first":"Christian","last":"Schmitz","city":"Nickenich","country":"Germany"}]}');
  same(j('JSON.SetPathItem', '[1,2,3]', '1', 5), '[1,5,3]');
  same(j('JSON.SetPathItem', '{"test":[1,2,3]}', 'test\rappend', 5), '{"test":[1,2,3,5]}');
  same(j('JSON.SetPathItem', '{}', 'Hello\rWorld\rTest', '"Hello"'), '{"Hello":{"World":{"Test":"Hello"}}}');
  same(j('JSON.SetPathItem', '{ "a" : 11 }', 'b', '22.23 '), '{"a":11,"b":22.23}');
  same(j('JSON.SetPathItem', '[1,2,3]', '[5]', 4), '[1,2,3,null,null,4]');
  same(j('JSON.SetPathItem', people, 'people[0]last', '"test"'), '{"people":[{"first":"Christian","last":"test","city":"Nickenich"}]}');
  // A value that isn't JSON is text (MBS 14.3); an empty one changes nothing (13.0).
  same(j('JSON.SetPathItem', '{}', 'a', 'plain words'), '{"a":"plain words"}');
  same(j('JSON.SetPathItem', '{"a":1}', 'a', ''), '{"a":1}');
});

test('MBS JSON: reading values, sizes, types and lists', () => {
  const j = direct({});
  assert.equal(j('JSON.GetArraySize', '[1, 2, 3, 4]'), 4);
  assert.equal(j('JSON.GetArraySize', ''), 0);
  assert.equal(j('JSON.GetObjectSize', '{"a":"b", "c":"d"}'), 2);
  assert.equal(j('JSON.GetObjectNameList', '{"a":"b", "c":"d"}'), 'a\rc');
  assert.equal(j('JSON.GetType', j('JSON.CreateDoubleArray', 1, 2, 3)), 'array');
  assert.equal(j('JSON.GetType', 123), 'number');
  assert.equal(j('JSON.GetType', '[]'), 'array');
  assert.equal(j('JSON.GetArrayItem', j('JSON.CreateDoubleArray', 1, 2, 3), 1), '2');
  assert.equal(j('JSON.GetArrayItem', '["a","b"]', 1), '"b"');
  assert.equal(j('JSON.GetArrayItem', '["a","b"]', 1, 2), 'b');
  assert.equal(j('JSON.GetObjectItem', '{"hello":"world"}', 'hello'), '"world"');
  assert.equal(j('JSON.GetObjectItem', '{"hello":"world"}', 'error'), '');
  assert.equal(j('JSON.GetObjectItemTree', '{"addresses":[{"value":{"streetAddress":"Main"}}]}', 'addresses', 0, 'value', 'streetAddress'), '"Main"');
  assert.equal(j('JSON.GetStringValue', '"Hello\\rjust a test"'), 'Hello\rjust a test');
  assert.equal(j('JSON.GetStringValue', '"\\ud83c\\udf4e"'), '🍎');
  assert.equal(j('JSON.GetValue', '5'), '5');
  assert.equal(j('JSON.GetValue', '"Test JSON"'), 'Test JSON');
  assert.equal(j('JSON.GetValue', 'true'), '1');
  assert.equal(j('JSON.GetArrayItemsAsList', '["Hello","World",3]'), '"Hello"\r"World"\r3');
  assert.equal(j('JSON.GetArrayItemsAsList', '["Hello","World",3]', 1), 'Hello\rWorld\r3');
  assert.equal(j('JSON.IsValid', '[1,2,3]'), 1);
  assert.equal(j('JSON.IsValid', '[1,hello,3]'), 0);
  assert.equal(j('JSON.IsValid', 123), 1);
  assert.equal(j('JSON.IsValid', '[1] x'), 0);
});

test('MBS JSON: comparing, finding, merging and deleting', () => {
  const j = direct({});
  assert.equal(j('JSON.Equals', 1, 1), 1);
  assert.equal(`${j('JSON.Equals', '"Hello"', '"World"')}${j('JSON.Equals', '"Hello"', '"Hello"')}`, '01');
  assert.equal(`${j('JSON.Equals', '{"key":"value"}', '{"key":"value"}')}${j('JSON.Equals', '{"key":"value"}', '{"key":"Value"}')}`, '10');
  assert.equal(j('JSON.Equals', '{"a":1,"b":2}', '{"b":2,"a":1}'), 1);
  assert.equal(j('JSON.Equals', '"\\ud83c\\udf4e"', '"🍎"'), 1);
  assert.equal(j('JSON.Equals', '"123"', '123'), 0);
  assert.equal(j('JSON.EqualContent', '"123"', '123'), 1);
  assert.equal(j('JSON.FindValueInArray', '[5,6,7,1,4,3,7]', 3), 5);
  assert.equal(j('JSON.FindValueInArray', '["Hello", "World", "Test"]', '"World"'), 1);
  assert.equal(j('JSON.FindValueInArray', '[{"Hello":123}, {"World":234}, {"Test":345}]', '{"World":234}'), 1);
  assert.equal(j('JSON.FindValueInArray', '[5,6,3,7,1,4,3,7]', 3, 2), '2\r6');
  assert.equal(j('JSON.FindValueInArray', '[1,2]', 9), -1);
  same(j('JSON.Merge', '[1,2,3]', '[3,4,5]'), '[1,2,3,4,5]');
  same(j('JSON.Merge', '{"a":1, "c":3}', '{"b":2, "c":4}'), '{"a":1,"c":4,"b":2}');
  same(j('JSON.Merge', '{"a":[1,2], "c":3}', '{"a":[3,4], "b":2, "c":4}'), '{"a":[1,2,3,4],"c":4,"b":2}');
  same(j('JSON.Merge', '{"a":{"a":1}, "c":3}', '{"a":{"b":2}, "b":2}'), '{"a":{"a":1,"b":2},"c":3,"b":2}');
  same(j('JSON.Merge', '[1,2,3]', '[3,4,5]', '[6,7]', '[7,9]'), '[1,2,3,4,5,6,7,9]');
  same(j('JSON.AddArrayToArray', '[1,2]', '[3,4]', '[5]'), '[1,2,3,4,5]');
  same(j('JSON.DeleteItemFromArray', '[1,2,3]', 1), '[1,3]');
  same(j('JSON.DeleteItemFromObject', '{"Hello":"World","test":true}', 'test'), '{"Hello":"World"}');
  same(j('JSON.Sort', '{"last":123, "first":456}'), '{"first":456,"last":123}');
  same(j('JSON.Sort', '[9,4,3.2 ,3.1 ,123]'), '[3.1,3.2,4,9,123]');
});

test('MBS JSON: Format, Compact and SetFormatOptions', () => {
  const j = direct({});
  const doc = '{"test":1234, "values":[2,3,4]}';
  assert.equal(j('JSON.Format', doc), '{\n\t"test": 1234,\n\t"values": [2, 3, 4]\n}');
  assert.equal(j('JSON.SetFormatOptions', '-', '+'), 'OK');
  assert.equal(j('JSON.Format', doc), '{\n-"test":+1234,\n-"values":+[2, 3, 4]\n}');
  j('JSON.SetFormatOptions', '', '');
  assert.equal(j('JSON.Format', doc), '{\n"test":1234,\n"values":[2, 3, 4]\n}');
  j('JSON.SetFormatOptions');
  assert.equal(j('JSON.Format', '"\\ud83c\\udf4e"'), '"🍎"');
  assert.equal(j('JSON.Compact', '[1, 3, 4]'), '[1,3,4]');
  assert.equal(j('JSON.Compact', '{ "test": 12063660878882855000013426248015578834577}'), '{"test":12063660878882855000013426248015578834577}');
  assert.equal(pretty(parseJson('[{"a":1},[]]')), '[\n\t{\n\t\t"a": 1\n\t},\n\t[]\n]');
});

test('MBS JSON: references change in place, last for the session, and are released', () => {
  const scope = {};
  const j = direct(scope);
  const o = j('JSON.CreateObjectRef');
  assert.equal(j('JSON.AddStringToObject', o, 'FirstName', 'Christian'), o);
  assert.equal(j('JSON.AddNumberToObject', o, 'Age', 50), o);
  assert.equal(j('JSON.AddTrueToObject', o, 'married'), o);
  same(j('JSON.Format', o), '{"FirstName":"Christian","Age":50,"married":true}');
  // Adding a reference into another copies it, so releasing the first keeps the data.
  const a = j('JSON.CreateArrayRef');
  for (let i = 0; i < 3; i++) j('JSON.AddNumberToArray', a, i);
  j('JSON.AddItemToObject', o, 'list', a);
  assert.equal(j('JSON.Release', a), 'OK');
  same(j('JSON.Compact', o), '{"FirstName":"Christian","Age":50,"married":true,"list":[0,1,2]}');
  const p = j('JSON.Parse', '[1,2,3]');
  assert.equal(j('JSON.GetArraySize', p), 3);
  assert.equal(j('JSON.List', p), `${o}\r${p}`);
  // Another session doesn't see them.
  assert.throws(() => direct({})('JSON.Release', p), /Invalid JSON reference/);
  assert.equal(j('JSON.ReleaseAll'), 'OK');
  assert.equal(j('JSON.List'), '');
  assert.throws(() => j('JSON.Release', p), /Invalid JSON reference/);
});

test('MBS JSON: through MBS ( … ), bad JSON is an MBS error and IsError says so', () => {
  const c: CalcContext = {};
  assert.equal(fm(c, 'JSON.GetPathItem', '{"a":{"b":"x"}}', 'a\rb', 1), 'x');
  assert.match(fm(c, 'JSON.Format', '{bad'), /^\[MBS\] ERROR: JSON parse error/);
  assert.equal(evaluateText('MBS ( "IsError" )', c), '1');
  // A number from FileMaker goes in as a number, text as text.
  assert.equal(evaluateText('MBS ( "JSON.AddValueToArray" ; "[]" ; 5 ; "5" )', c).replace(/\s/g, ''), '[5,"5"]');
  assert.equal(evaluateText('MBS ( "IsError" )', c), '0');
  // What Tabularius doesn't do says so.
  assert.match(fm(c, 'JSON.ReplaceEvaluate', '{}', '$', '1'), /not available/);
});

test('MBS JSON: what a formula builds stays within bounds, and plain numbers are never taken for references', () => {
  const scope = {};
  const j = direct(scope);
  // Padding with null is limited for the whole path, and deep paths and deep trees are refused cleanly.
  assert.throws(() => j('JSON.SetPathItem', '[]', '[99999][99999][99999]', 1), /too large/);
  assert.throws(() => j('JSON.SetPathItem', '{}', Array(20_000).fill('a').join('\r'), '"x"'), /too long/);
  assert.throws(() => j('JSON.AddItemToArray', '[[[]]]', '['.repeat(512) + ']'.repeat(512)), /too deeply/);
  // A reference added into itself again and again stops at the size limit.
  const a = j('JSON.Parse', '[1,2,3,4,5,6,7,8]');
  assert.throws(() => {
    for (let i = 0; i < 30; i++) j('JSON.AddItemToArray', a, a);
  }, /too large/);
  // An ID of 1 is the number 1, whatever references are open.
  const o = j('JSON.CreateObjectRef');
  assert.ok(Number(o) > 1000);
  j('JSON.AddItemToObject', o, 'ID', j('JSON.CreateValue', 1));
  same(j('JSON.Compact', o), '{"ID":1}');
  assert.equal(j('JSON.GetType', 1), 'number');
  same(j('JSON.SetPathItem', '[1,2,3]', '1', 1), '[1,1,3]');
  // A return inside a string is taken as it is.
  assert.equal(j('JSON.GetStringValue', '"Hello\rjust a test"'), 'Hello\rjust a test');
  assert.throws(() => j('JSON.SetFormatOptions', ' '.repeat(100), ''), MbsError);
  // Many keys at once, and merging long arrays, stay quick.
  const pairs: (string | number)[] = [];
  // 20,000 pairs is 40,000 arguments; a spread of many more overflows the call stack on some platforms (macOS).
  for (let i = 0; i < 20_000; i++) pairs.push('k' + i, i);
  const start = Date.now();
  assert.equal(j('JSON.GetObjectSize', j('JSON.AddNumberToObject', '{}', ...pairs)), 20_000);
  const big = (from: number) => JSON.stringify(Array.from({ length: 20_000 }, (_, i) => from + i));
  assert.equal(j('JSON.GetArraySize', j('JSON.Merge', big(0), big(10_000))), 30_000);
  assert.ok(Date.now() - start < 5000, `${Date.now() - start} ms`);
});

test('MBS JSON: Clone, ArraySlice, GetObjectName, Text and the typed Get…Value functions, as their pages show', () => {
  const scope = {};
  const j = direct(scope);
  // Clone: a new reference to a copy.
  const a = j('JSON.Parse', '{"Hello":"World"}');
  const c = j('JSON.Clone', a);
  assert.notEqual(a, c);
  same(j('JSON.Format', c), '{"Hello":"World"}');
  j('JSON.AddStringToObject', c, 'Other', 'x');
  same(j('JSON.Format', a), '{"Hello":"World"}');

  // ArraySlice: the page's three examples, then a reference result and an empty slice.
  const fruit = '["Banana", "Orange", "Lemon", "Apple", "Mango"]';
  same(j('JSON.ArraySlice', fruit, 1, 2), '["Orange"]');
  same(j('JSON.ArraySlice', fruit, -3, -1), '["Lemon","Apple"]');
  same(j('JSON.ArraySlice', fruit, -10, 10, 0), '["Banana","Orange","Lemon","Apple","Mango"]');
  same(j('JSON.ArraySlice', fruit, 2), '["Lemon","Apple","Mango"]');
  same(j('JSON.ArraySlice', fruit, 3, 1), '[]');
  const ref = j('JSON.ArraySlice', fruit, 0, 2, 1);
  same(j('JSON.Format', ref), '["Banana","Orange"]');
  assert.throws(() => j('JSON.ArraySlice', '{"a":1}', 0, 1), MbsError);

  // GetObjectName: the name at an index.
  assert.equal(j('JSON.GetObjectName', '{"a":"b", "c":"d"}', 0), 'a');
  assert.equal(j('JSON.GetObjectName', '{"a":"b", "c":"d"}', 1), 'c');
  assert.throws(() => j('JSON.GetObjectName', '{"a":"b", "c":"d"}', 2), MbsError);

  // Text: the page's example with the escape decoded; a plain value is itself.
  assert.equal(j('JSON.Text', '{"test": "\\uD83C\\uDF4E"}'), 'test: 🍎');
  assert.equal(j('JSON.Text', '"hello"'), 'hello');
  assert.throws(() => j('JSON.Text', '[1,2]'), MbsError);

  // GetBooleanValue: true, a number that is not 0, and "1" or "true" give 1; anything else 0; empty gives empty.
  assert.equal(j('JSON.GetBooleanValue', 'true'), 1);
  assert.equal(j('JSON.GetBooleanValue', 'false'), 0);
  assert.equal(j('JSON.GetBooleanValue', '5'), 1);
  assert.equal(j('JSON.GetBooleanValue', '0'), 0);
  assert.equal(j('JSON.GetBooleanValue', '"true"'), 1);
  assert.equal(j('JSON.GetBooleanValue', '"1"'), 1);
  assert.equal(j('JSON.GetBooleanValue', '"yes"'), 0);
  assert.equal(j('JSON.GetBooleanValue', ''), '');
  // GetDoubleValue and GetIntegerValue: the page's "3.4" and "3".
  assert.equal(j('JSON.GetDoubleValue', '3.4'), 3.4);
  assert.equal(j('JSON.GetDoubleValue', '"2.5"'), 2.5);
  assert.equal(j('JSON.GetDoubleValue', '"abc"'), 0);
  assert.equal(j('JSON.GetDoubleValue', ''), '');
  assert.equal(j('JSON.GetIntegerValue', '3'), 3);
  assert.equal(j('JSON.GetIntegerValue', '3.9'), 3);
  assert.equal(j('JSON.GetIntegerValue', ''), '');
});

const BOOKS = JSON.stringify({
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
});

test('MBS JSON.Query: the JSONPath examples on its page, and the syntax they use', () => {
  const j = direct({});
  const q = (doc: string, path: string) => compact(parseJson(String(j('JSON.Query', doc, path, 0))));
  assert.equal(q('{"test":123}', '$'), '[{"test":123}]');
  assert.equal(q(BOOKS, '$.store.book[?(@.author =~ /Evelyn.*?/)].title'), '["Sword of Honour"]');
  assert.equal(q(BOOKS, '$.store.book[?(@.author =~ /Evelyn.*?/)]').includes('"price":12.99'), true);
  assert.equal(q(BOOKS, 'keys($.store.book[1])[*]'), '["category","author","title","price"]');
  assert.equal(q(BOOKS, '$.store[@.book[?(@.price > 10)].title]'), '["Sword of Honour","The Lord of the Rings"]');
  const tests = '[{"test":"abc","ID":1},{"test":"Hello","ID":2},{"test":"other","ID":3}]';
  assert.equal(q(tests, "$[?(@.test == 'Hello')]"), '[{"test":"Hello","ID":2}]');
  assert.equal(q(tests, "$[?(@.test == 'Hello' || @.test == 'abc')]"), '[{"test":"abc","ID":1},{"test":"Hello","ID":2}]');
  // The rest of the syntax the engine takes.
  assert.equal(q(BOOKS, '$.store.book[0,2].title'), '["Sayings of the Century","Moby Dick"]');
  assert.equal(q(BOOKS, '$.store.book[-1].title'), '["The Lord of the Rings"]');
  assert.equal(q(BOOKS, '$.store.book[1:3].title'), '["Sword of Honour","Moby Dick"]');
  assert.equal(q(BOOKS, '$.store.book[?(@.isbn)].title'), '["Moby Dick","The Lord of the Rings"]');
  assert.equal(q(BOOKS, '$.store.book[?(!@.isbn && @.price < 10)].title'), '["Sayings of the Century"]');
  assert.equal(q(BOOKS, "$..price"), '[8.95,12.99,8.99,22.99,19.95]');
  assert.equal(q(BOOKS, "$.store['bicycle'].color"), '["red"]');
  assert.equal(q('["test","abc","ast"]', "$[?(contains(@,'s'))]"), '["test","ast"]');
  assert.equal(q('{"a":1}', '$.missing'), '[]');
  // A function or syntax the engine does not have is an MBS error, and so are flags other than 0.
  assert.throws(() => j('JSON.Query', BOOKS, '$.store.book[?(length(@.title) > 3)]', 0), MbsError);
  assert.throws(() => j('JSON.Query', BOOKS, '$.store.book[', 0), MbsError);
  assert.throws(() => j('JSON.Query', BOOKS, '$', 1), MbsError);
});

test('MBS JSON.Replace: the page\'s examples, and a reference changed in place', () => {
  const j = direct({});
  const r = (doc: string, path: string, value: string | number) => compact(parseJson(String(j('JSON.Replace', doc, path, value))));
  assert.equal(r('{"author":"test","category":null,"price":null,"title":"test"}', '$..[?(@ == null)]', '""'), '{"author":"test","category":"","price":"","title":"test"}');
  assert.equal(r('[1,2,null,3,4]', '$..[?(@ == null)]', '0'), '[1,2,0,3,4]');
  assert.equal(r('["test","abc","ast"]', "$[?(contains(@,'s'))]", '"match"'), '["match","abc","match"]');
  // Plain text or a number as the new value, as since 14.1.
  assert.equal(r('{"price":1}', '$.price', 123), '{"price":123}');
  assert.equal(r('{"title":"a"}', '$.title', 'plain words'), '{"title":"plain words"}');
  assert.equal(r(BOOKS, "$.store.book[?(@.title == 'Moby Dick')].price", '1').includes('"price":1}'), true);
  // A reference is changed in place and given back.
  const ref = j('JSON.Parse', '[1,2,3]');
  assert.equal(j('JSON.Replace', ref, '$[1]', '20'), ref);
  same(j('JSON.Format', ref), '[1,20,3]');
  assert.throws(() => j('JSON.Replace', '[1]', '$[', '0'), MbsError);
});

test('MBS JSON.Query: a pattern that backtracks without end is stopped, not run', () => {
  const j = direct({});
  const doc = JSON.stringify([{ s: 'a'.repeat(60) + '!' }]);
  assert.throws(() => j('JSON.Query', doc, '$[?(@.s =~ /(a+)+$/)]', 0), /took longer|stopped|backtrack/i);
});

test('MBS JSON.Query/Replace: work and size are capped, whatever the path asks for', () => {
  const j = direct({});
  const zeros = (n: number) => JSON.stringify(Array(n).fill(0));
  const started = Date.now();
  // Many matches that each hold the whole document.
  const copies = '$[' + Array(400).fill('@').join(',') + ']';
  assert.throws(() => j('JSON.Query', zeros(10_000), `$${copies.slice(1)}${copies.slice(1)}`, 0), MbsError);
  // One replacement value repeated over many matches.
  assert.throws(() => j('JSON.Replace', zeros(150_000), '$[*]', JSON.stringify(Array(1000).fill([]))), /too large/);
  // A filter that searches the whole document for every child, objects compared with themselves, keys of a big object.
  assert.throws(() => j('JSON.Query', zeros(20_000), '$[?($[?(@ == 1)])]', 0), /too large|too long|took/);
  const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 4000 }, (_, k) => [`k${k}`, k])));
  assert.throws(() => j('JSON.Query', wide, '$[?($ == $)]', 0), /too large|too long|took/);
  assert.ok(Date.now() - started < 20_000, 'each of these stops quickly');
  // Deep negation is refused by the parser, not by a stack overflow.
  assert.throws(() => j('JSON.Query', '[1]', '$[?(' + '!'.repeat(9980) + '@)]', 0), /nested too deeply/);
});

test('MBS JSON.Replace: a value from keys() has no place to put the new value, and a match inside a match is left alone', () => {
  const j = direct({});
  same(j('JSON.Replace', '[{"x":1},"keep"]', 'keys($[0])[*]', 'Z'), '[{"x":1},"keep"]');
  same(j('JSON.Replace', '{"a":1,"b":2}', 'keys($)', 'Z'), '{"a":1,"b":2}');
  // The inner match is inside the outer one's old place; the value put there isn't searched again.
  same(j('JSON.Replace', '{"a":{"b":1}}', '$..*', '{"b":0}'), '{"a":{"b":0}}');
  // Query still gives keys() results.
  same(j('JSON.Query', '{"a":1,"b":2}', 'keys($)[*]', 0), '["a","b"]');
});

test('MBS JSON.Replace/Query: deep documents, wide objects and long text stay quick', () => {
  const j = direct({});
  const started = Date.now();
  const nested = '['.repeat(500) + JSON.stringify(Array(8000).fill(0)).slice(1, -1) + ']'.repeat(500);
  assert.ok(String(j('JSON.Replace', nested, '$..[?(@ == 0)]', '1')).length > 8000);
  const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 40_000 }, (_, k) => [`k${k}`, 0])));
  assert.ok(String(j('JSON.Replace', wide, '$.*', '1')).length > 40_000);
  // A long text counts for its length: many copies of it are refused, not built.
  assert.throws(() => j('JSON.Query', JSON.stringify('x'.repeat(100_000)), '$[' + Array(400).fill('@').join(',') + '][' + Array(400).fill('@').join(',') + ']', 0), /too large/);
  assert.throws(() => j('JSON.Replace', zerosOf(150_000), '$[*]', JSON.stringify('y'.repeat(1_000_000))), /too large/);
  // A long array is no trouble.
  assert.equal(JSON.parse(String(j('JSON.Query', JSON.stringify({ a: Array(300_000).fill(0) }), '$.a', 0)))[0].length, 300_000);
  assert.ok(Date.now() - started < 10_000, 'all of these finish quickly');
});
const zerosOf = (n: number) => JSON.stringify(Array(n).fill(0));

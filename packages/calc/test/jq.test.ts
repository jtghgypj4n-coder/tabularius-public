// The jq subset behind BE_JSON_jq. Expected results are what jq's manual gives for each filter; the inputs are written here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJq, JqError } from '../src/jq.ts';
import { evaluateText } from '../src/index.ts';

const c = (json: string, filter: string) => runJq(json, filter, { compact: true }).split('\n').filter((x) => x !== '');
const one = (json: string, filter: string) => {
  const r = c(json, filter);
  assert.equal(r.length, 1, `${filter} gave ${r.length} results`);
  return r[0];
};

test('paths, slices, iteration and optional access', () => {
  const doc = '{"a":{"b":[10,20,30]},"s":"héllo","n":null}';
  assert.equal(one(doc, '.a.b[1]'), '20');
  assert.equal(one(doc, '.a.b[-1]'), '30');
  assert.equal(one(doc, '.a.b[1:]'), '[20,30]');
  assert.equal(one(doc, '.a.b[:2]'), '[10,20]');
  assert.equal(one(doc, '.s[1:3]'), '"él"');
  assert.deepEqual(c(doc, '.a.b[]'), ['10', '20', '30']);
  assert.equal(one(doc, '.missing'), 'null');
  assert.equal(one(doc, '.n.x'), 'null');
  assert.equal(one(doc, '."a"."b"|length'), '3');
  assert.equal(one(doc, '.s.x?'.replace('.s.x?', '[.s.x?]')), '[]');
  assert.deepEqual(c(doc, '[..|numbers]'), ['[10,20,30]']);
});

test('operators, comparison, alternatives and conditionals', () => {
  assert.equal(one('{"a":3}', '.a * 2 + 1'), '7');
  assert.equal(one('null', '"ab" * 3'), '"ababab"');
  assert.equal(one('{}', '{"a":1} + {"b":2}'), '{"a":1,"b":2}');
  assert.equal(one('{}', '{"a":{"b":1}} * {"a":{"c":2}}'), '{"a":{"b":1,"c":2}}');
  assert.equal(one('[1,2,3,2]', '. - [2]'), '[1,3]');
  assert.equal(one('"a,b"', '. / ","'), '["a","b"]');
  assert.equal(one('5', '. % 3'), '2');
  assert.equal(one('-5', '. % 3'), '-2');
  assert.equal(one('null', '.x // "dflt"'), '"dflt"');
  assert.equal(one('{"x":false}', '.x // 7'), '7');
  assert.equal(one('1', 'if . > 0 then "pos" elif . < 0 then "neg" else "zero" end'), '"pos"');
  assert.equal(one('1', '1 < 2 and 2 < 1 or true'), 'true');
  assert.equal(one('null', '[1,"a",null,true,[],{}] | sort'), '[null,true,1,"a",[],{}]');
  assert.equal(one('null', '[] | length'), '0');
});

test('construction, binding, reduce, foreach and functions', () => {
  const rows = '[{"n":"a","v":1},{"n":"b","v":2},{"n":"a","v":5}]';
  assert.equal(one(rows, 'map(.v) | add'), '8');
  assert.equal(one(rows, '[.[] | select(.v > 1) | .n]'), '["b","a"]');
  assert.equal(one(rows, 'group_by(.n) | map({n: .[0].n, total: (map(.v) | add)})'), '[{"n":"a","total":6},{"n":"b","total":2}]');
  assert.equal(one(rows, 'map({(.n): .v}) | add'), '{"a":5,"b":2}');
  assert.equal(one(rows, 'reduce .[] as $r (0; . + $r.v)'), '8');
  assert.deepEqual(c('[1,2,3]', 'foreach .[] as $x (0; . + $x)'), ['1', '3', '6']);
  assert.equal(one(rows, '.[0] as $f | $f.n'), '"a"');
  assert.equal(one(rows, '{n: .[0].n, "q": 1, (.[1].n): 2}'), '{"n":"a","q":1,"b":2}');
  assert.equal(one('{"a":1,"b":2}', '{a}'), '{"a":1}');
  assert.equal(one('3', 'def double: . * 2; def add3(x): . + x; double | add3(10)'), '16');
  assert.equal(one('5', 'def fac: if . <= 1 then 1 else . * (. - 1 | fac) end; fac'), '120');
  assert.equal(one('"x"', '"v=\\(.) n=\\(1+1)"'), '"v=x n=2"');
  assert.equal(one('{"a":[1,2]}', 'to_entries | map(.key)'), '["a"]');
  assert.equal(one('{"a":1,"b":2}', 'with_entries(.value += 1)'), '{"a":2,"b":3}');
  assert.equal(one('[[1,2],[3]]', 'flatten'), '[1,2,3]');
  assert.equal(one('[3,1,2]', 'sort_by(-.) | first'), '3');
  assert.equal(one('[1,2,3]', '[limit(2; .[])]'), '[1,2]');
  assert.equal(one('null', '[range(3)]'), '[0,1,2]');
  assert.equal(one('null', '[range(0;10;4)]'), '[0,4,8]');
});

test('string functions, regular expressions and formats', () => {
  assert.equal(one('"Hello World"', 'ascii_downcase'), '"hello world"');
  assert.equal(one('"a-b-c"', 'split("-") | join("+")'), '"a+b+c"');
  assert.equal(one('"foo.txt"', 'rtrimstr(".txt")'), '"foo"');
  assert.equal(one('"abc123"', 'test("[0-9]+")'), 'true');
  assert.equal(one('"abc123"', 'test("ABC"; "i")'), 'true');
  assert.equal(one('"a1b22"', 'gsub("[0-9]+"; "#")'), '"a#b#"');
  assert.equal(one('"abc"', 'sub("b"; "X")'), '"aXc"');
  assert.equal(one('"42"', 'tonumber + 1'), '43');
  assert.equal(one('[1,"a",null]', 'map(tostring)'), '["1","a","null"]');
  assert.equal(one('{"a":[1,2]}', 'tojson'), '"{\\"a\\":[1,2]}"');
  assert.equal(one('"{\\"a\\":1}"', 'fromjson | .a'), '1');
  assert.equal(one('["a","b,c"]', '@csv'), '"\\"a\\",\\"b,c\\""');
  assert.equal(one('"a b"', '@uri'), '"a%20b"');
  assert.equal(one('"hi"', '@base64'), '"aGk="');
  assert.equal(one('"<&>"', '@html'), '"&lt;&amp;&gt;"');
  assert.equal(one('{"n":"x y"}', '@uri "q=\\(.n)"'), '"q=x%20y"');
  assert.equal(one('"abc"', 'contains("b")'), 'true');
  assert.equal(one('{"a":[1,2,{"b":3}]}', 'contains({a:[{b:3}]})'), 'true');
});

test('assignment, update and delete', () => {
  assert.equal(one('{"a":1}', '.b = 2'), '{"a":1,"b":2}');
  assert.equal(one('{"a":[1,2,3]}', '.a[] |= . * 2'), '{"a":[2,4,6]}');
  assert.equal(one('{"a":1}', '.a += 4'), '{"a":5}');
  assert.equal(one('{"a":{"b":1}}', '.a.b |= . + 1'), '{"a":{"b":2}}');
  assert.equal(one('{"a":1,"b":2}', 'del(.a)'), '{"b":2}');
  assert.equal(one('[1,2,3,4]', 'del(.[0,2])'), '[2,4]');
  assert.equal(one('[1,2,3,4]', 'map(select(. % 2 == 0))'), '[2,4]');
  assert.equal(one('null', '.a.b.c = 1'), '{"a":{"b":{"c":1}}}');
  assert.equal(one('{"a":[{"x":1},{"x":2}]}', '(.a[] | select(.x == 2) | .x) = 9'), '{"a":[{"x":1},{"x":9}]}');
  assert.equal(one('{"a":1}', 'setpath(["b","c"]; 5)'), '{"a":1,"b":{"c":5}}');
  assert.equal(one('{"a":{"b":2}}', '[paths]'), '[["a"],["a","b"]]');
  assert.equal(one('{"a":{"b":2}}', 'getpath(["a","b"])'), '2');
});

test('errors, try and the safety limits', () => {
  assert.equal(one('1', 'try error("x") catch .'), '"x"');
  assert.equal(one('"a"', '[.[]?]'), '[]');
  assert.deepEqual(c('[1,"a"]', '.[] | numbers'), ['1']);
  assert.throws(() => c('1', '.[]'), (e: Error) => e instanceof JqError && /Cannot iterate over number/.test(e.message));
  assert.throws(() => c('1', '. / 0'), JqError);
  assert.throws(() => c('{', '.'), JqError);
  assert.throws(() => c('1', '.a |'), JqError);
  assert.throws(() => c('1', 'nosuchfunction'), (e: Error) => /nosuchfunction\/0 is not defined/.test(e.message));
  assert.throws(() => c('null', 'last(range(1e12))'), (e: Error) => /too many steps/.test(e.message));
  assert.throws(() => c('null', 'def f: f | f; f'), (e: Error) => e instanceof JqError);
  assert.throws(() => c('null', '[repeat(1)]'), (e: Error) => /too many steps|too many results/.test(e.message));
  // A pattern that backtracks without end is cut off, not left running (BE_JSON_jq turns that into ?).
  const started = Date.now();
  const bomb = evaluateText('BE_JSON_jq ( "\\"' + 'a'.repeat(40) + '!\\"" ; "test(\\"(a*)*b\\")" ; "c" )', {});
  assert.ok(bomb === '?' || bomb === 'false', bomb);
  assert.ok(Date.now() - started < 5000, 'the pattern was cut off');
  assert.throws(() => c('null', '(' .repeat(300) + '1' + ')'.repeat(300)), JqError);
  assert.equal(one('{"__proto__":{"x":1}}', '.__proto__.x'), '1');
  assert.equal(one('{}', '.["__proto__"] = 5 | keys'), '["__proto__"]');
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test('output options and the BE_JSON_jq function', () => {
  assert.equal(runJq('{"a":[1,2]}', '.', {}), '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.equal(runJq('["a","b"]', '.[]', { raw: true }), 'a\nb');
  assert.equal(runJq('["a","b"]', '.[]', { raw: true, join: true }), 'ab');
  const f = (expr: string) => evaluateText(expr, {});
  assert.equal(f('BE_JSON_jq ( "[1,2,3]" ; "map(. * 2)" ; "c" )'), '[2,4,6]');
  assert.equal(f('BE_JSON_jq ( "[\\"a\\",\\"b\\"]" ; ".[]" ; "r" )'), 'a\nb');
  assert.equal(f('BE_JSON_jq ( "[1]" ; ".[" ; "c" ) & "/" & BE_GetLastError & "/" & (Length ( BE_JSON_Error_Description ) > 0)'), '?/-1/1');
  assert.equal(f('BE_JSON_jq ( "1" ; "." ; "V" )'), 'jq-1.7 (Tabularius subset)');
});

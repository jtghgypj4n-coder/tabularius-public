import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownJavaScript } from '../src/bejs.ts';
import { evaluateText } from '../src/index.ts';

// The programs Todd Geist's json custom functions build (header lines, a blank line, a fixed body).
const program = (vars: string[], body: string) => vars.join('\r') + '\r\r' + body;

test('BE_EvaluateJavaScript: the json custom functions are computed without running JavaScript', () => {
  assert.equal(knownJavaScript(program(['var json = {"a":[1,2]} ; ', 'var whiteSpace = "" ; '], 'json = JSON.stringify(json, null , whiteSpace);')), '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.equal(knownJavaScript('var json = {"a":1,"b":2} ; \r\r\r\rvar keys = Object.keys(json);\rkeys = keys.join(\'\\r\');\rkeys'), 'a\rb');
  assert.equal(knownJavaScript('var json = {"a":1,"b":{"c":null},"d":null} ; \r\rvar keys = Object.keys(json);\rvar outArray = [];\rkeys.forEach(function (key) { outArray.push(value); });'), '1\r{"c":null}\r');
  assert.equal(knownJavaScript(program(['var json = [1,2,3] ; ', 'var keyOrIndex = "1" ; '], 'json.splice(keyOrIndex,1) } else { delete json[keyOrIndex]; }')), '[1,3]');
  assert.equal(knownJavaScript(program(['var target = {"a":1} ; ', 'var source = {"a":2,"b":3} ; '], 'JSON.stringify ( Object.assign(target, source));')), '{"a":2,"b":3}');
  const modify = (json: string, path: string, value: string) =>
    knownJavaScript(program([`var json = ${json} ; `, `var keyOrIndexOrPath = "${path}" ; `, `var newValue = ${value} ; `], 'var r = modify(json, keyOrIndexOrPath, newValue);'));
  assert.equal(modify('{"a":1}', 'b.c[1]', '"x:y"'), '{"a":1,"b":{"c":[null,"x:y"]}}');
  assert.equal(modify('[1,2]', '[0]', '5'), '[5,2]');
  assert.equal(modify('{"a":{"b":1}}', 'a.b', '{"z":true}'), '{"a":{"b":{"z":true}}}');
  // Quote ( ) text: escaped quotes and returns survive.
  assert.equal(modify('{}', 'k', '"say \\"hi\\"\rthere"'), '{"k":"say \\"hi\\"\\rthere"}');
  // Bad JSON gives the error the custom functions look for.
  assert.match(modify('not json', 'a', '1')!, /^SyntaxError/);
});

test('BE_EvaluateJavaScript runs nothing else', () => {
  assert.equal(knownJavaScript('var x = 1 ; \r\rwhile(true){}'), undefined);
  assert.equal(knownJavaScript('fetch("https://example.com")'), undefined);
  // A recognised body with a value that isn't JSON data is never evaluated.
  assert.match(knownJavaScript(program(['var json = (function(){ return {} })() ; '], 'var keys = Object.keys(json);\rkeys.join(\'\\r\')'))!, /^SyntaxError/);
  assert.equal(evaluateText('BE_EvaluateJavaScript ( "1+1" )'), '?');
  assert.equal(evaluateText('BE_EvaluateJavaScript ( "var json = {\\"a\\":1} ; ¶¶var keys = Object.keys(json); keys.join(\'\\\\r\')" )'), 'a');
});

test('BaseElements file, folder, clipboard and shell functions never run', () => {
  // Text files only through the host's own folders (a script's documents folder); with none, the file is missing.
  for (const f of ['BE_FileReadText ( "/etc/passwd" )', 'BE_FileWriteText ( "/tmp/x" ; "y" ; "" )']) {
    assert.equal(evaluateText(`${f} & "/" & BE_GetLastError`), '/2', f);
  }
  for (const f of ['BE_ExecuteSystemCommand ( "ls" ; 1000 )', 'BE_SelectFolder ( "Pick" )', 'BE_ClipboardGetText ( "public.utf8-plain-text" )']) {
    assert.equal(evaluateText(f), '?', f);
  }
  assert.equal(evaluateText('Let ( x = BE_ExecuteSystemCommand ( "ls" ; 1 ) ; BE_JSON_Error_Description )'), 'BE_ExecuteSystemCommand is not available in Tabularius');
  const ctx = { executeSQL: (sql: string) => (sql.startsWith('SELECT') ? [[{ type: 'text', value: 'a' }, { type: 'number', value: 1 }], [{ type: 'text', value: 'b' }, { type: 'number', value: 2 }]] : []) } as never;
  assert.equal(evaluateText('BE_FileMakerSQL ( "SELECT x, y FROM t" ; "," ; "¶" ; "file" )', ctx), 'a,1\rb,2');
  assert.equal(evaluateText('BE_FileMakerSQL ( "SELECT x, y FROM t" )', ctx), 'a\t1\rb\t2');
});

// The JSON functions of the MBS plug-in and the jsonModify program of BE_EvaluateJavaScript refuse work and memory a
// small formula could otherwise ask for: a huge array index, a merge that compares every pair, an indent that
// multiplies the text, and parsed trees that no budget counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownJavaScript } from '../src/bejs.ts';
import { MBS_JSON } from '../src/mbs-json.ts';
import { retainedBudget } from '../src/retained-budget.ts';

const A = (text: string, number = false) => ({ text, number });
const json = (name: string, scope: object, ...args: string[]) => MBS_JSON[name]!(args.map((a) => A(a)), scope);
const program = (vars: string[], body: string) => vars.join('\r') + '\r\r' + body;
const modify = (doc: string, path: string, value: string) =>
  knownJavaScript(program([`var json = ${doc} ; `, `var keyOrIndexOrPath = "${path}" ; `, `var newValue = ${value} ; `], 'var r = modify(json, keyOrIndexOrPath, newValue);'));

test('jsonModify refuses an array index past the limit, quickly', () => {
  const t = performance.now();
  for (const path of ['[30000000]', '[100000000]', 'a[2000000]', '[0][4294967290]']) {
    const out = modify('[]', path, '1');
    assert.match(String(out), /^\w*Error: Array index.*past the 1,000,000/, path);
  }
  assert.ok(performance.now() - t < 2000, 'the index was walked');
  assert.equal(modify('[]', '[3]', '1'), '[null,null,null,1]');
  assert.equal(modify('[1]', '[1000000]', '1')!.length > 1_000_000, true);
});

test('JSON.Merge of two long arrays of objects is not a pairwise comparison', () => {
  const scope = {};
  const n = 20_000;
  const mk = (from: number) => '[' + Array.from({ length: n }, (_, i) => `{"a":${i + from}}`).join(',') + ']';
  const t = performance.now();
  const out = json('json.merge', scope, mk(0), mk(n)) as string;
  assert.ok(performance.now() - t < 5000, 'every pair was compared');
  assert.equal((out.match(/"a"/g) ?? []).length, 2 * n);
});

test('JSON.Merge still treats equal objects and arrays as already present', () => {
  const scope = {};
  const merged = (a: string, b: string) => JSON.parse(json('json.merge', scope, a, b) as string);
  // Entry order does not matter, numbers compare by value, nested values compare deeply.
  assert.deepEqual(merged('[{"a":1,"b":2}]', '[{"b":2,"a":1}]'), [{ a: 1, b: 2 }]);
  assert.deepEqual(merged('[{"a":1}]', '[{"a":1.0},{"a":"1"}]'), [{ a: 1 }, { a: '1' }]);
  assert.deepEqual(merged('[[1,2],{"k":[1]}]', '[[1,2],[2,1],{"k":[1]},{"k":[]}]'), [[1, 2], { k: [1] }, [2, 1], { k: [] }]);
  assert.deepEqual(merged('[1,"a"]', '["a",2,{"x":null}, {"x":null}]'), [1, 'a', 2, { x: null }]);
});

test('JSON.Format refuses an indent that multiplies the text before building it', () => {
  const scope = {};
  json('json.setformatoptions', scope, ' '.repeat(16), ' ');
  const depth = 480;
  const doc = '['.repeat(depth) + '{"k":1},'.repeat(20000).slice(0, -1) + ']'.repeat(depth);
  const t = performance.now();
  assert.throws(() => json('json.format', scope, doc), /too large/);
  assert.ok(performance.now() - t < 5000, 'the text was built first');
  // Ordinary output is unchanged.
  const plain = {};
  assert.equal(json('json.format', plain, '{"a":[1,2],"b":{"c":"d"}}'), '{\n\t"a": [1, 2],\n\t"b": {\n\t\t"c": "d"\n\t}\n}');
});

test('parsed JSON references are counted by the session retained-memory budget', () => {
  const scope = {};
  const budget = retainedBudget(scope, 200_000);
  const doc = '[' + '1,'.repeat(999) + '1]';
  const refs: number[] = [];
  let refused: unknown;
  for (let i = 0; i < 100 && !refused; i++) {
    try { refs.push(json('json.parse', scope, doc) as unknown as number); } catch (e) { refused = e; }
  }
  assert.match(String((refused as Error)?.message), /retained memory limit/);
  assert.ok(refs.length > 1 && refs.length < 100, `kept ${refs.length}`);
  const used = budget.used;
  assert.ok(used > 0 && used <= 200_000);
  // Releasing one gives its bytes back, so another parse fits; releasing all empties the account.
  json('json.release', scope, String(refs[0]));
  assert.ok(budget.used < used);
  json('json.parse', scope, doc);
  json('json.releaseall', scope);
  assert.equal(budget.used, 0);
});

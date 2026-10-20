// The JSON functions keep recent texts' parsed trees and each tree's text. Whatever they kept, every answer must
// be what parsing the text afresh gives: a leading space is a text the cache has never seen, read the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';

const lit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const set = (json: string, key: string, value: string, type: string) => evaluateText(`JSONSetElement ( ${lit(json)} ; ${lit(key)} ; ${value} ; ${type} )`);
const get = (json: string, key: string) => evaluateText(`JSONGetElement ( ${lit(json)} ; ${lit(key)} )`);
const del = (json: string, key: string) => evaluateText(`JSONDeleteElement ( ${lit(json)} ; ${lit(key)} )`);

test('a JSON text built a key at a time reads the same as the text parsed afresh', () => {
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const keys = ['a', 'b', 'c.d', 'c.e', 'list[+]', 'list[0]', 'list[:]', 'n', 'deep.x.y'];
  const values: [string, string][] = [['0.1 + 0.2', 'JSONNumber'], ['1/0', 'JSONNumber'], ['-0', 'JSONNumber'], ['"text ¶ with \\"quotes\\""', 'JSONString'],
    ['12345678901234567890', 'JSONNumber'], ['"{\\"k\\":1.5}"', 'JSONObject'], ['"[1,2,3]"', 'JSONArray'], ['1', 'JSONBoolean'], ['""', 'JSONNull'], ['"7"', 'JSONRaw']];
  let cached = '{}';
  let fresh = '{}';
  for (let i = 0; i < 400; i++) {
    const key = keys[rnd(keys.length)];
    if (rnd(5) === 0) {
      cached = del(cached, key);
      fresh = del(` ${fresh}`, key);
    } else {
      const [value, type] = values[rnd(values.length)];
      cached = set(cached, key, value, type);
      fresh = set(` ${fresh}`, key, value, type);
    }
    assert.equal(cached, fresh, `step ${i}`);
    for (const k of ['a', 'n', 'c', 'list', 'list[0]', 'deep.x.y']) assert.equal(get(cached, k), get(` ${cached}`, k), `step ${i}, ${k}`);
  }
  assert.ok(cached.length > 64, 'long enough to be kept');
});

test('a number rounded when written reads back as written', () => {
  const json = set('{"pad":"' + 'x'.repeat(80) + '"}', 'n', '0.1 + 0.2', 'JSONNumber');
  assert.match(json, /"n":0\.3\b/);
  assert.equal(get(json, 'n'), '0.3');
  assert.equal(evaluateText(`JSONGetElement ( ${lit(json)} ; "n" ) = .3`), '1');
});

test('a key named __proto__ is copied as a key, as before', () => {
  const json = '{"__proto__":{"x":1},"pad":"' + 'x'.repeat(80) + '"}';
  const out = set(json, 'b', '2', 'JSONNumber');
  assert.match(out, /"__proto__":\{"x":1\}/);
  assert.match(del(out, 'b'), /"__proto__":\{"x":1\}/);
});

test('"__proto__" and "toString" are keys like any other', () => {
  assert.equal(evaluateText('JSONSetElement ( "{}" ; [ "__proto__" ; "{\\"a\\":1}" ; JSONObject ] ; [ "b" ; 2 ; JSONNumber ] )'), '{"__proto__":{"a":1},"b":2}');
  assert.equal(evaluateText('JSONSetElement ( "{}" ; "__proto__.a" ; 1 ; JSONNumber )'), '{"__proto__":{"a":1}}');
  assert.equal(get('{"a":1}', 'toString'), '');
  assert.equal(get('{"a":1}', '__proto__'), '');
});

test('very long texts are not kept', () => {
  const big = set('{}', 'pad', lit('x'.repeat(300 * 1024)), 'JSONString');
  assert.equal(get(big, 'pad').length, 300 * 1024);
  assert.equal(get(` ${big}`, 'pad').length, 300 * 1024);
});

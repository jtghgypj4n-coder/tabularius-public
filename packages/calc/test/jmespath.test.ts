// JMESPath against the language's own compliance suite (jmespath.test, Apache-2.0; see NOTICE), then the limits that
// matter because the expression comes from a formula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jmesSearch } from '../src/jmespath.ts';
import { MBS_JSON, compact, parseJson, type Json } from '../src/mbs-json.ts';
import { MbsError } from '../src/mbs-text.ts';

const io = { parse: parseJson, compact };
const search = (doc: string, expr: string): string => compact(jmesSearch(parseJson(doc), expr, io));
/** A value as plain JavaScript, numbers by value. */
const plain = (j: Json): unknown => (j.t === 'null' ? null : j.t === 'num' ? Number(j.raw) : j.t === 'arr' ? j.items.map(plain) : j.t === 'obj' ? Object.fromEntries(j.entries.map(([k, v]) => [k, plain(v)])) : j.v);
/** The expected result with -0 as 0 (JSON has no difference). */
const norm = (x: unknown): unknown => (typeof x === 'number' ? x + 0 : Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, norm(v)])) : x);

const dir = join(import.meta.dirname, 'jmespath-compliance');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const suites = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { given: unknown; cases: { expression: string; result?: unknown; error?: string }[] }[];
  test(`JMESPath compliance: ${file}`, () => {
    assert.ok(suites.reduce((n, s) => n + s.cases.length, 0) > 0);
    for (const suite of suites) {
      const doc = parseJson(JSON.stringify(suite.given));
      for (const c of suite.cases) {
        if (c.error) assert.throws(() => jmesSearch(doc, c.expression, io), MbsError, `${c.expression} should be an error (${c.error})`);
        else assert.deepEqual(norm(plain(jmesSearch(doc, c.expression, io))), norm(c.result ?? null), c.expression);
      }
    }
  });
}

test('MBS JSON.Search: the example from the function page', () => {
  const doc = JSON.stringify({ locations: [{ name: 'Seattle', state: 'WA' }, { name: 'New York', state: 'NY' }, { name: 'Bellevue', state: 'WA' }, { name: 'Olympia', state: 'WA' }] });
  const out = MBS_JSON['json.search']([{ text: doc, number: false }, { text: "locations[?state == 'WA'].name | sort(@) | {WashingtonCities: join(', ', @)}", number: false }], {});
  assert.equal(compact(parseJson(String(out))), '{"WashingtonCities":"Bellevue, Olympia, Seattle"}');
  assert.equal(compact(parseJson(String(MBS_JSON['json.search']([{ text: doc, number: false }, { text: 'nothing', number: false }], {})))), 'null');
});

test('JMESPath: a search stops instead of running away', () => {
  const started = Date.now();
  // A value that holds itself twice, thirty times over: two to the thirtieth values written out.
  const doubling = Array(40).fill('{a: @, b: @}').join(' | ');
  assert.throws(() => MBS_JSON['json.search']([{ text: '[1,2,3]', number: false }, { text: doubling, number: false }], {}), MbsError);
  assert.throws(() => search('[1,2,3]', Array(40).fill('{a: @, b: @}').join(' | ') + ' | to_string(@)'), MbsError);
  // Quadratic work on a big list.
  const big = JSON.stringify(Array(20_000).fill(0));
  assert.throws(() => search(big, '[?contains(@, @)] | [*][?(@ == @)] | [] | map(&contains(`' + big + '`, @), @)'), MbsError);
  assert.throws(() => search('[1]', '('.repeat(5000) + '@' + ')'.repeat(5000)), MbsError);
  assert.throws(() => search('[1]', 'a.'.repeat(3000) + 'a'), MbsError);
  assert.ok(Date.now() - started < 15_000, 'each stops quickly');
});

test('JMESPath: names that exist on every object are not functions, and long text and wide objects cost what they weigh', () => {
  for (const name of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) assert.throws(() => search('[1]', `${name}(@)`), /unknown function/);
  const wide = JSON.stringify({ big: Object.fromEntries(Array.from({ length: 100_000 }, (_, k) => [`k${k}`, 1])) });
  const many = '[' + Array(40).fill('big').join(',') + '][*].zzz';
  assert.throws(() => search(wide, many), MbsError);
  const long = JSON.stringify({ s: 'x'.repeat(5_000_000) });
  assert.throws(() => search(long, "[s,s,s,s,s,s,s,s] | join(',', @)"), /too long/);
});

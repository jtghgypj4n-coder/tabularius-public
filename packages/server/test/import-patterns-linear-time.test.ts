// Cells, field types and phone numbers come from uploads and API requests. Patterns that may start anywhere and end at
// the end of the text are quadratic (or worse) on a long run they cannot finish: seconds on 50,000 characters, on the
// server's one thread. The scans that replaced them are quick and agree with the patterns on short inputs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitExtension, phoneDigits } from '../src/cleanup.ts';
import { phone } from '../src/import-mapping.ts';
import { sqlType } from '../src/odata-schema.ts';

function quick<T>(f: () => T, limitMs = 500): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < limitMs, `took ${Math.round(performance.now() - t)} ms`);
  return r;
}

const N = 50_000;

test('a field type with a long run of blanks is read in one pass', () => {
  assert.equal(quick(() => sqlType(`a${' '.repeat(2000)}1`)), undefined);
  assert.equal(quick(() => sqlType(`VARCHAR${' '.repeat(N)}(`)), undefined);
  assert.equal(quick(() => sqlType(`${'a '.repeat(N / 2)}x(`)), undefined);
  assert.deepEqual(sqlType(' varchar ( 100 ) '), { name: 'VARCHAR', length: '100' });
  assert.deepEqual(sqlType('double   precision'), { name: 'DOUBLE PRECISION', length: undefined });
});

test('a phone number with a long run of blanks or digits is tidied in one pass', () => {
  for (const text of [`5551234567${' '.repeat(N)}x`, `${' '.repeat(N)}5`, `5${' '.repeat(N)}ext`, `x${' '.repeat(N)}`, `ext${'1'.repeat(N)}x`, `${'x '.repeat(N / 2)}`]) {
    quick(() => phone(text));
    quick(() => phoneDigits(text));
  }
  assert.equal(phone('555 123 4567 ext. 89'), '(555) 123-4567 x89');
  assert.equal(phone('(555) 123-4567 # 5'), '(555) 123-4567 x5');
  assert.equal(phoneDigits('1 (555) 123-4567 x 12'), '5551234567');
});

/** The patterns as they were. */
const oldPhone = (v: string) => (/[\r\n]/.test(v.trim()) ? null : /^(.*?)(?:\s*(?:x|ext\.?|extension|#)\s*(\d+))?\s*$/i.exec(v.trim()));
const oldPhoneDigits = (s: string) => s.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '');
const oldType = (type: string) => /^\s*([a-z][a-z ]*?)\s*(?:\(\s*(\d+)\s*\))?\s*$/i.exec(type);

function* strings(alphabet: string[], max: number): Generator<string> {
  const walk = function* (prefix: string, left: number): Generator<string> {
    yield prefix;
    if (!left) return;
    for (const c of alphabet) yield* walk(prefix + c, left - 1);
  };
  yield* walk('', max);
}

test('the scans agree with the patterns they replaced', () => {
  let checked = 0;
  for (const s of strings(['1', 'x', 'X', 'e', 't', '.', '#', ' ', '\t', '\u2028', 'n', '+'], 5)) {
    const m = oldPhone(s);
    const trimmed = s.trim();
    const split = splitExtension(trimmed, true);
    const body = split ? split.text : trimmed;
    const expectedBody = m ? m[1] : undefined;
    const got = /[\r\n]/.test(trimmed) || /[\u2028\u2029]/.test(body) ? undefined : body;
    assert.equal(got, expectedBody, JSON.stringify(s));
    if (m) assert.equal(split ? split.digits : undefined, m[2], JSON.stringify(s));
    assert.equal(phoneDigits(s), oldPhoneDigits(s).replace(/\D/g, '').length === 11 && oldPhoneDigits(s).replace(/\D/g, '').startsWith('1') ? oldPhoneDigits(s).replace(/\D/g, '').slice(1) : oldPhoneDigits(s).replace(/\D/g, ''), JSON.stringify(s));
    checked++;
  }
  for (const long of ['extension', 'ext', 'x', 'Ext.', 'EXTENSION', 'xt', 'ex', 'next', 'extensions']) {
    for (const s of [`5551234567 ${long} 12`, `5551234567${long}12`, `${long}1`, ` ${long} `, `5${long}`, `${long}\t9 `]) {
      const m = oldPhone(s);
      const split = splitExtension(s.trim(), true);
      assert.equal(split ? split.text : s.trim(), m![1], JSON.stringify(s));
      assert.equal(phoneDigits(s), oldPhoneDigits(s).replace(/\D/g, '').length === 11 && oldPhoneDigits(s).replace(/\D/g, '').startsWith('1') ? oldPhoneDigits(s).replace(/\D/g, '').slice(1) : oldPhoneDigits(s).replace(/\D/g, ''), JSON.stringify(s));
      checked++;
    }
  }
  for (const s of strings(['a', 'B', ' ', '\t', '(', ')', '1', '2', '-'], 6)) {
    const m = oldType(s);
    const got = sqlType(s);
    assert.equal(got?.name, m?.[1].toUpperCase().replace(/\s+/g, ' '), JSON.stringify(s));
    assert.equal(got?.length, m?.[2], JSON.stringify(s));
    checked++;
  }
  assert.ok(checked > 100_000);
});

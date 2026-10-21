// What the assistant's panel shows of a tool call: arguments with secrets hidden, results cut to a line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceArgs, traceResult } from '../src/assistant-trace.ts';
import { HIDDEN_VALUE } from '../src/ai-output.ts';

test('a key that names a secret has its value hidden, however deep', () => {
  const out = traceArgs({ layout: 'Orders', password: 'hunter2', nested: { apiKey: 'abc', list: [{ token: 'x' }, 'fine'] }, empty: { secret: '' } }) as Record<string, any>;
  assert.equal(out.layout, 'Orders');
  assert.equal(out.password, HIDDEN_VALUE);
  assert.equal(out.nested.apiKey, HIDDEN_VALUE);
  assert.equal(out.nested.list[0].token, HIDDEN_VALUE);
  assert.equal(out.nested.list[1], 'fine');
  assert.equal(out.empty.secret, '', 'an empty secret has nothing to hide');
});

test('a key-looking value in an ordinary field is hidden, and long values, lists and depth are cut', () => {
  const key = 'sk' + '-ant-api03-' + 'a1'.repeat(24);
  const out = traceArgs({ note: `use ${key} please`, text: 'x'.repeat(1000), rows: Array.from({ length: 30 }, (_, i) => i), deep: { a: { b: { c: { d: { e: 1 } } } } } }) as Record<string, any>;
  assert.ok(!JSON.stringify(out).includes(key));
  assert.match(out.text, /… \(600 more characters\)$/);
  assert.equal(out.rows.length, 21);
  assert.equal(out.rows.at(-1), '… 10 more');
  assert.equal(out.deep.a.b.c.d, '…');
});

test('a result is one line with secrets hidden, and says how long it was', () => {
  const content = `Bearer abcdefghijklmnopqrstuvwxyz0123456789\n\nfound   3 records\n${'y'.repeat(500)}`;
  const r = traceResult(content);
  assert.ok(!r.result.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!r.result.includes('\n'));
  assert.match(r.result, /found 3 records/);
  assert.equal(r.resultLength, content.length);
  assert.ok(r.result.length < 400);
});

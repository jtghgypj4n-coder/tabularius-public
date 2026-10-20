import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { auditText, auditCsvField, auditJsonLine } from '../src/audit-output.ts';

const hostile = '\u001b[2J\r\nforged\t\0\u0085\u2028\u2029\u202ehidden\u2066name\u2069\ufeff';
const invisible = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

test('text and CSV expose controls, newlines, direction overrides and literal escapes without extra lines', () => {
  for (const value of [hostile, '\\u{202e}', 'ordinary 😀 日本語', 'x'.repeat(100_000), '\u202e'.repeat(100_000)]) {
    for (const output of [auditText(value), auditCsvField(value)]) {
      assert.equal(invisible.test(output), false);
      assert.ok(output.length < 4200);
    }
  }
  assert.match(auditText(hostile), /\\u\{202e\}/);
  assert.notEqual(auditText('\u202e'), auditText('\\u{202e}'));
  assert.match(auditText('x'.repeat(100_000)), /truncated; 100000 UTF-16 units/);
  assert.equal(auditText('ordinary 😀 日本語'), 'ordinary 😀 日本語');
});

test('CSV formula cells stay text after presentation escaping and quoting', () => {
  for (const prefix of ['=', '+', '-', '@', ' =', '\u00a0=']) {
    assert.ok(auditCsvField(prefix + 'SUM(1)').startsWith("'"));
  }
  for (const prefix of ['\t=', '\r=', '\0=', '\u202e=']) {
    assert.ok(auditCsvField(prefix + 'SUM(1)').startsWith('\\u{'));
  }
  assert.equal(auditCsvField('a,"b"\nnext'), '"a,""b""\\u{000a}next"');
});

test('JSONL preserves decoded values, escapes hidden formatting, and explicitly bounds oversized entries', () => {
  const entry = { seq: 12, account: hostile, changes: { [hostile]: hostile } };
  const line = auditJsonLine(entry);
  assert.equal(invisible.test(line), false);
  assert.deepEqual(JSON.parse(line), entry);
  const big = auditJsonLine({ seq: 13, ...{ changes: { ['k'.repeat(80_000)]: 'v' } } });
  assert.ok(big.length < 9000);
  assert.equal(JSON.parse(big).seq, 13);
  assert.equal(JSON.parse(big).truncated, true);
});

test('the actual admin helper matches the server for hostile names and messages', () => {
  const html = readFileSync(new URL('../../server/admin/index.html', import.meta.url), 'utf8');
  const helper = html.slice(html.indexOf('function auditText('), html.indexOf('// The audit log of one file:'));
  const browserText = vm.runInNewContext(`(${helper.trim()})`) as (v: unknown) => string;
  for (const input of [hostile, '<img src=x onerror=alert(1)>', '\\u{202e}', 'x'.repeat(100_000), '😀'.repeat(4000)]) {
    assert.equal(browserText(input), auditText(input));
  }
});

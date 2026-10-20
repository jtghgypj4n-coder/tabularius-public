// The check for a password written into a URL ran a regular expression that took time growing with the square of the text
// (a long run of letters, or a long token of colons without an "@"). It runs on script text and request bodies, so a large
// one held the process. It is a scan now, and says the same thing on every input the regular expression did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUrlAuth, redactCredentialStep } from '../src/redaction.ts';

const OLD = /[a-z][a-z\d+.-]*:\/\/[^\s/"<>]*:[^\s/"<>]*@/i;

test('hasUrlAuth agrees with the regular expression it replaces on every short string over the characters that matter', () => {
  const alphabet = ['a', 'A', '1', '+', '.', ':', '/', '@', ' ', '\t', '<', '"'];
  let checked = 0;
  const walk = (prefix: string, depth: number) => {
    assert.equal(hasUrlAuth(prefix), OLD.test(prefix), JSON.stringify(prefix));
    checked++;
    if (depth === 0) return;
    for (const c of alphabet) walk(prefix + c, depth - 1);
  };
  walk('', 5);
  for (const s of ['https://user:pw@host/x', 'ftp://a:b@c', 'http://host:8080/path@x', 'x://:@', '9://a:b@c', 'see https://u:p@h and more', 'A+B.C-1://u:p@h', 'no scheme ://u:p@h', 'http://u@h:80']) {
    assert.equal(hasUrlAuth(s), OLD.test(s), s);
  }
  assert.ok(checked > 200_000);
});

test('large inputs take a moment, not minutes', () => {
  const big = 200_000;
  for (const [name, s] of [
    // The first three took the regular expression 0.5 to 3 seconds at 20,000 characters, growing with the square of the length.
    ['a long run of letters', 'a'.repeat(big)],
    ['letters then ://', 'a'.repeat(big) + '://'],
    ['a long token of colons and no @', 'http://' + 'a:'.repeat(big)],
    // These two were already fast; they guard the scan against becoming slow.
    ['many schemes', 'a://'.repeat(big)],
    ['many colons in many tokens', 'a://:'.repeat(big)],
  ] as const) {
    const started = performance.now();
    assert.equal(hasUrlAuth(s), false, name);
    redactCredentialStep(s);
    assert.ok(performance.now() - started < 2000, `${name} took ${Math.round(performance.now() - started)} ms`);
  }
});

test('large inputs that do carry a password in a URL are still found', () => {
  const big = 200_000;
  for (const [name, s] of [
    ['a long run of letters before the scheme', 'a'.repeat(big) + '://u:p@h'],
    ['a long run of colons before the @', 'http://' + ':'.repeat(big) + '@h'],
    ['many schemes then a password', 'a://'.repeat(big) + 'u:p@h'],
  ] as const) {
    assert.equal(hasUrlAuth(s), true, name);
  }
});

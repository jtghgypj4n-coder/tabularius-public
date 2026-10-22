// Masking text for a shared report takes time in proportion to its length: a run of "@", of dots, of quote marks or
// of backslashes in a formula can't hold the server's one thread for seconds. The scans that replaced the patterns
// answer as the patterns did (over every short string of a set of characters that matter to them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskEmails, maskFormula, maskQuoted, maskSensitive, maskStepText } from '../src/credentials.ts';

const OLD_EMAIL = /[^\s"“”'<>()[\];,:]+@[^\s"“”'<>()[\];,:]+\.[A-Za-z]{2,}/g;
const OLD_QUOTED = /"(?:[^"\\]|\\.|"")*"/y;
const keep = (m: string) => (/^"(?:[^"\\]|[^\p{L}"\\]{0,3})"$/u.test(m) ? m : '"…"');

function* strings(alphabet: string[], max: number): Generator<string> {
  for (let len = 0; len <= max; len++) {
    const at = new Array<number>(len).fill(0);
    for (;;) {
      yield at.map((i) => alphabet[i]).join('');
      let k = 0;
      while (k < len && ++at[k] === alphabet.length) at[k++] = 0;
      if (k === len) break;
    }
  }
}

test('addresses are found as the pattern found them', () => {
  for (const s of strings(['a', 'B', '.', '@', '@', ' ', ',', 'c1', '(', '.c'], 6)) {
    assert.equal(maskEmails(s), s.replace(OLD_EMAIL, '‹email›'), JSON.stringify(s));
  }
});

/** What the old pattern does at each quote, and a quote it can't close hides the rest of the text. */
function quotedAsThePatternDid(text: string): string {
  let out = '';
  let at = 0;
  for (let q = text.indexOf('"', at); q >= 0; q = text.indexOf('"', at)) {
    OLD_QUOTED.lastIndex = q;
    const m = OLD_QUOTED.exec(text);
    out += text.slice(at, q);
    if (!m) return `${out}"…"`;
    out += keep(m[0]);
    at = q + m[0].length;
  }
  return out + text.slice(at);
}

test('quoted literals are masked as the pattern masked them, and a quote that is never closed hides the rest', () => {
  for (const s of strings(['"', '"', '\\', 'a', ' ', '\n', '-', 'é'], 7)) {
    assert.equal(maskQuoted(s), quotedAsThePatternDid(s), JSON.stringify(s));
  }
  assert.equal(maskQuoted('Set Variable [ $a ; "hunter2'), 'Set Variable [ $a ; "…"');
  assert.equal(maskQuoted('"ok" and "secret value'), '"…" and "…"');
});

test('a literal that crosses the cut is masked, not cut open', () => {
  const secret = 'hunter2-hunter2-hunter2';
  const text = `${'x'.repeat(199_990)} "${secret}" and more`;
  for (const mask of [maskStepText, maskFormula]) {
    const out = mask(text);
    assert.ok(!out.includes('hunter2'), mask.name);
    assert.ok(out.length <= 200_001, mask.name);
  }
  assert.ok(maskFormula(text).includes('"…"'));
});

test('text with a long run of one character is masked in a moment', () => {
  const runs: [string, string][] = [
    ['at signs in a comment', `/* ${'@'.repeat(3000)} */`],
    ['at signs', '@'.repeat(100_000)],
    ['a letter and an at sign', 'a@'.repeat(50_000)],
    ['dots', 'a.'.repeat(100_000)],
    ['dots and a web address', `${'a.'.repeat(50_000)}://u:x`],
    ['a password without an at sign', `a://u:${'x'.repeat(200_000)}`],
    ['escaped quotes, never closed', '"a\\'.repeat(50_000)],
    ['escaped quotes', `"${'\\"'.repeat(100_000)}`],
    ['quote pairs', `"${'""'.repeat(100_000)}`],
    ['quotes', '"'.repeat(100_000)],
  ];
  for (const [what, text] of runs) {
    for (const mask of [maskSensitive, maskFormula, maskStepText]) {
      const started = Date.now();
      mask(text);
      const took = Date.now() - started;
      assert.ok(took < 1000, `${mask.name} took ${took} ms for ${what}`);
    }
  }
});

test('masked text is cut at 200,000 characters, after masking', () => {
  const out = maskSensitive(`${'x'.repeat(250_000)} a@b.com`);
  assert.equal(out.length, 200_001);
  assert.ok(out.endsWith('…'));
  assert.equal(maskSensitive(`a@b.com ${'x'.repeat(250_000)}`).slice(0, 12), '‹email› xxxx');
  assert.equal(maskSensitive('write to a@b.com or https://x.test/p'), 'write to ‹email› or ‹url›');
});

test('a web address behind a very long scheme is masked, from the last 32 characters of the scheme', () => {
  assert.equal(maskSensitive('http://example.test/x'), '‹url›');
  assert.equal(maskSensitive(`${'x'.repeat(40)}://example.test/x`), `${'x'.repeat(8)}‹url›`);
  assert.equal(maskSensitive(`${'x'.repeat(40)}://user:pw@example.test/x`).includes('pw@'), false);
  // Whatever its characters: a run of digits is no reason to leave the address showing.
  assert.equal(maskSensitive(`x${'1'.repeat(40)}://example.test/x`).includes('example.test'), false);
  assert.equal(maskSensitive(`x${'1'.repeat(40)}://user:pw@example.test/x`).includes('pw@'), false);
});

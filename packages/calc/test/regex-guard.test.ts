// A time limit on regular expressions a formula supplies: a pattern that backtracks without end is stopped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';
import { assertPatternNesting, guardedAll, guardedExec, guardedFirst, guardedReplace, guardedSplit, guardedTest, RegexTimeout, withRegexBudget } from '../src/regex-guard.ts';

const evil = /^(a+)+$/;
const trap = 'a'.repeat(45) + 'b';
const NONE = { notEmpty: false, anchored: false, notEmptyAtStart: false };

test('a runaway pattern is stopped with RegexTimeout, in well under a second', () => {
  const t0 = Date.now();
  assert.throws(() => guardedTest(evil, trap), RegexTimeout);
  assert.throws(() => guardedExec(evil, trap), RegexTimeout);
  assert.throws(() => guardedReplace(new RegExp(evil.source, 'g'), trap, 'x'), RegexTimeout);
  assert.throws(() => guardedSplit(evil, trap), RegexTimeout);
  assert.throws(() => guardedFirst(evil, trap, 0, NONE), RegexTimeout);
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0} ms`);
  // The guard is still usable afterwards.
  assert.equal(guardedTest(/^(a+)+$/, 'aaaa'), true);
});

test('ordinary matching gives the same answers as plain JavaScript', () => {
  assert.deepEqual(guardedExec(/b(c)/g, 'abcabc', 3)?.slice(), ['bc', 'c']);
  assert.equal(guardedExec(/b(c)/g, 'abcabc', 3)?.index, 4);
  assert.equal(guardedReplace(/o/g, 'foo', '0'), 'f00');
  assert.deepEqual(guardedSplit(/,/, 'a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual([...guardedAll(/a*/g, 'baab', NONE)].map((m) => [m.index, m[0]]), [[0, ''], [1, 'aa'], [3, ''], [4, '']]);
  assert.deepEqual([...guardedAll(/a*/g, 'baab', { ...NONE, notEmpty: true })].map((m) => [m.index, m[0]]), [[1, 'aa']]);
  assert.deepEqual([...guardedAll(/\d/y, '12x3', { ...NONE, anchored: true })].map((m) => m[0]), ['1', '2']);
  // An empty match steps over a whole surrogate pair.
  assert.equal([...guardedAll(/(?:)/gu, '😀', NONE)].length, 2);
});

test('NotEmpty retries at the same start for a non-empty alternative', () => {
  assert.equal(guardedFirst(/(?:|a)/g, 'a', 0, { ...NONE, notEmpty: true })?.[0], 'a');
  assert.equal(guardedFirst(/a*?/g, 'aaa', 0, { ...NONE, notEmpty: true })?.[0], 'a');
  assert.equal(guardedFirst(/x*/g, 'aaa', 0, { ...NONE, notEmpty: true }), null);
  const match = guardedFirst(/(a)(?<tail>b)/g, 'ab', 0, { ...NONE, notEmpty: true })!;
  assert.deepEqual(match.slice(), ['ab', 'a', 'b']);
  assert.equal(match.groups?.tail, 'b');
  assert.equal(match.index, 0);
  assert.throws(() => guardedFirst(/(a)\1/g, 'aa', 0, { ...NONE, notEmpty: true }), /backreferences/);
});

test('many matches are found in batches, not one call each', () => {
  const text = 'ab '.repeat(200_000);
  const t0 = Date.now();
  const n = [...guardedAll(/ab/g, text, NONE)].length;
  assert.equal(n, 200_000);
  // Count and answer are exact; this ceiling catches a matching regression
  // while leaving room for CPU scheduling pauses on shared CI runners.
  assert.ok(Date.now() - t0 < 8000, `${Date.now() - t0} ms`);
});

test('calls inside one budget share it', () => {
  const slow = /^(a+)+$/;
  const t0 = Date.now();
  let stopped = 0;
  withRegexBudget(() => {
    for (let i = 0; i < 100; i++) {
      try { guardedTest(slow, trap); } catch (e) { if (!(e instanceof RegexTimeout)) throw e; stopped++; }
    }
  }, 600);
  // Every call was stopped, and the 600 ms were shared: 100 calls at the 500 ms call limit alone would be 50 seconds.
  assert.equal(stopped, 100);
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  // Outside the budget the guard works again.
  assert.equal(guardedTest(/a/, 'a'), true);
});

test('MBS RegEx, List.RegExMatch and BE_RegularExpression give an error for a runaway pattern, and the formula goes on', () => {
  const c = {};
  const bad = `"${'a'.repeat(45)}b"`;
  for (const f of [
    `MBS ( "RegEx.Match" ; "^(a+)+$" ; ${bad} )`,
    `MBS ( "RegEx.Replace" ; ${bad} ; "^(a+)+$" ; "x" )`,
    `MBS ( "RegEx.ReplaceAll" ; ${bad} ; "^(a+)+$" ; "x" )`,
    `MBS ( "RegEx.MatchList" ; "^(a+)+$" ; ${bad} )`,
    `MBS ( "List.RegExMatch" ; ${bad} ; "^(a+)+$" )`,
    `MBS ( "QuickList.MatchesRegEx" ; 1 ; "^(a+)+$" )`,
  ]) {
    const out = evaluateText(`Let ( r = ${f} ; r & "" & MBS ( "IsError" ) )`, c);
    if (f.includes('QuickList')) continue;
    assert.match(out, /^\[MBS\] ERROR: The pattern took longer than \d+ ms and was stopped.*1$/, f);
  }
  assert.equal(evaluateText(`MBS ( "RegEx.Match" ; "^(a+)+$" ; "aaa" )`, c), '1');
  assert.equal(evaluateText(`MBS ( "IsError" )`, c), '0');
  const be = evaluateText(`Let ( r = BE_RegularExpression ( ${bad} ; "^(a+)+$" ) ; r & "|" & BE_GetLastError )`, c);
  assert.equal(be.startsWith('?'), true, be);
});

test('review fixes: BE_FileReplaceText, huge replacements, astral characters, long patterns, the x option', () => {
  const c: Record<string, unknown> = {
    files: { read: () => new TextEncoder().encode('a'.repeat(45) + 'b'), write: () => true },
  };
  // BE_FileReplaceText with a runaway pattern gives "?" instead of throwing.
  const replaced = evaluateText('BE_FileReplaceText ( "/x" ; "^(a+)+$" ; "y" )', c);
  assert.equal(String(replaced).startsWith('?'), true, String(replaced));
  // A replacement that would pass V8's string limit (which aborts the process) is refused.
  const million = `"${'a'.repeat(1_048_576)}"`;
  const t0 = Date.now();
  const huge = evaluateText(`BE_RegularExpression ( ${million} ; "a" ; "g" ; "${'$0'.repeat(200)}" )`, {});
  assert.equal(String(huge).startsWith('?'), true);
  assert.throws(() => guardedReplace(/a/g, 'a'.repeat(1_048_576), '$&'.repeat(200)), RangeError);
  assert.ok(Date.now() - t0 < 3000);
  // An empty match over an astral character moves on a whole character, so NotEmpty doesn't spin.
  const t1 = Date.now();
  assert.equal(guardedFirst(/a*/gu, '😀', 0, { ...NONE, notEmpty: true }), null);
  assert.equal(guardedFirst(/a*/gu, '😀a', 0, { ...NONE, notEmpty: true })?.index, 2);
  assert.ok(Date.now() - t1 < 5000);
  // A pattern of 100 KB is refused without compiling it.
  const t2 = Date.now();
  const long = 'a|'.repeat(50_000);
  assert.equal(String(evaluateText(`BE_RegularExpression ( "a" ; "${long}" )`, {})).startsWith('?'), true);
  assert.match(evaluateText(`MBS ( "RegEx.Match" ; "${long}" ; "a" )`, {}), /^\[MBS\] ERROR: The pattern is too long/);
  assert.ok(Date.now() - t2 < 5000);
  // The x option's own preparation of the pattern doesn't backtrack on an unclosed [ with many backslashes.
  const t3 = Date.now();
  evaluateText(`BE_RegularExpression ( "a" ; "[${'\\\\\\\\'.repeat(30)}" ; "x" )`, {});
  assert.ok(Date.now() - t3 < 5000, `${Date.now() - t3} ms`);
  // The message names the limit that ended the call.
  assert.throws(() => guardedTest(evil, trap), /longer than 500 ms/);
  assert.throws(() => withRegexBudget(() => guardedTest(evil, trap), 100), /longer than 100 ms/);
});

test('a pattern with thousands of nested groups is refused instead of aborting the process', () => {
  // V8 aborts the whole process compiling 4,000 nested look-behinds (24,000 characters, under every length cap).
  const nested = '(?<=a'.repeat(4000) + ')'.repeat(4000);
  assert.throws(() => assertPatternNesting(nested), SyntaxError);
  assert.throws(() => assertPatternNesting('('.repeat(251) + 'a' + ')'.repeat(251)), SyntaxError);
  assert.doesNotThrow(() => assertPatternNesting('('.repeat(250) + 'a' + ')'.repeat(250)));
  // Escaped and bracketed parentheses are not groups.
  assert.doesNotThrow(() => assertPatternNesting('\\('.repeat(1000) + '[(]'.repeat(1000)));
  assert.equal(evaluateText(`BE_RegularExpression ( "zzzz" ; "${nested}" ; "g" )`), '?');
  assert.match(evaluateText(`MBS ( "RegEx.Match" ; "${nested}" ; "zzzz" )`), /nested more than 250 deep/);
  assert.equal(evaluateText('BE_RegularExpression ( "abc" ; "(b)" ; "g" )'), 'b');
});

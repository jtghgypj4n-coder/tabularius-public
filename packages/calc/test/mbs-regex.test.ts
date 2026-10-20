// MBS ( "RegEx.…" ) against the examples on MBS's own function pages (mbsplugins.eu), plus the PCRE syntax
// Tabularius translates and what it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';
import { MBS_REGEX, translate } from '../src/mbs-regex.ts';
import { MbsError } from '../src/mbs-text.ts';

/** A FileMaker text literal: quotes and backslashes escaped, a CR written as ¶. */
const q = (s: string) => '"' + s.replace(/[\\"¶]/g, (x) => '\\' + x).replace(/\r/g, '¶') + '"';
const call = (c: CalcContext, name: string, ...args: (string | number)[]) =>
  evaluateText(`MBS ( ${[q(name), ...args.map((a) => (typeof a === 'number' ? String(a) : q(a)))].join(' ; ')} )`, c);

test('MBS RegEx: Replace, ReplaceAll and Extract, as the pages show (lazy unless "greedy")', () => {
  const c: CalcContext = {};
  const m = (name: string, ...args: (string | number)[]) => call(c, name, ...args);
  assert.equal(m('RegEx.Replace', 'yabba dabba doo', 'b+', 'd'), 'yadba dabba doo');
  assert.equal(m('RegEx.ReplaceAll', 'yabba dabba doo', 'b+', 'd'), 'yadda dadda doo');
  assert.equal(m('RegEx.ReplaceAll', 'yabba dabba doo', 'b+', 'd', 'greedy'), 'yada dada doo');
  assert.equal(m('RegEx.Replace', 'Hello\rWorld\rTesting', '^World$', 'Welt', 'Multiline, NewlineAnyCRLF'), 'Hello\rWelt\rTesting');
  for (const [n, want] of [[0, 'Thom John John John'], [1, 'John Thom John John'], [2, 'John John Thom John'], [3, 'John John John Thom']] as const)
    assert.equal(m('RegEx.Replace', 'John John John John', 'john', 'Thom', 'caseless', 0, n), want);
  assert.equal(m('RegEx.Replace', 'a1 b2 c3', '(\\w)(\\d)', '\\2\\1', 'greedy', 1), '1a 2b 3c');
  assert.equal(
    m('RegEx.ReplaceAll', 'This is a link to the Monkeybread Software site: http://www.mbsplugins.eu/ where Filemaker solutions can be found.',
      '(https?://[\\w./]+)', '<a href="\\1">\\1</a>', 'caseless\rgreedy'),
    'This is a link to the Monkeybread Software site: <a href="http://www.mbsplugins.eu/">http://www.mbsplugins.eu/</a> where Filemaker solutions can be found.');
  assert.equal(m('RegEx.ReplaceAll', 'See https://mbsplugins.eu for more details', '(https?://[^ ]+)', '\\\\LK[false, TRUE, false, \\1]\\1\\\\EK', 'Greedy'),
    'See \\LK[false, TRUE, false, https://mbsplugins.eu]https://mbsplugins.eu\\EK for more details');
  assert.equal(m('RegEx.ReplaceAll', 'Ιωαννησ testσ testσ', '([\\p{Greek}\\p{Latin}]+)σ(\\W*)', '\\1ς\\2', 'greedy'), 'Ιωαννης testς testς');
  // Numeric options are PCRE's own bits, so 1 is caseless and greedy (the page's result is the whole number).
  assert.equal(m('RegEx.Extract', 'Call us at 01234/5678-90 to speak to sales.', '([0-9][0-9/\\-]+[0-9])', '\\1', 1), '01234/5678-90');
  assert.equal(m('RegEx.Extract', ' Hello World!', '\\s*(\\w*)\\s+(.*)', '\\2', 'caseless,greedy'), 'World!');
  assert.equal(m('RegEx.Extract', 'Rechnung Nr. 1234567 vom Mai 2020', '(Nr|Number|No|Nummer|Nombre|Numbre)([. :]*)(\\d+)', '\\3', 'caseless\rgreedy'), '1234567');
  assert.equal(m('RegEx.Extract', 'Test', '(.)(.)(.)(.)', '\\1\\2\\3\\4 -> \\4\\3\\2\\1'), 'Test -> tseT');
  assert.equal(m('RegEx.Extract', 'nothing here', '(\\d+)', '\\1'), '');
});

test('MBS RegEx: Match, MatchList and Quote', () => {
  const c: CalcContext = {};
  const m = (name: string, ...args: (string | number)[]) => call(c, name, ...args);
  assert.equal(m('RegEx.Match', 'H(.*)o', 'Hello'), '1');
  assert.equal(m('RegEx.Match', 'H(.*)o', 'hello'), '0');
  assert.equal(m('RegEx.Match', 'H(.*)o', 'hello', 'caseless'), '1');
  assert.equal(m('RegEx.Match', '^Hello$', 'Test\rHello\rWorld', 'MultiLine NewLineAny CaseLess', 'NewLineAny'), '1');
  assert.equal(m('RegEx.Match', '^Hello$', 'Test\rHello\rWorld'), '0');
  assert.equal(m('RegEx.Match', '^(\\d+)$', '12345'), '1');
  assert.equal(m('RegEx.MatchList', 'H(.*)o', 'Hello\rTest\rWorld\rHouse\rTest'), 'Hello\rHouse');
  assert.equal(m('RegEx.Quote', 'Hello? *test* 123'), 'Hello\\?\\ \\*test\\*\\ 123');
  assert.equal(m('RegEx.Quote', 'Test *'), 'Test\\ \\*');
  // What Quote gives matches the text exactly.
  assert.equal(evaluateText('MBS ( "RegEx.Match" ; MBS ( "RegEx.Quote" ; "1.5-2.0?" ) ; "a 1.5-2.0? b" )', c), '1');
  assert.equal(evaluateText('MBS ( "RegEx.Match" ; MBS ( "RegEx.Quote" ; "1.5-2.0?" ) ; "a 105-2.0 b" )', c), '0');
});

test('MBS RegEx: Compile, Execute, Substring, Results and Release keep the expression for the session', () => {
  const session = {};
  // Each step of a script has its own context object; the session is what they share.
  const step = (): CalcContext => ({ pluginSession: session });
  const ref = call(step(), 'RegEx.Compile', 'H(.*)o (.)or(..)', 'CaseLess');
  assert.equal(ref, '13000');
  assert.equal(call(step(), 'RegEx.Execute', 13000, 'Hello World Test', ''), '4');
  assert.equal(call(step(), 'RegEx.CaptureCount', 13000), '3');
  assert.equal(call(step(), 'RegEx.Substring', 13000, 0), 'Hello World');
  assert.equal(call(step(), 'RegEx.Substring', 13000, 1), 'ell');
  assert.equal(call(step(), 'RegEx.Substring', 13000, 3), 'ld');
  assert.equal(call(step(), 'RegEx.SubstringList', 13000), 'Hello World\rell\rW\rld');
  assert.equal(call(step(), 'RegEx.Results', 13000), '0\r11\r1\r4\r6\r7\r9\r11');
  assert.equal(call(step(), 'RegEx.Pattern', 13000), 'H(.*)o (.)or(..)');
  assert.equal(call(step(), 'RegEx.Options', 13000), '1');
  assert.equal(call(step(), 'RegEx.Study', 13000), 'OK');
  assert.equal(call(step(), 'RegEx.Compile', '\\d', 0), '13001');
  assert.equal(call(step(), 'RegEx.List'), '13000\r13001');
  assert.equal(call(step(), 'RegEx.Release', '13000\r13001'), 'OK');
  assert.equal(call(step(), 'RegEx.List'), '');
  assert.match(call(step(), 'RegEx.Substring', 13000, 0), /^\[MBS\] ERROR: Invalid RegEx reference/);
  // Another session doesn't see this one's expressions.
  call(step(), 'RegEx.Compile', 'x', 0);
  assert.match(call({ pluginSession: {} }, 'RegEx.Pattern', 13002), /^\[MBS\] ERROR/);
  assert.equal(call(step(), 'RegEx.ReleaseAll'), 'OK');
  assert.equal(call(step(), 'RegEx.List'), '');
});

test('MBS RegEx: named groups, offsets, FindMatches and no match', () => {
  const s: CalcContext = { pluginSession: {} };
  const ref = call(s, 'RegEx.Compile', 'H(?P<name>.*)o', 0);
  call(s, 'RegEx.Execute', Number(ref), 'Hello', 0);
  assert.equal(call(s, 'RegEx.NamedSubstring', Number(ref), 'name'), 'ell');
  assert.equal(call(s, 'RegEx.StringNumber', Number(ref), 'name'), '1');
  assert.equal(call(s, 'RegEx.NameCount', Number(ref)), '1');
  // The page's VAT-ID loop: Execute from an offset, then on from the end of the match (value 2 of Results).
  const vat = call(s, 'RegEx.Compile', '(USt\\-?ID:?|VAT\\-?ID:?)[\\s]?(DE)[\\s]?([0-9]{9})', 'caseless');
  const text = 'Our USt-ID: DE123456789, theirs VAT-ID DE987654321.';
  const found: string[] = [];
  for (let offset = 0; ; ) {
    if (Number(call(s, 'RegEx.Execute', Number(vat), text, 0, offset)) < 4) break;
    found.push(call(s, 'RegEx.Substring', Number(vat), 3));
    offset = Number(call(s, 'RegEx.Results', Number(vat)).split('\r')[1]);
  }
  assert.deepEqual(found, ['123456789', '987654321']);
  const code = call(s, 'RegEx.Compile', '<code>..(..)..</code>', 512 + 1);
  assert.equal(call(s, 'RegEx.FindMatches', Number(code), '<code>abcdef</code>\r<code>123456</code>', 0, 0), 'cd\r34\r');
  assert.equal(call(s, 'RegEx.FindMatches', Number(code), '<code>abcdef</code>', 0, 1, 1), '<code>abcdef</code>');
  const digits = call(s, 'RegEx.Compile', '(\\d+)\\D', 512 + 1);
  assert.equal(call(s, 'RegEx.FindMatches', Number(digits), 'aa 123 abc', 0, 0), '123\r');
  assert.equal(call(s, 'RegEx.Execute', Number(digits), 'no digits', 0), '0');
  assert.equal(call(s, 'RegEx.Substring', Number(digits), 1), '');
});

test('MBS RegEx: PCRE syntax is translated, and what JavaScript lacks is an MBS error', () => {
  const c: CalcContext = {};
  const m = (name: string, ...args: (string | number)[]) => call(c, name, ...args);
  // Escapes JavaScript's u mode refuses (\- \  \") are plain characters; \A \z \Q…\E \x{…} and POSIX classes work.
  assert.equal(m('RegEx.Match', 'a\\-b\\ c\\"', 'a-b c"'), '1');
  assert.equal(m('RegEx.Match', '\\Aab\\z', 'ab'), '1');
  assert.equal(m('RegEx.Match', '\\Aab\\z', 'abc'), '0');
  assert.equal(m('RegEx.Match', '\\Q1.5*\\E', 'x1.5*'), '1');
  assert.equal(m('RegEx.Match', '\\Q1.5*\\E', 'x105'), '0');
  assert.equal(m('RegEx.Match', '\\x{263A}', '☺'), '1');
  assert.equal(m('RegEx.Match', '^[[:digit:]]+$', '123'), '1');
  assert.equal(m('RegEx.Match', '(?i)hello', 'HELLO'), '1');
  assert.equal(m('RegEx.Match', 'a b # comment', 'ab', 'extended'), '1');
  assert.equal(m('RegEx.Match', 'a.b', 'a\rb'), '0');
  assert.equal(m('RegEx.Match', 'a.b', 'a\rb', 'dotall'), '1');
  assert.equal(m('RegEx.Match', '(?P<x>a)(?P=x)', 'aa'), '1');
  assert.equal(m('RegEx.Match', '^\\w+$', 'grüße'), '0');
  assert.equal(m('RegEx.Match', '^\\w+$', 'grüße', 'ucp'), '1');
  assert.equal(m('RegEx.ReplaceAll', 'a1b22', '\\d', '#', 'notempty'), 'a#b##');
  // Ungreedy flips laziness both ways.
  assert.equal(translate('a+b+?', 512).source, 'a+?b+');
  assert.equal(translate('a{2,}', 0).source, 'a{2,}');
  for (const [pattern, why] of [['(?>a)', /atomic group/], ['a++', /possessive/], ['(?R)', /Recursion/], ['(a', /can't be compiled/], ['[a', /Missing \]/]] as const) {
    assert.match(m('RegEx.Match', pattern, 'a'), /^\[MBS\] ERROR/, pattern);
    assert.equal(evaluateText('MBS ( "IsError" )', c), '1');
    assert.throws(() => translate(pattern, 0), why);
  }
  assert.match(m('RegEx.Match', 'a', 'a', 'partial'), /^\[MBS\] ERROR: The Partial option/);
  assert.match(m('RegEx.Match', 'a', 'a', 'sideways'), /^\[MBS\] ERROR: Unknown regular expression option "sideways"/);
});

test('MBS RegEx: one session can hold only so many open expressions', () => {
  const s: CalcContext = { pluginSession: {} };
  for (let i = 0; i < 1000; i++) call(s, 'RegEx.Compile', 'a', 0);
  assert.match(call(s, 'RegEx.Compile', 'a', 0), /Too many regular expressions/);
  call(s, 'RegEx.ReleaseAll');
  assert.match(call(s, 'RegEx.Compile', 'a', 0), /^\d+$/);
});

/** A RegEx function called directly, so the text can hold any character (a FileMaker literal turns \n into a return). */
const direct = (scope: object) => (name: string, ...args: (string | number)[]) => MBS_REGEX[name.toLowerCase()](args.map(String), scope);

test('MBS RegEx: PCRE classes mean what PCRE means (ASCII unless UCP, \\h, \\v, [:punct:], $ before a last newline)', () => {
  const r = direct({});
  const match = (pattern: string, text: string, opts: string | number = 0) => r('RegEx.Match', pattern, text, opts);
  // \v is vertical white space, not only the vertical tab.
  assert.equal(match('^\\v$', '\n'), 1);
  assert.equal(match('^[\\v]$', ' '), 1);
  assert.equal(match('^\\V$', '\n'), 0);
  // \h is every horizontal space.
  assert.equal(match('^\\h$', ' '), 1);
  assert.equal(match('^\\h$', '　'), 1);
  assert.equal(match('^\\H$', ' '), 0);
  // [:punct:] is ASCII punctuation, symbols such as $ + < included.
  for (const ch of ['$', '+', '<', '=', '>', '^', '`', '|', '~', '!']) assert.equal(match('^[[:punct:]]$', ch), 1, ch);
  // Without UCP, POSIX classes and \s are ASCII; with it, every script.
  assert.equal(match('^[[:alpha:]]$', 'é'), 0);
  assert.equal(match('^[[:alpha:]]$', 'é', 'UCP'), 1);
  assert.equal(match('^\\s$', ' '), 0);
  assert.equal(match('^\\S$', ' '), 1);
  assert.equal(match('^[\\S]$', ' '), 1);
  assert.equal(match('^[\\s\\S]$', ' '), 1);
  assert.equal(match('^\\s$', ' ', 'UCP'), 1);
  // $ matches before a newline that ends the text, unless DollarEndOnly.
  assert.equal(match('a$', 'a\n'), 1);
  assert.equal(match('a$', 'a\n', 'DollarEndOnly'), 0);
  assert.equal(match('a$', 'a\nb'), 0);
  // Extended mode skips ASCII white space only: a no-break space in the pattern is a character to match.
  assert.equal(match('a b', 'a b', 'extended'), 1);
  assert.equal(match('a b # comment', 'ab', 'extended'), 1);
});

test('MBS RegEx: classes with escapes inside, \\Q…\\E and what is refused', () => {
  const r = direct({});
  const match = (pattern: string, text: string, opts: string | number = 0) => r('RegEx.Match', pattern, text, opts);
  // \8 and \9 in a class are the digits; \400 is U+0100.
  assert.equal(match('^[\\8]$', '8'), 1);
  assert.equal(match('^[\\8]$', '\u0000'), 0);
  assert.equal(match('^[\\400]$', 'Ā'), 1);
  // A "-" after a set is a literal "-", not a range.
  assert.equal(match('^[\\w-z]+$', 'a-b', 'UCP'), 1);
  assert.equal(match('^[\\w-z]$', '`', 'UCP'), 0);
  assert.equal(match('^[[:blank:]-z]$', 'A'), 0);
  assert.equal(match('^[[:blank:]-z]$', '-'), 1);
  assert.equal(match('^[\\p{Any}]$', 'x'), 1);
  // \Q…\E quotes a "-" too.
  assert.equal(match('\\Qa-b\\E', 'xa-by'), 1);
  // What JavaScript would do differently is refused.
  assert.throws(() => match('^\\p{Lu}$', 'a', 'caseless'), MbsError);
  assert.throws(() => match('[:alpha:]', 'a'), /only inside \[ \]/);
});

test('MBS RegEx: execute options are honoured, or refused', () => {
  const r = direct({});
  assert.equal(r('RegEx.Match', 'b', 'abc', 0, 16), 0);
  assert.equal(r('RegEx.Match', 'a', 'abc', 0, 16), 1);
  assert.throws(() => r('RegEx.Match', '^a', 'abc', 0, 128), /NotBOL/);
  assert.throws(() => r('RegEx.Match', 'a', 'abc', 0, 'Partial'), /Partial/);
  const anchored = r('RegEx.Compile', 'a', 16);
  assert.equal(r('RegEx.FindMatches', anchored, 'aaab', 0, 1), 'a\ra\ra\r');
  const ref = r('RegEx.Compile', 'b');
  assert.equal(r('RegEx.Execute', ref, 'abc', 16), 0);
  assert.equal(r('RegEx.Execute', ref, 'abc', 16, 1), 1);
  // FindMatches takes its ExecuteOptions: NotEmpty drops the empty matches.
  const digits = r('RegEx.Compile', '\\d*');
  assert.equal(r('RegEx.FindMatches', digits, 'a1b', 1024, 1), '1\r');
  assert.equal(r('RegEx.FindMatches', digits, 'a1b', 0, 1), '\r1\r\r\r');
});

test('MBS RegEx: Execute keeps the captures, not the text searched', () => {
  const r = direct({});
  const ref = r('RegEx.Compile', '(?<word>w\\w+)');
  const text = 'x'.repeat(1000) + ' world ' + 'y'.repeat(1000);
  assert.equal(r('RegEx.Execute', ref, text), 2);
  assert.equal(r('RegEx.Substring', ref, 1), 'world');
  assert.equal(r('RegEx.NamedSubstring', ref, 'word'), 'world');
  assert.equal(r('RegEx.Results', ref), '1001\r1006\r1001\r1006');
  // Many matches are walked one at a time, so a long text with empty matches is fine.
  assert.equal(String(r('RegEx.ReplaceAll', 'x'.repeat(200_000), '', '-')).length, 400_001);
});

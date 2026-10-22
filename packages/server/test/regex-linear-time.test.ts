// Text a caller sends is read in time linear in its length: a long run of blanks must not make a pattern retry
// every way of splitting it. Each case uses a text that would take minutes (or years) with the pattern that was
// replaced, and a generous limit that a single scan meets by a wide margin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlFieldRefs } from '../src/ai-policy-sql.ts';
import { bracketScanner, parseScriptText } from '../src/script-check.ts';

const LIMIT_MS = 5000;
function quick<T>(f: () => T): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < LIMIT_MS, 'took too long: a pattern backtracks');
  return r;
}
const schema = { tables: [], tableOccurrences: [] } as never;

test('an AI policy SQL check on a long run of blanks followed by a symbol', () => {
  assert.equal(quick(() => sqlFieldRefs(schema, ' '.repeat(200_000) + '!')), undefined);
  assert.equal(quick(() => sqlFieldRefs(schema, ' \n-- note\n /* x */ '.repeat(20_000) + '!')), undefined);
});

test('an AI policy SQL check still finds the first word after blanks and comments', () => {
  const t = { id: 1, name: 'T', fields: [{ id: 1, name: 'A' }] };
  const s = { tables: [t], tableOccurrences: [] } as never;
  for (const sql of ['SELECT A FROM T', '  \n-- c\n/* c */ select A from T', '/* a */ -- b\nSELECT A FROM T']) {
    assert.ok(Array.isArray(sqlFieldRefs(s, sql)), sql);
  }
  for (const sql of ['DELETE FROM T', '', '   ', '-- only a comment']) {
    assert.equal(sqlFieldRefs(s, sql), undefined, sql);
  }
});

test('script text with a long run of blanks and no closing bracket is parsed in linear time', () => {
  const steps = quick(() => parseScriptText('A' + ' '.repeat(100_000) + 'x'));
  assert.equal(steps.length, 1);
  assert.equal(steps[0].name, 'A' + ' '.repeat(100_000) + 'x');
  quick(() => parseScriptText('A [' + ' '.repeat(100_000) + 'x'));
});

test('script step lines split into a name and parameters as before', () => {
  const one = (line: string) => parseScriptText(line)[0];
  assert.deepEqual([one('Go to Layout [ “Orders” ]').name, one('Go to Layout [ “Orders” ]').params], ['Go to Layout', ['“Orders”']]);
  assert.equal(one('Commit Records/Requests').name, 'Commit Records/Requests');
  assert.deepEqual(one('Set Variable [ $x ; Value: 1 ]  ').params, ['$x', 'Value: 1']);
  assert.equal(one('Perform Script [ a [b] ]').params[0], 'a [b]');
  assert.equal(one('Beep [').name, 'Beep [');
  assert.equal(one('[ odd ]').name, '[ odd ]');
});

test('a step that never closes its bracket, over many lines, is parsed in time linear in its text', () => {
  const lines = (n: number, line: string) => 'Set Variable [ $x ; Value: foo (' + ('\n' + line).repeat(n);
  const steps = quick(() => parseScriptText(lines(100_000, 'a')));
  assert.equal(steps.length, 1);
  quick(() => parseScriptText(lines(100_000, '// c')));
  quick(() => parseScriptText(lines(100_000, '"a\\')));
});

// The scanner, fed a line at a time, answers what a scan of the whole text so far answers (the function it replaced).
function wholeText(text: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote || (quote === '“' && c === '”')) quote = undefined;
      continue;
    }
    if (c === '"' || c === '“') quote = c;
    else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl >= 0) {
        i = nl;
        continue;
      }
      const close = text.lastIndexOf(']');
      if (close > i && !text.slice(close + 1).trim()) depth--;
      break;
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
  }
  return depth <= 0 && !quote;
}

test('the bracket scanner agrees with a scan of the whole text so far', () => {
  const pieces = ['(', ')', '[', ']', '"', '“', '”', '\\', '/', '//', ' // ', 'a', ' ', ';', '"x"'];
  let seed = 11;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let n = 0; n < 4000; n++) {
    const scan = bracketScanner();
    let text = '';
    for (let line = 0; line < 1 + (next() % 5); line++) {
      const part = (line ? '\n' : '') + Array.from({ length: next() % 7 }, () => pieces[next() % pieces.length]).join('');
      text += part;
      assert.equal(scan(part), wholeText(text), JSON.stringify(text));
    }
  }
});

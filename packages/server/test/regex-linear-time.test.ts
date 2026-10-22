// Text a caller sends is read in time linear in its length: a long run of blanks must not make a pattern retry
// every way of splitting it. Each case uses a text that would take minutes (or years) with the pattern that was
// replaced, and a generous limit that a single scan meets by a wide margin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlFieldRefs } from '../src/ai-policy-sql.ts';
import { parseScriptText } from '../src/script-check.ts';

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

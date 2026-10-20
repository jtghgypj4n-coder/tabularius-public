import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, evaluateText } from '../src/index.ts';
import { formatDate, formatTime, formatTimestamp } from '../src/values.ts';

type Case = { expression: string; expected: string; page: string };
const cases = JSON.parse(readFileSync(new URL('./data/date-time-functions.json', import.meta.url), 'utf8')) as Case[];

test('documented date and time expressions match the cited Claris examples and rules', () => {
  const ctx = { now: () => new Date(2026, 9, 17, 12, 0, 0) };
  for (const row of cases) assert.equal(evaluateText(row.expression, ctx), row.expected, `${row.expression} (${row.page})`);
});

test('conversion functions retain mixed date, time and timestamp types', () => {
  const date = evaluate('GetAsDate ( "2/29/2024" )');
  const time = evaluate('GetAsTime ( "25:01:01" )');
  const timestamp = evaluate('GetAsTimestamp ( "2/29/2024 25:01:01" )');
  assert.equal(date.type, 'date');
  assert.equal(time.type, 'time');
  assert.equal(timestamp.type, 'timestamp');
  assert.equal(formatDate(date.value), '2/29/2024');
  assert.equal(formatTime(time.value), '25:01:01');
  assert.equal(formatTimestamp(timestamp.value), '3/1/2024 1:01:01');
});

test('date and timestamp arithmetic uses day units and seconds within a day', () => {
  assert.equal(evaluateText('Date ( 3 ; 1 ; 2024 ) - Date ( 2 ; 28 ; 2024 )'), '2');
  assert.equal(evaluateText('Timestamp ( Date ( 2 ; 29 ; 2024 ) ; Time ( 25 ; 0 ; 0 ) ) - Timestamp ( Date ( 2 ; 29 ; 2024 ) ; Time ( 1 ; 0 ; 0 ) )'), '86400');
});

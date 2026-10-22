import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RefusedHostLog } from '../src/refused-host-log.ts';

test('refused host names: a flood of made-up names cannot use up the log, and the name that keeps coming is reported', () => {
  const lines: string[] = [];
  const log = new RefusedHostLog((line) => lines.push(line));
  const minute = 60_000;
  let now = 1_000_000;

  // A hostile client sends a new name every time: only the first 16 are logged one by one.
  for (let i = 0; i < 100; i++) log.note(`junk${i}.example`, now++);
  assert.equal(lines.length, 16);
  assert.ok(lines.every((l) => /was refused: this server was not told that name/.test(l)));
  // A real client with a name that was never configured comes next, many times: no line yet, the window's budget is spent.
  for (let i = 0; i < 7; i++) log.note('real.example', now++);
  assert.equal(lines.length, 16);
  assert.ok(!lines.some((l) => l.includes('real.example')));
  // A name already logged in this window is not logged again.
  log.note('junk0.example', now++);
  assert.equal(lines.length, 16);

  // When the window ends, the next refusal reports what was left out, most asked first, so the real name shows.
  now += 11 * minute;
  log.note('real.example', now++);
  assert.equal(lines.length, 18, lines.slice(16).join(' | '));
  assert.match(lines[16], /85 more host names were refused/);
  assert.match(lines[16], /real\.example \(7 times\)/);
  assert.match(lines[17], /real\.example was refused/, 'and in the new window the real name gets its own line');

  // Once per window per name, and the table of names stays small however many different names come.
  log.note('real.example', now++);
  assert.equal(lines.length, 18);
  for (let i = 0; i < 5000; i++) log.note(`more${i}.example`, now++);
  assert.ok(log.size <= 1000, String(log.size));
  assert.equal(lines.length, 18 + 15, 'the rest of the new window\'s budget, no more');
});

test('refused host names: a quiet server logs each name when it first comes and says nothing extra', () => {
  const lines: string[] = [];
  const log = new RefusedHostLog((line) => lines.push(line));
  log.note('a.example', 0);
  log.note('b.example', 1);
  log.note('a.example', 2);
  assert.equal(lines.length, 2);
  log.note('a.example', 20 * 60_000);
  assert.equal(lines.length, 3, 'a new window logs the name again, and no summary since nothing was left out');
});

test('refused host names: a name longer than any host name is counted, never written, so the log grows by a bounded amount', () => {
  const lines: string[] = [];
  const log = new RefusedHostLog((line) => lines.push(line));
  let now = 0;
  // A client sends a 5,000-character name each time, and some ordinary made-up names among them.
  for (let i = 0; i < 5000; i++) log.note(`${'a'.repeat(4990)}${String(i).padStart(10, '0')}`, now++);
  for (let i = 0; i < 100; i++) log.note(`junk${i}.example`, now++);
  assert.equal(lines.length, 16, 'only the ordinary names are logged one by one');
  assert.ok(lines.join('').length < 5000, `${lines.join('').length} bytes in the first window`);
  assert.ok(log.size <= 100, String(log.size));

  now += 11 * 60_000;
  log.note('real.example', now++);
  assert.equal(lines.length, 18);
  assert.match(lines[16], /5000 requests named a host longer than a host name can be/);
  assert.ok(lines[16].length < 1000, `${lines[16].length} bytes in the summary`);
  assert.ok(lines.join('').length < 8000, `${lines.join('').length} bytes in two windows`);

  // Only long names in a window: still one line, and no name in it.
  const quiet: string[] = [];
  const only = new RefusedHostLog((line) => quiet.push(line));
  for (let i = 0; i < 10; i++) only.note('b'.repeat(300) + i, 0);
  assert.equal(quiet.length, 0);
  only.note('c'.repeat(300), 20 * 60_000);
  assert.equal(quiet.length, 1);
  assert.match(quiet[0], /^10 requests named a host longer than a host name can be/);
  assert.ok(!quiet[0].includes('bbbb'));
});

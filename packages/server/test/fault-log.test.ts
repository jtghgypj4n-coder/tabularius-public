// A server fault is logged with its cause, but only so many per minute; the rest are counted and the count is said
// when the next minute begins, so one caller can't fill the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faultLog } from '../src/fault-log.ts';
import { SECRET_SEEDS } from '../../scripts/test/secret-seeds.ts';
import { REDACTED } from '../../scripts/src/redaction.ts';

for (const [name, secret] of SECRET_SEEDS) test(`faults retain frames and cause chains while masking ${name}`, () => {
  const lines: unknown[] = [];
  const cause = new Error(`upstream echoed ${secret}`, { cause: new Error('connection refused') });
  cause.stack = `Error: upstream echoed ${secret}\n    at read (packages/scripts/src/credentials.ts:12:3)`;
  const error = Object.assign(new Error(`invalid ${name}=${secret}`, { cause }), { privateValue: secret });
  error.stack = `Error: invalid ${name}=${secret}\n    at issue (packages/server/src/mcp-tokens.ts:41:5)\n    at check (file:///repo/packages/scripts/src/credentials.ts:8:2)`;
  faultLog((line) => lines.push(line))(error);
  const text = String(lines[0]);
  assert.ok(!text.includes(secret));
  assert.ok(text.includes(`Error: invalid ${name}=${REDACTED}`));
  assert.ok(text.includes('at issue (packages/server/src/mcp-tokens.ts:41:5)'));
  assert.ok(text.includes('at check (file:///repo/packages/scripts/src/credentials.ts:8:2)'));
  assert.ok(text.includes(`Caused by: Error: upstream echoed ${REDACTED}`));
  assert.ok(text.includes('at read (packages/scripts/src/credentials.ts:12:3)'));
  assert.ok(text.includes('Caused by: Error: connection refused'));
});

test('fault cause cycles terminate without losing the stack', () => {
  const error = new Error('cycle');
  error.cause = error;
  const lines: unknown[] = [];
  faultLog((line) => lines.push(line))(error);
  assert.equal(lines[0], `${error.stack}\nCaused by: [circular cause]`);
});

test('the first faults of a minute are logged whole, the rest are counted and the count is logged next minute', () => {
  const lines: unknown[] = [];
  let t = 10 * 60_000;
  const log = faultLog((x) => lines.push(x), () => t, 3);
  const causes = Array.from({ length: 10 }, (_, i) => new Error(`cause ${i}`));
  for (const e of causes) log(e);
  assert.deepEqual(lines, causes.slice(0, 3).map((e) => e.stack), 'only the first three, each with its own stack');
  t += 30_000;
  log(new Error('same minute'));
  assert.equal(lines.length, 3, 'still the same minute');
  t += 31_000;
  const next = new Error('next minute');
  log(next);
  assert.equal(lines.length, 5);
  assert.match(String(lines[3]), /^8 more faults in the minute before were not logged/);
  assert.equal(lines[4], next.stack);
});

test('a quiet minute logs nothing extra', () => {
  const lines: unknown[] = [];
  let t = 0;
  const log = faultLog((x) => lines.push(x), () => t, 2);
  log('a');
  t += 60_000;
  log('b');
  assert.deepEqual(lines, ['a', 'b']);
});

test('a capped minute flushes its dropped count at the boundary without another fault', () => {
  const lines: unknown[] = [];
  let t = 5 * 60_000;
  let timer: (() => void) | undefined;
  let unref = false;
  const log = faultLog((x) => lines.push(x), () => t, 1, (fn, delay) => {
    assert.equal(delay, 60_000);
    timer = fn;
    return { unref: () => { unref = true; } };
  });
  log(new Error('first'));
  log(new Error('dropped'));
  assert.equal(unref, true);
  t += 60_000;
  timer!();
  assert.equal(lines.length, 2);
  assert.match(String(lines[1]), /^1 more faults/);
});

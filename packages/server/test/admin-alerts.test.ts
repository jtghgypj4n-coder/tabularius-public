// The admin console reports an error in its own alert region (say()), not in the browser's alert box, which stops the
// page and is not announced the way a role=alert region is. A ratchet: the number of alert() calls left may fall, never rise,
// and none may carry an error message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, '..', 'admin', 'index.html'), 'utf8');
// What is left are confirmations of what was done, and the temporary passwords shown once (which must not vanish
// by themselves). Lower this when one moves to say().
const ALERTS_LEFT = 12;

test('no alert() carries an error message', () => {
  const bad = page.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /\balert\(/.test(line) && /\berr(or)?\.message\b/.test(line));
  assert.deepEqual(bad.map((b) => b.n), []);
});

test('the number of alert() calls does not rise', () => {
  const count = page.replace(/<[^>]*role="alert"[^>]*>/g, '').match(/(?<![\w.])alert\(/g)?.length ?? 0;
  assert.ok(count <= ALERTS_LEFT, `${count} alert() calls; the limit is ${ALERTS_LEFT}. Use say(message) for an error.`);
});

test('say() writes to a role=alert region that can be dismissed', () => {
  assert.match(page, /<div class="said" id="said" role="alert" hidden>/);
  assert.match(page, /function say\(message, \{ error = true \} = \{\}\)/);
  assert.match(page, /\$\('said-close'\)\.addEventListener\('click'/);
});

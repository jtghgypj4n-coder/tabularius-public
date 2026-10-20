// The sign-in screen's wording for error 212: a lockout reads differently from a plain wrong password.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInError212 } from '../src/sign-in-error.ts';

test('a lockout message is told apart from a plain wrong password, with the unlock time', () => {
  const until = new Date(Date.now() + 5 * 60_000).toISOString();
  const msg = signInError212(`Too many failed sign-ins; try again after ${until}`);
  assert.match(msg, /^Too many tries; wait until/);
  assert.ok(msg.includes(new Date(until).toLocaleTimeString()));
});

test('an ordinary wrong password keeps the generic message', () => {
  assert.equal(signInError212('Invalid user account and/or password; please try again'), 'The account name or password is wrong. Passwords are set with "tabularius passwd".');
});

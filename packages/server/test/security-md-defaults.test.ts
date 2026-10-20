import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKOUT } from '../../store/src/store.ts';

// SECURITY.md states the sign-in limits as numbers. When the limits change the sentence has to change with them.
const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', 'SECURITY.md'), 'utf8').replace(/\s+/g, ' ');

test('SECURITY.md states the lockout and address budget the store enforces', () => {
  const minutes = LOCKOUT.windowMs / 60_000;
  assert.equal(LOCKOUT.lockMs, LOCKOUT.windowMs, 'the document says the lockout lasts as long as the window');
  assert.ok(doc.includes(`${LOCKOUT.attempts} wrong passwords in ${minutes} minutes for one account`), 'per-account lockout sentence');
  assert.ok(doc.includes(`${LOCKOUT.addressAttempts} wrong passwords in ${minutes} minutes from one address`), 'per-address budget sentence');
  assert.ok(doc.includes(`for ${minutes} minutes`), 'lock length');
});

test('SECURITY.md states the default session cap', () => {
  assert.ok(doc.includes('at most 100 Data API sessions'), 'session cap sentence');
});

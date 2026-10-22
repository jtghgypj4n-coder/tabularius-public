// An AI caller may keep or raise the minimum password length, never lower it or switch it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Store } from '../../store/src/index.ts';
import { assertAiSecurityChanges } from '../src/ai-security.ts';

const fake = (min: number, own?: number) => ({ minPasswordLength: () => min, passwordPolicy: () => (own === undefined ? {} : { minLength: own }), privilegeSets: () => [] }) as unknown as Store;
const store = fake(20, 20);
const change = (policy: Record<string, unknown>) => () => assertAiSecurityChanges(store, [{ op: 'setPasswordPolicy', policy }]);

test('an AI tool cannot lower the minimum password length or turn it off', () => {
  assert.throws(change({ minLength: 0 }), /cannot lower the minimum password length \(now 20\)/);
  assert.throws(change({ minLength: 8 }), /cannot lower/);
  assert.throws(change({ minLength: 19 }), /cannot lower/);
});

test('an AI tool can keep or raise it, and change the expiry alone', () => {
  assert.doesNotThrow(change({ minLength: 20 }));
  assert.doesNotThrow(change({ minLength: 30, maxAgeDays: 90 }));
});

test('a policy that leaves minLength out cannot drop the file\'s own minimum, even one equal to the default', () => {
  const was = process.env.TABULARIUS_MIN_PASSWORD_LENGTH;
  process.env.TABULARIUS_MIN_PASSWORD_LENGTH = '12';
  try {
    for (const policy of [{ maxAgeDays: 90 }, {}, { minLength: null }]) {
      assert.throws(change(policy), /cannot drop the file's own minimum/);
      assert.throws(() => assertAiSecurityChanges(fake(12, 12), [{ op: 'setPasswordPolicy', policy }]), /cannot drop the file's own minimum/);
    }
  } finally {
    if (was === undefined) delete process.env.TABULARIUS_MIN_PASSWORD_LENGTH; else process.env.TABULARIUS_MIN_PASSWORD_LENGTH = was;
  }
});

test('a file with no minimum of its own is held to the default it falls back to', () => {
  const was = process.env.TABULARIUS_MIN_PASSWORD_LENGTH;
  try {
    process.env.TABULARIUS_MIN_PASSWORD_LENGTH = '12';
    assert.doesNotThrow(() => assertAiSecurityChanges(fake(12), [{ op: 'setPasswordPolicy', policy: { maxAgeDays: 90 } }]));
    assert.throws(() => assertAiSecurityChanges(fake(12), [{ op: 'setPasswordPolicy', policy: { minLength: 8 } }]), /cannot lower/);
    process.env.TABULARIUS_MIN_PASSWORD_LENGTH = '0';
    assert.throws(() => assertAiSecurityChanges(fake(12), [{ op: 'setPasswordPolicy', policy: { maxAgeDays: 90 } }]), /cannot lower/);
  } finally {
    if (was === undefined) delete process.env.TABULARIUS_MIN_PASSWORD_LENGTH; else process.env.TABULARIUS_MIN_PASSWORD_LENGTH = was;
  }
});

test('a policy that is not an object, or a minLength that is not a number, is refused', () => {
  for (const policy of ['x', [], null, 7]) assert.throws(() => assertAiSecurityChanges(store, [{ op: 'setPasswordPolicy', policy }]), /needs a policy object/);
  assert.throws(change({ minLength: '30' }), /whole number/);
});

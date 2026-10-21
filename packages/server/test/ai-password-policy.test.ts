// An AI caller may keep or raise the minimum password length, never lower it or switch it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Store } from '../../store/src/index.ts';
import { assertAiSecurityChanges } from '../src/ai-security.ts';

const store = { minPasswordLength: () => 12, privilegeSets: () => [] } as unknown as Store;
const change = (policy: Record<string, unknown>) => () => assertAiSecurityChanges(store, [{ op: 'setPasswordPolicy', policy }]);

test('an AI tool cannot lower the minimum password length or turn it off', () => {
  assert.throws(change({ minLength: 0 }), /cannot lower the minimum password length \(now 12\)/);
  assert.throws(change({ minLength: 8 }), /cannot lower/);
});

test('an AI tool can keep or raise it, and change the expiry alone', () => {
  assert.doesNotThrow(change({ minLength: 12 }));
  assert.doesNotThrow(change({ minLength: 20 }));
  assert.doesNotThrow(change({ maxAgeDays: 90 }));
});

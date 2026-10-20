import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Store } from '../../store/src/index.ts';
import { passwordLoginSecondFactor } from '../src/password-login-policy.ts';

interface Policy { global?: boolean; full?: boolean; required?: boolean; totp?: boolean; passkey?: boolean; otp?: string; valid?: boolean }
const cases: { name: string; policy: Policy; code?: number; message?: RegExp; audit?: boolean; verify?: boolean }[] = [
  { name: 'optional ordinary account', policy: {} },
  { name: 'optional full-access account', policy: { full: true } },
  { name: 'full-access-only rule spares a limited account', policy: { global: true } },
  { name: 'full-access-only rule does not force a limited account to use its passkey', policy: { global: true, passkey: true } },
  { name: 'unconfigured full-access account is refused', policy: { global: true, full: true }, code: 9, message: /file requires two-factor/, audit: true },
  { name: 'unconfigured required account is refused', policy: { required: true }, code: 9, message: /account requires two-factor/, audit: true },
  { name: 'full-access passkey is required by file policy', policy: { global: true, full: true, passkey: true }, code: 1212, message: /passkey/ },
  { name: 'limited account passkey is required by account policy', policy: { required: true, passkey: true }, code: 1212, message: /passkey/ },
  { name: 'optional passkey does not prevent password login', policy: { passkey: true } },
  { name: 'enrolled TOTP requires a code', policy: { totp: true }, code: 1211, message: /is required/ },
  { name: 'bad code is refused and audited', policy: { totp: true, otp: 'bad' }, code: 1211, message: /not valid/, audit: true, verify: true },
  { name: 'valid code permits an optional account', policy: { totp: true, otp: '123456', valid: true }, verify: true },
  { name: 'valid code satisfies the full-access rule', policy: { global: true, full: true, totp: true, otp: '123456', valid: true }, verify: true },
  { name: 'valid code satisfies the per-account rule', policy: { required: true, totp: true, otp: '123456', valid: true }, verify: true },
  { name: 'an optional passkey cannot bypass an enrolled TOTP requirement', policy: { totp: true, passkey: true }, code: 1211, message: /is required/ },
];
for (const entry of cases) test(entry.name, () => {
  const p = entry.policy, audits: unknown[][] = [], verifications: unknown[][] = [];
  const store = {
    requireTotpForFullAccess: () => !!p.global,
    privileges: () => ({ full: !!p.full }),
    accountRequires2fa: () => !!p.required,
    hasTotp: () => !!p.totp,
    hasPasskey: () => !!p.passkey,
    hasSecondFactor: () => !!p.totp || !!p.passkey,
    verifyTotp: (...args: unknown[]) => { verifications.push(args); return !!p.valid; },
    auditSignIn: (...args: unknown[]) => audits.push(args),
  } as unknown as Store;
  const result = passwordLoginSecondFactor(store, 'Ann', p.otp, '203.0.113.8');
  if (entry.code === undefined) assert.equal(result, undefined);
  else { assert.equal(result?.code, entry.code); assert.match(result!.message, entry.message!); }
  assert.deepEqual(audits, entry.audit ? [['Ann', '203.0.113.8', false, 'two-factor']] : []);
  assert.deepEqual(verifications, entry.verify ? [['Ann', p.otp, '203.0.113.8']] : []);
});

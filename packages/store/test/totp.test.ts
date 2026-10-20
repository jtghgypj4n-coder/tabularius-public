// Two-factor sign-in: TOTP secrets, confirmation, verification and replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, totpCode, checkTotp, LOCKOUT } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('totpCode matches a known RFC 6238 vector', () => {
  // RFC 6238 appendix B, SHA-1, the ASCII secret "12345678901234567890" in base32.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804');
});

test('enroll, confirm, verify and the replay guard', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-totp-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'), 'Charts');
  try {
    assert.equal(store.hasTotp('Admin'), false);
    const { secret, uri } = store.enrollTotp('Admin');
    assert.match(uri, /^otpauth:\/\/totp\/tabularius%3AAdmin\?/);
    assert.ok(uri.includes(`secret=${secret}`));

    // Not active until confirmed, and a wrong code won't confirm it.
    assert.equal(store.hasTotp('Admin'), false);
    assert.equal(store.confirmTotp('Admin', '000000'), false);
    assert.equal(store.confirmTotp('Admin', totpCode(secret)), true);
    assert.equal(store.hasTotp('Admin'), true);
    assert.deepEqual(store.totpAccounts(), ['Admin']);

    // A current code verifies once; the same code is refused again (replay).
    const code = totpCode(secret);
    assert.equal(store.verifyTotp('Admin', code), true);
    assert.equal(store.verifyTotp('Admin', code), false, 'a code cannot be used twice');
    assert.equal(store.verifyTotp('Admin', '000000'), false);

    // Disabling turns it off.
    assert.equal(store.disableTotp('Admin'), true);
    assert.equal(store.hasTotp('Admin'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('wrong one-time codes from a place are throttled like wrong passwords', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-totp-lock-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'), 'Charts');
  try {
    const { secret } = store.enrollTotp('Admin');
    store.confirmTotp('Admin', totpCode(secret));

    // Enough wrong codes from one place lock that place out.
    for (let i = 0; i < LOCKOUT.attempts; i++) assert.equal(store.verifyTotp('Admin', '000000', '10.0.0.9'), false);

    // Even the right code is now refused from that place (and the block comes
    // before the code is checked, so the code stays unused).
    const code = totpCode(secret);
    assert.equal(store.verifyTotp('Admin', code, '10.0.0.9'), false, 'blocked place is refused even with the right code');
    // Another place is unaffected, and that still-unused code works there.
    assert.equal(store.verifyTotp('Admin', code, '10.0.0.7'), true, 'another place still verifies');

    // Clearing the account's lockouts lets the first place back in.
    store.unlock('Admin');
    assert.equal(store.verifyTotp('Admin', totpCode(secret, Math.floor(Date.now() / 1000 / 30) + 1), '10.0.0.9'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a correct password step does not reset the second-factor attempt count', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-totp-sep-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'), 'Charts');
  try {
    store.setPassword('Admin', 'pw');
    const { secret } = store.enrollTotp('Admin');
    store.confirmTotp('Admin', totpCode(secret));

    // Interleave a correct password (which clears the password bucket) with wrong codes;
    // the code bucket must still reach the lockout, i.e. the two buckets are independent.
    for (let i = 0; i < LOCKOUT.attempts; i++) {
      assert.equal(store.verify('Admin', 'pw', '10.0.0.9'), true);
      store.verifyTotp('Admin', '000000', '10.0.0.9');
    }
    assert.equal(store.verifyTotp('Admin', totpCode(secret), '10.0.0.9'), false, 'the code bucket locked despite password successes');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('checkTotp accepts one step of drift but not two', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / 30);
  assert.ok(checkTotp(secret, totpCode(secret, step), now) !== undefined);
  assert.ok(checkTotp(secret, totpCode(secret, step - 1), now) !== undefined);
  assert.ok(checkTotp(secret, totpCode(secret, step + 1), now) !== undefined);
  assert.equal(checkTotp(secret, totpCode(secret, step + 2), now), undefined);
  assert.equal(checkTotp(secret, 'abc', now), undefined);
});

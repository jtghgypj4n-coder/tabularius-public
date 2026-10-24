// Recovery codes are kept salted and slow-hashed, compared in constant time, and used once. A code stored by an
// earlier version (an unsalted SHA-256) is still checked, once, by its old method.
import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, LOCKOUT, Store } from '../src/index.ts';

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rcv-'));
  const path = join(dir, 'Local.sqlite'); createStore(path);
  const store = new Store(path, 'Local');
  store.setPassword('Admin', 'generated-password-1', '[Full Access]');
  return { dir, store, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const stored = (store: Store) => (store.sql.prepare('SELECT code_hash, used FROM _fm_recovery_codes ORDER BY rowid').all() as { code_hash: string; used: string | null }[]);
const sha = (code: string) => createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

test('new recovery codes are stored salted and slow-hashed, not as a plain SHA-256', () => {
  const f = fresh();
  try {
    const codes = f.store.generateRecoveryCodes('Admin', 4);
    const rows = stored(f.store);
    assert.equal(rows.length, 4);
    for (const [i, row] of rows.entries()) {
      assert.match(row.code_hash, /^scrypt\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
      assert.ok(!rows.some((r) => r.code_hash === sha(codes[i])), 'no row is the plain SHA-256 of a code');
    }
    assert.equal(new Set(rows.map((r) => r.code_hash)).size, 4);
  } finally { f.close(); }
});

test('the same code value hashes differently each time it is stored', () => {
  const f = fresh();
  try {
    const original = crypto.randomBytes;
    // Fix the random bytes of the code itself (6 bytes) so two sets hold the same code values; salts stay random (16 bytes).
    const fake = mock.method(crypto, 'randomBytes', ((n: number) => (n === 6 ? Buffer.from('a1b2c3d4e5f6', 'hex') : original(n))) as typeof crypto.randomBytes);
    syncBuiltinESMExports();
    try {
      f.store.generateRecoveryCodes('Admin', 1);
      const first = stored(f.store)[0].code_hash;
      f.store.generateRecoveryCodes('Admin', 1);
      const second = stored(f.store)[0].code_hash;
      assert.notEqual(first, second);
    } finally { fake.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(f.store.useRecoveryCode('Admin', 'a1b2-c3d4-e5f6', '127.0.0.1'), true);
  } finally { f.close(); }
});

test('a good code works once, in any case or spacing, and a wrong code is refused', () => {
  const f = fresh();
  try {
    const codes = f.store.generateRecoveryCodes('Admin', 3);
    assert.equal(f.store.useRecoveryCode('Admin', 'zzzz-zzzz-zzzz', '127.0.0.1'), false);
    assert.equal(f.store.useRecoveryCode('Admin', '', '127.0.0.1'), false);
    assert.equal(f.store.useRecoveryCode('Admin', ` ${codes[0].toUpperCase().replaceAll('-', ' ')} `, '127.0.0.1'), true);
    assert.equal(f.store.useRecoveryCode('Admin', codes[0], '127.0.0.1'), false);
    assert.equal(f.store.recoveryCodesRemaining('Admin'), 2);
    assert.equal(f.store.useRecoveryCode('Nobody', codes[1], '127.0.0.1'), false, 'a code belongs to its account');
    assert.equal(f.store.useRecoveryCode('Admin', codes[1], '127.0.0.1'), true);
  } finally { f.close(); }
});

test('a code stored by an earlier version (an unsalted SHA-256) is accepted exactly once and nothing is rewritten', () => {
  const f = fresh();
  try {
    const old = 'a1b2-c3d4-e5f6', other = '0123-4567-89ab';
    const insert = f.store.sql.prepare('INSERT INTO _fm_recovery_codes (account, code_hash, created) VALUES (?, ?, ?)');
    insert.run('Admin', sha(old), '2025-01-01T00:00:00.000Z');
    insert.run('Admin', sha(other), '2025-01-01T00:00:00.000Z');
    const hashesBefore = stored(f.store).map((r) => r.code_hash);
    assert.equal(f.store.recoveryCodesRemaining('Admin'), 2);
    assert.equal(f.store.useRecoveryCode('Admin', 'ffff-ffff-ffff', '127.0.0.1'), false);
    assert.equal(f.store.useRecoveryCode('Admin', old, '127.0.0.1'), true);
    assert.equal(f.store.useRecoveryCode('Admin', old, '127.0.0.1'), false, 'used once');
    assert.equal(f.store.recoveryCodesRemaining('Admin'), 1);
    assert.deepEqual(stored(f.store).map((r) => r.code_hash), hashesBefore, 'the stored hashes are left as they were');
    assert.equal(f.store.useRecoveryCode('Admin', other, '127.0.0.1'), true);
  } finally { f.close(); }
});

test('old and new codes can sit side by side', () => {
  const f = fresh();
  try {
    f.store.sql.prepare('INSERT INTO _fm_recovery_codes (account, code_hash, created) VALUES (?, ?, ?)').run('Admin', sha('aaaa-bbbb-cccc'), '2025-01-01T00:00:00.000Z');
    const fresh1 = f.store.generateRecoveryCodes('Admin', 1)[0];
    assert.equal(f.store.recoveryCodesRemaining('Admin'), 1, 'generating a set replaces the old codes, as before');
    assert.equal(f.store.useRecoveryCode('Admin', 'aaaa-bbbb-cccc', '127.0.0.1'), false);
    assert.equal(f.store.useRecoveryCode('Admin', fresh1, '127.0.0.1'), true);
  } finally { f.close(); }
});

test('checking a code takes the same work for a real account, an account with few codes and a name that does not exist', () => {
  const f = fresh();
  const scrypts = mock.method(crypto, 'scryptSync', crypto.scryptSync);
  const equal = mock.method(crypto, 'timingSafeEqual', crypto.timingSafeEqual);
  syncBuiltinESMExports();
  try {
    f.store.generateRecoveryCodes('Admin', 10);
    const cost = (account: string) => {
      scrypts.mock.resetCalls();
      f.store.useRecoveryCode(account, 'zzzz-zzzz-zzzz', '127.0.0.1');
      return scrypts.mock.callCount();
    };
    const full = cost('Admin');
    assert.ok(full >= 10, 'a slow hash is computed for each stored code');
    for (let i = 0; i < 6; i++) f.store.sql.prepare('UPDATE _fm_recovery_codes SET used = ? WHERE rowid = (SELECT rowid FROM _fm_recovery_codes WHERE used IS NULL LIMIT 1)').run('2025-01-01');
    assert.equal(cost('Admin'), full, 'used-up codes do not make an account cheaper to probe');
    assert.equal(cost('Nobody'), full, 'a name with no codes costs the same');
    equal.mock.resetCalls();
    f.store.useRecoveryCode('Admin', 'zzzz-zzzz-zzzz', '127.0.0.1');
    assert.ok(equal.mock.callCount() >= 4, 'hashes are compared with timingSafeEqual');
  } finally { scrypts.mock.restore(); equal.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

test('the async check agrees with the sync one: one use, legacy codes accepted once, wrong code refused', async () => {
  const f = fresh();
  try {
    const [code] = f.store.generateRecoveryCodes('Admin', 2);
    assert.equal(await f.store.useRecoveryCodeAsync('Admin', 'zzzz-zzzz-zzzz', '127.0.0.1'), false);
    // The same code sent twice at once is spent once.
    const both = await Promise.all([f.store.useRecoveryCodeAsync('Admin', code, '127.0.0.1'), f.store.useRecoveryCodeAsync('Admin', code, '127.0.0.1')]);
    assert.deepEqual(both.slice().sort(), [false, true]);
    f.store.sql.prepare('INSERT INTO _fm_recovery_codes (account, code_hash, created) VALUES (?, ?, ?)').run('Admin', sha('aaaa-bbbb-cccc'), '2025-01-01T00:00:00.000Z');
    assert.equal(await f.store.useRecoveryCodeAsync('Admin', 'aaaa-bbbb-cccc', '127.0.0.1'), true);
    assert.equal(await f.store.useRecoveryCodeAsync('Admin', 'aaaa-bbbb-cccc', '127.0.0.1'), false);
  } finally { f.close(); }
});

/** Counts the scrypt jobs started (answering each at once), so a test sees how much hashing a burst was allowed to start. */
function countScrypts(t: TestContext) {
  const jobs = t.mock.method(crypto, 'scrypt', ((_p: unknown, _s: unknown, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    queueMicrotask(() => callback(null, Buffer.alloc(length)));
  }) as typeof crypto.scrypt);
  syncBuiltinESMExports();
  t.after(() => { jobs.mock.restore(); syncBuiltinESMExports(); });
  return jobs;
}

test('a burst of wrong codes sent at once cannot get past the account lockout', async (t) => {
  const f = fresh();
  const jobs = countScrypts(t);
  try {
    f.store.generateRecoveryCodes('Admin', 10);
    const from = '203.0.113.5';
    const burst = await Promise.all(Array.from({ length: LOCKOUT.attempts + 10 }, () => f.store.useRecoveryCodeAsync('Admin', 'zzzz-zzzz-zzzz', from)));
    assert.ok(burst.every((ok) => !ok));
    assert.ok(jobs.mock.callCount() <= LOCKOUT.attempts * 10, `${jobs.mock.callCount()} hash jobs for ${LOCKOUT.attempts} allowed attempts`);
    const after = jobs.mock.callCount();
    assert.equal(await f.store.useRecoveryCodeAsync('Admin', 'zzzz-zzzz-zzzz', from), false);
    assert.equal(jobs.mock.callCount(), after, 'a locked-out place is refused without hashing');
  } finally { f.close(); }
});

test('a burst of wrong codes for many names sent at once cannot get past the address lockout', async (t) => {
  const f = fresh();
  const jobs = countScrypts(t);
  try {
    const from = '203.0.113.6';
    await Promise.all(Array.from({ length: LOCKOUT.addressAttempts + 20 }, (_, i) => f.store.useRecoveryCodeAsync(`who${i}`, 'zzzz-zzzz-zzzz', from)));
    assert.ok(jobs.mock.callCount() <= LOCKOUT.addressAttempts * 10, `${jobs.mock.callCount()} hash jobs for ${LOCKOUT.addressAttempts} allowed attempts`);
  } finally { f.close(); }
});

test('a good code still signs in, and the reserved failure is cleared, when sent alone', async () => {
  const f = fresh();
  try {
    const codes = f.store.generateRecoveryCodes('Admin', 2);
    const from = '203.0.113.7';
    for (let i = 0; i < LOCKOUT.attempts - 1; i++) assert.equal(await f.store.useRecoveryCodeAsync('Admin', 'zzzz-zzzz-zzzz', from), false);
    assert.equal(await f.store.useRecoveryCodeAsync('Admin', codes[0], from), true);
    for (let i = 0; i < LOCKOUT.attempts - 1; i++) assert.equal(await f.store.useRecoveryCodeAsync('Admin', 'zzzz-zzzz-zzzz', from), false);
    assert.equal(await f.store.useRecoveryCodeAsync('Admin', codes[1], from), true, 'a success cleared the account counter');
  } finally { f.close(); }
});

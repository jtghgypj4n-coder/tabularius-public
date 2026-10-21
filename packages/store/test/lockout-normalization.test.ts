import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignInFailures, LOCKOUT, addressBucket } from '../src/sign-in-failures.ts';

const groups = [
  ['2001:db8:1:2::1', '2001:0db8:0001:0002::1', '2001:DB8:1:2:0:0:0:1', '2001:db8:1:2::1%eth0'],
  ['192.0.2.1', '::ffff:192.0.2.1', '::ffff:c000:201', '0:0:0:0:0:FFFF:C000:0201'],
];
for (const [i, spellings] of groups.entries()) {
  test(`AR-store-security-04: network ${i}`, () => {
    const failures = new SignInFailures();
    for (let n = 0; n < LOCKOUT.addressAttempts; n++) failures.countAddressFailure(spellings[0]);
    for (const from of spellings) {
      assert.equal(addressBucket(from), addressBucket(spellings[0]));
      assert.ok(failures.addressLockedOut(from));
    }
  });
  test(`AR-store-security-04: account ${i}`, () => {
    const failures = new SignInFailures();
    for (let n = 0; n < LOCKOUT.attempts; n++) failures.record(failures.accountKey('Member', spellings[0], 'File'), spellings[0], false);
    for (const from of spellings) assert.ok(failures.lockedOut(failures.accountKey('Member', from, 'File'), from));
    assert.equal(failures.lockedOut(failures.accountKey('Other', spellings[0], 'File'), spellings[0]), undefined);
  });
}

test('AR-store-security-04: hosts in one network share one key', () => {
  const failures = new SignInFailures();
  assert.equal(failures.accountKey('Member', '2001:db8:1:2::1'), failures.accountKey('Member', '2001:db8:1:2::2'));
  assert.equal(addressBucket('2001:db8:1:2::1'), addressBucket('2001:db8:1:2::2'));
});

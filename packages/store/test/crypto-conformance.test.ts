import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { checkPassword, checkPasswordAsync, hashPassword } from '../src/store.ts';
import { base32Encode, checkTotp, generateTotpSecret, totpCode } from '../src/totp.ts';

test('password verifier rejects empty, shortened, noncanonical and extra hash fields', async () => {
  const good = hashPassword('generated password');
  const [, salt, digest] = good.split('$');
  assert.equal(checkPassword('generated password', good), true);
  assert.equal(await checkPasswordAsync('generated password', good), true);
  assert.equal(checkPassword('wrong', good), false);
  assert.equal(await checkPasswordAsync('wrong', good), false);
  assert.equal(digest, scryptSync('generated password', Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 }).toString('base64'));
  for (const bad of [`scrypt$${salt}$!`, `scrypt$${salt}$${Buffer.from(digest, 'base64').subarray(0, 1).toString('base64')}`, `${good}$extra`, good + '!', `scrypt$!$${digest}`, good.replace(salt, salt.slice(0, -2))]) {
    assert.equal(checkPassword('generated password', bad), false, bad);
    assert.equal(await checkPasswordAsync('generated password', bad), false, bad);
  }
});

test('RFC 6238 Appendix B: all SHA1 times, reduced to the supported six digits', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  for (const [seconds, eightDigits] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) {
    assert.equal(totpCode(secret, Math.floor(seconds / 30)), eightDigits.slice(-6));
    assert.equal(checkTotp(secret, eightDigits.slice(-6), seconds * 1000), Math.floor(seconds / 30));
  }
  assert.match(generateTotpSecret(), /^[A-Z2-7]{32}$/);
  for (const code of ['abcdef', '12345', '1234567', '１２３４５６', '12345!']) assert.equal(checkTotp(secret, code), undefined);
  assert.throws(() => totpCode('invalid!'));
});

test('TOTP drift window follows explicit forward and backward time changes', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const step = 123456;
  const code = totpCode(secret, step);
  for (const offset of [-1, 0, 1]) assert.equal(checkTotp(secret, code, (step + offset) * 30000), step);
  for (const offset of [-3, 3]) assert.equal(checkTotp(secret, code, (step + offset) * 30000), undefined);
});

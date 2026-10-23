import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positiveWholeNumber, encryptionKeyFromEnv } from '../src/setting-values.ts';

test('positive whole settings accept decimal digits and reject ambiguous or unsafe numbers', () => {
  assert.equal(positiveWholeNumber('limit', undefined, 32), 32);
  for (const value of ['1', '512', '0012', '9007199254740991']) {
    assert.equal(positiveWholeNumber('limit', value, 32), Number(value));
  }
  for (const value of ['', ' ', ' 12 ', '1e9', '0x10', '0b10', '1.5', '-1', '+1', 'abc', 'NaN', 'Infinity', '0', '9007199254740992']) {
    assert.throws(() => positiveWholeNumber('limit', value, 32), /limit must be a positive whole number.*decimal digits/);
  }
  assert.equal(positiveWholeNumber('port', '0', 80, { min: 0, max: 65535 }), 0);
  assert.throws(() => positiveWholeNumber('port', '65536', 80, { min: 0, max: 65535 }), /port.*65535/);
  assert.throws(() => positiveWholeNumber('requests', '3', 32, { min: 4 }), /requests.*4/);
});

test('encryption key validation preserves passphrases exactly and only unset disables encryption', () => {
  assert.equal(encryptionKeyFromEnv({}), undefined);
  assert.equal(encryptionKeyFromEnv({ TABULARIUS_ENCRYPTION_KEY: '  synthetic passphrase  ' }), '  synthetic passphrase  ');
  for (const value of ['', ' ', '\t\n']) {
    assert.throws(() => encryptionKeyFromEnv({ TABULARIUS_ENCRYPTION_KEY: value }), /^Error: TABULARIUS_ENCRYPTION_KEY.*unset.*passphrase$/);
  }
});

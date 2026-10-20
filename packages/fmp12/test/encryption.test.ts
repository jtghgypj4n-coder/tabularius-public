import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { FmpDatabase, FmpError, encryptionInfo } from '../src/index.ts';

const BLOCK = 4096, BODY = 4064, SALT_OFF = 0xfa;

/** Make an Encryption-at-Rest copy of a plaintext fmp12 buffer, the inverse of the reader's decrypt. */
function encrypt(plain: Uint8Array, passphrase: string, hint: string): Uint8Array {
  const salt = Buffer.alloc(16, 7);
  const key = pbkdf2Sync(Buffer.from(passphrase, 'utf16le'), salt, 18000, 32, 'sha1');
  const out = Buffer.from(plain);
  out.set(Buffer.from('HBAMe', 'ascii'), 15);
  out.set(Buffer.from(hint, 'utf16le'), 20); // hint after the magic, before the salt
  out.set(salt, SALT_OFF);
  for (let base = BLOCK; base + BLOCK <= out.length; base += BLOCK) {
    const iv = Buffer.alloc(16);
    iv.writeUInt32LE(base / BLOCK, 0);
    const c = createCipheriv('aes-256-cbc', key, iv);
    c.setAutoPadding(false);
    const body = Buffer.concat([c.update(out.subarray(base, base + BODY)), c.final()]);
    out.set(body, base);
    out.set(iv, base + BODY);
  }
  return out;
}

const flicks = join(import.meta.dirname, '../../../fixtures/fmp12/Flicks.fmp12');

test('an Encryption at Rest file opens with its passphrase and reads the same schema', { skip: existsSync(flicks) ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const path = flicks;
  const plain = readFileSync(path);
  const want = FmpDatabase.open(path).schema.tables.map((t) => t.name);

  const enc = encrypt(plain, 'Tabularius!', 'the record keeper');
  assert.deepEqual(encryptionInfo(enc), { encrypted: true, hint: 'the record keeper' });
  assert.deepEqual(encryptionInfo(plain), { encrypted: false });

  const db = new FmpDatabase(enc, 'Tabularius!');
  assert.deepEqual(db.schema.tables.map((t) => t.name), want);

  assert.throws(() => new FmpDatabase(enc), /passphrase is needed/);
  assert.throws(() => new FmpDatabase(enc, 'wrong'), /wrong passphrase/);
});

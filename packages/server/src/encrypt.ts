// Encrypted backup files: AES-256-GCM with a key derived from a passphrase.
//
// A file is a header (magic, scrypt salt, nonce prefix) and then chunks of up
// to 1 MiB, each: 4-byte plaintext length, ciphertext, 16-byte tag. A chunk's
// nonce is the prefix and its number, and the last chunk is marked in its
// authenticated data, so chunks can't be reordered, dropped or cut off.
// Streams, so multi-gigabyte files never sit in memory.

import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, openSync, readSync, writeSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';

const MAGIC = Buffer.from('OPENHBAM-ENC1\n');
const CHUNK = 1 << 20;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 };

/** Files encrypted with encryptFile end with this. */
export const ENCRYPTED_EXT = '.enc';

export function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((ok, fail) => scrypt(passphrase, salt, 32, SCRYPT, (e, key) => (e ? fail(e) : ok(key))));
}

export function deriveKeySync(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT);
}

function nonce(prefix: Buffer, n: number): Buffer {
  const iv = Buffer.alloc(12);
  prefix.copy(iv, 0);
  iv.writeUInt32BE(n, 8);
  return iv;
}

function sealChunk(key: Buffer, prefix: Buffer, n: number, data: Buffer, last: boolean): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce(prefix, n));
  cipher.setAAD(Buffer.from([last ? 1 : 0]));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

/** Writes `src` encrypted to `dest`, without giving way to other work: for small files. */
export function encryptFileSync(src: string, dest: string, passphrase: string, read: typeof readSync = readSync): void {
  const salt = randomBytes(16);
  const prefix = randomBytes(8);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const input = openSync(src, 'r');
  const output = openSync(dest, 'w');
  try {
    writeSync(output, Buffer.concat([MAGIC, salt, prefix]));
    const size = fstatSync(input).size;
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    for (let n = 0; ; n++) {
      const got = read(input, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (got === 0 && pos < size) throw new Error(`${src} changed while being encrypted`);
      pos += got;
      writeSync(output, sealChunk(key, prefix, n, buf.subarray(0, got), pos >= size));
      if (pos >= size) break;
    }
    fsyncSync(output);
  } finally {
    closeSync(input);
    closeSync(output);
  }
}

/** Writes `src` encrypted to `dest`. */
export async function encryptFile(src: string, dest: string, passphrase: string,
  read: (input: FileHandle, buffer: Buffer, length: number, position: number) => Promise<number> =
    async (input, buffer, length, position) => (await input.read(buffer, 0, length, position)).bytesRead,
): Promise<void> {
  const salt = randomBytes(16);
  const prefix = randomBytes(8);
  const key = await deriveKey(passphrase, salt);
  const input = await open(src, 'r');
  const output = await open(dest, 'w');
  try {
    await output.write(Buffer.concat([MAGIC, salt, prefix]));
    const size = (await input.stat()).size;
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    for (let n = 0; ; n++) {
      const bytesRead = await read(input, buf, Math.min(CHUNK, size - pos), pos);
      if (bytesRead === 0 && pos < size) throw new Error(`${src} changed while being encrypted`);
      pos += bytesRead;
      const last = pos >= size;
      await output.write(sealChunk(key, prefix, n, buf.subarray(0, bytesRead), last));
      if (last) break;
    }
    await output.sync();
  } finally {
    await input.close();
    await output.close();
  }
}

/** Writes the decrypted `src` to `dest`, without giving way to other work: for small files. */
export function decryptFileSync(src: string, dest: string, passphrase: string): void {
  const input = openSync(src, 'r');
  const output = openSync(dest, 'w');
  try {
    const head = Buffer.alloc(MAGIC.length + 24);
    const got = readSync(input, head, 0, head.length, 0);
    if (got < head.length || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${src} is not a Tabularius encrypted file`);
    const key = scryptSync(passphrase, head.subarray(MAGIC.length, MAGIC.length + 16), 32, SCRYPT);
    const prefix = head.subarray(MAGIC.length + 16);
    const size = fstatSync(input).size;
    let pos = head.length;
    for (let n = 0; ; n++) {
      const len = Buffer.alloc(4);
      if (readSync(input, len, 0, 4, pos) < 4) throw new Error(`${src} is cut off`);
      const length = len.readUInt32BE();
      if (length > CHUNK) throw new Error(`${src} is damaged`);
      const body = Buffer.alloc(length + 16);
      if (readSync(input, body, 0, body.length, pos + 4) < body.length) throw new Error(`${src} is cut off`);
      pos += 4 + body.length;
      const last = pos >= size;
      const decipher = createDecipheriv('aes-256-gcm', key, nonce(prefix, n));
      decipher.setAAD(Buffer.from([last ? 1 : 0]));
      decipher.setAuthTag(body.subarray(length));
      let plain: Buffer;
      try {
        plain = Buffer.concat([decipher.update(body.subarray(0, length)), decipher.final()]);
      } catch {
        throw new Error(n === 0 ? `can't decrypt ${src}: wrong key, or the file is damaged` : `${src} is damaged`);
      }
      writeSync(output, plain);
      if (last) break;
    }
    fsyncSync(output);
  } finally {
    closeSync(input);
    closeSync(output);
  }
}

/** Writes the decrypted `src` to `dest`; throws on a wrong passphrase or a damaged file. */
export async function decryptFile(src: string, dest: string, passphrase: string): Promise<void> {
  const input = await open(src, 'r');
  const output = await open(dest, 'w');
  try {
    const head = Buffer.alloc(MAGIC.length + 24);
    const got = (await input.read(head, 0, head.length, 0)).bytesRead;
    if (got < head.length || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${src} is not a Tabularius encrypted backup`);
    const key = await deriveKey(passphrase, head.subarray(MAGIC.length, MAGIC.length + 16));
    const prefix = head.subarray(MAGIC.length + 16);
    const size = (await input.stat()).size;
    let pos = head.length;
    for (let n = 0; ; n++) {
      const len = Buffer.alloc(4);
      if ((await input.read(len, 0, 4, pos)).bytesRead < 4) throw new Error(`${src} is cut off`);
      const length = len.readUInt32BE();
      if (length > CHUNK) throw new Error(`${src} is damaged`);
      const body = Buffer.alloc(length + 16);
      if ((await input.read(body, 0, body.length, pos + 4)).bytesRead < body.length) throw new Error(`${src} is cut off`);
      pos += 4 + body.length;
      const last = pos >= size;
      const decipher = createDecipheriv('aes-256-gcm', key, nonce(prefix, n));
      decipher.setAAD(Buffer.from([last ? 1 : 0]));
      decipher.setAuthTag(body.subarray(length));
      let plain: Buffer;
      try {
        plain = Buffer.concat([decipher.update(body.subarray(0, length)), decipher.final()]);
      } catch {
        throw new Error(n === 0 ? `can't decrypt ${src}: wrong passphrase, or the file is damaged` : `${src} is damaged`);
      }
      await output.write(plain);
      if (last) break;
    }
    await output.sync();
  } finally {
    await input.close();
    await output.close();
  }
}

// Single records (the logs of point-in-time backups, appended one at a time):
// each sealed on its own, numbered by its place in the file.

/** Encrypts one record: ciphertext then the 16-byte tag. */
export function sealRecord(key: Buffer, prefix: Buffer, n: number, data: Buffer, aad?: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce(prefix, n));
  if (aad) cipher.setAAD(aad);
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

/** Decrypts one record; throws on a wrong key or a damaged record. */
export function openRecord(key: Buffer, prefix: Buffer, n: number, sealed: Buffer, aad?: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce(prefix, n));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
}

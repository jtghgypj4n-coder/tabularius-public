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

function writeAllSync(output: number, data: Buffer, path: string): void {
  for (let offset = 0; offset < data.length;) {
    const written = writeSync(output, data, offset, data.length - offset);
    if (written <= 0) throw new Error(`${path}: write made no progress`);
    offset += written;
  }
}

async function writeAll(output: FileHandle, data: Buffer, path: string): Promise<void> {
  for (let offset = 0; offset < data.length;) {
    const { bytesWritten } = await output.write(data, offset, data.length - offset);
    if (bytesWritten <= 0) throw new Error(`${path}: write made no progress`);
    offset += bytesWritten;
  }
}

/** Writes `src` encrypted to `dest`, without giving way to other work: for small files. */
export function encryptFileSync(src: string, dest: string, passphrase: string, read: typeof readSync = readSync): void {
  const salt = randomBytes(16);
  const prefix = randomBytes(8);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const input = openSync(src, 'r');
  let output: number | undefined;
  try {
    output = openSync(dest, 'w');
    writeAllSync(output, Buffer.concat([MAGIC, salt, prefix]), dest);
    const size = fstatSync(input).size;
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    for (let n = 0; ; n++) {
      const got = read(input, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (got === 0 && pos < size) throw new Error(`${src} changed while being encrypted`);
      pos += got;
      writeAllSync(output, sealChunk(key, prefix, n, buf.subarray(0, got), pos >= size), dest);
      if (pos >= size) break;
    }
    fsyncSync(output);
  } finally {
    try { closeSync(input); } finally { if (output !== undefined) closeSync(output); }
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
  let output: FileHandle | undefined;
  try {
    output = await open(dest, 'w');
    await writeAll(output, Buffer.concat([MAGIC, salt, prefix]), dest);
    const size = (await input.stat()).size;
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    for (let n = 0; ; n++) {
      const bytesRead = await read(input, buf, Math.min(CHUNK, size - pos), pos);
      if (bytesRead === 0 && pos < size) throw new Error(`${src} changed while being encrypted`);
      pos += bytesRead;
      const last = pos >= size;
      await writeAll(output, sealChunk(key, prefix, n, buf.subarray(0, bytesRead), last), dest);
      if (last) break;
    }
    await output.sync();
  } finally {
    try { await input.close(); } finally { await output?.close(); }
  }
}

/** Writes the decrypted `src` to `dest`, without giving way to other work: for small files. */
export function decryptFileSync(src: string, dest: string, passphrase: string): void {
  const input = openSync(src, 'r');
  let output: number | undefined;
  try {
    output = openSync(dest, 'w', 0o600); // plaintext: private to this account, whatever the umask
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
      writeAllSync(output, plain, dest);
      if (last) break;
    }
    fsyncSync(output);
  } finally {
    try { closeSync(input); } finally { if (output !== undefined) closeSync(output); }
  }
}

/**
 * Whether this passphrase opens the file's first chunk: a wrong key is found by reading about a megabyte, not the
 * whole file. (Damage further in is for a full check to find.)
 */
export async function opensWithPassphrase(src: string, passphrase: string): Promise<boolean> {
  const input = await open(src, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length + 24);
    if ((await input.read(head, 0, head.length, 0)).bytesRead < head.length || !head.subarray(0, MAGIC.length).equals(MAGIC)) return false;
    const key = await deriveKey(passphrase, head.subarray(MAGIC.length, MAGIC.length + 16));
    const size = (await input.stat()).size;
    const len = Buffer.alloc(4);
    if ((await input.read(len, 0, 4, head.length)).bytesRead < 4) return false;
    const length = len.readUInt32BE();
    if (length > CHUNK) return false;
    const body = Buffer.alloc(length + 16);
    if ((await input.read(body, 0, body.length, head.length + 4)).bytesRead < body.length) return false;
    const decipher = createDecipheriv('aes-256-gcm', key, nonce(head.subarray(MAGIC.length + 16), 0));
    decipher.setAAD(Buffer.from([head.length + 4 + body.length >= size ? 1 : 0]));
    decipher.setAuthTag(body.subarray(length));
    try { decipher.update(body.subarray(0, length)); decipher.final(); return true; } catch { return false; }
  } finally { await input.close(); }
}

/** Writes the decrypted `src` to `dest`; throws on a wrong passphrase or a damaged file. */
export async function decryptFile(src: string, dest: string, passphrase: string): Promise<void> {
  const input = await open(src, 'r');
  let output: FileHandle | undefined;
  try {
    output = await open(dest, 'w');
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
      await writeAll(output, plain, dest);
      if (last) break;
    }
    await output.sync();
  } finally {
    try { await input.close(); } finally { await output?.close(); }
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

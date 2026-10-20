// Container layer of an fmp12 file: header, 4 KiB blocks, and the leaf chain.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { decodePayload } from './chunks.ts';
import type { Chunk, ChunkError } from './chunks.ts';

const MAGIC = [0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x05, 0x00, 0x02, 0x00, 0x02, 0xc0];
export const BLOCK_SIZE = 4096;
const BLOCK_HEADER = 20;

export class FmpError extends Error {}

export interface Header {
  /** "HBAM7" for readable files, "HBAMe" for Encryption at Rest. */
  format: string;
  encrypted: boolean;
  /** 12 for files saved by FileMaker 12 and later, 7 for fp7. */
  versionNum: 7 | 12;
  /** Creator version string at offset 541, e.g. "Pro 12.0". */
  creator: string;
  /** Build date string at offset 531, e.g. "04Mar16". */
  versionDate: string;
}

export interface Block {
  id: number;
  deleted: boolean;
  level: number;
  prev: number;
  next: number;
  payload: Uint8Array;
}

function readHeader(buf: Uint8Array): Header {
  if (buf.length < BLOCK_SIZE * 2) throw new FmpError('file too small to be fmp12');
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC[i]) throw new FmpError('not a FileMaker file (bad magic number)');
  }
  const format = String.fromCharCode(...buf.subarray(15, 20));
  if (format !== 'HBAM7' && format !== 'HBAMe') {
    throw new FmpError(`unsupported FileMaker format "${format}" (fp5 and older are not handled)`);
  }
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.subarray(a, b)).replace(/\0+$/, '');
  return {
    format,
    encrypted: format === 'HBAMe',
    versionNum: buf[521] === 0x1e ? 12 : 7,
    versionDate: ascii(531, 538),
    creator: ascii(542, 542 + buf[541]),
  };
}

const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/** Where blocks come from: a buffer in memory, or a file read on demand. */
export interface BlockSource {
  readonly size: number;
  read(offset: number, length: number): Uint8Array;
  close?(): void;
}

export function bufferSource(buf: Uint8Array): BlockSource {
  return { size: buf.length, read: (offset, length) => buf.subarray(offset, offset + length) };
}

/**
 * Reads blocks from disk as needed, so files larger than memory (or than
 * Node's 2 GB readFile limit) can be opened.
 */
export function fileSource(path: string): BlockSource {
  const fd = openSync(path, 'r');
  let size: number;
  try {
    size = fstatSync(fd).size;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return {
    size,
    read(offset, length) {
      const out = new Uint8Array(length);
      const bytesRead = readSync(fd, out, 0, length, offset);
      // Past the size seen at open, a short read is the file being too small (checked by the caller);
      // within it, the file shrank after it was opened.
      if (bytesRead !== length && offset + length <= size) {
        throw new FmpError(`short read at offset ${offset}: expected ${length} bytes, got ${bytesRead}`);
      }
      return out;
    },
    close: () => closeSync(fd),
  };
}

// --- Encryption at Rest -----------------------------------------------------
// An HBAMe file keeps sector 0 in the clear (magic, password hint, salt) and
// encrypts every later 4 KiB sector: bytes 0..4063 are AES-256-CBC ciphertext,
// 4064..4079 the IV, 4080..4095 a MAC we don't check. The key is
// PBKDF2-HMAC-SHA1 over the UTF-16LE passphrase and the sector-0 salt.
// Format from DanSmith888/fm-vangogh (MIT) and confirmed against the samples.
const SALT_OFFSET = 0xfa;
const SALT_LENGTH = 16;
const SECTOR_BODY = 4064;
const KDF_ITERATIONS = 18000;

/** The AES-256 key for an encrypted file, from its passphrase and the salt in sector 0. */
function deriveKey(passphrase: string, salt: Uint8Array): Buffer {
  return pbkdf2Sync(Buffer.from(passphrase, 'utf16le'), salt, KDF_ITERATIONS, 32, 'sha1');
}

/**
 * Whether a decrypted sector looks like real fmp12 data rather than noise, so a
 * wrong passphrase gives a clear error instead of a confusing parse failure. A
 * block decrypted with the wrong key is near-uniform random (every byte value
 * about equally common); a real block repeats bytes (padding, zeros, tags), so
 * its most common byte stands out well above the ~1-in-256 of random noise.
 */
function looksDecrypted(sector: Uint8Array): boolean {
  const sample = sector.subarray(0, 256);
  const counts = new Uint16Array(256);
  for (const b of sample) counts[b]++;
  let max = 0;
  for (const c of counts) if (c > max) max = c;
  return max >= 32;
}

/**
 * Wraps an encrypted source so reads come back decrypted. Reads are whole
 * sectors (block n is bytes n*4096..); each sector decrypts on its own, so this
 * works the same on a buffer or a file read on demand. The passphrase is used
 * only to derive the key and is never kept or logged.
 */
function decryptingSource(inner: BlockSource, key: Buffer): BlockSource {
  const decryptSector = (sec: Uint8Array): Uint8Array => {
    const d = createDecipheriv('aes-256-cbc', key, sec.subarray(SECTOR_BODY, SECTOR_BODY + 16));
    d.setAutoPadding(false);
    return Buffer.concat([d.update(sec.subarray(0, SECTOR_BODY)), d.final()]);
  };
  return {
    size: inner.size,
    close: () => inner.close?.(),
    read(offset, length) {
      // Serve the sectors the request spans, decrypting each (sector 0 is plaintext).
      const firstSector = Math.floor(offset / BLOCK_SIZE);
      const lastSector = Math.floor((offset + length - 1) / BLOCK_SIZE);
      const out = new Uint8Array(length);
      for (let s = firstSector; s <= lastSector; s++) {
        const base = s * BLOCK_SIZE;
        const raw = inner.read(base, BLOCK_SIZE);
        const plain = s === 0 || raw.length < BLOCK_SIZE ? raw : decryptSector(raw);
        const from = Math.max(offset, base);
        const to = Math.min(offset + length, base + plain.length);
        if (to > from) out.set(plain.subarray(from - base, to - base), from - offset);
      }
      return out;
    },
  };
}

/**
 * Whether a file on disk uses Encryption at Rest, and its password hint, by
 * reading only the plaintext first sector. Lets a caller prompt for the
 * passphrase before trying to open it. The hint is whatever the file's author
 * set in FileMaker (it may be empty).
 */
export function encryptionInfo(src: Uint8Array | BlockSource): { encrypted: boolean; hint?: string } {
  const source = src instanceof Uint8Array ? bufferSource(src) : src;
  const sector0 = source.read(0, BLOCK_SIZE);
  const format = String.fromCharCode(...sector0.subarray(15, 20));
  if (format !== 'HBAMe') return { encrypted: false };
  // The hint is UTF-16LE text between the magic (ends at offset 20) and the salt.
  let hint = '';
  for (let i = 20; i + 1 < SALT_OFFSET; i += 2) {
    const c = sector0[i];
    if (sector0[i + 1] === 0 && c >= 0x20 && c < 0x7f) hint += String.fromCharCode(c);
    else if (hint) break;
  }
  return { encrypted: true, hint: hint.length >= 3 ? hint : undefined };
}

export class FmpFile {
  readonly source: BlockSource;
  readonly header: Header;
  /** Number of body blocks, as recorded in the first body block. */
  readonly blockCount: number;

  constructor(src: Uint8Array | BlockSource, passphrase?: string) {
    const raw = src instanceof Uint8Array ? bufferSource(src) : src;
    this.header = readHeader(raw.read(0, BLOCK_SIZE * 2));
    if (this.header.encrypted) {
      if (passphrase === undefined) {
        throw new FmpError('file uses Encryption at Rest; a passphrase is needed to open it');
      }
      const salt = raw.read(SALT_OFFSET, SALT_LENGTH);
      this.source = decryptingSource(raw, deriveKey(passphrase, salt));
      if (!looksDecrypted(this.source.read(BLOCK_SIZE, BLOCK_SIZE))) {
        throw new FmpError('could not open the encrypted file: wrong passphrase');
      }
    } else {
      this.source = raw;
    }
    const first = this.block(1);
    this.blockCount = first.next;
    // FileMaker's consistency check can append its log as text after the last block: ignore anything past it.
    if (this.blockCount === 0 || (this.blockCount + 1) * BLOCK_SIZE > this.source.size) {
      throw new FmpError(`block count ${this.blockCount} does not match file size ${this.source.size}`);
    }
  }

  close(): void {
    this.source.close?.();
  }

  /** Block n lives at byte offset n * 4096; block 0 is the file header. */
  block(id: number): Block {
    const off = id * BLOCK_SIZE;
    if (id < 1 || off + BLOCK_SIZE > this.source.size || (this.blockCount && id > this.blockCount)) throw new FmpError(`block ${id} out of range`);
    const s = this.source.read(off, BLOCK_SIZE);
    return {
      id,
      deleted: s[0] !== 0,
      level: (s[12] << 8) | s[13],
      prev: be32(s, 4),
      next: be32(s, 8),
      payload: s.subarray(BLOCK_HEADER),
    };
  }

  /** The first leaf: level 0 with no predecessor (usually block 2). */
  firstLeaf(): number {
    for (let id = 2; id <= this.blockCount; id++) {
      const b = this.block(id);
      if (b.level === 0 && b.prev === 0) return id;
    }
    return 2;
  }

  /** Leaf blocks in logical order, following the next-pointers. */
  *leaves(): Generator<Block> {
    const seen = new Set<number>();
    let id = this.firstLeaf();
    while (id !== 0 && id <= this.blockCount && !seen.has(id)) {
      seen.add(id);
      const b = this.block(id);
      yield b;
      id = b.next;
    }
  }

  private leafOrderCache?: Uint32Array;
  /** Index into leafOrder() of the leaf read last by a scan: how far through the file reading has got. */
  position = 0;

  /** How far through the file's leaves the last read got, from 0 to 1. */
  readFraction(): number {
    const n = this.leafOrder().length;
    return n ? Math.min(1, (this.position + 1) / n) : 1;
  }

  /**
   * Leaf block ids in logical (sorted) order. Only block headers are read, so
   * this stays cheap on multi-gigabyte files.
   */
  leafOrder(): Uint32Array {
    if (this.leafOrderCache) return this.leafOrderCache;
    const ids: number[] = [];
    const seen = new Uint8Array(this.blockCount + 1);
    let id = this.firstLeaf();
    while (id !== 0 && id <= this.blockCount && !seen[id]) {
      seen[id] = 1;
      ids.push(id);
      id = be32(this.source.read(id * BLOCK_SIZE, BLOCK_HEADER), 8);
    }
    return (this.leafOrderCache = Uint32Array.from(ids));
  }

  /** Sort key (path plus value key) of the first value in a leaf block; undefined when it holds none. */
  firstPath(id: number): Uint8Array[] | undefined {
    const path: Uint8Array[] = [];
    for (const chunk of decodePayload(this.block(id).payload).chunks) {
      if (chunk.type === 'pop') path.pop();
      else if (chunk.type === 'push') path.push(chunk.key);
      else return sortKey(path, chunk);
    }
    return undefined;
  }

  /**
   * Index into leafOrder() of the first leaf that can hold paths starting with
   * `prefix`: a binary search over the leaves' first values, which are sorted.
   */
  private seek(prefix: Uint8Array[]): number {
    const order = this.leafOrder();
    let lo = 0;
    let hi = order.length - 1;
    // The last leaf whose first value sorts before the prefix. An empty leaf
    // counts as before; stepping back over empties afterwards keeps that safe.
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const p = this.firstPath(order[mid]);
      if (!p || rank(p, prefix) < 0) lo = mid;
      else hi = mid - 1;
    }
    while (lo > 0 && !this.firstPath(order[lo])) lo--;
    return lo;
  }

  /**
   * Every chunk in the file with the path it lives at. The path stack is reset
   * at each block, as each leaf block starts from the root. With `prefix` (path
   * integers, e.g. [129, 5] for a table's records) only that subtree is read.
   */
  *chunks(
    onError?: (block: Block, err: ChunkError) => void,
    prefix?: number[],
  ): Generator<{ path: Uint8Array[]; chunk: Chunk; block: number }> {
    if (prefix) {
      yield* this.chunksUnder(prefix.map(encodePathInt), onError);
      return;
    }
    for (const b of this.leaves()) {
      const { chunks, error } = decodePayload(b.payload);
      const path: Uint8Array[] = [];
      for (const chunk of chunks) {
        if (chunk.type === 'pop') {
          path.pop();
        } else if (chunk.type === 'push') {
          path.push(chunk.key);
        } else {
          yield { path, chunk, block: b.id };
        }
      }
      if (error && onError) onError(b, error);
    }
  }

  private *chunksUnder(prefix: Uint8Array[], onError?: (block: Block, err: ChunkError) => void): Generator<{ path: Uint8Array[]; chunk: Chunk; block: number }> {
    yield* this.scan(this.seek(prefix), (path, chunk) => {
      const r = rank(path, prefix);
      return r === 0 ? 0 : rank(sortKey(path, chunk), prefix) > 0 ? 1 : -1;
    }, onError);
  }

  /**
   * Everything stored under the small top-level ids (1-127): the catalogs of
   * tables, layouts, scripts and so on, which sort before any table's data.
   */
  *catalogChunks(onError?: (block: Block, err: ChunkError) => void): Generator<{ path: Uint8Array[]; chunk: Chunk; block: number }> {
    yield* this.scan(0, (path) => (path.length === 0 ? -1 : path[0].length === 1 && path[0][0] < 0x80 ? 0 : 1), onError);
  }

  /**
   * Leaves from `start` on: yields values the test puts at 0, skips those
   * before (-1) and stops at the first one after (1).
   */
  private *scan(
    start: number,
    test: (path: Uint8Array[], chunk: Chunk) => number,
    onError?: (block: Block, err: ChunkError) => void,
  ): Generator<{ path: Uint8Array[]; chunk: Chunk; block: number }> {
    const order = this.leafOrder();
    for (let i = start; i < order.length; i++) {
      this.position = i;
      const b = this.block(order[i]);
      const { chunks, error } = decodePayload(b.payload);
      const path: Uint8Array[] = [];
      for (const chunk of chunks) {
        if (chunk.type === 'pop') path.pop();
        else if (chunk.type === 'push') path.push(chunk.key);
        else {
          const t = test(path, chunk);
          if (t === 0) yield { path, chunk, block: b.id };
          else if (t > 0) return;
        }
      }
      if (error && onError) onError(b, error);
    }
  }
}

/**
 * Values sort by path and then by their own key, interleaved with child nodes:
 * a node's value keyed 0x40 sorts after its child 0x30 and everything under it.
 */
function sortKey(path: Uint8Array[], chunk: Chunk): Uint8Array[] {
  switch (chunk.type) {
    case 'kv': return [...path, encodePathInt(chunk.key)];
    case 'segment': return [...path, encodePathInt(chunk.index)];
    case 'kvlong': return [...path, chunk.key];
    default: return path;
  }
}

/** Path integer as stored: 1 byte below 128, 2 bytes (10xxxxxx) below 16512, else 3 bytes (110xxxxx). */
export function encodePathInt(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  if (n < 0x4080) return Uint8Array.of(0x80 | ((n - 0x80) >> 8), (n - 0x80) & 0xff);
  const v = n - 0x4080;
  return Uint8Array.of(0xc0 | (v >> 16), (v >> 8) & 0xff, v & 0xff);
}

/** Value of a segment in one of the path-integer forms, else undefined. */
function intValue(s: Uint8Array): number | undefined {
  if (s.length === 1) return s[0];
  if (s.length === 2 && (s[0] & 0xc0) === 0x80) return 0x80 + ((s[0] & 0x3f) << 8) + s[1];
  if (s.length === 3 && (s[0] & 0xe0) === 0xc0) return 0x4080 + ((s[0] & 0x1f) << 16) + (s[1] << 8) + s[2];
  return undefined;
}

/**
 * Two path integers sort by value; anything else (raw keys, D0 table
 * occurrence references) sorts bytewise.
 */
function compareSegments(a: Uint8Array, b: Uint8Array): number {
  const va = intValue(a);
  const vb = intValue(b);
  if (va !== undefined && vb !== undefined) return va - vb;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * 0 when `path` lies under `prefix`, otherwise which side of that subtree it
 * sorts on. Only the prefix's depth is compared: below it the stored order has
 * quirks (a node's values can follow its children) that do not matter here.
 */
export function rank(path: Uint8Array[], prefix: Uint8Array[]): number {
  for (let i = 0; i < prefix.length; i++) {
    if (i >= path.length) return -1;
    const c = compareSegments(path[i], prefix[i]);
    if (c) return Math.sign(c);
  }
  return 0;
}

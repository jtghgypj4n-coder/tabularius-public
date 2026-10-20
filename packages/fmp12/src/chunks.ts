// Decoder for the byte-code stream inside an fmp12 (and fp7) block payload.
//
// Opcode table follows the format notes in evanmiller/fmptools (MIT), see
// docs/research/fmp12-format.md for the full description and provenance.

export type Chunk =
  | { type: 'push'; key: Uint8Array }
  | { type: 'pop' }
  | { type: 'data'; data: Uint8Array }
  | { type: 'segment'; index: number; wide: boolean; data: Uint8Array }
  // wide: the key was stored as a two-byte path integer (see Records.decodeFieldKey)
  | { type: 'kv'; key: number; wide: boolean; data: Uint8Array }
  | { type: 'kvlong'; key: Uint8Array; data: Uint8Array };

export class ChunkError extends Error {
  readonly offset: number;
  readonly code: number;
  constructor(message: string, offset: number, code: number) {
    super(message);
    this.offset = offset;
    this.code = code;
  }
}

// Two-byte "path integer": high bit of the first byte ignored, then +0x80.
export function pathInt2(b: Uint8Array, at: number): number {
  return 0x80 + ((b[at] & 0x7f) << 8) + b[at + 1];
}

/**
 * Numeric value of a path segment, or undefined when it is not integer-like.
 * Observed forms:
 *   0xxxxxxx                      0 .. 127
 *   10xxxxxx xxxxxxxx             128 .. 16511 (+0x80)
 *   1100xxxx xxxxxxxx xxxxxxxx    16512 and up (+0x4080), e.g. record ids
 *   0xD0     xxxxxxxx xxxxxxxx    a table occurrence reference: 128 + n
 * fmptools reads every three-byte form as 0x80 + the last two bytes, which is
 * right for 0xD0 references but makes record ids past 16511 collide.
 * Where a segment is known to be an integer (a record id), use pathInt.
 */
export function pathValue(key: Uint8Array): number | undefined {
  if (key.length === 3 && (key[0] & 0xe0) !== 0xc0) return 0x80 + (key[1] << 8) + key[2];
  if (key.length === 3 && (key[0] & 0xf0) === 0xd0) return 0x80 + (key[1] << 8) + key[2];
  return pathInt(key);
}

/**
 * A path integer as the plain prefix-length varint: three-byte forms carry
 * five bits in the first byte (110xxxxx), so record ids from 1,065,088 on
 * start with 0xD0..0xDF (one file has records at 1,077,501 and up).
 */
export function pathInt(key: Uint8Array): number | undefined {
  if (key.length === 1) return key[0];
  if (key.length === 2) return 0x80 + ((key[0] & 0x3f) << 8) + key[1];
  if (key.length === 3 && (key[0] & 0xe0) === 0xc0) return 0x4080 + ((key[0] & 0x1f) << 16) + (key[1] << 8) + key[2];
  return undefined;
}

export interface DecodeResult {
  chunks: Chunk[];
  /** Set when decoding stopped early on an unknown or truncated opcode. */
  error?: ChunkError;
}

/**
 * The chunks in a block payload. With `ends`, the byte offset just past the
 * opcode that produced each chunk is recorded too (for tools that rewrite blocks).
 */
export function decodePayload(p: Uint8Array, ends?: number[]): DecodeResult {
  const chunks: Chunk[] = [];
  const end = p.length;
  let i = 0;
  const take = (n: number): Uint8Array => {
    if (i + n > end) throw new ChunkError('chunk exceeds block', i, p[i]);
    const s = p.subarray(i, i + n);
    i += n;
    return s;
  };
  const u8 = (): number => {
    if (i >= end) throw new ChunkError('chunk exceeds block', i, -1);
    return p[i++];
  };
  const u16 = (): number => {
    if (i + 2 > end) throw new ChunkError('chunk exceeds block', i, -1);
    const v = (p[i] << 8) | p[i + 1];
    i += 2;
    return v;
  };

  try {
    while (i < end) {
      const start = i;
      let c = p[i];
      let pops = 0;
      if ((c & 0xc0) === 0xc0) {
        c &= 0x3f;
        pops = 1;
      }
      i++;
      if (c === 0x00) {
        if (i >= end || p[i] === 0x00) break; // end of payload padding
        chunks.push({ type: 'data', data: take(1) });
      } else if (c <= 0x05) {
        const key = u8();
        chunks.push({ type: 'kv', key, wide: false, data: take(c === 0x01 ? 1 : 2 * (c - 1)) });
      } else if (c === 0x06) {
        const key = u8();
        const n = u8();
        chunks.push({ type: 'kv', key, wide: false, data: take(n) });
      } else if (c === 0x07) {
        const index = u8();
        const n = u16();
        chunks.push({ type: 'segment', index, wide: false, data: take(n) });
      } else if (c === 0x08) {
        chunks.push({ type: 'data', data: take(2) });
      } else if (c === 0x0e && p[i] === 0xff) {
        chunks.push({ type: 'data', data: take(6) });
      } else if (c <= 0x0d) {
        if (i + 2 > end) throw new ChunkError('chunk exceeds block', start, c);
        const key = pathInt2(p, i);
        i += 2;
        chunks.push({ type: 'kv', key, wide: true, data: take(c === 0x09 ? 1 : 2 * (c - 9)) });
      } else if (c === 0x0e) {
        if (i + 2 > end) throw new ChunkError('chunk exceeds block', start, c);
        const key = pathInt2(p, i);
        i += 2;
        const n = u8();
        chunks.push({ type: 'kv', key, wide: true, data: take(n) });
      } else if (c === 0x0f) {
        if (i + 2 > end) throw new ChunkError('chunk exceeds block', start, c);
        const index = pathInt2(p, i);
        i += 2;
        const n = u16();
        chunks.push({ type: 'segment', index, wide: true, data: take(n) });
      } else if (c === 0x10) {
        chunks.push({ type: 'data', data: take(3) });
      } else if (c >= 0x11 && c <= 0x15) {
        chunks.push({ type: 'data', data: take(3 + (c === 0x11 ? 1 : 0) + 2 * (c - 0x11)) });
      } else if (c === 0x16 || c === 0x17) {
        const key = take(3);
        const n = c === 0x16 ? u8() : u16();
        // Segment indexes past 16511 need a three-byte path integer, so large
        // container data continues with 0x16/0x17 where 0x0F left off.
        if ((key[0] & 0xf0) === 0xc0) chunks.push({ type: 'segment', index: pathValue(key)!, wide: true, data: take(n) });
        else chunks.push({ type: 'kvlong', key, data: take(n) });
      } else if (c === 0x18 || c === 0x23) {
        const n = u8();
        chunks.push({ type: 'data', data: take(n) });
      } else if (c === 0x1b && p[i] === 0x00) {
        i++;
        const key = u8();
        chunks.push({ type: 'kv', key, wide: false, data: take(4) });
      } else if (c >= 0x19 && c <= 0x1d) {
        // A key of n bytes with a fixed-size value (1, 2, 4, 6 or 8 bytes):
        // stored find criteria use these, keyed by table occurrence and field.
        const n = u8();
        const key = take(n);
        chunks.push({ type: 'kvlong', key, data: take((c === 0x19 ? 1 : 0) + 2 * (c - 0x19)) });
      } else if (c === 0x1e) {
        const k = u8();
        const key = take(k);
        const n = u8();
        chunks.push({ type: 'kvlong', key, data: take(n) });
      } else if (c === 0x1f) {
        const k = u8();
        const key = take(k);
        const n = u16();
        chunks.push({ type: 'kvlong', key, data: take(n) });
      } else if (c === 0x20) {
        if (p[i] === 0xfe) {
          i++;
          chunks.push({ type: 'push', key: take(8) });
        } else {
          chunks.push({ type: 'push', key: take(1) });
        }
      } else if (c === 0x28) {
        chunks.push({ type: 'push', key: take(2) });
      } else if (c === 0x30) {
        chunks.push({ type: 'push', key: take(3) });
      } else if (c === 0x38) {
        const n = u8();
        chunks.push({ type: 'push', key: take(n) });
      } else if (c === 0x3d || c === 0x40) {
        chunks.push({ type: 'pop' });
      } else if (c === 0x80 || c === 0x88) {
        // no-op
      } else {
        throw new ChunkError(`unrecognized opcode 0x${c.toString(16)}`, start, c);
      }
      if (pops) chunks.push({ type: 'pop' });
      if (ends) while (ends.length < chunks.length) ends.push(i);
    }
  } catch (e) {
    if (e instanceof ChunkError) return { chunks, error: e };
    throw e;
  }
  return { chunks };
}

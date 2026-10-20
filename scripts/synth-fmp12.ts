// Makes a large .fmp12 for testing conversion at scale: copies a real file
// and adds records (and container files) to one of its tables, as many as
// asked, so a multi-gigabyte file can be made from a small sample.
//
//   node scripts/synth-fmp12.ts <sample.fmp12> <out.fmp12> --table ID --records N [--blobs M] [--template-blob ID]
//
// The new records copy an existing record of the table; the first M of them
// each point at their own copy of an existing container file. New leaf
// blocks are added at the end of the file and linked into the leaf chain
// where the table's records (and container files) end; the leaf that held
// the last of them is split in two there. Only the leaf chain is changed
// (the reader doesn't use the index blocks), so FileMaker itself may not
// open the result: it is for Tabularius's reader and converter.

import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { BLOCK_SIZE, FmpDatabase, decodePayload, pathInt, pathValue, type Chunk } from '../packages/fmp12/src/index.ts';

const HEADER = 20;
const PAYLOAD = BLOCK_SIZE - HEADER;

const args = process.argv.slice(2);
const opt = (name: string, def?: number) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = Number(args.splice(i, 2)[1]);
  return v;
};
const tableId = opt('--table');
const records = opt('--records', 1000)!;
const blobs = opt('--blobs', 0)!;
const templateBlob = opt('--template-blob');
const [src, out] = args;
if (!src || !out || tableId === undefined) {
  console.error('usage: node scripts/synth-fmp12.ts <sample.fmp12> <out.fmp12> --table ID --records N [--blobs M] [--template-blob ID]');
  process.exit(2);
}
if (blobs > records) throw new Error('--blobs can be at most --records');

const db = FmpDatabase.open(src);
const file = db.file;

/** A path integer's bytes (see pathInt in chunks.ts). */
function encodeInt(v: number): Uint8Array {
  if (v < 0x80) return Uint8Array.of(v);
  if (v < 0x4080) return Uint8Array.of(0x80 | ((v - 0x80) >> 8), (v - 0x80) & 0xff);
  const w = v - 0x4080;
  if (w > 0xfffff) throw new Error(`id ${v} is too large`);
  return Uint8Array.of(0xc0 | (w >> 16), (w >> 8) & 0xff, w & 0xff);
}

function push(key: Uint8Array): number[] {
  if (key.length === 1 && key[0] !== 0xfe) return [0x20, key[0]];
  if (key.length === 2) return [0x28, ...key];
  if (key.length === 3) return [0x30, ...key];
  return [0x38, key.length, ...key];
}

/** Bytes for a value chunk, in a form the decoder reads back as the same chunk. */
function encode(c: Chunk): number[] {
  const len16 = (n: number) => [n >> 8, n & 0xff];
  switch (c.type) {
    case 'kv':
      if (c.data.length > 255) throw new Error('kv value too long');
      if (!c.wide) return [0x06, c.key, c.data.length, ...c.data];
      return [0x0e, ((c.key - 0x80) >> 8) & 0x7f, (c.key - 0x80) & 0xff, c.data.length, ...c.data];
    case 'segment':
      if (c.index < 0x100 && !c.wide) return [0x07, c.index, ...len16(c.data.length), ...c.data];
      if (c.index < 0x4080) return [0x0f, ((c.index - 0x80) >> 8) & 0x7f, (c.index - 0x80) & 0xff, ...len16(c.data.length), ...c.data];
      return [0x17, ...encodeInt(c.index), ...len16(c.data.length), ...c.data];
    case 'kvlong':
      return c.data.length < 256 ? [0x1e, c.key.length, ...c.key, c.data.length, ...c.data] : [0x1f, c.key.length, ...c.key, ...len16(c.data.length), ...c.data];
    case 'data':
      return [0x18, c.data.length, ...c.data];
    default:
      throw new Error(`can't write a ${c.type} chunk`);
  }
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Builds leaf payloads from (path, chunk) items in order, starting a new block when one is full. */
class Leaves {
  count = 0;
  private cur: number[] = [];
  private stack: Uint8Array[] = [];
  private readonly sink: (payload: Uint8Array) => void;

  constructor(sink: (payload: Uint8Array) => void = () => {}) {
    this.sink = sink;
  }

  add(path: Uint8Array[], chunk: number[]): void {
    let ops = this.ops(path, chunk);
    if (this.cur.length + ops.length > PAYLOAD) {
      this.finish();
      ops = this.ops(path, chunk);
      if (ops.length > PAYLOAD) throw new Error('a value is too large for one block');
    }
    this.cur.push(...ops);
    this.stack = path.slice();
  }

  private ops(path: Uint8Array[], chunk: number[]): number[] {
    let common = 0;
    while (common < this.stack.length && common < path.length && same(this.stack[common], path[common])) common++;
    const ops: number[] = [];
    for (let i = common; i < this.stack.length; i++) ops.push(0x40);
    for (let i = common; i < path.length; i++) ops.push(...push(path[i]));
    ops.push(...chunk);
    return ops;
  }

  finish(): void {
    if (!this.cur.length) return;
    const p = new Uint8Array(PAYLOAD);
    p.set(this.cur);
    this.sink(p);
    this.count++;
    this.cur = [];
    this.stack = [];
  }
}

/** Where a region ends: the leaf holding its last value, and the byte offset and path just past it. */
function regionEnd(prefix: number[]): { leaf: number; at: number; path: Uint8Array[] } {
  let leaf = -1;
  for (const c of file.chunks(undefined, prefix)) leaf = c.block;
  if (leaf < 0) throw new Error(`nothing stored under ${prefix.join('.')}`);
  const payload = file.block(leaf).payload;
  const ends: number[] = [];
  const { chunks } = decodePayload(payload, ends);
  const path: Uint8Array[] = [];
  const inside = (p: Uint8Array[]) => p.length >= prefix.length && prefix.every((v, i) => pathValue(p[i]) === v);
  let at = -1;
  let pathAt: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.type === 'push') path.push(c.key);
    else if (c.type === 'pop') path.pop();
    else if (inside(path)) {
      // Past this value, and past a pop folded into the same opcode.
      let j = i;
      const replay = path.slice();
      while (j + 1 < chunks.length && ends[j + 1] === ends[i]) {
        j++;
        if (chunks[j].type === 'pop') replay.pop();
      }
      at = ends[i];
      pathAt = replay;
    }
  }
  return { leaf, at, path: pathAt };
}

/** A leaf's payload split at `at`: the first part as is, the rest restarted from the root. */
function split(leaf: number, at: number, path: Uint8Array[]): [Uint8Array, Uint8Array] {
  const payload = file.block(leaf).payload;
  const ends: number[] = [];
  decodePayload(payload, ends);
  const used = ends.length ? ends[ends.length - 1] : 0;
  const first = new Uint8Array(PAYLOAD);
  first.set(payload.subarray(0, at));
  const rest = [...path.flatMap(push), ...payload.subarray(at, used)];
  if (rest.length > PAYLOAD) throw new Error('the split leaf does not fit in one block');
  const second = new Uint8Array(PAYLOAD);
  second.set(rest);
  return [first, second];
}

// Templates: one record of the table, and one container file.
const T = encodeInt(tableId);
const recordItems: { path: Uint8Array[]; chunk: Chunk }[] = [];
let templateRecord: number | undefined;
let maxRecord = 0;
for (const { path, chunk } of file.chunks(undefined, [tableId, 5])) {
  if (path.length < 3 || pathValue(path[1]) !== 5) continue;
  const id = pathInt(path[2])!;
  maxRecord = Math.max(maxRecord, id);
  templateRecord ??= id;
  if (id === templateRecord && chunk.type !== 'push' && chunk.type !== 'pop') recordItems.push({ path: path.slice(3), chunk });
}
if (templateRecord === undefined) throw new Error(`table ${tableId} has no records`);

const container = db.table(tableId).fields.find((f) => f.type === 'container');
const blobItems: { path: Uint8Array[]; chunk: Chunk }[] = [];
let maxBlob = 0;
if (blobs) {
  if (!container) throw new Error(`table ${tableId} has no container field`);
  for (const { path, chunk } of file.chunks(undefined, [tableId, 31, 5])) {
    if (path.length < 4 || pathValue(path[2]) !== 5) continue;
    const id = pathValue(path[3])!;
    maxBlob = Math.max(maxBlob, id);
    if (id === (templateBlob ?? 1) && chunk.type !== 'push' && chunk.type !== 'pop') blobItems.push({ path: path.slice(4), chunk });
  }
  if (!blobItems.length) throw new Error(`no container file ${templateBlob ?? 1} in table ${tableId}`);
}

// A container field holds "<blob id in hex>" + U+E000, stored as text (ASCII XOR 0x5A, then the private-use mark).
const containerKey = container ? encodeInt(container.id) : undefined;
const ref = (blob: number) => Uint8Array.from([...blob.toString(16).padStart(2, '0')].map((ch) => ch.charCodeAt(0) ^ 0x5a).concat([0x41, 0x32, 0xda]));

/** The new records' leaves, written to `sink`; returns how many. */
function recordLeaves(sink?: (payload: Uint8Array) => void): number {
  const leaves = new Leaves(sink);
  for (let n = 1; n <= records; n++) {
    const base = [T, Uint8Array.of(5), encodeInt(maxRecord + n)];
    const withBlob = n <= blobs;
    for (const { path, chunk } of recordItems) {
      const inContainer = containerKey && path.length >= 1 && same(path[0], containerKey);
      if (inContainer && !withBlob) continue;
      const c = inContainer && chunk.type === 'kv' && chunk.key === 1 ? { ...chunk, data: ref(maxBlob + n) } : chunk;
      leaves.add([...base, ...path], encode(c));
    }
  }
  leaves.finish();
  return leaves.count;
}

/** The new container files' leaves. */
function blobLeaves(sink?: (payload: Uint8Array) => void): number {
  const leaves = new Leaves(sink);
  for (let n = 1; n <= blobs; n++) {
    const base = [T, Uint8Array.of(31), Uint8Array.of(5), encodeInt(maxBlob + n)];
    for (const { path, chunk } of blobItems) leaves.add([...base, ...path], encode(chunk));
  }
  leaves.finish();
  return leaves.count;
}

// Link the new leaves in after each region's last value: counted first, so
// the links are known before anything is written; written on a second pass.
const regions = [{ end: regionEnd([tableId, 5]), make: recordLeaves, count: recordLeaves() }];
if (blobs) regions.push({ end: regionEnd([tableId, 31, 5]), make: blobLeaves, count: blobLeaves() });
if (regions.length === 2 && regions[0].end.leaf === regions[1].end.leaf) throw new Error('records and containers end in the same leaf; pick another table');

const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const put32 = (b: Uint8Array, at: number, v: number) => {
  b[at] = v >>> 24;
  b[at + 1] = (v >> 16) & 0xff;
  b[at + 2] = (v >> 8) & 0xff;
  b[at + 3] = v & 0xff;
};

const changed = new Map<number, Uint8Array>();
const raw = (id: number) => {
  if (!changed.has(id)) {
    const b = new Uint8Array(BLOCK_SIZE);
    b.set(file.source.read(id * BLOCK_SIZE, BLOCK_SIZE));
    changed.set(id, b);
  }
  return changed.get(id)!;
};
let next = file.blockCount + 1;
const plan = regions.map(({ end, make, count }) => {
  const leaf = raw(end.leaf);
  const after = be32(leaf, 8);
  const [first, second] = split(end.leaf, end.at, end.path);
  leaf.set(first, HEADER);
  // The new leaves, then the split leaf's second half, then on as before.
  const start = next;
  next += count + 1;
  put32(leaf, 8, start);
  if (after) put32(raw(after), 4, next - 1);
  return { prev: end.leaf, start, after, make, second };
});
// Block 1 records the number of blocks.
put32(raw(1), 8, next - 1);

const fd = openSync(out, 'w');
const input = openSync(src, 'r');
const buf = new Uint8Array(BLOCK_SIZE * 256);
for (let id = 0; id <= file.blockCount; id += 256) {
  const n = Math.min(256, file.blockCount + 1 - id);
  readSync(input, buf, 0, n * BLOCK_SIZE, id * BLOCK_SIZE);
  for (let k = 0; k < n; k++) if (changed.has(id + k)) buf.set(changed.get(id + k)!, k * BLOCK_SIZE);
  writeSync(fd, buf, 0, n * BLOCK_SIZE);
}
const header = file.source.read(BLOCK_SIZE * regions[0].end.leaf, HEADER);
let written = 0;
for (const r of plan) {
  let id = r.start;
  const last = r.start + regions[plan.indexOf(r)].count;
  const write = (payload: Uint8Array) => {
    const b = new Uint8Array(BLOCK_SIZE);
    b.set(header);
    b[0] = 0;
    put32(b, 4, id === r.start ? r.prev : id - 1);
    put32(b, 8, id === last ? r.after : id + 1);
    b[12] = 0;
    b[13] = 0;
    b.set(payload, HEADER);
    writeSync(fd, b);
    id++;
    written++;
  };
  r.make(write);
  write(r.second);
}
closeSync(fd);
closeSync(input);
db.close();
console.log(`${out}: ${records} records added to table ${tableId}${blobs ? `, ${blobs} with a container file` : ''}; ${written} blocks, ${(next * BLOCK_SIZE / 1e9).toFixed(2)} GB`);

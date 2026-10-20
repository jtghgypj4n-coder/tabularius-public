import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { decodeCalc } from '../src/calc.ts';
import type { Chunk } from '../src/chunks.ts';
import { containerBlobs, containerRefId, readContainers } from '../src/containers.ts';
import { BLOCK_SIZE, encodePathInt, FmpError, FmpFile, rank } from '../src/file.ts';
import { readLayoutDesigns } from '../src/layouts.ts';
import { Pb, pbParse } from '../src/proto.ts';
import { readRecords } from '../src/records.ts';
import { privilegeSets, type Schema } from '../src/schema.ts';
import { decodeScsu, decodeTextChars } from '../src/scsu.ts';
import { Node } from '../src/tree.ts';
import { customAccess } from '../../store/src/privileges.ts';

// Synchronous parser work must be interruptible even if it stops yielding.
function boundedTest(name: string, run: () => void): void {
  test(name, () => {
    if (process.env.TABULARIUS_READER_CASE === name) return run();
    const env: NodeJS.ProcessEnv = { ...process.env, TABULARIUS_READER_CASE: name };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--test', '--test-concurrency=2', '--test-reporter=tap',
      '--test-name-pattern', `^${name}$`, import.meta.filename,
    ], { env, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^# pass 1$/m);
  });
}

test('AR-fmp12-reader-01', () => {
  for (const scope of ['absent', 'empty', 'formatting', 'unknown-child'] as const) {
    const sets = new Node(), set = new Node(), tables = new Node(), table = new Node();
    sets.children.set(7, set);
    set.children.set(5, tables);
    tables.children.set(129, table);
    table.kv.set(2, Uint8Array.of(0x55));
    if (scope !== 'absent') {
      const fields = new Node();
      table.children.set(5, fields);
      if (scope === 'formatting') fields.kv.set(0, Uint8Array.of(0xff));
      if (scope === 'unknown-child') fields.children.set(1, new Node());
    }
    const [parsed] = privilegeSets(sets, undefined);
    const schema = { tables: [{ id: 129, name: 'Records', fields: [
      { id: 1, name: 'Private', type: 'text', kind: 'normal', hasCalculation: false },
    ] }] } as Schema;
    const mapped = customAccess(parsed, schema);
    if (scope === 'absent') {
      assert.equal(parsed.tableRecords![0].fields, undefined);
      assert.equal(mapped.tables.Records.fields, undefined);
    } else {
      assert.deepEqual(parsed.tableRecords![0].fields, [], scope);
      assert.deepEqual(mapped.tables.Records.fields, { Private: 'none' }, scope);
      assert.equal(mapped.tables.Records.fieldsDefault, 'none', scope);
      assert.deepEqual(mapped.hiddenFields, { Records: ['Private'] }, scope);
    }
  }
});

function generatedFile(): Buffer {
  const bytes = Buffer.alloc(4 * BLOCK_SIZE);
  bytes.set([0, 1, 0, 0, 0, 2, 0, 1, 0, 5, 0, 2, 0, 2, 0xc0]);
  bytes.write('HBAM7', 15, 'ascii');
  bytes[521] = 0x1e;
  bytes.writeUInt32BE(3, BLOCK_SIZE + 8);
  bytes.writeUInt16BE(1, BLOCK_SIZE + 12);
  bytes.writeUInt32BE(3, 2 * BLOCK_SIZE + 8);
  bytes.writeUInt32BE(2, 3 * BLOCK_SIZE + 4);
  for (const [block, record] of [[2, 1], [3, 2]]) {
    bytes.set([0x28, 0x80, 1, 0x20, 5, 0x20, record, 1, 1, 0x41 ^ 0x5a], block * BLOCK_SIZE + 20);
  }
  return bytes;
}

boundedTest('AR-fmp12-reader-02-links', () => {
  for (const [block, next] of [[2, 2], [2, 4], [3, 2], [2, 1]]) {
    const bytes = generatedFile();
    bytes.writeUInt32BE(next, block * BLOCK_SIZE + 8);
    for (const read of [
      (f: FmpFile) => [...f.leaves()], (f: FmpFile) => f.leafOrder(),
      (f: FmpFile) => [...f.chunks()], (f: FmpFile) => [...f.catalogChunks()],
      (f: FmpFile) => [...readRecords(f, 129, new Set([1]))],
    ]) {
      assert.throws(() => read(new FmpFile(bytes)), (error: unknown) => {
        assert.ok(error instanceof FmpError);
        assert.match(error.message, new RegExp(`block ${block}.*${next}`));
        return true;
      });
    }
  }
  const file = new FmpFile(generatedFile());
  assert.deepEqual([...file.leafOrder()], [2, 3]);
  assert.deepEqual([...readRecords(file, 129, new Set([1]))].map((r) => r.id), [1, 2]);
});

test('AR-fmp12-reader-02-payload', () => {
  const bytes = generatedFile();
  bytes.set([7, 1, 0xff, 0xff], 2 * BLOCK_SIZE + 30);
  for (const read of [
    (f: FmpFile) => f.firstPath(2), (f: FmpFile) => [...f.chunks()],
    (f: FmpFile) => [...f.chunks(undefined, [129, 5])],
    (f: FmpFile) => [...f.catalogChunks()],
    (f: FmpFile) => [...readRecords(f, 129, new Set([1]))],
  ]) {
    assert.throws(() => read(new FmpFile(bytes)), (error: unknown) => {
      assert.ok(error instanceof FmpError);
      assert.match(error.message, /block 2.*offset.*chunk exceeds block/);
      return true;
    });
  }
  let reported = 0;
  assert.throws(() => [...new FmpFile(bytes).chunks((block, error) => {
    assert.equal(block.id, 2);
    assert.match(error.message, /chunk exceeds block/);
    reported++;
  })], FmpError);
  assert.equal(reported, 1);
});

boundedTest('AR-fmp12-reader-02-root', () => {
  const noBody = generatedFile().subarray(0, 2 * BLOCK_SIZE);
  noBody.writeUInt32BE(1, BLOCK_SIZE + 8);
  const noRoot = generatedFile();
  noRoot.writeUInt32BE(3, 2 * BLOCK_SIZE + 4);
  for (const bytes of [noBody, noRoot]) {
    const file = new FmpFile(bytes);
    assert.throws(() => file.firstLeaf(), FmpError);
    assert.throws(() => [...file.leaves()], FmpError);
    assert.throws(() => file.leafOrder(), FmpError);
    assert.throws(() => [...readRecords(file, 129, new Set([1]))], FmpError);
  }
});

function countedBytes(bytes: Uint8Array, budget: number): { bytes: Uint8Array; reads: () => number } {
  let reads = 0;
  const wrap = (b: Uint8Array): Uint8Array => new Proxy(b, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        assert.ok(++reads <= budget, 'byte work budget');
      }
      if (key === 'subarray') return (start?: number, end?: number) => wrap(target.subarray(start, end));
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { bytes: wrap(bytes), reads: () => reads };
}

boundedTest('AR-fmp12-reader-03', () => {
  for (const count of [10_000, 20_000, 40_000]) {
    const bytes = new Uint8Array(count * 5 - 1);
    for (let i = 0; i < count; i++) {
      bytes.set([0x13, 1, 0x41 ^ 0x5a, 0], i * 5);
      if (i < count - 1) bytes[i * 5 + 4] = 0x50;
    }
    const measured = countedBytes(bytes, bytes.length * 4);
    assert.deepEqual(decodeCalc(measured.bytes), { text: Array(count).fill('"A"').join('&'), unknown: [] });
    assert.ok(measured.reads() <= bytes.length * 4);
  }
});

test('AR-fmp12-reader-03-scsu', () => {
  const cases = [
    [0x41], [0x01, 0xe9], [0x0e, 0x65, 0xe5], [0x0f, 0x65, 0xe5],
    [0x1b, 0x68, 0x82], [0x0b, 0, 0, 0x80], [0x0f, 0xf1, 0, 0, 0x80],
    [0x0f, 0xe8, 0x68, 0x80], [0x0f, 0xf0, 0x65, 0xe5],
    [0x0f, 0xe0, 0x41], [0x11, 0x80], [0x0d, 0x0a],
  ];
  for (const prefix of cases) {
    const plain = Uint8Array.from(prefix);
    const expected = decodeScsu(plain);
    for (const mask of [0, 0x5a, 0xff, -1, 0x15a]) {
      const raw = new Uint8Array(1_000_000);
      raw.set(plain.map((b) => b ^ mask));
      const measured = countedBytes(raw, prefix.length * 3);
      assert.deepEqual(decodeTextChars(measured.bytes, expected.length, mask), {
        text: expected.replace(/\r\n?/g, '\n'), end: prefix.length,
      });
    }
  }
  assert.deepEqual(decodeTextChars(countedBytes(new Uint8Array(1_000_000), 0).bytes, 0), { text: '', end: 0 });
});

function varint(n: bigint): number[] {
  const out: number[] = [];
  do {
    const digit = Number(n & 127n);
    n >>= 7n;
    out.push(digit | (n ? 128 : 0));
  } while (n);
  return out;
}

test('AR-fmp12-reader-05', () => {
  const bad = [
    [0x0a, ...Array(160).fill(0x80), 0, 0x10, 1],
    [8, ...Array(10).fill(0x80), 0], [8, ...Array(9).fill(0x80), 2],
    [8, ...varint(2n ** 53n)], [8, ...varint(2n ** 63n - 1n)], [8, ...varint(2n ** 64n - 2n ** 53n - 1n)],
    [...varint(2n ** 32n), 1], [0, 1], [10, ...varint(2n ** 53n)],
    [10, 2, 1], [8, 0x80],
  ];
  for (const b of bad) {
    assert.equal(pbParse(Uint8Array.from(b)), undefined);
    assert.equal(Pb.parse(Uint8Array.from(b)), undefined);
  }
  for (const value of [0n, 127n, 128n, 2n ** 32n, 2n ** 53n - 1n]) {
    assert.equal(Pb.parse(Uint8Array.from([8, ...varint(value)]))?.num(1), Number(value));
  }
  // A field value of 2^63 or more is a negative int64 in two's complement; real layouts hold -1 (ten bytes, 2^64 - 1).
  for (const [value, expected] of [[2n ** 64n - 1n, -1], [2n ** 64n - 2n, -2], [2n ** 64n - 2n ** 53n + 1n, -(2 ** 53) + 1]] as const) {
    assert.equal(Pb.parse(Uint8Array.from([8, ...varint(value)]))?.num(1), expected);
  }
  // Only a field's value may be negative: the same bytes as a length or a tag are refused.
  assert.equal(pbParse(Uint8Array.from([10, ...varint(2n ** 64n - 1n)])), undefined);
  assert.equal(pbParse(Uint8Array.from([...varint(2n ** 64n - 1n), 1])), undefined);
  assert.deepEqual(pbParse(Uint8Array.of(10, 0, 16, 1)), [
    { n: 1, wire: 2, value: new Uint8Array() }, { n: 2, wire: 0, value: 1 },
  ]);
  assert.equal(Pb.parse(Uint8Array.from([...varint(0xfffffff8n), 1]))?.num(0x1fffffff), 1);
});

type Entry = { path: Uint8Array[]; chunk: Chunk; block: number };
function chunkFile(entries: Entry[]): FmpFile {
  return { *chunks(_onError, prefix) {
    for (const entry of entries) {
      if (!prefix || rank(entry.path, prefix.map(encodePathInt)) === 0) yield entry;
    }
  } } as FmpFile;
}

function layoutFile(depth: number, table = false, cycle = false): FmpFile {
  const fields: number[] = [8, 1];
  for (let id = 1; id <= depth; id++) {
    const child = id < depth ? id + 1 : cycle ? 1 : undefined;
    const object = [8, 8, 16, ...varint(BigInt(id)), ...(child ? [48, ...varint(BigInt(child))] : [])];
    fields.push(18, ...varint(BigInt(object.length)), ...object);
  }
  return chunkFile([{
    path: [4, 5, 1, ...(table ? [13] : []), 7].map(encodePathInt),
    chunk: { type: 'segment', index: 1, wide: false, data: Uint8Array.from(fields) }, block: 2,
  }]);
}

boundedTest('AR-fmp12-reader-06', () => {
  for (const table of [false, true]) {
    assert.throws(() => readLayoutDesigns(layoutFile(3000, table)), (error: unknown) => {
      assert.ok(error instanceof FmpError);
      assert.match(error.message, /layout 1.*depth/i);
      return true;
    });
  }
});

boundedTest('AR-fmp12-reader-06-boundary', () => {
  for (const depth of [1, 16, 128]) {
    let objects = readLayoutDesigns(layoutFile(depth)).layouts[0].objects;
    for (let id = 1; id <= depth; id++) {
      assert.equal(objects.length, 1);
      assert.equal(objects[0].id, id);
      objects = objects[0].children ?? [];
    }
    assert.deepEqual(objects, []);
  }
  assert.throws(() => readLayoutDesigns(layoutFile(129)), FmpError);
  assert.equal(readLayoutDesigns(layoutFile(16, false, true)).layouts[0].objects.length, 1);
});

test('AR-fmp12-reader-07', () => {
  const ids = [128, 16512, 1065088, 1077501, 2113663];
  const file = chunkFile(ids.map((id, index) => ({
    path: [...[129, 31, 5, id].map(encodePathInt), Buffer.from('FILE')],
    chunk: { type: 'segment', index: 1, wide: false, data: Uint8Array.of(index + 1) }, block: 2,
  })));
  const blobs = readContainers(file, 129);
  assert.deepEqual([...blobs.keys()], ids);
  for (const [index, id] of ids.entries()) {
    const ref = Buffer.from(encodePathInt(id)).toString('hex') + '\ue000';
    assert.equal(containerRefId(ref), id);
    assert.deepEqual([...blobs.get(containerRefId(ref)!)!.data], [index + 1]);
    assert.deepEqual([...containerBlobs(file, 129, id)].map((b) => b.id), ids.slice(index + 1));
  }
});

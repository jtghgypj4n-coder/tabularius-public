import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { zip, unzip } from '../src/zip.ts';
import { evaluateText } from '../src/index.ts';

test('BE_Unzip caps total expansion when many directory entries share one compressed payload', () => {
  const original = zip([{ name: 'a', data: Buffer.alloc(1024 * 1024) }]);
  const { entries } = directory(original);
  const central = original.slice(entries[0], original.length - 22);
  const count = 21; // 21 MB exceeds the same 20 MB total cap used for plug-in archives.
  const end = Buffer.from(original.slice(-22));
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length * count, 12);
  const archive = Buffer.concat([original.slice(0, entries[0]), ...Array(count).fill(central), end]);
  assert.ok(archive.length < 4096, 'the archive stores only one highly compressed payload');
  let writes = 0;
  const ctx = { files: {
    read: () => archive, size: () => archive.length, write: () => { writes++; return true; },
  } };
  for (const name of ['BE_Unzip', 'BE_Unzip_Deprecated']) {
    assert.equal(evaluateText(`${name} ( "archive.zip" ; "output" )`, ctx), '?');
    assert.match(evaluateText('BE_JSON_Error_Description', ctx), /over 20971520 bytes unpacked/);
  }
  assert.equal(writes, 0, 'reject before writing any entry');
});

function directory(bytes: Uint8Array): { view: DataView; entries: number[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  let at = view.getUint32(end + 16, true);
  const entries: number[] = [];
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    entries.push(at);
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return { view, entries };
}

test('unzip checks the combined declared size before inflating even the first entry', () => {
  const bytes = zip(['a', 'b', 'c'].map((name) => ({ name, data: Buffer.alloc(1000) })));
  // Corrupt the first deflate stream: a reader that inflates before scanning all sizes fails here instead.
  bytes.fill(0xff, 31, 35);
  assert.throws(() => unzip(bytes, { maxTotalBytes: 2999 }), /over 2999 bytes unpacked/);
  assert.throws(() => unzip(bytes), /a has a damaged zip entry/);
});

test('unzip accepts the exact budget, empty files and directory entries', () => {
  const bytes = zip([{ name: 'a', data: Buffer.alloc(10) }, { name: 'b', data: Buffer.alloc(20) }, { name: 'empty', data: Buffer.alloc(0) }, { name: 'dir/', data: Buffer.alloc(0) }]);
  assert.deepEqual(unzip(bytes, { maxTotalBytes: 30 }).map((e) => e.data.length), [10, 20, 0, 0]);
  assert.equal(unzip(zip([{ name: 'empty', data: Buffer.alloc(0) }]), { maxTotalBytes: 0 })[0].data.length, 0);
  assert.throws(() => unzip(bytes, { maxTotalBytes: -1 }), /invalid zip total/);
});

test('lying about uncompressed sizes cannot bypass the inflation limit', () => {
  for (const size of [0, 1, 99, 101]) {
    const bytes = zip([{ name: 'a', data: Buffer.alloc(100) }]);
    const { view, entries } = directory(bytes);
    view.setUint32(entries[0] + 24, size, true);
    assert.throws(() => unzip(bytes, { maxTotalBytes: 101 }), /larger than|incorrect uncompressed size/);
  }
});

test('stored entries count toward the total and must match their declared size', () => {
  const local = Buffer.alloc(31);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(crc32(Buffer.alloc(10)), 14);
  local.writeUInt32LE(10, 18);
  local.writeUInt32LE(10, 22);
  local.writeUInt16LE(1, 26);
  local[30] = 97;
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(crc32(Buffer.alloc(10)), 16);
  central.writeUInt32LE(10, 20);
  central.writeUInt32LE(10, 24);
  central.writeUInt16LE(1, 28);
  central[46] = 97;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(47, 12);
  end.writeUInt32LE(41, 16);
  const bytes = Buffer.concat([local, Buffer.alloc(10), central, end]);
  assert.equal(unzip(bytes, { maxTotalBytes: 10 })[0].data.length, 10);
  assert.throws(() => unzip(bytes, { maxTotalBytes: 9 }), /over 9 bytes/);
  bytes.writeUInt32LE(1, 41 + 24);
  assert.throws(() => unzip(bytes), /incorrect uncompressed size/);
});

test('truncated directories and payloads are rejected before decoding entries', () => {
  for (const change of ['name', 'payload', 'directory', 'zip64']) {
    const bytes = zip([{ name: 'a', data: Buffer.alloc(10) }]);
    const { view, entries } = directory(bytes);
    if (change === 'name') view.setUint16(entries[0] + 28, 65535, true);
    if (change === 'payload') view.setUint32(entries[0] + 20, bytes.length, true);
    if (change === 'directory') view.setUint32(bytes.length - 22 + 12, 1, true);
    if (change === 'zip64') view.setUint32(entries[0] + 24, 0xffffffff, true);
    assert.throws(() => unzip(bytes), /damaged zip|Zip64/);
  }
});

test('a deflated entry that inflates past its declared size is refused by name, not with a buffer error', () => {
  const bytes = zip([{ name: 'big.txt', data: Buffer.alloc(2000, 'a') }]);
  const { view, entries } = directory(bytes);
  view.setUint32(entries[0] + 24, 1, true); // central directory uncompressed size
  view.setUint32(view.getUint32(entries[0] + 42, true) + 22, 1, true); // and the local header's, so only the inflated length disagrees
  assert.throws(() => unzip(bytes), (e: Error) => e.constructor === Error && /^big\.txt has an incorrect uncompressed size$/.test(e.message));
});

test('unzip limits total expansion by default even when no budget is passed', () => {
  const bytes = zip(['a', 'b'].map((name) => ({ name, data: Buffer.alloc(1024) })));
  const { view, entries } = directory(bytes);
  for (const at of entries) {
    view.setUint32(at + 24, 128 * 1024 * 1024 + 1, true);
    view.setUint32(view.getUint32(at + 42, true) + 22, 128 * 1024 * 1024 + 1, true);
  }
  assert.throws(() => unzip(bytes), /zip is over 268435456 bytes unpacked/);
});

test('unzip gives a domain error for a damaged deflate stream and checksum', () => {
  const bytes = zip([{ name: 'a', data: Buffer.alloc(1024) }]);
  bytes.fill(0xff, 31, 35);
  assert.throws(() => unzip(bytes), (e: Error) => e.constructor === Error && /a has a damaged zip entry/.test(e.message));
  const checksum = zip([{ name: 'a', data: Buffer.alloc(1024) }]);
  const { view, entries } = directory(checksum);
  view.setUint32(entries[0] + 16, 0, true);
  view.setUint32(14, 0, true);
  assert.throws(() => unzip(checksum), /a has a damaged zip entry checksum/);
});

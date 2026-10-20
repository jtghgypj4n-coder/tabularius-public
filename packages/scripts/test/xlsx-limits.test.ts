import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../../calc/src/zip.ts';
import { MAX_XLSX_BYTES, readXlsx, xlsx, xlsxSheetNames } from '../src/xlsx.ts';

// Every directory entry points at the same tiny compressed payload, declaring
// one MiB per entry. Duplicate names count toward the 4x directory guard too.
function sharedPayloadArchive(duplicateNames: boolean): Uint8Array {
  const name = 'xl/junk/000.xml';
  const one = Buffer.from(zip([{ name, data: Buffer.alloc(1024 * 1024) }]));
  const directoryAt = one.readUInt32LE(one.length - 6);
  const directory = one.subarray(directoryAt, one.length - 22);
  const count = 4 * MAX_XLSX_BYTES / (1024 * 1024) + 1;
  const entries = Array.from({ length: count }, (_, i) => {
    const entry = Buffer.from(directory);
    if (!duplicateNames) entry.write(`xl/junk/${String(i).padStart(3, '0')}.xml`, 46);
    return entry;
  });
  const end = Buffer.from(one.subarray(one.length - 22));
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length * count, 12);
  const archive = Buffer.concat([one.subarray(0, directoryAt), ...entries, end]);
  // Corrupt the first compressed stream: total-size refusal must precede inflation.
  archive.fill(0xff, 30 + name.length, 34 + name.length);
  return archive;
}

for (const duplicateNames of [false, true]) {
  for (const read of [readXlsx, xlsxSheetNames]) {
    test(`${read.name} caps declared directory sizes for shared payloads with ${duplicateNames ? 'duplicate' : 'distinct'} names`, () => {
      const archive = sharedPayloadArchive(duplicateNames);
      assert.ok(archive.length < 100_000);
      assert.throws(() => read(archive), new RegExp(`declared total over ${4 * MAX_XLSX_BYTES} bytes unpacked`));
    });
  }
}

test('a compressed 150k-row workbook over 50 MiB expanded supports sheet selection and import', () => {
  assert.equal(MAX_XLSX_BYTES, 256 * 1024 * 1024);
  const row = (i: number) => Array.from({ length: 8 }, (_, c) => `row ${i} column ${c}`);
  const bytes = Buffer.from(xlsx(Array.from({ length: 150_000 }, (_, i) => row(i)), 'Large'));
  assert.ok(bytes.length < 50 * 1024 * 1024);
  let expanded = 0;
  for (let at = bytes.readUInt32LE(bytes.length - 6); at < bytes.length - 22;) {
    expanded += bytes.readUInt32LE(at + 24);
    at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  assert.ok(expanded > 50 * 1024 * 1024 && expanded < MAX_XLSX_BYTES, `expanded bytes: ${expanded}`);
  assert.deepEqual(xlsxSheetNames(bytes), ['Large']);
  const rows = readXlsx(bytes);
  assert.equal(rows.length, 150_000);
  assert.deepEqual(rows[0], row(0));
  assert.deepEqual(rows[75_000], row(75_000));
  assert.deepEqual(rows.at(-1), row(149_999));
});

test('archive checks reject unsupported or damaged unread entries before sheet selection', () => {
  const base = Buffer.from(zip([
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>') },
    { name: 'xl/media/unused.bin', data: Buffer.from('unused') },
  ]));
  const end = base.length - 22;
  const first = base.readUInt32LE(end + 16);
  const second = first + 46 + base.readUInt16LE(first + 28) + base.readUInt16LE(first + 30) + base.readUInt16LE(first + 32);
  const cases: [string, (bytes: Buffer) => void, RegExp][] = [
    ['multi-disk EOCD', (bytes) => bytes.writeUInt16LE(1, end + 4), /multi-disk/],
    ['multi-disk entry', (bytes) => bytes.writeUInt16LE(1, second + 34), /multi-disk/],
    ['Zip64 size', (bytes) => bytes.writeUInt32LE(0xffffffff, second + 24), /Zip64/],
    ['encrypted entry', (bytes) => bytes.writeUInt16LE(1, second + 8), /encrypted/],
    ['local size mismatch', (bytes) => bytes.writeUInt32LE(1, bytes.readUInt32LE(second + 42) + 22), /local size mismatch/],
  ];
  for (const [label, corrupt, error] of cases) {
    const bytes = Buffer.from(base);
    corrupt(bytes);
    assert.throws(() => xlsxSheetNames(bytes), error, label);
    assert.throws(() => readXlsx(bytes), error, label);
  }
});

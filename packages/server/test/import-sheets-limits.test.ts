// A workbook that lists many sheets stored in one part (or thousands of sheets) is refused before any sheet is read:
// each listed sheet was read again with its own budget, so a small upload meant millions of rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { unzip, xlsx } from '../../scripts/src/xlsx.ts';
import { sheetsFromFile } from '../src/import-sheets.ts';

function zip(files: Map<string, Uint8Array>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), raw = Buffer.from(data), comp = deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A workbook whose workbook.xml lists `sheets` sheets, each pointing at the relationship of the same index. */
function workbook(sheets: number, targetOf: (i: number) => string): Buffer {
  const files = unzip(xlsx([['name', 'n'], ['a', 1], ['b', 2]] as never));
  const list = Array.from({ length: sheets }, (_, i) => `<sheet name="S${i}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const rels = Array.from({ length: sheets }, (_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="${targetOf(i)}"/>`).join('');
  files.set('xl/workbook.xml', Buffer.from(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list}</sheets></workbook>`));
  files.set('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`));
  return zip(files);
}

test('two sheets stored in one part are refused', () => {
  assert.throws(() => sheetsFromFile('book.xlsx', workbook(2, () => 'worksheets/sheet1.xml')), /same part as another sheet/);
});

test('a workbook that lists more sheets than the limit is refused, whatever they point at', () => {
  assert.throws(() => sheetsFromFile('book.xlsx', workbook(300, (i) => `worksheets/missing${i}.xml`)), /300 sheets/);
});

test('an ordinary workbook is read as before', () => {
  const sheets = sheetsFromFile('book.xlsx', Buffer.from(xlsx([['name', 'n'], ['a', 1], ['b', 2]] as never)));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].rows.length, 3);
});

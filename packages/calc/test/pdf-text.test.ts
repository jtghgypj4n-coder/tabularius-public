import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { NameTable, evaluateText, type CalcContext, type Value } from '../src/index.ts';

/**
 * A PDF of numbered objects (each the text between "n 0 obj" and "endobj"). With `packed` (object number to
 * [object stream, index]) the cross-references are a stream, as compressed files have them; else a classic table.
 */
function pdf(objects: (string | Buffer | null)[], trailer = '', packed?: Record<number, [number, number]>): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: (number | null)[] = [];
  let at = parts[0].length;
  objects.forEach((o, i) => {
    // null: an object kept only in an object stream.
    if (o === null) { offsets.push(null); return; }
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n')]);
    offsets.push(at);
    parts.push(b);
    at += b.length;
  });
  if (packed) {
    const n = objects.length + 1;
    const rows = Buffer.alloc((n + 1) * 7);
    const row = (i: number, type: number, a: number, b: number) => { rows[i * 7] = type; rows.writeUInt32BE(a, i * 7 + 1); rows.writeUInt16BE(b, i * 7 + 5); };
    row(0, 0, 0, 65535);
    offsets.forEach((o, i) => (o === null ? row(i + 1, 2, ...packed[i + 1]) : row(i + 1, 1, o, 0)));
    row(n, 1, at, 0);
    parts.push(Buffer.from(`${n} 0 obj\n`), stream(`/Type /XRef /Size ${n + 1} /W [1 4 2] /Root 1 0 R ${trailer}`, rows), Buffer.from('\nendobj\n'));
    parts.push(Buffer.from(`startxref\n${at}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer}>>\nstartxref\n${at}\n%%EOF\n`));
  return Buffer.concat(parts);
}
function stream(dict: string, data: Buffer | string): Buffer {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${b.length} >>\nstream\n`), b, Buffer.from('\nendstream')]);
}

// Helvetica with WinAnsi: lines set by Td, a word gap in a TJ array, and a second page that inherits its resources.
const simple = pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /Resources << /Font << /F1 4 0 R >> >> >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R >>',
  stream('', 'BT /F1 12 Tf 72 720 Td (This Non-Disclosure Agreement) Tj 0 -14 Td [(Caf\\351 \\223quoted\\224)-300(\\200)(5)] TJ ET'),
  stream('/Filter /FlateDecode', deflateSync('BT /F1 12 Tf 72 720 Td (Page two) Tj ET')),
]);

// A Type0 font whose codes are two bytes, read through its ToUnicode map, with the page and font in a compressed
// object stream, and ActualText standing for a ligature glyph.
const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0001> <0048> <0002> <00690021> endbfchar
1 beginbfrange <0010> <0012> <3072> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;
const objstmObjects = [
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /ToUnicode 6 0 R /DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor << /Type /FontDescriptor /FontName /X /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >> /DW 1000 /W [16 [500 500 500]] >>] >>',
];
const header = `3 0 4 ${objstmObjects[0].length + 1} `;
const compressed = pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  null, // objects 3 and 4 are in the object stream
  null,
  stream('/Filter /FlateDecode', deflateSync('BT /F1 10 Tf 1 0 0 1 72 720 Tm <00010002> Tj ET BT /F1 10 Tf 1 0 0 1 72 700 Tm <001000110012> Tj /Span << /ActualText (ffi) >> BDC <0099> Tj EMC ET')),
  stream('/Filter /FlateDecode', deflateSync(cmap)),
  stream(`/Type /ObjStm /N 2 /First ${header.length} /Filter /FlateDecode`, deflateSync(header + objstmObjects.join('\n'))),
], '', { 3: [7, 0], 4: [7, 1] });

const encrypted = pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  stream('', 'BT /F1 12 Tf (secret) Tj ET'),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>',
], '/Encrypt 6 0 R ');

// A scan: the page only draws an image.
const scan = pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
  stream('', 'q 612 0 0 792 0 0 cm /Im1 Do Q'),
  stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', '\x80'),
]);

const doc = (data: Uint8Array | string, name = 'file.pdf'): Value =>
  ({ type: 'container', value: name, data: typeof data === 'string' ? Buffer.from(data, 'latin1') : data });
const fields: Record<string, Value> = {
  Simple: doc(simple), Compressed: doc(compressed), Encrypted: doc(encrypted), Scan: doc(scan),
  Text: doc('just some text', 'notes.txt'), Empty: { type: 'container', value: '' },
};
const ctx: CalcContext = { names: new NameTable({ fields: Object.keys(fields) }), field: (ref) => fields[ref.field] };
const t = (f: string) => evaluateText(f, ctx);

test('GetTextFromPDF reads each page\'s text, a line at a time', () => {
  assert.equal(t('GetTextFromPDF ( Simple )'), 'This Non-Disclosure Agreement\rCafé “quoted” €5\rPage two');
  // Claris's example: find the contracts that mention an NDA.
  assert.equal(t('PatternCount ( GetTextFromPDF ( Simple ) ; "Non-Disclosure Agreement" )'), '1');
});

test('GetTextFromPDF reads compressed object streams, two-byte fonts through ToUnicode, and ActualText', () => {
  assert.equal(t('GetTextFromPDF ( Compressed )'), 'Hi!\rひびぴffi');
});

test('GetTextFromPDF is "?" for an empty container, another kind of file, an encrypted PDF or one with no text', () => {
  for (const f of ['Empty', 'Text', 'Encrypted', 'Scan']) assert.equal(t(`GetTextFromPDF ( ${f} )`), '?', f);
  assert.equal(t('GetTextFromPDF ( "not a container" )'), '?');
});

test('GetTextFromPDF gives "?" rather than failing on damaged PDFs', () => {
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  for (const base of [simple, compressed]) {
    for (let i = 0; i < 200; i++) {
      const b = Uint8Array.from(base);
      for (let k = 0; k < 10; k++) b[rnd(b.length)] = rnd(256);
      fields.Damaged = doc(i % 2 ? b : b.subarray(0, rnd(b.length)));
      const ctx2: CalcContext = { names: new NameTable({ fields: Object.keys(fields) }), field: (ref) => fields[ref.field] };
      assert.equal(typeof evaluateText('GetTextFromPDF ( Damaged )', ctx2), 'string');
    }
  }
});

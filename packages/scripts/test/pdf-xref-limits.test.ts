import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pdfPageCount } from '@tabularius/calc';
import { appendPdf, pdf, PdfAppendError } from '../src/pdf.ts';

const page = { width: 612, height: 792, ops: [] };
const damaged = (message: RegExp) => (error: unknown) => {
  assert.ok(error instanceof PdfAppendError);
  assert.match(error.message, message);
  return true;
};

/** Generated objects only: all rows name real objects (apart from free object 0). */
function xrefPdf(options: { rows?: number; size?: string; index?: string; widths?: string; data?: Buffer; columns?: number } = {}) {
  const rows = options.rows ?? 4;
  const chunks = [Buffer.from('%PDF-1.5\n')];
  let length = chunks[0].length;
  const data = Buffer.alloc(rows * 7);
  data.writeUInt16BE(65535, 5);
  for (let id = 1; id < rows; id++) {
    data[id * 7] = 1;
    data.writeUInt32BE(length, id * 7 + 1);
    if (id === rows - 1) break;
    const body = id === 1 ? '<< /Type /Catalog /Pages 2 0 R >>'
      : id === 2 ? '<< /Type /Pages /Kids [] /Count 0 >>' : 'null';
    const object = Buffer.from(`${id} 0 obj\n${body}\nendobj\n`);
    chunks.push(object);
    length += object.length;
  }
  let raw = options.data ?? data;
  if (options.columns) {
    assert.equal(raw.length % options.columns, 0);
    const predicted = Buffer.alloc(raw.length + raw.length / options.columns);
    for (let row = 0; row < raw.length / options.columns; row++) {
      raw.copy(predicted, row * (options.columns + 1) + 1, row * options.columns, (row + 1) * options.columns);
    }
    raw = predicted; // PNG None: one filter byte per predictor row.
  }
  const packed = deflateSync(raw);
  chunks.push(Buffer.from(`${rows - 1} 0 obj\n<< /Type /XRef /Size ${options.size ?? rows} /W [${options.widths ?? '1 4 2'}] /Index [${options.index ?? `0 ${rows}`}] /Root 1 0 R /Filter /FlateDecode ${options.columns ? `/DecodeParms << /Predictor 12 /Columns ${options.columns} >> ` : ''}/Length ${packed.length} >>\nstream\n`), packed,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test('append rejects five million xref rows before expanding them into entries', () => {
  const hostile = xrefPdf({ size: '5000000', index: '0 5000000', widths: '0 0 1', data: Buffer.alloc(5_000_000) });
  const started = performance.now();
  assert.throws(() => appendPdf(hostile, [page]), PdfAppendError);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `xref rejection took ${elapsed.toFixed(1)} ms`);
});

test('append sums all Index counts and rejects totals above Size', () => {
  assert.throws(() => appendPdf(xrefPdf({ size: '3', index: '0 2 2 2' }), [page]), damaged(/cross-reference stream is damaged/));
});

test('append rejects invalid Index numbers instead of falling back to Size', () => {
  for (const index of ['0 -1', '0 1.5', '0 Infinity', '0 NaN', '0 1e999', '0 2 2', '-1 4', '0.5 4']) {
    assert.throws(() => appendPdf(xrefPdf({ index }), [page]), PdfAppendError, index);
  }
});

test('append rejects invalid Size numbers and truncated xref data', () => {
  for (const size of ['-1', '3.5', 'Infinity']) assert.throws(() => appendPdf(xrefPdf({ size }), [page]), PdfAppendError, size);
  assert.throws(() => appendPdf(xrefPdf({ data: Buffer.alloc(27) }), [page]), damaged(/cross-reference stream is damaged/));
});

test('xref inflation is limited to declared bytes, including predictor filter bytes', () => {
  for (const columns of [undefined, 1, 7, 14]) {
    const good = xrefPdf({ columns });
    assert.equal(pdfPageCount(Buffer.concat([good, appendPdf(good, [page])])), 1);
    const extra = xrefPdf({ columns, data: Buffer.alloc(56) });
    assert.throws(() => appendPdf(extra, [page]), damaged(/compressed stream is damaged/));
  }
});

test('append accepts 50,000 real xref rows and its own small writer output', () => {
  for (const [original, count] of [[xrefPdf({ rows: 50_000 }), 0], [pdf([page]), 1]] as const) {
    const once = Buffer.concat([original, appendPdf(original, [page])]);
    assert.deepEqual(once.subarray(0, original.length), original);
    assert.equal(pdfPageCount(once), count + 1);
    assert.equal(pdfPageCount(Buffer.concat([once, appendPdf(once, [page])])), count + 2);
  }
});

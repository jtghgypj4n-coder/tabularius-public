// Save Records as PDF [ Append ] reads the cross-reference sections of the file it adds to: a section that claims
// millions of objects, or that inflates to far more than the objects it could list, is refused at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { appendPdf, PdfAppendError } from '../src/pdf.ts';

const page = { width: 100, height: 100, ops: [] };

/** A PDF whose last section is a cross-reference stream with these entries (`data` inflated, `rows` of 7 bytes). */
function xrefStream(dict: string, data: Buffer): Buffer {
  const packed = deflateSync(data);
  return Buffer.concat([
    Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Type /XRef ${dict} /W [1 4 2] /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, 'latin1'),
    packed,
    Buffer.from('\nendstream\nendobj\nstartxref\n9\n%%EOF\n', 'latin1'),
  ]);
}

const refuses = (file: Buffer, why: RegExp) => {
  const started = Date.now();
  assert.throws(() => appendPdf(file, [page]), (e: unknown) => e instanceof PdfAppendError && why.test(e.message), String(why));
  assert.ok(Date.now() - started < 1000, 'refused in a moment');
};

test('a cross-reference stream that lists more objects than its size is refused', () => {
  refuses(xrefStream('/Size 5 /Index [0 3000000]', Buffer.alloc(7 * 3_000_000)), /more objects than its size/);
});

test('a cross-reference stream of more than a million objects is refused, however large it says its size is', () => {
  refuses(xrefStream('/Size 3000000 /Index [0 3000000]', Buffer.alloc(7 * 3_000_000)), /too many objects/);
});

test('a cross-reference stream that inflates to far more than the rows it lists is refused', () => {
  refuses(xrefStream('/Size 3 /Index [0 3]', Buffer.alloc(60 * 1024 * 1024)), /compressed stream is damaged/);
  // Under the cap for a million rows, over what ten rows need.
  refuses(xrefStream('/Size 100000 /Index [0 10]', Buffer.alloc(20 * 1024 * 1024)), /compressed stream is damaged/);
});

test('a classic table that lists more than a million objects is refused', () => {
  const file = Buffer.from(`%PDF-1.4\nxref\n0 3000000\n0000000000 65535 f \ntrailer\n<< /Size 3000000 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n`, 'latin1');
  refuses(file, /too many objects/);
});

/** A PDF of `n` chained cross-reference streams (each /Prev the one before), each listing `rows` objects of its own. */
function chainedXrefStreams(n: number, rows: number): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.5\n', 'latin1')];
  let length = parts[0].length;
  let previous: number | undefined;
  for (let i = 0; i < n; i++) {
    const packed = deflateSync(Buffer.alloc(rows));
    const dict = `<< /Type /XRef /Size ${rows * n} /Index [${i * rows} ${rows}] /W [0 0 1] /Filter /FlateDecode${previous === undefined ? '' : ` /Prev ${previous}`} /Length ${packed.length} >>`;
    const block = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${dict}\nstream\n`, 'latin1'), packed, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    parts.push(block);
    previous = length;
    length += block.length;
  }
  parts.push(Buffer.from(`startxref\n${previous}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

test('chained cross-reference streams share one budget, so splitting a huge list into sections does not get around it', () => {
  // 20 sections of a million objects each is a 23 KB file; 20 of 60,000 is 1.2 million in all. Each passes the per-section checks.
  for (const [sections, rows] of [[20, 1_000_000], [20, 60_000]] as const) {
    const file = chainedXrefStreams(sections, rows);
    assert.ok(file.length < 100 * 1024, `${sections} x ${rows}: ${file.length} bytes`);
    const heap = process.memoryUsage().heapUsed;
    refuses(file, /too many objects/);
    assert.ok(process.memoryUsage().heapUsed - heap < 300 * 1024 * 1024, 'refused without holding the sections in memory');
  }
});

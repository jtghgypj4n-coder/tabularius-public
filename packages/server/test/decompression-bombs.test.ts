// A small file that inflates to gigabytes (a picture in a container, a gzip a script opens) is refused, quickly,
// instead of filling memory or stalling the server. Every bomb here is generated; no sample file is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import { readImage } from '../../scripts/src/pdf.ts';
import { decodePng } from '../src/thumbnails.ts';
import { evaluateText, type CalcContext } from '../../calc/src/index.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const chunk = (kind: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A PNG whose header says width x height, 8-bit, with the given color type, and whose data is `zeros` bytes of zeros. */
function bomb(width: number, height: number, type: number, zeros: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = type;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(zeros))), chunk('IEND', Buffer.alloc(0))]);
}
const quick = (f: () => void) => {
  const t = Date.now();
  f();
  assert.ok(Date.now() - t < 5000, 'refused without grinding through the data');
};

test('PDF: a 1x1 RGBA picture that inflates to 64 MB is left out', () => {
  const b = bomb(1, 1, 6, 64 * 1024 * 1024);
  assert.ok(b.length < 100_000);
  quick(() => assert.equal(readImage(b), undefined));
});

test('PDF: a picture whose header claims 60000x60000 is left out without being read', () => {
  quick(() => assert.equal(readImage(bomb(60000, 60000, 6, 1024)), undefined));
});

test('PDF: an honest picture still works', () => {
  // 2x2 RGBA, each row a filter byte (0) and two pixels.
  const row = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]);
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
  const ok = Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(readImage(ok)?.width, 2);
});

test('Thumbnails: a picture that inflates far past its header is refused', () => {
  const b = bomb(1, 1, 6, 64 * 1024 * 1024);
  quick(() => assert.equal(decodePng(b), undefined));
  quick(() => assert.equal(decodePng(bomb(60000, 60000, 2, 1024)), undefined));
});

test('BE_UnGzip: a gzip that inflates past the limit gives ?', () => {
  const zipped = { type: 'container' as const, value: 'z.gz', data: new Uint8Array(gzipSync(Buffer.alloc(300 * 1024 * 1024), { level: 1 })) };
  const ctx = { field: (r: { field: string }) => (r.field === 'g' ? zipped : undefined) } as unknown as Partial<CalcContext>;
  assert.equal(evaluateText('BE_UnGzip ( g )', ctx), '?');
});

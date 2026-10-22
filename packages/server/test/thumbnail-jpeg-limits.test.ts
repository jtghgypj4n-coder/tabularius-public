// A small crafted JPEG must not make the thumbnail decoder allocate a gigabyte or walk a huge picture thousands of
// times; both are refused, quickly, with no thumbnail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeImage } from '../src/thumbnails.ts';

const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const dht = [...seg(0xc4, [0x00, 1, ...new Array(15).fill(0), 0x00]), ...seg(0xc4, [0x10, 1, ...new Array(15).fill(0), 0x00])];
const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
const sof = (size: number, comps: number) => seg(0xc0, [8, size >> 8, size & 255, size >> 8, size & 255, comps, ...Array.from({ length: comps }, (_, i) => [i + 1, 0x11, 0]).flat()]);
const jpeg = (...parts: number[][]) => Uint8Array.from([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);

function quick<T>(f: () => T, limitMs = 2000): T {
  const t = performance.now();
  const r = f();
  assert.ok(performance.now() - t < limitMs, 'took too long');
  return r;
}

test('a picture that declares 255 components is refused before anything is allocated', () => {
  const before = process.memoryUsage().rss;
  assert.equal(quick(() => decodeImage(jpeg(dqt, sof(15000, 255)))), undefined);
  assert.ok(process.memoryUsage().rss - before < 200_000_000, 'allocated per component');
  for (const n of [0, 2, 5]) assert.equal(decodeImage(jpeg(dqt, sof(64, n))), undefined, `${n} components`);
});

test('a picture with thousands of scans is refused after a few, not decoded once per scan', () => {
  const sos = seg(0xda, [1, 1, 0x00, 0, 63, 0]);
  const evil = jpeg(dqt, sof(15000, 1), dht, ...Array.from({ length: 2000 }, () => sos));
  assert.equal(quick(() => decodeImage(evil), 20_000), undefined);
});

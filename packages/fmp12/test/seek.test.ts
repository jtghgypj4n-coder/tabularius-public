import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodePathInt, FmpFile, fileSource, rank } from '../src/file.ts';
import { pathValue } from '../src/chunks.ts';

const dir = join(import.meta.dirname, '../../../fixtures/fmp12');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.fmp12')) : [];

// Reading one subtree by seeking must give exactly what a full scan filtered to it gives.
test('seeking to a path prefix matches a full scan', { skip: files.length ? false : 'no fixtures (npm run fetch-fixtures)' }, () => {
  for (const name of files) {
    const f = new FmpFile(fileSource(join(dir, name)));
    const sig = (x: { path: Uint8Array[]; chunk: { type: string }; block: number }) =>
      `${x.block}|${x.path.map((s) => Buffer.from(s).toString('hex')).join('.')}|${x.chunk.type}|${JSON.stringify(x.chunk, (k, v) => (k === 'data' || k === 'key' && typeof v === 'object' ? undefined : v))}`;
    const full: { path: Uint8Array[]; s: string }[] = [];
    const prefixes = new Map<string, number[]>();
    for (const x of f.chunks()) {
      full.push({ path: x.path.slice(), s: sig(x) });
      const ints = x.path.slice(0, 2).map(pathValue);
      if (ints[0] !== undefined) prefixes.set(`${ints[0]}`, [ints[0]]);
      if (ints[0] !== undefined && ints[1] !== undefined) prefixes.set(`${ints[0]},${ints[1]}`, [ints[0], ints[1]]);
    }
    for (const pre of prefixes.values()) {
      const enc = pre.map(encodePathInt);
      const want = full.filter((x) => rank(x.path, enc) === 0).map((x) => x.s);
      const got: string[] = [];
      for (const x of f.chunks(undefined, pre)) got.push(sig(x));
      assert.deepEqual(got, want, `${name} ${pre}`);
    }
    f.close();
  }
});

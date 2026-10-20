// Keys the reader has no meaning for must be skipped without changing what it
// reads. A file saved by Pro 26.0.1 carries a 16-byte key 217 on every catalog
// object and an XOR-text key 218 on fields (docs/research/fmp12-format.md). The
// nodes here are built by hand: no fixture and no real file is read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node } from '../src/tree.ts';
import { readFields } from '../src/schema.ts';

// Names are UTF-8 with every byte XORed with 0x5A.
function scsuEncode(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'utf8'), (b) => b ^ 0x5a);
}

function field(name: string, extra: Record<number, Uint8Array> = {}): Node {
  const n = new Node();
  n.kv.set(16, scsuEncode(name));
  n.kv.set(2, Uint8Array.of(1, 1, 0, 0, 0, 0, 0, 0));
  for (const [k, v] of Object.entries(extra)) n.kv.set(Number(k), v);
  return n;
}

function table(extra: Record<number, Uint8Array>): Node {
  const t = new Node();
  t.children.set(1, field('PrimaryKey', extra));
  t.children.set(2, field('Name', extra));
  return t;
}

test('readFields: unknown keys 217 and 218 on fields change nothing that is read', () => {
  const bare = readFields(table({}));
  const noisy = readFields(table({
    217: new Uint8Array(16).fill(0xab),
    218: scsuEncode('#^FMI* #_FMI_0'),
  }));
  assert.deepEqual(bare.map((f) => f.name), ['PrimaryKey', 'Name']);
  assert.deepEqual(noisy, bare);
});

test('readFields: a second 16-byte object id of any content is skipped', () => {
  const base = readFields(table({}));
  for (let seed = 0; seed < 20; seed++) {
    const id = Uint8Array.from({ length: 16 }, (_, i) => (seed * 31 + i * 7) & 0xff);
    assert.deepEqual(readFields(table({ 217: id })), base);
  }
});

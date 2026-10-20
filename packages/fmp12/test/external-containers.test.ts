// Externally stored containers (open storage): the blob keeps the folder
// (REMO) and the name (FNAM), and no data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, readContainerBlob } from '../src/index.ts';

const xor = (s: string) => Buffer.from(Buffer.from(s, 'latin1').map((b) => b ^ 0x5a));

function fnam(kind: string, name: string): Uint8Array {
  const k = xor(kind);
  const n = xor(name);
  const out = Buffer.alloc(4 + 1 + k.length + 2 + n.length);
  out.writeUInt32BE(1, 0);
  out[4] = k.length;
  k.copy(out, 5);
  out.writeUInt16BE(n.length, 5 + k.length);
  n.copy(out, 7 + k.length);
  return out;
}

test('a blob with REMO points at a file stored outside the database', () => {
  const node = new Node();
  const kvlong = (tag: string, data: Uint8Array) => node.add({ type: 'kvlong', key: Buffer.from(tag, 'latin1'), data });
  kvlong('FNAM', fnam('file', 'INV-1042.pdf'));
  // As in a private sample: 8 zero bytes, the folder, NUL.
  kvlong('REMO', Buffer.concat([Buffer.alloc(8), Buffer.from('Invoices/Invoice_Doc/\0', 'latin1')]));
  // Size (u64 LE), a hash, the name on disk: FileMaker numbered it, as a file of that name was there.
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(155360n);
  kvlong('pdf ', Buffer.concat([size, Buffer.alloc(16, 0xab), Buffer.from('INV-1042_1.pdf\0', 'latin1')]));
  const blob = readContainerBlob(7, node);
  assert.equal(blob.external, 'Invoices/Invoice_Doc/INV-1042_1.pdf');
  assert.equal(blob.filename, 'INV-1042.pdf');
  assert.equal(blob.mime, 'application/pdf');
  assert.equal(blob.data.length, 0);
});

test('an embedded blob has no external path', () => {
  const node = new Node();
  node.add({ type: 'kvlong', key: Buffer.from('FNAM', 'latin1'), data: fnam('image', 'logo.png') });
  const blob = readContainerBlob(1, node);
  assert.equal(blob.external, undefined);
});

test('container references are the blob id as a path integer in hex', async () => {
  const { containerRefId } = await import('../src/index.ts');
  assert.equal(containerRefId('01'), 1);
  assert.equal(containerRefId('7F'), 127);
  assert.equal(containerRefId('8000'), 128);
  assert.equal(containerRefId('8102'), 386);
  // A private sample's Invoices::Invoice_Doc values and the blobs they point at.
  assert.equal(containerRefId('C00102'), 16770);
  assert.equal(containerRefId('C0016E'), 16878);
  assert.equal(containerRefId('C0016F'), 16879);
  assert.equal(containerRefId('not a ref'), undefined);
});

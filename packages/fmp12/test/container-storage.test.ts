import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Node } from '../src/tree.ts';
import { readOptions, containerStoragePath } from '../src/schema.ts';
import { FmpDatabase } from '../src/index.ts';

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

// A container field node: its definition (key 2), optional base-directory id
// (key 38) and open-storage path (child 39 key 5), as the reader finds them.
function field(def: string, opts: { dir?: string; path?: string } = {}): Node {
  const n = new Node();
  n.kv.set(2, bytes(def));
  if (opts.dir !== undefined) n.kv.set(38, bytes(opts.dir));
  if (opts.path !== undefined) {
    const c = new Node();
    c.kv.set(5, bytes(opts.path));
    c.kv.set(6, bytes(opts.path));
    n.children.set(39, c);
  }
  return n;
}

// Ground truth dumped from a private sample (a field that stores externally, and a
// plain internal container in the same file) plus Flicks' internal container,
// which keeps a base directory and an open-storage path even though it stores in
// the file — the case that must NOT be read as external.
test('container external storage: read from the field definition', () => {
  // Invoices::Invoice_Doc — open external storage, path "Invoices/Invoice_Doc/".
  // The path is a calculation, so it comes back as a quoted string literal.
  const external = readOptions(
    field('0106000000000015000030000000000000000001000000000001',
      { dir: '00000000', path: '131513342c3533393f297513342c3533393f051e35397500' }),
    bytes('0106000000000015000030000000000000000001000000000001'),
  );
  assert.deepEqual(external?.externalStorage, { directoryId: 0, path: '"Invoices/Invoice_Doc/"' });

  // A short/odd base-directory value must not make directoryId NaN.
  const shortDir = readOptions(
    field('0106000000000015000030000000000000000001000000000001',
      { dir: '00', path: '131513342c3533393f297513342c3533393f051e35397500' }),
    bytes('0106000000000015000030000000000000000001000000000001'),
  );
  assert.equal(shortDir?.externalStorage?.directoryId, 0);

  // A plain internal container in the same file: no base directory, no path.
  const internal = readOptions(
    field('0106000000000000000000000000000000000001000000000001'),
    bytes('0106000000000000000000000000000000000001000000000001'),
  );
  assert.equal(internal?.externalStorage, undefined);

  // Flicks' LIBRARY_CODE::container: INTERNAL (def[10] = 0), yet it carries a base
  // directory and an open-storage path. It must not be read as external.
  const flicks = readOptions(
    field('0106000000000015000000000000000000000001000000000001',
      { dir: '00000000', path: '1317161318081b08030519151e1f753935342e3b33343f287500' }),
    bytes('0106000000000015000000000000000000000001000000000001'),
  );
  assert.equal(flicks?.externalStorage, undefined);
});

test('container open-storage path decodes (XOR 0x5A after a tag and length)', () => {
  const n = new Node();
  n.kv.set(5, bytes('131513342c3533393f297513342c3533393f051e35397500'));
  assert.equal(containerStoragePath(n), 'Invoices/Invoice_Doc/');
  assert.equal(containerStoragePath(undefined), undefined);
  assert.equal(containerStoragePath(new Node()), undefined);
});

test('container path decodes non-ASCII (UTF-8) correctly', () => {
  // "café/" — build [0x13][len][UTF-8 bytes XOR 0x5A] and check it round-trips.
  const utf8 = new TextEncoder().encode('café/');
  const enc = new Uint8Array(2 + utf8.length);
  enc[0] = 0x13;
  enc[1] = utf8.length;
  for (let i = 0; i < utf8.length; i++) enc[2 + i] = utf8[i] ^ 0x5a;
  const n = new Node();
  n.kv.set(5, enc);
  assert.equal(containerStoragePath(n), 'café/');
});

// Against the real file, Flicks' container reads as internal (no externalStorage).
const flicksPath = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
test('Flicks container reads as internal', { skip: existsSync(flicksPath) ? false : 'fixtures missing' }, () => {
  const s = FmpDatabase.open(flicksPath).schema;
  const t = s.tables.find((x) => x.name === 'LIBRARY_CODE')!;
  const c = t.fields.find((x) => x.name === 'container')!;
  assert.equal(c.options?.externalStorage, undefined);
});

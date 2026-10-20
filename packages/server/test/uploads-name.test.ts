import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedName, UploadError } from '../src/uploads.ts';
import { STORE_EXT } from '../src/host.ts';

test('hostedName takes FileMaker file names only', () => {
  assert.equal(hostedName('Contacts.fmp12'), 'Contacts');
  assert.equal(hostedName('C:\\Users\\me\\My Files.FMP12'), 'My Files');
  for (const bad of ['notes.txt', '.fmp12', '.hidden.fmp12', 'a|b.fmp12', 42]) {
    assert.throws(() => hostedName(bad), UploadError, String(bad));
  }
});

test('hostedName reserves room for the SQLite WAL and SHM sidecars', () => {
  const tooLongForWal = `${'a'.repeat(256 - Buffer.byteLength(STORE_EXT + '-wal'))}.fmp12`;
  assert.throws(() => hostedName(tooLongForWal), UploadError);
});

test('hostedName leaves room for every file a hosted file makes beside itself, and refuses names Windows folds together', () => {
  // <name>.openhbam.sqlite.results-wal and <name>.openhbam.sqlite.enc.partial are the longest.
  const room = (suffix: string) => 255 - Buffer.byteLength(STORE_EXT + suffix);
  assert.equal(hostedName(`${'a'.repeat(room('.enc.partial') - 0)}.fmp12`), 'a'.repeat(room('.enc.partial')));
  assert.throws(() => hostedName(`${'a'.repeat(room('.enc.partial') + 1)}.fmp12`), UploadError);
  assert.throws(() => hostedName(`${'a'.repeat(235)}.fmp12`), UploadError);
  assert.equal(hostedName(`${'é'.repeat(50)}.fmp12`), 'é'.repeat(50));
  for (const bad of ['Contacts..fmp12', 'Contacts .fmp12', 'CON .fmp12', 'CON.fmp12', 'COM\u00b9.fmp12', 'COM0.fmp12', 'CONIN$.fmp12', 'lpt3 .x.fmp12']) {
    assert.throws(() => hostedName(bad), UploadError, bad);
  }
  assert.equal(hostedName('Console.fmp12'), 'Console');
});

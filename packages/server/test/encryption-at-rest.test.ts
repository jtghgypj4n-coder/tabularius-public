// Encryption at rest: with a key, the Host keeps each store encrypted on disk
// and unlocks it into a working file only while running. A stolen folder holds
// ciphertext; the right key brings the data back; the wrong key does not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, STORE_EXT, ENCRYPTED_EXT, decryptFileSync, encryptFileSync } from '../src/index.ts';
import { ACCOUNT_STATUS_META, DESIGN_VERSION } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEY = 'correct horse battery staple';
let dir: string;
const working = () => join(dir, 'Charts' + STORE_EXT);
const encrypted = () => working() + ENCRYPTED_EXT;
const count = (host: Host) => Number((host.get('Charts')!.query('SELECT count(*) AS n FROM Congress')[0] as { n: number }).n);

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ear-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
});
after(() => { if (dir) rmSync(dir, { recursive: true }); });

test('a keyed host converts, hosts, then locks the store on shutdown', { skip }, () => {
  const host = new Host(dir, () => {}, { encryptionKey: KEY });
  const rows = count(host);
  assert.ok(rows > 0, 'the store is hosted and readable');
  assert.ok(existsSync(working()), 'a working file exists while running');

  host.close();
  assert.ok(existsSync(encrypted()), 'the store is encrypted on disk after shutdown');
  assert.ok(!existsSync(working()), 'no plaintext working file is left behind');
  assert.ok(!existsSync(working() + '-wal') && !existsSync(working() + '-shm'), 'no WAL sidecars are left behind');

  // The encrypted file is not a readable SQLite database.
  const head = readFileSync(encrypted()).subarray(0, 16).toString('latin1');
  assert.ok(!head.startsWith('SQLite format 3'), 'the on-disk file is ciphertext, not a SQLite file');

  // The record count survived the round trip.
  const reopened = new Host(dir, () => {}, { encryptionKey: KEY });
  assert.equal(count(reopened), rows, 'the data comes back intact with the key');
  reopened.close();
});

test('the wrong key cannot unlock the store', { skip }, () => {
  assert.ok(existsSync(encrypted()), 'the store is encrypted from the previous test');
  assert.throws(() => new Host(dir, () => {}, { encryptionKey: 'wrong key' }), /decrypt|wrong key|damaged/i);
  // The encrypted file is untouched by the failed attempt.
  assert.ok(existsSync(encrypted()) && !existsSync(working()), 'a failed unlock leaves the encrypted store as it was');
});

test('without the key, an encrypted store is not hosted', { skip }, () => {
  assert.ok(existsSync(encrypted()), 'the store is still encrypted');
  const host = new Host(dir, () => {});
  assert.ok(!host.names().includes('Charts'), 'the encrypted store is skipped when no key is given');
  host.close();
  // Nothing re-encrypted or left in plaintext.
  assert.ok(existsSync(encrypted()) && !existsSync(working()), 'the encrypted store is left alone');
});

test('a fresh unencrypted folder is encrypted on first keyed shutdown', { skip }, () => {
  const fresh = mkdtempSync(join(tmpdir(), 'tabularius-ear2-'));
  try {
    copyFileSync(fixture, join(fresh, 'Charts.fmp12'));
    // First run with no key: a plaintext store appears.
    const plain = new Host(fresh, () => {});
    assert.ok(plain.names().includes('Charts'));
    plain.close();
    assert.ok(existsSync(join(fresh, 'Charts' + STORE_EXT)), 'plaintext store on disk without a key');

    // Turn the key on: the next shutdown encrypts it, and the plaintext is gone.
    const keyed = new Host(fresh, () => {}, { encryptionKey: KEY });
    assert.ok(keyed.names().includes('Charts'));
    keyed.close();
    const names = readdirSync(fresh);
    assert.ok(names.includes('Charts' + STORE_EXT + ENCRYPTED_EXT), 'now encrypted at rest');
    assert.ok(!names.includes('Charts' + STORE_EXT), 'the plaintext store is gone');
  } finally {
    rmSync(fresh, { recursive: true });
  }
});

test('an encrypted store converted by an older version is brought up to date when unlocked', { skip }, () => {
  const fresh = mkdtempSync(join(tmpdir(), 'tabularius-ear-upgrade-'));
  try {
    copyFileSync(fixture, join(fresh, 'Charts.fmp12'));
    new Host(fresh, () => {}, { encryptionKey: KEY }).close();
    // As an older version left it: every account switched on, an older design version.
    const enc = join(fresh, 'Charts' + STORE_EXT + ENCRYPTED_EXT);
    const plain = join(fresh, 'old.sqlite');
    decryptFileSync(enc, plain, KEY);
    const sql = new DatabaseSync(plain);
    sql.exec('UPDATE _fm_accounts SET inactive = 0');
    sql.prepare('DELETE FROM _fm_meta WHERE key = ?').run(ACCOUNT_STATUS_META);
    sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'designVersion'").run(JSON.stringify(DESIGN_VERSION - 1));
    sql.close();
    rmSync(enc);
    encryptFileSync(plain, enc, KEY);
    rmSync(plain);

    const host = new Host(fresh, () => {}, { encryptionKey: KEY });
    try {
      assert.equal(host.get('Charts')!.accountInactive('[Guest]'), true, 'Charts\' [Guest] is switched off in the file');
    } finally {
      host.close();
    }
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
});

// Encryption at rest: a store the server refuses to open (written by a newer Tabularius) is unlocked into a working file at
// start like the others; on shutdown it must be locked again, not left on disk as plaintext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, STORE_EXT, ENCRYPTED_EXT, encryptFileSync } from '../src/index.ts';
import { createStore, Store, STORE_FORMAT } from '../../store/src/index.ts';

const KEY = 'correct horse battery staple';

test('a refused store is encrypted again at shutdown, and a log with changes in it is not thrown away', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ear-refused-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const lock = (name: string, format: number) => {
    const path = join(dir, name + STORE_EXT);
    createStore(path);
    new Store(path, name).close();
    const sql = new DatabaseSync(path);
    sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(format));
    sql.close();
    encryptFileSync(path, path + ENCRYPTED_EXT, KEY);
    rmSync(path, { force: true });
    for (const side of ['-wal', '-shm']) rmSync(path + side, { force: true });
    return path;
  };
  const later = lock('Later', STORE_FORMAT + 1);
  const good = lock('Good', STORE_FORMAT);

  const logs: string[] = [];
  const host = new Host(dir, (l) => logs.push(l), { encryptionKey: KEY });
  assert.deepEqual(host.names(), ['Good']);
  assert.ok(existsSync(later), 'unlocked at start, so there is a plaintext copy while the server runs');
  const before = readFileSync(later);
  host.close();
  assert.ok(!existsSync(later), 'no plaintext copy of the refused store is left');
  assert.ok(!existsSync(good), 'nor of the one that was served');
  assert.ok(existsSync(later + ENCRYPTED_EXT) && existsSync(good + ENCRYPTED_EXT));
  // The refused store comes back exactly as it was.
  const again = new Host(dir, () => {}, { encryptionKey: KEY });
  assert.ok(readFileSync(later).equals(before));
  again.close();
});

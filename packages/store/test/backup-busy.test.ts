// An online backup runs on a worker thread while the file keeps taking writes on the main one. SQLite refuses a backup
// step that starts while the source connection is writing, and Node reports that as "not an error" (code 0). The copy
// has to ride that out instead of failing at whichever moment a write happened to be open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('an online backup finishes while the file takes a write on every turn of the event loop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-busy-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  let store: Store | undefined;
  try {
    createStore(path);
    store = new Store(path, 'Shop');
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] }] as never);
    for (let i = 0; i < 3000; i++) store.create('Items', { Value: 'x'.repeat(200) + i });
    for (let n = 0; n < 10; n++) {
      const copy = join(dir, `copy${n}.sqlite`);
      let done = false;
      const backup = store.backup(copy).finally(() => { done = true; });
      for (let k = 0; !done && k < 200; k++) {
        store.create('Items', { Value: `during ${n}.${k}` });
        await new Promise<void>((r) => setImmediate(r));
      }
      await backup;
      const saved = new Store(copy, 'copy');
      try {
        assert.equal(saved.sql.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
        assert.ok(saved.find('Items', { limit: 1 }).records.length === 1);
      } finally { saved.close(); }
    }
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

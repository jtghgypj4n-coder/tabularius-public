import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { decryptFileSync } from '../src/encrypt.ts';
import { Host, STORE_EXT } from '../src/host.ts';

const KEY = 'generated-test-key';

test('the backup made when an older native file is migrated is kept encrypted when the folder is', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-uuid-encrypted-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, `Old${STORE_EXT}`);
  createStore(path, { mode: 'native' });
  const first = new Store(path);
  first.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
  const tableId = first.schema.tables.find((table) => table.name === 'Items')!.id;
  first.create('Items', { Title: 'kept' });
  first.close();
  const sql = new DatabaseSync(path);
  sql.exec(`DROP TRIGGER _fm_uuid_insert_${tableId}; DROP TRIGGER _fm_uuid_update_${tableId}; DROP INDEX _fm_uuid_${tableId}`);
  sql.exec('ALTER TABLE Items DROP COLUMN _fm_uuid');
  sql.close();

  const host = new Host(dir, () => {}, { encryptionKey: KEY });
  host.close();

  const backups = readdirSync(dir).filter((name) => name.includes('.before-native-uuid-'));
  assert.equal(backups.length, 1, backups.join(', '));
  assert.ok(backups[0].endsWith('.enc'), `${backups[0]} is the only copy and must be encrypted`);
  const plain = join(dir, backups[0].slice(0, -'.enc'.length));
  assert.equal(existsSync(plain), false);
  decryptFileSync(join(dir, backups[0]), plain, KEY);
  const backup = new DatabaseSync(plain, { readOnly: true });
  assert.equal((backup.prepare('SELECT count(*) AS n FROM Items').get() as { n: number }).n, 1);
  backup.close();
});

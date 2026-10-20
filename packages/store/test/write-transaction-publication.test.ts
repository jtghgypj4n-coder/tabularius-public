import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

for (const operation of ['create', 'duplicate', 'update'] as const) {
  for (const failCommit of [false, true]) test(`${operation} publishes notifications only after a successful commit (${failCommit ? 'failure' : 'success'})`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-write-publication-'));
    const path = join(dir, 'Test.sqlite');
    createStore(path);
    const store = new Store(path);
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [
      { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } },
      { name: 'Value' },
    ] }]);
    const id = store.create('T', { Value: 'original' }).recordId;
    const observer = new Store(path);
    t.after(() => { observer.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
    const notifications: { inTransaction: boolean; visible: boolean }[] = [];
    store.listeners.add((change) => {
      const row = observer.sql.prepare('SELECT Value FROM T WHERE _fm_record_id = ?').get(change.recordId!);
      notifications.push({ inTransaction: store.sql.isTransaction, visible: row?.Value === (operation === 'duplicate' ? 'original' : 'saved') });
    });
    const failure = new Error('COMMIT failed');
    if (failCommit) {
      const exec = store.sql.exec.bind(store.sql);
      t.mock.method(store.sql, 'exec', (sql: string) => {
        if (sql === 'COMMIT') throw failure;
        return exec(sql);
      });
    }
    const write = () => operation === 'create' ? store.create('T', { Value: 'saved' })
      : operation === 'duplicate' ? store.duplicate('T', id)
      : store.update('T', id, { Value: 'saved' });
    if (failCommit) {
      assert.throws(write, (e: unknown) => e === failure);
      assert.deepEqual(notifications, []);
      assert.equal(store.sql.isTransaction, false);
      assert.equal(observer.recordCount('T'), 1);
      assert.equal(observer.get('T', id).fieldData.Value, 'original');
      assert.equal(store.calc.peekSerial(store.schema.tables[0], store.schema.tables[0].fields[0]), '2');
      t.mock.restoreAll();
    }
    write();
    assert.deepEqual(notifications, [{ inTransaction: false, visible: true }]);
    assert.equal(observer.recordCount('T'), operation === 'update' ? 1 : 2);
    assert.equal(store.calc.peekSerial(store.schema.tables[0], store.schema.tables[0].fields[0]), operation === 'update' ? '2' : '3');
  });
}

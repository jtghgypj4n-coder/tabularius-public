// Exercise the real client's authentication await with a mocked HTTP transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataApiClient } from '../src/fms-sync.ts';
import { applySync, createStore, readSyncLog, Store, type DesignOp, type RemoteRecord, type TableSyncConfig } from '../../store/src/index.ts';

const table: TableSyncConfig = { localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' };
const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] } as DesignOp];

for (const operation of ['create', 'update', 'delete'] as const) {
  test(`review binding refuses a local change after ${operation === 'delete' ? 'preflight' : 'metadata'} before authenticated ${operation} dispatch`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-review-'));
    const path = join(dir, 'Local.sqlite');
    createStore(path);
    const store = new Store(path, 'Local');
    store.applyDesign(design);
    const writes: string[] = [];
    const record: RemoteRecord = { uuid: 'x', recordId: '7', modId: '1', fields: { uuid: 'x', modts: '', Name: 'Original' } };
    let present = true;
    const source = { changedSince: async () => present ? [record] : [], allUuids: async () => new Set(present ? ['x'] : []) };
    t.mock.method(http, 'request', ((url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
      const request = new EventEmitter();
      Object.assign(request, { setTimeout() {}, end() {
        if (options.method === 'PATCH' || options.method === 'POST' && !url.pathname.endsWith('/sessions') || options.method === 'DELETE' && url.pathname.includes('/records/')) writes.push(options.method!);
        queueMicrotask(() => {
          const response = Object.assign(new EventEmitter(), { statusCode: 200 });
          callback(response as http.IncomingMessage);
          const body = url.pathname.endsWith('/sessions') ? { token: 'session' }
            : options.method === 'GET' && url.pathname.endsWith('/records/7') ? { data: [{ recordId: record.recordId, modId: record.modId, fieldData: record.fields }] }
            : options.method === 'GET' ? { fieldMetaData: ['uuid', 'modts', 'Name'].map((name) => ({ name })) }
            : { recordId: '7', modId: '3' };
          response.emit('data', Buffer.from(JSON.stringify({ response: body, messages: [{ code: '0' }] })));
          response.emit('end');
        });
      } });
      return request as http.ClientRequest;
    }) as typeof http.request);
    syncBuiltinESMExports();
    const client = dataApiClient({ server: 'http://127.0.0.1', database: 'Remote', user: 'Admin', password: 'pw', tables: [table] });
    try {
      const local = store.create('Contacts', { uuid: 'x', Name: 'Original' });
      await applySync(store, 'Local', [table], source, client, { write: true });
      store.update('Contacts', local.recordId, { Name: 'Mine' });
      record.fields.Name = 'Theirs'; record.modId = '2';
      if (operation === 'create') present = false;
      if (operation === 'delete') store.delete('Contacts', local.recordId);
      const review = await applySync(store, 'Local', [table], source, client, { write: false });
      const change = () => {
        if (operation === 'delete') store.create('Contacts', { uuid: 'x', Name: 'Restored' });
        else store.update('Contacts', local.recordId, { Name: 'Newest' });
      };
      // The first microtask lets apply resume from metadata/preflight. The second runs
      // inside the client's already-resolved sign-in await, before its HTTP request.
      const schedule = () => queueMicrotask(() => queueMicrotask(change));
      if (operation === 'delete') {
        const read = client.read;
        client.read = (...args) => read(...args).then((record) => { schedule(); return record; });
      } else {
        const fields = client.writableFields;
        client.writableFields = (...args) => fields(...args).then((fields) => { schedule(); return fields; });
      }
      const result = await applySync(store, 'Local', [table], source, client, { write: true, allowDeletes: true, resolutions: [
        { table: 'Contacts', uuid: 'x', keep: 'mine', reviewToken: review.plans[0].conflicts[0].reviewToken! },
      ] });
      assert.match(result.refused ?? '', /changed since it was reviewed/);
      assert.deepEqual(writes, [], 'no record request reaches the transport');
      assert.equal(store.query('SELECT Name FROM Contacts', 1)[0].Name, operation === 'delete' ? 'Restored' : 'Newest');
      assert.equal(readSyncLog(store, { runId: result.runId }).some((row) => row.status === 'attempt'), false);
    } finally {
      await client.close();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

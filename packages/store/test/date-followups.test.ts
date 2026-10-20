import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, PendingApprovalError, Store, StoreError } from '../src/index.ts';

for (const kind of ['create', 'update'] as const) {
  for (const dateOrder of [undefined, 'ISO', 'MDY', 'DMY'] as const) {
    test(`native agent ${kind}, caller order ${dateOrder}: invalid dates are refused before proposing`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'tabularius-date-proposals-'));
      const path = join(dir, 'native.sqlite');
      createStore(path, { mode: 'native' });
      const store = new Store(path);
      try {
        store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }, { name: 'When', type: 'timestamp' }] }]);
        store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'] });
        store.setAgentAccount('bot', 'Bot', { needsApproval: true });
        const opts = { account: 'bot', privileges: store.privileges('bot'), dateOrder };
        const id = store.create('Events', { Day: '2026-10-16' }).recordId;
        const write = (data: Record<string, string>, gated: boolean) => kind === 'create'
          ? store.create('Events', data, gated ? opts : { dateOrder })
          : store.update('Events', id, data, undefined, gated ? opts : { dateOrder });
        for (const data of [{ Day: '10/16/2026' }, { Day: '2026-02-30' }, { When: '10/16/2026 12:30:00' }, { When: '2026-02-30T12:30:00' }] as Record<string, string>[]) {
          let message = '';
          assert.throws(() => write(data, false), (e) => {
            assert.ok(e instanceof StoreError);
            assert.equal(e.code, 500);
            message = e.message;
            if ('When' in data) assert.match(message, /timestamp \(YYYY-MM-DDTHH:MM:SS\)/);
            return true;
          });
          assert.throws(() => write(data, true), (e) => e instanceof StoreError && e.code === 500 && e.message === message);
          assert.deepEqual(store.pendingChanges(), []);
          assert.equal(store.auditLog({ kind: 'agent-change-proposed', security: true }).length, 0);
          assert.deepEqual(store.get('Events', id, 'iso').fieldData, { Day: '2026-10-16', When: '' });
        }
        for (const data of [{ Day: '2024-02-29', When: '2024-02-29 12:30:00' }, { Day: '', When: '' }]) {
          assert.throws(() => write(data, true), PendingApprovalError);
          const [proposal] = store.pendingChanges();
          const result = store.approvePending(proposal.id, 'Admin');
          assert.deepEqual(store.pendingChanges(), []);
          assert.deepEqual(store.get('Events', result.recordId ?? id, 'iso').fieldData,
            { Day: data.Day, When: data.When.replace(' ', 'T') });
        }
      } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
    });
  }
}

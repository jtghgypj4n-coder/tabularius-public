// Reverting one audit entry puts back what it changed, and is itself logged as a revert of that entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, PendingApprovalError, Store, StoreError } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

test('an edit is put back field by field, and the revert says which entry it reverts', { skip }, () => {
  withStore((store) => {
    const { recordId } = store.create('Congress', { Name: 'Ann', State: 'Oregon' }, { account: 'Ann' });
    store.update('Congress', recordId, { Name: 'Anne', State: 'Utah' }, undefined, { account: 'Bob' });
    const edit = store.auditLog({ table: 'Congress', recordId, kind: 'update' })[0];
    const r = store.revertAuditEntry('Congress', recordId, edit.seq, { account: 'Cy', fields: ['State'] });
    assert.deepEqual([r.action, r.fields, r.skipped], ['updated', ['State'], []]);
    const row = store.get('Congress', recordId, 'iso').fieldData;
    assert.deepEqual([row.Name, row.State], ['Anne', 'Oregon']);
    const last = store.auditLog({ table: 'Congress', recordId }).at(-1)!;
    assert.deepEqual([last.account, last.kind, last.revertOf, last.changes], ['Cy', 'update', edit.seq, { State: ['Utah', 'Oregon'] }]);
    // All the entry's fields at once.
    assert.deepEqual(store.revertAuditEntry('Congress', recordId, edit.seq, { account: 'Cy' }).fields, ['Name', 'State']);
    assert.equal(store.get('Congress', recordId, 'iso').fieldData.Name, 'Ann');
    assert.throws(() => store.revertAuditEntry('Congress', recordId + 1, edit.seq, {}), /not a change to this record/);
  });
});

test('a creation reverts by deleting the record, a deletion by making it again under its id', { skip }, () => {
  withStore((store) => {
    const { recordId } = store.create('Congress', { Name: 'Ann', State: 'Oregon' }, { account: 'Ann' });
    const created = store.auditLog({ table: 'Congress', recordId })[0];
    assert.equal(store.revertAuditEntry('Congress', recordId, created.seq, { account: 'Cy' }).action, 'deleted');
    assert.throws(() => store.get('Congress', recordId, 'iso'), /missing/i);
    const deleted = store.auditLog({ table: 'Congress', recordId, kind: 'delete' })[0];
    assert.equal(store.revertAuditEntry('Congress', recordId, deleted.seq, { account: 'Cy' }).action, 'created');
    const back = store.get('Congress', recordId, 'iso').fieldData;
    assert.deepEqual([back.Name, back.State], ['Ann', 'Oregon']);
    assert.equal(store.auditLog({ table: 'Congress', recordId }).at(-1)!.revertOf, deleted.seq);
  });
});

test('values that were not logged, and containers, are skipped and left as they are', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Title', type: 'text' }, { name: 'Pin', type: 'text' }] }] as never);
    store.setAuditSettings({ excludeFields: { Docs: ['Pin'] } });
    const { recordId } = store.create('Docs', { Title: 'a', Pin: '1234' }, { account: 'Ann' });
    store.update('Docs', recordId, { Title: 'b', Pin: '9999' }, undefined, { account: 'Ann' });
    const edit = store.auditLog({ table: 'Docs', recordId, kind: 'update' })[0];
    const r = store.revertAuditEntry('Docs', recordId, edit.seq, { account: 'Ann' });
    assert.deepEqual([r.fields, r.skipped], [['Title'], [{ field: 'Pin', reason: 'its value was not logged' }]]);
    const row = store.get('Docs', recordId, 'iso').fieldData;
    assert.deepEqual([row.Title, row.Pin], ['a', '9999']);
  });
});

test('putting a deleted record back needs what creating it needs: view-only layouts, hidden fields and an agent\'s approval hold', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Title', type: 'text' }, { name: 'Secret', type: 'text' }] }] as never);
    const { recordId } = store.create('Notes', { Title: 'a', Secret: 's' }, { account: 'Ann' });
    store.delete('Notes', recordId, { account: 'Ann' });
    const gone = store.auditLog({ table: 'Notes', recordId, kind: 'delete' })[0];
    const open = { view: true, edit: true, create: true, delete: true };
    const as = (name: string, set: object) => {
      store.savePrivilegeSet({ name, records: { ...open }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: [], ...set } as never);
      store.setPassword(name, 'pw', name);
      return store.privileges(name);
    };
    // A layout the account can only view.
    const viewOnly = as('Viewer', { layoutAccess: { Notes: { layout: 'viewOnly', records: 'viewOnly' } } });
    assert.throws(() => store.revertAuditEntry('Notes', recordId, gone.seq, { account: 'Viewer', privileges: viewOnly }), (e: Error) => e instanceof StoreError);
    // A field it can't write.
    const noSecret = as('NoSecret', { tables: { Notes: { ...open, fields: { Secret: 'none' } } } });
    assert.throws(() => store.revertAuditEntry('Notes', recordId, gone.seq, { account: 'NoSecret', privileges: noSecret }), (e: Error) => e instanceof StoreError);
    assert.equal(store.auditLog({ table: 'Notes', kind: 'create' }).length, 1, 'nothing was put back');
    // A write that needs approval is proposed, not made.
    store.setAgentAccount('bot', 'Viewer', { needsApproval: true });
    assert.throws(() => store.revertAuditEntry('Notes', recordId, gone.seq, { account: 'bot', privileges: as('Open', {}) }), (e: Error) => e instanceof PendingApprovalError);
    assert.equal(store.auditLog({ table: 'Notes', kind: 'create' }).length, 1);
    // The same revert by a plain account with full create rights works.
    assert.equal(store.revertAuditEntry('Notes', recordId, gone.seq, { account: 'Ann' }).action, 'created');
  });
});

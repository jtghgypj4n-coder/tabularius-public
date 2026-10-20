// The audit log says where each record change came from, which script made it, what it copied; and it keeps the
// values of sensitive fields (and fields an administrator names) out of its entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, NOT_LOGGED, Store, writer } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

test('an entry names the surface and the script that made the change', { skip }, () => {
  withStore((store) => {
    const { recordId } = writer.run({ account: 'Ann', surface: 'rest' }, () => store.create('Congress', { Name: 'Ann Example', State: 'Oregon' }));
    writer.run({ account: 'Bob', surface: 'web' }, () => store.update('Congress', recordId, { State: 'Nevada' }));
    writer.run({ account: 'Bob', surface: 'rest', script: 'Tidy States' }, () => store.update('Congress', recordId, { State: 'Utah' }));
    store.delete('Congress', recordId, { account: 'Cy' });
    const log = store.auditLog({ table: 'Congress', recordId });
    assert.deepEqual(log.map((e) => [e.kind, e.surface, e.script]), [
      ['create', 'rest', undefined], ['update', 'web', undefined], ['update', 'rest', 'Tidy States'], ['delete', undefined, undefined]]);
    assert.deepEqual(store.auditLog({ surface: 'WEB' }).map((e) => e.account), ['Bob']);
    assert.deepEqual(store.auditLog({ script: 'tidy states' }).map((e) => e.changes), [{ State: ['Nevada', 'Utah'] }]);
  });
});

test('a duplicate says which record it copied', { skip }, () => {
  withStore((store) => {
    const { recordId } = store.create('Congress', { Name: 'Ann Example', State: 'Oregon' }, { account: 'Ann' });
    const copy = store.duplicate('Congress', recordId, { account: 'Ann' });
    const entry = store.auditLog({ table: 'Congress', recordId: copy.recordId })[0];
    assert.equal(entry.kind, 'create');
    assert.equal(entry.copyOf, recordId);
    assert.equal(store.auditLog({ table: 'Congress', recordId })[0].copyOf, undefined);
  });
});

test('sensitive and excluded fields are logged as changed, never with their values', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Users', fields: [
      { name: 'Name', type: 'text' }, { name: 'Password', type: 'text' }, { name: 'ApiKey', type: 'text' }, { name: 'Notes', type: 'text' }, { name: 'Passenger', type: 'text' },
    ] }] as never);
    store.setAuditSettings({ redactSensitive: true });
    const { recordId } = store.create('Users', { Name: 'Ann', Password: 'hunter2', ApiKey: 'k-123', Notes: 'private', Passenger: 'seat 4' }, { account: 'Ann' });
    store.update('Users', recordId, { Password: 'hunter3', Notes: 'also private', Passenger: 'seat 5' }, undefined, { account: 'Ann' });
    store.setAuditSettings({ excludeFields: { Users: ['notes'] } });
    store.update('Users', recordId, { Notes: 'secret again' }, undefined, { account: 'Ann' });
    const [created, changed, notes] = store.auditLog({ table: 'Users', recordId });
    assert.deepEqual([created.changes!.Password, created.changes!.ApiKey, created.changes!.Notes, created.changes!.Name, created.changes!.Passenger],
      [NOT_LOGGED, NOT_LOGGED, 'private', 'Ann', 'seat 4']);
    assert.deepEqual(changed.changes, { Password: [NOT_LOGGED, NOT_LOGGED], Notes: ['private', 'also private'], Passenger: ['seat 4', 'seat 5'] });
    assert.deepEqual(notes.changes, { Notes: [NOT_LOGGED, NOT_LOGGED] });
    assert.doesNotMatch(JSON.stringify(store.auditLog({ table: 'Users' })), /hunter|k-123|secret again/);
    assert.throws(() => store.setAuditSettings({ excludeFields: { Users: ['Nope'] } }), /Nope/);
    // Putting a record back leaves a field whose old value was not kept as it is.
    const before = store.recordAsOf('Users', recordId, created.seq)!;
    assert.equal(before.Password, 'hunter3');
    assert.equal(before.Notes, 'private');
  });
});

test('values are logged unless sensitive-name redaction is turned on; names that look sensitive are suggested', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Users', fields: [{ name: 'Name', type: 'text' }, { name: 'Password', type: 'text' }, { name: 'CardNumber', type: 'text' }] }] as never);
    const { recordId } = store.create('Users', { Name: 'Ann', Password: 'hunter2' }, { account: 'Ann' });
    assert.equal(store.auditLog({ table: 'Users', recordId })[0].changes!.Password, 'hunter2', 'a value is kept so Undo and revert can put it back');
    assert.deepEqual(store.auditSuggestedExclusions(), { Users: ['Password', 'CardNumber'] });
    store.setAuditSettings({ excludeFields: { Users: ['Password'] } });
    assert.deepEqual(store.auditSuggestedExclusions(), { Users: ['CardNumber'] });
  });
});

test('a container upload is logged by name, size and hash, never its contents', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Title', type: 'text' }, { name: 'File', type: 'container' }] }] as never);
    const { recordId } = store.create('Docs', { Title: 'Spec' }, { account: 'Ann' });
    store.setContainer('Docs', recordId, 'File', 1, { filename: 'spec.txt', mime: 'text/plain', data: new TextEncoder().encode('hello') }, { account: 'Ann' });
    const entry = store.auditLog({ table: 'Docs', recordId, kind: 'update' })[0];
    assert.deepEqual(entry.changes!.File, [null, 'spec.txt (5 bytes, sha256 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824)']);
  });
});

test('an excluded field stays excluded after its table or the field is renamed', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Users', fields: [{ name: 'Name', type: 'text' }, { name: 'Notes', type: 'text' }] }] as never);
    store.setAuditSettings({ excludeFields: { Users: ['Notes'] } });
    store.applyDesign([{ op: 'renameTable', table: 'Users', name: 'People' }] as never);
    assert.deepEqual(store.auditSettings().excludeFields, { People: ['Notes'] });
    store.applyDesign([{ op: 'updateField', table: 'People', field: 'Notes', name: 'Remarks' }] as never);
    assert.deepEqual(store.auditSettings().excludeFields, { People: ['Remarks'] });
    const { recordId } = store.create('Users', { Name: 'Ann', Remarks: 'private' }, { account: 'Ann' });
    assert.doesNotMatch(JSON.stringify(store.auditLog({ table: 'People', recordId })), /private/);
  });
});

test('an excluded field that is deleted stays on the list, so putting it back keeps it out of the log', { skip }, () => {
  withStore((store) => {
    store.applyDesign([{ op: 'createTable', name: 'Users', fields: [{ name: 'Name', type: 'text' }, { name: 'Notes', type: 'text' }] }] as never);
    store.setAuditSettings({ excludeFields: { Users: ['Notes'] } });
    store.applyDesign([{ op: 'deleteField', table: 'Users', field: 'Notes' }] as never);
    // Saving the list the settings page still shows must not fail on the deleted field.
    store.setAuditSettings({ excludeFields: { Users: ['Notes'] }, retentionDays: 30 });
    assert.deepEqual(store.auditSettings().excludeFields, { Users: ['Notes'] });
    // A name that was never excluded and does not exist is still refused.
    assert.throws(() => store.setAuditSettings({ excludeFields: { Users: ['Notes', 'Nope'] } }), /Nope/);
    store.applyDesign([{ op: 'restoreDeleted', deleted: store.deletedDesigns()[0].id }] as never);
    const { recordId } = store.create('Users', { Name: 'Ann', Notes: 'private' }, { account: 'Ann' });
    assert.doesNotMatch(JSON.stringify(store.auditLog({ table: 'Users', recordId })), /private/);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, importFmp12, Store, writer } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('the audit log records who created, changed and deleted which record', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  const store = (() => {
    importFmp12(fixture, join(dir, 'Charts.sqlite'));
    return new Store(join(dir, 'Charts.sqlite'));
  })();
  try {
    const { recordId } = store.create('Congress', { Name: 'Ann Example', State: 'Oregon' }, { account: 'Ann' });
    writer.run({ account: 'Bob' }, () => store.update('Congress', recordId, { State: 'Nevada' }));
    store.update('Congress', recordId, { State: 'Nevada' }, undefined, { account: 'Bob' }); // no change: not logged
    store.delete('Congress', recordId, { account: 'Cy' });

    const log = store.auditLog({ table: 'Congress', recordId });
    assert.deepEqual(log.map((e) => [e.kind, e.account]), [['create', 'Ann'], ['update', 'Bob'], ['delete', 'Cy']]);
    assert.equal(log[0].changes!.Name, 'Ann Example');
    assert.deepEqual(log[1].changes, { State: ['Oregon', 'Nevada'] });
    assert.equal(log[2].changes!.State, 'Nevada', 'a delete keeps what the record held');
    assert.deepEqual(store.auditLog({ account: 'bob' }).map((e) => e.kind), ['update']);
    assert.equal(store.auditLog({ limit: 1 }).length, 1);
    assert.ok(!Number.isNaN(Date.parse(log[0].at)));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('audit time boundaries follow sequence after a backward clock correction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-time-'));
  const path = join(dir, 'audit.sqlite');
  createStore(path);
  const store = new Store(path, 'Audit');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Name', type: 'text' }] }]);
    const ids = ['before', 'crossing', 'corrected', 'later'].map((Name) => store.create('Events', { Name }).recordId);
    const entries = store.auditLog({ table: 'Events', kind: 'create' });
    store.sql.prepare("UPDATE _fm_audit SET at = '2026-10-16T08:00:00.000Z'").run();
    const times = ['2026-10-16T10:00:00.000Z', '2026-10-16T11:00:00.000Z', '2026-10-16T09:00:00.000Z', '2026-10-16T09:30:00.000Z'];
    for (let i = 0; i < entries.length; i++) store.sql.prepare('UPDATE _fm_audit SET at = ? WHERE seq = ?').run(times[i], entries[i].seq);
    assert.deepEqual(store.auditLog({ table: 'Events', kind: 'create', since: '2026-10-16T10:30:00.000Z' }).map((e) => e.recordId), ids.slice(1));
    assert.deepEqual(store.auditLog({ table: 'Events', kind: 'create', until: '2026-10-16T10:30:00.000Z' }).map((e) => e.recordId), ids.slice(0, 1));
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

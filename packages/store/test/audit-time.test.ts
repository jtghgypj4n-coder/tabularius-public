import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('stored audit timestamps stay in UTC when the host zone changes', (t) => {
  const previous = process.env.TZ;
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-time-'));
  const path = join(dir, 'synthetic.sqlite');
  createStore(path);
  const store = new Store(path, 'Synthetic');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Name', type: 'text' }] }] as never);
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-01T05:30:00Z') });
    process.env.TZ = 'America/New_York';
    store.create('Events', { Name: 'First' });
    process.env.TZ = 'Pacific/Honolulu';
    store.create('Events', { Name: 'Second' });
    const entries = store.auditLog({ table: 'Events', kind: 'create' });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.at), ['2026-11-01T05:30:00.000Z', '2026-11-01T05:30:00.000Z']);
    assert.ok(entries[1].seq > entries[0].seq, 'sequence carries creation order when stamps are equal');
  } finally {
    t.mock.timers.reset();
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

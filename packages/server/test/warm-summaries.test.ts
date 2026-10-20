// Warming works out each table's layout summaries ahead of the first read, and
// they are kept in the file's shared results across a restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';

test('after warming, a layout read works out no whole-table summary, even with a table missing here', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-warm-sums-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Rates', fields: [{ name: 'Id', type: 'number' }, { name: 'Factor', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'RateId', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createRelationship', left: 'Lines', right: 'Rates', predicates: [{ left: 'RateId', right: 'Id' }] },
    { op: 'createField', table: 'Lines', name: 'Conv', type: 'number', kind: 'calculation', calculation: 'Total * Rates::Factor', options: { unstored: true } },
    { op: 'createField', table: 'Lines', name: 'sConv', kind: 'summary', summary: { type: 'total', field: 'Conv' } },
    { op: 'createField', table: 'Lines', name: 'sTotal', kind: 'summary', summary: { type: 'total', field: 'Total' } },
  ] as never);
  s.create('Rates', { Id: '1', Factor: '2' });
  for (let i = 1; i <= 50; i++) s.create('Lines', { RateId: '1', Total: String(i) });
  s.applyDesign([{ op: 'createTable', name: 'Ghost', fields: [{ name: 'X', type: 'number' }] }] as never);
  s.close();
  // A table the design has but the file doesn't (counting its records fails): the others still warm.
  const db = new DatabaseSync(path);
  db.exec('DROP TABLE Ghost');
  db.close();
  const host = new Host(dir, () => {}, { shareResults: true });
  try {
    host.add(path);
    const warmer = (host as unknown as { warmer: { idle(): Promise<void>; busy: boolean } }).warmer;
    const until = Date.now() + 10_000;
    while (!warmer.busy && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    await warmer.idle();
  } finally {
    await host.close();
  }
  process.env.TABULARIUS_TRACE_SQL = '1';
  const write = process.stderr.write;
  const notes: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (String(chunk).startsWith('[sum]')) notes.push(String(chunk).trim());
    return true;
  }) as typeof process.stderr.write;
  const reader = new Store(path, 'Shop');
  try {
    reader.shareResults();
    const r = reader.find('Lines', { limit: 1, layoutOnly: true }).records[0].fieldData;
    assert.deepEqual([Number(r.sConv), Number(r.sTotal)], [2550, 1275]);
    assert.deepEqual(notes, [], 'kept from warming, across a restart');
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    reader.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

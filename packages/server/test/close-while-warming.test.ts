// Closing the host while the background warmer is at work waits for it to
// stop: nothing is written into the folder after close, so it can be removed
// at once, and nothing touches a file that has closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';

test('closing mid-warm stops the warmer before the files close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-close-warm-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Total', type: 'number' }] },
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createField', table: 'Orders', name: 'N', type: 'number', kind: 'calculation', calculation: 'Twice ( Twice ( Total ) )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sN', kind: 'summary', summary: { type: 'total', field: 'N' } },
  ] as never);
  s.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  for (let i = 1; i <= 60_000; i++) sql.prepare('INSERT INTO Orders (Total) VALUES (?)').run(i % 10);
  sql.exec('COMMIT');
  sql.close();
  const errors: string[] = [];
  const host = new Host(dir, (m) => errors.push(m), { shareResults: true });
  host.add(path);
  const warmer = (host as unknown as { warmer: { busy: boolean; worker?: import('node:worker_threads').Worker } }).warmer;
  const until = Date.now() + 10_000;
  while (!warmer.busy && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  assert.ok(warmer.busy, 'the warmer is at work');
  let exited = false;
  warmer.worker!.once('exit', () => (exited = true));
  await host.close();
  assert.ok(exited, 'its thread had stopped before the files closed');
  // Removable at once, with nothing written afterwards.
  rmSync(dir, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!existsSync(dir), existsSync(dir) ? readdirSync(dir).join(', ') : '');
  assert.deepEqual(errors.filter((e) => /not open|stopped/i.test(e)), []);
});

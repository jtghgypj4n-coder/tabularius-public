// A Go to Related Record step read from a file has its two options ("Match all records in current found set",
// "Show only related records") unread; a run says so once per script. A step written in script text still matches the
// found set when asked to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

function withStore(check: (store: Store) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-gtrr-unread-'));
  createStore(join(dir, 'G.sqlite'));
  const store = new Store(join(dir, 'G.sqlite'), 'G');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'No', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'No', type: 'number' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'No', right: 'No' }] },
  ] as never);
  for (let i = 1; i <= 3; i++) {
    store.create('Orders', { No: String(i) });
    store.create('Lines', { No: String(i) });
  }
  return check(store).finally(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

const line = (extra: string) => `Go to Layout [ “Orders” ]\nShow All Records\nGo to Related Record [ ${extra}From table: “Lines” ; Using layout: “Lines” ]\nExit Script [ Text Result: Get ( LastError ) & "/" & Get ( FoundCount ) ]`;

test('a step read from a file runs from the current record and warns once per run, naming the script', () =>
  withStore(async (store) => {
    store.applyDesign([{ op: 'createScript', name: 'Jump', text: `${line('')}\n${line('')}`.replace(/\nExit Script[^\n]*(?=\nGo to Layout)/, '') }] as never);
    const script = store.schema.scripts.find((s) => s.name === 'Jump')!;
    for (const step of script.steps) if (step.stepId === 74) step.params = { ...step.params, unreadOptions: ['Match all records in current found set', 'Show only related records'] };
    const run = await runScript(store, script);
    assert.equal(run.result, '0/1');
    const warnings = (run.warnings ?? []).filter((w) => w.startsWith('Go to Related Record'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /script "Jump".*"Match all records in current found set" and "Show only related records".*current record alone/);
  }));

test('a step written in script text raises no warning and still matches the whole found set', () =>
  withStore(async (store) => {
    store.applyDesign([{ op: 'createScript', name: 'Whole', text: line('Match all records in the found set ; ') }] as never);
    const run = await runScript(store, store.schema.scripts.find((s) => s.name === 'Whole')!);
    assert.equal(run.result, '0/3');
    assert.deepEqual((run.warnings ?? []).filter((w) => w.startsWith('Go to Related Record')), []);
  }));

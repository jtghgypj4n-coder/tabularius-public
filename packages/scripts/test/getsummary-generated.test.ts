import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const step = (stepId: number, name: string, params?: ScriptStep['params']): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'summary test', steps } as Script);
const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'Sales' }, field: { id: 0, name } });

// Claris: https://help.claris.com/en/pro-help/content/getsummary.html
test('GetSummary is blank without its break sort and uses the sorted found set when sorted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-getsummary-'));
  const path = join(dir, 'Summary.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Summary');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Sales', fields: [{ name: 'Region', type: 'text' }, { name: 'Amount', type: 'number' }] },
      { op: 'createField', table: 'Sales', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
      { op: 'createField', table: 'Sales', name: 'RunTotal', kind: 'summary', summary: { type: 'total', field: 'Amount', running: true, restartField: 'Region' } },
      { op: 'createField', table: 'Sales', name: 'RunCount', kind: 'summary', summary: { type: 'count', field: 'Amount', running: true, restartField: 'Region' } },
    ] as never);
    const ids = [
      store.create('Sales', { Region: 'B', Amount: '6' }).recordId,
      store.create('Sales', { Region: 'A', Amount: '2' }).recordId,
      store.create('Sales', { Region: 'B', Amount: '8' }).recordId,
      store.create('Sales', { Region: 'A', Amount: '4' }).recordId,
    ];
    const formula = 'GetSummary ( Total ; Region ) & "/" & GetSummary ( Total ; Total )';
    const bare = await runScript(store, script(step(103, 'Exit Script', { calculation: formula })), { layout: 'Sales', foundSet: [ids[1], ids[0], ids[2]], recordId: ids[0] });
    assert.equal(bare.result, '/16');
    const sorted = await runScript(store, script(
      step(39, 'Sort Records', { sort: [{ field: field('Region'), order: 'ascending' }], noDialog: true }),
      step(103, 'Exit Script', { calculation: formula }),
    ), { layout: 'Sales', foundSet: [ids[1], ids[0], ids[2]], recordId: ids[0] });
    assert.equal(sorted.result, '14/16');
    const wrong = await runScript(store, script(
      step(39, 'Sort Records', { sort: [{ field: field('Amount'), order: 'ascending' }], noDialog: true }),
      step(103, 'Exit Script', { calculation: formula }),
    ), { layout: 'Sales', foundSet: [ids[1], ids[0], ids[2]], recordId: ids[0] });
    assert.equal(wrong.result, '/16');
    const running = await runScript(store, script(
      step(39, 'Sort Records', { sort: [{ field: field('Region'), order: 'ascending' }], noDialog: true }),
      step(103, 'Exit Script', { calculation: 'RunTotal & "/" & RunCount' }),
    ), { layout: 'Sales', foundSet: [ids[1], ids[0], ids[2]], recordId: ids[0] });
    assert.equal(running.result, '6/1');
    const last = await runScript(store, script(
      step(39, 'Sort Records', { sort: [{ field: field('Region'), order: 'ascending' }], noDialog: true }),
      step(16, 'Go to Record/Request/Page', { location: 'last' }),
      step(103, 'Exit Script', { calculation: 'RunTotal & "/" & RunCount' }),
    ), { layout: 'Sales', foundSet: [ids[1], ids[0], ids[2]], recordId: ids[0] });
    assert.equal(last.result, '14/2');
    const lower = store.create('Sales', { Region: 'b', Amount: '1' }).recordId;
    const mixedCase = await runScript(store, script(
      step(39, 'Sort Records', { sort: [{ field: field('Region'), order: 'ascending' }], noDialog: true }),
      step(103, 'Exit Script', { calculation: 'GetSummary ( Total ; Region )' }),
    ), { layout: 'Sales', foundSet: [ids[0], ids[2], lower], recordId: ids[0] });
    assert.equal(mixedCase.result, '15', 'text groups follow case-insensitive sort');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

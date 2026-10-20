// Scripts follow comparative relationships (<, ≤, >, ≥, ≠) as portals and calculations do: "Left::a < Right::b"
// relates records where the left value is less than the right one, from either side (Claris help, Relationships
// that use comparative operators). A period selector, FromDate ≤ Sales::Date and ToDate ≥ Sales::Date, reaches the
// sales inside the period by Go to Related Record and by related reads in a script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';

test('Go to Related Record and related reads follow a period selector (≤ and ≥), from either side', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-rel-ops-'));
  createStore(join(dir, 'Shop.sqlite'));
  const store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Periods', fields: [{ name: 'Name', type: 'text' }, { name: 'FromDate', type: 'date' }, { name: 'ToDate', type: 'date' }] },
      { op: 'createTable', name: 'Sales', fields: [{ name: 'Date', type: 'date' }, { name: 'Amount', type: 'number' }, { name: 'Note', type: 'text' }] },
      { op: 'createRelationship', left: 'Periods', right: 'Sales', predicates: [{ left: 'FromDate', right: 'Date', operator: '≤' }, { left: 'ToDate', right: 'Date', operator: '≥' }] },
      { op: 'createScript', name: 'Period total', text: 'Go to Layout [ “Periods” ]\nPerform Find [ Restore ; Find: Periods::Name: “==Q1” ]\nExit Script [ Text Result: Sum ( Sales::Amount ) & "/" & Count ( Sales::Amount ) ]' },
      { op: 'createScript', name: 'Show sales', text: 'Go to Layout [ “Periods” ]\nPerform Find [ Restore ; Find: Periods::Name: “==March” ]\nGo to Related Record [ Show only related records ; From table: “Sales” ; Using layout: “Sales” ]\nExit Script [ Text Result: Get ( FoundCount ) & "/" & Sales::Amount ]' },
      { op: 'createScript', name: 'Sale periods', text: 'Go to Layout [ “Sales” ]\nPerform Find [ Restore ; Find: Sales::Note: “==mid” ]\nExit Script [ Text Result: Substitute ( List ( Periods::Name ) ; ¶ ; "," ) ]' },
      { op: 'createScript', name: 'Late sale periods', text: 'Go to Layout [ “Sales” ]\nPerform Find [ Restore ; Find: Sales::Note: “==late” ]\nGo to Related Record [ Show only related records ; From table: “Periods” ; Using layout: “Periods” ]\nExit Script [ Text Result: Get ( LastError ) ]' },
    ] as never);
    store.create('Periods', { Name: 'March', FromDate: '3/1/2024', ToDate: '3/31/2024' });
    store.create('Periods', { Name: 'Q1', FromDate: '1/1/2024', ToDate: '3/31/2024' });
    store.create('Sales', { Date: '2/15/2024', Amount: '1', Note: 'early' });
    store.create('Sales', { Date: '3/10/2024', Amount: '10', Note: 'mid' });
    store.create('Sales', { Date: '4/2/2024', Amount: '100', Note: 'late' });
    const run = async (name: string) => (await runScript(store, store.schema.scripts.find((s) => s.name === name)!)).result;

    assert.equal(await run('Period total'), '11/2', 'the sales inside Q1');
    assert.equal(await run('Show sales'), '1/10', 'Go to Related Record lands on March\'s one sale');
    assert.equal(await run('Sale periods'), 'March,Q1', 'from the right: the periods containing the sale');
    assert.equal(await run('Late sale periods'), '101', 'a sale outside every period has none');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

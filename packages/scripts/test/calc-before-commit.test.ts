// Calculations see the current window's edits before Commit Records/Requests.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, ScriptDebugger, ScriptSession } from '../src/index.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-calc-edit-'));
  const path = join(dir, 'C.sqlite');
  createStore(path);
  const store = new Store(path, 'C');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [
      { name: 'Amount', type: 'number' }, { name: 'Key' }, { name: 'Note' },
      { name: 'Stored', type: 'number', kind: 'calculation', calculation: 'Amount * 2' },
      { name: 'Live', type: 'number', kind: 'calculation', calculation: 'Amount * 3', options: { unstored: true } },
      { name: 'Nested', type: 'number', kind: 'calculation', calculation: 'Stored + Live', options: { unstored: true } },
    ] },
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Key' }, { name: 'Label' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Customers', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createField', table: 'Orders', name: 'Related', kind: 'calculation', type: 'text', calculation: 'Customers::Label', options: { unstored: true } },
  ] as never);
  store.create('Customers', { Key: 'a', Label: 'Alpha' });
  store.create('Customers', { Key: 'b', Label: 'Beta' });
  const id = store.create('Orders', { Amount: 2, Key: 'a' }).recordId;
  const script = (source: string): Script => ({ id: 1, name: 'Read edits', steps: parseScriptText(source, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params })) } as Script);
  const run = (source: string) => runScript(store, script(source), { layout: 'Orders', foundSet: [id] });
  return { store, path, id, script, run };
}

for (const [name, formula, expected] of [
  ['unstored calculation', 'Orders::Live', '15'],
  ['stored calculation', 'Orders::Stored', '10'],
  ['nested calculation', 'Orders::Nested', '25'],
  ['Evaluate and GetField', 'Evaluate ( "Orders::Live + GetField ( \\"Orders::Stored\\" )" )', '25'],
  ['direct fields and Get', 'GetField ( "Orders::Amount" ) & "/" & Evaluate ( "Orders::Amount" ) & "/" & Get ( RecordOpenState )', '5/5/2'],
] as const) {
  test(`${name} sees Set Field before commit`, async (t) => {
    const { store, id, run } = setup(t);
    const r = await run(`Set Field [ Orders::Amount ; 5 ]\nSet Variable [ $x ; ${formula} ]\nExit Script [ Text Result: $x ]`);
    assert.equal(r.error, 0);
    assert.equal(r.result, expected);
    assert.equal(store.get('Orders', id).fieldData.Amount, 5, 'the run commits only after capturing the result');
  });
}

for (const formula of ['Customers::Label', 'Orders::Related']) {
  test(`${formula} follows an uncommitted relationship key`, async (t) => {
    const { run } = setup(t);
    const r = await run(`Set Field [ Orders::Key ; "b" ]\nSet Variable [ $x ; ${formula} ]\nExit Script [ Text Result: $x ]`);
    assert.equal(r.error, 0);
    assert.equal(r.result, 'Beta');
  });
}

test('a paused edit stays private to its window and session', async (t) => {
  const { store, path, id, script, run } = setup(t);
  const session = new ScriptSession();
  const d = new ScriptDebugger({ breakpoints: [{ script: 'Read edits', index: 1 }] });
  try {
    const s = await d.start(store, script('Set Field [ Orders::Amount ; 5 ]\nExit Script [ Text Result: Orders::Nested ]'), { layout: 'Orders', foundSet: [id], session, startWindow: { id: 'edit', name: 'Edit' } });
    assert.equal(s.paused?.index, 1);
    assert.equal((await run('Exit Script [ Text Result: Orders::Nested ]')).result, '10', 'another script session');
    const otherWindow = await runScript(store, script('Exit Script [ Text Result: Orders::Nested ]'), { layout: 'Orders', foundSet: [id], session, startWindow: { id: 'other', name: 'Other' } });
    assert.equal(otherWindow.result, '10', 'another window in the same session');
    const other = new Store(path, 'C');
    try { assert.equal(other.get('Orders', id).fieldData.Nested, 10, 'another store connection'); }
    finally { other.close(); }
    assert.equal(store.get('Orders', id).fieldData.Nested, 10, 'ordinary store reads');
    assert.equal(d.evaluate('Orders::Nested').value, '25', 'the editing window');
  } finally {
    if (d.running) await d.resume('halt');
  }
});

test('successive edits, undo, redo, revert and commit refresh calculations', async (t) => {
  const { store, id, run } = setup(t);
  const r = await run(`
    Set Field [ Orders::Amount ; 5 ]
    Set Variable [ $a ; Orders::Nested ]
    Set Field [ Orders::Amount ; 7 ]
    Set Variable [ $b ; Orders::Nested ]
    Undo/Redo [ Undo ]
    Set Variable [ $c ; Orders::Nested ]
    Undo/Redo [ Redo ]
    Set Variable [ $d ; Orders::Nested ]
    Revert Record/Request [ With dialog: Off ]
    Set Variable [ $e ; Orders::Nested ]
    Set Field [ Orders::Amount ; 9 ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: $a & "/" & $b & "/" & $c & "/" & $d & "/" & $e & "/" & Orders::Nested & "/" & Get ( RecordOpenState ) ]
  `);
  assert.equal(r.error, 0);
  assert.equal(r.result, '25/35/25/35/10/45/0');
  assert.equal(store.get('Orders', id).fieldData.Stored, 18);
});

test('an unrelated edit preserves a stored calculation with no changed inputs', async (t) => {
  const { store, id, run } = setup(t);
  store.applyDesign([{ op: 'createField', table: 'Orders', name: 'Token', type: 'text', kind: 'calculation', calculation: 'Get ( UUID )' }] as never);
  const token = store.get('Orders', id).fieldData.Token;
  assert.ok(token);
  const r = await run('Set Field [ Orders::Note ; "edited" ]\nSet Field [ Orders::Amount ; 5 ]\nExit Script [ Text Result: Orders::Token & "/" & Orders::Nested ]');
  assert.equal(r.error, 0);
  assert.equal(r.result, `${token}/25`);
});

test('an affected stored UUID stays fixed until its input changes, including commit', async (t) => {
  const { store, id, run } = setup(t);
  store.applyDesign([
    { op: 'createField', table: 'Orders', name: 'Token', type: 'text', kind: 'calculation', calculation: 'Amount & "/" & Get ( UUID )' },
    { op: 'createField', table: 'Orders', name: 'Copy', type: 'text', kind: 'calculation', calculation: 'Token' },
  ] as never);
  const r = await run(`
    Set Field [ Orders::Amount ; 5 ]
    Set Variable [ $a ; Orders::Token ]
    Set Variable [ $b ; Orders::Token ]
    Set Field [ Orders::Note ; "unrelated" ]
    Set Variable [ $c ; Orders::Copy ]
    Set Field [ Orders::Amount ; 7 ]
    Set Field [ Orders::Amount ; 5 ]
    Set Variable [ $d ; Orders::Token ]
    Set Variable [ $e ; Orders::Copy ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: List ( $a ; $b ; $c ; $d ; $e ; Orders::Token ; Orders::Copy ) ]
  `);
  assert.equal(r.error, 0);
  const [a, b, c, d, e, committed, copy] = r.result.split(/\r?\n|\r/);
  assert.match(a, /^5\/[0-9A-F-]{36}$/);
  assert.equal(b, a, 'successive reads');
  assert.equal(c, a, 'an unrelated edit and a dependent stored calculation');
  assert.notEqual(d, a, 'input changes invalidate even without an intervening read');
  assert.equal(e, d);
  assert.equal(committed, d, 'commit reuses the pending result');
  assert.equal(copy, d);
  assert.equal(store.get('Orders', id).fieldData.Token, d);
});

test('self-relationship calculations and aggregates see the edited row by record identity', async (t) => {
  const { store, run } = setup(t);
  store.applyDesign([
    { op: 'createOccurrence', name: 'Self', table: 'Orders' },
    { op: 'createRelationship', left: 'Orders', right: 'Self', predicates: [{ left: 'Key', right: 'Key' }] },
    { op: 'createField', table: 'Orders', name: 'ViaSelf', type: 'number', kind: 'calculation', calculation: 'Self::Stored', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'SelfSum', type: 'number', kind: 'calculation', calculation: 'Sum ( Self::Stored )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'SelfInputs', type: 'number', kind: 'calculation', calculation: 'Sum ( Self::Amount )', options: { unstored: true } },
  ] as never);
  const other = store.create('Orders', { Amount: 3, Key: 'a' }).recordId;
  const r = await run(`
    Set Field [ Orders::Amount ; 5 ]
    Set Variable [ $a ; Orders::Stored & "/" & Self::Stored & "/" & Orders::ViaSelf & "/" & Orders::SelfSum & "/" & Orders::SelfInputs ]
    Revert Record/Request [ With dialog: Off ]
    Exit Script [ Text Result: $a & "/" & Orders::SelfSum ]
  `);
  assert.equal(r.error, 0);
  assert.equal(r.result, '10/10/10/16/8/10');
  assert.equal(store.get('Orders', other).fieldData.Stored, 6, 'other rows retain their stored values');
});

test('stored UUID caches follow undo, redo, revert and limited-account commits', async (t) => {
  const { store, id, script } = setup(t);
  store.applyDesign([{ op: 'createField', table: 'Orders', name: 'Token', type: 'text', kind: 'calculation', calculation: 'Amount & "/" & Get ( UUID )' }] as never);
  store.savePrivilegeSet({
    name: 'Editor', records: { view: true, edit: true, create: false, delete: false },
    layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('editor', 'pw', 'Editor');
  const r = await runScript(store, script(`
    Set Field [ Orders::Amount ; 5 ]
    Set Variable [ $a ; Orders::Token ]
    Set Field [ Orders::Amount ; 5 ]
    Set Variable [ $same ; Orders::Token ]
    Set Field [ Orders::Amount ; 7 ]
    Set Variable [ $b ; Orders::Token ]
    Undo/Redo [ Undo ]
    Set Variable [ $c ; Orders::Token ]
    Set Variable [ $cc ; Orders::Token ]
    Undo/Redo [ Redo ]
    Set Variable [ $d ; Orders::Token ]
    Revert Record/Request [ With dialog: Off ]
    Set Field [ Orders::Amount ; 7 ]
    Set Variable [ $e ; Orders::Token ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: List ( $a ; $same ; $b ; $c ; $cc ; $d ; $e ; Orders::Token ) ]
  `), { layout: 'Orders', foundSet: [id], account: 'editor', privileges: store.privileges('editor') });
  assert.equal(r.error, 0);
  const [a, same, b, c, cc, d, e, committed] = r.result.split(/\r?\n|\r/);
  assert.equal(same, a, 'setting the same input preserves the result');
  assert.match(b, /^7\//);
  assert.match(c, /^5\//);
  assert.notEqual(c, a, 'undo changes the input');
  assert.equal(cc, c);
  assert.notEqual(d, b, 'redo changes the input');
  assert.notEqual(e, d, 'revert discards the edit cache');
  assert.equal(committed, e);
});

test('calculations see edited repetitions and Get ( ActiveFieldContents )', async (t) => {
  const { store, run } = setup(t);
  store.applyDesign([
    { op: 'createField', table: 'Orders', name: 'Parts', type: 'number', options: { repetitions: 3 } },
    { op: 'createField', table: 'Orders', name: 'Total', type: 'number', kind: 'calculation', calculation: 'Parts[1] + Parts[2] + Parts[3]' },
  ] as never);
  const r = await run(`
    Set Field [ Orders::Amount ; 5 ]
    Set Field [ Orders::Parts[1] ; 2 ]
    Set Field [ Orders::Parts[2] ; 5 ]
    Set Field [ Orders::Parts[3] ; 8 ]
    Go to Field [ Orders::Amount ]
    Exit Script [ Text Result: Orders::Total & "/" & Get ( ActiveFieldContents ) ]
  `);
  assert.equal(r.error, 0);
  assert.equal(r.result, '15/5');
});

test('comparative relationships use the edited calculated key', async (t) => {
  const { store, run } = setup(t);
  store.applyDesign([
    { op: 'createTable', name: 'Limits', fields: [{ name: 'Minimum', type: 'number' }, { name: 'Label' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Limits', predicates: [{ left: 'Live', right: 'Minimum', operator: '≥' }] },
    { op: 'createField', table: 'Orders', name: 'Matches', type: 'text', kind: 'calculation', calculation: 'List ( Limits::Label )', options: { unstored: true } },
  ] as never);
  store.create('Limits', { Minimum: 10, Label: 'Ten' });
  store.create('Limits', { Minimum: 20, Label: 'Twenty' });
  const r = await run('Set Field [ Orders::Amount ; 5 ]\nExit Script [ Text Result: Limits::Label & "/" & Orders::Matches ]');
  assert.equal(r.error, 0);
  assert.equal(r.result, 'Ten/Ten');
});

for (const rule of ['record', 'field'] as const) {
  test(`an edited relationship key respects related ${rule} privileges`, async (t) => {
    const { store, id, script } = setup(t);
    store.savePrivilegeSet({
      name: 'Limited', records: { view: true, edit: true, create: false, delete: false },
      tables: { Customers: { view: rule === 'record' ? 'Key = "a"' : true, edit: false, create: false, delete: false, ...(rule === 'field' ? { fields: { Label: 'none' as const } } : {}) } },
      layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
    });
    store.setPassword('reader', 'pw', 'Limited');
    const r = await runScript(store, script('Set Field [ Orders::Key ; "b" ]\nExit Script [ Text Result: Customers::Label & "/" & Orders::Related ]'), { layout: 'Orders', foundSet: [id], account: 'reader', privileges: store.privileges('reader') });
    assert.equal(r.error, 0);
    assert.equal(r.result, '/');
  });
}

test('pending inputs from an elevated subscript do not leak after returning to limited privileges', async (t) => {
  const { store, id, script } = setup(t);
  store.savePrivilegeSet({
    name: 'Limited', records: { view: true, edit: true, create: false, delete: false, fields: { Amount: 'none', Key: 'none' } },
    layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('reader', 'pw', 'Limited');
  const sub = { ...script('Set Field [ Orders::Amount ; 5 ]\nSet Field [ Orders::Key ; "b" ]\nSet Field [ Orders::Note ; "edited" ]'), id: 2, name: 'Edit privately', fullAccess: true };
  store.schema.scripts.push(sub);
  const r = await runScript(store, script(`
    Set Variable [ $before ; Orders::Nested & "/" & Orders::Related ]
    Perform Script [ "Edit privately" ]
    Exit Script [ Text Result: Orders::Amount & Orders::Key & "/" & $before & "/" & Orders::Nested & "/" & Orders::Related & "/" & Orders::Note ]
  `), { layout: 'Orders', foundSet: [id], account: 'reader', privileges: store.privileges('reader') });
  assert.equal(r.error, 0);
  assert.equal(r.result, '/4/Alpha/4/Alpha/edited', 'hidden Amount contributes nothing to the live calculation before or after the subscript');
});

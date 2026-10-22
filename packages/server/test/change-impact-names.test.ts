import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { changeImpact } from '../src/change-impact.ts';
import { scriptDependencies, solutionIndex, type Refs } from '../src/insight.ts';

function generated(t: TestContext): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-name-reads-'));
  const path = join(dir, 'Names.sqlite');
  createStore(path);
  const store = new Store(path, 'Names');
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Congress', fields: [{ name: 'Party' }, { name: 'Name' }] },
    { op: 'createField', table: 'Congress', name: 'Joined', kind: 'calculation', calculation: 'GetField ( "Congress::" & "Party" )' },
    { op: 'createField', table: 'Congress', name: 'Comment', kind: 'calculation', calculation: 'Upper ( Party ) // GetField ( "Party" )' },
    { op: 'createField', table: 'Congress', name: 'Sentence', kind: 'calculation', calculation: 'Case ( 1 ; "GetField ( Party )" )' },
    { op: 'createField', table: 'Congress', name: 'Sentence with reference', kind: 'calculation', calculation: 'Case ( 1 ; "GetField ( Party )" ; Party )' },
    { op: 'createField', table: 'Congress', name: 'Dynamic', kind: 'calculation', calculation: 'GetField ( Name )' },
    { op: 'createField', table: 'Congress', name: 'Computed', kind: 'calculation', calculation: 'GetField ( Upper ( "Party" ) )' },
    { op: 'createField', table: 'Congress', name: 'Bound', kind: 'calculation', calculation: 'Let ( f = "Congress::Par" & "ty" ; GetField ( f ) )' },
    { op: 'createField', table: 'Congress', name: 'Boundary', kind: 'calculation', calculation: 'GetField ( "PartyExtra" )' },
    { op: 'createScript', name: 'By name', text: 'Set Field By Name [ "Congress::Par" & "ty" ; "value" ]' },
    { op: 'createScript', name: 'By id', text: 'Set Variable [ $v ; Value: Congress::Party & "GetField ( Congress::Party )" ]' },
    { op: 'createScript', name: 'Mixed', text: 'Set Variable [ $v ; Value: Congress::Name & GetField ( "Congress::Party" ) ]' },
  ]);
  return store;
}

test('rename impact reads parsed names and distinguishes computed names from id references', async (t) => {
  const store = generated(t);
  const report = await changeImpact(store, undefined, 'field', 'Party', 'rename');
  const at = (field: string) => report.uses.find((u) => u.where === `Field Congress::${field} (calculation)`)!;
  for (const field of ['Joined', 'Bound']) {
    assert.equal(at(field)?.breaks, true, field);
    assert.equal(at(field).why, 'It names it in text, which a rename doesn\'t change.');
  }
  for (const field of ['Comment', 'Sentence with reference']) {
    assert.equal(at(field)?.breaks, false, field);
    assert.equal(at(field).why, 'It refers to it by id and follows the rename.');
  }
  assert.equal(at('Sentence'), undefined, 'a sentence alone is not a field reference');
  assert.equal(at('Boundary'), undefined, 'whole names only');
  for (const field of ['Dynamic', 'Computed']) {
    assert.equal(at(field)?.breaks, true);
    assert.match(at(field).why, /may name it in text/);
  }
  assert.ok(report.uses.some((u) => u.where.startsWith('Script "By name"') && u.breaks && /names it in text/.test(u.why)));
});

test('delete impact retains certain uses and warns about unknown names', async (t) => {
  const store = generated(t);
  const report = await changeImpact(store, undefined, 'field', 'Party', 'delete');
  for (const field of ['Joined', 'Comment', 'Sentence with reference', 'Bound', 'Dynamic']) {
    const use = report.uses.find((u) => u.where === `Field Congress::${field} (calculation)`);
    assert.equal(use?.breaks, true, field);
    if (field === 'Dynamic') assert.match(use!.why, /may name it in text/);
  }
  assert.ok(!report.uses.some((u) => u.where === 'Field Congress::Sentence (calculation)'));
});

test('script dependencies use folded texts and ignore sentences in display text', (t) => {
  const store = generated(t);
  const deps = (name: string) => scriptDependencies(store, store.schema.scripts.find((s) => s.name === name)!.id)!;
  assert.deepEqual(deps('By name').uses.find((u) => u.kind === 'field'), {
    kind: 'field', name: 'Congress::Party', lines: [1], byName: true,
  });
  assert.equal(deps('By id').uses.find((u) => u.kind === 'field')?.byName, undefined);
  assert.equal(deps('Mixed').uses.find((u) => u.name === 'Congress::Name')?.byName, undefined,
    'a direct reference on the same line still follows a rename');
  assert.equal(deps('Mixed').uses.find((u) => u.name === 'Congress::Party')?.byName, true);
});

test('the index merges parsed formulas, keeps query literals and bounds long chains', (t) => {
  const store = generated(t);
  const cat = solutionIndex(store).catalog;
  const refs: Refs = { fields: new Set(), occurrences: new Set(), tables: new Set(), scripts: new Set(), layouts: new Set(), functions: new Set(), valueLists: new Set() };
  cat.formula('Upper ( Congress::Party ) // GetField ( "Party" )', refs);
  cat.formula('Case ( 1 ; "Evaluate ( Party )" )', refs);
  assert.equal(refs.byName, undefined);
  cat.formula('GetField ( "Congress::Par" & "ty" )', refs);
  cat.formula('Evaluate ( "Congress::Name" )', refs);
  assert.deepEqual([...refs.byName!.calls], ['getfield', 'evaluate']);
  assert.ok(refs.byName!.texts.includes('Congress::Party'));
  assert.ok(refs.byName!.texts.includes('Congress::Name'));
  assert.equal(refs.byName!.fromText, undefined);
  cat.formula('"SELECT Party FROM Congress"', refs);
  assert.ok(refs.byName!.texts.includes('SELECT Party FROM Congress'));
  assert.ok(refs.fields.has('Congress::Party'));
  cat.formula(`GetField ( ${Array(5000).fill('"abcdefghijklmnop"').join(' & ')} )`, refs);
  assert.equal(refs.byName!.incomplete, true);
  assert.equal(refs.byName!.fromText, undefined, 'long parsed formulas do not fall back to text');
});

test('name slots, SQL literals and all target kinds use indexed text', async (t) => {
  const store = generated(t);
  store.applyDesign([
    { op: 'createValueList', name: 'Choices', values: ['A', 'B'] },
    { op: 'createField', table: 'Congress', name: 'Query', kind: 'calculation', calculation: 'ExecuteSQL ( "SELECT Par" & "ty FROM Congress" ; "" ; "" )' },
    { op: 'createField', table: 'Congress', name: 'Query literal', kind: 'calculation', calculation: '"SELECT Party FROM Congress"' },
    { op: 'createField', table: 'Congress', name: 'Query comment', kind: 'calculation', calculation: 'Upper ( Name ) // SELECT Party FROM Congress' },
    { op: 'createField', table: 'Congress', name: 'List', kind: 'calculation', calculation: 'ValueListItems ( "" ; "Choi" & "ces" )' },
    { op: 'createScript', name: 'Name slots', text: 'Go to Layout [ Layout Name: "Con" & "gress" ]\nPerform Script [ Specified: By name ; "By " & "id" ]' },
  ]);
  const sites = solutionIndex(store).sites;
  for (const site of sites.filter((s) => s.where.startsWith('Script "Name slots"'))) {
    assert.equal(site.refs.byName?.byConstruction, true);
    assert.equal(site.refs.byName?.calls.size, 0, 'slot analysis does not invent function calls');
    assert.equal(site.refs.byName?.incomplete, undefined);
  }
  for (const [kind, name, where] of [
    ['field', 'Party', 'Field Congress::Query (calculation)'],
    ['field', 'Party', 'Field Congress::Query literal (calculation)'],
    ['table', 'Congress', 'Field Congress::Query (calculation)'],
    ['valueList', 'Choices', 'Field Congress::List (calculation)'],
    ['layout', 'Congress', 'Script "Name slots", line 1'],
    ['script', 'By id', 'Script "Name slots", line 2'],
  ] as const) {
    const report = await changeImpact(store, undefined, kind, name, 'rename');
    const use = report.uses.find((u) => u.where === where);
    assert.equal(use?.breaks, true, where);
    assert.match(use!.why, /^It names it in text/);
    assert.ok(!report.uses.some((u) => u.where === 'Field Congress::Query comment (calculation)' && u.breaks));
  }
});

test('validation sites sharing a display location retain their formula name reads', async (t) => {
  const store = generated(t);
  store.applyDesign([{ op: 'createValueList', name: 'Checks', values: ['A'] }]);
  const valueList = store.schema.valueLists.find((v) => v.name === 'Checks')!.id;
  store.applyDesign([{ op: 'updateField', table: 'Congress', field: 'Name', options: {
    validation: { calculation: 'Party & GetField ( "Party" )', valueList },
  } }]);
  const report = await changeImpact(store, undefined, 'field', 'Party', 'rename');
  const use = report.uses.find((u) => u.where === 'Field Congress::Name (validation)');
  assert.equal(use?.breaks, true);
  assert.equal(use.why, 'It names it in text, which a rename doesn\'t change.');
});

test('unparseable editor formulas retain an explicit text fallback and warn conservatively', async (t) => {
  const store = generated(t);
  // An editor can retain invalid source; this is generated schema, not an imported file.
  store.schema.tables[0].fields.find((f) => f.name === 'Joined')!.calculation = 'GetField ( "Congress::Party"';
  const index = solutionIndex(store);
  const refs: Refs = { fields: new Set(), occurrences: new Set(), tables: new Set(), scripts: new Set(), layouts: new Set(), functions: new Set(), valueLists: new Set() };
  index.catalog.formula('GetField ( "Congress::Party"', refs);
  assert.ok('unparsed' in refs);
  assert.equal(refs.byName?.fromText, true);
  assert.deepEqual(refs.byName.texts, ['Congress::Party']);
  assert.deepEqual([...refs.byName.calls], ['getfield']);
  const report = await changeImpact(store, undefined, 'field', 'Party', 'rename');
  const use = report.uses.find((u) => u.where === 'Field Congress::Joined (calculation)')!;
  assert.equal(use.breaks, true);
  assert.match(use.why, /may name it in text|could not be parsed/i);
});

import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type FieldType, type Script, type ScriptStep } from '@tabularius/fmp12';
import { createStore, designSnippet, parseScriptText, snippetChanges, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-sortvl-'));
  const path = join(dir, 'Tasks.sqlite');
  createStore(path);
  const store = new Store(path, 'Tasks');
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true });
  });
  store.applyDesign([
    { op: 'createTable', name: 'Tasks', fields: [{ name: 'Name' }, { name: 'Priority' }, { name: 'Group' }, { name: 'Rank', type: 'number' }] },
    { op: 'createTable', name: 'Codes', fields: [{ name: 'Priority' }, { name: 'Group' }, { name: 'Rank', type: 'number' }] },
    { op: 'createRelationship', left: 'Tasks', right: 'Codes', predicates: [{ left: 'Group', right: 'Group' }] },
    { op: 'createValueList', name: 'Priorities', values: ['High', 'Medium', 'Low', 'HIGH'] },
    { op: 'createValueList', name: 'From field', field: { occurrence: 'Codes', field: 'Priority', second: 'Rank', sortBySecond: true } },
    { op: 'createValueList', name: 'Related', field: { occurrence: 'Codes', field: 'Priority', related: 'Tasks' } },
  ]);
  for (const [Name, Priority, Rank, Group] of [
    ['low', 'Low', '1', 'A'], ['z', 'Zulu', '1', 'A'], ['hi-a', 'HIGH', '1', 'A'],
    ['blank', '', '2', 'A'], ['med', 'Medium', '1', 'A'], ['other', 'Alpha', '1', 'A'],
    ['hi-z', 'High', '3', 'A'], ['hi-b', 'high', '2', 'B'],
  ]) store.create('Tasks', { Name, Priority, Rank, Group });
  for (const [Priority, Rank, Group] of [['Low', '30', 'A'], ['High', '10', 'B'], ['Medium', '20', 'A']]) store.create('Codes', { Priority, Rank, Group });
  const parsed = (text: string): ScriptStep[] => parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
  const run = async (steps: string | ScriptStep[], opts: RunOptions = {}) => {
    const r = await runScript(store, { id: 9999, name: 'sort', steps: typeof steps === 'string' ? parsed(steps) : steps } as Script, { layout: 'Tasks', ...opts });
    assert.equal(r.error, 0);
    return { result: r, names: r.foundSet!.map((id) => store.get(opts.layout ?? 'Tasks', id).fieldData.Name) };
  };
  return { store, parsed, run };
}

const sort = (list = 'Priorities', second = '') => `Sort Records [ Restore; Tasks::Priority; custom; Value list: “${list}”${second}; With dialog: Off ]`;
const expected = ['hi-a', 'hi-z', 'hi-b', 'med', 'low', 'other', 'z', 'blank'];

test('Sort Records follows custom values, then unlisted values in normal order; the list survives text editing', async (t) => {
  const { store, parsed, run } = setup(t);
  const [step] = parsed(sort('priorities'));
  assert.deepEqual(step.params!.sort![0].valueList, { id: store.schema.valueLists[0].id, name: 'Priorities' });
  assert.deepEqual(parsed(stepLine(step.name, step.params))[0].params, step.params);
  const { names, result } = await run([step]);
  assert.deepEqual(names, expected);
  assert.deepEqual(result.sort, [{ fieldName: 'Priority', sortOrder: 'Priorities' }]);
});

test('a copied custom sort keeps its value list and executes in business order', async (t) => {
  const { store, parsed, run } = setup(t);
  const step = parsed(sort())[0];
  store.applyDesign([{ op: 'createScript', name: 'Source sort', steps: [step] }]);
  const source = store.schema.scripts.find((s) => s.name === 'Source sort')!;
  const xml = designSnippet(store.schema, { steps: { script: source.id, indexes: [0] } }).xml;
  const pasted = snippetChanges(xml, store.schema).changes.find((change) => change.op === 'createScript');
  assert.ok(pasted && pasted.op === 'createScript');
  const copied = pasted.steps![0] as ScriptStep;
  assert.equal(copied.params?.sort?.[0].valueList?.name, 'Priorities');
  const { names } = await run([copied]);
  assert.deepEqual(names, expected);
});

test('a copied custom sort with an unresolved list returns value-list error 108', async (t) => {
  const { store } = setup(t);
  const xml = '<fmxmlsnippet type="FMObjectList"><Step enable="True" id="39" name="Sort Records"><Restore state="True"/><SortList><Sort type="Custom"><PrimaryField><Field table="Tasks" name="Priority"/></PrimaryField><ValueList id="1" name="Missing"/></Sort></SortList></Step></fmxmlsnippet>';
  const pasted = snippetChanges(xml, store.schema).changes.find((change) => change.op === 'createScript');
  assert.ok(pasted && pasted.op === 'createScript');
  const copied = pasted.steps![0] as ScriptStep;
  const result = await runScript(store, { id: 9999, name: 'missing list', steps: [copied] } as Script, { layout: 'Tasks' });
  assert.equal(result.error, 108);
});

test('a hidden value list returns 108 through both script sort paths', async (t) => {
  const { store, parsed } = setup(t);
  store.savePrivilegeSet({
    name: 'No Lists', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('No Lists', 'pw', 'No Lists');
  for (const second of ['', '; Codes::Rank; ascending']) {
    const steps = parsed(sort('Priorities', second));
    const result = await runScript(store, { id: 9999, name: 'hidden list', steps } as Script, {
      layout: 'Tasks', account: 'No Lists', privileges: store.privileges('No Lists'),
    });
    assert.equal(result.error, 108, second ? 'engine comparator' : 'store sorter');
    const captured = parsed(`Set Error Capture [ On ]\n${sort('Priorities', second)}\nExit Script [ Text Result: Get ( LastError ) ]`);
    const observed = await runScript(store, { id: 9999, name: 'capture hidden list', steps: captured } as Script, {
      layout: 'Tasks', account: 'No Lists', privileges: store.privileges('No Lists'),
    });
    assert.equal(observed.result, '108', `Get ( LastError ): ${second ? 'engine comparator' : 'store sorter'}`);
  }
});

function valuesScript(t: TestContext, type: FieldType, values: string[], rows: string[], japanese = false) {
  const { store, run } = setup(t);
  store.applyDesign([
    { op: 'createTable', name: 'Values', fields: [{ name: 'Name' }, { name: 'Group' }, { name: 'Value', type, ...(japanese ? { options: { indexLanguage: 'Japanese' } } : {}) }] },
    { op: 'createTable', name: 'Peers', fields: [{ name: 'Group' }, { name: 'Tie', type: 'number' }] },
    { op: 'createRelationship', left: 'Values', right: 'Peers', predicates: [{ left: 'Group', right: 'Group' }] },
    { op: 'createValueList', name: 'Order', values },
    { op: 'createValueList', name: 'Empty', values: [] },
  ]);
  for (const Value of rows) store.create('Values', { Name: Value, Value, Group: '1' });
  store.create('Peers', { Group: '1', Tie: 1 });
  // A related second key forces the engine comparator instead of the store's SQL sort.
  const check = async (expected: string[], list = 'Order') => {
    for (const second of ['', '; Peers::Tie; descending']) {
      const { names } = await run(`Sort Records [ Restore; Values::Value; custom; Value list: “${list}”${second}; With dialog: Off ]`, { layout: 'Values' });
      assert.deepEqual(names, expected, second ? 'engine comparator' : 'store SQL sorter');
    }
  };
  return { store, run, check };
}

test('both script sort paths match normalized numbers and dates', async (t) => {
  const numbers = valuesScript(t, 'number', ['10.0', '2', '010'], ['2', '10']);
  await numbers.check(['10', '2']);
  const dates = valuesScript(t, 'date', ['12/31/2026', '1/1/2026', '2026-12-31'], ['1/1/2026', '12/31/2026']);
  await dates.check(['12/31/2026', '1/1/2026']);
});

test('both script sort paths share Unicode matching and keep the first equivalent list entry', async (t) => {
  const { check } = valuesScript(t, 'text', ['Éclair', 'ΚΑΦΕ', 'zebra', 'éCLAIR', 'καφε'], ['zebra', 'éclair', 'ÉCLAIR', 'Banana', 'καφε', 'ΚΑΦΕ']);
  await check(['éclair', 'ÉCLAIR', 'καφε', 'ΚΑΦΕ', 'zebra', 'Banana']);
});

test('both script sort paths alphabetize formatted unlisted numbers and dates, including empty lists', async (t) => {
  const numbers = valuesScript(t, 'number', ['1'], ['2', '1', '10']);
  await numbers.check(['1', '10', '2']);
  await numbers.check(['1', '10', '2'], 'Empty');
  const dates = valuesScript(t, 'date', ['7/1/2026'], ['2/1/2026', '12/31/2026', '7/1/2026', '10/1/2026']);
  await dates.check(['7/1/2026', '10/1/2026', '12/31/2026', '2/1/2026']);
  await dates.check(['10/1/2026', '12/31/2026', '2/1/2026', '7/1/2026'], 'Empty');
  for (const second of ['', '; Peers::Tie; descending']) {
    assert.deepEqual((await numbers.run(`Sort Records [ Restore; Values::Value; ascending${second}; With dialog: Off ]`, { layout: 'Values' })).names, ['1', '2', '10']);
    assert.deepEqual((await dates.run(`Sort Records [ Restore; Values::Value; ascending${second}; With dialog: Off ]`, { layout: 'Values' })).names, ['2/1/2026', '7/1/2026', '10/1/2026', '12/31/2026']);
  }
});

test('both script sort paths use the field\'s collation for matching and alphabetical fallback', async (t) => {
  const { check } = valuesScript(t, 'text', ['カキ', '自費', 'かき'], ['処方', 'かき', '自費', 'あいう'], true);
  await check(['かき', '自費', 'あいう', '処方']);
  await check(['あいう', 'かき', '自費', '処方'], 'Empty');
});

test('a related second key does not change custom ranks beyond 2000 entries or after many duplicates', async (t) => {
  const values = [...Array<string>(2200).fill('First'), ...Array.from({ length: 3000 }, (_, i) => `v${String(2999 - i).padStart(4, '0')}`)];
  const { check } = valuesScript(t, 'text', values, ['v0001', 'Other', 'v2500', 'v2999', 'First']);
  await check(['First', 'v2999', 'v2500', 'v0001', 'Other']);
});

test('a structured custom sort resolves its list by id when its name is absent', async (t) => {
  const { store, parsed, run } = setup(t);
  const [step] = parsed(sort());
  step.params!.sort![0].valueList = { id: store.schema.valueLists[0].id, name: '' };
  assert.deepEqual((await run([step])).names, expected);
});

test('Sort Records resolves field-based lists using entered values and the second field order', async (t) => {
  const { run } = setup(t);
  assert.deepEqual((await run(sort('From field'))).names, expected);
});

test('custom order combines with ascending and descending second keys', async (t) => {
  const { run } = setup(t);
  assert.deepEqual((await run(sort('Priorities', '; Tasks::Rank; ascending'))).names, ['hi-a', 'hi-b', 'hi-z', 'med', 'low', 'other', 'z', 'blank']);
  assert.deepEqual((await run(sort('Priorities', '; Tasks::Rank; descending'))).names, ['hi-z', 'hi-b', 'hi-a', 'med', 'low', 'other', 'z', 'blank']);
});

test('a related value list uses the current record, including after moving to another record', async (t) => {
  const { run } = setup(t);
  assert.deepEqual((await run(sort('Related'))).names, ['low', 'med', 'other', 'hi-a', 'hi-z', 'hi-b', 'z', 'blank']);
  assert.deepEqual((await run(`Go to Record/Request/Page [ Last ]\n${sort('Related')}`)).names, ['hi-a', 'hi-z', 'hi-b', 'other', 'low', 'med', 'z', 'blank']);
});

test('custom ordering also applies when a sort field is related', async (t) => {
  const { run } = setup(t);
  // Codes::Priority is Low for group A, High for group B.
  assert.deepEqual((await run('Sort Records [ Restore; Codes::Priority; custom; Value list: “Priorities”; Tasks::Rank; descending; With dialog: Off ]')).names,
    ['hi-b', 'hi-z', 'blank', 'low', 'z', 'hi-a', 'med', 'other']);
});

test('the sort dialog preserves value-list names and remembered sorts reuse them', async (t) => {
  const { run } = setup(t);
  const { names } = await run('Sort Records\nUnsort Records\nSort Records [ With dialog: Off ]', {
    sortDialog: async () => [{ fieldName: 'Priority', sortOrder: 'Priorities' }, { fieldName: 'Rank', sortOrder: 'descend' }],
  });
  assert.deepEqual(names, ['hi-z', 'hi-b', 'hi-a', 'med', 'low', 'other', 'z', 'blank']);
});

test('an unresolved custom sort reports value-list error 108', async (t) => {
  const { store, parsed } = setup(t);
  const steps = parsed('Sort Records [ Restore; Tasks::Priority; custom; With dialog: Off ]');
  const r = await runScript(store, { id: 9999, name: 'sort', steps } as Script, { layout: 'Tasks' });
  assert.equal(r.error, 108);
  assert.deepEqual(r.foundSet, store.findIds('Tasks'));
});

test('Sort Records by Field uses its associated list for a specified or active field', async (t) => {
  const { store, parsed, run } = setup(t);
  store.applyDesign([{ op: 'createLayout', name: 'Tasks view', occurrence: 'Tasks' }]);
  const layout = store.design('Tasks view')!;
  const objects = layout.objects.map((o) => o.field?.field === 'Priority' ? { ...o, field: { ...o.field, valueListId: store.schema.valueLists[0].id, valueList: 'Priorities' } } : o);
  store.applyDesign([{ op: 'updateLayout', layout: layout.id, design: { objects } }]);
  const [step] = parsed('Sort Records by Field [ Associated value list; Tasks::Priority ]');
  assert.deepEqual(parsed(stepLine(step.name, step.params))[0].params, step.params);
  const [active] = parsed('Sort Records by Field [ Associated value list ]');
  assert.deepEqual(parsed(stepLine(active.name, active.params))[0].params, active.params);
  assert.deepEqual((await run([step], { layout: 'Tasks view' })).names, expected);
  assert.deepEqual((await run('Go to Field [ Tasks::Priority ]\nSort Records by Field [ Associated value list ]', { layout: 'Tasks view' })).names, expected);
  assert.deepEqual((await run('Go to Field [ Tasks::Rank ]\nSort Records by Field [ Descending ]', { layout: 'Tasks view' })).names, ['hi-z', 'blank', 'hi-b', 'low', 'z', 'hi-a', 'med', 'other']);
});

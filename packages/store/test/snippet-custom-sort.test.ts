import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designSnippet, snippetChanges, Store } from '../src/index.ts';

function setup(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-snippet-custom-sort-'));
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  const store = new Store(path, name);
  store.applyDesign([
    { op: 'createTable', name: 'Tasks', fields: [{ name: 'Name' }, { name: 'Priority' }, { name: 'Rank' }] },
    { op: 'createValueList', name: 'Priorities', values: ['High', 'Low'] },
  ]);
  return { store, close: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

const copiedSort = (list: string) => `<fmxmlsnippet type="FMObjectList"><Step enable="True" id="39" name="Sort Records"><Restore state="True"/><SortList><Sort type="Custom"><PrimaryField><Field table="Tasks" name="Priority"/></PrimaryField><ValueList id="999" name="${list}"/></Sort><Sort type="Descending"><PrimaryField><Field table="Tasks" name="Rank"/></PrimaryField></Sort></SortList></Step></fmxmlsnippet>`;

test('custom-sort list round trips and resolves by destination name despite changed IDs', () => {
  const source = setup('source');
  const destination = setup('destination');
  try {
    destination.store.applyDesign([{ op: 'updateValueList', valueList: 'Priorities', name: 'Priority copy' }, { op: 'createValueList', id: 20, name: 'Priorities', values: ['High', 'Low'] }]);
    assert.notEqual(source.store.schema.valueLists[0].id, destination.store.schema.valueLists.find((list) => list.name === 'Priorities')!.id);
    source.store.applyDesign([{ op: 'createScript', name: 'Sort', steps: [{ stepId: 39, name: 'Sort Records', enabled: true, params: { restore: true, sort: [
      { field: { tableOccurrence: { id: source.store.schema.tableOccurrences[0].id, name: 'Tasks' }, field: { id: 2, name: 'Priority' } }, order: 'custom', valueList: { id: source.store.schema.valueLists[0].id, name: 'Priorities' } },
      { field: { tableOccurrence: { id: source.store.schema.tableOccurrences[0].id, name: 'Tasks' }, field: { id: 3, name: 'Rank' } }, order: 'descending' },
    ] } }] }]);
    const xml = designSnippet(source.store.schema, { steps: { script: source.store.schema.scripts[0].id, indexes: [0] } }).xml;
    const result = snippetChanges(xml, destination.store.schema);
    const pasted = result.changes.find((change) => change.op === 'createScript');
    assert.ok(pasted && pasted.op === 'createScript');
    const sort = pasted.steps![0].params!.sort!;
    assert.equal(sort[0].valueList?.name, 'Priorities');
    assert.equal(sort[0].valueList?.id, destination.store.schema.valueLists.find((list) => list.name === 'Priorities')!.id);
    assert.equal(sort[1].order, 'descending');
    assert.equal(sort[1].valueList, undefined);
  } finally { source.close(); destination.close(); }
});

test('copying an ID-only custom-sort reference exports its source list name', () => {
  const source = setup('source');
  const destination = setup('destination');
  try {
    destination.store.applyDesign([{ op: 'updateValueList', valueList: 'Priorities', name: 'Priority copy' }, { op: 'createValueList', id: 20, name: 'Priorities', values: ['High', 'Low'] }]);
    const sourceList = source.store.schema.valueLists.find((list) => list.name === 'Priorities')!;
    source.store.applyDesign([{ op: 'createScript', name: 'Sort', steps: [{ stepId: 39, name: 'Sort Records', enabled: true, params: { restore: true, sort: [
      { field: { tableOccurrence: { id: source.store.schema.tableOccurrences[0].id, name: 'Tasks' }, field: { id: 2, name: 'Priority' } }, order: 'custom', valueList: { id: sourceList.id, name: '' } },
    ] } }] }]);
    const xml = designSnippet(source.store.schema, { steps: { script: source.store.schema.scripts[0].id, indexes: [0] } }).xml;
    assert.match(xml, /<ValueList id="1" name="Priorities"\/>/);
    const result = snippetChanges(xml, destination.store.schema);
    const pasted = result.changes.find((change) => change.op === 'createScript');
    assert.ok(pasted && pasted.op === 'createScript');
    assert.deepEqual(pasted.steps![0].params!.sort![0].valueList, { id: 20, name: 'Priorities' });
  } finally { source.close(); destination.close(); }
});

test('custom-sort import reports unresolved names and never trusts the source ID', () => {
  const { store, close } = setup('destination');
  try {
    const result = snippetChanges(copiedSort('Missing'), store.schema);
    const pasted = result.changes.find((change) => change.op === 'createScript');
    assert.ok(pasted && pasted.op === 'createScript');
    const sort = pasted.steps![0].params!.sort!;
    assert.deepEqual(sort[0].valueList, { id: 0, name: 'Missing' });
    assert.match(result.notes.join('\n'), /value list "Missing" isn't in this file/);
    const matchedResult = snippetChanges(copiedSort('Priorities'), store.schema);
    const matchedScript = matchedResult.changes.find((change) => change.op === 'createScript');
    assert.ok(matchedScript && matchedScript.op === 'createScript');
    const matched = matchedScript.steps![0].params!.sort![0];
    assert.deepEqual(matched.valueList, { id: store.schema.valueLists[0].id, name: 'Priorities' });
  } finally { close(); }
});

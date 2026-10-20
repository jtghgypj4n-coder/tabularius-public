// Related records two hops away in another hosted file: the fast one-query
// hop between two of that file's tables reads that file, not this one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('a hop between two tables of another file is read from that file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-external-'));
  const open = (name: string) => {
    createStore(join(dir, `${name}.sqlite`));
    return new Store(join(dir, `${name}.sqlite`), name);
  };
  const data = open('Data');
  const picker = open('Picker');
  try {
    data.applyDesign([
      { op: 'createTable', name: 'Phone', fields: [{ name: 'Kind' }] },
      { op: 'createTable', name: 'Method', fields: [{ name: 'Kind' }] },
    ]);
    data.create('Phone', { Kind: 'mobile' });
    data.create('Method', { Kind: 'mobile' });
    data.create('Method', { Kind: 'home' });
    // Picker's own tables get the same ids as Data's, so occurrences of them can be pointed at Data.
    picker.applyDesign([
      { op: 'createTable', name: 'Picker', fields: [{ name: 'Kind' }] },
      { op: 'createTable', name: 'Spare', fields: [{ name: 'Kind' }] },
      { op: 'createOccurrence', name: 'Phone', table: 'Picker' },
      { op: 'createOccurrence', name: 'Method', table: 'Spare' },
      { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
      { op: 'createRelationship', left: 'Picker', right: 'Phone', predicates: [{ left: 'Kind', operator: '=', right: 'Kind' }] },
      { op: 'createRelationship', left: 'Phone', right: 'Method', predicates: [{ left: 'Kind', operator: '=', right: 'Kind' }] },
    ]);
    const source = picker.schema.dataSources[0].id;
    for (const to of picker.schema.tableOccurrences.filter((t) => t.name === 'Phone' || t.name === 'Method')) to.dataSourceId = source;
    picker.resolveFile = (name) => (name === 'Data' ? data : undefined);
    const id = picker.create('Picker', { Kind: 'mobile' }).recordId;
    // Picker has no Phone or Method table of its own: reading one here failed with "no such table".
    const [v] = picker.evaluateEach('Picker', ['List ( Method::Kind )'], Number(id));
    assert.equal(v?.value, 'mobile');
  } finally {
    picker.close();
    data.close();
    rmSync(dir, { recursive: true });
  }
});

// A find on a repeating field matches a record when any repetition matches, as FileMaker searches every repetition;
// "=" finds records with no repetition filled in. The repetitions are kept as a JSON array, which the criteria used
// to be compared with as a whole: "777" in ["555 1234","777"] found nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('finds on repeating fields match any repetition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-repeating-'));
  const path = join(dir, 'P.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'P');
    store.applyDesign([
      { op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Phone', options: { repetitions: 3 } }, { name: 'Score', type: 'number', options: { repetitions: 2 } }, { name: 'Seen', type: 'date', options: { repetitions: 2 } }] },
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Who' }] },
      { op: 'createRelationship', left: 'Notes', right: 'People', predicates: [{ left: 'Who', right: 'Name' }] },
    ] as never);
    store.create('People', { Name: 'Ann', 'Phone(1)': '555 1234', 'Phone(2)': '777', 'Score(1)': '5', 'Score(2)': '50', 'Seen(2)': '7/3/2026' } as never);
    store.create('People', { Name: 'Bob', 'Phone(1)': '888', 'Score(1)': '1' } as never);
    store.create('People', { Name: 'Cy' } as never);
    store.create('Notes', { Who: 'Ann' });
    store.create('Notes', { Who: 'Bob' });
    const names = (query: Record<string, string>[]) => store.find('People', { query, sort: [{ fieldName: 'Name', sortOrder: 'ascend' }] } as never).records.map((r) => r.fieldData.Name);

    assert.deepEqual(names([{ Phone: '777' }]), ['Ann'], 'a later repetition');
    assert.deepEqual(names([{ Phone: '555' }]), ['Ann'], 'the first word of the first');
    assert.deepEqual(names([{ Phone: '1234' }]), ['Ann']);
    assert.deepEqual(names([{ Phone: '==777' }]), ['Ann'], 'a whole repetition');
    assert.deepEqual(names([{ Phone: '==555' }]), []);
    assert.deepEqual(names([{ Score: '50' }]), ['Ann']);
    assert.deepEqual(names([{ Score: '>40' }]), ['Ann']);
    assert.deepEqual(names([{ Score: '<3' }]), ['Bob']);
    assert.deepEqual(names([{ Seen: '7/3/2026' }]), ['Ann']);
    assert.deepEqual(names([{ Phone: '*' }]), ['Ann', 'Bob']);
    assert.deepEqual(names([{ Phone: '=' }]), ['Cy'], 'no repetition filled in');
    assert.deepEqual(names([{ Phone: '*' }, { Phone: '777', omit: 'true' }]), ['Bob']);
    // The same through findIds (a script's Perform Find) and from a related table.
    assert.equal(store.findIds('People', { query: [{ Phone: '777' }] }).length, 1);
    const notes = store.find('Notes', { query: [{ 'People::Phone': '777' }] } as never).records.map((r) => r.fieldData.Who);
    assert.deepEqual(notes, ['Ann']);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

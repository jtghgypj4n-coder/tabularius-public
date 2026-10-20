// A write that gives a field's first repetition by name beside a later one ("Note" and "Note(3)") keeps both, in
// either order: the first was lost when the column didn't hold repetitions yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('the first repetition given beside a later one in the same write is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reps-'));
  createStore(join(dir, 'R.sqlite'));
  const s = new Store(join(dir, 'R.sqlite'), 'R');
  try {
    s.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Note', options: { repetitions: 3 } }] }] as never);
    const a = s.create('Rows', { Note: 'a1', 'Note(3)': 'a3' }).recordId;
    assert.deepEqual(s.get('Rows', a).fieldData, { Note: 'a1', 'Note(2)': '', 'Note(3)': 'a3' });
    const b = s.create('Rows', { 'Note(2)': 'b2', Note: 'b1' }).recordId;
    assert.deepEqual(s.get('Rows', b).fieldData, { Note: 'b1', 'Note(2)': 'b2' });
    s.update('Rows', b, { Note: 'B1', 'Note(3)': 'B3' });
    assert.deepEqual(s.get('Rows', b).fieldData, { Note: 'B1', 'Note(2)': 'b2', 'Note(3)': 'B3' });
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

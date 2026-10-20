// Formatting kept with each repetition of a repeating text field: given as "Tags(2)" beside its value, returned with
// that key, seen by GetAsCSS ( Tags[2] ), and dropped or kept per repetition as their text changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { ensureTextStyles, repetitionText, TextStyles } from '../src/text-styles.ts';

const bold = [{ start: 0, end: 3, style: 256 }];
const italic = [{ start: 0, end: 4, style: 512 }];

test('each repetition keeps its own formatting, through typing, and loses only its own when its text changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rep-styles-'));
  const path = join(dir, 'Reps.sqlite');
  createStore(path);
  const store = new Store(path, 'Reps');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Tags', options: { repetitions: 3 } }] },
      { op: 'createField', table: 'Notes', name: 'Css2', kind: 'calculation', calculation: 'GetAsCSS ( Tags[2] )', options: { unstored: true } },
      { op: 'createField', table: 'Notes', name: 'Css1', kind: 'calculation', calculation: 'GetAsCSS ( Tags )', options: { unstored: true } },
    ]);
    const id = store.create('Notes', { Tags: 'one', 'Tags(2)': 'four' }).recordId;
    store.update('Notes', id, { Tags: 'one', 'Tags(2)': 'four' }, undefined, { styles: { Tags: bold, 'Tags(2)': italic }, dataEntry: true });
    let r = store.get('Notes', id);
    assert.deepEqual(r.styles, { Tags: bold, 'Tags(2)': italic });
    assert.equal(r.fieldData.Css1, '<span style = "font-weight: bold;">one</span>');
    assert.equal(r.fieldData.Css2, '<span style = "font-style: italic;">four</span>', 'GetAsCSS ( Tags[2] ) sees the second repetition\'s formatting');

    // Typing in the second repetition keeps its formatting around the change, and leaves the first alone.
    store.update('Notes', id, { 'Tags(2)': 'the four' }, undefined, { dataEntry: true });
    assert.deepEqual(store.get('Notes', id).styles, { Tags: bold, 'Tags(2)': [{ start: 4, end: 8, style: 512 }] });

    // A script's write to one repetition drops that repetition's formatting only.
    store.update('Notes', id, { 'Tags(2)': 'set' });
    assert.deepEqual(store.get('Notes', id).styles, { Tags: bold });

    // Formatting a third repetition given with its value alone.
    store.update('Notes', id, { 'Tags(3)': 'three' }, undefined, { styles: { 'Tags(3)': bold } });
    assert.throws(() => store.update('Notes', id, { 'Tags(0)': 'x' }, undefined, { styles: { 'Tags(0)': bold } }), /missing/);
    assert.deepEqual(store.get('Notes', id).styles, { Tags: bold, 'Tags(3)': bold });

    // Text changed behind the store's back in one repetition leaves the others' formatting.
    store.sql.prepare('UPDATE "Notes" SET "Tags" = ? WHERE _fm_record_id = ?').run(JSON.stringify(['uno', 'set', 'three']), id);
    r = store.get('Notes', id);
    assert.equal(r.fieldData.Tags, 'uno');
    assert.deepEqual(r.styles, { 'Tags(3)': bold });
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('a masked repeating field keeps its formatting out in every repetition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rep-styles-'));
  const path = join(dir, 'Masked.sqlite');
  createStore(path);
  const store = new Store(path, 'Masked');
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Secret', options: { repetitions: 3 } }] }]);
    const id = store.create('People', { Name: 'Ada', Secret: 'abcdef', 'Secret(2)': 'ghijkl' }).recordId;
    store.update('People', id, { Secret: 'abcdef', 'Secret(2)': 'ghijkl' }, undefined, { styles: { Secret: bold, 'Secret(2)': bold } });
    store.savePrivilegeSet({
      name: 'Limited', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
      tables: { People: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'masked' } } },
    } as never);
    // Found by review: "Secret(2)" was looked up as a field of its own, which the set doesn't name.
    assert.equal(store.get('People', id, 'us', undefined, store.privilegesForSet('Limited')).styles, undefined);
    assert.deepEqual(Object.keys(store.get('People', id).styles ?? {}), ['Secret', 'Secret(2)']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('formatting kept before repetitions had their own is kept, as the first repetition\'s', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE _fm_text_styles (tbl INTEGER NOT NULL, record_id INTEGER NOT NULL, field INTEGER NOT NULL,
    hash TEXT NOT NULL, runs TEXT NOT NULL, PRIMARY KEY (tbl, record_id, field)) WITHOUT ROWID`);
  const styles = new TextStyles(sql);
  // Written the old way: no repetition. Its hash is the new code's for the same text.
  const probe = new DatabaseSync(':memory:');
  ensureTextStyles(probe);
  new TextStyles(probe).write(1, 7, 3, 'Hello', bold);
  const { hash, runs } = probe.prepare('SELECT hash, runs FROM _fm_text_styles').get() as { hash: string; runs: string };
  sql.prepare('INSERT INTO _fm_text_styles VALUES (1, 7, 3, ?, ?)').run(hash, runs);
  ensureTextStyles(sql);
  ensureTextStyles(sql); // twice: the second finds it done
  assert.deepEqual(styles.read(1, 7, (f, rep) => (f === 3 && rep === 1 ? 'Hello' : undefined)), [{ field: 3, rep: 1, runs: bold }]);
  styles.write(1, 7, 3, 'Bye', italic.map((x) => ({ ...x, end: 3 })), 2);
  assert.equal((sql.prepare('SELECT count(*) AS n FROM _fm_text_styles').get() as { n: number }).n, 2, 'a second repetition is a row of its own');
});

test('repetitionText reads one repetition of a stored value', () => {
  assert.equal(repetitionText('plain', 1, 1), 'plain');
  assert.equal(repetitionText('plain', 1, 2), undefined);
  assert.equal(repetitionText(JSON.stringify(['a', null, 'c']), 3, 2), '');
  assert.equal(repetitionText(JSON.stringify(['a', null, 'c']), 3, 3), 'c');
  assert.equal(repetitionText('[not a list', 3, 1), '[not a list', 'text that starts with "[" is the first repetition');
  assert.equal(repetitionText('[not a list', 3, 2), '');
  assert.equal(repetitionText(null, 3, 1), '');
});

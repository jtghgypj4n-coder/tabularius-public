import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { FOLD_VERSION } from '../../calc/src/collation.ts';

// Finds on text use a word index; results must be exactly what reading every record gives.
test('word index: same results as without it, kept current through writes and design changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-words-'));
  const path = join(dir, 'People.sqlite');
  createStore(path);
  const store = new Store(path, 'People');
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Notes' }, { name: 'Age', type: 'number' }] }]);
    const names = ['Ann Smith', 'Bob Smithers', 'smith', 'Zoë Café', 'Zoe Cafe', 'Mary-Jane Watson', 'O\'Brien Pat', 'Ann  Lee',
      'Annabel', 'x Smith, y', '12.5 kg', 'Résumé', 'résumé', 'AB-12 99', 'tab\tSmith', 'Ånge Ström', ''];
    for (const [i, n] of names.entries()) store.create('People', { Name: n, Notes: `note ${i} about ${n}`, Age: String(20 + i) });
    const finds: Record<string, string>[] = [
      { Name: 'smi' }, { Name: 'smith' }, { Name: '=smith' }, { Name: 'ann' }, { Name: '=ann' }, { Name: 'caf' }, { Name: 'café' },
      { Name: 'zoë' }, { Name: 'jane' }, { Name: 'mary-jane' }, { Name: '"ann smith"' }, { Name: 'o\'brien' }, { Name: 'brien' },
      { Name: '12.5' }, { Name: '12' }, { Name: 'ab-12 9' }, { Name: 'sm*h' }, { Name: 'r@sum' }, { Name: 'résumé' }, { Name: 'ström' },
      { Name: '==smith' }, { Name: '=' }, { Name: '*' }, { Name: '-' }, { Name: 'smith', Notes: 'note' }, { Notes: 'about ann' },
    ];
    const run = (requests: Record<string, string>[]) => {
      try {
        return store.findIds('People', { query: requests });
      } catch (e) {
        return (e as Error).message;
      }
    };
    const compare = () => {
      for (const f of finds) {
        store.words.enabled = false;
        const plain = run([f]);
        store.words.enabled = true;
        assert.deepEqual(run([f]), plain, JSON.stringify(f));
      }
      store.words.enabled = false;
      const plain = run([{ Name: 'ann' }, { Name: 'smith', omit: 'true' } as Record<string, string>]);
      store.words.enabled = true;
      assert.deepEqual(run([{ Name: 'ann' }, { Name: 'smith', omit: 'true' } as Record<string, string>]), plain);
    };
    compare();
    assert.ok(store.sql.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE '\\_fm\\_words\\_%' ESCAPE '\\'").get(), 'index built');

    // Writes here and from another connection keep it current.
    const id = store.findIds('People', { query: [{ Name: 'annabel' }] })[0];
    store.update('People', id, { Name: 'Quentin Blake' });
    assert.deepEqual(store.findIds('People', { query: [{ Name: 'quent' }] }), [id]);
    assert.deepEqual(store.findIds('People', { query: [{ Name: 'annabel' }] }), []);
    const other = new Store(path, 'People');
    const added = other.create('People', { Name: 'Wilhelmina Quast' }).recordId;
    other.delete('People', id);
    other.close();
    assert.deepEqual(store.findIds('People', { query: [{ Name: 'quast' }] }), [added]);
    assert.deepEqual(store.findIds('People', { query: [{ Name: 'quent' }] }), []);
    compare();

    // Design changes: a dropped or renamed field doesn't trip over the index.
    store.applyDesign([{ op: 'deleteField', table: 'People', field: 'Notes' }]);
    store.applyDesign([{ op: 'updateField', table: 'People', field: 'Name', name: 'Full name' }]);
    assert.deepEqual(store.findIds('People', { query: [{ 'Full name': 'quast' }] }), [added]);
    store.update('People', added, { 'Full name': 'Wilma Q' });
    assert.deepEqual(store.findIds('People', { query: [{ 'Full name': 'wilma' }] }), [added]);
    store.truncate('People');
    assert.deepEqual(store.findIds('People', { query: [{ 'Full name': 'wilma' }] }), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

// Another process building or dropping an index as a find opens it makes SQLite answer
// "database schema has changed" once; the find or search must run again, not fail.
test('word index: a statement refused because the schema just changed runs again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-words-retry-'));
  const path = join(dir, 'People.sqlite');
  createStore(path);
  const store = new Store(path, 'People');
  try {
    let calls = 0;
    const schemaChanged = Object.assign(new Error('vtable constructor failed: database schema has changed'), { errcode: 17 });
    assert.equal(store.words.retry(() => { if (++calls < 3) throw schemaChanged; return 'ok'; }), 'ok');
    assert.equal(calls, 3);
    // Other errors are not retried, and it gives up after a few tries.
    let other = 0;
    assert.throws(() => store.words.retry(() => { other++; throw new Error('no such table'); }), /no such table/);
    assert.equal(other, 1);
    let stuck = 0;
    assert.throws(() => store.words.retry(() => { stuck++; throw schemaChanged; }), /schema has changed/);
    assert.equal(stuck, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The index holds text as a find compares it, so a plain find cannot miss a word that "=" or a wildcard finds.
test('word index: text written in another form is found with the index as without it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-words-forms-'));
  const path = join(dir, 'Forms.sqlite');
  createStore(path);
  const store = new Store(path, 'Forms');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Forms', fields: [{ name: 'Name' }] }]);
    const stored = ['ﬁlm', 'ＡＢ shop', 'oﬃce', 'Straße', 'école', 'café', 'Plain', '１２３', 'Smith-Jones'];
    for (const n of stored) store.create('Forms', { Name: n });
    const typed = ['film', 'ｆｉｌｍ', 'ab', 'AB sh', 'ＡＢ', 'strasse', 'strasse', 'école', 'ecole', 'cafe', 'café', 'plain', '123', 'smith', 'jones', '=film', '=ab', '"ab shop"'];
    for (const q of typed) {
      store.words.enabled = false;
      const plain = store.findIds('Forms', { query: [{ Name: q }] });
      store.words.enabled = true;
      assert.deepEqual(store.findIds('Forms', { query: [{ Name: q }] }), plain, JSON.stringify(q));
    }
    store.words.enabled = true;
    const finds = (q: string) => store.findIds('Forms', { query: [{ Name: q }] }).length;
    assert.equal(finds('film'), 1, 'a ligature is found by its letters');
    assert.equal(finds('ab'), 1, 'full-width letters are found by plain ones');
    assert.equal(finds('ﬁlm'), 1, 'and the other way round');
    // Writes keep the folded text current: an edited word stops matching, its replacement matches.
    const id = store.findIds('Forms', { query: [{ Name: 'film' }] })[0];
    store.update('Forms', id, { Name: 'Plain again' });
    assert.equal(finds('film'), 0);
    assert.equal(finds('again'), 1);
    store.delete('Forms', id);
    assert.equal(finds('again'), 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('word index: an index built before it held folded text is built again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-words-old-'));
  const path = join(dir, 'Old.sqlite');
  createStore(path);
  const store = new Store(path, 'Old');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Old', fields: [{ name: 'Name' }] }]);
    store.create('Old', { Name: 'ﬁlm' });
    assert.equal(store.findIds('Old', { query: [{ Name: 'film' }] }).length, 1);
    const name = (store.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_fm\\_words\\_%' ESCAPE '\\' AND sql LIKE 'CREATE VIRTUAL%'").get() as { name: string }).name;
    // Put back what the previous version built: the stored text itself in the index.
    for (const s of ['ai', 'ad', 'au']) store.sql.exec(`DROP TRIGGER "${name}_${s}"`);
    store.sql.exec(`DROP TABLE "${name}"`);
    store.sql.exec(`CREATE VIRTUAL TABLE "${name}" USING fts5("Name", content='Old', content_rowid='_fm_record_id', tokenize='unicode61 remove_diacritics 2')`);
    store.sql.exec(`INSERT INTO "${name}"("${name}") VALUES ('rebuild')`);
    store.sql.exec(`CREATE TRIGGER "${name}_ai" AFTER INSERT ON "Old" BEGIN INSERT INTO "${name}"(rowid, "Name") VALUES (new._fm_record_id, new."Name"); END`);
    store.words.reset();
    assert.equal(store.findIds('Old', { query: [{ Name: 'film' }] }).length, 1, 'the index is replaced, so the ligature is found');
    const trigger = () => (store.sql.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(`${name}_ai`) as { sql: string }).sql;
    assert.ok(trigger().includes('fm_fold(') && trigger().includes(`/* fold ${FOLD_VERSION} */`));
    // Text folded by an earlier rule is out of date too: the number in the trigger says which rule built it.
    store.sql.exec(`DROP TRIGGER "${name}_ai"`);
    store.sql.exec(`CREATE TRIGGER "${name}_ai" AFTER INSERT ON "Old" BEGIN /* fold 0 */ INSERT INTO "${name}"(rowid, "Name") VALUES (new._fm_record_id, fm_fold(new."Name")); END`);
    store.words.reset();
    assert.equal(store.findIds('Old', { query: [{ Name: 'film' }] }).length, 1);
    assert.ok(trigger().includes(`/* fold ${FOLD_VERSION} */`), 'built again under the current rule');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Other connections to the file prepare statements that fire the index triggers, so each needs the fold function.
test('word index: a read-only SQL statement that would write is refused as read-only, not as a missing function', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-words-ro-'));
  const path = join(dir, 'Ro.sqlite');
  createStore(path);
  const store = new Store(path, 'Ro');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Ro', fields: [{ name: 'Name' }] }]);
    store.create('Ro', { Name: 'one' });
    assert.equal(store.findIds('Ro', { query: [{ Name: 'one' }] }).length, 1);
    assert.ok(store.sql.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE '\\_fm\\_words\\_%' ESCAPE '\\'").get(), 'the index exists');
    assert.throws(() => store.query('WITH x AS (SELECT 1) DELETE FROM Ro'), /readonly/);
    assert.equal(store.query('SELECT count(*) AS n FROM Ro')[0].n, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

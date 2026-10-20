// Deleting a record takes the values it held out of the personal-data vault, for every account; values other
// records still hold are not special: they are given new stand-ins the next time they are shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiiMasker } from '../src/pii.ts';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pii-delete-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'People');
    try {
      fn(store);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const held = (store: Store): string[] => (store.sql.prepare('SELECT value FROM _fm_pii_vault ORDER BY value').all() as { value: string }[]).map((r) => r.value);

test('deleting a record, a related record or a whole table takes its values out of the vault', () => withStore((store) => {
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Email' }, { name: 'Born', type: 'date' }, { name: 'Age', type: 'number' }, { name: 'Notes' }, { name: 'Phones', options: { repetitions: 2 } }] },
    { op: 'createTable', name: 'Pets', fields: [{ name: 'Owner' }, { name: 'Name' }] },
  ] as DesignOp[], { account: 'Admin' });
  const ann = store.create('People', { Name: 'Ann Lee', Email: 'ann@example.com', Born: '1990-04-05', Age: 34, Notes: 'call ann@example.com today', Phones: '555-0101', 'Phones(2)': '555-0102' }).recordId;
  store.create('People', { Name: 'Bob Roe', Email: 'bob@example.com', Born: '1985-01-02', Age: 34 }).recordId;
  store.create('Pets', { Owner: 'Ann Lee', Name: 'Rex' });

  // Two accounts were shown the same values, in the shapes the Data API gives them.
  for (const account of ['alice', 'carol']) {
    const m = new PiiMasker(store, account);
    for (const [v, kind] of [['Ann Lee', 'PERSON'], ['ann@example.com', 'EMAIL'], ['04/05/1990', 'DATE'], ['34', 'TEXT'], ['Bob Roe', 'PERSON'], ['bob@example.com', 'EMAIL'], ['Rex', 'PERSON'], ['Elsewhere', 'PERSON'], ['555-0101', 'PHONE'], ['555-0102', 'PHONE']] as const) m.token(v, kind);
  }
  assert.equal(held(store).length, 20);

  store.delete('People', ann);
  // Ann's name, email and birth date (as the API shows it) and her age are gone for both accounts, and Bob's stay; so does
  // "34", which Bob's age shares, since it is a value of the deleted record (it comes back with a new stand-in when shown).
  assert.deepEqual([...new Set(held(store))], ['Bob Roe', 'Elsewhere', 'Rex', 'bob@example.com']);
  assert.ok(!held(store).includes('04/05/1990') && !held(store).includes('Ann Lee') && !held(store).includes('34'));

  // A masker made afterwards does not turn the old stand-in back into the name.
  const again = new PiiMasker(store, 'alice');
  assert.equal(again.unmask('<PERSON_1>'), '<PERSON_1>');

  store.truncate('People');
  assert.ok(!held(store).includes('Bob Roe') && !held(store).includes('bob@example.com'));
  assert.ok(held(store).includes('Rex'), 'another table keeps its values');
  store.delete('Pets', store.find('Pets', {}).records[0].recordId);
  assert.deepEqual([...new Set(held(store))], ['Elsewhere']);
}));

test('a file with no vault deletes as before', () => withStore((store) => {
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as DesignOp[], { account: 'Admin' });
  const id = store.create('People', { Name: 'Ann' }).recordId;
  store.delete('People', id);
  assert.equal(store.find('People', {}).foundCount, 0);
}));

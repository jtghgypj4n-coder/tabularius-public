// Finds and unique values ignore case in every script, and finds ignore accents too, as FileMaker's English index does
// (see calc/src/collation.ts). SQLite's own case folding (LIKE, COLLATE NOCASE) knows ASCII letters only, so "zurich",
// "ZÜRICH" and "Zürich" used to be three different things, and "É" and "é" could both be saved in a unique field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError } from '../src/index.ts';
import { foldText, foldCase } from '../../calc/src/collation.ts';

test('foldText: case, accents and ligatures, in any script', () => {
  assert.equal(foldText('ZÜRICH'), 'zurich');
  assert.equal(foldText('Zürich'), 'zurich');
  assert.equal(foldText('Łódź'), 'lodz');
  assert.equal(foldText('São Paulo'), 'sao paulo');
  assert.equal(foldText('Émile'), 'emile');
  assert.equal(foldText('Straße'), 'strasse');
  assert.equal(foldText('Øre'), 'ore');
  assert.equal(foldText('ÆON'), 'aeon');
  assert.equal(foldText('ΑΘΗΝΑ'), 'αθηνα', 'Greek folds its case');
  assert.equal(foldText('МОСКВА'), 'москва', 'and Cyrillic');
  assert.equal(foldText('日本語'), '日本語', 'scripts without case stay as they are');
  assert.equal(foldText('Plain ASCII 123'), 'plain ascii 123');
  assert.equal(foldCase('ÉÀ'), 'éà', 'unique values keep accents');
});

test('a find ignores case and accents in text, and a wildcard still works', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-unicode-'));
  const path = join(dir, 'U.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'U');
    store.applyDesign([{ op: 'createTable', name: 'City', fields: [{ name: 'Name' }, { name: 'Note' }] }] as never);
    for (const Name of ['Zürich', 'Łódź', 'São Paulo', 'Émile', 'Plain', 'New York']) store.create('City', { Name });
    store.create('City', { Name: 'Other', Note: 'Résumé on file' });
    const names = (query: Record<string, string>[]) => store.find('City', { query, sort: [{ fieldName: 'Name', sortOrder: 'ascend' }] } as never).records.map((r) => r.fieldData.Name);

    assert.deepEqual(names([{ Name: 'zurich' }]), ['Zürich']);
    assert.deepEqual(names([{ Name: 'ZÜRICH' }]), ['Zürich']);
    // ł, ø, ß and the like have no accent to take off: typed as plain letters they match where the word index isn't
    // consulted (a whole field, a wildcard), and typed as themselves everywhere.
    assert.deepEqual(names([{ Name: '==lodz' }]), ['Łódź']);
    assert.deepEqual(names([{ Name: '=' + 'ŁÓDŹ' }]), ['Łódź']);
    assert.deepEqual(names([{ Name: '==łódź' }]), ['Łódź']);
    assert.deepEqual(names([{ Name: 'l*dz' }]), ['Łódź']);
    assert.deepEqual(names([{ Name: 'ŁÓDŹ' }]), ['Łódź']);
    assert.deepEqual(names([{ Name: 'sao paulo' }]), ['São Paulo']);
    assert.deepEqual(names([{ Name: 'paulo' }]), ['São Paulo'], 'a later word');
    assert.deepEqual(names([{ Name: 'emile' }]), ['Émile']);
    assert.deepEqual(names([{ Name: 'ÉMILE' }]), ['Émile']);
    assert.deepEqual(names([{ Name: '==zurich' }]), ['Zürich'], 'a whole field');
    assert.deepEqual(names([{ Name: '==zuri' }]), []);
    assert.deepEqual(names([{ Name: '=paulo' }]), ['São Paulo'], 'a whole word');
    assert.deepEqual(names([{ Name: 'z*ich' }]), ['Zürich'], 'a wildcard');
    assert.deepEqual(names([{ Name: 'e@ile' }]), ['Émile']);
    assert.deepEqual(names([{ Name: 'new york' }]), ['New York'], 'ASCII is as before');
    assert.deepEqual(names([{ Name: 'z*', omit: 'false' }, { Name: 'zurich', omit: 'true' }]), []);
    assert.deepEqual(names([{ Note: 'resume' }]), ['Other'], 'accents in the stored text');
    assert.deepEqual(names([{ Name: 'zurich' }, { Name: 'ŁODZ' }]), ['Łódź', 'Zürich']);
    assert.equal(store.findIds('City', { query: [{ Name: 'ZURICH' }] }).length, 1, 'a script’s Perform Find');
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a unique field treats a letter and its capital as one value in any script, and keeps accents apart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-unique-unicode-'));
  const path = join(dir, 'U.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'U');
    store.applyDesign([{ op: 'createTable', name: 'Tag', fields: [{ name: 'Label', options: { validation: { unique: true } } }, { name: 'Plain' }] }] as never);
    store.create('Tag', { Label: 'é' });
    const refused = (label: string) => assert.throws(() => store.create('Tag', { Label: label }), (e: StoreError) => e.code === 504, label);
    refused('É');
    refused('é');
    store.create('Tag', { Label: 'e' });
    refused('E');
    store.create('Tag', { Label: 'Ł' });
    refused('ł');
    store.create('Tag', { Label: 'Σ' });
    refused('σ');
    store.create('Tag', { Label: 'Zebra' });
    refused('ZEBRA');

    // Changing a record to another one's value is refused as well; its own value is not another record's.
    const { recordId } = store.create('Tag', { Label: 'Ü' });
    assert.throws(() => store.update('Tag', recordId, { Label: 'ł' }), (e: StoreError) => e.code === 504);
    store.update('Tag', recordId, { Label: 'ü' });
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

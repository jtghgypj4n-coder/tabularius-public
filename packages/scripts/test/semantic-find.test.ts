import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { createStore, importFmp12, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

// Beezwax's public semantic search demo (MIT) keeps an OpenAI embedding per
// record in EMBEDDING::embedding; searching by one of them needs no model.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'BeezwaxUnifiedSearchActions.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;
let countDir: string;
let countStore: Store;
const rankedIds: number[] = [];

before(() => {
  countDir = mkdtempSync(join(tmpdir(), 'tabularius-semantic-find-'));
  createStore(join(countDir, 'Counts.sqlite'));
  countStore = new Store(join(countDir, 'Counts.sqlite'));
  countStore.applyDesign([{ op: 'createTable', name: 'EMBEDDING', fields: [{ name: 'embedding', type: 'text' }] }]);
  for (const i of [7, 2, 10, 5, 0, 11, 3, 8, 1, 6, 9, 4]) {
    rankedIds[i] = countStore.create('EMBEDDING', { embedding: JSON.stringify([1, i / 12]) }).recordId;
  }
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Unified.sqlite'));
  store = new Store(join(dir, 'Unified.sqlite'));
});
after(() => {
  store?.close();
  countStore?.close();
  if (dir) rmSync(dir, { recursive: true });
  if (countDir) rmSync(countDir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const embedding = { tableOccurrence: { id: 0, name: 'EMBEDDING' }, field: { id: 0, name: 'embedding' } };
const find = (ai: NonNullable<StepParams['ai']>) => step(218, 'Perform Semantic Find', { field: embedding, ai });

test('Perform Semantic Find evaluates Return count and keeps the three closest of twelve matches', async () => {
  const r = await runScript(countStore, script(
    step(141, 'Set Variable', { variable: '$count', value: '2' }),
    find({ queryBy: 'vector data', vector: '"[1, 0]"', recordSet: 'all records', condition: 'greater than or equal to', threshold: '0', returnCount: '$count + 1' }),
    step(103, 'Exit Script', { calculation: 'Get ( FoundCount )' }),
  ), { layout: 'EMBEDDING' });
  assert.equal(r.error, 0);
  assert.equal(r.result, '3');
  assert.deepEqual(r.foundSet, rankedIds.slice(0, 3));
});

test('Perform Semantic Find limits and ranks only the current found set', async () => {
  const r = await runScript(countStore, script(
    find({ queryBy: 'vector data', vector: '"[1, 0]"', recordSet: 'current found set', returnCount: '2' }),
    step(103, 'Exit Script', { calculation: 'Get ( FoundCount )' }),
  ), { layout: 'EMBEDDING', foundSet: [rankedIds[8], rankedIds[5], rankedIds[10], rankedIds[3]] });
  assert.equal(r.error, 0);
  assert.equal(r.result, '2');
  assert.deepEqual(r.foundSet, [rankedIds[3], rankedIds[5]]);
});

for (const [name, returnCount, expected] of [
  ['absent Return count defaults to ten', undefined, 10],
  ['Return count above ten is respected', '11', 11],
  ['Return count above the number of matches returns all matches', '20', 12],
  ['fractional Return count is truncated', '3.9', 3],
] as const) {
  test(`Perform Semantic Find: ${name}`, async () => {
    const r = await runScript(countStore, script(
      find({ queryBy: 'vector data', vector: '"[1, 0]"', recordSet: 'all records', returnCount }),
      step(103, 'Exit Script', { calculation: 'Get ( FoundCount )' }),
    ), { layout: 'EMBEDDING' });
    assert.equal(r.error, 0);
    assert.equal(r.result, String(expected));
    assert.deepEqual(r.foundSet, rankedIds.slice(0, expected));
  });
}

// Inferred, not documented FileMaker behavior: a limit leaving no matches uses
// the existing semantic search error 401 path and preserves the previous found set.
for (const [name, options] of [
  ['zero Return count', { returnCount: '0' }],
  ['negative Return count', { returnCount: '-3' }],
  ['non-numeric Return count', { returnCount: '"invalid"' }],
  ['empty Return count', { returnCount: '""' }],
  ['no matching candidates', { condition: 'greater than', threshold: '1', returnCount: '3' }],
] as const) {
  test(`Perform Semantic Find: ${name} reports 401 and preserves the found set`, async () => {
    const foundSet = [rankedIds[8], rankedIds[5], rankedIds[3]];
    const r = await runScript(countStore, script(
      find({ queryBy: 'vector data', vector: '"[1, 0]"', recordSet: 'all records', ...options }),
      step(103, 'Exit Script', { calculation: 'Get ( LastError ) & "/" & Get ( FoundCount )' }),
    ), { layout: 'EMBEDDING', foundSet, recordId: foundSet[1], trace: true });
    assert.equal(r.error, 401);
    assert.equal(r.result, '401/3');
    assert.equal(r.trace?.[0].message, 'No records match the request');
    assert.deepEqual(r.foundSet, foundSet);
    assert.equal(r.recordId, foundSet[1]);
  });
}

for (const [returnCount, error] of [
  ['1 / 0', 1200],
  ['Sqrt ( -1 )', 1200],
  ['Exp ( 1000 )', 1200],
  ['-Exp ( 1000 )', 1200],
  ['MissingFunction ( 1 )', 1208],
] as const) {
  test(`Perform Semantic Find: Return count ${returnCount} reports ${error} and preserves the found set`, async () => {
    const foundSet = [rankedIds[8], rankedIds[5], rankedIds[3]];
    const r = await runScript(countStore, script(
      find({ queryBy: 'vector data', vector: '"[1, 0]"', recordSet: 'all records', returnCount }),
      step(103, 'Exit Script', { calculation: 'Get ( LastError ) & "/" & Get ( FoundCount )' }),
    ), { layout: 'EMBEDDING', foundSet, recordId: foundSet[1] });
    assert.equal(r.error, error);
    assert.equal(r.result, `${error}/3`);
    assert.deepEqual(r.foundSet, foundSet);
    assert.equal(r.recordId, foundSet[1]);
  });
}

test('Perform Semantic Find by vector data finds the closest records, most similar first', { skip }, async () => {
  const [first] = store.query('SELECT _fm_record_id AS id FROM EMBEDDING ORDER BY _fm_record_id LIMIT 1');
  const r = await runScript(store, script(
    step(141, 'Set Variable', { variable: '$v', value: 'GetEmbeddingAsText ( EMBEDDING::embedding )' }),
    step(23, 'Show All Records'),
    find({ queryBy: 'vector data', vector: '$v', recordSet: 'all records', condition: 'greater than or equal to', threshold: '0.7' }),
    step(103, 'Exit Script', { calculation: 'Get ( FoundCount ) & "/" & Get ( RecordID ) & "/" & ( CosineSimilarity ( $v ; EMBEDDING::embedding ) > .999999 )' }),
  ), { layout: 'All', foundSet: [Number(first.id)] });
  const [count, id, same] = String(r.result).split('/');
  assert.ok(+count >= 1 && +count <= 10, `found ${count}`);
  assert.equal(+id, Number(first.id));
  assert.equal(same, '1');
});

test('Perform Semantic Find on a related field finds the layout\'s records by their related embeddings', { skip }, async () => {
  // Beezwax's script: from the Assets layout, target asset.EMBEDDING~create::embedding.
  const related = { tableOccurrence: { id: 0, name: 'asset.EMBEDDING~create' }, field: { id: 0, name: 'embedding' } };
  // An asset with a related embedding.
  const [withEmbedding] = store.query('SELECT a._fm_record_id AS id FROM ASSET a JOIN EMBEDDING e ON e.id_foreign = a.id WHERE e.embedding IS NOT NULL ORDER BY a._fm_record_id LIMIT 1');
  const asset = Number(withEmbedding.id);
  const r = await runScript(store, script(
    step(141, 'Set Variable', { variable: '$v', value: 'GetEmbeddingAsText ( asset.EMBEDDING~create::embedding )' }),
    step(23, 'Show All Records'),
    step(218, 'Perform Semantic Find', { field: related, ai: { queryBy: 'vector data', vector: '$v', recordSet: 'all records', condition: 'greater than or equal to', threshold: '0.5' } }),
    step(103, 'Exit Script', { calculation: 'Get ( LastError ) & "/" & Get ( FoundCount ) & "/" & ( CosineSimilarity ( $v ; asset.EMBEDDING~create::embedding ) > .999999 )' }),
  ), { layout: 'Assets', foundSet: [asset] });
  const [error, count, top] = String(r.result).split('/');
  assert.equal(error, '0');
  assert.ok(+count >= 1 && +count <= 10, `found ${count}`);
  assert.equal(top, '1', 'the closest record comes first');
});

test('Perform Semantic Find on an unrelated table occurrence says so', { skip }, async () => {
  const unrelated = { tableOccurrence: { id: 0, name: 'HOBBY' }, field: { id: 0, name: 'embedding' } };
  const r = await runScript(store, script(
    step(86, 'Set Error Capture', { on: true }),
    step(218, 'Perform Semantic Find', { field: unrelated, ai: { queryBy: 'vector data', vector: '"[1, 0]"' } }),
    step(103, 'Exit Script', { calculation: 'Get ( LastError )' }),
  ), { layout: 'Assets' });
  assert.equal(r.result, '102');
});

test('Perform Semantic Find by natural language needs a model, so it stops offline', { skip }, async () => {
  const r = await runScript(store, script(
    step(86, 'Set Error Capture', { on: true }),
    find({ queryBy: 'natural language', accountName: '"a"', model: '"m"', input: '"chairs"' }),
    step(103, 'Exit Script', { calculation: 'Get ( LastError )' }),
  ), { layout: 'All' });
  assert.equal(r.result, '3');
});

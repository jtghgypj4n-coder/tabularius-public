import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeStepParams, FmpDatabase, Node, stepLine } from '../src/index.ts';

// Beezwax's public FileMaker 2024 semantic search demos (MIT): the only AI
// steps and functions we have seen in a real file.
const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const simple = join(dir, 'BeezwaxSemanticSearch.fmp12');
const unified = join(dir, 'BeezwaxUnifiedSearchActions.fmp12');
const skip = existsSync(simple) && existsSync(unified) ? false : 'fixtures missing: run npm run fixtures';

const lines = (file: string, script: string) =>
  FmpDatabase.open(file).schema.scripts.find((s) => s.name === script)!.steps.map((s) => s.line ?? s.name);

test('Perform Semantic Find decodes Return count as a calculation and labels it', () => {
  const p = new Node();
  const count = new Node();
  const slot = new Node();
  slot.children.set(5, count);
  p.children.set(131, slot);
  const ctx = { formula: (n: Node | undefined) => n === count ? '$count + 1' : undefined,
    layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: () => undefined,
    fieldName: () => undefined, dataSourceName: () => undefined };
  const params = decodeStepParams(218, new Uint8Array(28), p, ctx);
  assert.equal(params?.ai?.returnCount, '$count + 1');
  assert.equal(params?.slots?.[131], undefined, 'Return count is a named option');
  assert.equal(stepLine('Perform Semantic Find', params), 'Perform Semantic Find [ Return count: $count + 1 ]');
  p.children.delete(131);
  assert.equal(decodeStepParams(218, new Uint8Array(28), p, ctx)?.ai?.returnCount, undefined);
});

test('AI steps: account, embeddings and semantic find read like FileMaker', { skip }, () => {
  assert.ok(lines(simple, 'configure ai account').includes('Configure AI Account [ Account Name: GLOBAL::llm_account ; API key: GLOBAL::llm_key ]'));
  assert.ok(lines(simple, 'initialize embeddings').includes(
    'Insert Embedding in Found Set [ Account Name: GLOBAL::llm_account ; Model: GLOBAL::llm_model ; Source Field: PROJECT::embedding_source ; Target Field: PROJECT::embedding ; Replace target contents ]'));
  assert.ok(lines(simple, 'perform semantic find').includes(
    'Perform Semantic Find [ Query by: Natural language ; Account Name: GLOBAL::llm_account ; Embedding Model: GLOBAL::llm_model ; ' +
    'Text: GLOBAL::semantic_input ; Record set: All records ; Target: PROJECT::embedding ; Cosine similarity condition: greater than ; Cosine similarity value: 0.75 ]'));
  const find = lines(unified, 'perform semantic find');
  assert.ok(find.includes(
    'Perform Semantic Find [ Query by: Vector data ; Vector: GLOBAL::semantic_input_embedding ; Record set: All records ; ' +
    'Target: person.EMBEDDING~create::embedding ; Cosine similarity condition: greater than or equal to ; Cosine similarity value: $_cosine_similarity ]'));
  assert.ok(find.includes('Set Variable [ $_input_embedding ; Value: GetEmbedding ( GLOBAL::llm_account ; GLOBAL::llm_model ; GLOBAL::semantic_input ) ]'));
  const step = FmpDatabase.open(unified).schema.scripts.find((s) => s.name === 'initialize embeddings')!.steps.find((s) => s.name === 'Insert Embedding')!;
  assert.equal(step.params?.ai?.accountName, 'GLOBAL::llm_account');
  assert.equal(step.params?.field?.field.name, 'embedding');
});

test('AI functions: CosineSimilarity in a calculation field', { skip }, () => {
  const table = FmpDatabase.open(unified).schema.tables.find((t) => t.name === 'EMBEDDING')!;
  assert.equal(table.fields.find((f) => f.name === 'cosine_similarity')?.calculation, 'CosineSimilarity ( embedding ; GLOBAL::semantic_input_embedding )');
});

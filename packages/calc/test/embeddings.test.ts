import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NameTable, embeddingFile, embeddingOf, evaluate, evaluateText, type CalcContext } from '../src/index.ts';

// FileMaker 2024's embedding functions: text is a JSON array, container data
// an .fve file ("FVE.2100" then little-endian float64s, as in Beezwax's demos).
const v1 = embeddingFile([0.6, 0.8], 'a.fve');
const ctx: CalcContext = { names: new NameTable({ fields: ['Emb'] }), field: (ref) => (ref.field === 'Emb' ? v1 : undefined) };
const t = (f: string) => evaluateText(f, ctx);
const close = (got: string, want: number[]) => {
  const a = JSON.parse(got) as number[];
  assert.equal(a.length, want.length);
  a.forEach((x, i) => assert.ok(Math.abs(x - want[i]) < 1e-12, `${got} vs ${want}`));
};

test('CosineSimilarity of text and container vectors', () => {
  assert.equal(t('CosineSimilarity ( "[1, 0]" ; "[0, 1]" )'), '0');
  assert.equal(t('CosineSimilarity ( "[0.6, 0.8]" ; Emb )'), '1');
  assert.equal(Number(t('CosineSimilarity ( "[1, 0]" ; Emb )')), 0.6);
  assert.equal(t('CosineSimilarity ( "[1, 0, 0]" ; Emb )'), '?');
  assert.equal(t('CosineSimilarity ( "not a vector" ; Emb )'), '?');
});

test('AddEmbeddings and SubtractEmbeddings return a unit vector in the first input\'s form', () => {
  // Claris's example: [0.40160966445124940405, 0.56225353023174917677, 0.722897396012249005]
  close(t('AddEmbeddings ( "[1, 2, 3]" ; "[4, 5, 6]" )'), [0.4016096644512494, 0.5622535302317492, 0.722897396012249]);
  close(t('SubtractEmbeddings ( "[4, 5, 6]" ; "[1, 2, 3]" )'), [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]);
  assert.equal(t('AddEmbeddings ( "[1, 2]" ; "[-1, -2]" )'), '?');
  const sum = evaluate('AddEmbeddings ( Emb ; Emb )', ctx);
  assert.equal(sum.type, 'container');
  assert.deepEqual(embeddingOf(sum)?.map((x) => +x.toFixed(12)), [0.6, 0.8]);
});

test('NormalizeEmbedding, GetEmbeddingAsText and GetEmbeddingAsFile', () => {
  close(t('NormalizeEmbedding ( "[3, 4, 12]" ; 2 )'), [0.6, 0.8]);
  close(t('NormalizeEmbedding ( "[3, 4]" )'), [0.6, 0.8]);
  // Out of range uses the whole vector.
  close(t('NormalizeEmbedding ( "[3, 4]" ; 3 )'), [0.6, 0.8]);
  close(t('NormalizeEmbedding ( "[3, 4]" ; 0 )'), [0.6, 0.8]);
  close(t('NormalizeEmbedding ( "[3, 4]" ; -2 )'), [0.6, 0.8]);
  assert.equal(t('GetEmbeddingAsText ( Emb )'), '[0.6,0.8]');
  const file = evaluate('GetEmbeddingAsFile ( "[0.6, 0.8]" ; "x.fve" )', ctx);
  assert.equal(file.type === 'container' && file.value, 'x.fve');
  assert.equal(new TextDecoder().decode(file.type === 'container' ? file.data!.subarray(0, 8) : undefined), 'FVE.2100');
  assert.equal(t('GetEmbeddingAsText ( GetEmbeddingAsFile ( "[0.6, 0.8]" ) )'), '[0.6,0.8]');
});

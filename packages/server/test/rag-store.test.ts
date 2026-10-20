// RAG spaces on disk: documents in chunks with vectors, searched by cosine similarity, one space per file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAG_CHUNK_LIMIT, RagStore } from '../src/rag.ts';

test('a space finds its closest chunks, belongs to its file, and replaces a document of the same name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-'));
  const rag = new RagStore(dir);
  try {
    const a = rag.add({ file: 'Shop', space: 's', name: 'a.txt', chunks: ['chairs', 'gardens'], vectors: [[1, 0], [0, 1]] });
    rag.add({ file: 'Other', space: 's', chunks: ['other file'], vectors: [[1, 0]] });
    const hits = rag.search({ file: 'Shop', space: 's', vector: [0.9, 0.1], top: 5, threshold: -1 });
    assert.deepEqual(hits.map((h) => h.text), ['chairs', 'gardens']);
    assert.equal(hits[0].document, a);
    // The threshold and the top count both cut the list; another file's chunks and other sizes of vector never count.
    assert.deepEqual(rag.search({ file: 'Shop', space: 's', vector: [0.9, 0.1], top: 5, threshold: 0.5 }).map((h) => h.text), ['chairs']);
    assert.equal(rag.search({ file: 'Shop', space: 's', vector: [0.9, 0.1], top: 1, threshold: -1 }).length, 1);
    // A space made with another embedding model says so, rather than finding nothing; adding to it is refused too.
    assert.throws(() => rag.search({ file: 'Shop', space: 's', vector: [1, 0, 0], top: 5, threshold: -1 }), /2-number vectors from another embedding model.*now gives 3/);
    assert.throws(() => rag.add({ file: 'Shop', space: 's', chunks: ['x'], vectors: [[1, 0, 0]] }), /another embedding model/);
    assert.equal(rag.search({ file: 'Shop', space: 'nope', vector: [1, 0], top: 5, threshold: -1 }).length, 0);
    // The same name again replaces the document and gives it a new id.
    const b = rag.add({ file: 'Shop', space: 's', name: 'a.txt', chunks: ['tables'], vectors: [[1, 0]] });
    assert.notEqual(a, b);
    assert.deepEqual(rag.search({ file: 'Shop', space: 's', vector: [1, 0], top: 5, threshold: -1 }).map((h) => h.text), ['tables']);
    // Removing by id, then everything in the space; the other file's space is untouched.
    assert.equal(rag.remove({ file: 'Shop', space: 's', ids: ['nope'] }), 0);
    assert.equal(rag.remove({ file: 'Shop', space: 's', ids: [b] }), 1);
    rag.add({ file: 'Shop', space: 's', chunks: ['x'], vectors: [[1, 0]] });
    assert.equal(rag.remove({ file: 'Shop', space: 's' }), 1);
    assert.equal(rag.search({ file: 'Other', space: 's', vector: [1, 0], top: 5, threshold: -1 }).length, 1);
  } finally {
    rag.close();
    rmSync(dir, { recursive: true });
  }
});

test('searched vectors are kept in memory, and what another process (or this one) changes is seen on the next search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-cache-'));
  const one = new RagStore(dir);
  const two = new RagStore(dir);
  try {
    const q = { file: 'F', space: 's', vector: [1, 0], top: 5, threshold: -1 };
    one.add({ file: 'F', space: 's', chunks: ['first'], vectors: [[1, 0]] });
    assert.deepEqual(one.search(q).map((h) => h.text), ['first']);
    // Another worker adds, then this one removes: both show on the very next search.
    const id = two.add({ file: 'F', space: 's', chunks: ['second'], vectors: [[0.9, 0.1]] });
    assert.deepEqual(one.search(q).map((h) => h.text), ['first', 'second']);
    one.remove({ file: 'F', space: 's', ids: [id] });
    assert.deepEqual(one.search(q).map((h) => h.text), ['first']);
    assert.deepEqual(two.search(q).map((h) => h.text), ['first']);
  } finally {
    one.close();
    two.close();
    rmSync(dir, { recursive: true });
  }
});

test('after the embedding model changes, removing a space\'s data lets it be filled again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-'));
  const rag = new RagStore(dir);
  try {
    rag.add({ file: 'Shop', space: 's', chunks: ['old'], vectors: [[1, 0]] });
    assert.throws(() => rag.search({ file: 'Shop', space: 's', vector: [1, 0, 0], top: 5, threshold: 0 }), /another embedding model/);
    rag.remove({ file: 'Shop', space: 's' });
    rag.add({ file: 'Shop', space: 's', chunks: ['new'], vectors: [[1, 0, 0]] });
    assert.deepEqual(rag.search({ file: 'Shop', space: 's', vector: [1, 0, 0], top: 5, threshold: 0 }).map((h) => h.text), ['new']);
    // A space with a matching vector but no hit above the threshold is just empty.
    assert.deepEqual(rag.search({ file: 'Shop', space: 's', vector: [0, 1, 0], top: 5, threshold: 0.9 }), []);
  } finally {
    rag.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spaces and their documents can be listed, with the model each was made with', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-'));
  const rag = new RagStore(dir);
  try {
    const a = rag.add({ file: 'Shop', space: 's1', name: 'a.txt', chunks: ['one', 'two'], vectors: [[1, 0], [0, 1]], model: 'nomic-embed-text' });
    const b = rag.add({ file: 'Shop', space: 's1', chunks: ['loose', 'text'], vectors: [[1, 0], [0, 1]], model: 'nomic-embed-text' });
    rag.add({ file: 'Shop', space: 's2', chunks: ['x'], vectors: [[1, 0]] });
    rag.add({ file: 'Other', space: 's9', chunks: ['y'], vectors: [[1, 0]], model: 'm' });
    assert.deepEqual(rag.spaces({ file: 'Shop' }), [{ space: 's1', model: 'nomic-embed-text' }, { space: 's2', model: '' }]);
    assert.deepEqual(rag.info({ file: 'Shop', space: 's1' }), { model: 'nomic-embed-text', entries: [{ id: a, filename: 'a.txt' }, { id: b, text: 'loose text' }] });
    assert.equal(rag.info({ file: 'Shop', space: 'nope' }), undefined);
    assert.equal(rag.info({ file: 'Other', space: 's1' }), undefined);
  } finally {
    rag.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a document\'s listed text is cut to 1,000 characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-'));
  const rag = new RagStore(dir);
  try {
    rag.add({ file: 'Shop', space: 's', chunks: ['a'.repeat(900), 'b'.repeat(900)], vectors: [[1, 0], [0, 1]] });
    const entry = rag.info({ file: 'Shop', space: 's' })!.entries[0] as { text: string };
    assert.equal(entry.text.length, 1000);
  } finally {
    rag.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a space holds at most RAG_CHUNK_LIMIT chunks: one more is refused whole, a replaced document frees its room, and a full space still searches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-'));
  const rag = new RagStore(dir);
  try {
    const fill = (n: number) => ({ chunks: Array.from({ length: n }, (_, i) => `c${i}`), vectors: Array.from({ length: n }, (_, i) => [1, i % 7]) });
    rag.add({ file: 'Shop', space: 's', name: 'big.txt', ...fill(RAG_CHUNK_LIMIT - 1) });
    rag.add({ file: 'Shop', space: 's', name: 'last.txt', chunks: ['last one'], vectors: [[0, 1]] });
    // Full: the next document is refused as a whole (none of its chunks are kept), and the message says what to do.
    assert.throws(() => rag.add({ file: 'Shop', space: 's', name: 'extra.txt', chunks: ['a', 'b'], vectors: [[1, 1], [1, 2]] }), /more than 50000 chunks.*remove documents first/);
    assert.equal(rag.info({ file: 'Shop', space: 's' })!.entries.length, 2);
    // The cap is per space and per file.
    rag.add({ file: 'Shop', space: 'other', chunks: ['x'], vectors: [[1, 0]] });
    rag.add({ file: 'Other', space: 's', chunks: ['y'], vectors: [[1, 0]] });
    // A full space still answers searches.
    assert.equal(rag.search({ file: 'Shop', space: 's', vector: [0, 1], top: 3, threshold: -1 }).length, 3);
    // Replacing a document of the same name counts only its new chunks, so re-adding the biggest one works.
    rag.add({ file: 'Shop', space: 's', name: 'big.txt', ...fill(RAG_CHUNK_LIMIT - 1) });
    // Removing a document makes room.
    const id = rag.info({ file: 'Shop', space: 's' })!.entries.find((e) => e.filename === 'last.txt')!.id;
    assert.equal(rag.remove({ file: 'Shop', space: 's', ids: [id] }), 1);
    rag.add({ file: 'Shop', space: 's', name: 'extra.txt', chunks: ['a'], vectors: [[1, 1]] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

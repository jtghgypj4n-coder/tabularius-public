// Retrieval quality on a generated corpus (no model, no files): vectors know a chunk's topic but not the part numbers in
// its text, as an embedding model often doesn't. Hybrid ranking has to find a chunk by its part number without losing
// the topic questions vector search already answers. The numbers below are a regression guard, not a benchmark of any model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RagStore, queryTerms } from '../src/rag.ts';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS = ['gardens', 'chairs', 'invoices', 'shipping', 'warranty', 'lighting'];
const DIMS = 32;
const PER_TOPIC = 50;

function corpus() {
  const r = rng(7);
  const noise = (scale: number) => Array.from({ length: DIMS }, () => (r() - 0.5) * 2 * scale);
  const centres = TOPICS.map(() => noise(1));
  const chunks: { text: string; vector: number[]; topic: number; part: string }[] = [];
  TOPICS.forEach((topic, t) => {
    for (let i = 0; i < PER_TOPIC; i++) {
      const part = `PART-${String(t * PER_TOPIC + i).padStart(4, '0')}`;
      const n = noise(0.4);
      chunks.push({ text: `Notes on ${topic}: ${part} is listed with its usual terms.`, vector: centres[t].map((x, k) => x + n[k]), topic: t, part });
    }
  });
  return { chunks, centres, noise };
}

test('hybrid ranking finds chunks by part number and keeps topic answers; keyword weight 0 changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-rag-hybrid-'));
  const rag = new RagStore(dir);
  try {
    const { chunks, centres, noise } = corpus();
    rag.add({ file: 'F', space: 's', chunks: chunks.map((c) => c.text), vectors: chunks.map((c) => c.vector) });
    const search = (query: string, vector: number[], keywordWeight?: number) =>
      rag.search({ file: 'F', space: 's', vector, top: 3, threshold: -1, ...(keywordWeight === undefined ? {} : { query, keywordWeight }) });

    // Part-number questions: the vector says nothing about which chunk, so only the words can.
    let vectorHits = 0;
    let hybridHits = 0;
    const picks = chunks.filter((_, i) => i % 6 === 0);
    for (const c of picks) {
      const question = `Where is ${c.part} used?`;
      const vector = noise(1);
      if (search(question, vector).some((h) => h.text.includes(c.part))) vectorHits++;
      if (search(question, vector, 0.5).some((h) => h.text.includes(c.part))) hybridHits++;
    }
    const recallVector = vectorHits / picks.length;
    const recallHybrid = hybridHits / picks.length;
    assert.ok(recallHybrid >= 0.95, `hybrid recall@3 on part numbers ${recallHybrid}`);
    assert.ok(recallVector < 0.3, `vector-only recall@3 on part numbers ${recallVector}: the corpus should not be answerable by vector alone`);

    // Topic questions: hybrid must stay as good as vector search.
    let topicVector = 0;
    let topicHybrid = 0;
    let asked = 0;
    TOPICS.forEach((topic, t) => {
      for (let q = 0; q < 10; q++) {
        const n = noise(0.3);
        const vector = centres[t].map((x, k) => x + n[k]);
        const question = `Tell me about ${topic}`;
        const own = (hs: { text: string }[]) => hs.filter((h) => h.text.includes(`on ${topic}:`)).length / hs.length;
        topicVector += own(search(question, vector));
        topicHybrid += own(search(question, vector, 0.3));
        asked++;
      }
    });
    assert.ok(topicVector / asked >= 0.95, `vector precision@3 on topics ${topicVector / asked}`);
    assert.ok(topicHybrid / asked >= topicVector / asked - 0.02, `hybrid precision@3 on topics ${topicHybrid / asked} fell below vector's ${topicVector / asked}`);

    // Weight 0 and no query are the plain vector search.
    const v = noise(1);
    assert.deepEqual(search('Where is PART-0001 used?', v, 0), search('', v));
  } finally {
    rag.close();
    rmSync(dir, { recursive: true });
  }
});

test('queryTerms keeps ids and names, drops filler and short words, and stops at eight', () => {
  assert.deepEqual(queryTerms('What is the status of PART-0042 for Müller & Co?'), ['status', 'part-0042', 'müller']);
  assert.deepEqual(queryTerms('a b the and'), []);
  assert.equal(queryTerms('one1 two2 three3 four4 five5 six66 seven7 eight8 nine99 ten100').length, 8);
});

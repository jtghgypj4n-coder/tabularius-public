// Hardening of the RAG store, chunking and the AI usage and credential files: no lone surrogates or oversized lines
// in chunks, non-ASCII words found whatever their case, empty searches and adds handled, odd old usage files and
// credential files reported instead of breaking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkText } from '../../scripts/src/ai.ts';
import { RagStore } from '../src/rag.ts';
import { AiUsage } from '../src/ai-usage.ts';
import { AiCredentials } from '../src/ai-credentials.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tabularius-r15-rag-'));
const lone = (s: string) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

test('chunkText cuts a long word between characters, not inside an emoji, and splits a long JSONL line', () => {
  const word = '😀'.repeat(50);
  for (const tokens of [1, 2, 3]) {
    const chunks = chunkText(`${word} tail`, tokens);
    assert.ok(chunks.length > 2, String(tokens));
    for (const c of chunks) assert.ok(!lone(c), `${tokens}: ${JSON.stringify(c)}`);
    assert.equal(chunks.join('').replace(/\s/g, ''), `${word}tail`);
  }
  const line = JSON.stringify({ text: 'word '.repeat(100).trim() });
  const pieces = chunkText(`${line}\n{"a":1}\n`, 20, true);
  assert.ok(pieces.length > 2);
  assert.ok(pieces.every((p) => p.length <= 80), pieces.map((p) => p.length).join(','));
  assert.equal(pieces.at(-1), '{"a":1}');
  assert.deepEqual(chunkText('{"a":1}\n{"b":2}', 20, true), ['{"a":1}', '{"b":2}']);
});

test('the keyword half of a search finds a non-ASCII word whatever its case', () => {
  const dir = tmp();
  const store = new RagStore(dir);
  try {
    const file = 'F';
    // Sixty chunks the vector prefers, so the two with the words can come in only through the keyword half.
    const filler = Array.from({ length: 60 }, (_, i) => `füllung ${i}`);
    store.add({ file, space: 's', name: 'a', chunks: ['Herr MÜLLER wohnt in Köln', 'ÉCOLE de Paris', ...filler], vectors: [[1, 0], [1, 0], ...filler.map(() => [0, 1])] });
    const found = (query: string) => store.search({ file, space: 's', vector: [0, 1], top: 1, threshold: -1, query, keywordWeight: 1 }).map((r) => r.text);
    assert.deepEqual(found('müller'), ['Herr MÜLLER wohnt in Köln']);
    assert.deepEqual(found('MÜLLER'), ['Herr MÜLLER wohnt in Köln']);
    assert.deepEqual(found('école'), ['ÉCOLE de Paris']);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('search with top 0 answers nothing, and adding no chunks is refused without removing the old document', () => {
  const dir = tmp();
  const store = new RagStore(dir);
  try {
    const file = 'F';
    store.add({ file, space: 's', name: 'doc.txt', chunks: ['hello world'], vectors: [[1, 0]] });
    for (const top of [0, -1, Number.NaN]) {
      assert.deepEqual(store.search({ file, space: 's', vector: [1, 0], top, threshold: 0 }), []);
      assert.deepEqual(store.search({ file, space: 's', vector: [1, 0], top, threshold: 0, query: 'hello', keywordWeight: 0.5 }), []);
    }
    assert.throws(() => store.add({ file, space: 's', name: 'doc.txt', chunks: [], vectors: [] }), /no text/);
    assert.equal(store.info({ file, space: 's' })!.entries.length, 1, 'the old document is still there');
    assert.equal(store.search({ file, space: 's', vector: [1, 0], top: 1, threshold: 0 })[0].text, 'hello world');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('an older usage file that holds null, a number or text is skipped once, and usage still works', () => {
  for (const content of ['null', '5', '"x"', '[]']) {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.openhbam-ai-usage.json'), content);
      const usage = new AiUsage(dir);
      usage.add('Charts/clerk', 10, 0.001);
      assert.equal(usage.today('Charts/clerk'), 10, content);
      usage.close();
      // Read again: the import is not tried again and nothing is lost.
      const again = new AiUsage(dir);
      assert.equal(again.today('Charts/clerk'), 10, content);
      again.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a key file with a space or line break inside, and a workspace file that is not an id, are reported the same way', { skip: process.platform === 'win32' }, () => {
  const dir = tmp();
  let t = 1_000_000;
  let mtime = 1_700_000_000;
  const write = (file: string, text: string) => {
    writeFileSync(file, text, { mode: 0o600 });
    chmodSync(file, 0o600);
    mtime += 10;
    utimesSync(file, mtime, mtime);
  };
  try {
    const keyFile = join(dir, 'key');
    const workspaceFile = join(dir, 'ws');
    write(keyFile, 'sk-good\n');
    write(workspaceFile, 'wrkspc_ok\n');
    const c = new AiCredentials({ keyFile, apiKey: 'sk-good', workspaceFile, now: () => t });
    assert.equal(c.workspaceId, 'wrkspc_ok');
    assert.equal(c.problem, undefined);
    t += 1500;
    write(keyFile, 'sk-bad key\nsecond line\n');
    assert.equal(c.apiKey, 'sk-good', 'the previous key stays');
    assert.match(c.problem ?? '', /key file was not used.*inside/);
    assert.doesNotMatch(c.problem ?? '', /sk-bad/);
    t += 1500;
    write(keyFile, 'sk-fixed\n');
    assert.equal(c.apiKey, 'sk-fixed');
    assert.equal(c.problem, undefined);
    t += 1500;
    write(workspaceFile, 'not an id\n');
    assert.equal(c.workspaceId, undefined, 'the options had no workspace id');
    assert.match(c.problem ?? '', /workspace file was not used/);
    t += 1500;
    write(workspaceFile, 'wrkspc_next\n');
    assert.equal(c.workspaceId, 'wrkspc_next');
    assert.equal(c.problem, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Script embeddings on a server started with an embedding model (--ai-embed-url / --ai-embed-model): Insert
// Embedding and GetEmbedding call an OpenAI-compatible /embeddings endpoint, the file's own model and key are
// never sent, and without the setting the steps stop saying so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '../../fmp12/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let embedder: Server;
let withEmbed: Awaited<ReturnType<typeof serve>>;
let without: Awaited<ReturnType<typeof serve>>;
let local: Awaited<ReturnType<typeof serve>>;
let dir3: string;
let dir2: string;
const asked: { url: string; auth?: string; body: { model: string; input: string[] } }[] = [];

before(async () => {
  if (skip) return;
  embedder = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { model: string; input: string[] };
      asked.push({ url: req.url!, auth: req.headers.authorization, body: parsed });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        // Out of order on purpose: the index says which text each vector belongs to.
        data: parsed.input.map((t, i) => ({ index: i, embedding: [t.length, 1] })).reverse(),
        usage: { prompt_tokens: 7 },
      }));
    });
  });
  await new Promise<void>((r) => embedder.listen(0, '127.0.0.1', r));
  const port = (embedder.address() as { port: number }).port;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-embed-'));
  dir2 = mkdtempSync(join(tmpdir(), 'tabularius-embed-off-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir2, 'Charts.fmp12'));
  withEmbed = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'k', embedUrl: `http://127.0.0.1:${port}/v1/`, embedModel: 'nomic-embed-text', embedKey: 'embed-secret' } });
  without = await serve({ dir: dir2, port: 0, log: () => {}, ai: { apiKey: 'k' } });
  // A local embedding model on its own: no Anthropic key, no embedding key.
  dir3 = mkdtempSync(join(tmpdir(), 'tabularius-embed-local-'));
  copyFileSync(fixture, join(dir3, 'Charts.fmp12'));
  local = await serve({ dir: dir3, port: 0, log: () => {}, ai: { apiKey: '', embedUrl: `http://127.0.0.1:${port}/v1`, embedModel: 'nomic-embed-text' } });
});
after(async () => {
  await new Promise<void>((r) => (withEmbed ? withEmbed.server.close(() => r()) : r()));
  await new Promise<void>((r) => (without ? without.server.close(() => r()) : r()));
  await new Promise<void>((r) => (local ? local.server.close(() => r()) : r()));
  if (dir3) rmSync(dir3, { recursive: true, force: true });
  embedder?.close();
  for (const d of [dir, dir2]) if (d) rmSync(d, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const embed: Script = {
  id: 9998, name: 'embed', steps: [
    step(212, 'Configure AI Account', { ai: { accountName: '"acct"', apiKey: '"sk-from-the-file"' } }),
    step(215, 'Insert Embedding', { ai: { accountName: '"acct"', model: '"text-embedding-3-small"', input: '"hello"' }, variable: '$v' }),
    step(103, 'Exit Script', { calculation: 'Length ( $v ) > 0' }),
  ],
} as Script;

test('Insert Embedding calls the configured embedding endpoint with its model and key, not the file\'s', { skip }, async () => {
  const before = asked.length;
  const store = withEmbed.host.get('Charts')!;
  const r = await runScript(store, embed, withEmbed.host.scriptOptions());
  assert.equal(r.error, 0);
  assert.equal(asked.length, before + 1);
  const call = asked.at(-1)!;
  assert.equal(call.url, '/v1/embeddings');
  assert.equal(call.auth, 'Bearer embed-secret');
  assert.equal(call.body.model, 'nomic-embed-text');
  assert.deepEqual(call.body.input, ['hello']);
  assert.doesNotMatch(JSON.stringify(call), /sk-from-the-file|text-embedding-3-small/);
});

test('without an embedding model on the server, Insert Embedding stops and says so', { skip }, async () => {
  const store = without.host.get('Charts')!;
  const r = await runScript(store, embed, { ...without.host.scriptOptions(), trace: true });
  assert.equal(r.error, 3);
  assert.match(r.trace!.find((t) => t.message)!.message!, /embedding model/);
});

test('a local embedding model works with no Anthropic key and sends no authorization', { skip }, async () => {
  const before = asked.length;
  const store = local.host.get('Charts')!;
  const r = await runScript(store, embed, local.host.scriptOptions());
  assert.equal(r.error, 0);
  assert.equal(asked.length, before + 1);
  assert.equal(asked.at(-1)!.auth, undefined);
});

test('with an embedding model only, the steps that ask a model say it is off', { skip }, async () => {
  const store = local.host.get('Charts')!;
  const ask: Script = { id: 9997, name: 'ask', steps: [
    step(212, 'Configure AI Account', { ai: { accountName: '"acct"', apiKey: '"x"' } }),
    step(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: '"hi"' }, variable: '$r' }),
  ] } as Script;
  const r = await runScript(store, ask, { ...local.host.scriptOptions(), trace: true });
  assert.notEqual(r.error, 0);
  assert.match(JSON.stringify(r.trace), /embedding model only|AI model is off/);
});

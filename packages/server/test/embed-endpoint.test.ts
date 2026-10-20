// The embedding endpoint settings (presets for Ollama and LM Studio) and the probe `tabularius doctor` uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { probeEmbedding, resolveEmbedEndpoint } from '../src/embed-endpoint.ts';

const stub = async (t: { after: (fn: () => void) => void }, answer: (model: string) => [number, unknown]) => {
  const seen: { auth?: string; body: { model: string; input: string[] } }[] = [];
  const server: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      seen.push({ auth: req.headers.authorization, body });
      const [status, payload] = answer(body.model);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, seen };
};

test('ollama and lmstudio are enough, with a default model; a URL needs its model', () => {
  assert.deepEqual(resolveEmbedEndpoint('ollama', undefined), { url: 'http://localhost:11434/v1', model: 'nomic-embed-text' });
  assert.deepEqual(resolveEmbedEndpoint('LMStudio', 'my-model'), { url: 'http://localhost:1234/v1', model: 'my-model' });
  assert.deepEqual(resolveEmbedEndpoint('https://api.example.com/v1', 'm', 'k'), { url: 'https://api.example.com/v1', model: 'm', key: 'k' });
  assert.equal(resolveEmbedEndpoint(undefined, undefined), undefined);
  assert.throws(() => resolveEmbedEndpoint('http://x/v1', undefined), /go together/);
  assert.throws(() => resolveEmbedEndpoint(undefined, 'm'), /needs --ai-embed-url/);
  assert.throws(() => resolveEmbedEndpoint('localhost:11434', 'm'), /ollama, lmstudio or an http/);
});

test('the probe says how long the vectors are', async (t) => {
  const s = await stub(t, () => [200, { data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }]);
  const r = await probeEmbedding({ url: s.url, model: 'm', key: 'secret' });
  assert.equal(r.dimensions, 3);
  assert.equal(s.seen[0]!.auth, 'Bearer secret');
  assert.deepEqual(s.seen[0]!.body.input, ['hello']);
});

test('the probe names an unknown model, a model that is not an embedding model, and a server that is not there', async (t) => {
  const s = await stub(t, (m) => m === 'gone' ? [404, { error: { message: 'model "gone" not found, try pulling it first' } }] : [200, { data: [{ index: 0 }] }]);
  await assert.rejects(probeEmbedding({ url: s.url, model: 'gone' }), /not found, try pulling/);
  await assert.rejects(probeEmbedding({ url: s.url, model: 'chat' }), /not with a vector/);
  await assert.rejects(probeEmbedding({ url: 'http://127.0.0.1:1/v1', model: 'm' }, 2000), /can't reach/);
});

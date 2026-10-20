import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { IMAGE_EMBED_PROVIDERS, resolveImageEmbed } from '../src/image-embed.ts';

test('resolveImageEmbed: nothing asked for, nothing set; a provider needs its key', () => {
  assert.equal(resolveImageEmbed(undefined, undefined, undefined), undefined);
  assert.throws(() => resolveImageEmbed(undefined, 'm', undefined), /needs --ai-image-embed/);
  assert.throws(() => resolveImageEmbed('nope', undefined, 'k'), /voyage, jina/);
  assert.equal(resolveImageEmbed('jina', undefined, 'k')!.model, 'jina-clip-v2');
  assert.throws(() => resolveImageEmbed('voyage', undefined, undefined), /TABULARIUS_AI_IMAGE_EMBED_KEY/);
  const e = resolveImageEmbed('Voyage', undefined, 'k')!;
  assert.equal(e.provider.id, 'voyage');
  assert.equal(e.model, 'voyage-multimodal-3');
  assert.equal(resolveImageEmbed('voyage', 'other', 'k')!.model, 'other');
});

test('the Voyage provider sends each picture as base64 and reads the vectors in order', async () => {
  let seen: { auth?: string; body: { model: string; inputs: { content: { type: string; image_base64: string }[] }[] } } | undefined;
  const real = globalThis.fetch;
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(b) };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [1, 0] }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => real(`http://127.0.0.1:${port}/`, init)) as typeof fetch;
  try {
    const out = await IMAGE_EMBED_PROVIDERS.voyage.embed({ model: 'voyage-multimodal-3', key: 'k', images: [{ mime: 'image/png', data: new Uint8Array([1, 2]) }, { mime: 'image/jpeg', data: new Uint8Array([3]) }], signal: AbortSignal.timeout(5000) });
    assert.deepEqual(out, [[1, 0], [0, 2]]);
    assert.equal(seen!.auth, 'Bearer k');
    assert.equal(seen!.body.inputs[0].content[0].image_base64, 'data:image/png;base64,AQI=');
    assert.equal(seen!.body.inputs[1].content[0].image_base64, 'data:image/jpeg;base64,Aw==');
  } finally {
    globalThis.fetch = real;
    srv.close();
  }
});

test('the Jina provider sends each picture as base64 and reads the vectors in order', async () => {
  let seen: { url?: string; auth?: string; body: { model: string; input: { image: string }[] } } | undefined;
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen = { url: String(url), auth: (init?.headers as Record<string, string>).authorization, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [1, 0] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const out = await IMAGE_EMBED_PROVIDERS.jina.embed({ model: 'jina-clip-v2', key: 'k', images: [{ mime: 'image/png', data: new Uint8Array([1, 2]) }, { mime: 'image/jpeg', data: new Uint8Array([3]) }], signal: AbortSignal.timeout(5000) });
    assert.deepEqual(out, [[1, 0], [0, 2]]);
    assert.equal(seen!.url, 'https://api.jina.ai/v1/embeddings');
    assert.equal(seen!.auth, 'Bearer k');
    assert.deepEqual(seen!.body, { model: 'jina-clip-v2', input: [{ image: 'AQI=' }, { image: 'Aw==' }] });
  } finally {
    globalThis.fetch = real;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { etagMatches } from '../src/conditional.ts';
import { serve } from '../src/index.ts';

test('If-None-Match: a listed ETag, a weak one or * matches; another does not', () => {
  assert.equal(etagMatches(undefined, '"a"'), false);
  assert.equal(etagMatches('"a"', '"a"'), true);
  assert.equal(etagMatches('W/"a"', '"a"'), true);
  assert.equal(etagMatches('"b", "a"', '"a"'), true);
  assert.equal(etagMatches('*', '"a"'), true);
  assert.equal(etagMatches('"b"', '"a"'), false);
});

test('/app/, /docs and /admin/ send an ETag, and answer 304 with no body when the browser has that version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-etag-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    for (const path of ['/app/', '/app/app.css', '/docs', '/docs/design-mode', '/admin/']) {
      const first = await fetch(`${s.url}${path}`);
      assert.equal(first.status, 200, path);
      const etag = first.headers.get('etag');
      assert.match(etag ?? '', /^"[\w-]+"$/, path);
      await first.arrayBuffer();
      const again = await fetch(`${s.url}${path}`, { headers: { 'if-none-match': etag! } });
      assert.equal(again.status, 304, path);
      assert.equal(again.headers.get('etag'), etag, path);
      assert.equal(again.headers.get('cache-control'), first.headers.get('cache-control'), path);
      assert.equal((await again.arrayBuffer()).byteLength, 0, path);
      const other = await fetch(`${s.url}${path}`, { headers: { 'if-none-match': '"stale"' } });
      assert.equal(other.status, 200, path);
    }
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true });
  }
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-headers-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

test('the web app page cannot be framed by another site and sends no referrer', async () => {
  const res = await fetch(`${base}/app/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-src 'self' about: data: blob:/);
  // No plug-ins, no re-pointing of relative links with a base tag, no form posting off the site.
  assert.match(res.headers.get('content-security-policy') ?? '', /object-src 'none'; base-uri 'self'; form-action 'self'/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const icon = await fetch(`${base}/app/favicon.svg`);
  assert.equal(icon.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(icon.headers.get('x-frame-options'), null);
});

test('the documentation pages are not framable and run no scripts', async () => {
  for (const path of ['/docs']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', path);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, path);
  }
  assert.equal((await fetch(`${base}/docs`)).status, 200);
});

test('/favicon.ico leads to the app icon', async () => {
  const res = await fetch(`${base}/favicon.ico`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/app/favicon.svg');
  const icon = await fetch(`${base}/app/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type') ?? '', /svg/);
});

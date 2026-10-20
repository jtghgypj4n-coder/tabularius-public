import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, serveCluster } from '../src/index.ts';
import { validatePublicUrl, urlHostname } from '../src/public-origin.ts';

test('public URLs accept HTTP and HTTPS origins with an optional trailing slash', () => {
  for (const value of [undefined, 'https://files.example.com', 'https://files.example.com/', 'http://localhost:8080', 'https://[::1]:8443/', 'HTTPS://FILES.EXAMPLE.COM:443/']) {
    assert.doesNotThrow(() => validatePublicUrl(value), String(value));
  }
});

test('serve and serveCluster reject invalid public URLs before touching the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-public-url-'));
  try {
    for (const publicUrl of [
      '', 'example.com', '//files.example.com', 'https:files.example.com', 'https:///files.example.com',
      'ftp://files.example.com', 'https://', 'https://files.example.com:99999',
      'https://files.example.com/path', 'https://files.example.com//', 'https://files.example.com/.',
      'https://files.example.com/%2e', 'https://files.example.com?', 'https://files.example.com#',
      'https://files.example.com/?query', 'https://files.example.com/#fragment',
      'https://user:password@files.example.com', ' https://files.example.com', 'https://files.example.com\n',
      'https://files.example.com\\path',
    ]) {
      const opts = { dir, port: 0, watch: false, log: () => {}, publicUrl };
      const message = /give a full address such as https:\/\/files\.example\.com/;
      await assert.rejects(serve(opts), message, publicUrl);
      await assert.rejects(serveCluster(opts, 2), message, publicUrl);
      assert.deepEqual(readdirSync(dir), [], 'invalid configuration must not start the server');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve starts with a valid HTTPS public URL, including a trailing slash', async () => {
  for (const publicUrl of ['https://files.example.com', 'https://files.example.com/']) {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-public-url-'));
    try {
      const s = await serve({ dir, port: 0, watch: false, log: () => {}, publicUrl });
      try {
        assert.equal(s.server.listening, true);
        assert.equal(s.host.publicUrl, publicUrl);
      } finally {
        await new Promise<void>((resolve) => s.server.close(() => resolve()));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  }
});


test('URL hostnames bracket IPv6 literals exactly once', () => {
  for (const [host, expected] of [['::1', '[::1]'], ['::', '[::]'], ['[::1]', '[::1]'], ['127.0.0.1', '127.0.0.1'], ['localhost', 'localhost']]) {
    assert.equal(urlHostname(host), expected);
  }
});

for (const clustered of [false, true]) {
  test(`${clustered ? 'cluster' : 'single server'} starts on IPv6 with a valid default URL`, { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-ipv6-url-'));
    try {
      const opts = { dir, hostname: '::1', port: 0, watch: false, log: () => {} };
      const s = clustered ? await serveCluster(opts, 2) : await serve(opts);
      try {
        assert.match(s.url, /^http:\/\/\[::1\]:\d+$/);
        validatePublicUrl(s.url);
        const r = await fetch(`${s.url}/.well-known/oauth-authorization-server`);
        assert.equal(r.status, 200);
        assert.equal((await r.json()).issuer, s.url);
      } finally {
        if ('close' in s) await s.close();
        else await new Promise<void>((resolve) => s.server.close(() => resolve()));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
}

test('an IDN public URL gives an ASCII OAuth challenge and matching discovery origins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-idn-url-'));
  try {
    const s = await serve({ dir, port: 0, watch: false, log: () => {}, publicUrl: 'HTTPS://例え.テスト:443/', mcpToken: 'secret' });
    try {
      const origin = 'https://xn--r8jz45g.xn--zckzah';
      for (const authorization of [undefined, 'Bearer invalid']) {
        const r = await fetch(`${s.url}/mcp`, { headers: authorization ? { authorization } : {} });
        assert.equal(r.status, 401);
        assert.ok(r.headers.get('www-authenticate')?.includes(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`));
        await r.text();
      }
      const resource = await fetch(`${s.url}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json());
      assert.equal(resource.resource, `${origin}/mcp`);
      const discovery = await fetch(`${s.url}/.well-known/oauth-authorization-server`).then((r) => r.json());
      assert.equal(discovery.issuer, origin);
      assert.equal(discovery.authorization_endpoint, `${origin}/oauth/authorize`);
    } finally {
      await new Promise<void>((resolve) => s.server.close(() => resolve()));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

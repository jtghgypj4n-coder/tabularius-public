import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host, ServeOptions } from '../src/index.ts';
import { acmeOrigins, mcpOriginAllowed } from '../src/public-origin.ts';
import { McpTokens } from '../src/mcp-tokens.ts';

async function start(t: TestContext, options: Partial<ServeOptions> = {}, setup?: (host: Host) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-origin-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, ...options });
  t.after(async () => {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  setup?.(s.host);
  return s.url;
}

// node:http preserves an explicit Host so LAN addresses can be tested on a loopback listener.
const rpc = (base: string, headers: Record<string, string> = {}, call: { method: string; params?: object } = { method: 'ping' }): Promise<Response> => new Promise((resolve, reject) => {
  const req = request(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
  }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('error', reject);
    res.on('end', () => resolve(new Response(Buffer.concat(chunks), {
      status: res.statusCode!, headers: { 'content-type': res.headers['content-type'] ?? '' },
    })));
  });
  req.on('error', reject);
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, ...call }));
});

async function refused(res: Response) {
  assert.equal(res.status, 403);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { jsonrpc: '2.0', error: { code: -32000, message: 'Invalid Origin header' }, id: null });
}

test('/mcp allows its own Origin and no Origin, and refuses foreign or malformed origins', async (t) => {
  const base = await start(t);
  for (const headers of [{ origin: base }, undefined]) {
    const res = await rpc(base, headers);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
  }
  for (const origin of ['https://foreign.example', base.replace('http:', 'https:'), `${base}0`, 'null', '', `${base}/path`, `${base}#fragment`, `${base}?query`, `${base} https://foreign.example`, base.replace('://', '://user@')]) {
    await refused(await rpc(base, { origin }));
  }
  for (const method of ['GET', 'DELETE', 'OPTIONS']) {
    await refused(await fetch(`${base}/mcp`, { method, headers: { origin: 'https://foreign.example' } }));
  }
});

test('/mcp uses the public origin behind a proxy, including scheme and default ports', async (t) => {
  for (const scheme of ['http', 'https']) {
    const base = await start(t, { publicUrl: `${scheme}://files.example/`, mcpToken: 'secret' });
    const headers = { authorization: 'Bearer secret', 'x-forwarded-for': '203.0.113.9', 'x-forwarded-host': 'foreign.example', 'x-forwarded-proto': scheme === 'https' ? 'http' : 'https' };
    for (const origin of [`${scheme}://files.example`, `${scheme}://FILES.EXAMPLE:${scheme === 'https' ? 443 : 80}`]) {
      const res = await rpc(base, { ...headers, origin });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
    }
    for (const origin of [base, `${scheme}://files.example:8443`, `${scheme === 'https' ? 'http' : 'https'}://files.example`, `${scheme}://foreign.example`]) {
      await refused(await rpc(base, { ...headers, origin }));
    }
    assert.equal((await rpc(base, headers)).status, 200);
    assert.equal((await rpc(base, { origin: `${scheme}://files.example` })).status, 401);
  }
});

test('/mcp permits explicitly listed origins without bypassing authentication', async (t) => {
  const base = await start(t, { mcpAllowedOrigins: ['https://app.example:443'], mcpToken: 'secret' });
  const origin = 'https://app.example';
  assert.equal((await rpc(base, { origin, authorization: 'Bearer secret' })).status, 200);
  assert.equal((await rpc(base, { origin })).status, 401);
  await refused(await rpc(base, { origin: 'https://other.example', authorization: 'Bearer secret' }));
});

test('/mcp with a public URL allows the direct local/IP admin console check, but refuses it through a proxy', async (t) => {
  const base = await start(t, { publicUrl: 'https://files.example', mcpToken: 'secret' });
  const calls = [
    { method: 'ping' },
    { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tabularius-admin-check', version: '1' } } },
    { method: 'tools/list', params: {} },
    { method: 'tools/call', params: { name: 'list_databases', arguments: {} } },
  ];
  for (const host of ['127.0.0.1:8080', 'localhost:8080', '192.168.1.201:8080']) {
    const headers = { host, origin: `http://${host}`, authorization: 'Bearer secret' };
    for (const call of calls) {
      const res = await rpc(base, headers, call);
      assert.equal(res.status, 200, `${host} ${call.method}`);
      const body = await res.json();
      assert.ok(body.result && !body.result.isError, JSON.stringify(body));
      for (const proxy of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
        for (const value of ['', '203.0.113.9']) {
          await refused(await rpc(base, { ...headers, [proxy]: value }, call));
        }
      }
    }
    assert.equal((await rpc(base, { host, origin: headers.origin })).status, 401);
  }
});

test('/mcp accepts the public URL and allowlist together, including through a proxy', async (t) => {
  const base = await start(t, { publicUrl: 'https://files.example/', mcpAllowedOrigins: ['https://app.example:443'], mcpToken: 'secret' });
  const proxies: Record<string, string>[] = [{}, { 'x-forwarded-for': '203.0.113.9' }];
  for (const proxy of proxies) {
    for (const origin of ['https://files.example', 'https://app.example']) {
      assert.equal((await rpc(base, { ...proxy, origin, authorization: 'Bearer secret' })).status, 200);
      assert.equal((await rpc(base, { ...proxy, origin })).status, 401);
    }
    await refused(await rpc(base, { ...proxy, origin: 'https://other.example', authorization: 'Bearer secret' }));
  }
});

test('/mcp rejects foreign origins for valid Basic, scoped and OAuth credentials', async (t) => {
  const credentials = ['Basic ' + Buffer.from('Ann:secret').toString('base64')];
  const publicUrl = 'https://files.example';
  const base = await start(t, { publicUrl, mcpToken: 'admin-secret' }, (host) => {
    const store = host.create('Local');
    store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
    store.setPassword('Ann', 'secret', 'Bot');
    credentials.push(`Bearer ${store.createApiToken('Ann', { surfaces: ['fmmcp'], readOnly: true })}`);
    credentials.push(`Bearer ${new McpTokens(host.dir).create({ database: 'Local', account: 'Ann' }).token}`);
  });
  const redirect = 'https://app.example/callback';
  const registration = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Origin test', redirect_uris: [redirect] }),
  });
  assert.equal(registration.status, 201);
  const { client_id } = await registration.json();
  const verifier = 'a'.repeat(43);
  const post = (path: string, fields: Record<string, string>) => fetch(`${base}${path}`, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(fields),
  });
  const signIn = await post('/oauth/authorize', {
    client_id, redirect_uri: redirect, response_type: 'code', resource: `${publicUrl}/mcp`,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    database: 'Local', account: 'Ann', password: 'secret',
  });
  assert.equal(signIn.status, 302, await signIn.text());
  const code = new URL(signIn.headers.get('location')!).searchParams.get('code')!;
  const tokens = await post('/oauth/token', { grant_type: 'authorization_code', client_id, code, code_verifier: verifier, redirect_uri: redirect });
  assert.equal(tokens.status, 200);
  credentials.push(`Bearer ${(await tokens.json()).access_token}`);
  for (const authorization of credentials) {
    const res = await rpc(base, { authorization, origin: base }, { method: 'tools/call', params: { name: 'list_databases', arguments: {} } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.result && !body.result.isError, JSON.stringify(body));
    for (const origin of ['https://foreign.example', 'http://rebind.example']) {
      await refused(await rpc(base, { authorization, origin }));
    }
  }
});

test('/mcp does not trust forwarded origins or a cluster default URL', async (t) => {
  const base = await start(t, { publicUrl: 'https://foreign.example', publicUrlIsDefault: true, mcpToken: 'secret' });
  const headers = { authorization: 'Bearer secret', 'x-forwarded-host': 'foreign.example', 'x-forwarded-proto': 'https' };
  await refused(await rpc(base, { ...headers, origin: 'https://foreign.example' }));
  assert.equal((await rpc(base, { ...headers, origin: base })).status, 200);
});

test('MCP local origins use the connection scheme and loopback Host, with default ports normalized', () => {
  const req = (host: string, origin: string, encrypted = false) => ({ headers: { host, origin }, socket: { encrypted } }) as unknown as IncomingMessage;
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
    assert.equal(mcpOriginAllowed(req(`${host}:80`, `http://${host}`)), true);
    assert.equal(mcpOriginAllowed(req(host, `http://${host}:80`)), true);
    assert.equal(mcpOriginAllowed(req(`${host}:443`, `https://${host}`, true)), true);
    assert.equal(mcpOriginAllowed(req(host, `https://${host}:443`, true)), true);
    assert.equal(mcpOriginAllowed(req(`${host}:443`, `https://${host}`)), false);
    assert.equal(mcpOriginAllowed(req(`${host}:8080`, `http://${host}:8081`)), false);
  }
  assert.equal(mcpOriginAllowed(req('foreign.example', 'http://foreign.example')), false);
  assert.equal(mcpOriginAllowed(req('', 'http://localhost')), false);
  assert.throws(() => mcpOriginAllowed(req('localhost', 'http://localhost'), 'not a URL'), TypeError);
});

test('MCP permits same-origin LAN IP literals over HTTP and HTTPS, with default ports normalized', () => {
  for (const host of ['192.168.1.201', '10.0.0.5', '[fd00::201]', '[2001:db8::201]']) {
    for (const scheme of ['http', 'https']) {
      const req = (hostHeader: string, origin: string) => ({
        headers: { host: hostHeader, origin }, socket: { encrypted: scheme === 'https' },
      }) as unknown as IncomingMessage;
      const port = scheme === 'https' ? 443 : 80;
      assert.equal(mcpOriginAllowed(req(`${host}:8090`, `${scheme}://${host}:8090`)), true);
      assert.equal(mcpOriginAllowed(req(`${host}:${port}`, `${scheme}://${host}`)), true);
      assert.equal(mcpOriginAllowed(req(host, `${scheme}://${host}:${port}`)), true);
      assert.equal(mcpOriginAllowed(req(`${host}:8090`, `${scheme}://${host}:8091`)), false);
      assert.equal(mcpOriginAllowed(req(`${host}:8090`, `${scheme === 'https' ? 'http' : 'https'}://${host}:8090`)), false);
      assert.equal(mcpOriginAllowed(req(`${host}:8090`, `${scheme}://192.168.1.202:8090`)), false);
    }
  }
});

test('MCP refuses same-origin arbitrary DNS names unless public or explicitly allowed', () => {
  for (const hostname of ['foreign.example', '192.168.1.201.example', 'localhost.example']) {
    for (const scheme of ['http', 'https']) {
      const origin = `${scheme}://${hostname}:8090`;
      const req = { headers: { host: `${hostname}:8090`, origin }, socket: { encrypted: scheme === 'https' } } as unknown as IncomingMessage;
      assert.equal(mcpOriginAllowed(req), false);
      assert.equal(mcpOriginAllowed(req, 'https://files.example'), false);
      assert.equal(mcpOriginAllowed(req, `${origin}/mount/`), true);
      assert.equal(mcpOriginAllowed(req, undefined, [origin]), true);
    }
  }
});

test('MCP public URL fallback checks numeric IPs, connection scheme and proxy-header presence regardless of peer', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '192.168.1.201', '[::1]', '[::ffff:127.0.0.1]', '[fd00::201]', '2130706433', '0177.0.0.1', '0x7f000001']) {
    for (const encrypted of [false, true]) {
      const origin = `${encrypted ? 'https' : 'http'}://${host}:8080`;
      for (const remoteAddress of ['127.0.0.1', '192.168.1.9']) {
        const req = { headers: { host: `${host}:8080`, origin }, socket: { encrypted, remoteAddress } } as unknown as IncomingMessage;
        assert.equal(mcpOriginAllowed(req, 'https://files.example'), true, origin);
        for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
          for (const value of ['', '203.0.113.9']) {
            const proxied = { ...req, headers: { ...req.headers, [header]: value } } as IncomingMessage;
            assert.equal(mcpOriginAllowed(proxied, 'https://files.example'), false, `${origin} ${header}`);
            // No public URL retains the existing same-origin policy, even with proxy headers.
            assert.equal(mcpOriginAllowed(proxied), true);
            assert.equal(mcpOriginAllowed(proxied, 'https://files.example', [origin]), true);
          }
        }
        req.socket = { encrypted: !encrypted } as unknown as IncomingMessage['socket'];
        assert.equal(mcpOriginAllowed(req, 'https://files.example'), false);
      }
    }
  }
});

test('the domains --https gets a certificate for are origins the console may call /mcp from', () => {
  assert.deepEqual(acmeOrigins(['files.example.com', 'www.example.com'], 443), ['https://files.example.com', 'https://www.example.com']);
  assert.deepEqual(acmeOrigins(['files.example.com'], 8443), ['https://files.example.com:8443']);
  const req = (host: string, origin: string) => ({ headers: { host, origin }, socket: { encrypted: true } }) as unknown as IncomingMessage;
  const allowed = acmeOrigins(['files.example.com'], 443);
  // The console on its own name works; a rebound or foreign page, another port, or plain http does not.
  assert.equal(mcpOriginAllowed(req('files.example.com', 'https://files.example.com'), undefined, allowed), true);
  assert.equal(mcpOriginAllowed(req('files.example.com', 'https://files.example.com'), undefined, []), false);
  assert.equal(mcpOriginAllowed(req('evil.example.net', 'https://evil.example.net'), undefined, allowed), false);
  assert.equal(mcpOriginAllowed(req('files.example.com:8443', 'https://files.example.com:8443'), undefined, allowed), false);
  assert.equal(mcpOriginAllowed(req('files.example.com', 'http://files.example.com'), undefined, allowed), false);
});

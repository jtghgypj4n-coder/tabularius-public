// Fast boundary cases for mutation runs: no server, sockets, fixtures or password hashing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { acmeOrigins, mcpOriginAllowed, onForwardedWithoutPublicUrl, requestOrigin, urlHostname, validatePublicUrl } from '../src/public-origin.ts';

const req = (headers: Record<string, string | string[]> = {}, encrypted = false, remoteAddress = '203.0.113.8') =>
  ({ headers, socket: { encrypted, remoteAddress } }) as unknown as IncomingMessage;

test('origin decisions distinguish absent, malformed, mismatched and explicitly approved origins', () => {
  assert.equal(mcpOriginAllowed(req()), true);
  for (const origin of ['', 'null', 'http://[bad]', 'http://localhost/path', 'http://u@localhost', 'http://localhost?x', 'http://localhost#x', 'http://localhost https://evil.example']) {
    assert.equal(mcpOriginAllowed(req({ host: 'localhost', origin })), false, origin);
  }
  assert.equal(mcpOriginAllowed(req({ host: 'localhost', origin: 'null' }), undefined, ['null']), false, 'two malformed origins never make an allowlist match');
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '[::1]', '192.168.1.2']) {
    for (const encrypted of [true, false]) {
      const origin = `${encrypted ? 'https' : 'http'}://${host}:8080`;
      assert.equal(mcpOriginAllowed(req({ host: `${host}:8080`, origin }, encrypted)), true);
      assert.equal(mcpOriginAllowed(req({ host: `${host}:8081`, origin }, encrypted)), false);
      assert.equal(mcpOriginAllowed(req({ host: `${host}:8080`, origin }, !encrypted)), false);
      assert.equal(mcpOriginAllowed(req({ origin }, encrypted)), false);
      for (const header of ['forwarded', 'x-forwarded-for', 'x-real-ip']) {
        const proxied = req({ host: `${host}:8080`, origin, [header]: '' }, encrypted);
        assert.equal(mcpOriginAllowed(proxied, 'https://public.example'), false);
        assert.equal(mcpOriginAllowed(proxied, undefined), true);
        assert.equal(mcpOriginAllowed(proxied, 'https://public.example', [origin]), true);
      }
    }
  }
  const foreign = req({ host: 'evil.example', origin: 'https://evil.example', forwarded: 'for=203.0.113.8' }, true);
  assert.equal(mcpOriginAllowed(foreign), false);
  assert.equal(mcpOriginAllowed(foreign, 'https://public.example'), false);
  assert.equal(mcpOriginAllowed(foreign, undefined, ['http://[bad]', 'https://other.example']), false);
  assert.equal(mcpOriginAllowed(foreign, 'https://evil.example/path'), true);
  assert.equal(mcpOriginAllowed(foreign, undefined, ['https://evil.example:443']), true);
});

test('public URL validation and IPv6 authority formatting enforce their exact boundary', () => {
  for (const value of [undefined, 'http://localhost', 'https://public.example/', 'https://[::1]:8443']) assert.doesNotThrow(() => validatePublicUrl(value));
  for (const value of ['', 'http://[bad]', 'https://public.example/path', 'https://user@public.example', ' https://public.example', 'https://public.example\n']) {
    assert.throws(() => validatePublicUrl(value), /give a full address/, value);
  }
  for (const [host, expected] of [['::1', '[::1]'], ['[::1]', '[::1]'], ['localhost', 'localhost']]) assert.equal(urlHostname(host), expected);
  assert.deepEqual(acmeOrigins(['a.example', 'b.example'], 443), ['https://a.example', 'https://b.example']);
  assert.deepEqual(acmeOrigins(['a.example'], 8443), ['https://a.example:8443']);
});

test('forwarding uses only a local peer, first header value and the configured public URL', () => {
  const headers = { host: 'internal:8080', 'x-forwarded-host': ['public.example, ignored.example', 'last.example'], 'x-forwarded-proto': ['https, http', 'http'] };
  assert.deepEqual(requestOrigin(req(headers)), { proto: 'http', host: 'internal:8080' });
  assert.deepEqual(requestOrigin(req(headers, true)), { proto: 'https', host: 'internal:8080' });
  assert.deepEqual(requestOrigin(req(headers, false, '127.0.0.1')), { proto: 'https', host: 'public.example' });
  assert.deepEqual(requestOrigin(req(headers), 'http://configured.example/'), { proto: 'http', host: 'configured.example' });
  assert.deepEqual(requestOrigin(req(headers), 'https://configured.example/'), { proto: 'https', host: 'configured.example' });
  assert.deepEqual(requestOrigin(req()), { proto: 'http', host: 'localhost' });
  assert.deepEqual(requestOrigin(req({ host: ['first.example, second.example', 'third.example'] })), { proto: 'http', host: 'first.example' });
  assert.deepEqual(requestOrigin(req({ 'x-forwarded-proto': 'ftp', 'x-forwarded-host': '' }, true, '127.0.0.1')), { proto: 'http', host: 'localhost' });
  assert.deepEqual(requestOrigin(req({}, true, '127.0.0.1')), { proto: 'https', host: 'localhost' });
});

test('forwarding warnings are conditional, emitted once, and reset with the observer', () => {
  const warnings: string[] = [];
  onForwardedWithoutPublicUrl((message) => warnings.push(message));
  const forged = { 'x-forwarded-host': 'public.example' };
  try {
    requestOrigin(req(forged));
    requestOrigin(req({}, false, '127.0.0.1'));
    requestOrigin(req(forged, false, '127.0.0.1'), 'https://configured.example');
    assert.equal(warnings.length, 0);
    requestOrigin(req(forged, false, '127.0.0.1'));
    requestOrigin(req(forged, false, '127.0.0.1'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /--public-url/);
    onForwardedWithoutPublicUrl((message) => warnings.push(message));
    requestOrigin(req({ 'x-forwarded-proto': 'https' }, false, '127.0.0.1'));
    assert.equal(warnings.length, 2);
  } finally { onForwardedWithoutPublicUrl(undefined); }
});

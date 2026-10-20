// The plain-http redirect puts the request's Host header in a Location header, so only a host name or address with an
// optional port is followed. (The redirect itself over a real TLS port is in local-tls.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainRedirectTarget } from '../src/plain-redirect.ts';

test('a host name, an address, or an address with a port is sent on to https', () => {
  for (const [host, url, to] of [
    ['myserver.local', '/admin/?x=1', 'https://myserver.local/admin/?x=1'],
    ['192.168.1.20:8080', '/', 'https://192.168.1.20:8080/'],
    ['[::1]:8443', '/app/', 'https://[::1]:8443/app/'],
    ['LOCALHOST', undefined, 'https://LOCALHOST/'],
    ['my_server', '/a//b', 'https://my_server/a//b'],
  ] as const) assert.equal(plainRedirectTarget(host, url), to, host);
});

test('anything else in the Host header is refused, not echoed into a Location header', () => {
  for (const host of [
    undefined, '', 'evil.example#', 'a?b', 'x:y', 'a b', 'a/b', 'a\\b', 'user@evil.example', 'evil.example:99999999', 'evil.example:',
    '-evil.example', 'evil.example/', 'ev<il>.example', 'a,b', '[::1', '[zz]', 'a'.repeat(300), 'évil.example',
  ]) assert.equal(plainRedirectTarget(host, '/'), undefined, String(host));
});

test('a request target that is not a path is not followed', () => {
  assert.equal(plainRedirectTarget('myserver', 'http://other.example/x'), 'https://myserver/');
  assert.equal(plainRedirectTarget('myserver', '*'), 'https://myserver/');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { UNKNOWN_CLIENT, clientAddress, directFromThisComputer, forwardedFor, fromThisComputer, hasForwardedHeaders, hasTrustedClientAddress, proxyHeader, refuseForwarding, setClientAddress, trustedProxyAddresses, trustedProxyPeer, useForwardedFor } from '../src/client-address.ts';

const request = (remoteAddress?: string, headers: Record<string, string | string[]> = {}) => ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;
const trust = trustedProxyAddresses(['192.0.2.0/24', '2001:db8:ffff::/48', '127.0.0.1']);

test('configured proxy faults reject before authentication and never gain a trusted-client allowance', () => {
  for (const value of [undefined, '', 'bad', '127.0.0.2', '::1', '::ffff:7f00:1']) {
    const req = request('192.0.2.1', value === undefined ? {} : { 'x-forwarded-for': value });
    assert.equal(useForwardedFor(req, 'x-forwarded-for', trust), false, String(value));
    assert.equal(directFromThisComputer(req), false);
    assert.equal(hasTrustedClientAddress(req), value !== undefined && value !== '' && value !== 'bad');
  }
  const req = request('192.0.2.1', { 'x-forwarded-for': '203.0.113.1' });
  assert.equal(useForwardedFor(req, 'x-forwarded-for', trust), true);
  assert.equal(hasTrustedClientAddress(req), true);
  assert.equal(clientAddress(req), '203.0.113.1');
  setClientAddress(req, '198.51.100.1');
  assert.equal(hasTrustedClientAddress(req), false);
  assert.equal(clientAddress(req), '198.51.100.1');
  setClientAddress(req, 'invalid');
  assert.equal(clientAddress(req), UNKNOWN_CLIENT);
});

test('unknown peers and unconfigured loopback forwarding have no local authority', () => {
  for (const peer of [undefined, '', 'bad']) {
    const req = request(peer, { 'x-forwarded-for': '203.0.113.1' });
    assert.equal(forwardedFor(req, 'x-forwarded-for', trust), undefined);
    assert.equal(useForwardedFor(req, 'x-forwarded-for', trust), true);
    assert.equal(clientAddress(req), UNKNOWN_CLIENT);
    assert.equal(hasTrustedClientAddress(req), false);
    assert.equal(trustedProxyPeer(req.socket, trust), false);
  }
  for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip']) {
    const req = request('127.0.0.1', { [header]: '' });
    assert.equal(hasForwardedHeaders(req), true);
    assert.equal(useForwardedFor(req), true);
    assert.equal(clientAddress(req), UNKNOWN_CLIENT);
    assert.equal(directFromThisComputer(req), false);
  }
});

test('direct local access requires a loopback peer and a local Host without forwarding', () => {
  for (const host of ['', 'localhost', 'LOCALHOST:80', '127.0.0.1', '[::1]:443', 'app.localhost']) {
    for (const peer of ['127.0.0.1', '::1', '::ffff:7f00:1']) assert.equal(directFromThisComputer(request(peer, { host })), true, `${peer} ${host}`);
  }
  for (const host of ['remote.test', 'localhost.evil.test', 'notlocalhost']) assert.equal(directFromThisComputer(request('127.0.0.1', { host })), false);
  assert.equal(directFromThisComputer(request('203.0.113.1')), false);
  assert.equal(directFromThisComputer(request('127.0.0.1')), true);
  const req = request('127.0.0.1');
  setClientAddress(req, '203.0.113.1', true);
  assert.equal(directFromThisComputer(req), false);
  assert.equal(fromThisComputer(req), true, 'transport peer remains local, attribution does not confer local authority');
});

test('trust uses CIDR endpoints and preserves the original peer across request reuse', () => {
  assert.equal(trustedProxyPeer(request('192.0.2.255').socket, trust), true);
  assert.equal(trustedProxyPeer(request('192.0.3.0').socket, trust), false);
  assert.equal(trustedProxyPeer(request('2001:db8:ffff::1').socket, trust), true);
  assert.equal(trustedProxyPeer(request('2001:db8:fffe::1').socket, trust), false);
  assert.equal(trustedProxyPeer(request('192.0.2.1').socket, trustedProxyAddresses()), false);
  for (const cidr of ['192.0.2.1/32', '::1/128', '0.0.0.0/0', '::/0']) assert.doesNotThrow(() => trustedProxyAddresses([cidr]));
  for (const bad of ['192.0.2.0/24/1', '::/128/1', '192.0.2.0/no', '::/129']) assert.throws(() => trustedProxyAddresses([bad]));
  const first = request('127.0.0.1', { 'x-forwarded-for': '203.0.113.1' });
  assert.equal(useForwardedFor(first, 'x-forwarded-for', trust), true);
  assert.equal(trustedProxyPeer(first.socket, trust), true);
  const second = { socket: first.socket, headers: {} } as IncomingMessage;
  assert.equal(useForwardedFor(second, 'x-forwarded-for', trust), false);
  assert.equal(clientAddress(first), '203.0.113.1');
  assert.equal(clientAddress(second), '127.0.0.1');
  assert.equal(fromThisComputer(second), true);
  assert.equal(proxyHeader(' Forwarded '), 'forwarded');
});

test('forwarding grammar accepts whitespace and exact port bounds while rejecting malformed lists', () => {
  for (const value of [' for=203.0.113.1 ; proto=https ', '\tfor="203.0.113.1:1"\t;\tproto=https\t', 'for="[2001:db8::1]:65535"']) {
    const req = request('192.0.2.1', { forwarded: value });
    assert.equal(useForwardedFor(req, 'forwarded', trust), true, value);
    assert.notEqual(clientAddress(req), '192.0.2.1');
  }
  for (const value of ['for=203.0.113.1 , ', 'for=203.0.113.1 proto=https', 'for="[::1]:0"', 'for="[::1]:65536"']) {
    assert.equal(useForwardedFor(request('192.0.2.1', { forwarded: value }), 'forwarded', trust), false, value);
  }
  assert.equal(forwardedFor(request('192.0.2.1', { 'x-real-ip': '203.0.113.1:1' }), 'x-real-ip', trust), '203.0.113.1');
});

test('proxy rejection always sends an actionable response and logs at most once per minute', (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const logs: string[] = [], responses: string[] = [];
  const res = { writeHead(status: number, headers: Record<string, unknown>) {
    assert.equal(status, 400); assert.equal(headers.connection, 'close');
    return { end(body: string) { assert.equal(headers['content-length'], Buffer.byteLength(body)); responses.push(body); } };
  } } as unknown as ServerResponse;
  const refuse = () => refuseForwarding(res, line => logs.push(line));
  refuse(); now += 59_999; refuse();
  assert.equal(logs.length, 1);
  now++; refuse();
  assert.equal(logs.length, 2);
  assert.equal(responses.length, 3);
  for (const line of [...logs, ...responses]) assert.match(line, /--proxy-header.*--trusted-proxies/);
});

test('numeric coercion cannot widen CIDR syntax and an unconfigured header cannot attribute a client', () => {
  for (const prefix of ['+24', '24.0', '0x18', '2.4e1', '']) assert.throws(() => trustedProxyAddresses([`192.0.2.0/${prefix}`]));
  const req = request('192.0.2.1', { undefined: '203.0.113.1' });
  assert.equal(useForwardedFor(req, undefined, trust), true);
  assert.equal(clientAddress(req), '192.0.2.1');
  assert.equal(hasTrustedClientAddress(req), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { UNKNOWN_CLIENT, clientAddress, directFromThisComputer, forwardedFor, proxyHeader, setClientAddress, trustedProxyAddresses, useForwardedFor } from '../src/client-address.ts';
import { addressBucket, canonicalIP } from '../../store/src/client-ip.ts';
import { SignInFailures, LOCKOUT } from '../../store/src/sign-in-failures.ts';

const req = (remoteAddress: string, headers: Record<string, string | string[]> = {}) => ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;
const trusted = trustedProxyAddresses(['192.0.2.0/24', '2001:db8:ffff::/48', '127.0.0.1']);

test('trust is explicit, including loopback; missing/untrusted headers fall back to canonical socket', () => {
  for (const peer of ['127.0.0.1', '::1', '198.51.100.10', '::ffff:c633:640a']) {
    const r = req(peer, { 'x-forwarded-for': '203.0.113.1' });
    // A loopback peer carrying forwarding headers nobody configured is a proxy on this computer: an unknown visitor, never this computer.
    const expected = peer === '127.0.0.1' || peer === '::1' ? UNKNOWN_CLIENT : canonicalIP(peer);
    assert.equal(forwardedFor(r, 'x-forwarded-for'), expected);
    assert.equal(forwardedFor(r, undefined, trusted), expected);
    assert.equal(useForwardedFor(r, 'x-forwarded-for'), true, 'answered by authentication, not refused');
  }
  assert.equal(forwardedFor(req('192.0.2.1'), 'x-forwarded-for', trusted), '192.0.2.1');
  assert.equal(forwardedFor(req('192.0.2.1', { 'x-real-ip': '203.0.113.1' }), 'forwarded', trusted), '192.0.2.1');
  assert.equal(proxyHeader(' X-Real-IP '), 'x-real-ip');
  assert.throws(() => proxyHeader('x-client-ip'));
  for (const v of ['', 'proxy', '192.0.2.1:80', '::/129', '192.0.2.0/33', '::/-1', '::/0/0', 'fe80::1%en0']) assert.throws(() => trustedProxyAddresses([v]));
});

// Expected wire syntax: RFC 7239 §§4,6,7.1; XFF trust traversal: MDN X-Forwarded-For.
// Fail-closed rejection and port bounds are Tabularius policy (docs/security-defaults.md).
for (const header of ['x-forwarded-for', 'forwarded', 'x-real-ip'] as const) {
  test(`${header}: valid node forms and mapped spellings canonicalize`, () => {
    for (const [wire, expected] of [
      ['203.0.113.9', '203.0.113.9'], ['203.0.113.9:443', '203.0.113.9'],
      ['[2001:0DB8:0001:0002::A]:65535', '2001:db8:1:2::a'],
      ['[::ffff:cb00:7109]:80', '203.0.113.9'], ['[::ffff:203.0.113.9]', '203.0.113.9'],
      ['127.0.0.1', '127.0.0.1'],
    ]) {
      const value = header === 'forwarded' ? `for="${wire}";proto=https` : wire;
      assert.equal(forwardedFor(req('192.0.2.1', { [header]: value }), header, trusted), expected, value);
    }
  });
  test(`${header}: hostile identifiers cannot bypass socket fallback`, () => {
    for (const wire of ['', 'unknown', '_hidden', 'host.example', '010.0.0.1', '0x7f000001',
      '203.0.113.1:0', '203.0.113.1:65536', '203.0.113.1:-1', '203.0.113.1:443x',
      '[203.0.113.1]', '[2001:db8::1', '2001:db8::1]', '[::1]:', '[::1]:65536',
      'fe80::1%eth0', '[fe80::1%25eth0]:80', '203.0.113.1\r\nX: y', '203.0.113.1 evil', '203.0.113.1\r', '[::1]\r', '203.0.113.1:443\n', '\u00a0203.0.113.1']) {
      const value = header === 'forwarded' ? `for="${wire}"` : wire;
      assert.equal(forwardedFor(req('192.0.2.1', { [header]: value }), header, trusted), '192.0.2.1', value);
    }
  });
}

test('entire lists are validated; Forwarded parses quoted extensions and rejects duplicate parameters', () => {
  for (const value of ['203.0.113.1,', ',203.0.113.1', 'bad,203.0.113.1', '203.0.113.1,,192.0.2.2']) {
    assert.equal(forwardedFor(req('192.0.2.1', { 'x-forwarded-for': value }), 'x-forwarded-for', trusted), '192.0.2.1');
  }
  for (const value of ['for=203.0.113.1;FOR=198.51.100.1', 'for=203.0.113.1;proto=https;Proto=http',
    'for=203.0.113.1junk', 'for="203.0.113.1"junk', 'for="203.0.113.1', 'for=203.0.113.1;',
    'for=203.0.113.1,', 'for=203.0.113.1,,for=192.0.2.2', 'for=203.0.113.1:443',
    'for=2001:db8::1', 'proto=https,for=203.0.113.1', 'for=203.0.113.1;ext=']) {
    assert.equal(forwardedFor(req('192.0.2.1', { forwarded: value }), 'forwarded', trusted), '192.0.2.1', value);
  }
  assert.equal(forwardedFor(req('192.0.2.1', { forwarded: 'for=203.0.113.1;ext="comma,semi;quote\\\"";proto=https' }), 'forwarded', trusted), '203.0.113.1');
  for (const value of ['203.0.113.1,198.51.100.1', ['203.0.113.1', '198.51.100.1']]) {
    assert.equal(forwardedFor(req('192.0.2.1', { 'x-real-ip': value }), 'x-real-ip', trusted), '192.0.2.1');
  }
});

test('three proxies: walk from the right across only trusted hops, preserving repeated-field order', () => {
  const chain = ['198.51.100.66', '203.0.113.9', '192.0.2.2', '2001:db8:ffff::3'];
  for (const header of ['x-forwarded-for', 'forwarded'] as const) {
    const nodes = header === 'forwarded' ? chain.map(ip => `for="${ip.includes(':') ? `[${ip}]` : ip}"`) : chain;
    for (const value of [nodes.join(', '), [nodes.slice(0, 2).join(','), nodes.slice(2).join(',')]]) {
      assert.equal(forwardedFor(req('::ffff:c000:201', { [header]: value }), header, trusted), '203.0.113.9');
      assert.equal(forwardedFor(req('192.0.2.1', { [header]: value }), header, trustedProxyAddresses(['192.0.2.1'])), '2001:db8:ffff::3');
    }
  }
});

test('request snapshots survive proxy reuse, fallback, delayed audit reads and worker handoff', () => {
  const first = req('192.0.2.1', { 'x-forwarded-for': '2001:0DB8:0001:0002::A' });
  useForwardedFor(first, 'x-forwarded-for', trusted);
  const second = { socket: first.socket, headers: { 'x-forwarded-for': '203.0.113.9' } } as unknown as IncomingMessage;
  useForwardedFor(second, 'x-forwarded-for', trusted);
  assert.equal(clientAddress(first), '2001:db8:1:2::a');
  assert.equal(clientAddress(second), '203.0.113.9');
  const third = { socket: first.socket, headers: {} } as unknown as IncomingMessage;
  useForwardedFor(third, 'x-forwarded-for', trusted);
  assert.equal(clientAddress(third), '192.0.2.1');
  for (let worker = 0; worker < 3; worker++) {
    const r = req('127.0.0.1'); setClientAddress(r, clientAddress(first));
    assert.equal(addressBucket(clientAddress(r)), addressBucket(clientAddress(first)));
  }
  assert.equal(directFromThisComputer(req('127.0.0.1', { 'x-forwarded-for': 'bad' })), false);
});

test('all spellings, mapped IPv4 and IPv6 rotations share limit and account lockout keys', () => {
  for (const [expected, variants] of [
    ['203.0.113.9', ['203.0.113.9', '::ffff:203.0.113.9', '::FFFF:CB00:7109', '0:0:0:0:0:ffff:cb00:7109']],
    ['2001:db8:0:0', ['2001:db8::1', '2001:0DB8:0000:0000:ffff::1', '2001:db8:0:0:1:2:3:4']],
  ] as const) {
    const failures = new SignInFailures();
    const key = failures.accountKey('Admin', variants[0]);
    for (let n = 0; n < LOCKOUT.attempts; n++) failures.attempt(key, false);
    for (const ip of variants) {
      assert.equal(addressBucket(ip), expected);
      assert.equal(failures.accountKey('Admin', ip), key);
      assert.ok(failures.blocked(failures.accountKey('Admin', ip)));
    }
  }
  assert.notEqual(addressBucket('2001:db8:0:1::1'), addressBucket('2001:db8::1'));
});


test('socket scope IDs keep a canonical peer while header scope IDs remain invalid', () => {
  const request = req('fe80::1234%en0', { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(forwardedFor(request, 'x-forwarded-for'), 'fe80::1234');
  assert.equal(useForwardedFor(request, 'x-forwarded-for'), true);
  assert.equal(clientAddress(request), 'fe80::1234');
});

test('actual worker handoff and delayed metrics retain each request snapshot', async () => {
  const { ClusterLink } = await import('../src/cluster.ts');
  const { Metrics } = await import('../src/metrics.ts');
  const { EventEmitter } = await import('node:events');
  const metrics = new Metrics();
  const seen: string[] = [];
  metrics.onCall = call => seen.push(call.client);
  try {
    const socket = { remoteAddress: undefined };
    const responses: import('node:http').ServerResponse[] = [];
    for (const ip of ['2001:0DB8:0000:0000::1', '::ffff:cb00:7109', '2001:db8:0:1::1']) {
      const request = { socket, headers: { 'x-tabularius-peer': ip, 'x-tabularius-forwarded': '1' } } as unknown as IncomingMessage;
      ClusterLink.prototype.peer.call({} as InstanceType<typeof ClusterLink>, request);
      const response = Object.assign(new EventEmitter(), { statusCode: 200, getHeader: () => '' }) as unknown as import('node:http').ServerResponse;
      metrics.track(request, response, '/fmi/data/vLatest/databases/Synthetic/layouts');
      responses.push(response);
    }
    // All finish callbacks run after the worker connection has been assigned its latest visitor.
    for (const response of responses) response.emit('finish');
    assert.deepEqual(seen, ['2001:db8::1', '203.0.113.9', '2001:db8:0:1::1']);
  } finally { metrics.stop(); }
});

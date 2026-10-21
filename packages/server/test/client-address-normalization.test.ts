import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { forwardedFor, trustedProxyAddresses } from '../src/client-address.ts';

const trusted = trustedProxyAddresses(['127.0.0.1']);

test('AR-store-security-04: proxy addresses', () => {
  const from = (value: string) => forwardedFor({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': value } } as unknown as IncomingMessage, 'x-real-ip', trusted);
  assert.equal(from('2001:0DB8:0001:0002:0:0:0:1'), '2001:db8:1:2::1');
  assert.equal(from('0:0:0:0:0:FFFF:C000:0201'), '192.0.2.1');
  for (const [value, canonical] of [['0:0:0:0:0:0:0:1', '::1'], ['0:0:0:0:0:ffff:7f00:1', '127.0.0.1'], ['::ffff:127.1.2.3', '127.1.2.3']]) assert.equal(from(value), canonical);
});

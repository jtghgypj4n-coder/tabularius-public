import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { createEdgeServer } from '../src/edge-limits.ts';
import { trustedProxyAddresses, useForwardedFor } from '../src/client-address.ts';
import { listen, RawClient, request, stubCommands } from './edge-test-helpers.ts';

for (const [first, same] of [
  ['2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001'],
  ['192.0.2.1', '::ffff:c000:201'],
]) test(`equivalent proxy addresses share the connection allowance: ${first}`, async t => {
  stubCommands(t);
  let arrived!: () => void;
  const held = new Promise<void>(resolve => { arrived = resolve; });
  const port = await listen(t, createEdgeServer((req, res) => {
    if (req.url === '/held') { res.write('held'); arrived(); }
    else res.end('ok');
  }, { connectionsPerAddress: 1 }, undefined, { proxyHeader: 'x-forwarded-for', trustedProxies: trustedProxyAddresses(['127.0.0.1', '::1']) }));
  const a = await new RawClient(port).ready();
  t.after(() => a.socket.destroy());
  a.send(request('/held', `X-Forwarded-For: ${first}\r\n`));
  await held;
  const b = await new RawClient(port).ready();
  assert.match(await b.send(request('/other-route', `X-Forwarded-For: ${same}\r\nConnection: close\r\n`)).end(), /^HTTP\/1.1 429 /);
  const c = await new RawClient(port).ready();
  assert.match(await c.send(request('/other-account', 'X-Forwarded-For: 198.51.100.3\r\nConnection: close\r\n')).end(), /^HTTP\/1.1 200 /);
});

test('mapped loopback spellings never become a trusted forwarded visitor', () => {
  for (const value of ['[::ffff:7f00:1]', '[0:0:0:0:0:ffff:7f00:1]:443', '::ffff:127.0.0.2']) {
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': value } } as unknown as IncomingMessage;
    assert.equal(useForwardedFor(req, 'x-forwarded-for', trustedProxyAddresses(['127.0.0.1'])), false, value);
  }
});

test('a delayed valid response followed by a target with an encoded backslash cannot dispatch a third route', async t => {
  stubCommands(t);
  const calls: string[] = [];
  let complete!: () => void;
  let arrived!: () => void;
  const held = new Promise<void>(resolve => { arrived = resolve; });
  const port = await listen(t, createEdgeServer((req, res) => {
    calls.push(req.url!);
    complete = () => res.end('first');
    arrived();
  }));
  const c = await new RawClient(port).ready();
  c.send(request('/first') + request('/tabularius/calendar/v1/%5c') + request('/fmi/data/vLatest/forbidden'));
  await held;
  complete();
  const wire = await c.end();
  assert.deepEqual(calls, ['/first']);
  assert.deepEqual(wire.match(/HTTP\/1.1 \d+/g), ['HTTP/1.1 200', 'HTTP/1.1 400']);
});

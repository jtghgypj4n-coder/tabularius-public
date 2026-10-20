import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type Server as TlsServer } from 'node:tls';
import { createEdgeServer } from '../src/edge-limits.ts';
import { redirectPlainHttp } from '../src/plain-redirect.ts';
import { localCertificate } from '../src/local-tls.ts';
import { listen, RawClient, request, stubCommands } from './edge-test-helpers.ts';

test('TLS and the shared-port redirect enforce deadlines, header limits and admission before the first byte', async t => {
  stubCommands(t);
  const dir = mkdtempSync(join(tmpdir(), 'edge-tls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tls = localCertificate(dir, ['localhost', '127.0.0.1']);
  const limits = { headersMs: 150, bodyMs: 350, checkMs: 10, connectionsPerAddress: 3 };
  const server = createEdgeServer((_req, res) => res.end('ok'), limits, tls);
  redirectPlainHttp(server as unknown as TlsServer, limits);
  const port = await listen(t, server);
  const secure = async (headers = '') => {
    const socket = connect({ host: '127.0.0.1', port, ca: tls.ca, servername: 'localhost', ALPNProtocols: ['h2', 'http/1.1'] });
    const client = new RawClient(port, socket);
    await new Promise<void>((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
    assert.notEqual(socket.alpnProtocol, 'h2', 'HTTP/2 is not negotiated');
    client.send(request('/', 'Connection: close\r\n' + headers));
    return client.end();
  };
  const empty = await new RawClient(port).ready();
  const header = await new RawClient(port).ready();
  header.send('GET / HTTP/1.1\r\nHost: localhost\r\nX-Slow: ');
  const overflow = await new RawClient(port).ready();
  // All three admission slots include sockets that have not sent any protocol byte.
  const refused = await new RawClient(port).ready();
  assert.equal(await refused.end(), '');
  overflow.socket.destroy(); await overflow.closed;
  assert.match(await secure(), /^HTTP\/1\.1 200 /);
  assert.match(await header.end(), /^HTTP\/1\.1 408 /);
  await empty.end();
  const redirect = await new RawClient(port).ready();
  assert.match(await redirect.send(request('/', 'Connection: close\r\n')).end(), /^HTTP\/1\.1 308 /);
  assert.match(await secure('X-Big: ' + 'x'.repeat(16 * 1024) + '\r\n'), /^HTTP\/1\.1 431 /);
  assert.match(await secure(), /^HTTP\/1\.1 200 /);
});

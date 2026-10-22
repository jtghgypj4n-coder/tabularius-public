// Real loopback TLS with a freshly generated test CA; no child processes or external requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localCertificate } from '../../server/src/local-tls.ts';
import { guardedFetch, NAME_LOOKUP, outboundContext } from '../src/net-guard.ts';

test('TLS sockets and sessions are fresh across accounts/files; credentials stay isolated', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-outbound-tls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cert = localCertificate(dir, ['outbound.test', '127.0.0.1']);
  // Trust only this generated CA for these requests, without turning off TLS verification.
  const createConnection = Agent.prototype.createConnection;
  const agents = new Set<Agent>();
  t.mock.method(Agent.prototype, 'createConnection', function (this: Agent, options: Parameters<typeof createConnection>[0], callback: Parameters<typeof createConnection>[1]) {
    agents.add(this);
    return createConnection.call(this, { ...options, ca: cert.ca }, callback);
  });
  t.mock.method(NAME_LOOKUP, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  const seen: { socket: TLSSocket; resumed: boolean; auth?: string; cookie?: string }[] = [];
  const server = createServer({ key: cert.key, cert: cert.cert, maxVersion: 'TLSv1.2' }, (req, res) => {
    const socket = req.socket as TLSSocket;
    seen.push({ socket, resumed: socket.isSessionReused(), auth: req.headers.authorization, cookie: req.headers.cookie });
    res.setHeader('set-cookie', 'session=server-secret'); res.end('ok');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `https://outbound.test:${(server.address() as AddressInfo).port}`;
  const identities = [{ file: 'tls-one', account: 'a' }, { file: 'tls-one', account: 'b' }, { file: 'tls-two', account: 'a' }, { file: 'tls-one', account: 'a' }];
  for (const [i, identity] of identities.entries()) await outboundContext.run(identity, async () => {
    const response = await guardedFetch(base, i === 0 ? { headers: { authorization: 'Bearer first', cookie: 'first=1' } } : {}, { policy: { private: true }, timeoutMs: 5000 });
    assert.equal(await response.text(), 'ok');
  });
  assert.equal(agents.size, identities.length, 'every request gets a separate TLS session cache');
  assert.equal(new Set(seen.map((r) => r.socket)).size, identities.length);
  assert.ok(seen.every((r) => !r.resumed));
  assert.deepEqual(seen.map(({ auth, cookie }) => ({ auth, cookie })), [
    { auth: 'Bearer first', cookie: 'first=1' }, ...identities.slice(1).map(() => ({ auth: undefined, cookie: undefined })),
  ]);
});

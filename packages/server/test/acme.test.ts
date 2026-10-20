import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { serve, serveCluster, setAdminPassword } from '../src/index.ts';

// HTTPS out of the box: certificates from an ACME authority (Let's Encrypt), here a
// stand-in that checks every signed request, fetches the challenge over HTTP and
// issues certificates with openssl.
const openssl = spawnSync('openssl', ['version']).status === 0;
const skip = openssl ? false : 'openssl is not installed';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** A small ACME server (RFC 8555) that does what Let's Encrypt does, minus the internet. */
async function fakeAuthority(work: string, httpPort: () => number) {
  const run = (...args: string[]) => {
    const r = spawnSync('openssl', args, { cwd: work });
    if (r.status !== 0) throw new Error(r.stderr.toString());
  };
  // The key comes from Node: the LibreSSL macOS ships writes EC keys with
  // explicit curve parameters, which TLS refuses.
  writeFileSync(join(work, 'ca.key'), generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(work, 'ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[ca]\nbasicConstraints = critical, CA:TRUE\nkeyUsage = critical, keyCertSign, cRLSign\n');
  run('req', '-x509', '-new', '-key', 'ca.key', '-config', 'ca.cnf', '-extensions', 'ca', '-out', 'ca.pem', '-subj', '/CN=Test CA', '-days', '2', '-sha256');
  const ca = readFileSync(join(work, 'ca.pem'), 'utf8');
  const nonces = new Set<string>();
  const accounts = new Map<string, Record<string, string>>();
  const state = { orders: 0, badNonceSent: false, rejected: [] as string[] };
  let order: { status: string; identifiers: { value: string }[]; token: string; authz: string; cert?: string; account: string } | undefined;
  let base = '';
  const nonce = () => {
    const n = b64u(Buffer.from(String(Math.random())));
    nonces.add(n);
    return n;
  };
  const server: Server = createServer(async (req, res) => {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'replay-nonce': nonce(), 'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const problem = (status: number, type: string, detail: string) => {
      state.rejected.push(type);
      send(status, { type: `urn:ietf:params:acme:error:${type}`, detail });
    };
    if (req.url === '/dir') return send(200, { newNonce: `${base}/nonce`, newAccount: `${base}/account`, newOrder: `${base}/order` });
    if (req.url === '/nonce') return send(200, '');
    let body = '';
    for await (const c of req) body += c;
    const jws = JSON.parse(body) as { protected: string; payload: string; signature: string };
    const header = JSON.parse(Buffer.from(jws.protected, 'base64url').toString()) as { alg: string; nonce: string; url: string; jwk?: Record<string, string>; kid?: string };
    if (header.alg !== 'ES256' || header.url !== base + req.url) return problem(400, 'malformed', 'bad header');
    if (!nonces.delete(header.nonce)) return problem(400, 'badNonce', 'unknown nonce');
    const jwk = header.jwk ?? accounts.get(header.kid ?? '');
    if (!jwk || (header.jwk && header.kid)) return problem(401, 'unauthorized', 'no account');
    const ok = verify('sha256', Buffer.from(`${jws.protected}.${jws.payload}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(jws.signature, 'base64url'));
    if (!ok) return problem(401, 'unauthorized', 'bad signature');
    const payload = jws.payload ? JSON.parse(Buffer.from(jws.payload, 'base64url').toString()) : undefined;
    const thumb = b64u(createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest());
    if (req.url === '/account') {
      if (!payload?.termsOfServiceAgreed) return problem(400, 'malformed', 'terms not agreed');
      const kid = `${base}/acct/${thumb}`;
      accounts.set(kid, jwk);
      return send(201, { status: 'valid' }, { location: kid });
    }
    if (!header.kid) return problem(400, 'malformed', 'use the account');
    if (req.url === '/order') {
      // Clients must cope with a stale nonce once.
      if (!state.badNonceSent) {
        state.badNonceSent = true;
        return problem(400, 'badNonce', 'try again');
      }
      state.orders++;
      order = { status: 'pending', identifiers: payload.identifiers, token: b64u(Buffer.from(`token-${state.orders}`)), authz: 'pending', account: thumb };
      return send(201, { status: 'pending', authorizations: [`${base}/authz`], finalize: `${base}/finalize` }, { location: `${base}/order/1` });
    }
    if (!order) return problem(404, 'malformed', 'no order');
    if (req.url === '/authz') {
      return send(200, { status: order.authz, identifier: { type: 'dns', value: order.identifiers[0].value }, challenges: [{ type: 'http-01', url: `${base}/chall`, token: order.token }] });
    }
    if (req.url === '/chall') {
      // Check the server shows the key authorization at the well-known address.
      const r = await fetch(`http://127.0.0.1:${httpPort()}/.well-known/acme-challenge/${order.token}`);
      order.authz = r.ok && (await r.text()) === `${order.token}.${thumb}` ? 'valid' : 'invalid';
      if (order.authz === 'valid') order.status = 'ready';
      return send(200, { status: 'processing' });
    }
    if (req.url === '/order/1') return send(200, { status: order.status, authorizations: [`${base}/authz`], finalize: `${base}/finalize`, certificate: order.cert });
    if (req.url === '/finalize') {
      if (order.status !== 'ready') return problem(403, 'orderNotReady', 'not ready');
      const csr = `-----BEGIN CERTIFICATE REQUEST-----\n${Buffer.from(payload.csr, 'base64url').toString('base64')}\n-----END CERTIFICATE REQUEST-----\n`;
      writeFileSync(join(work, 'req.csr'), csr);
      run('req', '-in', 'req.csr', '-verify', '-noout');
      // The names go in from the order, not with -copy_extensions, which the
      // LibreSSL macOS ships doesn't have.
      writeFileSync(join(work, 'ext.cnf'), `subjectAltName=${order.identifiers.map((i) => `DNS:${i.value}`).join(',')}\n`);
      try {
        run('x509', '-req', '-in', 'req.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '90', '-extfile', 'ext.cnf', '-sha256', '-out', 'cert.pem');
      } catch (e) {
        return problem(500, 'serverInternal', (e as Error).message);
      }
      order.cert = `${base}/cert`;
      order.status = 'valid';
      return send(200, { status: 'processing' });
    }
    if (req.url === '/cert') return send(200, readFileSync(join(work, 'cert.pem'), 'utf8') + ca);
    problem(404, 'malformed', 'unknown');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { directory: `${base}/dir`, ca, state, close: () => server.close() };
}

/** The certificate the https server shows, trusting the stand-in authority. */
function served(url: string, ca: string): Promise<{ status: number; serial: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, agent: false }, (res) => {
      const serial = (res.socket as import('node:tls').TLSSocket).getPeerX509Certificate()!.serialNumber;
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode!, serial }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('https gets a certificate by itself, keeps it, and renews it', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-acme-'));
  const work = mkdtempSync(join(tmpdir(), 'tabularius-ca-'));
  const httpPort = await freePort();
  const authority = await fakeAuthority(work, () => httpPort);
  const logs: string[] = [];
  const start = () => serve({ dir, port: 0, watch: false, acme: { domains: ['localhost'], directory: authority.directory, httpPort, hostname: '127.0.0.1' }, log: (m) => void logs.push(m) });
  let s = await start();
  try {
    assert.match(s.url, /^https:\/\/localhost:\d+$/);
    assert.equal(authority.state.orders, 1);
    // Signed requests were checked, and a stale nonce was retried.
    assert.deepEqual(authority.state.rejected, ['badNonce']);
    const first = await served(s.url + '/', authority.ca);
    assert.equal(first.status, 200);
    // Plain http goes on to https.
    const redirect = await fetch(`http://127.0.0.1:${httpPort}/app/?x=1`, { redirect: 'manual', headers: { host: `localhost:${httpPort}` } });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), `https://localhost:${new URL(s.url).port}/app/?x=1`);
    assert.equal((await fetch(`http://127.0.0.1:${httpPort}/.well-known/acme-challenge/unknown`)).status, 404);
    // Restarting keeps the certificate: no new order.
    s.server.close();
    await new Promise((r) => s.server.once('close', r));
    s = await start();
    assert.equal(authority.state.orders, 1);
    assert.equal((await served(s.url + '/', authority.ca)).serial, first.serial);

    // A month before it runs out, it is renewed and new connections get the new one.
    const auto = s.tls!;
    assert.equal(await auto.renewIfDue(Date.now() + 30 * 86_400_000), false);
    assert.equal(await auto.renewIfDue(Date.now() + 70 * 86_400_000), true);
    assert.equal(authority.state.orders, 2);
    const renewed = await served(s.url + '/', authority.ca);
    assert.notEqual(renewed.serial, first.serial);
    assert.ok(new X509Certificate(auto.current!.cert).checkHost('localhost'));
    assert.ok(logs.some((l) => l.startsWith('certificate for localhost until')), logs.join('\n'));
  } finally {
    if (s.server.listening) s.server.close();
    authority.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/** What the PostgreSQL port answers a client asking for TLS: S (yes) or N (no). */
function pgTls(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const ask = Buffer.alloc(8);
      ask.writeInt32BE(8, 0);
      ask.writeInt32BE(80877103, 4);
      socket.write(ask);
    });
    socket.once('data', (d) => {
      resolve(String.fromCharCode(d[0]));
      socket.destroy();
    });
    socket.once('error', reject);
  });
}

test('https with several workers: the front process gets, serves and renews the certificate, and the workers hear of it', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-acme-'));
  const work = mkdtempSync(join(tmpdir(), 'tabularius-ca-'));
  const httpPort = await freePort();
  const sqlPort = await freePort();
  const authority = await fakeAuthority(work, () => httpPort);
  setAdminPassword(dir, 'secret');
  const cluster = await serveCluster({ dir, port: 0, watch: false, sqlPort, acme: { domains: ['localhost'], directory: authority.directory, httpPort, hostname: '127.0.0.1' }, log: () => {} }, 2);
  const status = async () => {
    const r = await new Promise<string>((resolve, reject) => {
      const req = request(cluster.url + '/tabularius/admin/v1/status', { ca: authority.ca, agent: false, headers: { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.end();
    });
    return JSON.parse(r) as { certificate?: { domains: string[]; expires: string; problem?: string } };
  };
  try {
    assert.match(cluster.url, /^https:\/\/localhost:\d+$/);
    assert.equal(authority.state.orders, 1);
    const first = await served(cluster.url + '/', authority.ca);
    assert.equal(first.status, 200);
    // Plain http goes on to https, and the authority's checks are answered, on port 80 of the front process.
    const redirect = await fetch(`http://127.0.0.1:${httpPort}/app/`, { redirect: 'manual', headers: { host: `localhost:${httpPort}` } });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), `https://localhost:${new URL(cluster.url).port}/app/`);
    // Workers know the client came over https (secure cookies, passkeys' origin), though the front reached them in the clear.
    const info = await new Promise<string>((resolve, reject) => {
      const req = request(cluster.url + '/tabularius/admin/v1/sign-in-info', { ca: authority.ca, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(JSON.parse(info).https, true);
    // The admin console (on the leader) shows the certificate the front process holds.
    const before = (await status()).certificate;
    assert.deepEqual(before?.domains, ['localhost']);
    assert.equal(Date.parse(before!.expires), cluster.tls!.current!.expires);
    // The leader's PostgreSQL port offers TLS with it.
    assert.equal(await pgTls(sqlPort), 'S');

    // Renewed: new connections get the new one at once.
    assert.equal(await cluster.tls!.renewIfDue(Date.now() + 70 * 86_400_000), true);
    assert.equal(authority.state.orders, 2);
    assert.notEqual((await served(cluster.url + '/', authority.ca)).serial, first.serial);
    // A renewal that fails is shown in the admin console; the certificate keeps working.
    authority.close();
    assert.equal(await cluster.tls!.renewIfDue(Date.now() + 70 * 86_400_000), false);
    let after = (await status()).certificate;
    for (let i = 0; i < 50 && !after?.problem; i++) {
      await new Promise((r) => setTimeout(r, 20));
      after = (await status()).certificate;
    }
    assert.ok(after?.problem, 'the renewal problem reaches the admin console');
    assert.equal((await served(cluster.url + '/', authority.ca)).status, 200);
  } finally {
    await cluster.close();
    authority.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('https: names are checked before anything is asked for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-acme-'));
  try {
    await assert.rejects(serve({ dir, port: 0, watch: false, acme: { domains: ['not a name'] }, log: () => {} }), /not a host name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

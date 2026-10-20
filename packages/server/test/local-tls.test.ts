// HTTPS on a local network: the folder's own certificate authority, a server
// certificate for this machine's names, plain http sent on to https, and the
// page devices use to trust it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { serve, serveCluster, localCertificate, localCertificateFiles } from '../src/index.ts';
import { privateAddress } from '../src/local-tls.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const NAMES = ['myserver', 'myserver.local', 'localhost', '192.168.1.20', '127.0.0.1', '::1', '203.0.113.9'];

test('the authority and a server certificate a device can check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-local-tls-'));
  try {
    const t = localCertificate(dir, NAMES);
    const ca = new X509Certificate(t.ca);
    const leaf = new X509Certificate(t.cert.split(/(?<=-----END CERTIFICATE-----\n)/)[0]);
    assert.equal(ca.ca, true);
    assert.equal(leaf.ca, false);
    assert.ok(leaf.verify(ca.publicKey), 'signed by the authority');
    assert.ok(leaf.checkIssued(ca));
    assert.equal(leaf.checkHost('myserver.local'), 'myserver.local');
    assert.equal(leaf.checkHost('myserver'), 'myserver');
    assert.equal(leaf.checkIP('192.168.1.20'), '192.168.1.20');
    assert.equal(leaf.checkIP('203.0.113.9'), undefined, 'a public address is left out: the authority may not vouch for it');
    assert.deepEqual(t.names.filter((n) => !privateAddress(n) && /\d/.test(n)), []);
    const days = (Date.parse(leaf.validTo) - Date.now()) / 86_400_000;
    assert.ok(days > 390 && days <= 398, `Apple accepts at most 398 days, got ${days}`);
    assert.match(leaf.keyUsage?.join(',') ?? '1.3.6.1.5.5.7.3.1', /1\.3\.6\.1\.5\.5\.7\.3\.1/);
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.openhbam-tls', 'local', 'ca.key')).mode & 0o777, 0o600);

    // Kept on the next start; made again when the names change, by the same authority.
    assert.equal(localCertificate(dir, NAMES).renewed, false);
    const moved = localCertificate(dir, [...NAMES.slice(0, 3), '192.168.1.50']);
    assert.equal(moved.renewed, true);
    assert.equal(moved.ca, t.ca);
    // A name the authority wasn't made for (the machine renamed) is left out rather than making a certificate devices refuse.
    assert.ok(!localCertificate(dir, ['other-name', 'other-name.local', '10.0.0.2']).names.includes('other-name'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

for (const workers of [1, 2]) test(`--https local${workers > 1 ? ' with --workers' : ''}: served over TLS, plain http is sent on to https, and the trust page and profile are open to all`, { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-local-https-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const files = localCertificateFiles(dir, ['localhost', '127.0.0.1']);
  const opts = { dir, port: 0, tlsCert: files.certPath, tlsKey: files.keyPath, log: (t: string) => { if (/could not/.test(t)) console.error('WORKERLOG', t); } };
  // Several processes: the front one holds the certificate, the workers behind it serve the pages.
  const s = workers > 1 ? await serveCluster(opts, workers) : await serve(opts);
  const port = Number(new URL(s.url).port);
  const get = (path: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> => new Promise((ok, fail) => {
    httpsRequest({ host: '127.0.0.1', port, path, ca: files.tls.ca, servername: 'localhost' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on('error', fail).end();
  });
  try {
    // Trusting only the folder's authority is enough: the chain checks out.
    const health = await get('/tabularius/health');
    assert.equal(health.status, 200);
    const sock = connect({ host: '127.0.0.1', port, ca: files.tls.ca, servername: 'localhost' });
    await new Promise((ok) => sock.once('secureConnect', ok));
    assert.equal(sock.authorized, true);
    sock.end();

    const plain = await fetch(`http://127.0.0.1:${port}/admin/?x=1`, { redirect: 'manual' });
    assert.equal(plain.status, 308);
    assert.equal(plain.headers.get('location'), `https://127.0.0.1:${port}/admin/?x=1`);

    const page = await get('/tabularius/tls/');
    assert.equal(page.status, 200);
    assert.match(page.body, /Trust this server/);
    assert.ok(page.body.includes(files.tls.fingerprint));
    const cer = await get('/tabularius/tls/ca.cer');
    assert.equal(cer.headers['content-type'], 'application/x-x509-ca-cert');
    const profile = await get('/tabularius/tls/tabularius.mobileconfig');
    assert.equal(profile.headers['content-type'], 'application/x-apple-aspen-config');
    assert.match(profile.body, /com\.apple\.security\.root/);
  } finally {
    if ('workers' in s) await s.close();
    else s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

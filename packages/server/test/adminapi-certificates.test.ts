// A certificate authority's certificate put in place through FileMaker Server's Admin API, as fmcsadmin's
// certificate create, import and delete do it; openssl stands in for the authority.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { connect } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, setAdminPassword } from '../src/index.ts';
import { certificateManaged, ImportedCertificates, parseSubject } from '../src/cert-import.ts';

const openssl = spawnSync('openssl', ['version']).status === 0;
const skip = openssl ? false : 'openssl is not installed';
let dir: string;
let ca: string;
let server: Server;
let port: number;

const run = (args: string[], cwd = ca) => {
  const r = spawnSync('openssl', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-certs-'));
  ca = mkdtempSync(join(tmpdir(), 'tabularius-certs-ca-'));
  // The certificate the server starts with, given in the folder's settings (as migrate-fms leaves it).
  mkdirSync(join(dir, 'tls'));
  run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=first.example.com', '-days', '2'], join(dir, 'tls'));
  writeFileSync(join(dir, '.openhbam-settings.json'), JSON.stringify({ tlsCert: 'tls/cert.pem', tlsKey: 'tls/key.pem' }));
  // An authority: a root and an intermediate it signed.
  writeFileSync(join(ca, 'ca.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-subj', '/CN=Test Root', '-days', '5', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'inter.key', '-out', 'inter.csr', '-subj', '/CN=Test Intermediate']);
  run(['x509', '-req', '-in', 'inter.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'inter.pem', '-days', '4', '-extfile', 'ca.ext']);
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, log: () => {}, tlsCert: join(dir, 'tls', 'cert.pem'), tlsKey: join(dir, 'tls', 'key.pem') });
  server = s.server;
  port = Number(new URL(s.url).port);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (ca) rmSync(ca, { recursive: true, force: true });
});

type Reply = { status: number; body: { response: Record<string, any>; messages: { code: string; text: string }[] } };
function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path: `/fmi/admin/api/v2${path}`, rejectUnauthorized: false, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => done({ status: res.statusCode!, body: JSON.parse(text) }));
    });
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const code = (r: Reply) => r.body.messages[0].code;
async function login(): Promise<Record<string, string>> {
  const r = await call('POST', '/user/auth', undefined, { authorization: 'Basic ' + btoa('admin:secret') });
  assert.equal(code(r), '0');
  return { authorization: `Bearer ${r.body.response.token}` };
}
/** The name on the certificate the server shows a new connection. */
const served = () => new Promise<string>((done, fail) => {
  const s = connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
    const cn = s.getPeerCertificate().subject.CN;
    s.end();
    done(String(Array.isArray(cn) ? cn[0] : cn));
  });
  s.on('error', fail);
});

test('where the certificate comes from decides whether one may be imported', () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-certs-managed-'));
  try {
    assert.equal(certificateManaged({ dir: d }), undefined);
    assert.match(certificateManaged({ dir: d, acme: {} })!, /--https/);
    assert.match(certificateManaged({ dir: d, tlsCert: join(d, 'x.pem') })!, /--tls-cert/);
    writeFileSync(join(d, '.openhbam-settings.json'), JSON.stringify({ tlsCert: 'x.pem', tlsKey: 'k.pem' }));
    assert.equal(certificateManaged({ dir: d, tlsCert: join(d, 'x.pem') }), undefined, 'the settings name it');
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('a common name that is no DNS name makes a request without one', { skip }, () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-certs-cn-'));
  try {
    const csr = new ImportedCertificates(d).createRequest('/CN=My Server/emailAddress=it@example.com', 'key-pass');
    writeFileSync(join(d, 'r.csr'), csr);
    const r = spawnSync('openssl', ['req', '-in', 'r.csr', '-verify', '-noout', '-text'], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Subject Alternative Name/);
    assert.throws(() => parseSubject('/CN=a/emailAddress=é@x'), /emailAddress/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('subjects are read as fmcsadmin writes them', () => {
  assert.deepEqual(parseSubject('/CN=files.example.com/O=Example Ltd/C=US'), [['CN', 'files.example.com'], ['O', 'Example Ltd'], ['C', 'US']]);
  assert.throws(() => parseSubject('/O=Example'), /needs one \/CN=/);
  assert.throws(() => parseSubject('/CN=a/C=USA'), /two-letter/);
  assert.throws(() => parseSubject('/CN=a/XX=b'), /Parameter is invalid: subject \(XX=b\)/);
});

test('create a request, import the authority\'s certificate (in use at once), then delete it', { skip }, async () => {
  const auth = await login();
  assert.equal(await served(), 'first.example.com');

  // fmcsadmin certificate create "/CN=files.example.com/O=Example" --keyfilepass …
  const subject = Buffer.from('/CN=files.example.com/O=Example').toString('base64');
  assert.equal(code(await call('PATCH', '/server/certificate/csr', { subject, password: 'x' }, auth)), '960', 'a short password');
  const made = await call('PATCH', '/server/certificate/csr', { subject, password: 'key-pass' }, auth);
  assert.equal(code(made), '0', made.body.messages[0].text);
  const csr = made.body.response.csr as string;
  assert.match(csr, /^-----BEGIN CERTIFICATE REQUEST-----\n/);
  writeFileSync(join(ca, 'server.csr'), csr);
  // A well-formed request, signed with its key, for the name asked.
  const checked = spawnSync('openssl', ['req', '-in', 'server.csr', '-verify', '-noout', '-subject'], { cwd: ca, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout + checked.stderr, /CN\s*=\s*files\.example\.com/);
  assert.equal(code(await call('PATCH', '/server/certificate/csr', { subject, password: 'key-pass' }, auth)), '1712', 'a second request while one waits');

  // The authority signs it.
  writeFileSync(join(ca, 'leaf.ext'), 'subjectAltName=DNS:files.example.com\n');
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'inter.pem', '-CAkey', 'inter.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '3', '-extfile', 'leaf.ext']);
  const certificate = readFileSync(join(ca, 'leaf.pem'), 'utf8');
  const inter = readFileSync(join(ca, 'inter.pem'), 'utf8');
  const root = readFileSync(join(ca, 'root.pem'), 'utf8');

  // fmcsadmin certificate import leaf.pem --intermediateCA chain.pem --keyfilepass … (the key stays on the server).
  assert.equal(code(await call('PATCH', '/server/certificate/import', { certificate, password: 'wrong' }, auth)), '960');
  const outOfOrder = await call('PATCH', '/server/certificate/import', { certificate, intermediateCertificates: root + inter, password: 'key-pass' }, auth);
  assert.equal(code(outOfOrder), '960');
  assert.match(outOfOrder.body.messages[0].text, /did not sign/);
  const otherKey = run(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048']);
  assert.match((await call('PATCH', '/server/certificate/import', { certificate, privateKey: otherKey }, auth)).body.messages[0].text, /doesn't go with the private key/);
  assert.equal(await served(), 'first.example.com', 'nothing changed by a refused import');

  const imported = await call('PATCH', '/server/certificate/import', { certificate, intermediateCertificates: inter + root, password: 'key-pass' }, auth);
  assert.equal(code(imported), '0', imported.body.messages[0].text);
  assert.equal(imported.body.response.restartRequired, false);
  assert.match(imported.body.response.subject, /CN=files\.example\.com/);
  assert.equal(await served(), 'files.example.com', 'in use for new connections at once');
  const settings = JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8'));
  assert.match(settings.tlsCert, /^\.openhbam-tls\/imported\/cert-[0-9a-z]+\.pem$/);
  assert.match(settings.tlsKey, /^\.openhbam-tls\/imported\/key-[0-9a-z]+\.pem$/);
  const saved = readFileSync(join(dir, settings.tlsCert), 'utf8');
  assert.equal((saved.match(/BEGIN CERTIFICATE/g) ?? []).length, 3, 'the chain is served with the certificate');
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, settings.tlsKey)).mode & 0o777, 0o600);
  // A new request may be made once the last one's certificate is in.
  assert.ok(!existsSync(join(dir, '.openhbam-tls', 'imported', 'request-key.pem')));

  // Imported again, as one full-chain file (fullchain.pem) with the key sent: new files, the old ones gone.
  const key = run(['pkey', '-in', join(dir, settings.tlsKey)], dir);
  await new Promise((r) => setTimeout(r, 5));
  const again = await call('PATCH', '/server/certificate/import', { certificate: certificate + inter, privateKey: key }, auth);
  assert.equal(code(again), '0', again.body.messages[0].text);
  const second = JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8'));
  assert.notEqual(second.tlsCert, settings.tlsCert);
  assert.ok(!existsSync(join(dir, settings.tlsCert)) && !existsSync(join(dir, settings.tlsKey)));
  assert.equal((readFileSync(join(dir, second.tlsCert), 'utf8').match(/BEGIN CERTIFICATE/g) ?? []).length, 2, 'the intermediate in the full chain is kept');

  // fmcsadmin certificate delete: the settings name what they did before the first import; the next start serves that.
  const gone = await call('DELETE', '/server/certificate/delete', undefined, auth);
  assert.equal(code(gone), '0');
  assert.equal(gone.body.response.restartRequired, true);
  const after = JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8'));
  assert.equal(after.tlsCert, 'tls/cert.pem');
  assert.equal(after.tlsKey, 'tls/key.pem');
  assert.ok(!existsSync(join(dir, '.openhbam-tls', 'imported')));
  assert.equal(code(await call('DELETE', '/server/certificate/delete', undefined, auth)), '1700');
  assert.equal(code(await call('PATCH', '/server/certificate/import', {}, auth)), '958');
});

test('not where the certificate comes from the command line', { skip }, async () => {
  const other = mkdtempSync(join(tmpdir(), 'tabularius-certs-flag-'));
  run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=flag.example.com', '-days', '2'], other);
  setAdminPassword(other, 'secret');
  const s = await serve({ dir: other, port: 0, log: () => {}, tlsCert: join(other, 'cert.pem'), tlsKey: join(other, 'key.pem') });
  try {
    const p = Number(new URL(s.url).port);
    const ask = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => new Promise<Reply>((done, fail) => {
      const req = request({ host: '127.0.0.1', port: p, method, path: `/fmi/admin/api/v2${path}`, rejectUnauthorized: false, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => done({ status: res.statusCode!, body: JSON.parse(text) }));
      });
      req.on('error', fail);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const token = (await ask('POST', '/user/auth', undefined, { authorization: 'Basic ' + btoa('admin:secret') })).body.response.token;
    const r = await ask('PATCH', '/server/certificate/csr', { subject: Buffer.from('/CN=x').toString('base64'), password: 'key-pass' }, { authorization: `Bearer ${token}` });
    assert.equal(code(r), '21');
    assert.match(r.body.messages[0].text, /--tls-cert/);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(other, { recursive: true, force: true });
  }
});

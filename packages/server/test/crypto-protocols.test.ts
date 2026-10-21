import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createStore, Store } from '../../store/src/index.ts';
import { totpCode } from '../../store/src/totp.ts';
import type { Host } from '../src/host.ts';
import { OAuthServer } from '../src/oauth.ts';
import { ScimDirectory } from '../src/scim.ts';
import { encryptFileSync, decryptFileSync, encryptFile, decryptFile, sealRecord, openRecord } from '../src/encrypt.ts';
import { signV4 } from '../src/s3.ts';
import { sameSecret } from '../src/secrets.ts';
import { expiryClock } from '../../store/src/clock.ts';

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-crypto-'));
  const path = join(dir, 'Local.sqlite'); createStore(path);
  const store = new Store(path, 'Local');
  store.setPassword('Admin', 'generated-password', '[Full Access]');
  return { dir, store, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('SCIM rotation, recovery one-use and TOTP replay use generated stores', () => {
  const f = fresh();
  try {
    const scim = new ScimDirectory(f.store);
    const first = scim.issueToken(); assert.equal(scim.tokenValid(first), true);
    assert.equal(scim.tokenValid(first + '!'), false);
    const second = scim.issueToken(); assert.notEqual(first, second);
    assert.equal(scim.tokenValid(first), false); assert.equal(scim.tokenValid(second), true);
    scim.revokeToken(); assert.equal(scim.tokenValid(second), false);
    const codes = f.store.generateRecoveryCodes('Admin');
    assert.equal(new Set(codes).size, 10);
    assert.equal(f.store.useRecoveryCode('Admin', codes[0], '127.0.0.1'), true);
    assert.equal(f.store.useRecoveryCode('Admin', codes[0], '127.0.0.1'), false);
    f.store.generateRecoveryCodes('Admin');
    assert.equal(f.store.useRecoveryCode('Admin', codes[1], '127.0.0.1'), false);
    const { secret } = f.store.enrollTotp('Admin');
    assert.equal(f.store.confirmTotp('Admin', totpCode(secret)), true);
    // A login consumes the matching step; its next replay is rejected.
    assert.equal(f.store.verifyTotp('Admin', totpCode(secret), '127.0.0.1'), true);
    assert.equal(f.store.verifyTotp('Admin', totpCode(secret), '127.0.0.1'), false);
  } finally { f.close(); }
});

test('RFC 7636, a racing refresh across workers and replay revocation survive a restart', async (t) => {
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  const f = fresh();
  const host = { get: (name: string) => name === 'Local' ? f.store : undefined, names: () => ['Local'], config: { blockNewUsers: () => false }, listFilesPublicly: false } as unknown as Host;
  let oauth = new OAuthServer(host, f.dir);
  let worker = new OAuthServer(host, f.dir);
  let requests = 0;
  const server = createServer((req, res) => { void (++requests % 2 ? oauth : worker).handle(req, res, new URL(req.url!, 'http://127.0.0.1')).catch((e) => { res.writeHead(500).end(String(e)); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const redirect = 'http://127.0.0.1:45678/callback';
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const post = (path: string, values: Record<string, string>) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  try {
    const registration = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Generated', redirect_uris: [redirect] }) });
    assert.equal(registration.status, 201);
    const { client_id } = await registration.json() as { client_id: string };
    const otherRegistration = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Other generated', redirect_uris: [redirect] }) });
    assert.equal(otherRegistration.status, 201);
    const other = await otherRegistration.json() as { client_id: string };
    const authorize = async () => {
      // The sign-in page sets an anti-forgery cookie and field that the POST carries back.
      const query = { client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
      const page = await fetch(`${base}/oauth/authorize?${new URLSearchParams(query)}`, { redirect: 'manual' });
      const html = await page.text();
      assert.equal(page.status, 200, html);
      const fields = Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
      const res = await fetch(base + '/oauth/authorize', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: page.headers.get('set-cookie')?.split(';')[0] ?? '' },
        body: new URLSearchParams({ ...fields, database: 'Local', account: 'Admin', password: 'generated-password' }) });
      assert.equal(res.status, 302, await res.clone().text());
      return new URL(res.headers.get('location')!).searchParams.get('code')!;
    };
    const exchange = (code: string, code_verifier = verifier) => post('/oauth/token', { grant_type: 'authorization_code', code, code_verifier, client_id, redirect_uri: redirect });
    for (const bad of ['short', 'a'.repeat(129), '!'.repeat(43), 'a'.repeat(43)]) assert.equal((await exchange(await authorize(), bad)).status, 400);
    const code = await authorize();
    assert.equal((await post('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: other.client_id, redirect_uri: redirect })).status, 400);
    const tokenResponse = await exchange(code); assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text());
    const first = await tokenResponse.json() as { refresh_token: string; access_token: string };
    assert.equal((await exchange(code)).status, 400);
    const rotate = (refresh_token: string) => post('/oauth/token', { grant_type: 'refresh_token', refresh_token, client_id });
    const results = await Promise.all([rotate(first.refresh_token), rotate(first.refresh_token)]);
    // Two requests racing with one token: one rotates, the other is refused, and the sign-in is kept.
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const second = await results.find((r) => r.status === 200)!.json() as typeof first;
    await results.find((r) => r.status === 400)!.body?.cancel();
    assert.notEqual(first.refresh_token, second.refresh_token); assert.notEqual(first.access_token, second.access_token);
    assert.ok(f.store.apiToken(second.access_token), 'the race does not end the sign-in');
    oauth.close(); worker.close();
    oauth = new OAuthServer(host, f.dir); worker = new OAuthServer(host, f.dir);
    // After the race window a replay of the spent token is theft, also after a restart: the whole sign-in ends.
    now += 10_001;
    assert.equal((await rotate(first.refresh_token)).status, 400);
    assert.equal((await rotate(second.refresh_token)).status, 400);
    assert.equal(f.store.apiTokens().length, 0);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    worker.close(); oauth.close(); f.close();
  }
});

test('constant-time secret comparison checks UTF-8 byte lengths before comparing', () => {
  assert.equal(sameSecret('secret', 'secret'), true);
  assert.equal(sameSecret('secret', 'secreé'), false);
  assert.equal(sameSecret('é', 'e'), false);
  assert.equal(sameSecret('é', 'é'), true);
});

test('encrypted files and records reject wrong keys, truncation, tampering and nonce mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-encryption-vector-'));
  const source = join(dir, 'source'), sealed = join(dir, 'sealed'), output = join(dir, 'output');
  try {
    const plain = Buffer.from('generated input'); writeFileSync(source, plain);
    encryptFileSync(source, sealed, 'generated passphrase');
    decryptFileSync(sealed, output, 'generated passphrase'); assert.deepEqual(readFileSync(output), plain);
    const good = readFileSync(sealed);
    assert.throws(() => decryptFileSync(sealed, output, 'wrong'));
    for (const bad of [good.subarray(0, -1), Buffer.concat([good, Buffer.from([0])]), Buffer.from(good)]) {
      if (bad.length === good.length) bad[bad.length - 1] ^= 1;
      writeFileSync(sealed, bad); assert.throws(() => decryptFileSync(sealed, output, 'generated passphrase'));
    }
    await encryptFile(source, sealed, 'generated passphrase'); await decryptFile(sealed, output, 'generated passphrase');
    assert.deepEqual(readFileSync(output), plain);
    const key = Buffer.alloc(32, 7), prefix = Buffer.alloc(8, 8), record = sealRecord(key, prefix, 0, plain);
    assert.deepEqual(openRecord(key, prefix, 0, record), plain);
    assert.throws(() => openRecord(key, prefix, 1, record));
    assert.throws(() => openRecord(key, prefix, 0, record.subarray(0, -1)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AWS S3 published GET Object signature', () => {
  const h = signV4({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', accessKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''), secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', date: new Date('2013-05-24T00:00:00Z') });
  assert.ok(h.authorization.endsWith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'));
});

test('S3 canonicalization handles header casing once and folds only HTTP whitespace', () => {
  const sign = (headers: Record<string, string>) => signV4({ method: 'GET', host: '127.0.0.1', path: '/key', headers, payloadHash: '0'.repeat(64), accessKey: 'generated', secretKey: 'secret', region: 'us-east-1', date: new Date('2013-05-24T00:00:00Z') });
  const expected = sign({ 'x-amz-meta-a': 'one two' });
  const actual = sign({ 'X-Amz-Meta-A': ' one\t two ', Host: 'wrong', 'X-Amz-Date': 'wrong', Authorization: 'old' });
  assert.equal(actual.authorization, expected.authorization);
  assert.notEqual(sign({ 'x-amz-meta-a': 'one\u00a0two' }).authorization, expected.authorization);
});

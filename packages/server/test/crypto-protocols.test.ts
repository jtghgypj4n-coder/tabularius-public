import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createStore, Store } from '../../store/src/index.ts';
import { totpCode } from '../../store/src/totp.ts';
import type { Host } from '../src/host.ts';
import { OAuthServer } from '../src/oauth.ts';
import { ScimDirectory } from '../src/scim.ts';
import { encryptFileSync, decryptFileSync, encryptFile, decryptFile, sealRecord, openRecord } from '../src/encrypt.ts';
import { signV4 } from '../src/s3.ts';
import { sameSecret } from '../src/secrets.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage } from 'node:http';

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

test('RFC 7636, concurrent refresh retry across workers and replay revocation survive a restart', async () => {
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
      const res = await post('/oauth/authorize', { client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', database: 'Local', account: 'Admin', password: 'generated-password' });
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
    const [rotated, concurrent] = await Promise.all([rotate(first.refresh_token), rotate(first.refresh_token)]);
    assert.equal(rotated.status, 200); assert.equal(concurrent.status, 200);
    const second = await rotated.json() as typeof first;
    assert.deepEqual(await concurrent.json(), second, 'two in-flight requests receive exactly the same pair');
    assert.notEqual(first.refresh_token, second.refresh_token); assert.notEqual(first.access_token, second.access_token);
    oauth.close(); worker.close();
    oauth = new OAuthServer(host, f.dir); worker = new OAuthServer(host, f.dir);
    const retry = await rotate(first.refresh_token);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), second, 'a lost response can be recovered after restart');
    assert.equal(f.store.apiTokens().length, 1, 'a retry does not mint extra access tokens');
    const next = await rotate(second.refresh_token);
    assert.equal(next.status, 200);
    const third = await next.json() as typeof first;
    assert.equal((await rotate(first.refresh_token)).status, 400);
    assert.equal((await rotate(third.refresh_token)).status, 400, 'using the newer refresh token ends its predecessor\'s grace');
    assert.equal(f.store.apiTokens().length, 0);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    worker.close(); oauth.close(); f.close();
  }
});

type Pair = { refresh_token: string; access_token: string };
type Client = { id: string; name: string };
function refreshFixture() {
  const f = fresh();
  const host = { get: () => f.store, config: { blockNewUsers: () => false } } as unknown as Host;
  const oauth = new OAuthServer(host, f.dir);
  const core = oauth as unknown as { db: DatabaseSync; refreshHistoryLimit: number; issue(client: Client, database: string, account: string, from: string): Pair; rotateRefresh(client: Client, req: IncomingMessage, form: URLSearchParams): Pair; revoke(req: IncomingMessage, form: URLSearchParams): void; sweep(): void };
  const client = { id: 'generated', name: 'Generated' }, other = { id: 'other', name: 'Other' };
  for (const c of [client, other]) core.db.prepare('INSERT INTO clients (id, name, redirect_uris, created) VALUES (?, ?, ?, ?)').run(c.id, c.name, '[]', Date.now());
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage;
  const issue = (c = client) => core.issue(c, 'Local', 'Admin', '127.0.0.1');
  const rotate = (pair: Pair, c = client) => core.rotateRefresh(c, req, new URLSearchParams({ refresh_token: pair.refresh_token }));
  const revoke = (token: string, c = client) => core.revoke(req, new URLSearchParams({ token, client_id: c.id }));
  return { ...f, core, client, other, issue, rotate, revoke, close() { oauth.close(); f.close(); } };
}
const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');

test('one large family cannot block another and normal refresh continues indefinitely with bounded history', (t) => {
  const f = refreshFixture();
  let now = 2000000000000;
  t.mock.method(expiryClock, 'now', () => now);
  try {
    const { core } = f;
    core.refreshHistoryLimit = 3; // Probe the retention boundary repeatedly without a thousand rotations.
    let noisy = f.issue(), ordinary = f.issue(f.other);
    const family = tokenHash(noisy.refresh_token);
    const start = now;
    core.db.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100000)
      INSERT INTO refresh_history (hash, client_id, family, expires) SELECT 'legacy-' || n, ?, ?, ? FROM seq`).run(f.client.id, family, now + 30 * 86400000);
    ordinary = f.rotate(ordinary, f.other); // The former global cap is already reached by one other family.
    noisy = f.rotate(noisy); // A migrated family over the old per-family cap is pruned on its next rotation.
    for (let i = 0; i < 45; i++) {
      now += 86400000;
      const old = noisy;
      noisy = f.rotate(noisy); ordinary = f.rotate(ordinary, f.other);
      assert.notEqual(noisy.refresh_token, old.refresh_token);
      assert.equal(core.db.prepare('SELECT 1 FROM refresh WHERE hash = ?').get(tokenHash(old.refresh_token)), undefined);
      const counts = core.db.prepare('SELECT COUNT(*) AS n, COUNT(retry) AS retries FROM refresh_history GROUP BY family').all() as { n: number; retries: number }[];
      assert.equal(counts.length, 2);
      for (const count of counts) { assert.ok(count.n <= 3); assert.equal(count.retries, 1); }
      assert.equal(f.store.apiTokens().length, 2);
    }
    assert.ok(now > start + 30 * 86400000, 'normal use outlives the original rolling expiry');
    now -= 60000;
    noisy = f.rotate(noisy);
    const expiry = (core.db.prepare('SELECT expires FROM refresh WHERE family = ?').get(family) as { expires: number }).expires;
    assert.equal((core.db.prepare('SELECT MIN(expires) AS exp FROM refresh_history WHERE family = ?').get(family) as { exp: number }).exp, expiry);
    f.revoke(ordinary.refresh_token, f.other);
    assert.equal((core.db.prepare('SELECT COUNT(*) AS n FROM refresh_history').get() as { n: number }).n, 3);
    now = expiry; core.sweep();
    assert.equal(core.db.prepare('SELECT * FROM refresh_history').all().length, 0);
    assert.equal(f.store.apiTokens().length, 0);
    now -= 120000; core.sweep();
    assert.equal(core.db.prepare('SELECT * FROM refresh').all().length, 0, 'expired state cannot resurrect');
  } finally { f.close(); }
});

test('refresh retry has a fixed deadline through backward clock edits and cannot resurrect after expiry', (t) => {
  const f = refreshFixture();
  let wall = Date.now(), mono = 0;
  const clock = new ExpiryClock(() => wall, () => mono, () => {});
  t.mock.method(expiryClock, 'now', () => clock.now());
  try {
    const first = f.issue(), next = f.rotate(first);
    const persisted = JSON.stringify(f.core.db.prepare('SELECT * FROM refresh_history').all());
    for (const secret of [first.refresh_token, next.refresh_token, next.access_token]) assert.equal(persisted.includes(secret), false);
    wall -= 3600000; mono = 30000;
    assert.deepEqual(f.rotate(first), next);
    mono = 44999;
    assert.deepEqual(f.rotate(first), next, 'retries do not move the original deadline');
    mono = 45000;
    assert.throws(() => f.rotate(first), /not valid/);
    assert.equal(f.core.db.prepare('SELECT * FROM refresh_history').all().length, 0);
    assert.equal(f.store.apiTokens().length, 0);
    wall += 3600000;
    assert.throws(() => f.rotate(next), /not valid/);
  } finally { f.close(); }
});

test('sweeping after a forward clock edit discards the retry even when the clock is corrected', (t) => {
  const f = refreshFixture();
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  try {
    const first = f.issue(), next = f.rotate(first);
    now += 45000; f.core.sweep();
    assert.equal((f.core.db.prepare('SELECT retry FROM refresh_history').get() as { retry: string | null }).retry, null);
    now -= 45000;
    assert.throws(() => f.rotate(first), /not valid/);
    assert.throws(() => f.rotate(next), /not valid/);
    assert.equal(f.store.apiTokens().length, 0);
  } finally { f.close(); }
});

test('the sealed retry pair is cleared when its window closes, without another token request', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = refreshFixture();
  let now = Date.now();
  t.mock.method(expiryClock, 'now', () => now);
  try {
    const first = f.issue();
    f.rotate(first);
    const sealed = () => (f.core.db.prepare('SELECT COUNT(retry) AS n FROM refresh_history').get() as { n: number }).n;
    assert.equal(sealed(), 1);
    now += 46000; t.mock.timers.tick(46000);
    assert.equal(sealed(), 0, 'nothing stays decryptable after the window');
  } finally { f.close(); }
});

test('inactive accounts keep both normal refresh and retry state, and recover after reactivation', (t) => {
  const f = refreshFixture();
  f.store.setPassword('Recovery', 'generated-recovery-password', '[Full Access]');
  t.mock.method(expiryClock, 'now', () => 2000000000000);
  try {
    const first = f.issue(), next = f.rotate(first);
    const state = () => ({ refresh: f.core.db.prepare('SELECT * FROM refresh').all(), history: f.core.db.prepare('SELECT * FROM refresh_history').all(), access: f.store.apiTokens() });
    f.store.setAccountActive('Admin', false);
    const before = state();
    for (const pair of [first, next, first]) {
      assert.throws(() => f.rotate(pair), /no longer eligible/);
      assert.deepEqual(state(), before, 'inactivity neither rotates nor revokes nor extends the retry deadline');
      assert.equal(f.core.db.isTransaction, false);
    }
    f.store.setAccountActive('Admin', true);
    assert.deepEqual(f.rotate(first), next, 'the original response remains recoverable');
    assert.notEqual(f.rotate(next).refresh_token, next.refresh_token, 'normal refresh resumes');
  } finally { f.close(); }
});

for (const reason of ['outside window', 'access used', 'refresh used', 'other client']) {
  test(`inactivity cannot prevent replay revocation when ${reason}`, (t) => {
    const f = refreshFixture();
    f.store.setPassword('Recovery', 'generated-recovery-password', '[Full Access]');
    let now = 2000000000000;
    t.mock.method(expiryClock, 'now', () => now);
    try {
      const first = f.issue(), next = f.rotate(first);
      if (reason === 'access used') assert.ok(f.store.apiToken(next.access_token));
      if (reason === 'refresh used') f.rotate(next);
      if (reason === 'outside window') now += 45000;
      f.store.setAccountActive('Admin', false);
      assert.throws(() => f.rotate(first, reason === 'other client' ? f.other : f.client), /not valid/);
      assert.equal(f.core.db.prepare('SELECT * FROM refresh').all().length, 0);
      assert.equal(f.core.db.prepare('SELECT * FROM refresh_history').all().length, 0);
      assert.equal(f.store.apiTokens().length, 0);
      assert.equal(f.core.db.isTransaction, false);
    } finally { f.close(); }
  });
}

for (const reason of ['access used', 'other client', 'password changed', 'retry tampered']) {
  test(`refresh replay revokes during grace when ${reason}`, () => {
    const f = refreshFixture();
    try {
      const first = f.issue(), next = f.rotate(first), unrelated = f.issue(f.other);
      if (reason === 'access used') assert.ok(f.store.apiToken(next.access_token));
      if (reason === 'password changed') f.store.setPassword('Admin', 'changed-password', '[Full Access]');
      if (reason === 'retry tampered') f.core.db.prepare("UPDATE refresh_history SET retry = 'invalid' WHERE hash = ?").run(tokenHash(first.refresh_token));
      assert.throws(() => f.rotate(first, reason === 'other client' ? f.other : f.client), /not valid/);
      assert.throws(() => f.rotate(next), /not valid/);
      assert.equal(f.core.db.prepare('SELECT * FROM refresh_history').all().length, 0);
      assert.equal(f.core.db.isTransaction, false);
      assert.equal(f.store.apiToken(next.access_token), undefined);
      assert.ok(f.core.db.prepare('SELECT 1 FROM refresh WHERE hash = ?').get(tokenHash(unrelated.refresh_token)), 'another family survives');
    } finally { f.close(); }
  });
}

for (const kind of ['refresh', 'access', 'used refresh', 'Manage Security']) {
  test(`revoking by ${kind} removes family history along with its refresh row`, () => {
    const f = refreshFixture();
    try {
      const first = f.issue(), next = f.rotate(first);
      const sibling = f.rotate(f.issue());
      const family = tokenHash(first.refresh_token);
      const value = kind === 'used refresh' ? first.refresh_token : kind === 'access' ? next.access_token : next.refresh_token;
      f.revoke(value, f.other);
      assert.ok(f.core.db.prepare('SELECT 1 FROM refresh_history WHERE family = ?').get(family));
      if (kind === 'Manage Security') {
        f.store.revokeApiToken(/^ohbt_([0-9a-f]+)\./.exec(next.access_token)![1]);
        assert.throws(() => f.rotate(next), /revoked/);
      } else f.revoke(value);
      assert.equal(f.core.db.prepare('SELECT 1 FROM refresh_history WHERE family = ?').get(family), undefined);
      assert.equal(f.core.db.prepare('SELECT 1 FROM refresh WHERE family = ?').get(family), undefined);
      assert.equal(f.core.db.isTransaction, false);
      assert.equal(f.store.apiToken(next.access_token), undefined);
      assert.ok(f.store.apiToken(sibling.access_token), 'another grant for the same client survives');
    } finally { f.close(); }
  });
}

test('a password change revokes the family and its history without rolling the cleanup back', () => {
  const f = refreshFixture();
  try {
    const next = f.rotate(f.issue());
    f.store.setPassword('Admin', 'changed-password', '[Full Access]');
    assert.throws(() => f.rotate(next), /password or access changed/);
    assert.equal(f.core.db.prepare('SELECT * FROM refresh').all().length, 0);
    assert.equal(f.core.db.prepare('SELECT * FROM refresh_history').all().length, 0);
    assert.equal(f.store.apiToken(next.access_token), undefined);
    assert.equal(f.core.db.isTransaction, false);
  } finally { f.close(); }
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

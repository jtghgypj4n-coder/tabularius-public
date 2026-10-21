import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto';
import { createServer } from 'node:http';
import { Oidc, verifyIdTokenSignature } from '../src/oidc.ts';
import { expiryClock } from '../../store/src/clock.ts';
import vectors from './crypto-jws-vectors.json' with { type: 'json' };

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'one', alg: 'RS256', use: 'sig' };
const issuer = 'http://127.0.0.1';
const provider = { name: 'Generated', issuer, clientId: 'client' };
const discovery = { issuer, jwks_uri: issuer + '/keys' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const claims = () => ({ iss: issuer, aud: 'client', sub: 'person', iat: 1000, exp: 1300, nonce: 'nonce' });
function jwt(patch = {}, header: Record<string, unknown> = {}, key = rsa.privateKey) {
  const input = `${b64({ alg: 'RS256', kid: 'one', ...header })}.${b64({ ...claims(), ...patch })}`;
  return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}
// Exercise the production private verifier without creating an unrelated hosted database.
const verifier = Object.create(Oidc.prototype) as { verify(s: unknown, token: string, d: unknown, nonce: string): Promise<Record<string, unknown>> };
const state = (keys: JsonWebKey[] = [jwk]) => ({ provider, keys: { value: keys, at: performance.now() } });

test('RFC 7515 appendices: RS256 and ES256 verify; unsupported HS256, ES512, none and RFC 7519 JWE reject', () => {
  for (const v of vectors) {
    if (['RFC 7515 A.2', 'RFC 7515 A.3'].includes(v.section)) {
      assert.equal(verifyIdTokenSignature(v.token, v.key).iss, 'joe');
      const parts = v.token.split('.'); parts[1] = b64({ iss: 'mallory' });
      assert.throws(() => verifyIdTokenSignature(parts.join('.'), v.key), /signature/);
    } else assert.throws(() => verifyIdTokenSignature(v.token, v.key), v.section);
  }
});

test('OIDC binds signature algorithm to key type, curve and JWK permissions', () => {
  const input = jwt({}, {}, ec.privateKey); // EC signature advertised as RSA was previously accepted.
  assert.throws(() => verifyIdTokenSignature(input, ec.publicKey.export({ format: 'jwk' })), /algorithm/);
  for (const patch of [{ alg: 'RS512' }, { use: 'enc' }, { key_ops: ['encrypt'] }]) assert.throws(() => verifyIdTokenSignature(jwt(), { ...jwk, ...patch }), /algorithm/);
  const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const signed = `${b64({ alg: 'ES256' })}.${b64(claims())}`;
  const token = `${signed}.${sign('sha256', Buffer.from(signed), { key: p384.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  assert.throws(() => verifyIdTokenSignature(token, p384.publicKey.export({ format: 'jwk' })), /algorithm/);
});

test('every allowed OIDC signature algorithm verifies a generated signature', () => {
  const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  for (const alg of ['RS256', 'RS384', 'RS512', 'PS256', 'ES256', 'ES384']) {
    const pair = alg === 'ES256' ? ec : alg === 'ES384' ? p384 : rsa;
    const hash = 'sha' + alg.slice(2);
    const options = alg === 'PS256' ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : alg.startsWith('ES') ? { dsaEncoding: 'ieee-p1363' as const } : {};
    const input = `${b64({ alg })}.${b64(claims())}`;
    const token = `${input}.${sign(hash, Buffer.from(input), { key: pair.privateKey, ...options }).toString('base64url')}`;
    assert.equal(verifyIdTokenSignature(token, pair.publicKey.export({ format: 'jwk' })).sub, 'person');
  }
});

test('OIDC rejects an RSA signing key below the RFC 7518 minimum', () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  assert.throws(() => verifyIdTokenSignature(jwt({}, {}, weak.privateKey), weak.publicKey.export({ format: 'jwk' })), /2048 bits/);
});

test('OIDC rejects unsupported critical headers and malformed compact serialization', () => {
  assert.throws(() => verifyIdTokenSignature(jwt({}, { crit: ['unknown'], unknown: true }), jwk), /extension/);
  for (const token of [jwt() + '!', jwt().replace('.', '=.'), 'e30.W10.AA', 'bnVsbA.e30.AA', jwt({}, { kid: 7 }), jwt({}, { alg: 'constructor' }), jwt({}, { alg: 'none' }), jwt({}, { b64: false })]) assert.throws(() => verifyIdTokenSignature(token, jwk));
});

test('OIDC enforces finite NumericDates, nbf and exact 60-second expiry skew across clock edits', async (t) => {
  let now = 1000;
  t.mock.method(expiryClock, 'now', () => now * 1000);
  const valid = jwt({ exp: 1000, nbf: 1060 });
  await verifier.verify(state(), valid, discovery, 'nonce');
  for (const patch of [{ nbf: 1061 }, { nbf: '1000' }, { exp: '1300' }, { exp: null }, { exp: 940 }, { sub: '' }, { iat: '1000' }]) await assert.rejects(verifier.verify(state(), jwt(patch), discovery, 'nonce'));
  now = 1060; await assert.rejects(verifier.verify(state(), valid, discovery, 'nonce'), /expired/);
  now = 1000; await verifier.verify(state(), valid, discovery, 'nonce');
});

test('OIDC checks audience types, authorized party and configured issuer', async (t) => {
  t.mock.method(expiryClock, 'now', () => 1000000);
  for (const patch of [{ aud: ['client', 7] }, { aud: ['client', 'other'] }, { azp: 'other' }, { iss: 'other' }, { aud: 'other' }]) await assert.rejects(verifier.verify(state(), jwt(patch), discovery, 'nonce'));
  await verifier.verify(state(), jwt({ aud: ['client', 'other'], azp: 'client' }), discovery, 'nonce');
  await assert.rejects(verifier.verify({ ...state(), provider: { ...provider, issuer: 'other' } }, jwt(), discovery, 'nonce'), /issuer/);
  await assert.rejects(verifier.verify(state(), jwt(), discovery, 'wrong'), /sign-in/);
});

test('OIDC accepts an issuer that differs from the configured one only by a trailing slash', async (t) => {
  t.mock.method(expiryClock, 'now', () => 1000000);
  const slashed = issuer + '/';
  await verifier.verify(state(), jwt({ iss: slashed }), { ...discovery, issuer: slashed }, 'nonce');
  await verifier.verify({ ...state(), provider: { ...provider, issuer: slashed } }, jwt(), discovery, 'nonce');
  await assert.rejects(verifier.verify(state(), jwt({ iss: issuer + '/x' }), discovery, 'nonce'), /issuer/);
  await verifier.verify(state(), jwt({ iss: slashed }), discovery, 'nonce');
});

test('OIDC key selection rejects ambiguous kid and refreshes unknown keys only from the configured JWKS', async (t) => {
  t.mock.method(expiryClock, 'now', () => 1000000);
  const duplicate = [jwk, { ...jwk }];
  await assert.rejects(verifier.verify(state(duplicate), jwt(), discovery, 'nonce'), /ambiguous/);
  await assert.rejects(verifier.verify(state([jwk, { ...jwk, kid: 'two' }]), jwt({}, { kid: undefined }), discovery, 'nonce'), /ambiguous/);
  let reads = 0;
  const server = createServer((_req, res) => { reads++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'rotated' }] })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const d = { ...discovery, jwks_uri: `http://127.0.0.1:${(server.address() as { port: number }).port}/keys` };
    const s = state();
    await verifier.verify(s, jwt({}, { kid: 'rotated' }), d, 'nonce');
    assert.equal(reads, 1);
    await assert.rejects(verifier.verify(s, jwt({}, { kid: 'absent' }), d, 'nonce'), /unknown key/);
    assert.equal(reads, 2);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

// The passkey (WebAuthn) crypto core: register a credential and verify a
// sign-in assertion, end to end, with a real P-256 key — no browser. A tiny
// CBOR encoder here builds the attestation object and COSE key the way an
// authenticator would, so verifyRegistration/verifyAssertion are exercised
// against genuine signatures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { verifyRegistration, verifyAssertion } from '../src/webauthn.ts';

// --- a minimal CBOR encoder (enough to forge an authenticator's output) ------
function cbor(value: unknown): Buffer {
  if (typeof value === 'number') {
    const major = value < 0 ? 1 : 0;
    const n = value < 0 ? -1 - value : value;
    return head(major, n);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (typeof value === 'string') { const b = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) {
    const parts = [head(5, value.size)];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return Buffer.concat(parts);
  }
  throw new Error('cannot encode ' + typeof value);
}
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  return Buffer.from([(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const RP_ID = 'host.example';
const ORIGIN = 'https://host.example';

function coseKey(pub: KeyObject): Buffer {
  const jwk = pub.export({ format: 'jwk' }) as { x: string; y: string };
  return cbor(new Map<number, unknown>([
    [1, 2],   // kty: EC2
    [3, -7],  // alg: ES256
    [-1, 1],  // crv: P-256
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
}

function authData(opts: { signCount: number; attested?: Buffer; cose?: Buffer }): Buffer {
  const flags = 0x01 | 0x04 | (opts.attested ? 0x40 : 0); // UP | UV | (AT)
  const head5 = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([flags]), countBuf(opts.signCount)]);
  if (!opts.attested) return head5;
  const credLen = Buffer.from([opts.attested.length >> 8, opts.attested.length & 0xff]);
  return Buffer.concat([head5, Buffer.alloc(16), credLen, opts.attested, opts.cose!]);
}
const countBuf = (n: number) => Buffer.from([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

function makeCredential() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credId = randomBytes(32);
  const cose = coseKey(publicKey);
  return { privateKey, credId, cose };
}

function register(cred: ReturnType<typeof makeCredential>, challenge: string, signCount = 0) {
  const ad = authData({ signCount, attested: cred.credId, cose: cred.cose });
  const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN }));
  return { attestationObject: b64(attestationObject), clientDataJSON: b64(clientDataJSON), challenge, origin: ORIGIN, rpId: RP_ID };
}

function assert_(cred: ReturnType<typeof makeCredential>, publicKey: string, challenge: string, signCount: number, tamper = false) {
  const ad = authData({ signCount });
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN }));
  const signed = Buffer.concat([ad, sha256(clientDataJSON)]);
  const sig = createSign('sha256').update(signed).sign({ key: cred.privateKey, dsaEncoding: 'der' });
  if (tamper) sig[sig.length - 1] ^= 0xff;
  return { publicKey, clientDataJSON: b64(clientDataJSON), authenticatorData: b64(ad), signature: b64(sig), challenge, origin: ORIGIN, rpId: RP_ID, storedSignCount: 0 };
}

test('a registration is verified and yields a storable credential', () => {
  const cred = makeCredential();
  const challenge = b64(randomBytes(32));
  const reg = verifyRegistration(register(cred, challenge, 5));
  assert.equal(reg.credentialId, b64(cred.credId));
  assert.equal(reg.alg, -7);
  assert.equal(reg.signCount, 5);
  assert.ok(reg.publicKey.length > 0);
});

test('a genuine assertion verifies against the registered key', () => {
  const cred = makeCredential();
  const reg = verifyRegistration(register(cred, b64(randomBytes(32))));
  const challenge = b64(randomBytes(32));
  const { signCount } = verifyAssertion(assert_(cred, reg.publicKey, challenge, 1, false));
  assert.equal(signCount, 1);
});

test('a tampered signature is rejected', () => {
  const cred = makeCredential();
  const reg = verifyRegistration(register(cred, b64(randomBytes(32))));
  assert.throws(() => verifyAssertion(assert_(cred, reg.publicKey, b64(randomBytes(32)), 1, true)), /did not verify/);
});

test('the wrong challenge is rejected', () => {
  const cred = makeCredential();
  const reg = verifyRegistration(register(cred, b64(randomBytes(32))));
  const a = assert_(cred, reg.publicKey, b64(randomBytes(32)), 1);
  a.challenge = b64(randomBytes(32)); // server expected a different challenge
  assert.throws(() => verifyAssertion(a), /challenge does not match/);
});

test('a foreign origin is rejected', () => {
  const cred = makeCredential();
  const reg = verifyRegistration(register(cred, b64(randomBytes(32))));
  const a = assert_(cred, reg.publicKey, b64(randomBytes(32)), 1);
  a.origin = 'https://evil.example';
  assert.throws(() => verifyAssertion(a), /origin/);
});

test('a counter that does not advance is rejected (cloned credential)', () => {
  const cred = makeCredential();
  const reg = verifyRegistration(register(cred, b64(randomBytes(32)), 10));
  // stored counter 10, assertion presents 10 — no advance.
  assert.throws(() => verifyAssertion({ ...assert_(cred, reg.publicKey, b64(randomBytes(32)), 10), storedSignCount: 10 }), /counter/);
});

test('the challenge and rp are bound: a different rpId fails to verify', () => {
  const cred = makeCredential();
  const reg = verifyRegistration(register(cred, b64(randomBytes(32))));
  const a = assert_(cred, reg.publicKey, b64(randomBytes(32)), 1);
  a.rpId = 'other.example';
  assert.throws(() => verifyAssertion(a), /rpIdHash/);
});

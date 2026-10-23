import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyRegistration, verifyAssertion } from '../src/webauthn.ts';
import { cbor, makeAuthenticator, forgeRegistration, forgeAssertion } from './forge-webauthn.ts';

const env = { rpId: '127.0.0.1', origin: 'http://127.0.0.1', challenge: Buffer.alloc(32, 42).toString('base64url') };
const a = makeAuthenticator(env.rpId, env.origin);
const b64 = (v: Uint8Array) => Buffer.from(v).toString('base64url');
function registration(cose = a.cose) { return { ...env, ...forgeRegistration({ ...a, cose }, env.challenge) }; }
function assertion(flags = 5, extra: Buffer = Buffer.alloc(0), cdExtra = {}) {
  const response = forgeAssertion(a, env.challenge);
  const ad = Buffer.concat([Buffer.from(response.authenticatorData, 'base64url'), extra]); ad[32] = flags;
  const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: env.challenge, origin: env.origin, ...cdExtra }));
  const signed = Buffer.concat([ad, createHash('sha256').update(cd).digest()]);
  return { ...env, ...response, publicKey: b64(a.cose), storedSignCount: 0, authenticatorData: b64(ad), clientDataJSON: b64(cd), signature: b64(sign('sha256', signed, a.privateKey)) };
}

test('WebAuthn 6.5.1.1 published ES256 COSE key registers', () => {
  const cose = Buffer.from('a501020326200121582065eda5a12577c2bae829437fe338701a10aaa375e1bb5b5de108de439c08551d2258201e52ed75701163f7f9e40ddf9f341b3dc9ba860af7e0ca7ca7e9eecd0084d19c', 'hex');
  const reg = verifyRegistration(registration(cose));
  assert.equal(reg.publicKey, b64(cose)); assert.equal(reg.alg, -7);
});

test('WebAuthn generated RS256 ceremonies verify and unsupported PS256 registration rejects', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const key = (alg: number) => cbor(new Map<number, unknown>([[1, 3], [3, alg], [-1, Buffer.from(jwk.n!, 'base64url')], [-2, Buffer.from(jwk.e!, 'base64url')]]));
  const rsa = { ...a, privateKey: pair.privateKey, cose: key(-257) };
  const registered = verifyRegistration({ ...env, ...forgeRegistration(rsa, env.challenge) });
  assert.equal(registered.alg, -257);
  assert.deepEqual(verifyAssertion({ ...env, ...forgeAssertion(rsa, env.challenge), publicKey: registered.publicKey, storedSignCount: 0 }), { signCount: 1 });
  assert.throws(() => verifyRegistration({ ...env, ...forgeRegistration({ ...rsa, cose: key(-37) }, env.challenge) }), /algorithm/);
});

test('COSE must bind ES256 to its declared P-256 curve and integer algorithm', () => {
  const wrongCurve = Buffer.from(a.cose); wrongCurve[6] = 2;
  assert.throws(() => verifyRegistration(registration(wrongCurve)), /curve/);
  const pub = new Map<unknown, unknown>([[1, 2], [3, '-7'], [-1, 1], [-2, a.cose.subarray(10, 42)], [-3, a.cose.subarray(-32)]]);
  assert.throws(() => verifyRegistration(registration(cbor(pub))), /algorithm/);
});

test('CBOR rejects trailing bytes, duplicate keys, truncated lengths and excessive nesting', () => {
  const good = registration();
  const raw = Buffer.from(good.attestationObject, 'base64url');
  const duplicate = Buffer.concat([Buffer.from([0xa6]), a.cose.subarray(1), Buffer.from([0x03, 0x26])]);
  assert.throws(() => verifyRegistration(registration(duplicate)), /duplicate/);
  for (const bytes of [Buffer.concat([raw, Buffer.from([0])]), Buffer.from([0x59, 0]), Buffer.from([0x5a, 0, 0, 0, 99, 0]), Buffer.from([...Array(34).fill(0x81), 0])]) {
    assert.throws(() => verifyRegistration({ ...good, attestationObject: b64(bytes) }), /CBOR/);
  }
});

test('authenticator data enforces backup flags and extension boundaries', () => {
  assert.deepEqual(verifyAssertion(assertion(0x1d)), { signCount: 1 });
  assert.throws(() => verifyAssertion(assertion(0x15)), /backup/);
  assert.throws(() => verifyAssertion(assertion(5, Buffer.from([0]))), /authenticator data/);
  assert.throws(() => verifyAssertion(assertion(0x85)), /CBOR/);
  assert.deepEqual(verifyAssertion(assertion(0x85, cbor(new Map()))), { signCount: 1 });
});

test('cross-origin assertions require an explicit relying-party policy', () => {
  assert.throws(() => verifyAssertion(assertion(5, Buffer.alloc(0), { crossOrigin: true })), /cross-origin/);
  assert.deepEqual(verifyAssertion(assertion(5, Buffer.alloc(0), { crossOrigin: false })), { signCount: 1 });
});

test('WebAuthn base64url does not silently discard malformed characters', () => {
  const input = assertion();
  assert.throws(() => verifyAssertion({ ...input, signature: input.signature + '!' }), /base64url/);
});

test('a stored passkey key saved with base64 padding still verifies; what the browser sends stays strict', () => {
  const input = assertion();
  const padded = Buffer.from(a.cose).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  assert.ok(padded.endsWith('='), 'the generated key needs padding');
  assert.deepEqual(verifyAssertion({ ...input, publicKey: padded }), { signCount: 1 });
  assert.throws(() => verifyAssertion({ ...input, publicKey: padded + '=' }), /base64url/);
  assert.throws(() => verifyAssertion({ ...input, publicKey: padded.replace('=', '') + '==' }), /base64url/);
  // Malformed padding on the stored key: wrong length for the padding, too much of it, or a non-canonical last character.
  for (const publicKey of ['QQ=', 'QQ===', 'QR==', '=', '==']) assert.throws(() => verifyAssertion({ ...input, publicKey }), /base64url/, publicKey);
  // Authenticator data is 37 bytes here, so its padded form ends in '=='.
  const authenticatorData = Buffer.from(input.authenticatorData, 'base64url').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  assert.ok(authenticatorData.endsWith('=='));
  assert.throws(() => verifyAssertion({ ...input, authenticatorData }), /base64url/);
});

test('WebAuthn rejects rpId, origin, presence, counter, challenge and signature mismatches', () => {
  const input = assertion();
  assert.deepEqual(verifyAssertion(input), { signCount: 1 });
  for (const patch of [{ rpId: 'other' }, { origin: 'http://127.0.0.1:9' }, { challenge: 'other' }, { storedSignCount: 1 }, { signature: b64(Buffer.alloc(64)) }]) assert.throws(() => verifyAssertion({ ...input, ...patch }));
  assert.throws(() => verifyAssertion(assertion(4)), /presence/);
  // UV is preferred, not required, by the existing client policy.
  assert.deepEqual(verifyAssertion(assertion(1)), { signCount: 1 });
});

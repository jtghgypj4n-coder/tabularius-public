// Test helper: forge the output of a WebAuthn authenticator with a real P-256
// key, so the registration and assertion ceremonies can be exercised end to
// end without a browser. Not a test file itself.
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

export function cbor(value: unknown): Buffer {
  if (typeof value === 'number') { const major = value < 0 ? 1 : 0; return head(major, value < 0 ? -1 - value : value); }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (typeof value === 'string') { const b = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) { const parts = [head(5, value.size)]; for (const [k, v] of value) parts.push(cbor(k), cbor(v)); return Buffer.concat(parts); }
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
const count = (n: number) => Buffer.from([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

function coseKey(pub: KeyObject): Buffer {
  const jwk = pub.export({ format: 'jwk' }) as { x: string; y: string };
  return cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
}

export interface ForgedAuthenticator {
  credId: Buffer;
  privateKey: KeyObject;
  cose: Buffer;
  rpId: string;
  origin: string;
}

export function makeAuthenticator(rpId: string, origin: string): ForgedAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { credId: randomBytes(32), privateKey, cose: coseKey(publicKey), rpId, origin };
}

/** Forge the browser's registration response for a given server challenge. */
export function forgeRegistration(a: ForgedAuthenticator, challenge: string, signCount = 0) {
  const flags = 0x01 | 0x04 | 0x40;
  const credLen = Buffer.from([a.credId.length >> 8, a.credId.length & 0xff]);
  const authData = Buffer.concat([sha256(Buffer.from(a.rpId)), Buffer.from([flags]), count(signCount), Buffer.alloc(16), credLen, a.credId, a.cose]);
  const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: a.origin }));
  return { attestationObject: b64(attestationObject), clientDataJSON: b64(clientDataJSON) };
}

/** Forge the browser's sign-in assertion for a given server challenge. */
export function forgeAssertion(a: ForgedAuthenticator, challenge: string, signCount = 1) {
  const authData = Buffer.concat([sha256(Buffer.from(a.rpId)), Buffer.from([0x01 | 0x04]), count(signCount)]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: a.origin }));
  const signed = Buffer.concat([authData, sha256(clientDataJSON)]);
  const signature = createSign('sha256').update(signed).sign({ key: a.privateKey, dsaEncoding: 'der' });
  return { credentialId: b64(a.credId), clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(signature) };
}

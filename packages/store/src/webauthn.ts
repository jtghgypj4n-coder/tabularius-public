// Passkeys (WebAuthn / FIDO2): register a credential and verify a sign-in
// assertion, with no dependencies. A passkey is a public key the authenticator
// (Touch ID, Windows Hello, a phone, a security key) keeps; the server stores
// the public key and, at sign-in, checks a signature over the challenge it
// issued. This file is the pure crypto: CBOR, COSE keys, and the two
// ceremonies. Credential storage and challenge issuing live on the Store.
//
// Scope: ES256 (-7, P-256) and RS256 (-257), which between them cover every
// mainstream platform and roaming authenticator. Attestation is parsed for the
// credential's public key but its certificate chain is not validated — passkeys
// are used here for authentication, not to prove the authenticator's make, so
// (as the WebAuthn spec allows) attestation is treated as "none".

import { createHash, createPublicKey, createVerify, verify as cryptoVerify, type KeyObject } from 'node:crypto';

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url');
const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();

// --- a minimal CBOR decoder (the subset COSE and attestation objects use) ----

interface CborReader { buf: Uint8Array; pos: number; }

function readCbor(r: CborReader): unknown {
  if (r.pos >= r.buf.length) throw new Error('CBOR: unexpected end');
  const first = r.buf[r.pos++];
  const major = first >> 5;
  const minor = first & 0x1f;
  const len = readLength(r, minor);
  switch (major) {
    case 0: return len; // unsigned int
    case 1: return -1 - len; // negative int
    case 2: { // byte string
      const out = r.buf.subarray(r.pos, r.pos + len);
      r.pos += len;
      return Buffer.from(out);
    }
    case 3: { // text string
      const out = r.buf.subarray(r.pos, r.pos + len);
      r.pos += len;
      return Buffer.from(out).toString('utf8');
    }
    case 4: { // array
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(readCbor(r));
      return arr;
    }
    case 5: { // map
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < len; i++) { const k = readCbor(r); map.set(k, readCbor(r)); }
      return map;
    }
    case 7: // simple/float — only the simple values we might meet
      if (minor === 20) return false;
      if (minor === 21) return true;
      if (minor === 22) return null;
      throw new Error(`CBOR: unsupported simple value ${minor}`);
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

function readLength(r: CborReader, minor: number): number {
  if (minor < 24) return minor;
  if (minor === 24) return r.buf[r.pos++];
  if (minor === 25) { const v = (r.buf[r.pos] << 8) | r.buf[r.pos + 1]; r.pos += 2; return v; }
  if (minor === 26) { const v = ((r.buf[r.pos] << 24) | (r.buf[r.pos + 1] << 16) | (r.buf[r.pos + 2] << 8) | r.buf[r.pos + 3]) >>> 0; r.pos += 4; return v; }
  throw new Error(`CBOR: unsupported length ${minor}`);
}

function decodeCbor(buf: Uint8Array): unknown {
  return readCbor({ buf, pos: 0 });
}

// --- COSE public key -> a node KeyObject + its algorithm --------------------

const COSE_KTY = 1, COSE_ALG = 3, COSE_CRV = -1, COSE_X = -2, COSE_Y = -3, COSE_N = -1, COSE_E = -2;

interface CoseKey { key: KeyObject; alg: number; }

function coseToKey(cose: Map<unknown, unknown>): CoseKey {
  const kty = Number(cose.get(COSE_KTY));
  const alg = Number(cose.get(COSE_ALG));
  if (kty === 2) { // EC2
    if (alg !== -7) throw new Error(`unsupported EC algorithm ${alg} (only ES256)`);
    const x = cose.get(COSE_X) as Uint8Array, y = cose.get(COSE_Y) as Uint8Array;
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) throw new Error('COSE EC key missing coordinates');
    const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) } });
    return { key, alg };
  }
  if (kty === 3) { // RSA
    if (alg !== -257) throw new Error(`unsupported RSA algorithm ${alg} (only RS256)`);
    const n = cose.get(COSE_N) as Uint8Array, e = cose.get(COSE_E) as Uint8Array;
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) throw new Error('COSE RSA key missing modulus/exponent');
    const key = createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: b64url(n), e: b64url(e) } });
    return { key, alg };
  }
  throw new Error(`unsupported COSE key type ${kty}`);
}

// --- authenticator data ------------------------------------------------------

export interface AuthData {
  rpIdHash: Buffer;
  userPresent: boolean;
  userVerified: boolean;
  attested: boolean;
  signCount: number;
  credentialId?: Buffer;
  cosePublicKey?: Buffer; // the raw COSE key bytes, as stored
}

function parseAuthData(data: Uint8Array): AuthData {
  if (data.length < 37) throw new Error('authenticator data too short');
  const rpIdHash = Buffer.from(data.subarray(0, 32));
  const flags = data[32];
  const signCount = ((data[33] << 24) | (data[34] << 16) | (data[35] << 8) | data[36]) >>> 0;
  const out: AuthData = {
    rpIdHash,
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    attested: !!(flags & 0x40),
    signCount,
  };
  if (out.attested) {
    // aaguid(16) credIdLen(2) credId(credIdLen) then the COSE key (CBOR).
    let p = 37 + 16;
    const credIdLen = (data[p] << 8) | data[p + 1];
    p += 2;
    out.credentialId = Buffer.from(data.subarray(p, p + credIdLen));
    p += credIdLen;
    const r: CborReader = { buf: data, pos: p };
    readCbor(r); // consume the COSE key to find its byte length
    out.cosePublicKey = Buffer.from(data.subarray(p, r.pos));
  }
  return out;
}

function checkClientData(clientDataJSON: Uint8Array, wantType: string, challenge: string, origin: string | string[]): void {
  let cd: { type?: string; challenge?: string; origin?: string };
  try { cd = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); } catch { throw new Error('clientDataJSON is not valid JSON'); }
  if (cd.type !== wantType) throw new Error(`unexpected clientData type "${cd.type}"`);
  if (cd.challenge !== challenge) throw new Error('challenge does not match');
  const origins = Array.isArray(origin) ? origin : [origin];
  if (!cd.origin || !origins.includes(cd.origin)) throw new Error(`unexpected origin "${cd.origin}"`);
}

// --- the two ceremonies ------------------------------------------------------

export interface RegistrationInput {
  attestationObject: string; // base64url
  clientDataJSON: string; // base64url
  challenge: string; // the base64url challenge the server issued
  origin: string | string[];
  rpId: string;
  /** Defaults to required; possession-only ceremonies must opt in explicitly. */
  userVerification?: 'required' | 'preferred';
}
export interface RegisteredCredential {
  credentialId: string; // base64url
  publicKey: string; // base64url of the COSE key bytes, stored for sign-in
  signCount: number;
  alg: number;
}

/** Verify a registration (navigator.credentials.create) and return the credential to store. */
export function verifyRegistration(input: RegistrationInput): RegisteredCredential {
  const clientDataJSON = fromB64url(input.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.create', input.challenge, input.origin);
  const att = decodeCbor(fromB64url(input.attestationObject));
  if (!(att instanceof Map)) throw new Error('attestationObject is not a CBOR map');
  const authData = att.get('authData');
  if (!(authData instanceof Uint8Array)) throw new Error('attestationObject has no authData');
  const parsed = parseAuthData(authData);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(input.rpId)))) throw new Error('rpIdHash does not match the expected relying party');
  if (!parsed.userPresent) throw new Error('the authenticator did not report user presence');
  if (input.userVerification !== 'preferred' && !parsed.userVerified) throw new Error('the authenticator did not report user verification');
  if (!parsed.credentialId || !parsed.cosePublicKey) throw new Error('no credential was attested');
  coseToKey(decodeCbor(parsed.cosePublicKey) as Map<unknown, unknown>); // validate it parses to a supported key
  return {
    credentialId: b64url(parsed.credentialId),
    publicKey: b64url(parsed.cosePublicKey),
    signCount: parsed.signCount,
    alg: Number((decodeCbor(parsed.cosePublicKey) as Map<unknown, unknown>).get(COSE_ALG)),
  };
}

export interface AssertionInput {
  publicKey: string; // base64url of the stored COSE key
  clientDataJSON: string; // base64url
  authenticatorData: string; // base64url
  signature: string; // base64url
  challenge: string;
  origin: string | string[];
  rpId: string;
  storedSignCount: number;
  /** Defaults to required; only a password-backed second factor may opt out. */
  userVerification?: 'required' | 'preferred';
}

/**
 * Verify a sign-in assertion (navigator.credentials.get). Returns the new
 * signature counter to store. Throws if anything doesn't check out — a wrong
 * challenge or origin, an rpId mismatch, a bad signature, or a counter that
 * went backwards (a sign the credential was cloned).
 */
export function verifyAssertion(input: AssertionInput): { signCount: number } {
  const clientDataJSON = fromB64url(input.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.get', input.challenge, input.origin);
  const authenticatorData = fromB64url(input.authenticatorData);
  const parsed = parseAuthData(authenticatorData);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(input.rpId)))) throw new Error('rpIdHash does not match the expected relying party');
  if (!parsed.userPresent) throw new Error('the authenticator did not report user presence');
  if (input.userVerification !== 'preferred' && !parsed.userVerified) throw new Error('the authenticator did not report user verification');

  const { key, alg } = coseToKey(decodeCbor(fromB64url(input.publicKey)) as Map<unknown, unknown>);
  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  const signature = fromB64url(input.signature);
  let ok: boolean;
  if (alg === -7) {
    // ECDSA P-256; WebAuthn signatures are DER-encoded, which node verifies directly.
    ok = cryptoVerify('sha256', signed, { key, dsaEncoding: 'der' }, signature);
  } else if (alg === -257) {
    const v = createVerify('RSA-SHA256');
    v.update(signed);
    ok = v.verify(key, signature);
  } else {
    throw new Error(`unsupported algorithm ${alg}`);
  }
  if (!ok) throw new Error('the passkey signature did not verify');

  // Counter: if either side uses one (non-zero), it must advance. Many passkeys
  // keep it at 0 and are exempt, per the spec.
  if ((parsed.signCount !== 0 || input.storedSignCount !== 0) && parsed.signCount <= input.storedSignCount) {
    throw new Error('the passkey signature counter did not increase (possible cloned credential)');
  }
  return { signCount: parsed.signCount };
}

export { b64url as base64url };

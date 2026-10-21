// Passkeys (WebAuthn) and recovery codes in the browser: the credential dance
// with navigator.credentials, and the Data API calls that register a passkey,
// sign in with one, generate one-time recovery codes, and sign in with a code.
// The server (dataapi.ts) verifies everything; this only shuttles bytes between
// the authenticator and the endpoints, as base64url.
import { httpProblem } from './http-problem.ts';

const enc = encodeURIComponent;

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const utf8 = (s: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(s.length * 3);
  const n = new TextEncoder().encodeInto(s, out).written;
  return out.subarray(0, n) as Uint8Array<ArrayBuffer>;
};
const toB64url = (buf: ArrayBuffer): string => {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Whether this browser can do WebAuthn at all (so the login page only offers it when it works). */
export function passkeySupported(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

async function fmPost(db: string, path: string, body: unknown, token?: string): Promise<any> {
  const r = await fetch(`/fmi/data/vLatest/databases/${enc(db)}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tabularius-client': 'web', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const json = await r.json().catch(() => ({}));
  const msg = json.messages?.[0];
  if (!r.ok || (msg && msg.code !== '0')) {
    const e = new Error(msg?.message ?? httpProblem(r.status)) as Error & { code: number };
    e.code = Number(msg?.code ?? -1);
    throw e;
  }
  return json.response;
}

async function fmBasicPost(db: string, path: string, account: string, password: string, body: unknown): Promise<any> {
  const r = await fetch(`/fmi/data/vLatest/databases/${enc(db)}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tabularius-client': 'web', authorization: `Basic ${btoa(`${account}:${password}`)}` },
    body: JSON.stringify(body ?? {}),
  });
  const json = await r.json().catch(() => ({}));
  const msg = json.messages?.[0];
  if (!r.ok || (msg && msg.code !== '0')) {
    const e = new Error(msg?.message ?? httpProblem(r.status)) as Error & { code: number };
    e.code = Number(msg?.code ?? -1);
    throw e;
  }
  return json.response;
}

async function fmReq(db: string, method: string, path: string, token: string, body?: unknown): Promise<any> {
  const r = await fetch(`/fmi/data/vLatest/databases/${enc(db)}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  const msg = json.messages?.[0];
  if (!r.ok || (msg && msg.code !== '0')) throw new Error(msg?.message ?? httpProblem(r.status));
  return json.response;
}

export interface PasskeyLogin {
  db: string;
  token: string;
  passwordChangeRequired: boolean;
}

/**
 * Passwordless sign-in: fetch a challenge and this account's credential ids,
 * let the authenticator sign the challenge, and hand the assertion back for the
 * server to verify and mint a session.
 */
export async function signInWithPasskey(db: string, account: string): Promise<PasskeyLogin> {
  const begin = await fmPost(db, 'sessions/passkey', { account });
  const allow = (begin.allowCredentials ?? []) as string[];
  if (!allow.length) { const e = new Error('This account has no passkey on this file.') as Error & { code: number }; e.code = 0; throw e; }
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64url(begin.challenge),
      rpId: begin.rpId,
      allowCredentials: allow.map((id) => ({ type: 'public-key', id: fromB64url(id) })),
      userVerification: 'required',
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was chosen.');
  const r = cred.response as AuthenticatorAssertionResponse;
  const out = await fmPost(db, 'sessions/passkey', {
    response: {
      credentialId: toB64url(cred.rawId),
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      challenge: begin.challenge,
    },
  });
  return { db, token: out.token, passwordChangeRequired: !!out.passwordChangeRequired };
}

/**
 * Sign in with a password, using a passkey as the second factor instead of a
 * one-time code: the server confirms the password first (same as a plain
 * sign-in), then this account's own passkeys are offered for the assertion.
 */
export async function signInWithPasskeyFactor(db: string, account: string, password: string): Promise<PasskeyLogin> {
  const begin = await fmBasicPost(db, 'sessions/passkey-2fa', account, password, undefined);
  const allow = (begin.allowCredentials ?? []) as string[];
  if (!allow.length) { const e = new Error('This account has no passkey set up as a second factor.') as Error & { code: number }; e.code = 0; throw e; }
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64url(begin.challenge),
      rpId: begin.rpId,
      allowCredentials: allow.map((id) => ({ type: 'public-key', id: fromB64url(id) })),
      userVerification: 'preferred',
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was chosen.');
  const r = cred.response as AuthenticatorAssertionResponse;
  const out = await fmBasicPost(db, 'sessions/passkey-2fa', account, password, {
    response: {
      credentialId: toB64url(cred.rawId),
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      challenge: begin.challenge,
    },
  });
  return { db, token: out.token, passwordChangeRequired: !!out.passwordChangeRequired };
}

/** Sign in with a one-time recovery code (the fallback when a passkey or authenticator is lost). */
export async function signInWithRecoveryCode(db: string, account: string, code: string): Promise<PasskeyLogin> {
  const out = await fmPost(db, 'sessions/recovery', { account, code });
  return { db, token: out.token, passwordChangeRequired: !!out.passwordChangeRequired };
}

export interface Passkey { id: string; account: string; label?: string; created: string; lastUsed?: string }

/** Register a passkey for the signed-in account: get options, create the credential, hand the attestation back. */
export async function registerPasskey(db: string, token: string, label: string): Promise<{ id: string }> {
  const opts = await fmReq(db, 'POST', 'passkey/register/options', token, {});
  const exclude = (opts.excludeCredentials ?? []) as string[];
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64url(opts.challenge),
      rp: { id: opts.rpId, name: 'Tabularius' },
      user: { id: utf8(opts.user?.name ?? 'account'), name: opts.user?.name ?? 'account', displayName: opts.user?.name ?? 'account' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      excludeCredentials: exclude.map((id) => ({ type: 'public-key', id: fromB64url(id) })),
      authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was created.');
  const r = cred.response as AuthenticatorAttestationResponse;
  return fmReq(db, 'POST', 'passkey/register', token, {
    response: { attestationObject: toB64url(r.attestationObject), clientDataJSON: toB64url(r.clientDataJSON), challenge: opts.challenge },
    label,
  });
}

export async function listMyPasskeys(db: string, token: string): Promise<Passkey[]> {
  return (await fmReq(db, 'GET', 'passkey', token)).passkeys ?? [];
}

export async function removeMyPasskey(db: string, token: string, id: string): Promise<boolean> {
  return (await fmReq(db, 'DELETE', `passkey/${enc(id)}`, token)).removed ?? false;
}

export async function generateMyRecoveryCodes(db: string, token: string): Promise<{ codes: string[]; remaining: number }> {
  return fmReq(db, 'POST', 'recovery-codes', token, {});
}

// A passkey for the admin console: since the console has one shared password
// rather than per-person accounts (see admin.ts's check()), a registered
// passkey isn't tied to any one admin either — any of them can sign in with
// any console passkey, the same as everyone already shares the one console
// password. Stored as a flat JSON file beside the admin password file, one
// per hosted folder. The crypto itself reuses store/src/webauthn.ts, the same
// code a hosted file's own per-account passkeys use.
import { existsSync } from 'node:fs';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { join } from 'node:path';
import { verifyAssertion, verifyRegistration } from '../../store/src/webauthn.ts';

const FILE = '.openhbam-admin-passkeys';

export interface AdminPasskey { id: string; label?: string; created: string; lastUsed?: string }
interface StoredPasskey extends AdminPasskey { publicKey: string; signCount: number; alg: number }

export class AdminPasskeyError extends Error {}

function file(folder: string): string {
  return join(folder, FILE);
}

function load(folder: string): StoredPasskey[] {
  const f = file(folder);
  if (!existsSync(f)) return [];
  try {
    const parsed = readJsonStateSync<StoredPasskey[]>(f);
    return Array.isArray(parsed) ? parsed as StoredPasskey[] : [];
  } catch {
    return [];
  }
}

/** The console's passkeys, newest first; never the key material. */
export function adminPasskeys(folder: string): AdminPasskey[] {
  return load(folder)
    .map(({ publicKey: _publicKey, signCount: _signCount, alg: _alg, ...rest }) => rest)
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Whether the console has at least one passkey registered (so the sign-in page can offer it). */
export function hasAdminPasskey(folder: string): boolean {
  return load(folder).length > 0;
}

/** The credential ids registered for the console, for a sign-in's allowCredentials list. */
export function adminPasskeyIds(folder: string): string[] {
  return load(folder).map((p) => p.id);
}

/** Verifies a registration ceremony against the challenge just issued and stores the new credential. */
export function registerAdminPasskey(folder: string, response: { attestationObject: string; clientDataJSON: string },
  env: { rpId: string; origin: string | string[]; challenge: string }, label?: string): { id: string } {
  let cred;
  try {
    cred = verifyRegistration({ attestationObject: response.attestationObject, clientDataJSON: response.clientDataJSON, challenge: env.challenge, origin: env.origin, rpId: env.rpId });
  } catch (e) {
    throw new AdminPasskeyError(`The passkey could not be registered: ${(e as Error).message}`);
  }
  updateJsonStateSync<StoredPasskey[]>(file(folder), [], (list) => [...list, { id: cred.credentialId, publicKey: cred.publicKey, signCount: cred.signCount, alg: cred.alg, ...(label ? { label } : {}), created: new Date().toISOString() }], { mode: 0o600 });
  return { id: cred.credentialId };
}

/** Removes a console passkey by its credential id; returns whether one was removed. */
export function removeAdminPasskey(folder: string, id: string): boolean {
  let removed = false;
  updateJsonStateSync<StoredPasskey[]>(file(folder), [], (list) => {
    const next = list.filter((p) => p.id !== id);
    removed = next.length !== list.length;
    return next;
  }, { mode: 0o600 });
  return removed;
}

/**
 * Verifies a sign-in assertion against whichever of the console's stored
 * credentials it names, advancing that credential's signature counter.
 * Throws (AdminPasskeyError) when it doesn't check out.
 */
export function verifyAdminPasskeyAssertion(folder: string,
  response: { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string },
  env: { rpId: string; origin: string | string[]; challenge: string }): void {
  updateJsonStateSync<StoredPasskey[]>(file(folder), [], (list) => {
    const row = list.find((p) => p.id === response.credentialId);
    if (!row) throw new AdminPasskeyError('This passkey is not registered');
    let result: { signCount: number };
    try {
      result = verifyAssertion({
        publicKey: row.publicKey, clientDataJSON: response.clientDataJSON, authenticatorData: response.authenticatorData,
        signature: response.signature, challenge: env.challenge, origin: env.origin, rpId: env.rpId, storedSignCount: row.signCount,
      });
    } catch (e) {
      throw new AdminPasskeyError(`The passkey did not verify: ${(e as Error).message}`);
    }
    row.signCount = result.signCount;
    row.lastUsed = new Date().toISOString();
    return list;
  }, { mode: 0o600 });
}

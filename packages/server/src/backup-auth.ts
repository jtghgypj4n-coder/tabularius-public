// A signature on an encrypted backup set's manifest.
//
// Each encrypted copy is authenticated by AES-GCM, but backup.json, the list of which checksum belongs to which
// file, was not: someone who can write the backup folder (a shared drive, a synced bucket) but has no passphrase
// could rename ciphertexts, put one file's copy in another's place, or an older set's copy in a newer set, then
// write checksums to match. The restore would take the result.
//
// The signature is an HMAC-SHA256, keyed from the backup passphrase with a salt kept beside it, over the parts of
// the manifest a restore trusts: each file's checksum, when each copy was finished, and each container file's
// checksum. The rest of the manifest (the check and test-restore results the server writes back) is not signed.
// It does not name the set's folder, so a set copied or fetched under another name still restores.
//
// What it does not do: an unencrypted set has no key to sign with, so it is checked against accident only; and a
// whole older set, signature and all, is still a valid set. Restoring one over newer data is the person's call (see
// RestoreOptions.newerThanBackup).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { deriveKey, ENCRYPTED_EXT } from './encrypt.ts';
import { readBackupInfo, updateBackupInfo } from './backup-info.ts';
import { STORE_EXT } from './host.ts';

interface SignedParts {
  sha256?: Record<string, string>;
  finished?: Record<string, string>;
  external?: Record<string, { sha256?: string }>;
  auth?: { v?: number; salt?: string; mac?: string };
}

const DOMAIN = 'tabularius-backup-manifest-v1';

const sorted = (o: Record<string, unknown> | undefined): [string, unknown][] =>
  Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The parts a restore trusts must be what they claim to be before a signature over them means anything: a checksum list
 * and a list of finish times that are objects of strings (a missing, null, false or empty list would sign as the same bytes),
 * and container-file entries that each carry a checksum. A signed manifest that is not shaped like this is refused.
 */
function shapeProblem(info: SignedParts): string | undefined {
  if (!plainObject(info.sha256)) return 'has no list of checksums';
  for (const [name, sum] of Object.entries(info.sha256)) if (typeof sum !== 'string' || !/^[0-9a-f]{64}$/.test(sum)) return `has no usable checksum for ${name}`;
  if (!plainObject(info.finished)) return 'has no list of finish times';
  for (const [name, at] of Object.entries(info.finished)) if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return `has no usable finish time for ${name}`;
  if (info.external !== undefined) {
    if (!plainObject(info.external)) return 'has a list of container files that is not a list';
    for (const [rel, entry] of Object.entries(info.external)) if (!plainObject(entry) || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) return `has no usable checksum for container file ${rel}`;
  }
  return undefined;
}

/** The bytes that are signed: only what a restore relies on, in a fixed order. Call after shapeProblem. */
function signedBytes(info: SignedParts): Buffer {
  return Buffer.from(JSON.stringify([
    DOMAIN,
    sorted(info.sha256),
    sorted(info.finished),
    sorted(info.external).map(([rel, e]) => [rel, (e as { sha256: string }).sha256]),
  ]));
}

/** Prepares a signer for a passphrase: the key is derived once, and the returned function signs a manifest in place, synchronously, so it can run inside the manifest's own update. */
export async function prepareSigner(passphrase: string): Promise<(info: SignedParts) => void> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  return (info) => {
    const problem = shapeProblem(info);
    if (problem) throw new Error(`backup.json ${problem}, so it is not signed`);
    info.auth = { v: 1, salt: salt.toString('hex'), mac: createHmac('sha256', key).update(signedBytes(info)).digest('hex') };
  };
}

/** Signs a set's manifest in place. Call after every change to its checksums, times or container files. */
export async function signManifest(setDir: string, passphrase: string): Promise<void> {
  const sign = await prepareSigner(passphrase);
  updateBackupInfo<SignedParts>(setDir, sign);
}

export type ManifestSignature = 'signed' | 'unsigned';

/** Whether a set holds any encrypted database copy (an unencrypted set has no signature to expect). */
export function isEncryptedSet(setDir: string): boolean {
  return readdirSync(setDir).some((f) => f.endsWith(STORE_EXT + ENCRYPTED_EXT));
}

/**
 * Reads the manifest once and checks its signature. Throws when the manifest does not match it (edited, or a different
 * passphrase) or is signed but malformed. Returns `unsigned` for a set that has none, which the caller decides about: an
 * encrypted set made before signatures existed has none, and so does one whose signature was removed. The `info` returned
 * is the object that was checked: a caller that goes on to use the manifest uses this, not a second read of the file.
 */
export async function readVerified(setDir: string, passphrase: string | undefined): Promise<{ state: ManifestSignature; info: SignedParts & Record<string, unknown> }> {
  const info = readBackupInfo<SignedParts & Record<string, unknown>>(setDir, true);
  const auth = info.auth;
  if (auth === undefined) return { state: 'unsigned', info };
  const bad = (why: string) => new Error(`${setDir}${setDir.endsWith('/') ? '' : '/'}backup.json ${why}`);
  if (!auth || typeof auth !== 'object' || auth.v !== 1 || typeof auth.salt !== 'string' || typeof auth.mac !== 'string' || !/^[0-9a-f]{32}$/.test(auth.salt) || !/^[0-9a-f]{64}$/.test(auth.mac)) {
    throw bad('has a signature in a form this version does not read, so the set is not trusted');
  }
  if (!passphrase) throw new Error(`${setDir} is encrypted: set TABULARIUS_BACKUP_KEY to the passphrase the set was made with`);
  const problem = shapeProblem(info);
  if (problem) throw bad(`${problem}, so the set is not trusted`);
  const key = await deriveKey(passphrase, Buffer.from(auth.salt, 'hex'));
  const expected = createHmac('sha256', key).update(signedBytes(info)).digest();
  if (!timingSafeEqual(expected, Buffer.from(auth.mac, 'hex'))) {
    throw bad('does not match its signature: wrong passphrase (not the one the set was made with), or backup.json was edited, or it is not from this set');
  }
  return { state: 'signed', info };
}

/** Whether the manifest is signed and matches; see readVerified. */
export async function checkManifest(setDir: string, passphrase: string | undefined): Promise<ManifestSignature> {
  return (await readVerified(setDir, passphrase)).state;
}

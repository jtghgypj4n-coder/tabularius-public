// A signature on an encrypted backup set's manifest.
//
// Each encrypted copy is authenticated by AES-GCM, but backup.json, the list of which checksum belongs to which
// file, was not: someone who can write the backup folder (a shared drive, a synced bucket) but has no passphrase
// could rename ciphertexts, put one file's copy in another's place, or an older set's copy in a newer set, then
// write checksums to match. The restore would take the result.
//
// The signature is an HMAC-SHA256, keyed from the backup passphrase with a salt kept beside it, over the parts of
// the manifest a restore trusts: each file's checksum, when each copy was finished, each container file's checksum,
// size and modification time (the next backup links a container file it finds unchanged by those), and, for each
// file with point-in-time logs, how many logs were saved and a chain over them (see backup-log-chain.ts). The rest of
// the manifest (the check and test-restore results the server writes back) is not signed.
// It does not name the set's folder, so a set copied or fetched under another name still restores.
//
// What it does not do: an unencrypted set has no key to sign with, so it is checked against accident only; and a
// whole older set, signature and all, is still a valid set. Restoring one over newer data is the person's call (see
// RestoreOptions.newerThanBackup).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deriveKey, deriveKeySync, ENCRYPTED_EXT } from './encrypt.ts';
import { readBackupInfo, updateBackupInfo } from './backup-info.ts';
import { STORE_EXT } from './host.ts';

export interface SignedParts {
  sha256?: Record<string, string>;
  finished?: Record<string, string>;
  external?: Record<string, { size?: number; mtimeMs?: number; sha256?: string }>;
  /** Per hosted file (without its extension): the point-in-time logs saved for it. */
  logs?: Record<string, { n?: number; head?: string }>;
  auth?: { v?: number; salt?: string; mac?: string };
}

const DOMAIN = 'tabularius-backup-manifest-v2';
/** The form of `auth` this version writes. Version 1 signed fewer parts of the manifest (no container sizes and times, no logs): it is not trusted, and counts as no signature. */
const AUTH_VERSION = 2;
const olderAuth = (auth: SignedParts['auth']): boolean => !!auth && typeof auth === 'object' && auth.v === 1;

const sorted = (o: Record<string, unknown> | undefined): [string, unknown][] =>
  Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The parts a restore trusts must be what they claim to be before a signature over them means anything: a checksum list
 * and a list of finish times that are objects of strings (a missing, null, false or empty list would sign as the same bytes),
 * and container-file entries that each carry a checksum, a size and a modification time, and log inventories that each carry a count
 * and a chain head. A signed manifest that is not shaped like this is refused.
 */
function shapeProblem(info: SignedParts): string | undefined {
  if (!plainObject(info.sha256)) return 'has no list of checksums';
  for (const [name, sum] of Object.entries(info.sha256)) if (typeof sum !== 'string' || !/^[0-9a-f]{64}$/.test(sum)) return `has no usable checksum for ${name}`;
  if (!plainObject(info.finished)) return 'has no list of finish times';
  for (const [name, at] of Object.entries(info.finished)) if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return `has no usable finish time for ${name}`;
  if (info.external !== undefined) {
    if (!plainObject(info.external)) return 'has a list of container files that is not a list';
    for (const [rel, entry] of Object.entries(info.external)) {
      if (!plainObject(entry) || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) return `has no usable checksum for container file ${rel}`;
      if (typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0) return `has no usable size for container file ${rel}`;
      if (typeof entry.mtimeMs !== 'number' || !Number.isFinite(entry.mtimeMs)) return `has no usable modification time for container file ${rel}`;
    }
  }
  if (info.logs !== undefined) {
    if (!plainObject(info.logs)) return 'has a list of saved logs that is not a list';
    for (const [name, log] of Object.entries(info.logs)) {
      if (!plainObject(log) || typeof log.n !== 'number' || !Number.isSafeInteger(log.n) || log.n < 0 || typeof log.head !== 'string' || !/^[0-9a-f]{64}$/.test(log.head)) return `has no usable list of saved logs for ${name}`;
    }
  }
  return undefined;
}

/** The bytes that are signed: only what a restore relies on, in a fixed order. Call after shapeProblem. */
function signedBytes(info: SignedParts): Buffer {
  return Buffer.from(JSON.stringify([
    DOMAIN,
    sorted(info.sha256),
    sorted(info.finished),
    sorted(info.external).map(([rel, e]) => { const x = e as { sha256: string; size: number; mtimeMs: number }; return [rel, x.sha256, x.size, x.mtimeMs]; }),
    sorted(info.logs).map(([name, l]) => [name, (l as { n: number }).n, (l as { head: string }).head]),
  ]));
}

/** Prepares a signer for a passphrase: the key is derived once, and the returned function signs a manifest in place, synchronously, so it can run inside the manifest's own update. */
export async function prepareSigner(passphrase: string): Promise<(info: SignedParts) => void> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  return (info) => {
    const problem = shapeProblem(info);
    if (problem) throw new Error(`backup.json ${problem}, so it is not signed`);
    info.auth = { v: AUTH_VERSION, salt: salt.toString('hex'), mac: createHmac('sha256', key).update(signedBytes(info)).digest('hex') };
  };
}

/** Signs a set's manifest in place, after `change` if given. Call after every change to its checksums, times or container files. */
export async function signManifest(setDir: string, passphrase: string, change?: (info: SignedParts) => void): Promise<void> {
  const sign = await prepareSigner(passphrase);
  updateBackupInfo<SignedParts>(setDir, (info) => {
    change?.(info);
    sign(info);
  });
}

export type ManifestSignature = 'signed' | 'unsigned';

/** Whether a manifest carries a signature made by an earlier version of this code (see AUTH_VERSION): it is treated as unsigned, and signing the set again replaces it. */
export function signedByOlderVersion(info: { auth?: unknown }): boolean {
  return olderAuth(info.auth as SignedParts['auth']);
}

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
  if (info.auth === undefined || olderAuth(info.auth)) return { state: 'unsigned', info };
  const { salt, mac } = authFields(setDir, info.auth);
  if (!passphrase) throw new Error(`${setDir} is encrypted: set TABULARIUS_BACKUP_KEY to the passphrase the set was made with`);
  checkShape(setDir, info);
  checkMac(setDir, info, await deriveKey(passphrase, salt), mac);
  return { state: 'signed', info };
}

const bad = (setDir: string, why: string) => new Error(`${setDir}${setDir.endsWith('/') ? '' : '/'}backup.json ${why}`);

/** The salt and signature of a manifest that has them in the form this version reads. */
function authFields(setDir: string, auth: SignedParts['auth']): { salt: Buffer; mac: Buffer } {
  if (!auth || typeof auth !== 'object' || auth.v !== AUTH_VERSION || typeof auth.salt !== 'string' || typeof auth.mac !== 'string' || !/^[0-9a-f]{32}$/.test(auth.salt) || !/^[0-9a-f]{64}$/.test(auth.mac)) {
    throw bad(setDir, 'has a signature in a form this version does not read, so the set is not trusted');
  }
  return { salt: Buffer.from(auth.salt, 'hex'), mac: Buffer.from(auth.mac, 'hex') };
}

function checkShape(setDir: string, info: SignedParts): void {
  const problem = shapeProblem(info);
  if (problem) throw bad(setDir, `${problem}, so the set is not trusted`);
}

const macOf = (key: Buffer, info: SignedParts): Buffer => createHmac('sha256', key).update(signedBytes(info)).digest();

function checkMac(setDir: string, info: SignedParts, key: Buffer, mac: Buffer): void {
  if (!timingSafeEqual(macOf(key, info), mac)) {
    throw bad(setDir, 'does not match its signature: wrong passphrase (not the one the set was made with), or backup.json was edited, or it is not from this set');
  }
}

/** Changes made to a signed manifest by the server that made the set, each one checked against the signature first. */
export interface Amender {
  /**
   * Under the manifest's lock: checks the manifest as it is on disk against its signature, applies `change`, signs the
   * result. Throws, leaving the manifest as it was, when the manifest was edited since it was signed: a signature is
   * never put on a manifest nobody has checked.
   */
  amend(change: (info: SignedParts & Record<string, unknown>) => void): void;
}

/**
 * Opens a signed set's manifest for changes (saving a file's point-in-time logs into it, adding a file to it). The key is derived
 * once, here, so the changes themselves are synchronous and can run inside the server's log rounds. A set that has a copy in it
 * but no signature is refused: signing it would vouch for whatever is in it. A set with nothing in it yet (one made again after
 * another backup removed it) starts a signature of its own. The manifest as it is now is checked before this returns.
 */
export async function openAmender(setDir: string, passphrase: string): Promise<Amender> {
  const { first, salt } = beginAmending(setDir);
  return finishAmending(setDir, first, salt, await deriveKey(passphrase, salt));
}

/** As openAmender, for a caller that cannot wait (the key takes a moment to derive): the server follows a new set from the next round on. */
export function openAmenderSync(setDir: string, passphrase: string): Amender {
  const { first, salt } = beginAmending(setDir);
  return finishAmending(setDir, first, salt, deriveKeySync(passphrase, salt));
}

/** A manifest that has never listed anything: no signature (an older one counts as none), no copies, times, container files or logs. */
const listsNothing = (info: SignedParts) => (info.auth === undefined || olderAuth(info.auth)) &&
  [info.sha256, info.finished, info.external, info.logs].every((list) => !Object.keys(list ?? {}).length);

function beginAmending(setDir: string): { first: SignedParts; salt: Buffer } {
  const first = readBackupInfo<SignedParts>(setDir, true);
  const holdsCopies = () => readdirSync(setDir).some((f) => f.endsWith(STORE_EXT) || f.endsWith(STORE_EXT + ENCRYPTED_EXT));
  if ((first.auth === undefined || olderAuth(first.auth)) && !(listsNothing(first) && !holdsCopies())) {
    throw new Error(`${join(setDir, 'backup.json')} has no signature, so nothing is added to this set: signing it would vouch for what is already in it`);
  }
  return { first, salt: first.auth === undefined || olderAuth(first.auth) ? randomBytes(16) : authFields(setDir, first.auth).salt };
}

function finishAmending(setDir: string, first: SignedParts, salt: Buffer, key: Buffer): Amender {
  const fresh = first.auth === undefined || olderAuth(first.auth);
  if (!fresh) {
    checkShape(setDir, first);
    checkMac(setDir, first, key, authFields(setDir, first.auth).mac);
  }
  return {
    amend(change) {
      updateBackupInfo<SignedParts & Record<string, unknown>>(setDir, (info) => {
        if (info.auth === undefined || olderAuth(info.auth)) {
          // The copy being added is already in place by now; what matters is that the set never had a manifest of its own.
          if (!listsNothing(info) || !fresh) throw bad(setDir, 'lost its signature, so nothing is added to this set');
        } else {
          const fields = authFields(setDir, info.auth);
          if (!fields.salt.equals(salt)) throw bad(setDir, 'was signed again by someone else, so nothing is added to this set');
          checkShape(setDir, info);
          checkMac(setDir, info, key, fields.mac);
        }
        change(info);
        checkShape(setDir, info);
        info.auth = { v: AUTH_VERSION, salt: salt.toString('hex'), mac: macOf(key, info).toString('hex') };
      });
    },
  };
}

/** Whether the manifest is signed and matches; see readVerified. */
export async function checkManifest(setDir: string, passphrase: string | undefined): Promise<ManifestSignature> {
  return (await readVerified(setDir, passphrase)).state;
}

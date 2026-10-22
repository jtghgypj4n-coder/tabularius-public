import { renameCheckedSync as renameSync, removeFileSync as rmSync } from '../../store/src/file-ops.ts';
// Plug-in packages: <id>-<version>.ohplugin is a zip of plugin.json, the file it names as main, and optionally a
// README and LICENSE, signed by its publisher. The signature (signature.json: { publisherKey, sig }) is Ed25519 over
// the SHA-256 of every other file in the package, so it proves who published it, not that it is safe: the sandbox and
// the permissions the admin sees are the safety. Installing unpacks into <data folder>/plugins/<id>/ and writes
// install.json beside it, so a file changed by hand afterwards isn't loaded.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { cleanupPath, readFileSync, writeFileSync } from '../../store/src/fs-boundary.ts';
import { readJsonStateSync, updateJsonStateSync } from '../../store/src/durable.ts';
import { join } from 'node:path';
import { unzip, zip, type ZipEntry } from '../../calc/src/zip.ts';
import { parseManifest, type PluginManifest } from './manifest.ts';

/** The most a package may hold, unpacked. */
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const OPTIONAL_FILES = /^(?:README|LICENSE)(?:\.(?:md|txt))?$/i;
const SIGNATURE = 'signature.json';
const INSTALL = 'install.json';
const DOMAIN = 'ohplugin-v1\n';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** What a signature covers: each file's name and SHA-256, sorted by name. */
function signedText(files: Map<string, Uint8Array>): Buffer {
  const lines = [...files].filter(([n]) => n !== SIGNATURE).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([n, b]) => `${n}\t${sha256(b)}\n`);
  return Buffer.from(DOMAIN + lines.join(''));
}

/** A publisher key as shown to an admin: the first 128 bits of the SHA-256 of its public key, in groups of 8. */
export function fingerprint(publicKey: string): string {
  return sha256(Buffer.from(publicKey, 'base64')).slice(0, 32).replace(/(.{8})(?=.)/g, '$1:');
}

/** A new publisher key: the private half as PEM (keep it secret) and the public half as base64 (goes in packages). */
export function generateKey(): { privatePem: string; publicKey: string; fingerprint: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: pub, fingerprint: fingerprint(pub) };
}

/** The files a package may hold, read from a plug-in folder: plugin.json, its main file, README and LICENSE. */
function folderFiles(dir: string): Map<string, Uint8Array> {
  const parsed = parseManifest(JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')));
  if (!parsed.ok) throw new Error(`${dir}/plugin.json: ${parsed.errors.join('; ')}`);
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(dir)) {
    if (name === 'plugin.json' || name === parsed.manifest.main || OPTIONAL_FILES.test(name)) files.set(name, readFileSync(join(dir, name)));
  }
  if (!files.has(parsed.manifest.main)) throw new Error(`${dir}: no ${parsed.manifest.main}`);
  return files;
}

/** Packs a plug-in folder, signed when given the publisher's private key (PEM). */
export function packPlugin(dir: string, privatePem?: string): { bytes: Uint8Array; name: string; fingerprint?: string } {
  const files = folderFiles(dir);
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')));
  if (!manifest.ok) throw new Error(manifest.errors.join('; '));
  const entries: ZipEntry[] = [...files].map(([name, data]) => ({ name, data }));
  let fp: string | undefined;
  if (privatePem) {
    const key = createPrivateKey(privatePem);
    const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
    const sig = sign(null, signedText(files), key).toString('base64');
    entries.push({ name: SIGNATURE, data: Buffer.from(JSON.stringify({ publisherKey: publicKey, sig }, null, 2) + '\n') });
    fp = fingerprint(publicKey);
  }
  return { bytes: zip(entries), name: `${manifest.manifest.id}-${manifest.manifest.version}.ohplugin`, ...(fp ? { fingerprint: fp } : {}) };
}

export interface PackageInfo {
  manifest: PluginManifest;
  files: Map<string, Uint8Array>;
  /** The publisher's key fingerprint when the package is signed and the signature holds. */
  signer?: string;
  publicKey?: string;
}

/** Reads and checks a package: its files, manifest and signature. Throws for anything wrong, including a bad signature. */
export function readPackage(bytes: Uint8Array): PackageInfo {
  let entries: ZipEntry[];
  try {
    entries = unzip(bytes, { maxTotalBytes: MAX_PACKAGE_BYTES });
  } catch (e) {
    throw new Error(`not a plug-in package: ${(e as Error).message}`);
  }
  const files = new Map<string, Uint8Array>();
  let total = 0;
  const spellings = new Set<string>();
  for (const { name, data } of entries) {
    if (name.endsWith('/')) continue;
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) throw new Error(`the package holds ${name}, and a plug-in is files at the top of the package only`);
    if (spellings.has(name.toLowerCase())) throw new Error(`the package holds ${name} twice (ignoring case)`);
    spellings.add(name.toLowerCase());
    total += data.length;
    if (total > MAX_PACKAGE_BYTES) throw new Error(`the package is over ${MAX_PACKAGE_BYTES / 1024 / 1024} MB unpacked`);
    files.set(name, data);
  }
  const rawManifest = files.get('plugin.json');
  if (!rawManifest) throw new Error('the package has no plugin.json');
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(rawManifest)); } catch { throw new Error('plugin.json in the package is not JSON'); }
  const parsed = parseManifest(json);
  if (!parsed.ok) throw new Error(`plugin.json: ${parsed.errors.join('; ')}`);
  const { manifest } = parsed;
  if (!files.has(manifest.main)) throw new Error(`the package has no ${manifest.main}`);
  for (const name of files.keys()) {
    if (name !== 'plugin.json' && name !== manifest.main && name !== SIGNATURE && !OPTIONAL_FILES.test(name)) {
      throw new Error(`the package holds ${name}, which a plug-in package doesn't`);
    }
  }
  const info: PackageInfo = { manifest, files };
  const sig = files.get(SIGNATURE);
  if (sig) {
    let s: { publisherKey?: unknown; sig?: unknown };
    try { s = JSON.parse(new TextDecoder().decode(sig)); } catch { throw new Error('signature.json is not JSON'); }
    if (typeof s?.publisherKey !== 'string' || typeof s.sig !== 'string') throw new Error('signature.json needs publisherKey and sig');
    let ok = false;
    try {
      ok = verify(null, signedText(files), createPublicKey({ key: Buffer.from(s.publisherKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(s.sig, 'base64'));
    } catch { /* not a key or signature */ }
    if (!ok) throw new Error('the package\'s signature does not match its files (it was changed after it was signed, or the signature is damaged)');
    info.signer = fingerprint(s.publisherKey);
    info.publicKey = s.publisherKey;
  }
  return info;
}

/** A JSON file's contents, or an error that names the file, so a hand-edited or torn one is found and not a bare SyntaxError. */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`${path} is not valid JSON (${err.message}). Fix or delete it`);
    throw err;
  }
}

const pluginsDir = (dataDir: string) => join(dataDir, 'plugins');
const trustedPath = (dataDir: string) => join(pluginsDir(dataDir), 'trusted-publishers.json');

/** Publisher fingerprints the admin trusts, with the name they gave. */
export function trustedPublishers(dataDir: string): Record<string, string> {
  if (!existsSync(trustedPath(dataDir))) return {};
  const raw = readJsonStateSync<Record<string, unknown>>(trustedPath(dataDir));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
}

export interface InstallRecord {
  id: string;
  version: string;
  /** The signing key's fingerprint, absent when the package was unsigned. */
  signer?: string;
  installedAt: string;
  /** SHA-256 of each unpacked file, so a change afterwards is noticed. */
  files: Record<string, string>;
}

export interface InstallOptions {
  /** Install a package that has no signature. */
  allowUnsigned?: boolean;
  /** The fingerprint of a publisher not trusted yet, typed by the admin who has looked at it: it is then trusted. */
  trust?: string;
  /** Replace an installed plug-in the same publisher didn't sign. */
  replace?: boolean;
  now?: Date;
}

/**
 * Installs a package into <data folder>/plugins/<id>/. A signed package from a publisher the admin hasn't trusted
 * needs that publisher's fingerprint passed as `trust`, an unsigned one needs `allowUnsigned`, and a plug-in already
 * installed isn't replaced by one signed by someone else (or unsigned) unless `replace` is set.
 */
export function installPackage(dataDir: string, bytes: Uint8Array, opts: InstallOptions = {}): { manifest: PluginManifest; signer?: string; replaced?: string } {
  const info = readPackage(bytes);
  const { manifest } = info;
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(manifest.id) || manifest.id.endsWith('.json')) throw new Error(`${manifest.id} can't be a folder name`);
  let newlyTrusted: Record<string, string> | undefined;
  if (info.signer) {
    const trusted = trustedPublishers(dataDir);
    if (!trusted[info.signer]) {
      if (opts.trust?.toLowerCase() !== info.signer) {
        throw new Error(`${manifest.name} is signed by a publisher you haven't trusted: ${info.signer}. Check that fingerprint with the publisher, then install again with --trust ${info.signer}`);
      }
      // Recorded once the plug-in is in place: an install that stops for any other reason trusts nobody.
      newlyTrusted = { ...trusted, [info.signer]: manifest.publisher };
    }
  } else if (!opts.allowUnsigned) {
    throw new Error(`${manifest.name} is not signed. Install it only if you trust where it came from, with --allow-unsigned`);
  }
  const dest = join(pluginsDir(dataDir), manifest.id);
  let replaced: string | undefined;
  if (existsSync(join(dest, INSTALL))) {
    const old = readJsonFile(join(dest, INSTALL)) as InstallRecord;
    replaced = old.version;
    if (old.signer !== info.signer && !opts.replace) {
      throw new Error(`${manifest.id} ${old.version} is installed${old.signer ? `, signed by ${old.signer}` : ' unsigned'}, and this package is ${info.signer ? `signed by ${info.signer}` : 'unsigned'}. Install again with --replace to replace it`);
    }
  } else if (existsSync(dest)) {
    // A folder someone put there by hand.
    if (!opts.replace) throw new Error(`plugins/${manifest.id} is already there (not from a package). Install again with --replace to replace it`);
    replaced = 'unpackaged';
  }
  const record: InstallRecord = {
    id: manifest.id, version: manifest.version, ...(info.signer ? { signer: info.signer } : {}),
    installedAt: (opts.now ?? new Date()).toISOString(), files: Object.fromEntries([...info.files].filter(([n]) => n !== SIGNATURE).map(([n, b]) => [n, sha256(b)])),
  };
  // Unpack beside the destination and swap it in, so a failure never leaves half a plug-in loaded.
  mkdirSync(pluginsDir(dataDir), { recursive: true });
  const staging = mkdtempSync(join(pluginsDir(dataDir), `.installing-${manifest.id}-`));
  const aside = staging + '.previous';
  const cleanupStaging = cleanupPath(staging, { recursive: true, force: true });
  let cleanupAside = () => {};
  try {
    mkdirSync(staging, { recursive: true });
    for (const [name, data] of info.files) writeFileSync(join(staging, name), data);
    writeFileSync(join(staging, INSTALL), JSON.stringify(record, null, 2) + '\n');
  } catch (err) {
    cleanupStaging();
    throw err;
  }
  // The old plug-in is moved aside, not deleted, until the new one is in its place: if the swap fails, it comes back.
  const hadOld = existsSync(dest);
  try {
    if (hadOld) {
      renameSync(dest, aside);
      cleanupAside = cleanupPath(aside, { recursive: true, force: true });
    }
    renameSync(staging, dest);
  } catch (err) {
    cleanupStaging();
    if (hadOld && !existsSync(dest) && existsSync(aside)) renameSync(aside, dest);
    throw err;
  }
  cleanupAside();
  if (newlyTrusted) {
    mkdirSync(pluginsDir(dataDir), { recursive: true });
    updateJsonStateSync<Record<string, string>>(trustedPath(dataDir), {}, (latest) => ({ ...latest, ...newlyTrusted }), { mode: 0o600 });
  }
  return { manifest, ...(info.signer ? { signer: info.signer } : {}), ...(replaced ? { replaced } : {}) };
}

/** Throws when a package-installed plug-in's files are not the ones installed (a plug-in put there by hand has no record). */
export function checkInstalled(dir: string, loaded: ReadonlyMap<string, Uint8Array> = new Map()): InstallRecord | undefined {
  const file = join(dir, INSTALL);
  if (!existsSync(file)) return undefined;
  const record = readJsonFile(file) as InstallRecord;
  for (const [name, want] of Object.entries(record.files)) {
    if (!name || name.startsWith('.') || /[\\/]/.test(name)) throw new Error('Invalid installed plug-in file name');
    const path = join(dir, name);
    if (!existsSync(path) || sha256(loaded.get(name) ?? readFileSync(path)) !== want) throw new Error(`${name} has changed since ${record.id} was installed from its package`);
  }
  return record;
}

/** Removes an installed plug-in's folder (and its secrets) once no file has it enabled. */
export function uninstallPlugin(dataDir: string, id: string, enabledFor: string[]): void {
  if (enabledFor.length) throw new Error(`${id} is enabled for ${enabledFor.join(', ')}; turn it off first`);
  const root = pluginsDir(dataDir);
  const folder = existsSync(root) ? readdirSync(root, { withFileTypes: true }).find((e) => {
    if (!e.isDirectory() || !existsSync(join(root, e.name, 'plugin.json'))) return false;
    try { return (JSON.parse(readFileSync(join(root, e.name, 'plugin.json'), 'utf8')) as { id?: unknown }).id === id; } catch { return false; }
  }) : undefined;
  if (!folder) throw new Error(`${id} isn't installed in ${root}`);
  rmSync(join(root, folder.name), { recursive: true, force: true });
  rmSync(join(root, 'secrets', `${id}.json`), { force: true });
}

// Externally stored container files in backups, as FileMaker Server backs up
// RC_Data_FMS: each hosted file's container folders (RC_Data_FMS/<name>/ and
// Files/<name>/, see Store.externalRoots) go into the set next to its copy.
//
// A file unchanged since the last set (same size and modification time) is a
// hard link to that set's copy, so a daily backup of gigabytes of PDFs takes
// only the room of what changed. Each set lists its files with their
// checksums in backup.json ("external"), which verification and restore use.
// With a passphrase every file is encrypted, as the databases are.

import { crashPoint } from '../../store/src/crash-point.ts';
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readBackupInfo, updateBackupInfo } from './backup-info.ts';
import { commitRestore } from './restore-files.ts';
import type { RestoreFile } from './restore-files.ts';
import { checksum } from './backup-verify.ts';
import { readVerified } from './backup-auth.ts';
import { decryptFile, encryptFile, opensWithPassphrase, ENCRYPTED_EXT } from './encrypt.ts';

/** Folders, next to a hosted file, that hold its externally stored container files. */
export const EXTERNAL_DIRS = ['RC_Data_FMS', 'Files'];

export interface ExternalEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
  encrypted?: boolean;
  /** Metadata avoids reading unchanged containers; verify still hashes every copy. */
  sourceCtimeMs?: number;
  copySize?: number;
  copyMtimeMs?: number;
  copyIno?: number;
  copyDev?: number;
  /** Verification found this copy unsafe to link into another set. */
  reuseBlocked?: boolean;
}

/** Path (with /) under the hosted folder, e.g. "RC_Data_FMS/Invoices/Invoice_Doc/1.pdf", to what was copied. */
export type ExternalManifest = Record<string, ExternalEntry>;

export function externalManifest(setDir: string, allowMissing = true): ExternalManifest {
  return readBackupInfo<{ external?: ExternalManifest }>(setDir, allowMissing).external ?? {};
}

function saveManifest(setDir: string, manifest: ExternalManifest): void {
  updateBackupInfo(setDir, (info) => { info.external = manifest; });
}

/** Reject platform-specific escapes and symlink ancestors before any IO on a manifest path. */
export function safePath(root: string, rel: string): string {
  const parts = rel.split('/');
  const target = resolve(root, ...parts);
  const inside = relative(resolve(root), target);
  if (isAbsolute(rel) || win32.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0') ||
      parts.some((p) => !p || p === '.' || p === '..' || p.includes(':')) || !inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) {
    throw new Error(`unsafe external path: ${rel}`);
  }
  let path = resolve(root);
  for (const part of parts) {
    path = join(path, part);
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error(`unsafe external path (symlink): ${rel}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return target;
}

function validateExternal(root: string, rel: string): string {
  if (!EXTERNAL_DIRS.includes(rel.split('/')[0]) || rel.split('/').length < 3) throw new Error(`unsafe external path: ${rel}`);
  return safePath(root, rel);
}

/** Every file under a folder, as paths relative to it with /. */
function walk(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** The external container files of the hosted files `names` (without the store extension), as paths under `folder`. */
export function externalFiles(folder: string, names: string[]): string[] {
  const out: string[] = [];
  for (const sub of EXTERNAL_DIRS) {
    for (const name of names) {
      const root = join(folder, sub, name);
      if (existsSync(root)) out.push(...walk(root).map((r) => `${sub}/${name}/${r}`));
    }
  }
  return out;
}

const native = (rel: string) => rel.split('/').join(sep);

/**
 * Copies the hosted files' external container files into `setDir`, linking
 * the ones unchanged since `previousSet`, and records them in its backup.json.
 */
export async function backupExternal(folder: string, names: string[], setDir: string, previousSet?: string, passphrase?: string, signal?: AbortSignal): Promise<ExternalManifest> {
  // An earlier set's copies and checksums are carried over, not read again. When the backups are encrypted that is only
  // done for a set whose signature holds: its entries are then the ones it was made with.
  let previous: { external?: ExternalManifest; verified?: { files?: Record<string, string> } } = {};
  if (previousSet) {
    if (!passphrase) previous = readBackupInfo(previousSet, true);
    else {
      try {
        const verified = await readVerified(previousSet, passphrase);
        if (verified.state === 'signed') previous = verified.info as typeof previous;
      } catch { /* a set that does not check out is not reused: every file is copied again */ }
    }
  }
  const before = previous.external ?? {};
  const ext = passphrase ? ENCRYPTED_EXT : '';
  const manifest: ExternalManifest = {};
  for (const rel of externalFiles(folder, names)) {
    signal?.throwIfAborted();
    const src = join(folder, native(rel));
    const st = statSync(src);
    const checkSource = () => {
      const after = statSync(src);
      if (after.dev !== st.dev || after.ino !== st.ino || after.size !== st.size ||
          after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) {
        throw new Error(`${rel}: changed while being backed up; retry with the external writer stopped`);
      }
    };
    checkSource();
    const target = join(setDir, native(rel)) + ext;
    mkdirSync(dirname(target), { recursive: true });
    const old = before[rel];
    const oldCopy = previousSet && join(previousSet, native(rel)) + ext;
    const checkFiles = previous.verified?.files;
    const failedCheck = checkFiles?.[rel] !== undefined ? checkFiles[rel] !== 'ok' :
      checkFiles?.['external container files'] !== undefined;
    if (old && !old.reuseBlocked && !failedCheck && oldCopy && !!old.encrypted === !!passphrase && old.size === st.size && old.mtimeMs === st.mtimeMs &&
        (old.sourceCtimeMs === undefined || old.sourceCtimeMs === st.ctimeMs) && existsSync(oldCopy)) {
      const prior = statSync(oldCopy);
      // Links change ctime, so use the copy's size, mtime and identity. A
      // suspicious (or legacy) copy is hashed before it can be reused.
      // The copy's metadata is not covered by an encrypted set's signature, but the checksum that is signed is checked
      // again when the new set is verified (before it is published) and when it is restored, so a swapped copy is found.
      const unchanged = prior.size === old.copySize && prior.mtimeMs === old.copyMtimeMs &&
        prior.ino === old.copyIno && prior.dev === old.copyDev;
      // A set taken under another passphrase is not linked into this one.
      if ((unchanged || await checksum(oldCopy) === old.sha256) && (!passphrase || await opensWithPassphrase(oldCopy, passphrase))) {
        let linked = true;
        try { linkSync(oldCopy, target); }
        catch { linked = false; copyFileSync(oldCopy, target); }
        crashPoint('backup:external-after-file');
        if (!linked && await checksum(target) !== old.sha256) throw new Error(`${rel}: backup copy checksum mismatch`);
        checkSource();
        const copy = statSync(target);
        // Select fields explicitly: legacy plaintext source hashes must not
        // leak into new encrypted manifests, including reused entries.
        manifest[rel] = { size: st.size, mtimeMs: st.mtimeMs, sha256: old.sha256, encrypted: !!passphrase,
          sourceCtimeMs: st.ctimeMs, copySize: copy.size, copyMtimeMs: copy.mtimeMs, copyIno: copy.ino, copyDev: copy.dev };
        continue;
      }
      console.warn(`Previous backup set ${previousSet}: ${rel} is damaged or sealed with another passphrase; copying fresh from source`);
    }
    const sourceSha256 = passphrase ? undefined : await checksum(src);
    checkSource();
    if (passphrase) await encryptFile(src, target, passphrase);
    else {
      copyFileSync(src, target);
      utimesSync(target, st.atime, st.mtime);
    }
    crashPoint('backup:external-after-file');
    const sha256 = await checksum(target);
    if (!passphrase && sha256 !== sourceSha256) throw new Error(`${rel}: backup copy checksum does not match its source`);
    checkSource();
    const copy = statSync(target);
    manifest[rel] = { size: st.size, mtimeMs: st.mtimeMs, sha256, encrypted: !!passphrase,
      sourceCtimeMs: st.ctimeMs, copySize: copy.size, copyMtimeMs: copy.mtimeMs, copyIno: copy.ino, copyDev: copy.dev };
  }
  if (Object.keys(manifest).length) saveManifest(setDir, manifest);
  crashPoint('backup:external-after-manifest');
  return manifest;
}

async function checkExternalCopy(copy: string, sum: string, passphrase?: string): Promise<void> {
  if (!copy.endsWith(ENCRYPTED_EXT)) {
    if (await checksum(copy) !== sum) throw new Error('changed on disk since it was taken');
    return;
  }
  if (!passphrase) throw new Error('encrypted: set TABULARIUS_BACKUP_KEY to its passphrase');
  const scratch = mkdtempSync(join(tmpdir(), 'tabularius-external-check-'));
  try {
    const snapshot = join(scratch, 'copy.enc');
    copyFileSync(copy, snapshot);
    if (await checksum(snapshot) !== sum) throw new Error('changed on disk since it was taken');
    await decryptFile(snapshot, join(scratch, 'plain'), passphrase);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** Marks these container copies of a set as not to be linked into a later set: the next backup copies them fresh. */
export function blockReuse(setDir: string, rels: string[]): void {
  if (!rels.length) return;
  updateBackupInfo<{ external?: ExternalManifest }>(setDir, (info) => {
    for (const rel of rels) {
      const entry = info.external?.[rel];
      if (!entry) continue;
      delete entry.sourceCtimeMs;
      delete entry.copySize;
      delete entry.copyMtimeMs;
      delete entry.copyIno;
      delete entry.copyDev;
      entry.reuseBlocked = true;
    }
  });
}

/** Problems with a set's external container files: missing or changed copies, by path. */
export async function verifyExternal(setDir: string, passphrase?: string): Promise<Record<string, string>> {
  const problems: Record<string, string> = {};
  for (const [rel, entry] of Object.entries(externalManifest(setDir, false))) {
    try {
      const plain = validateExternal(setDir, rel);
      const encrypted = safePath(setDir, rel + ENCRYPTED_EXT);
      const copy = entry.encrypted ? encrypted : plain;
      if (!existsSync(copy)) problems[rel] = 'missing';
      else await checkExternalCopy(copy, entry.sha256, passphrase);
    } catch (e) { problems[rel] = (e as Error).message; }
  }
  blockReuse(setDir, Object.keys(problems));
  return problems;
}

/**
 * Puts back the external container files of `names` from a set: each one's
 * folders are rebuilt beside the hosted folder first and swapped in whole.
 * Hosted files whose set has no external files keep the folders they have.
 */
export async function stageExternal(setDir: string, folder: string, names: string[], passphrase?: string, signal?: AbortSignal, checked?: ExternalManifest, allowMissingManifest = false): Promise<{ count: number; files: RestoreFile[]; cleanup(): void }> {
  const manifest = checked ?? externalManifest(setDir, allowMissingManifest);
  const roots = new Map<string, string[]>();
  for (const rel of Object.keys(manifest)) {
    validateExternal(setDir, rel);
    validateExternal(folder, rel);
    safePath(setDir, rel + ENCRYPTED_EXT);
    const [sub, name] = rel.split('/');
    if (!names.includes(name)) continue;
    const key = `${sub}/${name}`;
    roots.set(key, [...(roots.get(key) ?? []), rel]);
  }
  for (const key of roots.keys()) {
    if (!existsSync(join(setDir, native(key)))) continue;
    for (const file of walk(setDir, key)) {
      const listed = manifest[file] ?? (file.endsWith(ENCRYPTED_EXT) ? manifest[file.slice(0, -ENCRYPTED_EXT.length)] : undefined);
      if (!listed) throw new Error(`${file}: absent from backup.json external manifest`);
    }
  }
  const staged: [string, string][] = [];
  try {
    for (const [key, rels] of roots) {
      const live = join(folder, native(key));
      const next = safePath(folder, key + '.restoring');
      rmSync(next, { recursive: true, force: true });
      staged.push([next, live]);
      for (const rel of rels) {
        signal?.throwIfAborted();
        const to = join(next, ...rel.split('/').slice(2));
        mkdirSync(dirname(to), { recursive: true });
        const plain = join(setDir, native(rel));
        const encrypted = !!manifest[rel].encrypted;
        const source = encrypted ? plain + ENCRYPTED_EXT : plain;
        if (!existsSync(source)) throw new Error(`${rel}: missing backup file; use a complete backup set and try the restore again`);
        const copy = encrypted ? join(next, `.decrypt-${randomUUID()}.tmp`) : to;
        copyFileSync(source, copy);
        crashPoint('restore:external-after-copy');
        if (await checksum(copy) !== manifest[rel].sha256) throw new Error(`${rel}: changed on disk since it was taken`);
        crashPoint('restore:external-after-verify');
        if (encrypted) {
          if (!passphrase) throw new Error(`${rel} is encrypted: set TABULARIUS_BACKUP_KEY to its passphrase`);
          await decryptFile(copy, to, passphrase);
          crashPoint('restore:external-after-decrypt');
          rmSync(copy);
        }
      }
    }
  } catch (e) {
    for (const [next] of staged) rmSync(next, { recursive: true, force: true });
    throw e;
  }
  return {
    count: [...roots.values()].reduce((n, r) => n + r.length, 0),
    files: staged.map(([next, live]) => ({ staged: next, target: live })),
    cleanup() { for (const [next] of staged) rmSync(next, { recursive: true, force: true }); },
  };
}

export async function restoreExternal(setDir: string, folder: string, names: string[], passphrase?: string): Promise<number> {
  const stage = await stageExternal(setDir, folder, names, passphrase);
  try { commitRestore(folder, stage.files); return stage.count; } finally { stage.cleanup(); }
}

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
import { decryptFile, encryptFile, ENCRYPTED_EXT } from './encrypt.ts';

/** Folders, next to a hosted file, that hold its externally stored container files. */
export const EXTERNAL_DIRS = ['RC_Data_FMS', 'Files'];

export interface ExternalEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
}

/** Path (with /) under the hosted folder, e.g. "RC_Data_FMS/Invoices/Invoice_Doc/1.pdf", to what was copied. */
export type ExternalManifest = Record<string, ExternalEntry>;

export function externalManifest(setDir: string): ExternalManifest {
  return readBackupInfo<{ external?: ExternalManifest }>(setDir, true).external ?? {};
}

function saveManifest(setDir: string, manifest: ExternalManifest): void {
  updateBackupInfo(setDir, (info) => { info.external = manifest; });
}

/** Reject platform-specific escapes and symlink ancestors before any IO on a manifest path. */
function safePath(root: string, rel: string): string {
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
  const before = previousSet ? externalManifest(previousSet) : {};
  const ext = passphrase ? ENCRYPTED_EXT : '';
  const manifest: ExternalManifest = {};
  for (const rel of externalFiles(folder, names)) {
    signal?.throwIfAborted();
    const src = join(folder, native(rel));
    const st = statSync(src);
    const target = join(setDir, native(rel)) + ext;
    mkdirSync(dirname(target), { recursive: true });
    const old = before[rel];
    const oldCopy = previousSet && join(previousSet, native(rel)) + ext;
    if (old && oldCopy && old.size === st.size && old.mtimeMs === st.mtimeMs && existsSync(oldCopy)) {
      try {
        try { linkSync(oldCopy, target); }
        catch { copyFileSync(oldCopy, target); }
        await checkExternalCopy(target, old.sha256, passphrase);
        crashPoint('backup:external-after-file');
        manifest[rel] = old;
        continue;
      } catch {
        rmSync(target, { force: true });
        // Rebuild from the source when the prior copy cannot be used with this key.
      }
    }
    if (passphrase) await encryptFile(src, target, passphrase);
    else {
      copyFileSync(src, target);
      utimesSync(target, st.atime, st.mtime);
    }
    crashPoint('backup:external-after-file');
    manifest[rel] = { size: st.size, mtimeMs: st.mtimeMs, sha256: await checksum(target) };
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

/** Problems with a set's external container files: missing or changed copies, by path. */
export async function verifyExternal(setDir: string, passphrase?: string): Promise<Record<string, string>> {
  const problems: Record<string, string> = {};
  for (const [rel, entry] of Object.entries(externalManifest(setDir))) {
    try {
      const plain = validateExternal(setDir, rel);
      const encrypted = safePath(setDir, rel + ENCRYPTED_EXT);
      const copy = [plain, encrypted].find((p) => existsSync(p));
      if (!copy) problems[rel] = 'missing';
      else await checkExternalCopy(copy, entry.sha256, passphrase);
    } catch (e) { problems[rel] = (e as Error).message; }
  }
  return problems;
}

/**
 * Puts back the external container files of `names` from a set: each one's
 * folders are rebuilt beside the hosted folder first and swapped in whole.
 * Hosted files whose set has no external files keep the folders they have.
 */
export async function stageExternal(setDir: string, folder: string, names: string[], passphrase?: string, signal?: AbortSignal): Promise<{ count: number; files: RestoreFile[]; cleanup(): void }> {
  const manifest = externalManifest(setDir);
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
        const encrypted = !existsSync(plain);
        const copy = encrypted ? join(next, `.decrypt-${randomUUID()}.tmp`) : to;
        copyFileSync(encrypted ? plain + ENCRYPTED_EXT : plain, copy);
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

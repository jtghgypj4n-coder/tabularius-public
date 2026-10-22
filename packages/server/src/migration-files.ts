import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, rmdirSync, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { encryptionInfo, fileSource, FmpFile } from '../../fmp12/src/file.ts';
import { safePath } from './backup-external.ts';
import { commitRestore, type RestoreFile } from './restore-files.ts';

function checksum(path: string): string {
  const source = fileSource(path);
  try {
    const hash = createHash('sha256');
    for (let offset = 0; offset < source.size; offset += 1 << 20) {
      hash.update(source.read(offset, Math.min(1 << 20, source.size - offset)));
    }
    return hash.digest('hex');
  } finally { source.close?.(); }
}

function unchanged(path: string, before: Stats): void {
  const after = lstatSync(path);
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
    throw new Error(`${path}: changed during migration; stop the source writer and retry`);
  }
}

/** Caller holds the destination's folder claim. Publish the file and containers as one recoverable batch. */
export function migrateFile(folder: string, from: string, to: string, external: string, externalTarget: string): void {
  const files: RestoreFile[] = [];
  const createdParents: string[] = [];
  const checked = (path: string) => safePath(folder, relative(folder, path).split(sep).join('/'));
  const checks: (() => void)[] = [];
  const stage = (source: string, target: string): void => {
    checked(target);
    const before = lstatSync(source);
    if (before.isDirectory()) {
      mkdirSync(target, { recursive: true });
      const names = readdirSync(source).sort();
      for (const name of names) stage(join(source, name), join(target, name));
      checks.push(() => {
        unchanged(source, before);
        if (JSON.stringify(readdirSync(source).sort()) !== JSON.stringify(names)) throw new Error(`${source}: changed during migration`);
      });
    } else {
      if (!before.isFile()) throw new Error(`${source}: migration requires a regular file, not a symlink or special file`);
      const sum = checksum(source);
      copyFileSync(source, target);
      if (checksum(target) !== sum) throw new Error(`${source}: migration copy checksum mismatch`);
      checks.push(() => unchanged(source, before));
    }
  };
  try {
    if (existsSync(external)) {
      if (existsSync(externalTarget)) throw new Error(`${externalTarget}: container folder already exists; resolve the conflict before migration`);
      checked(externalTarget);
      const staged = checked(externalTarget + '.restoring');
      files.push({ staged, target: externalTarget });
      rmSync(staged, { recursive: true, force: true });
      for (let parent = dirname(staged); parent !== folder && !existsSync(parent); parent = dirname(parent)) createdParents.push(parent);
      mkdirSync(dirname(staged), { recursive: true });
      stage(external, staged);
    }
    checked(to);
    const staged = checked(to + '.restoring');
    files.push({ staged, target: to });
    rmSync(staged, { force: true });
    stage(from, staged);
    // Use the existing reader's header/block-count validation. Encrypted files
    // are transferred byte-for-byte; their contents need a source passphrase.
    const source = fileSource(staged);
    try { if (!encryptionInfo(source).encrypted) new FmpFile(source); }
    finally { source.close?.(); }
    for (const check of checks) check();
    for (const file of files) {
      if (existsSync(file.target)) throw new Error(`${file.target}: appeared during migration; refusing to overwrite it`);
    }
    commitRestore(folder, files);
  } catch (error) {
    throw new Error(`Migration of ${from} failed: ${(error as Error).message}`, { cause: error });
  } finally {
    for (const file of files) rmSync(checked(file.staged!), { recursive: true, force: true });
    for (const parent of createdParents) {
      try { rmdirSync(checked(parent)); }
      catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
  }
}

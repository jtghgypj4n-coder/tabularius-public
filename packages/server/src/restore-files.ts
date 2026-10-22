import { removeFileSync as rmSync } from '../../store/src/file-ops.ts';
import { crashPoint } from '../../store/src/crash-point.ts';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { readFileSync } from '../../store/src/fs-boundary.ts';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { atomicWrite, syncPath, writeDurable } from '../../store/src/durable.ts';

export interface RestoreFile {
  /** Undefined removes an obsolete sidecar after preserving it for rollback. */
  staged?: string;
  target: string;
}

const JOURNAL = '.restore-journal.json';
interface RestoreJournal {
  version: 1;
  phase: 'pending' | 'committed';
  files: { target: string; saved: string; existed: boolean }[];
}

function flushTree(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`cannot restore a symlink: ${path}`);
  if (stat.isDirectory()) for (const name of readdirSync(path)) flushTree(join(path, name));
  syncPath(path);
}

/** Fail closed on corrupt journals, before removing or moving any live files. */
function validateJournal(folder: string, value: unknown): asserts value is RestoreJournal {
  const journal = value as RestoreJournal | null;
  if (!journal || journal.version !== 1 || !['pending', 'committed'].includes(journal.phase) || !Array.isArray(journal.files)) {
    throw new Error('Invalid restore journal');
  }
  const paths: string[] = [];
  for (const file of journal.files) {
    if (!file || typeof file.target !== 'string' || typeof file.saved !== 'string' || typeof file.existed !== 'boolean' ||
        !file.saved.startsWith(file.target + '.restore-previous-') ||
        !/^[a-f0-9-]{36}$/.test(file.saved.slice((file.target + '.restore-previous-').length))) {
      throw new Error('Invalid restore journal entry');
    }
    for (const path of [file.target, file.saved]) {
      const parts = path.split(sep);
      if (isAbsolute(path) || parts.some((part) => !part || part === '.' || part === '..' || /[:\\\0]/.test(part)) || path === JOURNAL ||
          paths.some((other) => other === path || other.startsWith(path + sep) || path.startsWith(other + sep))) {
        throw new Error(`Unsafe restore journal path: ${path}`);
      }
      paths.push(path);
      let at = resolve(folder);
      for (const part of parts) {
        at = join(at, part);
        try {
          if (lstatSync(at).isSymbolicLink()) throw new Error(`Cannot recover restore through a symlink: ${at}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
  }
}

/**
 * Called while the folder is offline, before startup sweeps staging files.
 * Pending batches roll back; committed batches only finish deleting old copies.
 * Each operation is repeatable, including a crash during recovery itself.
 */
export function recoverRestore(folder: string, publish = writeDurable): void {
  const path = join(folder, JOURNAL);
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink()) throw new Error('Cannot read a symlink restore journal');
  let journal: unknown;
  try { journal = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`${path}: cannot read restore journal JSON; preserve it and the .restore-previous-* copies for recovery`, { cause: error }); }
  validateJournal(folder, journal);
  for (const file of [...journal.files].reverse()) {
    const target = join(folder, file.target);
    const saved = join(folder, file.saved);
    if (journal.phase === 'committed') {
      rmSync(saved, { recursive: true, force: true });
    } else if (existsSync(saved)) {
      rmSync(target, { recursive: true, force: true });
      publish(saved, target);
    } else if (!file.existed) {
      rmSync(target, { recursive: true, force: true });
    }
    // Also flush parents of already-recovered entries after a previous crash.
    syncPath(dirname(target));
  }
  rmSync(path);
  syncPath(folder);
}

/** Publish a verified batch with a durable rollback journal before its first rename. */
export function commitRestore(folder: string, files: RestoreFile[], publish = writeDurable): void {
  recoverRestore(folder, publish);
  if (!files.length) return;
  for (const file of files) if (file.staged) flushTree(file.staged);
  const journal: RestoreJournal = {
    version: 1,
    phase: 'pending',
    files: files.map((file) => {
      const target = relative(resolve(folder), resolve(file.target));
      return { target, saved: `${target}.restore-previous-${randomUUID()}`, existed: existsSync(file.target) };
    }),
  };
  validateJournal(folder, journal);
  const path = join(folder, JOURNAL);
  atomicWrite(path, JSON.stringify(journal));
  crashPoint('restore:after-journal');
  try {
    for (const [i, file] of files.entries()) {
      const state = journal.files[i];
      if (state.existed) publish(file.target, join(folder, state.saved));
      crashPoint('restore:after-save');
      if (file.staged) publish(file.staged, file.target);
      crashPoint('restore:after-publish');
    }
    // A failure before the decision's rename is pending and must roll back.
    // A directory-sync failure after that rename has already committed.
    journal.phase = 'committed';
    atomicWrite(path, JSON.stringify(journal));
    crashPoint('restore:after-commit');
  } catch (error) {
    let committed = false;
    if (journal.phase === 'committed') {
      try { committed = readFileSync(path, 'utf8') === JSON.stringify(journal); }
      catch { /* Recovery below reports an unreadable decision. */ }
    }
    if (committed) {
      console.warn(`Restore committed, but syncing its commit decision failed; durability is uncertain: ${(error as Error).message}`);
    } else {
      try { recoverRestore(folder, publish); } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Restore failed and rollback was incomplete; retain the restore journal and .restore-previous-* copies for recovery');
      }
      throw error;
    }
  }
  try { recoverRestore(folder, publish); }
  catch (error) {
    console.warn(`Restore committed, but cleanup is incomplete; retain the restore journal for recovery: ${(error as Error).message}`);
  }
  crashPoint('restore:after-cleanup');
}

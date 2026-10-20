// Conversion workspaces carry the source identity and owning PID in their name.
// A dead owner's workspace can be claimed by renaming the whole directory, so
// SQLite's journal/WAL files move with it and only one converter can resume it.
import fs from 'node:fs';
import { crashPoint } from '../../store/src/crash-point.ts';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { syncPath, writeDurable } from '../../store/src/durable.ts';

const STALE_MS = 24 * 60 * 60 * 1000;
const workspacePattern = /^(.*\.openhbam\.sqlite)\.tmp-([a-f0-9]{24})-(\d+)-[a-f0-9]{16}$/;
const STORE_SUFFIX = '.openhbam.sqlite';
const legacyPattern = /^(.*\.openhbam\.sqlite)\.tmp(?:-(\d+)-[a-f0-9]{16})?$/;

/** Workspaces this process made or claimed. Under PID 1 in a container a restarted process reuses its crashed predecessor's PID. */
const owned = new Set<string>();

function alive(pid: number, path: string): boolean {
  if (pid === process.pid) return owned.has(basename(path));
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/** A converter that may still publish this store: its workspace exists and its owner runs. */
function liveWorkspace(store: string, except?: string): boolean {
  const dir = dirname(store);
  return fs.readdirSync(dir).some((entry) => {
    const match = workspacePattern.exec(entry);
    return !!match && match[1] === basename(store) && join(dir, entry) !== except && alive(Number(match[3]), join(dir, entry));
  });
}

/**
 * A 0-byte store is the fallback publisher's reservation. With no live
 * converter for it, its publisher crashed before the rename: remove it so the
 * file is converted again. `except` is the caller's own workspace.
 */
function clearStrandedReservation(store: string, except?: string): boolean {
  try {
    if (fs.statSync(store).size !== 0 || liveWorkspace(store, except)) return false;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  fs.rmSync(store, { force: true });
  return true;
}

/** The folder's entries; a folder that has gone (host closed, folder removed) has nothing to sweep. */
function entries(dir: string): string[] {
  try { return fs.readdirSync(dir); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Keep recent interrupted work for resume; discard completed or expired work, never a live owner's. */
export function sweepConversionTemps(dir: string, log: (line: string) => void = () => {}): void {
  const skip = (entry: string, e: unknown) => {
    // One unreadable entry must not stop startup or a conversion's cleanup.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log(`couldn't clean up ${entry}: ${(e as Error).message}`);
  };
  // Reservations first, so the interrupted workspace behind one is kept for resume rather than swept as finished.
  const present = entries(dir);
  for (const entry of present) {
    if (!entry.endsWith(STORE_SUFFIX)) continue;
    // Uploads have no final .fmp12 yet: their workspace also identifies a
    // reservation. Clear it before treating that workspace as completed.
    if (!fs.existsSync(join(dir, entry.slice(0, -STORE_SUFFIX.length) + '.fmp12')) &&
        !present.some((name) => workspacePattern.exec(name)?.[1] === entry)) continue;
    try {
      if (clearStrandedReservation(join(dir, entry))) log(`${entry} was left empty by an interrupted conversion; converting it again`);
    } catch (e) { skip(entry, e); }
  }
  for (const entry of entries(dir)) {
    const path = join(dir, entry);
    try {
      const workspace = workspacePattern.exec(entry);
      const legacy = legacyPattern.exec(entry.replace(/-(?:wal|shm|journal)$/, ''));
      const match = workspace ?? legacy;
      if (!match) continue;
      const pid = workspace ? Number(workspace[3]) : Number(legacy?.[2]);
      if (pid && alive(pid, path)) continue;
      if (workspace && fs.existsSync(join(dir, match[1]))) completeConversionSource(join(path, 'store.sqlite'), join(dir, match[1]));
      if (fs.existsSync(join(dir, match[1])) || fs.existsSync(join(dir, match[1] + '.enc')) || Date.now() - fs.statSync(path).mtimeMs > STALE_MS) {
        fs.rmSync(path, { recursive: true, force: true });
      }
    } catch (e) { skip(entry, e); }
  }
}

export function conversionTemp(store: string, src: string): string {
  const stat = fs.statSync(src);
  const identity = createHash('sha256').update(JSON.stringify([resolve(src), stat.size, stat.mtimeMs])).digest('hex').slice(0, 24);
  const dir = dirname(store);
  const workspace = `${store}.tmp-${identity}-${process.pid}-${randomBytes(8).toString('hex')}`;
  for (const entry of fs.readdirSync(dir)) {
    const match = workspacePattern.exec(entry);
    if (!match || match[1] !== basename(store) || match[2] !== identity || alive(Number(match[3]), join(dir, entry))) continue;
    try {
      fs.renameSync(join(dir, entry), workspace);
      owned.add(basename(workspace));
      return join(workspace, 'store.sqlite');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      // Another converter claimed this interrupted workspace first.
    }
  }
  fs.mkdirSync(workspace);
  owned.add(basename(workspace));
  return join(workspace, 'store.sqlite');
}

export function finishConversion(temp: string): void {
  const workspace = dirname(temp);
  fs.rmSync(workspace, { recursive: true, force: true });
  owned.delete(basename(workspace));
  sweepConversionTemps(dirname(workspace));
}

/** Publish complete source bytes; a leftover partial copy is never a completed source. */
function publishSource(source: string, target: string, scratch: string): void {
  const size = fs.statSync(source).size;
  const complete = () => {
    try { return fs.statSync(target).size === size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  };
  if (complete()) return;
  try { fs.linkSync(source, target); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST' && complete()) return;
    if (!['EEXIST', 'EXDEV', 'EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS'].includes(code)) throw error;
    // Scratch lives in the owned workspace on the destination volume. A crash
    // during copy leaves the source and any previously published file intact.
    fs.rmSync(scratch, { force: true });
    try {
      fs.copyFileSync(source, scratch, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(scratch).size !== size) throw new Error('Conversion source copy is incomplete');
      writeDurable(scratch, target);
    } finally { fs.rmSync(scratch, { force: true }); }
  }
  syncPath(target);
  syncPath(dirname(target));
}

/** Keep an upload's source beside its conversion until both are published. */
export function stageConversionSource(temp: string, source: string): void {
  const staged = join(dirname(temp), 'source.fmp12');
  publishSource(source, staged, staged + '.partial');
}

/** Finish only the winning upload, including after its publisher exits. */
export function completeConversionSource(temp: string, store: string): void {
  const staged = join(dirname(temp), 'source.fmp12');
  if (!fs.existsSync(staged)) return;
  // Hard-link publication retains temp; fallback rename consumes it. A loser
  // must never publish its source beside another converter's winning store.
  if (fs.existsSync(temp)) {
    const from = fs.statSync(temp); const to = fs.statSync(store);
    if (from.dev !== to.dev || from.ino !== to.ino) return;
  }
  const target = store.slice(0, -STORE_SUFFIX.length) + '.fmp12';
  publishSource(staged, target, join(dirname(temp), 'source-publish.partial'));
}

/** Publish without replacing an existing store, including on volumes without hard links. */
export function publishConversion(temp: string, store: string): boolean {
  try {
    fs.linkSync(temp, store);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    if (!['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS', 'EXDEV'].includes(code ?? '')) throw e;
  }
  // Reserve the destination exclusively before the atomic rename. A competing
  // publisher gets EEXIST and cannot overwrite the winner's store.
  let fd: number;
  try { fd = fs.openSync(store, 'wx'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    if (!clearStrandedReservation(store, dirname(temp))) return false;
    try { fd = fs.openSync(store, 'wx'); }
    catch (again) {
      if ((again as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw again;
    }
  }
  crashPoint('host-conversion:after-reserve');
  try {
    fs.renameSync(temp, store);
    return true;
  } catch (e) {
    fs.rmSync(store, { force: true });
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}

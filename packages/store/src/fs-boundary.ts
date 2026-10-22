/** Filesystem boundary checks, shared by file-bearing operations.
 *
 * Descriptor checks prevent a swapped leaf from being read or truncated. Parent
 * snapshots detect replacement at our test boundaries; they are not openat(2).
 * Keep these folders owned by the service user: Node does not expose portable
 * descriptor-relative creation/rename, so hostile concurrent parent renames
 * cannot be excluded by path checks alone.
 */
import * as fs from 'node:fs';
import { open as nativeOpen, type FileHandle } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FilesystemBoundary {
  operation: 'open' | 'rename' | 'link' | 'remove' | 'native' | 'write';
  phase: 'checked' | 'opened';
  path: string;
  target?: string;
  /** Descriptor-only writes have an empty path; no pathname is reopened. */
  fd?: number;
}
const hooks = new AsyncLocalStorage<(event: FilesystemBoundary) => void>();
/** Test-only, scoped injection; no environment switch or process-global hook. */
export function withFilesystemHook<T>(hook: (event: FilesystemBoundary) => void, action: () => T): T {
  return hooks.run(hook, action);
}
function boundary(event: FilesystemBoundary): void { hooks.getStore()?.(event); }
const name = (path: fs.PathLike): string => resolve(path instanceof URL ? fileURLToPath(path) : path.toString());
const same = (a: fs.Stats, b: fs.Stats): boolean => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink;
function refused(): never {
  throw Object.assign(new Error('Filesystem path changed or is not a safe regular file'), { code: 'ESTALE' });
}
function leaf(path: string): fs.Stats | undefined {
  try { return fs.lstatSync(path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

function parents(path: string): () => void {
  const chain = new Map<string, { stat: fs.Stats; target?: string }>();
  const capture = (directory: string): void => {
    for (let at = directory; !chain.has(at); at = dirname(at)) {
      const stat = fs.lstatSync(at);
      if (!stat.isDirectory() && !stat.isSymbolicLink()) refused();
      const target = stat.isSymbolicLink() ? fs.realpathSync(at) : undefined;
      chain.set(at, { stat, target });
      // Stable aliases (including /proc/self) are valid. Snapshot both their
      // entries and resolved ancestry; containment remains the caller's job.
      if (target) capture(target);
      if (at === dirname(at)) break;
    }
  };
  capture(dirname(path));
  return () => {
    for (const [at, { stat: st, target }] of chain) {
      const now = fs.lstatSync(at);
      // APFS changes a directory's link count when ordinary files are created.
      if (st.dev !== now.dev || st.ino !== now.ino || st.mode !== now.mode) refused();
      if (target && fs.realpathSync(at) !== target) refused();
    }
  };
}

function flagsNumber(flags: string | number): number {
  if (typeof flags === 'number') return flags;
  const c = fs.constants;
  const flagsMap: Record<string, number> = {
    r: c.O_RDONLY, 'r+': c.O_RDWR, rs: c.O_RDONLY | c.O_SYNC, 'rs+': c.O_RDWR | c.O_SYNC,
    w: c.O_WRONLY | c.O_CREAT | c.O_TRUNC, 'w+': c.O_RDWR | c.O_CREAT | c.O_TRUNC,
    wx: c.O_WRONLY | c.O_CREAT | c.O_TRUNC | c.O_EXCL, 'wx+': c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_EXCL,
    a: c.O_WRONLY | c.O_CREAT | c.O_APPEND, 'a+': c.O_RDWR | c.O_CREAT | c.O_APPEND,
    ax: c.O_WRONLY | c.O_CREAT | c.O_APPEND | c.O_EXCL, 'ax+': c.O_RDWR | c.O_CREAT | c.O_APPEND | c.O_EXCL,
  };
  if (!(flags in flagsMap)) throw new Error(`Unsupported guarded file flags: ${flags}`);
  return flagsMap[flags];
}

/** Open without truncation, then validate the descriptor before any data access. */
function prepareOpen(path: fs.PathLike, flags: string | number, mode: fs.Mode | null = 0o600) {
  const p = name(path), c = fs.constants, bits = flagsNumber(flags);
  const writing = !!(bits & (c.O_WRONLY | c.O_RDWR));
  const checkParents = parents(p), before = leaf(p);
  if (before && (!before.isFile() && !(before.isDirectory() && !writing))) refused();
  if (before && writing && before.nlink !== 1) refused();
  boundary({ operation: 'open', phase: 'checked', path: p });
  checkParents();
  const current = leaf(p);
  if (before ? !current || !same(before, current) : current) refused();
  // Exclusive creation also closes the missing-leaf race. O_NONBLOCK keeps a
  // swapped FIFO from hanging the process before fstat can reject it.
  return {
    path: p,
    flags: (bits & ~c.O_TRUNC) | (c.O_NOFOLLOW ?? 0) | c.O_NONBLOCK |
      (!before && bits & c.O_CREAT ? c.O_EXCL : 0),
    mode: mode ?? 0o600,
    validate(fd: number) {
      boundary({ operation: 'open', phase: 'opened', path: p, fd });
      checkParents();
      const opened = fs.fstatSync(fd), current = leaf(p);
      if (!current || !same(opened, current) || (before && !same(before, opened)) ||
          (!opened.isFile() && !(opened.isDirectory() && !writing)) || (writing && opened.nlink !== 1)) refused();
      if (writing) fs.fchmodSync(fd, typeof mode === 'string' ? parseInt(mode, 8) : mode ?? 0o600);
      if (bits & c.O_TRUNC) fs.ftruncateSync(fd, 0);
    },
  };
}

export const openSync: typeof fs.openSync = (path, flags, mode = 0o600) => {
  const pending = prepareOpen(path, flags, mode);
  const fd = fs.openSync(pending.path, pending.flags, pending.mode);
  try { pending.validate(fd); return fd; }
  catch (e) { fs.closeSync(fd); throw e; }
};

export async function open(path: string, flags: string, mode = 0o600): Promise<FileHandle> {
  const pending = prepareOpen(path, flags, mode);
  const handle = await nativeOpen(pending.path, pending.flags, pending.mode);
  try { pending.validate(handle.fd); return handle; }
  catch (e) { await handle.close(); throw e; }
}

export const readFileSync = ((path: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
  if (typeof path === 'number') return fs.readFileSync(path, options);
  const fd = openSync(path, 'r');
  try { return fs.readFileSync(fd, options); } finally { fs.closeSync(fd); }
}) as typeof fs.readFileSync;

export const writeFileSync: typeof fs.writeFileSync = (path, data, options) => {
  if (typeof path === 'number') {
    checkWritable(path);
    return fs.writeFileSync(path, data, options);
  }
  const opts = typeof options === 'object' && options ? options : {};
  const bits = flagsNumber(opts.flag ?? 'w');
  const fd = openSync(path, bits & ~fs.constants.O_TRUNC, opts.mode ?? 0o600);
  try {
    // No bytes change until the last write check has accepted this descriptor.
    checkWritable(fd);
    if (bits & fs.constants.O_TRUNC) fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, data, options);
  } finally { fs.closeSync(fd); }
};
export const appendFileSync: typeof fs.appendFileSync = (path, data, options) => {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  writeFileSync(path, data, { ...opts, flag: opts?.flag ?? 'a' });
};

/** Check both entries (including a missing destination) immediately before rename. */
function renameChecked(from: fs.PathLike, to: fs.PathLike, allowLinks = false): void {
  const path = name(from), target = name(to);
  const checkFrom = parents(path), checkTo = parents(target);
  const source = leaf(path), dest = leaf(target);
  if (!source || (!allowLinks && (source.isSymbolicLink() || dest?.isSymbolicLink()))) refused();
  boundary({ operation: 'rename', phase: 'checked', path, target });
  checkFrom(); checkTo();
  const next = leaf(path), nextDest = leaf(target);
  if (!next || !same(source, next) || (dest ? !nextDest || !same(dest, nextDest) : nextDest)) refused();
  fs.renameSync(path, target);
}
export const renameSync: typeof fs.renameSync = (from, to) => renameChecked(from, to);
/** Move an already-contained directory entry, preserving a stable alias itself. */
export const renameEntrySync: typeof fs.renameSync = (from, to) => renameChecked(from, to, true);

/** Copy through verified descriptors; never truncate a hard-linked destination. */
export const copyFileSync: typeof fs.copyFileSync = (from, to, mode = 0) => {
  const input = openSync(from, 'r');
  try {
    const source = fs.fstatSync(input), dest = leaf(name(to));
    if (dest && source.dev === dest.dev && source.ino === dest.ino) refused();
    const output = openSync(to, mode & fs.constants.COPYFILE_EXCL ? 'wx' : 'w');
    try {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      let n: number;
      while ((n = fs.readSync(input, chunk, 0, chunk.length, null))) {
        for (let at = 0; at < n;) at += writeSync(output, chunk, at, n - at);
      }
    } finally { fs.closeSync(output); }
  } finally { fs.closeSync(input); }
};

/** Keep batched log writes asynchronous, after opening a verified descriptor. */
export async function appendFile(path: string, data: string): Promise<void> {
  const fd = openSync(path, 'a');
  try {
    checkWritable(fd);
    await new Promise<void>((resolve, reject) => fs.appendFile(fd, data, (error) => error ? reject(error) : resolve()));
  } finally { fs.closeSync(fd); }
}

/** Capture cleanup authority before an operation can rename its parents. A
 * changed path is left alone, even when that means retaining a private orphan.
 */
export function cleanupPath(path: string, options: fs.RmOptions = { force: true }): () => void {
  const p = name(path), checkParents = parents(p), before = leaf(p);
  if (!before) return () => {}; // absence is not ownership of a future entry
  return () => {
    try {
      checkParents();
      const current = leaf(p);
      if (!current || (before && (before.dev !== current.dev || before.ino !== current.ino))) return;
      boundary({ operation: 'remove', phase: 'checked', path: p });
      checkParents();
      const next = leaf(p);
      if (!next || next.dev !== current.dev || next.ino !== current.ino) return;
      fs.rmSync(p, options);
    } catch (error) {
      if (!['ENOENT', 'ESTALE', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  };
}

/** Backup deduplication may reuse only a private regular file. Older permissive
 * copies fall back to a new private copy, without chmod-ing an older backup.
 */
export const linkSync: typeof fs.linkSync = (from, to) => {
  const path = name(from), target = name(to), source = leaf(path);
  const checkFrom = parents(path), checkTo = parents(target);
  if (!source?.isFile() || leaf(target)) refused();
  if (source.mode & 0o077) throw Object.assign(new Error('Backup needs a private copy'), { code: 'EPRIVATECOPY' });
  boundary({ operation: 'link', phase: 'checked', path, target });
  checkFrom(); checkTo();
  const next = leaf(path);
  if (!next || !same(source, next) || leaf(target)) refused();
  fs.linkSync(path, target);
};

/** A native API (SQLite) accepts a pathname rather than our descriptor. Check
 * the same entry around that API; this does not make its own open atomic.
 */
export function checkedFile(path: string): () => void {
  const p = name(path), checkParents = parents(p), before = leaf(p);
  if (!before?.isFile()) refused();
  const check = () => {
    checkParents();
    const current = leaf(p);
    if (!current || !same(before, current)) refused();
  };
  boundary({ operation: 'native', phase: 'checked', path: p });
  check();
  return check;
}

export const createReadStream: typeof fs.createReadStream = (path, options) => {
  const opts = typeof options === 'string' ? { encoding: options } : options;
  if (opts?.fd !== undefined) return fs.createReadStream(path, options);
  const fd = openSync(path, 'r');
  try { return fs.createReadStream(path, { ...opts, fd, autoClose: true }); }
  catch (error) { fs.closeSync(fd); throw error; }
};

function checkWritable(fd: number): void {
  boundary({ operation: 'write', phase: 'checked', path: '', fd });
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1) refused();
}

/** Recheck link count for long-lived upload/export descriptors at every write. */
export const writeSync = ((...args: unknown[]) => {
  checkWritable(args[0] as number);
  return Reflect.apply(fs.writeSync, fs, args);
}) as typeof fs.writeSync;


export async function writeFileHandle(handle: FileHandle, data: Uint8Array): Promise<void> {
  for (let at = 0; at < data.length;) {
    checkWritable(handle.fd);
    const { bytesWritten } = await handle.write(data, at, data.length - at);
    if (!bytesWritten) throw Object.assign(new Error('File write made no progress'), { code: 'EIO' });
    at += bytesWritten;
  }
}


/** Delete the contained entry itself, never the target of an alias. */
export function removeEntrySync(path: string, options: fs.RmOptions = {}): void {
  const p = name(path), checkParents = parents(p), before = leaf(p);
  if (!before) { if (options.force) return; throw Object.assign(new Error('File is missing'), { code: 'ENOENT' }); }
  boundary({ operation: 'remove', phase: 'checked', path: p });
  checkParents();
  const current = leaf(p);
  if (!current || !same(before, current)) refused();
  fs.rmSync(p, options);
}

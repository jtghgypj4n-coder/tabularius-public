import { lstatSync, mkdirSync, opendirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { commonParent, storageRelative, withinPath } from './portable-path.ts';

function within(root: string, path: string): boolean {
  return withinPath(root, path);
}

type DirectoryLink = { link: string; target?: string };

/** Find the indexed spelling of a mount through the volume's own case rules. */
function approvedLink(path: string, allowedLinks: ReadonlyMap<string, DirectoryLink>): DirectoryLink | undefined {
  const exact = allowedLinks.get(path);
  if (exact) return exact;
  try {
    const candidate = lstatSync(path);
    if (!candidate.isSymbolicLink()) return undefined;
    const real = realpathSync(path);
    for (const [indexed, link] of allowedLinks) {
      try {
        const original = lstatSync(indexed);
        if (original.isSymbolicLink() && candidate.dev === original.dev && candidate.ino === original.ino &&
            realpathSync(indexed) === real && readlinkSync(path) === link.link) return link;
      } catch { /* an indexed mount may have been removed */ }
    }
  } catch { /* missing path or a case-sensitive volume */ }
  return undefined;
}

/** Directory links present near a root when the store opened are operator-managed storage mounts.
 * Stop after a small number of entries even in a very wide tree. Unindexed links fail closed.
 */
export function existingDirectoryLinks(roots: string[]): ReadonlyMap<string, DirectoryLink> {
  const links = new Map<string, DirectoryLink>();
  const MAX_DEPTH = 2;
  const MAX_ENTRIES = 1024;
  // Roots share the hosted folder. Inspect symlinks below it, without mistaking
  // a system path alias (for example /var -> /private/var) for a container mount.
  const common = commonParent(roots);
  if (common === undefined) return links;
  for (const root of roots) {
    let component = common;
    let linked = false;
    for (const part of relative(common, resolve(root)).split(sep).filter(Boolean)) {
      component = resolve(component, part);
      try { if (lstatSync(component).isSymbolicLink()) { linked = true; break; } }
      catch { linked = true; break; }
    }
    if (linked) continue;
    let base: string;
    try { base = realpathSync(root); } catch { continue; }
    let remaining = MAX_ENTRIES; // per root, so a wide first root does not hide a later root's mounts
    const pending: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }];
    while (pending.length && remaining) {
      const { dir, depth } = pending.shift()!;
      let opened;
      try { opened = opendirSync(dir); } catch { continue; }
      try {
        let ent;
        while (remaining && (ent = opened.readSync())) {
          remaining--;
          const path = resolve(dir, ent.name);
          try {
            if (ent.isSymbolicLink()) {
              // readlink does not touch the target, which may be a sleeping drive.
              links.set(path, { link: readlinkSync(path) });
              // Never scan a mount's contents while opening the store.
            } else if (ent.isDirectory() && depth < MAX_DEPTH) {
              pending.push({ dir: path, depth: depth + 1 });
            }
          } catch { /* broken links and unreadable folders are not allowed */ }
        }
      } finally { opened.closeSync(); }
    }
  }
  return links;
}

/** Resolve a file below a root, allowing only directory links captured when the store opened. */
export function safeExistingPath(root: string, rel: string, allowedLinks: ReadonlyMap<string, DirectoryLink> = new Map()): string | undefined {
  const normalized = storageRelative(rel);
  if (!normalized) return undefined;
  rel = normalized;
  try {
    const base = realpathSync(root);
    const lexical = resolve(base, rel);
    if (!within(base, lexical)) return undefined;
    let at = base;
    const approvedBases: string[] = [];
    const parts = relative(base, lexical).split(sep).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      at = resolve(at, parts[i]);
      const info = lstatSync(at);
      if (info.isSymbolicLink()) {
        const approved = approvedLink(at, allowedLinks);
        if (i === parts.length - 1 || !approved || readlinkSync(at) !== approved.link) return undefined;
        const target = realpathSync(at);
        if (approved.target && target !== approved.target) return undefined;
        approved.target = target;
        at = target;
        approvedBases.push(at);
      }
      const real = realpathSync(at);
      if (!within(base, real) && !approvedBases.some((approved) => within(approved, real))) return undefined;
    }
    const target = realpathSync(at);
    return within(base, target) || approvedBases.some((approved) => within(approved, target)) ? target : undefined;
  } catch {
    return undefined;
  }
}

/** Prepare a path below a root without traversing directory links or a linked final component. */
export function safeWritePath(root: string, rel: string, allowedLinks: ReadonlyMap<string, DirectoryLink> = new Map()): string | undefined {
  const normalized = storageRelative(rel);
  if (!normalized) return undefined;
  rel = normalized;
  try {
    mkdirSync(root, { recursive: true });
    const base = realpathSync(root);
    const lexical = resolve(base, rel);
    if (!within(base, lexical)) return undefined;
    const parentRel = relative(base, dirname(lexical));
    let at = base;
    const approvedBases: string[] = [];
    for (const part of parentRel.split(sep).filter(Boolean)) {
      const candidate = resolve(at, part);
      try {
        const info = lstatSync(candidate);
        if (info.isSymbolicLink()) {
          const approved = approvedLink(candidate, allowedLinks);
          if (!approved || readlinkSync(candidate) !== approved.link || !statSync(candidate).isDirectory()) return undefined;
          const target = realpathSync(candidate);
          if (approved.target && target !== approved.target) return undefined;
          approved.target = target;
          at = target;
          approvedBases.push(at);
        } else if (info.isDirectory()) at = candidate;
        else return undefined;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
        mkdirSync(candidate);
        at = candidate;
      }
      const real = realpathSync(at);
      if (!within(base, real) && !approvedBases.some((approved) => within(approved, real))) return undefined;
    }
    const target = resolve(at, relative(dirname(lexical), lexical));
    try {
      if (lstatSync(target).isSymbolicLink()) return undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
    }
    return target;
  } catch {
    return undefined;
  }
}

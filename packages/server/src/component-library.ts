// The component library (not in FileMaker): layout components shared by every
// file on this server. A file saves one of its components here; any other
// file can place it, its fields, value lists, scripts and layouts found there
// by name (store/component-library.ts). Each file keeps its own copy, linked
// to the library by id and version, so a newer version is offered, with a
// preview, rather than changing files on its own. Kept in a file in the hosted
// folder, so every worker of a cluster reads the same library.
//
// Anyone with [Full Access] to a file on this server can see the library: a
// component saved here is shared with the designers of every file.

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withStateLock, writeJsonStateSync } from '../../store/src/durable.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

export const LIBRARY_FILE = '.openhbam-component-library.json';

/** How much the library holds: components, objects in one, and its pictures' bytes. */
export const LIBRARY_MAX = { components: 500, objects: 2000, imageBytes: 8 * 1024 * 1024, totalBytes: 96 * 1024 * 1024, name: 100 };

/** A picture a component shows, carried with it: its bytes in base64. */
export interface LibraryImage { filename: string | null; mime: string; data: string }

export interface LibraryEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Measured from the component's top left corner, every reference named. */
  objects: LayoutObject[];
  /** By the image library id the objects use in the file it was saved from. */
  images: Record<string, LibraryImage>;
  version: number;
  updated: string;
  /** The file the latest version was saved from. */
  from: string;
  /** The file it was first saved from: only that file saves new versions or takes it out. */
  owner: string;
  /** Files that have placed it or saved it. */
  uses: string[];
}

export class LibraryError extends Error {}
export class LibraryOwnerError extends LibraryError {}
export class LibraryVersionError extends LibraryError {}

function countObjects(objects: LayoutObject[]): number {
  return objects.reduce((n, o) => n + 1 + (o.children ? countObjects(o.children) : 0), 0);
}

export class ComponentLibrary {
  private readonly file: string;
  private cache?: { mtime: number; size: number; entries: LibraryEntry[] };

  constructor(dir: string) {
    this.file = join(dir, LIBRARY_FILE);
  }

  private read(): LibraryEntry[] {
    if (!existsSync(this.file)) return [];
    const { mtimeMs: mtime, size } = statSync(this.file);
    if (this.cache?.mtime === mtime && this.cache.size === size) return this.cache.entries;
    let entries: LibraryEntry[];
    try {
      entries = JSON.parse(readFileSync(this.file, 'utf8')) as LibraryEntry[];
      if (!Array.isArray(entries)) throw new Error('not a list');
    } catch {
      // A damaged library is set aside (for a person to look at) rather than breaking every design session.
      let damaged = `${this.file}.damaged-${Date.now()}`;
      while (existsSync(damaged)) damaged = `${this.file}.damaged-${Date.now()}-${randomBytes(4).toString('hex')}`;
      copyFileSync(this.file, damaged);
      return [];
    }
    this.cache = { mtime, size, entries };
    return entries;
  }

  private write(update: (entries: LibraryEntry[]) => LibraryEntry[]): void {
    withStateLock(this.file, () => {
      this.cache = undefined;
      const current = this.read();
      const next = update(current);
      if (next !== current) writeJsonStateSync(this.file, next, { mode: 0o600 });
    });
    this.cache = undefined;
  }

  list(): LibraryEntry[] {
    return this.read();
  }

  get(id: string): LibraryEntry | undefined {
    return this.read().find((e) => e.id === id);
  }

  /**
   * Saves a component from a file: a new entry, or (with `id`) the next
   * version of that one, which only the file that first saved it may save,
   * from a copy of the latest version (`base`). The name must not be another entry's.
   */
  save(input: { id?: string; base?: number; name: string; width: number; height: number; objects: LayoutObject[]; images: Record<string, LibraryImage>; from: string }): LibraryEntry {
    const name = input.name.trim();
    if (!name || name.length > LIBRARY_MAX.name) throw new LibraryError(`A component's name is 1 to ${LIBRARY_MAX.name} characters`);
    if (!input.objects.length || countObjects(input.objects) > LIBRARY_MAX.objects) throw new LibraryError(`A component in the library holds 1 to ${LIBRARY_MAX.objects} objects`);
    const bytes = Object.values(input.images).reduce((n, i) => n + Math.floor(i.data.length * 3 / 4), 0);
    if (bytes > LIBRARY_MAX.imageBytes) throw new LibraryError(`A component's pictures can't add up to more than ${LIBRARY_MAX.imageBytes / 1024 / 1024} MB in the library`);
    // Always base a mutation on the latest file: a different worker or a
    // second library instance may have saved since this instance last read.
    let entry!: LibraryEntry;
    const size = (e: { images: Record<string, LibraryImage>; objects: LayoutObject[] }) => JSON.stringify(e.objects).length + Object.values(e.images).reduce((n, i) => n + i.data.length, 0);
    this.write((current) => {
      const entries = [...current];
      const was = input.id === undefined ? undefined : entries.find((e) => e.id === input.id);
      if (input.id !== undefined && !was) throw new LibraryError('That component is no longer in the library');
      if (was && was.owner !== input.from) throw new LibraryOwnerError(`Only ${was.owner}, where "${was.name}" was first saved to the library, can save new versions of it`);
      if (was && input.base !== was.version) throw new LibraryVersionError(`The library has version ${was.version} of "${was.name}", newer than this file's copy (${input.base ?? 'none'}): take it first, then save your changes on top`);
      if (entries.reduce((n, e) => n + (e === was ? 0 : size(e)), 0) + size(input) > LIBRARY_MAX.totalBytes) throw new LibraryError(`The library is full (${LIBRARY_MAX.totalBytes / 1024 / 1024} MB): take out components no longer needed first`);
      if (entries.some((e) => e !== was && e.name.toLowerCase() === name.toLowerCase())) throw new LibraryError(`The library already has a component named "${name}"`);
      if (!was && entries.length >= LIBRARY_MAX.components) throw new LibraryError(`The library holds at most ${LIBRARY_MAX.components} components`);
      entry = {
        id: was?.id ?? randomBytes(6).toString('hex'), name, width: input.width, height: input.height, objects: input.objects, images: input.images,
        version: (was?.version ?? 0) + 1, updated: new Date().toISOString(), from: input.from, owner: was?.owner ?? input.from, uses: [...new Set([...(was?.uses ?? []), input.from])],
      };
      if (was) entries[entries.indexOf(was)] = entry;
      else entries.push(entry);
      return entries;
    });
    return entry;
  }

  /** Notes that a file has placed the component. */
  use(id: string, database: string): void {
    this.write((entries) => {
      const e = entries.find((x) => x.id === id);
      return e && !e.uses.includes(database) ? entries.map((x) => x === e ? { ...x, uses: [...x.uses, database] } : x) : entries;
    });
  }

  /** Takes a component out of the library; files keep their own copies. */
  remove(id: string): boolean {
    let removed = false;
    this.write((entries) => {
      const kept = entries.filter((e) => e.id !== id);
      removed = kept.length !== entries.length;
      return removed ? kept : entries;
    });
    return removed;
  }
}

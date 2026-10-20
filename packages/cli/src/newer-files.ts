// Which hosted files a build would refuse because a newer Tabularius wrote them (packages/store/src/store-format.ts), read without
// opening the stores for write. Used by `tabularius doctor` and by `tabularius upgrade`, which will not put in place a version that
// cannot open the folder it serves.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storedFormat } from '../../store/src/index.ts';
import { decryptFileSync } from '../../server/src/encrypt.ts';

const PLAIN = /\.openhbam\.sqlite$/i;
const ENCRYPTED = /\.openhbam\.sqlite\.enc$/i;

export interface NewerFile { name: string; found: number | 'unreadable' }

/** The stores a folder holds, as named files: plain ones, and encrypted ones (which are read only with the key). */
export function hostedFiles(folder: string): { plain: string[]; encrypted: string[] } {
  let names: string[];
  try { names = readdirSync(folder).sort(); } catch { return { plain: [], encrypted: [] }; }
  const plain = names.filter((n) => PLAIN.test(n));
  // While the server runs with a key, an encrypted store also has a plaintext working file; that one is the newer.
  const encrypted = names.filter((n) => ENCRYPTED.test(n) && !plain.includes(n.replace(/\.enc$/i, '')));
  return { plain, encrypted };
}

/** The encrypted stores that cannot be looked into without the key (TABULARIUS_ENCRYPTION_KEY). */
export function encryptedUnchecked(folder: string, key = process.env.TABULARIUS_ENCRYPTION_KEY): string[] {
  return key ? [] : hostedFiles(folder).encrypted.map((n) => n.replace(ENCRYPTED, ''));
}

function formatOf(path: string): number | 'unreadable' | undefined {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 2000');
    return storedFormat(db);
  } catch { return undefined; /* damage and unreadable files are the file check's to report */ } finally {
    try { db?.close(); } catch { /* nothing more to do */ }
  }
}

/**
 * The hosted files in a folder whose format is above `reads` (the highest format the build that would open them reads).
 * Encrypted stores are decrypted to a private temporary copy to be looked into, which needs the key; without it they are
 * left out here and `encryptedUnchecked` names them.
 */
export function filesNewerThan(folder: string, reads: number, key = process.env.TABULARIUS_ENCRYPTION_KEY): NewerFile[] {
  const { plain, encrypted } = hostedFiles(folder);
  const out: NewerFile[] = [];
  for (const file of plain) {
    const found = formatOf(join(folder, file));
    if (found !== undefined && (found === 'unreadable' || found > reads)) out.push({ name: file.replace(PLAIN, ''), found });
  }
  if (key && encrypted.length) {
    const scratch = mkdtempSync(join(tmpdir(), 'tabularius-format-'));
    try {
      for (const file of encrypted) {
        const copy = join(scratch, 'store.sqlite');
        try { decryptFileSync(join(folder, file), copy, key); } catch { continue; /* wrong key or damage: the file check's to report */ }
        const found = formatOf(copy);
        for (const f of [copy, copy + '-wal', copy + '-shm']) rmSync(f, { force: true });
        if (found !== undefined && (found === 'unreadable' || found > reads)) out.push({ name: file.replace(ENCRYPTED, ''), found });
      }
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** The format a copy of Tabularius on disk reads, from its source; undefined for a build from before stores were numbered. */
export function formatReadBy(app: string): number | undefined {
  const file = join(app, 'packages', 'store', 'src', 'store-format.ts');
  if (!existsSync(file)) return undefined;
  const m = /export const STORE_FORMAT = (\d+);/.exec(readFileSync(file, 'utf8'));
  return m ? Number(m[1]) : undefined;
}

const formatsOf = (files: NewerFile[]): string => {
  const numbers = files.flatMap((f) => (typeof f.found === 'number' ? [f.found] : []));
  return numbers.length ? `format ${Math.max(...numbers)}` : 'a format it cannot read';
};

/** The sentence that says an install would leave files closed, or undefined when it can open them all. */
export function refusalFor(app: string, folder: string): string | undefined {
  const reads = formatReadBy(app);
  if (reads === undefined) return undefined;
  const newer = filesNewerThan(folder, reads);
  if (!newer.length) return undefined;
  const names = newer.map((f) => f.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? 'was' : 'were'} written by a newer Tabularius than the version being installed (it reads file format ${reads}; ${names.length === 1 ? 'the file is' : 'they are'} in ${formatsOf(newer)}), so it would leave ${names.length === 1 ? 'it' : 'them'} closed. Put back a backup made before the newer version first opened ${names.length === 1 ? 'it' : 'them'}, or install the newer version`;
}

/**
 * After an automatic put-back: the sentence (starting with ". ") naming the files the version that failed to start had
 * already moved to a format the restored one does not read, and what to do about them; "" when there are none.
 */
export function closedBy(app: string, folder: string, backup?: string): string {
  const reads = formatReadBy(app);
  if (reads === undefined) return '';
  const newer = filesNewerThan(folder, reads);
  if (!newer.length) return '';
  const names = newer.map((f) => f.name).join(', ');
  const restore = backup
    ? `stop the service and run: tabularius restore ${folder} ${basename(backup)} (the backup taken just before the upgrade; what was written since is not in it)`
    : `stop the service and restore a backup made before the upgrade: tabularius restore ${folder} <backup-set>`;
  return `. The new version had already changed ${names} to a format that the version put back (file format ${reads}) does not read, so ${newer.length === 1 ? 'it stays' : 'they stay'} closed until you ${restore}`;
}

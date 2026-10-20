import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { basename, join, win32 } from 'node:path';
import { readBackupInfo } from './backup-info.ts';
import { STORE_EXT } from './host.ts';
import { ENCRYPTED_EXT } from './encrypt.ts';

/** The manifest is the inventory; directory contents only locate its copies. */
export function backupInventory(setDir: string, allowLegacy = false): { copies: string[]; problems: Record<string, string> } {
  const info = readBackupInfo<{ finished?: Record<string, string>; sha256?: Record<string, string> }>(setDir, allowLegacy);
  const present = readdirSync(setDir).filter((f) => f.endsWith(STORE_EXT) || f.endsWith(STORE_EXT + ENCRYPTED_EXT));
  const plain = (f: string) => f.endsWith(ENCRYPTED_EXT) ? f.slice(0, -ENCRYPTED_EXT.length) : f;
  const expected = new Set<string>();
  let recorded = false;
  for (const field of ['finished', 'sha256'] as const) {
    if (info[field] === undefined) continue;
    const entries = info[field];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`invalid ${field} inventory in backup.json`);
    recorded = true;
    for (const name of Object.keys(entries)) {
      if (basename(name) !== name || win32.basename(name) !== name || name.includes(':') || name.includes('\0') || !name.endsWith(STORE_EXT)) {
        throw new Error(`invalid database name in backup.json: ${name}`);
      }
      expected.add(name);
    }
  }
  const problems: Record<string, string> = {};
  if (!recorded) {
    if (!allowLegacy || !present.length) problems['backup.json'] = 'missing database inventory';
    for (const f of present) expected.add(plain(f));
  }
  for (const f of present) if (!expected.has(plain(f))) problems[plain(f)] = 'not listed in the database inventory';
  const copies = [...expected].map((file) => {
    const hasPlain = existsSync(join(setDir, file));
    const hasEncrypted = existsSync(join(setDir, file + ENCRYPTED_EXT));
    if (!hasPlain && !hasEncrypted) problems[file] = 'missing database copy';
    else if (hasPlain && hasEncrypted) problems[file] = 'multiple database copies';
    else {
      // What is read back has to be an ordinary file: a link could point anywhere, and a set someone else can write to can hold one.
      const kind = lstatSync(join(setDir, hasPlain ? file : file + ENCRYPTED_EXT));
      if (!kind.isFile()) problems[file] = `not an ordinary file (a ${kind.isSymbolicLink() ? 'symbolic link' : 'directory or special file'}), so it is not restored`;
    }
    if (info.sha256 && !info.sha256[file]) problems[file] ??= 'missing checksum in backup.json';
    return hasPlain ? file : file + ENCRYPTED_EXT;
  });
  return { copies, problems };
}

/** The copies of a set, refusing one with any problem; with `only` (a file's name), just that file's copy has to check out, which is how what is left of a damaged set is restored by naming it. */
export function checkedBackupCopies(setDir: string, only?: string): string[] {
  const inventory = backupInventory(setDir, true);
  const mine = (name: string) => !only || name === 'backup.json' || name.toLowerCase() === only.toLowerCase();
  const errors = Object.entries(inventory.problems).filter(([name]) => mine(name));
  if (errors.length) throw new Error(errors.map(([file, problem]) => `${file}: ${problem}`).join('; '));
  return inventory.copies;
}

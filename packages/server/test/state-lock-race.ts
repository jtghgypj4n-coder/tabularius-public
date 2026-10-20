import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Delete from a second store after the edit's lookup, immediately before its lock acquisition. */
export function deleteBeforeStateLock(file: string, remove: () => void, edit: () => void): void {
  // SQLite reports the resolved path (/private/var/... on macOS).
  const lock = join(realpathSync(dirname(file)), `${basename(file)}.lock.db`);
  const exec = DatabaseSync.prototype.exec;
  let deleted = false;
  DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string) {
    if (!deleted && sql.startsWith('BEGIN') && this.location() === lock) {
      deleted = true;
      remove();
    }
    return exec.call(this, sql);
  };
  try {
    edit();
    if (!deleted) throw new Error('The edit never acquired its state lock');
  } finally {
    DatabaseSync.prototype.exec = exec;
  }
}

// The version of the file layout a store is written in. A build opens any store at or below its own STORE_FORMAT
// (older ones are brought up to date in place) and refuses one above it: the file was written by a newer Tabularius,
// and an older build changing it could damage what the newer one added. docs/upgrading.md is the promise made to people.
//
// Raise STORE_FORMAT only for a change an older build cannot read or would damage: a column that changes meaning,
// a table an older build would write into wrongly, a removed or renamed table. Adding a table, a column or a setting
// is not one; builds that do not know it leave it alone. packages/store/test/store-format.test.ts holds the rules.

import type { DatabaseSync } from 'node:sqlite';

export const STORE_FORMAT = 1;

/** Thrown when a store was written by a newer Tabularius than this one. */
export class StoreFormatError extends Error {
  readonly store: string;
  readonly found: number | 'unreadable';
  constructor(store: string, found: number | 'unreadable') {
    super(found === 'unreadable'
      ? `${store} was written by a newer Tabularius (a file format number this version cannot read; this version reads up to format ${STORE_FORMAT}), so it is not opened. Update Tabularius to open it, or put back a backup made before the newer version first opened it`
      : `${store} was written by a newer Tabularius (file format ${found}; this version reads up to format ${STORE_FORMAT}), so it is not opened. Update Tabularius to open it, or put back a backup made before the newer version first opened it`);
    this.name = 'StoreFormatError';
    this.store = store;
    this.found = found;
  }
}

/**
 * The format a store says it is in; 0 for one made before the number was kept, 'unreadable' for a number that is
 * there but is not a whole number (only a build that writes it some other way does that, so it counts as newer).
 */
export function storedFormat(sql: DatabaseSync): number | 'unreadable' {
  const row = sql.prepare("SELECT json FROM _fm_meta WHERE key = 'storeFormat'").get() as { json: string } | undefined;
  if (!row) return 0;
  let n: unknown;
  try { n = JSON.parse(row.json); } catch { return 'unreadable'; }
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 'unreadable';
}

/** Throws if a store was written by a newer Tabularius. Writes nothing, so everything that opens a store for any reason calls it first. */
export function refuseNewer(sql: DatabaseSync, store: string): number {
  const found = storedFormat(sql);
  if (found === 'unreadable' || found > STORE_FORMAT) throw new StoreFormatError(store, found);
  return found;
}

/** Refuses a newer store; otherwise records this build's format in it. Call before anything else changes the file. */
export function checkFormat(sql: DatabaseSync, store: string): void {
  if (refuseNewer(sql, store) === STORE_FORMAT) return;
  try {
    sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(STORE_FORMAT));
  } catch {
    // A copy that cannot be written (read-only, or the disk is full) is used as it is; the next writable open records it.
  }
}

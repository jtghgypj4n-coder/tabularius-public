// Results worked out from a hosted file's data (whole-table summaries,
// ExecuteSQL results, the values of unstored calculations that depend only on
// the data), kept in a small SQLite file beside the store so that every
// process of a server (--workers) and the background warmer share them: each
// is worked out once per server, not once per process.
//
// Each result carries the data version it was worked out at (Store.dataStamp,
// a counter every change to a record moves, whichever process makes it).
// A result at an older version is stale: a layout read may show it while the
// warmer works out the new one, but nothing else uses it.
//
// Best effort: when the file is busy or unwritable, results are simply not
// shared. It holds no data that isn't derived from the store, and is left out
// when the store is encrypted at rest.

import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** Results kept, across every key; the least recently written go first. */
const MAX_ROWS = 50_000;
/** The largest result kept, in characters. */
const MAX_VALUE = 4 * 2 ** 20;

export class ResultCache {
  private readonly db: DatabaseSync;
  private puts = 0;

  /** `pending`: whether the store's connection is inside a transaction, when nothing it worked out is shared yet. */
  private readonly pending: () => boolean;
  /** Who this cache is, in claims (each process and the warmer thread has its own). */
  private readonly owner = randomUUID();

  constructor(path: string, pending: () => boolean = () => false) {
    this.pending = pending;
    // Holds values worked out from the data: readable by the server's own user only.
    if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600));
    else {
      try {
        chmodSync(path, 0o600); // one made before this was kept private
      } catch {
        // not ours to change: left as it is
      }
    }
    this.db = new DatabaseSync(path);
    // Losing the last results in a power cut costs only working them out again.
    this.db.exec('PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF');
    this.db.exec('CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, stamp TEXT NOT NULL, value TEXT NOT NULL, at INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, owner TEXT NOT NULL, until INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS writes (account TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  }

  /** Notes that `account` ('' for none) changed the file just now, in whichever process (see lastWrite). */
  wrote(account: string, at: number): void {
    try {
      this.db.prepare('INSERT OR REPLACE INTO writes (account, at) VALUES (?, ?)').run(account, at);
    } catch {
      // busy: this process still remembers it
    }
  }

  /** When `account` last changed the file, from any process of the server. */
  lastWrite(account: string): number | undefined {
    try {
      return (this.db.prepare('SELECT at FROM writes WHERE account = ?').get(account) as { at: number } | undefined)?.at;
    } catch {
      return undefined;
    }
  }

  /** The result kept for `key`, the data version it was worked out at, and when (Date.now()) it was worked out. */
  get(key: string): { stamp: string; value: string; at: number } | undefined {
    try {
      return this.db.prepare('SELECT stamp, value, at FROM results WHERE key = ?').get(key) as { stamp: string; value: string; at: number } | undefined;
    } catch {
      return undefined;
    }
  }

  /** `at`: when the result was first worked out, kept by a delta that brings an older one up to `stamp`. */
  put(key: string, stamp: string, value: string, at = Date.now()): void {
    // Only at a shared data version (a per-connection token means nothing to another process), and not huge:
    // every change to a record re-reads and rewrites the summaries it moves.
    if (this.pending() || !stamp.includes('/v') || value.length > MAX_VALUE) return;
    try {
      this.db.prepare('INSERT OR REPLACE INTO results (key, stamp, value, at) VALUES (?, ?, ?, ?)').run(key, stamp, value, at);
      if (++this.puts % 256 === 0) {
        this.db.exec(`DELETE FROM results WHERE key IN (SELECT key FROM results ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ${MAX_ROWS})`);
      }
    } catch {
      // busy or read-only: not shared this time
    }
  }

  /**
   * Claims working out `key` for `ms`, so the server's other processes wait
   * for this one's result instead of each working it out at the same time.
   * False when another holds the claim; true too when claims can't be kept.
   */
  claim(key: string, ms: number): boolean {
    // Work inside a transaction is never shared (see put): nobody waits for it.
    if (this.pending()) return true;
    return this.renew(key, ms);
  }

  /** Takes or extends a claim whatever the store's connection is doing (a holder keeps its claim through its own read). */
  renew(key: string, ms: number): boolean {
    try {
      const now = Date.now();
      const { changes } = this.db
        .prepare('INSERT INTO claims (key, owner, until) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET owner = excluded.owner, until = excluded.until WHERE claims.until < ? OR claims.owner = excluded.owner')
        .run(key, this.owner, now + ms, now);
      return Number(changes) > 0;
    } catch {
      return true;
    }
  }

  /** Whether someone (this cache included) holds a claim on `key`. */
  claimed(key: string): boolean {
    try {
      return !!this.db.prepare('SELECT 1 FROM claims WHERE key = ? AND until >= ?').get(key, Date.now());
    } catch {
      return false;
    }
  }

  /** Gives up this cache's claim on `key` (worked out, or failed). */
  release(key: string): void {
    try {
      this.db.prepare('DELETE FROM claims WHERE key = ? AND owner = ?').run(key, this.owner);
    } catch {
      // busy: the claim runs out on its own
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

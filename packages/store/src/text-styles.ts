// Formatting kept with text data: the fonts, sizes, colors and styles someone gave parts of a text field's value in
// Browse mode (FileMaker's Format menu), which FileMaker stores with the data so it shows in every layout. Kept beside
// the record, with a hash of the text it was made for: when the text has changed some other way (a script, an import,
// another program writing the database), the formatting no longer fits and is left out. A repeating field keeps each
// repetition's formatting apart, with the hash of that repetition's text.

import { PreparedCache } from './preparation.ts';
import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { tidyRuns, type StyleRun } from '../../calc/src/index.ts';

const TABLE = '_fm_text_styles';
/** How long the list of tables with formatting is trusted before being read again (another process may have added some). */
const RECHECK_MS = 2000;

const COLUMNS = `tbl INTEGER NOT NULL, record_id INTEGER NOT NULL, field INTEGER NOT NULL, rep INTEGER NOT NULL DEFAULT 1,
    hash TEXT NOT NULL, runs TEXT NOT NULL, PRIMARY KEY (tbl, record_id, field, rep)`;

export function ensureTextStyles(sql: DatabaseSync): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (${COLUMNS}) WITHOUT ROWID`);
  // Made before repetitions kept formatting: the key gains the repetition, so the table is copied into a new one.
  if ((sql.prepare(`PRAGMA table_info(${TABLE})`).all() as { name: string }[]).some((c) => c.name === 'rep')) return;
  const outer = !sql.isTransaction;
  if (outer) sql.exec('BEGIN IMMEDIATE');
  try {
    if (!(sql.prepare(`PRAGMA table_info(${TABLE})`).all() as { name: string }[]).some((c) => c.name === 'rep')) {
      sql.exec(`CREATE TABLE ${TABLE}_new (${COLUMNS}) WITHOUT ROWID;
        INSERT INTO ${TABLE}_new (tbl, record_id, field, rep, hash, runs) SELECT tbl, record_id, field, 1, hash, runs FROM ${TABLE};
        DROP TABLE ${TABLE}; ALTER TABLE ${TABLE}_new RENAME TO ${TABLE}`);
    }
    if (outer) sql.exec('COMMIT');
  } catch (e) {
    if (outer && sql.isTransaction) sql.exec('ROLLBACK');
    throw e;
  }
}

/**
 * The text of one repetition of a text field's stored value: a repeating field holds its repetitions as a JSON list.
 * Undefined when the value isn't text.
 */
export function repetitionText(raw: unknown, repetitions: number, rep: number): string | undefined {
  if (repetitions <= 1) return rep === 1 && typeof raw === 'string' ? raw : undefined;
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw !== 'string') return undefined;
  if (!raw.startsWith('[')) return rep === 1 ? raw : '';
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    // Not a list after all: text that happens to start with "[".
  }
  if (!Array.isArray(list)) return rep === 1 ? raw : '';
  const v = list[rep - 1];
  return v === undefined || v === null ? '' : typeof v === 'string' ? v : undefined;
}

/** Formatting kept for one repetition of a field (1 for a field without repetitions). */
export type KeptRuns = { field: number; rep: number; runs: StyleRun[] };

const textHash = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 22);

export class TextStyles {
  private readonly tables = new PreparedCache<{ at: number; ids: Set<number> } | undefined>(undefined, (value) => value && { at: value.at, ids: new Set(value.ids) });
  private readonly statements = new Map<string, StatementSync>();
  private readonly sql: DatabaseSync;
  constructor(sql: DatabaseSync) {
    this.sql = sql;
  }

  private st(text: string): StatementSync {
    let s = this.statements.get(text);
    if (!s) this.statements.set(text, (s = this.sql.prepare(text)));
    return s;
  }

  /** Whether any record of the table has formatting: most have none, and their records are read without looking. */
  has(table: number): boolean {
    const now = performance.now();
    if (!this.tables.value || now - this.tables.value.at > RECHECK_MS) {
      this.tables.value = { at: now, ids: new Set((this.st(`SELECT DISTINCT tbl FROM ${TABLE}`).all() as { tbl: number }[]).map((r) => Number(r.tbl))) };
    }
    return this.tables.value.ids.has(table);
  }

  /** A table's formatting by record, read at once (a find or sort through a calculation reads many records), trusted as long as the table list. */
  private readonly byRecord = new PreparedCache(new Map<number, { at: number; rows: Map<number, { field: number; rep: number; hash: string; runs: string }[]> }>(), (value) => new Map(value));

  private rows(table: number): Map<number, { field: number; rep: number; hash: string; runs: string }[]> {
    const now = performance.now();
    const cached = this.byRecord.value.get(table);
    if (cached && now - cached.at <= RECHECK_MS) return cached.rows;
    const rows = new Map<number, { field: number; rep: number; hash: string; runs: string }[]>();
    for (const r of this.st(`SELECT record_id, field, rep, hash, runs FROM ${TABLE} WHERE tbl = ?`).all(table) as { record_id: number; field: number; rep: number; hash: string; runs: string }[]) {
      const id = Number(r.record_id);
      if (!rows.has(id)) rows.set(id, []);
      rows.get(id)!.push({ field: Number(r.field), rep: Number(r.rep), hash: r.hash, runs: r.runs });
    }
    this.byRecord.value.set(table, { at: now, rows });
    return rows;
  }

  /**
   * The formatting of a record's fields and their repetitions, where it still fits the text they hold (`text` of
   * each repetition; undefined leaves it out).
   */
  read(table: number, recordId: number, text: (field: number, rep: number) => string | undefined): KeptRuns[] | undefined {
    if (!this.has(table)) return undefined;
    let out: KeptRuns[] | undefined;
    for (const r of this.rows(table).get(recordId) ?? []) {
      const value = text(r.field, r.rep);
      if (value === undefined || textHash(value) !== r.hash) continue;
      let runs: StyleRun[];
      try {
        runs = tidyRuns(JSON.parse(r.runs) as StyleRun[], value.length);
      } catch {
        continue; // unreadable: the text shows plain rather than the record not at all
      }
      if (runs.length) (out ??= []).push({ field: r.field, rep: r.rep, runs });
    }
    return out;
  }

  /** Forgets what was read (after a rollback). */
  reset(): void {
    this.byRecord.value.clear();
    this.tables.value = undefined;
  }

  /** Forgets a record's formatting (deleted, or its id given to a new record), or a whole table's. */
  forget(table: number, recordId?: number): void {
    if (!this.has(table)) return;
    this.byRecord.value.delete(table);
    if (recordId === undefined) this.st(`DELETE FROM ${TABLE} WHERE tbl = ?`).run(table);
    else this.st(`DELETE FROM ${TABLE} WHERE tbl = ? AND record_id = ?`).run(table, recordId);
  }

  /** Sets a field's (or one repetition's) formatting for the text it now holds; none removes it. */
  write(table: number, recordId: number, field: number, text: string, runs: readonly StyleRun[] | undefined, rep = 1): void {
    const tidy = runs ? tidyRuns(runs, text.length) : [];
    this.byRecord.value.delete(table);
    if (!tidy.length) {
      this.st(`DELETE FROM ${TABLE} WHERE tbl = ? AND record_id = ? AND field = ? AND rep = ?`).run(table, recordId, field, rep);
      return;
    }
    this.st(`INSERT OR REPLACE INTO ${TABLE} (tbl, record_id, field, rep, hash, runs) VALUES (?, ?, ?, ?, ?, ?)`).run(table, recordId, field, rep, textHash(text), JSON.stringify(tidy));
    this.tables.value?.ids.add(table);
  }
}

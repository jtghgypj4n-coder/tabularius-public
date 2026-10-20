// Word indexes, like FileMaker's field indexes: finds on text ("smi" finds a
// word starting with smi) read the index instead of every record.
//
// Each base table gets a full-text table (SQLite FTS5) over its stored text
// fields, kept current by triggers, so every write updates it, whichever
// connection or process makes it. Indexes are built the first time they are
// needed and dropped when the design changes (a trigger naming a column would
// block dropping or retyping it); the next find builds them again.
//
// A find uses the index to narrow the records, then still applies its exact
// rule, so results are the same as without it: the index only ever matches
// more (it splits words at punctuation too). What goes into the index is the
// text as a find compares it (fm_fold: case, accents, ligatures and
// full-width letters folded), not the stored text, so a word the find rule
// would match is never missing from the index.

import { PreparedCache } from './preparation.ts';
import { FOLD_VERSION, foldText } from '../../calc/src/collation.ts';
import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Table } from '../../fmp12/src/index.ts';
import { q } from './import.ts';

const PREFIX = '_fm_words_';
/** The SQL function the index text goes through (registered by the store): a find's own folding of text. */
const FOLD = 'fm_fold(';
/** Written into the insert trigger, so an index of text folded another way is found out and built again. */
const FOLD_MARK = `/* fold ${FOLD_VERSION} */`;
/** FTS5 reserves these as column names. */
const RESERVED = new Set(['rank', 'rowid']);

/** By table id: a name could collide with another index's own tables ("<index>_data"). */
export const wordIndexName = (table: Table) => PREFIX + table.id;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Defines the SQL function the index triggers call, on a connection to a file that has word indexes. Every connection that
 * can write a table's records needs it (a statement that fires the trigger cannot even be prepared without it): the store's
 * own, and any other code that opens the file to change records.
 */
export function defineFold(db: DatabaseSync): void {
  db.function('fm_fold', { deterministic: true }, (v) => (typeof v === 'string' ? foldText(v) : v));
}

/** Fields a table's index covers: text people typed or calculations stored, by column. */
export function indexedFields(table: Table, columns: Set<string>): string[] {
  const name = wordIndexName(table).toLowerCase();
  return table.fields
    .filter((f) => f.type === 'text' && f.kind !== 'summary' && !f.options?.global && !(f.kind === 'calculation' && f.options?.unstored))
    .map((f) => f.name)
    .filter((n) => columns.has(n) && !RESERVED.has(n.toLowerCase()) && n.toLowerCase() !== name);
}

export class WordIndexes {
  private readonly sql: DatabaseSync;
  /** Tables whose index was checked against their fields: table -> indexed fields. */
  private readonly ready = new PreparedCache(new Map<string, Set<string>>(), (value) => new Map(value));
  private exists?: StatementSync;
  /** Off: finds read every record (to compare, or rule the index out). */
  enabled = true;

  constructor(sql: DatabaseSync) {
    this.sql = sql;
  }

  /** Forget what was checked (the design changed). */
  reset(): void {
    this.ready.value.clear();
  }

  /**
   * The table's indexed fields, building or rebuilding its index when it is
   * missing or covers other fields than the table now has.
   */
  ensure(table: Table): Set<string> {
    const name = wordIndexName(table);
    this.exists ??= this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const known = this.ready.value.get(table.name);
    // Another process may have dropped it (a design change there).
    if (known && this.exists.get(name)) return known;
    const columns = new Set((this.sql.prepare(`PRAGMA table_info(${q(table.name)})`).all() as { name: string }[]).map((c) => c.name));
    const fields = indexedFields(table, columns);
    const covers = () => {
      const have = this.exists!.get(name)
        ? (this.sql.prepare(`PRAGMA table_info(${q(name)})`).all() as { name: string }[]).map((c) => c.name)
        : undefined;
      // An index built before it held folded text has triggers that name no fold: build it again.
      const folded = !!have && (this.sql.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('trigger', `${name}_ai`) as { sql: string } | undefined)?.sql.includes(FOLD_MARK);
      return { have, ok: !!have && folded && have.join('\0') === fields.join('\0') };
    };
    const { have, ok } = covers();
    if (!ok) {
      if (have) this.drop(name);
      try {
        if (fields.length) this.build(table.name, name, fields);
      } catch (e) {
        // Another process sharing the file built the same index first.
        if (!covers().ok) throw e;
      }
    }
    const set = new Set(fields);
    this.ready.value.set(table.name, set);
    return set;
  }

  /**
   * Runs a statement over a word index again when SQLite says "database schema
   * has changed": another connection (a worker process) was building or
   * dropping an index just as this one opened it. The same statement works a
   * moment later, so a find or search no longer fails with an error.
   */
  retry<T>(run: () => T): T {
    for (let attempt = 1; ; attempt++) {
      try {
        return run();
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (attempt >= 5 || (e as { errcode?: number }).errcode !== 17) throw e;
      }
    }
  }

  private build(table: string, name: string, fields: string[]): void {
    const fts = q(name);
    const cols = fields.map(q).join(', ');
    const vals = (row: string) => fields.map((f) => `${FOLD}${row}.${q(f)})`).join(', ');
    const trigger = (suffix: string) => q(`${name}_${suffix}`);
    this.sql.exec('SAVEPOINT words');
    try {
      this.sql.exec(`CREATE VIRTUAL TABLE ${fts} USING fts5(${cols}, content=${lit(table)}, content_rowid='_fm_record_id', tokenize='unicode61 remove_diacritics 2')`);
      // 'rebuild' would read the stored text, not the folded text the triggers put in.
      this.sql.exec(`INSERT INTO ${fts}(rowid, ${cols}) SELECT _fm_record_id, ${fields.map((f) => `${FOLD}${q(f)})`).join(', ')} FROM ${q(table)}`);
      this.sql.exec(`CREATE TRIGGER ${trigger('ai')} AFTER INSERT ON ${q(table)} BEGIN ${FOLD_MARK}
        INSERT INTO ${fts}(rowid, ${cols}) VALUES (new._fm_record_id, ${vals('new')}); END`);
      this.sql.exec(`CREATE TRIGGER ${trigger('ad')} AFTER DELETE ON ${q(table)} BEGIN
        INSERT INTO ${fts}(${fts}, rowid, ${cols}) VALUES ('delete', old._fm_record_id, ${vals('old')}); END`);
      this.sql.exec(`CREATE TRIGGER ${trigger('au')} AFTER UPDATE OF ${cols} ON ${q(table)} BEGIN
        INSERT INTO ${fts}(${fts}, rowid, ${cols}) VALUES ('delete', old._fm_record_id, ${vals('old')});
        INSERT INTO ${fts}(rowid, ${cols}) VALUES (new._fm_record_id, ${vals('new')}); END`);
      this.sql.exec('RELEASE words');
    } catch (e) {
      this.sql.exec('ROLLBACK TO words; RELEASE words');
      throw e;
    }
  }

  private drop(name: string): void {
    for (const s of ['ai', 'ad', 'au']) this.sql.exec(`DROP TRIGGER IF EXISTS ${q(`${name}_${s}`)}`);
    this.sql.exec(`DROP TABLE IF EXISTS ${q(name)}`);
  }

  /** Drops every word index (before a design change; finds rebuild them). */
  dropAll(): void {
    const names = (this.sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, ${PREFIX.length}) = '${PREFIX}' AND sql LIKE 'CREATE VIRTUAL TABLE%'`).all() as { name: string }[]).map((r) => r.name);
    for (const n of names) this.drop(n);
    this.ready.value.clear();
  }
}

/**
 * An FTS5 query for a find's text, as a phrase (prefix on its last word unless
 * `exact`); undefined when the index can't narrow it safely: wildcards, or no
 * letters or digits the tokenizer surely treats as word characters. The text is
 * given folded the way the index text is (foldText).
 */
export function wordQuery(text: string, exact: boolean): string | undefined {
  if (/[*@]/.test(text) || !/[0-9A-Za-zÀ-ɏ]/.test(text)) return undefined;
  return `"${text.replace(/"/g, '""')}"${exact ? '' : '*'}`;
}

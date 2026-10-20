// Joins a $crossjoin's records off the request path (odata-crossjoin.ts): the
// sets' records come in as rows, the part of $filter that spans sets keeps the
// combinations, and $orderby, $skip, $top and $count are answered from them.
// It runs in a child process of its own, so that a costly filter or sort is
// killed at the time limit, wherever it is in SQLite, and its memory goes
// with it, without ever holding up the server's other clients.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { decimalKey } from '../../store/src/native-types.ts';

export interface JoinTable { columns: { name: string; type: string }[]; rows: SQLInputValue[][] }
export interface JoinJob {
  tables: JoinTable[];
  where?: string;
  params: SQLInputValue[];
  /** ORDER BY terms: a column, its type and whether descending. */
  sort: { column: string; type: string; desc: boolean }[];
  limit: number;
  skip: number;
  count: boolean;
  /** When the join should have finished (Date.now() time); past it the join stops itself (the parent kills it later). */
  deadline: number;
}
export type JoinResult = { rows: number[][]; count?: number } | { refused: string };

const LATE = 'the $crossjoin deadline passed';
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function join(job: JoinJob): JoinResult {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA temp_store = MEMORY');
    db.function('fm_decimal_key', { deterministic: true }, (v) => decimalKey(v as string | number | null));
    db.function('deadline', { deterministic: false, varargs: true }, () => {
      if (Date.now() > job.deadline) throw new Error(LATE);
      return 1;
    });
    for (const [i, t] of job.tables.entries()) {
      db.exec(`CREATE TABLE t${i} (${t.columns.map((c, k) => `${q(c.name)} ${k === 0 ? 'INTEGER PRIMARY KEY' : c.type === 'number' ? '' : c.type === 'integer' || c.type === 'boolean' ? 'INTEGER' : 'TEXT'}`).join(', ')})`);
      const insert = db.prepare(`INSERT INTO t${i} VALUES (${t.columns.map(() => '?').join(', ')})`);
      db.exec('BEGIN');
      for (const r of t.rows) insert.run(...r);
      db.exec('COMMIT');
    }
    const ids = job.tables.map((_, i) => `t${i}_id`);
    db.exec(`CREATE TABLE r (${job.tables.map((_, i) => `i${i} INTEGER`).join(', ')})`);
    try {
      // deadline() takes each combination's ids, inside a CASE, so SQLite asks it once per combination, before the filter.
      db.prepare(`INSERT INTO r SELECT ${ids.join(', ')} FROM ${job.tables.map((_, i) => `t${i}`).join(', ')}
        WHERE CASE WHEN deadline(${ids.join(', ')}) THEN ${job.where ? `(${job.where})` : '1'} END`).run(...job.params);
    } catch (e) {
      if ((e as Error).message.includes(LATE)) return { refused: 'late' };
      if ((e as { code?: string }).code === 'ERR_SQLITE_ERROR' && /Expression tree is too large|too many SQL variables/.test((e as Error).message)) {
        return { refused: `$filter is too complex: ${(e as Error).message}` };
      }
      throw e;
    }
    const kept = job.count ? (db.prepare('SELECT count(*) AS n FROM r').get() as { n: number }).n : undefined;
    // Each sort property is ranked within its own set (at most one set's records, so its text is held once), and the
    // combinations are sorted by those ranks: the big sort holds only whole numbers. Numbers sort as the set's own
    // $orderby sorts them: read as numbers, empty ones last.
    const keys = job.sort.map((s, k) => {
      const table = job.tables.findIndex((t) => t.columns.some((c) => c.name === s.column));
      const col = q(s.column);
      const dir = s.desc ? 'DESC' : 'ASC';
      const by = s.type === 'number' ? `(${col} IS NULL OR ${col} = '') ASC, CAST(${col} AS REAL) ${dir}`
        : s.type === 'decimal' ? `(${col} IS NULL OR ${col} = '') ASC, fm_decimal_key(${col}) ${dir}`
          : `${col}${s.type === 'text' ? ' COLLATE NOCASE' : ''} ${dir}`;
      db.exec(`CREATE TABLE k${k} (id INTEGER PRIMARY KEY, rank INTEGER)`);
      db.exec(`INSERT INTO k${k} SELECT t${table}_id, dense_rank() OVER (ORDER BY ${by}) FROM t${table}`);
      return { k, table };
    });
    const rows = db.prepare(`SELECT r.* FROM r ${keys.map(({ k, table }) => `JOIN k${k} ON k${k}.id = i${table}`).join(' ')}
      ORDER BY ${[...keys.map(({ k }) => `k${k}.rank`), ...job.tables.map((_, i) => `i${i}`)].join(', ')} LIMIT ? OFFSET ?`)
      .all(job.limit, job.skip) as Record<string, number>[];
    return { rows: rows.map((r) => job.tables.map((_, i) => r[`i${i}`])), count: kept };
  } finally {
    db.close();
  }
}

if (process.send) {
  process.once('message', (job: JoinJob) => {
    let answer: JoinResult;
    try {
      answer = join(job);
    } catch (e) {
      answer = { refused: `$crossjoin could not be worked out: ${(e as Error).message}` };
    }
    process.send!(answer, () => process.exit(0));
  });
}

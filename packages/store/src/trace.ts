// TABULARIUS_TRACE_SQL=1 (or true, yes, on): each SQL statement a store runs is logged to stderr
// with its shape, the rows it returned and how long it took, so a slow or
// memory-hungry request on a real file can be pinned to one statement without
// showing any of the file's data. The shape keeps SQL keywords and
// punctuation only: every table, column and alias reads "x", every value "?".
//
//   [sql] 812.4 ms  270534 rows  all      SELECT * FROM x WHERE x IN (?) ORDER BY x  <- relatedIds < firstRelated < field
//
// The functions of Tabularius's own code that ran it follow the arrow (names
// from our source, never from the file), so a slow statement leads to the
// code that issued it.
//
// TABULARIUS_TRACE_SQL_MIN_MS=N logs only statements that took N ms or more.
//
// Fields a layout read works out (unstored calculations, summaries) are
// logged the same way, by table and field id with what the formula uses
// (related fields, SQL, custom functions...) and the statements it ran, never
// a name or a value:
//
//   [field]  3801.2 ms  calc t12.f40 related 3 sql 1 cf 0 agg 2 stable  412 statements

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { boolean } from './settings.ts';

const KEYWORDS = new Set(`
  select from where and or not in is null as on join cross left inner outer distinct order by group having limit offset
  asc desc insert into values update set delete create drop table index if exists temp temporary view trigger begin commit
  rollback savepoint release pragma union all exists case when then else end collate nocase cast real integer text blob
  like glob between count sum min max avg total json_each json_extract value primary key default returning conflict do
  nothing replace instr char length substr lower upper coalesce ifnull with recursive
`.trim().split(/\s+/));

/** A statement's shape: keywords and punctuation, with every name "x" and every value "?". */
export function sqlShape(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/"(?:[^"]|"")*"/g, 'x')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) => (KEYWORDS.has(w.toLowerCase()) ? w.toUpperCase() : 'x'))
    .replace(/\s+/g, ' ')
    .trim();
}

function minMs(): number {
  const n = Number(process.env.TABULARIUS_TRACE_SQL_MIN_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

let tracedFor: string | undefined;
let traced = false;

/** Whether statements are traced (TABULARIUS_TRACE_SQL is 1, true, yes or on; false, off, no, 0 and empty turn it off, anything else is an error). */
export function tracing(): boolean {
  const v = process.env.TABULARIUS_TRACE_SQL;
  if (v !== tracedFor) {
    traced = boolean('TABULARIUS_TRACE_SQL');
    tracedFor = v;
  }
  return traced;
}

/** The nearest functions of Tabularius's code on the stack, innermost first. */
function callers(): string {
  const names: string[] = [];
  for (const line of (new Error().stack ?? '').split('\n').slice(1)) {
    const m = /at (?:(?:new )?([\w$.<>]+) )?\(?(?:file:\/\/)?([^():]+)/.exec(line.trim());
    if (!m || !/\/packages\/[\w-]+\/src\//.test(m[2]) || /\/trace\.ts$/.test(m[2])) continue;
    names.push((m[1] ?? '(anonymous)').replace(/^.*\./, ''));
    if (names.length === 4) break;
  }
  return names.join(' < ');
}

function log(how: string, sql: string, rows: number | undefined, ms: number, from: string): void {
  if (ms < minMs()) return;
  process.stderr.write(`[sql] ${ms.toFixed(1).padStart(8)} ms  ${rows === undefined ? '' : `${rows} rows`.padStart(10)}  ${how.padEnd(7)}  ${sqlShape(sql)}${from ? `  <- ${from}` : ''}\n`);
}

/** Prepared statement executions so far when tracing or TABULARIUS_COUNT_SQL=1 is enabled. */
export let statements = 0;
/** Rows changed by measured SQLite run calls. Enable with TABULARIUS_COUNT_SQL=1 before opening a store. */
export let rowsWritten = 0;

/** Logs a note about kept results (why one was worked out again), whatever the time. */
export function traceNote(what: string): void {
  process.stderr.write(`[sum] ${what}\n`);
}

/** Logs one field a read worked out (see the top of this file), when it took the minimum or more. */
export function traceField(ms: number, what: string, ran: number): void {
  if (ms < minMs()) return;
  process.stderr.write(`[field] ${ms.toFixed(1).padStart(8)} ms  ${what}  ${ran} statements\n`);
}

/** What a formula uses, as counts: no names. */
export function formulaShape(formula: string, customFunctions: string[]): string {
  const n = (re: RegExp) => (formula.match(re) ?? []).length;
  const cf = customFunctions.filter((c) => new RegExp(`(?<![\\p{L}\\p{N}_])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'iu').test(formula)).length;
  return `related ${n(/::/g)} sql ${n(/executesql\s*\(/gi)} cf ${cf} agg ${n(/\b(?:sum|count|list|max|min|average|stdev|stdevp|variance)\s*\(/gi)} get ${n(/\bget\s*\(/gi)} len ${formula.length}`;
}

function traceStatement(st: StatementSync, sql: string, traced: boolean): StatementSync {
  return new Proxy(st, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      if (prop === 'all' || prop === 'get' || prop === 'run') {
        return (...args: unknown[]) => {
          statements++;
          const t0 = performance.now();
          const out = (v as (...a: unknown[]) => unknown).apply(target, args);
          const rows = prop === 'all' ? (out as unknown[]).length : prop === 'get' ? (out === undefined ? 0 : 1) : Number((out as { changes?: number | bigint })?.changes ?? 0);
          if (prop === 'run') rowsWritten += rows;
          const ms = performance.now() - t0;
          if (traced && ms >= minMs()) log(String(prop), sql, rows, ms, callers());
          return out;
        };
      }
      if (prop === 'iterate') {
        // Timed from the first row to the last, so it includes the reader's own work between rows.
        return function* (...args: unknown[]) {
          statements++;
          const from = traced ? callers() : '';
          const t0 = performance.now();
          let rows = 0;
          try {
            for (const row of (v as (...a: unknown[]) => Iterable<unknown>).apply(target, args)) {
              rows++;
              yield row;
            }
          } finally {
            if (traced) log('iterate', sql, rows, performance.now() - t0, from);
          }
        };
      }
      return (v as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** The database, traced or counted when requested; the database itself otherwise. */
export function traceDatabase(db: DatabaseSync): DatabaseSync {
  // Whether to log is decided once, when the database is opened, as before the counting mode was added.
  const traced = tracing();
  if (!traced && process.env.TABULARIUS_COUNT_SQL !== '1') return db;
  return new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      if (prop === 'prepare') return (sql: string) => traceStatement(target.prepare(sql), sql, traced);
      if (prop === 'exec') {
        return (sql: string) => {
          const t0 = performance.now();
          target.exec(sql);
          const ms = performance.now() - t0;
          if (traced && ms >= minMs()) log('exec', sql, undefined, ms, callers());
        };
      }
      return (v as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

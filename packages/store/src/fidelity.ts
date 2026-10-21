// Stored-calculation fidelity on a converted file: recompute stored
// calculations with Tabularius's engine and compare with the values FileMaker
// stored. Counts only: no record values, so it can run on private data.
// Read-only: everything runs inside a transaction that is rolled back (the
// engine may add an index to answer a relationship or ExecuteSQL), and no
// script runs.

import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import { compile, toStored, type Node, type Value } from '../../calc/src/index.ts';
import type { Field, Table } from '../../fmp12/src/index.ts';
import { fromStored } from '../../calc/src/index.ts';
import type { SqlValue } from './find.ts';
import { q } from './import.ts';
import { sqlTokens } from './sql-tokens.ts';
import type { Store } from './store.ts';

export interface FidelityTally {
  values: number;
  match: number;
  /** Both have a value, and they differ. */
  differ: number;
  /** FileMaker stored a value, Tabularius gives none. */
  missing: number;
  /** Tabularius gives a value where FileMaker stored none. */
  extra: number;
  /** Tabularius's formula fails ("?") where FileMaker stored a value. */
  error: number;
}

export interface FidelityReport {
  /** Stored calculations looked at (only those using ExecuteSQL with `sql`). */
  fields: number;
  skipped: { volatile: number; external: number };
  total: FidelityTally;
  /** By calculation function (a value counts under every function its formula uses). */
  functions: Record<string, FidelityTally>;
  /** ExecuteSQL formulas by the shape of their query: SQL keywords only, no names or values. */
  queries: { shape: string; fields: number; problem?: string; tally: FidelityTally; kinds: Record<string, number>; timing: Record<string, number> }[];
  /**
   * For ExecuteSQL values that don't match: did a record the query reads change after this record was last
   * saved? FileMaker doesn't recompute a stored calculation when other tables change, so then its stored
   * value is simply out of date. Told apart by the tables' modification timestamp fields.
   */
  timing: Record<string, number>;
  /**
   * "Do not evaluate if all referenced fields are empty": records whose referenced fields (stored, on the
   * record itself) are all empty, for formulas with the option on, by whether the formula calls a custom
   * function and whether FileMaker stored anything. Tells whether FileMaker evaluated them anyway.
   */
  emptyRule: Record<string, number>;
  /** What kind of difference each "differ" is: the same lines in another order, case or spacing, number formatting, or other. */
  kinds: Record<string, number>;
  /** Fields with any difference, numbered (no names), worst first. */
  worst: { field: number; shape?: string; tally: FidelityTally }[];
}

export const VOLATILE = /\bGet\s*\(\s*(Current|Account|UserName|System|Application|Host|Window|Layout|Found|Record|Total|Script|Last|Active|Device|Persistent|Network|Modified|Request|Screen|Desktop|Documents|Temporary|File|Preferences|Calculation|Encryption|Connection|Uuid|UUID|Trigger|Error)|\bRandom\b|\bGet\s*\(\s*\w*Path/i;
export const EXTERNAL = /\b(BE_|MBS\b|Email|DataGuard_|FieldNames|LayoutNames|ScriptNames|TableNames|ValueListItems|DatabaseNames|LayoutObjectNames|WindowNames|FieldType|FieldComment)\w*\s*\(/;

const blank = (): FidelityTally => ({ values: 0, match: 0, differ: 0, missing: 0, extra: 0, error: 0 });

const SQL_WORDS = /^(select|distinct|count|sum|avg|min|max|from|where|and|or|not|in|like|is|null|between|join|inner|left|right|outer|on|group|by|order|having|asc|desc|union|all|as|case|when|then|else|end|fetch|first|rows|only|offset|limit|exists|lower|upper|trim|cast|coalesce|substring|current_date|current_timestamp)$/i;

/** A query reduced to its SQL keywords and punctuation: names become "x", literals "v", parameters "?". */
export function queryShape(sql: string): string {
  let tokens: ReturnType<typeof sqlTokens>;
  // A query with an unterminated quote or comment has no shape; it is still reported (as its problem), not thrown.
  try { tokens = sqlTokens(sql); } catch { return '(unparsed)'; }
  const operand = (t: (typeof tokens)[number] | undefined) => !!t && (t.kind === 'identifier' || t.kind === 'string' || (t.kind === 'word' && !SQL_WORDS.test(t.text)));
  const number = (t: (typeof tokens)[number] | undefined) => t?.kind === 'word' && /^\d/.test(t.text);
  // A number such as 1.5e-3 is split by the tokenizer at the dot and at the sign after the exponent.
  const signedExponent = (at: number) => number(tokens[at]) && /^\d[\d_]*e$/i.test(tokens[at].text) && /^[-+]$/.test(tokens[at + 1]?.text ?? '') && number(tokens[at + 2]);
  const shape: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // A dotted name (a.b, "a"."b", t.*) or a decimal number (1.5, 1., .5) is one name or one value.
    if (t.kind === 'symbol' && t.text === '.') {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      if (number(next) && !number(prev) && !operand(prev)) { shape.push(' v '); i++; if (signedExponent(i)) i += 2; continue; }
      if (number(prev)) {
        if (number(next)) { i++; if (signedExponent(i)) i += 2; }
        continue;
      }
      if (operand(prev)) {
        if (operand(next) || number(next)) { i++; continue; }
        if (next?.text === '*') continue;
      }
    }
    if (signedExponent(i)) { shape.push(' v '); i += 2; continue; }
    if (t.kind === 'comment') shape.push(' ');
    else if (t.kind === 'string' || /^\d/.test(t.text)) shape.push(' v ');
    else if (t.kind === 'identifier') shape.push(' x ');
    else if (t.kind === 'parameter') shape.push('?');
    else if (t.kind === 'word') shape.push(SQL_WORDS.test(t.text) ? t.text.toUpperCase() : 'x');
    else if (t.kind === 'symbol' && !/^[!#$%&()*+,./:;<=>?@[\]^{|}~-]$/u.test(t.text)) shape.push(' x ');
    else shape.push(t.text);
  }
  return shape.join('')
    .replace(/\s+/g, ' ')
    .replace(/\bx(?: x)+\b/g, 'x')
    .trim();
}

function sqlQueries(n: Node, out: Node[] = []): Node[] {
  if (n.k === 'call') {
    if (n.name.toLowerCase() === 'executesql' && n.args[0]) out.push(n.args[0]);
    for (const a of n.args) sqlQueries(a, out);
  } else if (n.k === 'bin') { sqlQueries(n.a, out); sqlQueries(n.b, out); }
  else if (n.k === 'unary') sqlQueries(n.a, out);
  else if (n.k === 'let') { for (const [, v] of n.binds) sqlQueries(v, out); sqlQueries(n.body, out); }
  return out;
}

/** Whether a stored value and a recomputed one are the same value of the field's type. */
export function sameStored(stored: SqlValue, got: SqlValue, f: Field): boolean {
  const s = stored ?? '';
  const g = got ?? '';
  if (String(s) === String(g)) return true;
  if ((f.type === 'date' || f.type === 'time' || f.type === 'timestamp') && s !== '' && g !== '') {
    const a = fromStored(String(s), f.type), b = fromStored(String(g), f.type);
    if (a.type === f.type && b.type === f.type) return a.value === b.value;
  }
  if (f.type === 'number' && s !== '' && g !== '') {
    const a = Number(s), b = Number(g);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  }
  return false;
}

/** How two different values differ, without saying what they are. */
export function differenceKind(stored: string, got: string): string {
  const lines = (v: string) => v.split(/\r\n|[\r\n]/);
  const a = lines(stored), b = lines(got);
  if (a.length > 1 && a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')) return 'same lines, other order';
  if (a.length !== b.length && new Set(a).size === new Set(b).size && [...new Set(a)].sort().join('\n') === [...new Set(b)].sort().join('\n')) return 'same lines, other count';
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm(stored) === norm(got)) return 'case or spacing';
  const n = (v: string) => Number(v.replace(/[$,\s]/g, ''));
  if (stored.trim() !== '' && got.trim() !== '' && Number.isFinite(n(stored)) && n(stored) === n(got)) return 'number formatting';
  if (a.length !== b.length) return 'other, different line count';
  if (stored.trim() !== '' && got.trim() !== '' && Number.isFinite(n(stored)) && Number.isFinite(n(got))) return `other, both numbers, stored ${n(stored) < n(got) ? 'lower' : 'higher'}`;
  return 'other';
}

const stampField = (t: Table, kind: 'modificationTimestamp' | 'creationTimestamp') => t.fields.find((f) => f.options?.autoEnter?.value === kind);

/**
 * Did any record an ExecuteSQL query read change after `row`'s stored value was worked out? Runs each
 * query again as SELECT MAX(<modification timestamp>) with the same arguments. Says which, never values.
 * FileMaker recomputes a stored calculation only when a field it names on its own record changes, and
 * ExecuteSQL formulas usually name only a key, set when the record is made: so the record's creation
 * time, not its last save, is when the value was most likely worked out (editing other fields of the
 * record later doesn't recompute it).
 */
function changedAfter(store: Store, table: Table, row: Record<string, SqlValue>, calls: { query: string; args: Value[] }[]): string {
  const time = (f: Field | undefined) => (f && row[f.name] !== null && row[f.name] !== '' ? String(row[f.name]) : undefined);
  const saved = time(stampField(table, 'modificationTimestamp'));
  const created = time(stampField(table, 'creationTimestamp'));
  if (!saved && !created) return 'no modification timestamp on this record';
  if (!calls.length) return 'no query ran';
  let known = false;
  let found = false;
  let latest: string | undefined;
  for (const c of [...calls]) {
    const from = /\bFROM\s+("[^"]+"|[\w.~]+)/i.exec(c.query)?.[1]?.replace(/^"|"$/g, '');
    const to = from && store.schema.tableOccurrences.find((x) => x.name.toLowerCase() === from.toLowerCase());
    const other = to && store.calc.occurrenceTable(to.id);
    const theirs = other && stampField(other.table, 'modificationTimestamp');
    if (!theirs) continue;
    const query = c.query.replace(/^\s*SELECT\s+[\s\S]*?\s+FROM\s+/i, `SELECT MAX("${theirs.name}") FROM `).replace(/\bORDER\s+BY[\s\S]*$/i, '');
    try {
      // The engine's own ExecuteSQL, not the recording wrapper.
      const v = Object.getPrototypeOf(store.calc).executeSQL.call(store.calc, query, c.args)[0]?.[0] as Value | undefined;
      known = true;
      if (!v || v.type === 'text' && v.value === '') continue;
      found = true;
      // The column's own text (the same stored form as this record's), not a reparse.
      const when = v.type === 'text' ? v.value : toStored(v, 'timestamp');
      if (when !== null && (latest === undefined || String(when) > latest)) latest = String(when);
    } catch (e) { rethrowExecutionRefusal(e); /* not comparable */ }
  }
  if (!known) return 'no modification timestamp on the tables it reads';
  // FileMaker keeps a stored value when the records it was worked out from are deleted.
  if (!found) return 'no record it reads exists now (deleted since, or never matched)';
  if (latest !== undefined && saved && latest > saved) return 'a record it reads changed after this record was saved';
  if (latest !== undefined && created && latest > created) return 'a record it reads changed after this record was made (not since it was saved)';
  return created ? 'nothing it reads changed after this record was made' : 'nothing it reads changed after this record was saved';
}

/** Why a query can't run here, by kind only (never the names in the message). */
function queryProblem(store: Store, sql: string): string | undefined {
  try {
    const { sql: translated, target } = store.calc.translateSQL(sql);
    target.describe(translated);
    return undefined;
  } catch (e) {
    rethrowExecutionRefusal(e);
    const m = (e as Error).message;
    return /no such column/i.test(m) ? 'unknown column' : /no such table/i.test(m) ? 'unknown table'
      : /syntax error/i.test(m) ? 'syntax not supported' : /no such function/i.test(m) ? 'unknown SQL function' : 'other';
  }
}

export function calcFidelity(store: Store, opts: { perField?: number; sqlOnly?: boolean } = {}): FidelityReport {
  const perField = opts.perField ?? 200;
  const report: FidelityReport = { fields: 0, skipped: { volatile: 0, external: 0 }, total: blank(), functions: {}, queries: [], kinds: {}, timing: {}, emptyRule: {}, worst: [] };
  const shapes = new Map<string, { fields: number; problem?: string; tally: FidelityTally; kinds: Record<string, number>; timing: Record<string, number> }>();
  const add = (t: FidelityTally, k: keyof FidelityTally) => { t[k]++; };
  // The queries each formula runs, with their arguments, to check timing afterwards.
  const calls: { query: string; args: Value[] }[] = [];
  const executeSQL = store.calc.executeSQL;
  store.calc.executeSQL = (query, args, privileges) => {
    calls.push({ query, args });
    return executeSQL.call(store.calc, query, args, privileges);
  };
  store.sql.exec('BEGIN');
  try {
    for (const table of store.schema.tables) {
      const calcs = table.fields.filter((f) => f.kind === 'calculation' && f.calculation && !f.options?.unstored && !f.options?.global && f.type !== 'container'
        && (!opts.sqlOnly || /ExecuteSQL/i.test(f.calculation)));
      if (!calcs.length) continue;
      let rows: Record<string, SqlValue>[];
      try {
        rows = store.sql.prepare(`SELECT * FROM ${q(table.name)} ORDER BY _fm_record_id LIMIT ?`).all(perField) as Record<string, SqlValue>[];
      } catch {
        continue;
      }
      for (const f of calcs) {
        report.fields++;
        if (VOLATILE.test(f.calculation!)) { report.skipped.volatile++; continue; }
        if (EXTERNAL.test(f.calculation!)) { report.skipped.external++; continue; }
        const fns = [...new Set([...f.calculation!.matchAll(/([A-Za-z_][\w.]*)\s*\(/g)].map((m) => m[1]))];
        // The stored fields of this record the formula names, when those are all it names (for the empty rule).
        const compiled = f.options?.evaluateWhenEmpty ? null : store.calc.formula(table, f);
        const ownTo = store.schema.tableOccurrences.find((o) => o.id === (f.calculationContextId ?? store.calc.defaultOccurrence(table)))?.name.toLowerCase();
        const refs = compiled?.fields.map((r) => (!r.occurrence || r.occurrence.toLowerCase() === ownTo ? table.fields.find((x) => x.name.toLowerCase() === r.name.toLowerCase()) : undefined));
        const emptyRefs = refs?.length && refs.every((x) => x && !x.options?.global && !x.options?.unstored && x.type !== 'container') ? refs.map((x) => x!.name) : undefined;
        const callsCustom = fns.some((fn) => store.schema.customFunctions.some((c) => c.name.toLowerCase() === fn.toLowerCase()));
        // The query's shape: its literal SQL, or "built by formula".
        let shape: string | undefined;
        let problem: string | undefined;
        if (/ExecuteSQL/i.test(f.calculation!)) {
          let queries: Node[] = [];
          try {
            queries = sqlQueries(compile(f.calculation!, store.calc.names(f.calculationContextId ?? store.calc.defaultOccurrence(table) ?? 0)).node);
          } catch (e) { rethrowExecutionRefusal(e); /* counted as failing below */ }
          shape = queries.map((x) => (x.k === 'str' ? queryShape(x.value) : '(query built by formula)')).join(' | ') || '(unparsed)';
          problem = queries.map((x) => (x.k === 'str' ? queryProblem(store, x.value) : undefined)).find((p) => p);
        }
        const t = blank();
        const kinds: Record<string, number> = {};
        const timing: Record<string, number> = {};
        for (const row of rows) {
          const stored = row[f.name] ?? null;
          if (emptyRefs && emptyRefs.every((n) => row[n] === null || row[n] === '')) {
            const k = `${callsCustom ? 'calls a custom function' : 'no custom function'}, FileMaker stored ${stored === null || stored === '' ? 'nothing' : 'a value'}`;
            report.emptyRule[k] = (report.emptyRule[k] ?? 0) + 1;
          }
          calls.length = 0;
          const got = store.calc.computeStored({ store, table, row }, f);
          const s = stored === null || stored === '' ? '' : String(stored);
          const g = got === null || got === '' ? '' : String(got);
          const verdict: keyof FidelityTally = sameStored(stored, got as SqlValue, f) ? 'match'
            : s && g === '?' ? 'error' : s && !g ? 'missing' : !s && g ? 'extra' : 'differ';
          add(t, 'values'); add(t, verdict);
          add(report.total, 'values'); add(report.total, verdict);
          if (verdict === 'differ') {
            const k = differenceKind(s, g);
            kinds[k] = (kinds[k] ?? 0) + 1;
            report.kinds[k] = (report.kinds[k] ?? 0) + 1;
          }
          if (verdict !== 'match' && shape !== undefined) {
            let k = changedAfter(store, table, row, calls);
            // What's left unexplained, by how it differs: where a higher or lower number hints at a price list updated without touching its records.
            if (k.startsWith('nothing it reads changed')) k += ` (${verdict === 'differ' ? differenceKind(s, g) : verdict})`;
            timing[k] = (timing[k] ?? 0) + 1;
            report.timing[k] = (report.timing[k] ?? 0) + 1;
          }
          for (const fn of fns) {
            const ft = (report.functions[fn] ??= blank());
            add(ft, 'values'); add(ft, verdict);
          }
        }
        if (shape !== undefined) {
          const e = shapes.get(shape) ?? { fields: 0, tally: blank(), kinds: {}, timing: {} };
          e.fields++;
          for (const [k, n] of Object.entries(timing)) e.timing[k] = (e.timing[k] ?? 0) + n;
          for (const [k, n] of Object.entries(kinds)) e.kinds[k] = (e.kinds[k] ?? 0) + n;
          if (problem) e.problem = problem;
          for (const k of Object.keys(t) as (keyof FidelityTally)[]) e.tally[k] += t[k];
          shapes.set(shape, e);
        }
        if (t.values !== t.match) report.worst.push({ field: report.fields, ...(shape ? { shape } : {}), tally: t });
      }
    }
  } finally {
    store.sql.exec('ROLLBACK');
    store.calc.executeSQL = executeSQL;
  }
  report.queries = [...shapes].map(([shape, e]) => ({ shape, ...e })).sort((a, b) => (b.tally.values - b.tally.match) - (a.tally.values - a.tally.match) || b.tally.values - a.tally.values);
  report.worst.sort((a, b) => (b.tally.values - b.tally.match) - (a.tally.values - a.tally.match));
  report.worst = report.worst.slice(0, 25);
  return report;
}

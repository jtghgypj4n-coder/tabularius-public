// SQL writes over the PostgreSQL port (`--sql-writes`): INSERT, UPDATE and DELETE in a deliberately narrow grammar.
// The text is never handed to SQLite as a write. It is read token by token into a plan, and the plan is carried out
// through the Store's own record methods (create, update, delete), the ones the Data API uses, so validation,
// auto-enter, record and field privileges, audit, the journal and live updates behave the same as for any other writer.

import { cleanSql, sqlName, sqlTokens, type SqlToken } from '../../store/src/sql-tokens.ts';
import { StoreError, writer, type FieldData, type Privileges, type Store, type Transaction } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';

/** The most records one statement may change; more fails with error 812 before anything is kept. */
export const WRITE_LIMIT = 100_000;
/** Records between yields to the event loop, where the connection closing or a cancel stops the statement. */
const YIELD_EVERY = 32;

/** A statement this path does not take: its text says what to do instead. */
export class WriteRefusal extends Error {}

/** A piece of an expression: SQL text kept as written, or the name of a field of the table (resolved when it runs). */
type Part = { text: string } | { field: string };
type Expr = Part[];

export interface WritePlan {
  kind: 'insert' | 'update' | 'delete';
  table: string;
  /** INSERT: the columns named; each row has one slot per column, or `'default'` to leave the field to its auto-enter. */
  columns?: string[];
  rows?: (Expr | 'default')[][];
  /** UPDATE: the assignments. */
  set?: { field: string; expr: Expr }[];
  /** UPDATE and DELETE: the condition; absent means every record. */
  where?: Expr;
  /** The fields to give back, or `'*'` for every field. */
  returning?: string[] | '*';
  /** The highest $n the statement names. */
  params: number;
}

export interface WriteResult {
  /** The command tag: INSERT 0 n, UPDATE n or DELETE n. */
  tag: string;
  /** How many records were changed. */
  count: number;
  /** RETURNING: the columns and the stored rows. */
  names?: string[];
  rows?: SqlValue[][];
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IS', 'LIKE', 'GLOB', 'IN', 'BETWEEN', 'ESCAPE', 'NULL', 'TRUE', 'FALSE']);
/** Words that start a subquery, a join or a set operation: named in the refusal, not taken for a field. */
const SUBQUERY = new Set(['SELECT', 'WITH', 'VALUES', 'FROM', 'JOIN', 'UNION', 'EXCEPT', 'INTERSECT', 'EXISTS']);
const OPERATOR_SYMBOLS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '(', ')', ',']);

const refuse = (message: string): never => { throw new WriteRefusal(message); };

/** The tokens of a statement without spaces (comments were turned into spaces by cleanSql). */
function tokensOf(text: string): SqlToken[] {
  return sqlTokens(text).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
}

const wordIs = (t: SqlToken | undefined, word: string) => t?.kind === 'word' && t.text.toUpperCase() === word;
const isName = (t: SqlToken | undefined): boolean => !!t && (t.kind === 'word' || t.kind === 'identifier') && !(t.kind === 'word' && /^\d/.test(t.text));

/** The next number literal at a position of the text: 12, 1.5, .5, 1e-3, 0x1F. */
const NUMBER = /^(?:0x[0-9a-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i;

class Reader {
  readonly text: string;
  readonly tokens: SqlToken[];
  pos = 0;
  params = 0;
  constructor(text: string) {
    this.text = text;
    this.tokens = tokensOf(text);
    for (const t of this.tokens) {
      if (t.kind === 'symbol' && t.text === ';') refuse('one statement at a time: remove the semicolon');
    }
  }
  get peek(): SqlToken | undefined { return this.tokens[this.pos]; }
  get done(): boolean { return this.pos >= this.tokens.length; }
  word(word: string, what = word): void {
    if (!wordIs(this.peek, word)) refuse(`expected ${what}${this.peek ? ` before "${this.peek.text}"` : ''}`);
    this.pos++;
  }
  isWord(word: string): boolean { return wordIs(this.peek, word); }
  isSymbol(symbol: string): boolean { return this.peek?.kind === 'symbol' && this.peek.text === symbol; }
  symbol(symbol: string): void {
    if (!this.isSymbol(symbol)) refuse(`expected "${symbol}"${this.peek ? ` before "${this.peek.text}"` : ' at the end of the statement'}`);
    this.pos++;
  }
  /** A table or field name; a dot after it is a qualified name, which is not taken. */
  name(what: string): string {
    const t = this.peek;
    if (!t || !isName(t)) return refuse(`expected ${what}${t ? ` before "${t.text}"` : ' at the end of the statement'}`);
    this.pos++;
    if (this.isSymbol('.')) refuse(`qualified names ("${sqlName(t)}.…") are not supported: name the field on its own`);
    return sqlName(t);
  }
  /** The tokens up to a delimiter at depth 0 (not taken), checking that parentheses balance. */
  until(stop: (t: SqlToken) => boolean): SqlToken[] {
    const out: SqlToken[] = [];
    let depth = 0;
    while (!this.done) {
      const t = this.peek!;
      if (depth === 0 && stop(t)) break;
      if (t.kind === 'symbol' && t.text === '(') depth++;
      if (t.kind === 'symbol' && t.text === ')' && --depth < 0) refuse('unbalanced parentheses: a ")" has no "("');
      out.push(t);
      this.pos++;
    }
    if (depth > 0) refuse('unbalanced parentheses: a "(" is not closed');
    return out;
  }
}

/** Reads a value or a condition: only literals, $n parameters, operators and (when allowed) names of fields of the table. */
function expression(r: Reader, tokens: SqlToken[], fields: boolean, what: string): Expr {
  if (!tokens.length) refuse(`${what} is empty`);
  const out: Expr = [];
  let depth = 0;
  // Whether the last thing read is a value (a literal, a parameter, a name or a closing parenthesis): two values in a
  // row, or an operator at the end, is not an expression.
  let value = false;
  const operand = (shown: string) => {
    if (value) refuse(`an operator is missing before "${shown}" in ${what}`);
    value = true;
  };
  const push = (text: string) => out.push({ text });
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const upper = t.text.toUpperCase();
    // A number: digits, a fraction and an exponent are several tokens to the tokenizer.
    const startsNumber = t.kind === 'word' ? /^\d/.test(t.text) : t.kind === 'symbol' && t.text === '.' && next?.kind === 'word' && /^\d/.test(next.text) && next.start === t.end;
    if (startsNumber) {
      const m = NUMBER.exec(r.text.slice(t.start));
      if (!m) return refuse(`"${t.text}" is not a number`);
      const end = t.start + m[0].length;
      if (/[\w$]/.test(r.text[end] ?? '') ) refuse(`"${r.text.slice(t.start, end)}${r.text[end]}…" is not a number`);
      operand(m[0]);
      push(m[0]);
      while (tokens[i + 1] && tokens[i + 1].start < end) i++;
      continue;
    }
    if (t.kind === 'string') { operand(t.text); push(t.text); continue; }
    if (t.kind === 'parameter') {
      const n = Number(t.text.slice(1));
      if (!Number.isSafeInteger(n) || n < 1 || n > 32766) refuse('a parameter number is out of range');
      r.params = Math.max(r.params, n);
      operand(t.text);
      push(`?${n}`);
      continue;
    }
    if (t.kind === 'symbol') {
      if (t.text === '.') return refuse('qualified names ("a.b") are not supported: name the field on its own');
      if (t.text === ';') return refuse('one statement at a time: remove the semicolon');
      if (!OPERATOR_SYMBOLS.has(t.text)) return refuse(`"${t.text}" is not supported in ${what}: it may use + - * / % = <> != < > <= >=, AND, OR, NOT, IS, LIKE, GLOB, IN, BETWEEN, NULL, TRUE, FALSE and parentheses`);
      if (t.text === ',' && depth === 0) refuse(`a comma outside parentheses is not supported in ${what}`);
      // <=, >=, <> and != are one operator: the tokenizer gives their characters one at a time.
      if ((t.text === '<' || t.text === '>' || t.text === '!') && next?.kind === 'symbol' && next.start === t.end
        && (next.text === '=' || (t.text === '<' && next.text === '>'))) {
        push(t.text + next.text);
        value = false;
        i++;
        continue;
      }
      if (t.text === '!') refuse(`"!" is not supported in ${what}: write != for not equal`);
      if (t.text === '(') {
        if (value) refuse(`an operator is missing before "(" in ${what}`);
        depth++;
      }
      if (t.text === ')' && --depth < 0) refuse('unbalanced parentheses: a ")" has no "("');
      value = t.text === ')';
      push(t.text);
      continue;
    }
    // A word or a quoted name.
    if (t.kind === 'word' && KEYWORDS.has(upper)) {
      if (upper === 'NULL' || upper === 'TRUE' || upper === 'FALSE') operand(upper);
      else value = false;
      push(` ${upper} `);
      continue;
    }
    if (t.kind === 'word' && SUBQUERY.has(upper)) return refuse('subqueries, joins and SELECT inside a statement are not supported: write the values out, or use the Data API');
    if (next?.kind === 'symbol' && next.text === '(') return refuse(`functions are not supported (${sqlName(t)}(…)): use literals, parameters and operators, or the Data API`);
    if (next?.kind === 'symbol' && next.text === '.') return refuse('qualified names ("a.b") are not supported: name the field on its own');
    if (!fields) return refuse(`${what} may hold literals and $n parameters only, not "${sqlName(t)}"`);
    operand(sqlName(t));
    out.push({ field: sqlName(t) });
  }
  if (depth > 0) refuse('unbalanced parentheses: a "(" is not closed');
  if (!value) refuse(`${what} ends with an operator or a keyword that needs something after it`);
  return out;
}

/** RETURNING * or a list of field names. */
function returning(r: Reader): string[] | '*' | undefined {
  if (!r.isWord('RETURNING')) return undefined;
  r.pos++;
  if (r.isSymbol('*')) {
    r.pos++;
    return '*';
  }
  const names = [r.name('a field name after RETURNING')];
  while (r.isSymbol(',')) {
    r.pos++;
    names.push(r.name('a field name after the comma'));
  }
  if (r.isWord('AS')) refuse('RETURNING takes field names, not expressions or aliases');
  return names;
}

function finish(r: Reader): void {
  if (!r.done) refuse(`"${r.peek!.text}" is not supported here (the statement is not one of the forms in docs/pgwire-writes.md)`);
}

const isComma = (t: SqlToken) => t.kind === 'symbol' && t.text === ',';

/** Splits at commas at depth 0. */
function splitCommas(tokens: SqlToken[]): SqlToken[][] {
  const out: SqlToken[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'symbol' && t.text === '(') depth++;
    if (t.kind === 'symbol' && t.text === ')') depth--;
    if (depth === 0 && isComma(t)) out.push([]);
    else out[out.length - 1].push(t);
  }
  return out;
}

function checkFieldName(name: string): void {
  if (name.startsWith('_fm_')) throw new StoreError(201, `Field "${name}" cannot be modified: names starting with _fm_ belong to the file itself`);
  if (/\(\d+\)$/.test(name)) refuse(`field repetitions ("${name}") are not supported: use the Data API to change a repeating field`);
}

/**
 * The plan for an INSERT, UPDATE or DELETE, `undefined` for any other statement, and a WriteRefusal (with a plain
 * message) for a write in a shape this path does not take. Comments, quoted names and string literals are read as the
 * SQL reads do.
 */
export function parseWrite(sql: string): WritePlan | undefined {
  const text = cleanSql(sql, true);
  const r = new Reader(text);
  const first = r.peek;
  const kind = first?.kind === 'word' ? first.text.toUpperCase() : '';
  if (kind !== 'INSERT' && kind !== 'UPDATE' && kind !== 'DELETE') return undefined;
  r.pos++;

  if (kind === 'INSERT') {
    r.word('INTO', 'INTO after INSERT');
    const table = r.name('a table name');
    if (r.isWord('DEFAULT')) {
      r.pos++;
      r.word('VALUES', 'VALUES after DEFAULT');
      const ret = returning(r);
      finish(r);
      return { kind: 'insert', table, columns: [], rows: [[]], returning: ret, params: 0 };
    }
    if (!r.isSymbol('(')) {
      if (r.isWord('SELECT') || r.isWord('WITH') || r.isWord('TABLE')) refuse('INSERT … SELECT is not supported: list the values, or use the Data API');
      refuse('list the columns after the table name: INSERT INTO table (field, …) VALUES (…)');
    }
    r.pos++;
    const columns: string[] = [];
    for (;;) {
      const name = r.name('a field name');
      checkFieldName(name);
      if (columns.some((c) => c.toLowerCase() === name.toLowerCase())) refuse(`field "${name}" is named twice`);
      columns.push(name);
      if (r.isSymbol(',')) { r.pos++; continue; }
      r.symbol(')');
      break;
    }
    if (r.isWord('SELECT') || r.isWord('WITH') || r.isWord('TABLE')) refuse('INSERT … SELECT is not supported: list the values, or use the Data API');
    r.word('VALUES');
    const rows: (Expr | 'default')[][] = [];
    for (;;) {
      r.symbol('(');
      const inside = r.until((t) => t.kind === 'symbol' && t.text === ')');
      r.symbol(')');
      const slots = splitCommas(inside);
      const given = inside.length ? slots.length : 0;
      if (given !== columns.length) refuse(`${columns.length} column${columns.length === 1 ? '' : 's'} but ${given} value${given === 1 ? '' : 's'} in a row of VALUES`);
      rows.push(slots.map((slot) => (slot.length === 1 && wordIs(slot[0], 'DEFAULT') ? 'default' : expression(r, slot, false, 'a VALUES list'))));
      if (r.isSymbol(',')) { r.pos++; continue; }
      break;
    }
    const ret = returning(r);
    finish(r);
    return { kind: 'insert', table, columns, rows, returning: ret, params: r.params };
  }

  if (kind === 'UPDATE') {
    const table = r.name('a table name');
    r.word('SET', 'SET after the table name');
    const part = r.until((t) => wordIs(t, 'WHERE') || wordIs(t, 'RETURNING'));
    if (!part.length) refuse('SET needs at least one assignment');
    const set: { field: string; expr: Expr }[] = [];
    for (const assignment of splitCommas(part)) {
      if (!assignment.length) refuse('an assignment is empty');
      const [target, equals, ...rest] = assignment;
      if (!isName(target)) refuse(`expected a field name before "${target.text}"`);
      if (!equals) refuse(`expected "=" after ${sqlName(target)}`);
      if (assignment[1]?.kind === 'symbol' && assignment[1].text === '.') refuse(`qualified names ("${sqlName(target)}.…") are not supported: name the field on its own`);
      if (!equals || equals.kind !== 'symbol' || equals.text !== '=') refuse(`expected "=" after ${sqlName(target)}`);
      const field = sqlName(target);
      checkFieldName(field);
      if (set.some((s) => s.field.toLowerCase() === field.toLowerCase())) refuse(`field "${field}" is assigned twice`);
      if (rest.length === 1 && wordIs(rest[0], 'DEFAULT')) refuse(`SET ${field} = DEFAULT is not supported: give the value, or use the Data API`);
      if (rest.length === 1 && wordIs(rest[0], 'NULL')) refuse(`SET ${field} = NULL is not supported: clear a field with '' (an empty string) or use the Data API`);
      set.push({ field, expr: expression(r, rest, true, `the value of ${field}`) });
    }
    let where: Expr | undefined;
    if (r.isWord('WHERE')) {
      r.pos++;
      where = expression(r, r.until((t) => wordIs(t, 'RETURNING')), true, 'the WHERE condition');
    }
    const ret = returning(r);
    finish(r);
    return { kind: 'update', table, set, where, returning: ret, params: r.params };
  }

  r.word('FROM', 'FROM after DELETE');
  const table = r.name('a table name');
  if (r.isWord('USING')) refuse('DELETE … USING (a join) is not supported');
  let where: Expr | undefined;
  if (r.isWord('WHERE')) {
    r.pos++;
    where = expression(r, r.until((t) => wordIs(t, 'RETURNING')), true, 'the WHERE condition');
  }
  const ret = returning(r);
  finish(r);
  return { kind: 'delete', table, where, returning: ret, params: r.params };
}

// --- carrying a plan out -------------------------------------------------------------

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The table's fields as the Store lists them for it, by lower-case name. */
type FieldInfo = ReturnType<Store['occurrence']>['fields'][number];
type Fields = Map<string, FieldInfo>;

function fieldsOf(info: ReturnType<Store['occurrence']>): Fields {
  return new Map(info.fields.map((f) => [f.name.toLowerCase(), f]));
}

function resolve(fields: Fields, name: string): FieldInfo {
  const f = fields.get(name.toLowerCase());
  if (!f) throw new StoreError(102, `Field "${name}" is missing`);
  return f;
}

/** An expression as SQL over the table's own columns: field names are the real ones, quoted. */
function render(expr: Expr, fields: Fields): string {
  return expr.map((part) => {
    if (!('field' in part)) return part.text;
    const name = readable(fields, part.field);
    // A native decimal is stored as text. Read as a number, as a query reads it, so a condition or a calculation gives
    // the same answer on the held connection (inside BEGIN) as on the committed one.
    return resolve(fields, name).type === 'decimal' ? `CAST(NULLIF(${q(name)}, '') AS REAL)` : q(name);
  }).join(' ');
}

function readable(fields: Fields, name: string): string {
  if (name.startsWith('_fm_')) throw new StoreError(201, `Field "${name}" is not available: names starting with _fm_ belong to the file itself`);
  return resolve(fields, name).name;
}

/** What a field may be given over SQL: not a calculation, a container or a repeating field. */
function writable(f: FieldInfo): void {
  if (f.calculated) throw new StoreError(201, `Field "${f.name}" cannot be modified: it is a calculation`);
  if (f.type === 'container') throw new StoreError(201, `Field "${f.name}" is a container: upload its contents through the Data API`);
  if ((f.repetitions ?? 1) > 1) throw new StoreError(201, `Field "${f.name}" repeats: change it through the Data API`);
}

function fieldValue(v: unknown, field: string): string | number {
  if (v === null || v === undefined) throw new WriteRefusal(`a NULL value for ${field} is not supported: leave the field out (or write DEFAULT) so its auto-enter applies, give '' to empty it, or use the Data API`);
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return v;
  throw new WriteRefusal(`a binary value for ${field} is not supported: use the Data API for containers and binary data`);
}

/** Checks, before any record is touched, that the account may create, edit or delete records of the table and write the fields. */
function checkPrivileges(plan: WritePlan, privileges: Privileges, store: Store, table: string, written: string[]): void {
  const pv = privileges.in(store);
  const t = pv.table(table);
  const [permission, verb] = plan.kind === 'insert' ? ['create', 'create'] as const : plan.kind === 'update' ? ['edit', 'edit'] as const : ['delete', 'delete'] as const;
  if (t[permission] === false) throw new StoreError(200, `Record access is denied: cannot ${verb} records`, pv.recordDenial(table, permission, permission));
  for (const field of written) {
    if (pv.field(table, field) !== 'modifiable') {
      throw new StoreError(201, `Field "${field}" cannot be modified: this account may only view it`, pv.fieldDenial(table, field, permission));
    }
  }
}

/** The columns RETURNING gives back, with their declared types, without running anything. */
export function returningColumns(plan: WritePlan, store: Store): { names: string[]; types: (string | null)[] } | undefined {
  if (!plan.returning) return undefined;
  const info = store.occurrence(plan.table);
  const fields = fieldsOf(info);
  const names = plan.returning === '*' ? info.fields.map((f) => f.name) : plan.returning.map((n) => readable(fields, n));
  return store.describe(`SELECT ${names.map(q).join(', ')} FROM ${q(info.table)}`);
}

/** The highest ?n a statement names: SQLite takes exactly that many values, no more. */
function highestParameter(sql: string): number {
  return sqlTokens(sql).reduce((n, t) => (t.kind === 'parameter' ? Math.max(n, Number(t.text.slice(1))) : n), 0);
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Runs a plan as the signed-in account, inside `transaction` (the caller keeps or undoes it). Every change goes
 * through store.create, store.update or store.delete. The privilege checks come first and are made on every run, a
 * statement that matches no record included. `cap` bounds the rows RETURNING gives back (0 for no cap), `limit` the
 * records one statement may change.
 */
export async function executeWrite(plan: WritePlan, store: Store, privileges: Privileges, params: SqlValue[], cap: number,
  cancelled: () => boolean, transaction: Transaction, limit = WRITE_LIMIT): Promise<WriteResult> {
  const info = store.occurrence(plan.table);
  if (info.owner !== store) {
    throw new WriteRefusal(`"${plan.table}" is a table of another hosted file: connect to that file to change it (SQL writes go to the file the connection is for)`);
  }
  if (params.length < plan.params) throw new WriteRefusal(`the statement uses $${plan.params} but ${params.length} parameter${params.length === 1 ? ' was' : 's were'} given`);
  const fields = fieldsOf(info);
  const account = privileges.account;
  const options = { account, privileges, dataEntry: true as const };
  const context = { account, surface: 'sql', transaction: { open: transaction } };
  const reader = (sql: string, args: SqlValue[], max: number) => store.selectIn(transaction, sql, args.slice(0, highestParameter(sql)), max).rows;
  const stop = () => {
    if (cancelled()) throw new WriteRefusal('the connection closed or the statement was cancelled; nothing was kept');
  };

  // The assignments and values the account writes, resolved to real field names.
  const written = plan.kind === 'insert' ? plan.columns!.map((c) => resolve(fields, c))
    : plan.kind === 'update' ? plan.set!.map((s) => resolve(fields, s.field)) : [];
  for (const f of written) writable(f);
  checkPrivileges(plan, privileges, store, info.table, written.map((f) => f.name));

  const tableSql = q(info.table);
  const where = plan.where ? render(plan.where, fields) : '1';
  const returned = plan.returning === '*' ? info.fields.map((f) => f.name) : plan.returning?.map((n) => readable(fields, n));
  const select = returned ? `SELECT ${returned.map(q).join(', ')} FROM ${tableSql} WHERE _fm_record_id = ?1` : undefined;
  const storedRow = (id: number): SqlValue[] => reader(select!, [id], 1)[0] ?? [];
  const tooMany = (count: number) => {
    if (count > limit) throw new StoreError(812, `This statement would change ${count.toLocaleString('en')} records; at most ${limit.toLocaleString('en')} can be changed in one statement. Split it with a WHERE condition`);
    if (returned && cap > 0 && count > cap) throw new StoreError(812, `SQL results are limited to ${cap} rows: RETURNING would give back ${count.toLocaleString('en')}. Change fewer records in one statement, or leave RETURNING out`);
  };
  const result = (count: number, rows: SqlValue[][]): WriteResult => ({
    tag: plan.kind === 'insert' ? `INSERT 0 ${count}` : `${plan.kind === 'update' ? 'UPDATE' : 'DELETE'} ${count}`,
    count, ...(returned ? { names: returned, rows } : {}),
  });

  return writer.run(context, async () => {
    const rows: SqlValue[][] = [];
    if (plan.kind === 'insert') {
      tooMany(plan.rows!.length);
      // Every row's values are worked out before the first record is made: a bad value leaves nothing behind.
      const data: FieldData[] = [];
      for (const row of plan.rows!) {
        if (data.length % YIELD_EVERY === 0) { await yieldToEventLoop(); stop(); }
        const one: FieldData = {};
        row.forEach((slot, i) => {
          if (slot === 'default') return;
          const value = reader(`SELECT (${render(slot, fields)})`, params, 1)[0]?.[0];
          one[written[i].name] = fieldValue(value, written[i].name);
        });
        data.push(one);
      }
      let n = 0;
      for (const one of data) {
        if (n++ % YIELD_EVERY === 0) { await yieldToEventLoop(); stop(); }
        const { recordId } = store.create(info, one, options);
        if (returned) rows.push(storedRow(recordId));
      }
      return result(data.length, rows);
    }

    const ids = reader(`SELECT _fm_record_id FROM ${tableSql} WHERE (${where}) ORDER BY _fm_record_id`, params, Infinity).map((r) => Number(r[0]));
    tooMany(ids.length);
    if (plan.kind === 'update') {
      // Each record's new values are read from the record as it is now, all before the first change.
      const values = plan.set!.map((s) => render(s.expr, fields));
      const next = params.length + 1;
      const sql = `SELECT ${values.map((v) => `(${v})`).join(', ')} FROM ${tableSql} WHERE _fm_record_id = ?${next}`;
      const data: FieldData[] = [];
      for (const id of ids) {
        if (data.length % YIELD_EVERY === 0) { await yieldToEventLoop(); stop(); }
        const row = reader(sql, [...params, id], 1)[0] ?? [];
        data.push(Object.fromEntries(plan.set!.map((s, i) => [written[i].name, fieldValue(row[i], written[i].name)])));
      }
      let n = 0;
      for (const [i, id] of ids.entries()) {
        if (n++ % YIELD_EVERY === 0) { await yieldToEventLoop(); stop(); }
        store.update(info, id, data[i], undefined, options);
        if (returned) rows.push(storedRow(id));
      }
      return result(ids.length, rows);
    }

    let n = 0;
    for (const id of ids) {
      if (n++ % YIELD_EVERY === 0) { await yieldToEventLoop(); stop(); }
      // The row is read before the delete: it is what RETURNING gives back.
      if (returned) rows.push(storedRow(id));
      store.delete(info, id, { account, privileges });
    }
    return result(ids.length, rows);
  });
}

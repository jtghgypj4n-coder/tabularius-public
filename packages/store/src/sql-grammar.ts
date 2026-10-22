// The parts of FileMaker's SQL grammar that SQLite reads differently: OFFSET and FETCH FIRST, the joins FileMaker
// does not have, = ANY and <> ALL, and the star in a select list (fields only, never the record's internal columns).
// Each works on the text outside strings, quoted names and comments, found by blanking those out (same length, so
// positions carry over to the original).
import { maskSql, sqlTokens, type SqlToken } from './sql-tokens.ts';
import { CalcError, ERR } from '../../calc/src/values.ts';
import { closing, operandStart } from './sql-dates.ts';

/** The query with its strings, quoted names and comments (and, for `top`, everything inside brackets) blanked out. */
export function blanked(sql: string, top = false): string {
  const plain = maskSql(sql);
  if (!top) return plain;
  let depth = 0;
  return plain.split('').map((c) => {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth > 0) return ' ';
    return c;
  }).join('');
}

/** The word that ends `text` (after any blanks): `/(\w+)\s*$/`, found by a scan from the end, not by trying every start. */
export function trailingWord(text: string): string | undefined {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  let start = end;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  return start < end ? text.slice(start, end) : undefined;
}

/** An `ORDER BY` key as its expression and the ASC or DESC after it, with the blanks before that (found from the end, not by backtracking). */
export function orderKeyParts(key: string): { expression: string; direction?: string } {
  const text = key.trimEnd();
  const n = /^desc$/i.test(text.slice(-4)) ? 4 : /^asc$/i.test(text.slice(-3)) ? 3 : 0;
  const at = text.length - n;
  let start = at;
  while (start > 0 && /\s/.test(text[start - 1])) start--;
  // The blanks must follow something: leading blanks are not the start of a direction.
  if (!n || start === at || !text.slice(0, start).trim()) return { expression: key.trim() };
  return { expression: text.slice(0, start).trim(), direction: text.slice(start) };
}

/** FileMaker's CAST(container AS VARCHAR) returns an embedded file's name, not its internal container id. */
export function containerCastsToName(sql: string, isContainer: (name: string) => boolean): string {
  if (!/\bCAST\b/i.test(sql)) return sql;
  const plain = blanked(sql);
  // The last name of the operand (the field, after any table name) is captured by the pattern itself.
  const cast = /\bCAST\s*\(\s*((?:(?:"(?:[^"]|"")+"|[A-Za-z_]\w*)\s*\.\s*)?(?:"((?:[^"]|"")+)"|([A-Za-z_]\w*)))\s+AS\s+VARCHAR(?:\s*\(\s*\d+\s*\))?\s*\)/gi;
  return sql.replace(cast, (whole, operand: string, quoted: string | undefined, plainName: string | undefined, at: number) => {
    if (plain.slice(at, at + 4).toUpperCase() !== 'CAST') return whole;
    const name = quoted?.replace(/""/g, '"') ?? plainName;
    return name && isContainer(name) ? `(SELECT filename FROM _fm_containers WHERE id = ${operand})` : whole;
  });
}

const unsupported = (what: string) => new CalcError(ERR.calculation, `${what} is not supported`);

/** RIGHT OUTER JOIN and FULL OUTER JOIN: FileMaker's SQL has only INNER and LEFT OUTER, and SQLite would accept these. */
export function refuseUnsupportedJoins(sql: string): void {
  const found = /\b(RIGHT|FULL)\s+(?:OUTER\s+)?JOIN\b/i.exec(blanked(sql));
  if (found) throw unsupported(`${found[1].toUpperCase()} OUTER JOIN`);
}

/**
 * ANY, SOME and ALL with a subquery. `= ANY` and `<> ALL` mean IN and NOT IN. The other comparisons (`> ALL`, `< ANY`,
 * `= ALL`...) have no SQLite form, so a scalar aggregate of the comparisons supplies true, false, or unknown. The
 * column list names S's one column, so a subquery with two is an error. ALL over no rows is true and ANY over none
 * false. The left side is a name, a constant or a call; when it is part of a longer expression
 * (`a + b > ALL (...)`), or an aggregate without an outer column, the comparison is left for SQLite to report.
 */
export function anyAllToIn(sql: string, columns?: ColumnLookup): string {
  if (sql.length > MAX_STAR_QUERY) return sql;
  const rewritten = quantified(sql, { left: MAX_QUANTIFIED, depth: 0 }, columns);
  return rewritten === sql ? sql : quantified(numberPlainParameters(sql), { left: MAX_QUANTIFIED, depth: 0 }, columns);
}

/** SQLite allocates each plain parameter after the highest slot already seen. Fix its identity before moving SQL. */
function numberPlainParameters(sql: string): string {
  let highest = 0;
  return sqlTokens(sql).map((t) => {
    if (t.kind === 'parameter' && t.text[0] === '?') {
      highest = Math.max(highest, Number(t.text.slice(1)));
    } else if (t.kind === 'symbol' && t.text === '?') return `?${++highest}`;
    return t.text;
  }).join('');
}

/** More quantified comparisons than this in a query, or nested deeper than MAX_QUANTIFIED_DEPTH, are left for SQLite to report. */
const MAX_QUANTIFIED = 500;
const MAX_QUANTIFIED_DEPTH = 20;

/** The columns of a table, by name, as the caller knows them; undefined for a name it does not know. */
export type ColumnLookup = (table: string) => readonly string[] | undefined;

/** Words SQLite never accepts as a bare column name. END, LIKE, GLOB, MATCH, REGEXP, WITH, TRUE and FALSE are not here: each can name a column. */
const SYNTAX = new Set(('ALL AND AS BETWEEN CASE COLLATE DISTINCT ELSE ESCAPE EXCEPT EXISTS FROM GROUP HAVING IN INTERSECT IS ISNULL JOIN LIMIT '
  + 'NOT NOTNULL NULL ON OR ORDER SELECT THEN UNION USING VALUES WHEN WHERE CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP').split(' '));
/** The syntax words that still end an operand, so a word after one is an alias or an operator. */
const ENDS_OPERAND = new Set(['NULL', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'ISNULL', 'NOTNULL']);
/** Words of a select's clauses and windows. They can name columns, so only a subquery's scan skips them, where a miss only leaves the comparison alone. */
const CLAUSE = new Set(('BY OFFSET ASC DESC LEFT RIGHT INNER OUTER CROSS NATURAL FULL WINDOW OVER FILTER PARTITION ROWS RANGE GROUPS UNBOUNDED PRECEDING FOLLOWING '
  + 'CURRENT ROW EXCLUDE TIES OTHERS NO NULLS FIRST LAST RECURSIVE MATERIALIZED WITH DEFAULT INDEXED').split(' '));
const FROM_ENDS = new Set('WHERE GROUP ORDER HAVING LIMIT UNION INTERSECT EXCEPT WINDOW SELECT VALUES'.split(' '));
const JOIN_WORDS = new Set('LEFT RIGHT INNER OUTER CROSS NATURAL FULL'.split(' '));
/** Names every table has, or that the engine fills in after this rewrite (the internal record and modification ids, ROWMODID's own name, the account's name). */
const ACCOUNT = new Set(['user', 'username', 'current_user']);
const IMPLICIT = new Set(['rowid', '_rowid_', 'oid', '_fm_record_id', '_fm_mod_id', ...ACCOUNT]);

type Words = SqlToken[];
interface Source { names: Set<string>; columns?: Set<string> }
interface Scope { sources: Source[]; aliases: Set<string> }

const upper = (t: SqlToken | undefined) => (t?.kind === 'word' ? t.text.toUpperCase() : '');
const nameOf = (t: SqlToken): string => (t.kind === 'identifier' ? t.text.slice(1, -1).replace(/""/g, '"') : t.text).toLowerCase();
const isName = (t: SqlToken | undefined): t is SqlToken => t?.kind === 'word' || t?.kind === 'identifier';

/** Where the parenthesis opened at words[open] closes. */
function closeOf(words: Words, open: number): number {
  let depth = 0;
  for (let at = open; at < words.length; at++) {
    if (words[at].text === '(' && words[at].kind === 'symbol') depth++;
    else if (words[at].text === ')' && words[at].kind === 'symbol' && --depth === 0) return at;
  }
  return words.length;
}

/** Whether the parenthesis at words[open] starts a subquery: a SELECT or VALUES, or a WITH that names a common table (WITH can also be a column). */
function opensSubquery(words: Words, open: number): boolean {
  if (words[open]?.text !== '(') return false;
  const next = upper(words[open + 1]);
  if (next === 'SELECT' || next === 'VALUES') return true;
  if (next !== 'WITH') return false;
  const name = words[open + 2];
  return upper(name) === 'RECURSIVE' || (isName(name) && (upper(words[open + 3]) === 'AS' || words[open + 3]?.text === '('));
}

/** Whether words[at] ends an operand, so that a word after it is an operator or an alias. */
function endsOperand(t: SqlToken | undefined): boolean {
  if (!t) return false;
  if (t.kind === 'word') return !SYNTAX.has(t.text.toUpperCase()) || ENDS_OPERAND.has(t.text.toUpperCase());
  return t.kind === 'identifier' || t.kind === 'string' || t.kind === 'parameter' || (t.kind === 'symbol' && t.text === ')');
}

function startsOperand(t: SqlToken | undefined): boolean {
  if (!t) return false;
  if (t.kind === 'word') return !SYNTAX.has(t.text.toUpperCase()) || ENDS_OPERAND.has(t.text.toUpperCase()) || /^(?:CASE|EXISTS)$/i.test(t.text);
  return t.kind === 'identifier' || t.kind === 'string' || t.kind === 'parameter' || (t.kind === 'symbol' && /^[(+-]$/.test(t.text));
}

/** LIKE, GLOB, MATCH and REGEXP are operators between two operands, and names anywhere else. */
function isOperatorWord(words: Words, at: number): boolean {
  if (!/^(?:LIKE|GLOB|MATCH|REGEXP)$/i.test(words[at].text)) return false;
  return (endsOperand(words[at - 1]) || upper(words[at - 1]) === 'NOT') && startsOperand(words[at + 1]);
}

/** The tokens after AS that name a type or an alias (DOUBLE PRECISION, UNSIGNED BIG INT, x): the index of the last one. A type's (10, 2) is left to the scan, which skips numbers. */
function skipAsTail(words: Words, as: number): number {
  let at = as + 1;
  while (at < words.length) {
    const t = words[at];
    if (!isName(t) || (t.kind === 'word' && SYNTAX.has(t.text.toUpperCase()))) break;
    at++;
  }
  return at - 1;
}

/** The tables and aliases a select declares in its own FROM and JOINs, the aliases its select list gives, and which of its tokens are those names. */
function declared(words: Words, columns: ColumnLookup | undefined, shadow: Set<string> = new Set()): { scope: Scope; skip: Set<number>; isolated: Set<number>; common: Set<string> } {
  const scope: Scope = { sources: [], aliases: new Set() };
  const skip = new Set<number>();
  // The parentheses of derived tables and common table expressions: bodies that do not see this select's own tables.
  const isolated = new Set<number>();
  // Common table expressions of this select and the selects around it hide the tables of the same name.
  const common = new Set(shadow);
  const ignoredClose = new Set<number>();
  let inFrom = false;
  let depth = 0;
  const item = (from: number): number => {
    let at = from;
    if (words[at]?.text === '(') {
      if (opensSubquery(words, at)) {
        isolated.add(at);
        const source: Source = { names: new Set() };
        at = closeOf(words, at) + 1;
        at = alias(at, source);
        scope.sources.push(source);
        return at;
      }
      ignoredClose.add(closeOf(words, at));
      return at + 1;
    }
    if (!isName(words[at])) return at;
    const path = [at];
    while (words[at + 1]?.text === '.' && isName(words[at + 2])) { at += 2; path.push(at); }
    for (const k of path) { skip.add(k); }
    at++;
    const table = nameOf(words[path[path.length - 1]]);
    const source: Source = { names: new Set([table]) };
    if (words[at]?.text === '(') source.columns = undefined;
    else if (!common.has(table)) {
      const known = columns?.(table);
      if (known) source.columns = new Set(known.map((c) => c.toLowerCase()));
    }
    at = alias(at, source);
    scope.sources.push(source);
    return at;
  };
  const alias = (from: number, source: Source): number => {
    let at = from;
    if (upper(words[at]) === 'AS') { skip.add(at); at++; }
    const t = words[at];
    if (isName(t) && !(t.kind === 'word' && (SYNTAX.has(t.text.toUpperCase()) || FROM_ENDS.has(t.text.toUpperCase()) || JOIN_WORDS.has(t.text.toUpperCase()) || /^(?:INDEXED|NOT)$/i.test(t.text)))) {
      source.names.add(nameOf(t));
      skip.add(at);
      at++;
    }
    return at;
  };
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (t.kind === 'symbol' && t.text === '(') { depth++; continue; }
    if (t.kind === 'symbol' && t.text === ')') { if (ignoredClose.has(i)) continue; depth--; continue; }
    if (depth > 0 || t.kind !== 'word') {
      if (depth === 0 && t.kind === 'symbol' && t.text === ',' && inFrom) i = item(i + 1) - 1;
      continue;
    }
    const up = t.text.toUpperCase();
    if (up === 'AS' && words[i + 1]?.text === '(' && opensSubquery(words, i + 1)) {
      isolated.add(i + 1);
      // WITH name [(columns)] AS (...): a common table, not a column.
      let nameAt = i - 1;
      if (words[nameAt]?.text === ')') { let k = nameAt; while (k > 0 && words[k].text !== '(') k--; for (let j = k; j <= nameAt; j++) skip.add(j); nameAt = k - 1; }
      if (isName(words[nameAt])) { common.add(nameOf(words[nameAt])); skip.add(nameAt); }
    } else if (up === 'AS' && isName(words[i + 1]) && !inFrom) {
      scope.aliases.add(nameOf(words[i + 1]));
    } else if (up === 'FROM') { inFrom = true; i = item(i + 1) - 1; }
    else if (up === 'JOIN' && inFrom) i = item(i + 1) - 1;
    else if (inFrom && FROM_ENDS.has(up)) inFrom = false;
  }
  return { scope, skip, isolated, common };
}

/** Whether a select's body (outside its parentheses) refers to a column that none of its own or its enclosing selects' FROM clauses supply. */
function reachesOutside(words: Words, enclosing: Scope[], columns: ColumnLookup | undefined, shadow: Set<string> = new Set()): boolean {
  const own = declared(words, columns, shadow);
  const here = [own.scope, ...enclosing];
  const declares = (name: string) => here.some((sc) => sc.sources.some((s) => s.names.has(name)));
  const supplies = (name: string) => IMPLICIT.has(name) || here.some((sc) => sc.aliases.has(name) || sc.sources.some((s) => !s.columns || s.columns.has(name)));
  let cases = 0;
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (t.kind === 'symbol' && t.text === '(' && opensSubquery(words, i)) {
      const close = closeOf(words, i);
      // A derived table or a common table expression does not see the tables of the select it is in, only the selects around that one.
      if (reachesOutside(words.slice(i + 1, close), own.isolated.has(i) ? enclosing : here, columns, own.common)) return true;
      i = close;
      continue;
    }
    if (own.skip.has(i) || !isName(t)) continue;
    if (t.kind === 'word') {
      const up = t.text.toUpperCase();
      if (up === 'AS') { i = skipAsTail(words, i); continue; }
      if (up === 'COLLATE') { i++; continue; }
      if (up === 'CASE') { cases++; continue; }
      if (up === 'END' && cases > 0) { cases--; continue; }
      if (SYNTAX.has(up) || CLAUSE.has(up) || /^(?:\d|\$)/.test(t.text) || /^(?:TRUE|FALSE)$/.test(up) || isOperatorWord(words, i)) continue;
      if ((up === 'X' && words[i + 1]?.kind === 'string') || words[i + 1]?.text === '(' || /^[:@]$/.test(words[i - 1]?.text ?? '')) continue;
      // A name straight after an operand is an alias.
      if (endsOperand(words[i - 1]) && words[i - 1].text !== '.' && !(words[i - 1].kind === 'word' && /^(?:AND|OR)$/i.test(words[i - 1].text))) continue;
    }
    if (words[i + 1]?.text === '.' && isName(words[i + 2])) {
      // schema.table.column names its table second.
      const three = words[i + 3]?.text === '.' && isName(words[i + 4]);
      const qualifier = nameOf(three ? words[i + 2] : t);
      if (!declares(qualifier)) return true;
      i += three ? 4 : 2;
      continue;
    }
    if (words[i - 1]?.text === '.') continue;
    if (!supplies(nameOf(t))) return true;
  }
  return false;
}

/** Whether an aggregate's arguments name a column of the outer query: a quoted name, a bare word that is not syntax, a call or a parameter, or a subquery that reaches one. */
function namesColumn(args: Words, ctx: Context): boolean {
  let cases = 0;
  for (let at = 0; at < args.length; at++) {
    const t = args[at];
    if (t.kind === 'symbol' && t.text === '(' && opensSubquery(args, at)) {
      const close = closeOf(args, at);
      if (reachesOutside(args.slice(at + 1, close), [], ctx.columns)) return true;
      at = close;
      continue;
    }
    if (t.kind === 'identifier') return true;
    if (t.kind !== 'word') continue;
    const up = t.text.toUpperCase();
    if (up === 'AS') { at = skipAsTail(args, at); continue; }
    if (up === 'COLLATE') { at++; continue; }
    if (up === 'CASE') { cases++; continue; }
    if (up === 'END' && cases > 0) { cases--; continue; }
    if (SYNTAX.has(up) || /^(?:\d|\$)/.test(t.text) || (up === 'X' && args[at + 1]?.kind === 'string') || isOperatorWord(args, at)) continue;
    if (args[at + 1]?.text === '(' || /^[:@]$/.test(args[at - 1]?.text ?? '')) continue;
    // TRUE and FALSE are constants, unless a table of the select has, or might have, a column of that name.
    if ((up === 'TRUE' || up === 'FALSE') && !ctx.outer.sources.some((s) => !s.columns || s.columns.has(t.text.toLowerCase()))) continue;
    // USER, USERNAME and CURRENT_USER are filled in after this rewrite, unless a table of the select is known to have a column of that name (a source with no known columns is not taken to have one).
    if (ACCOUNT.has(up.toLowerCase()) && !ctx.outer.sources.some((s) => s.columns?.has(t.text.toLowerCase()))) continue;
    // The account's name is filled in after this rewrite.
    return true;
  }
  return false;
}

interface Context { columns: ColumnLookup | undefined; outer: Scope }


/** A column-free aggregate moved under fm_q would count its rows instead of the outer query's rows. */
function aggregateWithoutColumn(operand: string, ctx: Context): boolean {
  const tokens = sqlTokens(operand).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const aggregate = /^(?:COUNT|SUM|AVG|MIN|MAX|TOTAL|GROUP_CONCAT|STRING_AGG|JSON_GROUP_ARRAY|JSON_GROUP_OBJECT)$/i;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind !== 'word' || !aggregate.test(tokens[i].text) || tokens[i + 1].text !== '(') continue;
    const end = closeOf(tokens, i + 1);
    if (end >= tokens.length) continue;
    if (!namesColumn(tokens.slice(i + 2, end), ctx)) return true;
  }
  return false;
}

function quantified(sql: string, budget: { left: number; depth: number }, columns: ColumnLookup | undefined): string {
  if (!/\b(?:ANY|SOME|ALL)\b/i.test(sql) || budget.depth > MAX_QUANTIFIED_DEPTH) return sql;
  const plain = blanked(sql);
  // The tables of the select that holds the comparison: the innermost parenthesised subquery around it, or the whole text.
  const scopes = new Map<number, Scope>();
  const containerScope = (at: number): Scope => {
    let start = 0;
    let end = sql.length;
    for (let i = at - 1, depth = 0; i >= 0; i--) {
      if (plain[i] === ')') depth++;
      else if (plain[i] === '(' && depth > 0) depth--;
      else if (plain[i] === '(' && /^\(\s*(?:SELECT\b|VALUES\b|WITH\s+(?:RECURSIVE\b|\S+\s+AS\b))/i.test(plain.slice(i, i + 60))) {
        const stop = closing(sql, i + 1);
        start = i + 1;
        end = stop < 0 ? sql.length : stop;
        break;
      }
    }
    if (!scopes.has(start)) scopes.set(start, declared(sqlTokens(sql.slice(start, end)).filter((t) => t.kind !== 'space' && t.kind !== 'comment'), columns).scope);
    return scopes.get(start)!;
  };
  let out = '';
  let copied = 0;
  for (const m of plain.matchAll(/(<=|>=|<>|!=|=|<|>)\s*(ANY|SOME|ALL)\s*(?=\()/gi)) {
    if (m.index < copied) continue;
    const all = /^ALL$/i.test(m[2]);
    const swap = m[1] === '=' ? (all ? undefined : 'IN') : (m[1] === '<>' || m[1] === '!=') && all ? 'NOT IN' : undefined;
    if (swap) {
      out += sql.slice(copied, m.index) + swap + ' ';
      copied = m.index + m[0].length;
      continue;
    }
    if (budget.left <= 0) break;
    // Every attempt counts, even one that is left alone: the scan to the operand and its select is not free.
    budget.left--;
    const open = m.index + m[0].length;
    const close = closing(sql, open + 1);
    const left = operandStart(sql, m.index);
    if (close < 0 || left < copied || left < 0) continue;
    // A longer expression to the left (a + b, a || b, t.x with a sign) is not this operand alone.
    if (/[-+*/%^.|]$/.test(plain.slice(0, left).trimEnd())) continue;
    const operand = sql.slice(left, m.index).trimEnd();
    if (aggregateWithoutColumn(operand, { columns, outer: containerScope(left) })) continue;
    budget.depth++;
    const x = quantified(operand, budget, columns);
    const sub = quantified(sql.slice(open + 1, close), budget, columns);
    budget.depth--;
    const op = m[1] === '!=' ? '<>' : m[1];
    const q = `WITH fm_q(fm_v) AS (${sub}) SELECT CASE WHEN ${all ? 'MIN(fm_cmp) = 0 THEN 0' : 'MAX(fm_cmp) = 1 THEN 1'} WHEN COUNT(*) > COUNT(fm_cmp) THEN NULL ELSE ${all ? 1 : 0} END FROM (SELECT ${x} ${op} fm_v AS fm_cmp FROM fm_q)`;
    out += sql.slice(copied, left) + `(${q})`;
    copied = close + 1;
  }
  return copied ? out + sql.slice(copied) : sql;
}

/**
 * OFFSET n ROWS and FETCH FIRST [n] ROWS ONLY as SQLite's LIMIT and OFFSET. FETCH FIRST without a count is one row,
 * a count under 1 and WITH TIES without an ORDER BY are errors (the Claris page), and neither can stand in a
 * subquery. WITH TIES counts the rows that rank at or before the last row wanted (see withTiesLimit). PERCENT is valid
 * FileMaker SQL that this does not do yet, and says so.
 */
export function fetchToLimit(sql: string): string {
  if (!/\b(?:OFFSET|FETCH)\b/i.test(sql)) return sql;
  const plain = blanked(sql);
  const top = blanked(sql, true);
  const offsetRe = /\bOFFSET\s+(\d+)\s+ROWS?\b/gi;
  const fetchRe = /\bFETCH\s+(?:FIRST|NEXT)(?:\s+(\d+))?(\s+PERCENT)?\s+ROWS?\s+(ONLY|WITH\s+TIES)\b/gi;
  const offset = offsetRe.exec(top);
  const first = fetchRe.exec(top);
  // Any in the text that is not at the top of the query is in a subquery.
  const all = [...plain.matchAll(offsetRe), ...plain.matchAll(fetchRe)];
  if (all.length > (offset ? 1 : 0) + (first ? 1 : 0)) throw unsupported('OFFSET and FETCH FIRST in a subquery');
  if (!offset && !first) return sql;
  let ties: string | undefined;
  if (first) {
    if (first[2]) throw unsupported('FETCH FIRST n PERCENT');
    if (/^WITH/i.test(first[3])) {
      if (!/\bORDER\s+BY\b/i.test(top)) throw new CalcError(ERR.calculation, 'FETCH FIRST ... WITH TIES needs an ORDER BY clause');
      ties = withTiesLimit(sql, top, Number(first[1] ?? 1), Number(offset?.[1] ?? 0), Math.min(first.index, offset?.index ?? Infinity));
    }
    if (first[1] !== undefined && Number(first[1]) < 1) throw new CalcError(ERR.calculation, 'FETCH FIRST needs a count of at least 1');
  }
  // The limit goes after the last thing in the query, not after a trailing comment or semicolon.
  let end = plain.trimEnd().length;
  while (end > 0 && plain[end - 1] === ';') end = plain.slice(0, end - 1).trimEnd().length;
  let out = `${sql.slice(0, end)} LIMIT ${ties ?? (first ? (first[1] ?? '1') : -1)} OFFSET ${offset ? offset[1] : 0}${sql.slice(end)}`;
  for (const m of [offset, first].filter((x): x is RegExpExecArray => !!x).sort((x, y) => y.index - x.index)) out = out.slice(0, m.index) + ' ' + out.slice(m.index + m[0].length);
  return out;
}

/** Words that end an expression without being part of it, so a trailing one is not an implicit alias. */
const NOT_ALIAS = new Set(['NULL', 'TRUE', 'FALSE', 'END', 'DISTINCT', 'ASC', 'DESC', 'AND', 'OR', 'NOT', 'IS', 'IN', 'LIKE', 'BETWEEN', 'THEN', 'ELSE', 'WHEN', 'CASE', 'ESCAPE', 'COLLATE']);

/** The top-level commas' split of `text` (brackets and quotes respected). */
function splitTop(text: string): string[] {
  const plain = blanked(text);
  const parts: string[] = [];
  for (let i = 0, depth = 0, start = 0; i <= plain.length; i++) {
    if (i === plain.length || (plain[i] === ',' && depth === 0)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    } else if (plain[i] === '(') depth++;
    else if (plain[i] === ')') depth--;
  }
  return parts;
}

/**
 * FETCH FIRST n ROWS WITH TIES: the first n rows after the OFFSET, and every row that sorts equal to the last of
 * them. SQLite has no WITH TIES, so the limit becomes the number of rows whose RANK() over the ORDER BY is no
 * greater than the rank of the row at position offset + n, less the offset: a second pass over the same FROM, WHERE,
 * GROUP BY and HAVING, with the ORDER BY items that name an output column or a position written out. A DISTINCT or a
 * UNION, INTERSECT or EXCEPT is refused (the ranking would run before the duplicates are dropped, or per select).
 */
function withTiesLimit(sql: string, top: string, count: number, offset: number, orderEnd: number): string {
  if (count < 1) throw new CalcError(ERR.calculation, 'FETCH FIRST needs a count of at least 1');
  const select = /\bSELECT\b/i.exec(top);
  const order = /\bORDER\s+BY\b/i.exec(top);
  const from = select ? /\bFROM\b/i.exec(top.slice(select.index)) : undefined;
  if (!select || !order || !from || /\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(top) || /\bDISTINCT\b/i.test(top.slice(select.index, select.index + from.index))) {
    throw unsupported('FETCH FIRST ... WITH TIES with DISTINCT, UNION, INTERSECT, EXCEPT or no FROM');
  }
  const fromAt = select.index + from.index;
  const items = splitTop(sql.slice(select.index + select[0].length, fromAt));
  const named = new Map<string, string>();
  const expressions: string[] = [];
  for (const item of items) {
    const m = /^([\s\S]*?[\w)"'\]])\s+(AS\s+)?([A-Za-z_]\w*|"(?:[^"]|"")+")\s*$/i.exec(item);
    const last = m ? trailingWord(m[1])?.toUpperCase() : undefined;
    const aliased = m && (m[2] || (!NOT_ALIAS.has(m[3].toUpperCase()) && !(last && NOT_ALIAS.has(last))));
    const expression = (aliased ? m![1] : item).trim();
    expressions.push(expression);
    if (aliased) named.set(m![3].replace(/^"|"$/g, '').toLowerCase(), expression);
  }
  const keys = splitTop(sql.slice(order.index + order[0].length, orderEnd)).map((key) => {
    const m = orderKeyParts(key);
    const bare = m.expression;
    const position = /^\d+$/.test(bare) ? expressions[Number(bare) - 1] : undefined;
    if (/^\d+$/.test(bare) && !position) throw new CalcError(ERR.calculation, `ORDER BY ${bare} is not a column of the select list`);
    const alias = /^(?:[A-Za-z_]\w*|"(?:[^"]|"")+")$/.test(bare) ? named.get(bare.replace(/^"|"$/g, '').toLowerCase()) : undefined;
    return `${position ?? alias ?? bare}${m.direction ?? ''}`;
  }).join(', ');
  const rest = sql.slice(fromAt, order.index);
  const ranked = `${sql.slice(0, select.index)}SELECT RANK() OVER (ORDER BY ${keys}) AS fm_r, ROW_NUMBER() OVER (ORDER BY ${keys}) AS fm_n ${rest}`;
  const wanted = offset + count;
  const total = `SELECT COUNT(*) FROM (SELECT fm_r, MAX(CASE WHEN fm_n <= ${wanted} THEN fm_r END) OVER () AS fm_cut FROM (${ranked})) WHERE fm_r <= fm_cut`;
  return `MAX(0, (${total}) - ${offset})`;
}

/** Queries longer than this, or with more selects, keep their stars (the columns are then the table's own). */
const MAX_STAR_QUERY = 200_000;
const MAX_STAR_SELECTS = 50;

/** What the star in a select list needs to know about a table named in FROM: its columns, or nothing for a name that isn't a table. */
export type ColumnsOf = (name: string) => string[] | undefined;

/**
 * `SELECT *` and `SELECT t.*` as the fields of the tables named, written out, so the record's internal columns
 * (_fm_record_id and the rest) don't show up in the result. A select list whose FROM has something this can't
 * name (a table that isn't a table occurrence, with no alias to qualify it) keeps its star.
 */
export function expandStars(sql: string, columnsOf: ColumnsOf): string {
  if (!sql.includes('*') || sql.length > MAX_STAR_QUERY) return sql;
  const plain = blanked(sql);
  const selects = [...plain.matchAll(/\bSELECT\b/gi)];
  if (selects.length > MAX_STAR_SELECTS) return sql;
  // A name the query defines itself (WITH name AS (...)) is that, not a table occurrence of the same name.
  const defined = new Set([...plain.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)(\w+)\s*(?:\([^()]*\)\s*)?AS\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const columnsOfTable: ColumnsOf = (name) => (defined.has(name.replace(/^"|"$/g, '').toLowerCase()) ? undefined : columnsOf(name));
  const depthAt: number[] = [];
  for (let i = 0, d = 0; i < plain.length; i++) {
    if (plain[i] === ')') d--;
    depthAt[i] = d;
    if (plain[i] === '(') d++;
  }
  const edits: { start: number; end: number; text: string }[] = [];
  for (const select of selects) {
    const depth = depthAt[select.index];
    const listStart = select.index + select[0].length;
    let from = -1;
    let listEnd = plain.length;
    for (let i = listStart; i < plain.length; i++) {
      if (depthAt[i] < depth) {
        listEnd = i;
        break;
      }
      if (depthAt[i] === depth && /^FROM\b/i.test(plain.slice(i, i + 5)) && !/\w/.test(plain[i - 1] ?? ' ')) {
        from = i;
        listEnd = i;
        break;
      }
    }
    if (from < 0) continue;
    // The items of the select list that are a bare star.
    const items: { start: number; end: number; qualifier?: string }[] = [];
    for (let start = listStart, i = listStart; i <= listEnd; i++) {
      if (i === listEnd || (plain[i] === ',' && depthAt[i] === depth)) {
        const m = /^(\s*(?:(?:DISTINCT|ALL)\s+)?)(?:("[^"]+"|[\w.]+)\s*\.\s*)?\*\s*$/i.exec(sql.slice(start, i));
        if (m) items.push({ start: start + m[1].length, end: i, qualifier: m[2] });
        start = i + 1;
      }
    }
    if (!items.length) continue;
    // The tables of FROM: up to the clause that ends it.
    let fromEnd = plain.length;
    for (let i = from + 4; i < plain.length; i++) {
      if (depthAt[i] < depth) {
        fromEnd = i;
        break;
      }
      if (depthAt[i] === depth && (/^(?:WHERE|GROUP|HAVING|ORDER|UNION|INTERSECT|EXCEPT|LIMIT|OFFSET|FETCH|WINDOW)\b/i.test(plain.slice(i, i + 9)) && !/\w/.test(plain[i - 1] ?? ' ') || plain[i] === ';')) {
        fromEnd = i;
        break;
      }
    }
    const refs = fromReferences(sql, plain, depthAt, depth, from + 4, fromEnd);
    if (!refs) continue;
    const columns = refs.map((r) => {
      if (r.derived) return { qualifier: r.qualifier, text: `${r.qualifier}.*` };
      const names = columnsOfTable(r.name!);
      if (names) return { qualifier: r.qualifier, text: names.filter((n) => !n.startsWith('_fm_')).map((n) => `${r.qualifier}.${quoteName(n)}`).join(', ') };
      return r.aliased ? { qualifier: r.qualifier, text: `${r.qualifier}.*` } : undefined;
    });
    if (columns.some((c) => !c)) continue;
    const parts = columns as { qualifier: string; text: string }[];
    for (const item of items) {
      const chosen = item.qualifier ? parts.filter((p) => p.qualifier.replace(/^"|"$/g, '').toLowerCase() === item.qualifier!.replace(/^"|"$/g, '').toLowerCase()) : parts;
      if (!chosen.length || chosen.some((p) => !p.text)) continue;
      edits.push({ start: item.start, end: item.end, text: `${chosen.map((p) => p.text).join(', ')} ` });
    }
  }
  if (!edits.length) return sql;
  let out = sql;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const quoteName = (n: string) => `"${n.replace(/"/g, '""')}"`;

/** The tables of a FROM clause: [name], an alias, or a derived table (a bracketed subquery with its alias). */
function fromReferences(sql: string, plain: string, depthAt: number[], depth: number, start: number, end: number): { name?: string; qualifier: string; derived?: boolean; aliased?: boolean }[] | undefined {
  const pieces: [number, number][] = [];
  let at = start;
  for (let i = start; i < end; i++) {
    if (depthAt[i] !== depth) continue;
    const comma = plain[i] === ',';
    const join = !comma && !/\w/.test(plain[i - 1] ?? ' ') && /^JOIN\b/i.test(plain.slice(i, i + 5));
    if (comma || join) {
      pieces.push([at, i]);
      at = comma ? i + 1 : i + 4;
    }
  }
  pieces.push([at, end]);
  const refs: { name?: string; qualifier: string; derived?: boolean; aliased?: boolean }[] = [];
  for (const [a, b] of pieces) {
    // Without its ON condition after it and the join words (INNER, LEFT OUTER...) in front of the next JOIN.
    let upto = b;
    for (let i = a; i < b; i++) {
      if (depthAt[i] === depth && !/\w/.test(plain[i - 1] ?? ' ') && /^ON\b/i.test(plain.slice(i, i + 3))) {
        upto = i;
        break;
      }
    }
    const original = sql.slice(a, upto).replace(/(?:\s+(?:NATURAL|INNER|CROSS|LEFT|OUTER|RIGHT|FULL))+\s*$/i, '');
    if (!original.trim()) return undefined;
    if (original.trimStart()[0] === '(') {
      const open = a + original.indexOf('(');
      const close = closing(sql, open + 1);
      const alias = close < 0 ? null : /^\s*(?:AS\s+)?("[^"]+"|\w+)\s*$/i.exec(original.slice(close + 1 - a));
      if (!alias) return undefined;
      refs.push({ qualifier: alias[1], derived: true });
      continue;
    }
    const m = /^\s*("[^"]+"|[\w.~]+)(?:\s+(?:AS\s+)?("[^"]+"|\w+))?\s*$/i.exec(original);
    if (!m) return undefined;
    // A name with a dot or tilde is quoted, as the table rewrite names it.
    refs.push({ name: m[1], qualifier: m[2] ?? (/^[A-Za-z_]\w*$|^"/.test(m[1]) ? m[1] : quoteName(m[1])), aliased: !!m[2] });
  }
  return refs;
}

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

/** FileMaker's CAST(container AS VARCHAR) returns an embedded file's name, not its internal container id. */
export function containerCastsToName(sql: string, isContainer: (name: string) => boolean): string {
  if (!/\bCAST\b/i.test(sql)) return sql;
  const plain = blanked(sql);
  const cast = /\bCAST\s*\(\s*((?:(?:"(?:[^"]|"")+"|[A-Za-z_]\w*)\s*\.\s*)?(?:"(?:[^"]|"")+"|[A-Za-z_]\w*))\s+AS\s+VARCHAR(?:\s*\(\s*\d+\s*\))?\s*\)/gi;
  return sql.replace(cast, (whole, operand: string, at: number) => {
    if (plain.slice(at, at + 4).toUpperCase() !== 'CAST') return whole;
    const field = /(?:"((?:[^"]|"")+)"|([A-Za-z_]\w*))\s*$/.exec(operand);
    const name = field?.[1]?.replace(/""/g, '"') ?? field?.[2];
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
export function anyAllToIn(sql: string): string {
  if (sql.length > MAX_STAR_QUERY) return sql;
  const rewritten = quantified(sql, { left: MAX_QUANTIFIED, depth: 0 });
  return rewritten === sql ? sql : quantified(numberPlainParameters(sql), { left: MAX_QUANTIFIED, depth: 0 });
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

/** Words SQLite never accepts as a bare column name. Clause and window words (FIRST, LAST, ROW, RANGE, CURRENT, ...) are not here: they can name columns. */
const RESERVED = new Set(('ALL AND AS BETWEEN CASE COLLATE DISTINCT ELSE END ESCAPE EXCEPT EXISTS FROM GLOB GROUP HAVING IN INTERSECT IS ISNULL JOIN LIKE LIMIT '
  + 'NOT NOTNULL NULL ON OR ORDER SELECT THEN UNION USING VALUES WHEN WHERE CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP').split(' '));

type Words = SqlToken[];

const nameOf = (t: SqlToken): string => (t.kind === 'identifier' ? t.text.slice(1, -1) : t.text).toLowerCase();

/** Whether a word is a constant, a call, a parameter, an operator or a type or collation after AS or COLLATE rather than a column name. */
function notColumn(args: Words, at: number): boolean {
  const t = args[at];
  const next = args[at + 1];
  const prev = args[at - 1];
  if (/^(?:\d|\$)/.test(t.text) || (/^x$/i.test(t.text) && next?.kind === 'string')) return true;
  if (next?.text === '(' || (prev && /^[:@]$/.test(prev.text))) return true;
  if (prev && prev.kind === 'word' && /^(?:AS|COLLATE)$/i.test(prev.text)) return true;
  if (RESERVED.has(t.text.toUpperCase())) return true;
  // REGEXP and MATCH are operators between two operands, and columns anywhere else.
  return /^(?:REGEXP|MATCH)$/i.test(t.text) && !!prev && !!next && !/^[-+*/%<>=!|&~(,]$/.test(prev.text) && !/^[,)]$/.test(next.text);
}

/** Whether a subquery refers to a column that it does not take from a table of its own FROM: any word that is not syntax and not a table or alias it declares. */
function subqueryNamesColumn(sub: Words): boolean {
  const own = new Set<string>();
  for (let i = 0; i < sub.length; i++) {
    if (sub[i].kind !== 'word' || !/^(?:FROM|JOIN)$/i.test(sub[i].text)) continue;
    let at = i + 1;
    while (at < sub.length && (sub[at].kind === 'word' || sub[at].kind === 'identifier') && !RESERVED.has(sub[at].text.toUpperCase())) {
      own.add(nameOf(sub[at]));
      if (sub[at + 1]?.text === '.') { at += 2; continue; }
      at++;
      if (/^AS$/i.test(sub[at]?.text ?? '')) at++;
      if (sub[at] && (sub[at].kind === 'word' || sub[at].kind === 'identifier') && !RESERVED.has(sub[at].text.toUpperCase()) && !/^(?:LEFT|RIGHT|INNER|CROSS|NATURAL|OUTER|FULL|WHERE|GROUP|ORDER|LIMIT|HAVING|WINDOW|OFFSET|UNION|ON|USING)$/i.test(sub[at].text)) own.add(nameOf(sub[at++]));
      break;
    }
  }
  for (let i = 0; i < sub.length; i++) {
    const t = sub[i];
    if (t.kind !== 'word' && t.kind !== 'identifier') continue;
    if (t.kind === 'word' && (notColumn(sub, i) || /^(?:SELECT|WITH|VALUES|RECURSIVE|FROM|JOIN|LEFT|RIGHT|INNER|CROSS|NATURAL|OUTER|FULL|ASC|DESC|BY|WINDOW|OFFSET)$/i.test(t.text))) continue;
    if (own.has(nameOf(t))) continue;
    return true;
  }
  return false;
}

/** Whether the arguments of an aggregate name an outer column: a quoted name, a bare word that is not syntax, a call or a parameter, or a subquery that reaches one. */
function namesColumn(args: Words): boolean {
  for (let at = 0; at < args.length; at++) {
    const t = args[at];
    if (t.text === '(' && /^(?:SELECT|WITH|VALUES)$/i.test(args[at + 1]?.text ?? '')) {
      const start = at + 1;
      let depth = 1;
      while (++at < args.length && depth > 0) {
        if (args[at].text === '(') depth++;
        else if (args[at].text === ')') depth--;
      }
      if (subqueryNamesColumn(args.slice(start, at - 1))) return true;
      at--;
      continue;
    }
    if (t.kind === 'identifier') return true;
    if (t.kind === 'word' && !notColumn(args, at)) return true;
  }
  return false;
}

/** A column-free aggregate moved under fm_q would count its rows instead of the outer query's rows. */
function aggregateWithoutColumn(operand: string): boolean {
  const tokens = sqlTokens(operand).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const aggregate = /^(?:COUNT|SUM|AVG|MIN|MAX|TOTAL|GROUP_CONCAT|STRING_AGG|JSON_GROUP_ARRAY|JSON_GROUP_OBJECT)$/i;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind !== 'word' || !aggregate.test(tokens[i].text) || tokens[i + 1].text !== '(') continue;
    let depth = 1;
    let end = i + 2;
    while (end < tokens.length && depth > 0) {
      if (tokens[end].text === '(') depth++;
      else if (tokens[end].text === ')') depth--;
      end++;
    }
    if (depth !== 0) continue;
    if (!namesColumn(tokens.slice(i + 2, end - 1))) return true;
  }
  return false;
}

function quantified(sql: string, budget: { left: number; depth: number }): string {
  if (!/\b(?:ANY|SOME|ALL)\b/i.test(sql) || budget.depth > MAX_QUANTIFIED_DEPTH) return sql;
  const plain = blanked(sql);
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
    const open = m.index + m[0].length;
    const close = closing(sql, open + 1);
    const left = operandStart(sql, m.index);
    if (close < 0 || left < copied || left < 0) continue;
    // A longer expression to the left (a + b, a || b, t.x with a sign) is not this operand alone.
    if (/[-+*/%^.|]$/.test(plain.slice(0, left).trimEnd())) continue;
    const operand = sql.slice(left, m.index).trimEnd();
    if (aggregateWithoutColumn(operand)) continue;
    budget.left--;
    budget.depth++;
    const x = quantified(operand, budget);
    const sub = quantified(sql.slice(open + 1, close), budget);
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
    const last = m ? /(\w+)\s*$/.exec(m[1])?.[1].toUpperCase() : undefined;
    const aliased = m && (m[2] || (!NOT_ALIAS.has(m[3].toUpperCase()) && !(last && NOT_ALIAS.has(last))));
    const expression = (aliased ? m![1] : item).trim();
    expressions.push(expression);
    if (aliased) named.set(m![3].replace(/^"|"$/g, '').toLowerCase(), expression);
  }
  const keys = splitTop(sql.slice(order.index + order[0].length, orderEnd)).map((key) => {
    const m = /^\s*([\s\S]*?)(\s+(?:ASC|DESC))?\s*$/i.exec(key)!;
    const bare = m[1].trim();
    const position = /^\d+$/.test(bare) ? expressions[Number(bare) - 1] : undefined;
    if (/^\d+$/.test(bare) && !position) throw new CalcError(ERR.calculation, `ORDER BY ${bare} is not a column of the select list`);
    const alias = /^(?:[A-Za-z_]\w*|"(?:[^"]|"")+")$/.test(bare) ? named.get(bare.replace(/^"|"$/g, '').toLowerCase()) : undefined;
    return `${position ?? alias ?? bare}${m[2] ?? ''}`;
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

// Apply a field's Default language to a simple SQL ORDER BY field. Expressions,
// joins and derived tables keep their SQL order: their result has no single field
// whose language can be identified without guessing.
import type { Table } from '../../fmp12/src/index.ts';
import { sortFunction, sortLanguage } from '../../calc/src/collation.ts';
import { blanked } from './sql-grammar.ts';

const IDENT = '(?:"(?:[^"]|"")*"|[A-Za-z_][\\w]*)';
const FIELD = new RegExp(`^\\s*(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})(?:\\s+(ASC|DESC))?\\s*$`, 'i');
const unquote = (s: string) => s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;

/**
 * The table a FROM clause names at `at`, and where its text ends. For an account that sees only part of a table
 * (or a table with unstored calculations) the query has already been rewritten to read `FROM (SELECT ... FROM "T"
 * ...) AS "T"`; the table is then the one that select reads from directly.
 */
function tableSource(sql: string, at: number): { name: string; end: number } | undefined {
  const lead = /^\s*/.exec(sql.slice(at))![0].length;
  const start = at + lead;
  if (sql[start] === '(') {
    const plain = blanked(sql);
    let depth = 0;
    let close = -1;
    for (let i = start; i < plain.length && close < 0; i++) {
      if (plain[i] === '(') depth++;
      else if (plain[i] === ')' && --depth === 0) close = i;
    }
    if (close < 0) return undefined;
    const inner = sql.slice(start + 1, close);
    const top = blanked(inner, true);
    if (!/^\s*SELECT\b/i.test(top)) return undefined;
    const innerFrom = /\bFROM\b/i.exec(top);
    if (!innerFrom) return undefined;
    const rest = top.slice(innerFrom.index + innerFrom[0].length);
    const clause = /\b(?:WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|FETCH)\b/i.exec(rest);
    if (/\b(?:JOIN|UNION|INTERSECT|EXCEPT)\b|,/.test(clause ? rest.slice(0, clause.index) : rest)) return undefined;
    const found = tableSource(inner, innerFrom.index + innerFrom[0].length);
    return found && { name: found.name, end: close + 1 };
  }
  const named = /^("(?:[^"]|"")*"|[A-Za-z_][\w]*)/.exec(sql.slice(start));
  return named ? { name: named[1], end: start + named[0].length } : undefined;
}

export function languageOrderBy(sql: string, tables: readonly Table[]): string {
  if (!/\bORDER\s+BY\b/i.test(sql)) return sql;
  const top = blanked(sql, true);
  const from = /\bFROM\b/i.exec(top);
  const order = /\bORDER\s+BY\b/i.exec(top);
  if (!from || !order || order.index < from.index) return sql;
  // Only a directly named table has a field Default language. A join or a
  // derived table can make an unqualified name refer to something else.
  const between = top.slice(from.index + from[0].length, order.index);
  if (/\b(?:JOIN|UNION|INTERSECT|EXCEPT)\b|,/.test(between)) return sql;
  const source = tableSource(sql, from.index + from[0].length);
  if (!source) return sql;
  const table = tables.find((t) => t.name.toLowerCase() === unquote(source.name).toLowerCase());
  if (!table) return sql;
  // ORDER BY a SELECT alias refers to the projected expression in SQL, even
  // when that alias happens to have the same name as a stored field.
  const select = /\bSELECT\b/i.exec(top);
  const projection = select ? sql.slice(select.index + select[0].length, from.index) : '';
  const projectedAliases = new Set([...projection.matchAll(/\bAS\s+("(?:[^"]|"")*"|[A-Za-z_][\w]*)/gi)]
    .map((m) => unquote(m[1]).toLowerCase()));
  const aliasText = sql.slice(source.end, order.index);
  const alias = /^\s*(?:AS\s+)?(?!WHERE\b|GROUP\b|HAVING\b|ORDER\b|LIMIT\b|OFFSET\b)("(?:[^"]|"")*"|[A-Za-z_][\w]*)/i.exec(aliasText)?.[1];
  const qualifier = (alias ? unquote(alias) : table.name).toLowerCase();
  const start = order.index + order[0].length;
  const rest = top.slice(start);
  const boundary = /\b(?:LIMIT|OFFSET|FETCH)\b|;/i.exec(rest);
  const end = boundary ? start + boundary.index : sql.length;
  const segment = sql.slice(start, end);
  const plain = blanked(segment);
  const parts: string[] = [];
  let at = 0;
  let depth = 0;
  for (let i = 0; i <= plain.length; i++) {
    if (i === plain.length || (plain[i] === ',' && depth === 0)) {
      parts.push(segment.slice(at, i));
      at = i + 1;
    } else if (plain[i] === '(') depth++;
    else if (plain[i] === ')') depth--;
  }
  const changed = parts.map((part) => {
    const m = FIELD.exec(part);
    if (!m || (m[1] && unquote(m[1]).toLowerCase() !== qualifier)) return part;
    if (!m[1] && projectedAliases.has(unquote(m[2]).toLowerCase())) return part;
    const field = table.fields.find((f) => f.name.toLowerCase() === unquote(m[2]).toLowerCase());
    if (!field || field.type !== 'text') return part;
    const name = `${m[1] ? `${m[1]}.` : ''}${m[2]}`;
    // Keep the whitespace after the last term, so a following LIMIT is not joined to it.
    return ` ${sortFunction(sortLanguage(field.options?.indexLanguage))}(${name})${m[3] ? ` ${m[3]}` : ''}${/\s*$/.exec(part)![0]}`;
  });
  return sql.slice(0, start) + changed.join(',') + sql.slice(end);
}

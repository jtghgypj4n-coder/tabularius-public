// OData $search: free-text search over the text fields an account can see,
// as a person types into a search box.
//
//   $search=oslo                     a text field contains "oslo"
//   $search=blue whale               both words, in any fields (AND is implied)
//   $search="blue whale"             the phrase
//   $search=whale OR dolphin         either
//   $search=whale NOT blue           NOT, AND, OR and parentheses, as the spec has them
//
// Matching ignores case for A-Z (SQLite's lower()); other letters must match
// as typed. Only stored text fields are searched, as only they can be filtered.

import type { SqlValue } from '../../store/src/find.ts';
import { ApiError } from './dataapi.ts';

export interface SearchProp { name: string; field: string; type: string; queryable: boolean }

const bad = (message: string) => new ApiError(8310, `$search: ${message}`, 400);

/** Terms and nesting one $search may hold, so a long one can't hold up the server or pass SQLite's limits. */
export const SEARCH_LIMIT = { terms: 100, depth: 32 };
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

interface Expr { sql: string }

/** $search as a SQL condition over the props' text columns, with parameters. */
export function searchSql(text: string, props: SearchProp[]): { where: string; params: SqlValue[]; fields: string[] } {
  const columns = props.filter((p) => p.queryable && p.type === 'text');
  if (!columns.length) throw bad('this entity set has no text fields you can search');
  const tokens: { kind: 'word' | 'phrase' | '(' | ')' | 'AND' | 'OR' | 'NOT'; text: string }[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|(\()|(\))|([^\s()"]+))/gy;
  let m: RegExpExecArray | null;
  let at = 0;
  while (at < text.length && (m = re.exec(text))) {
    at = re.lastIndex;
    if (m[1] !== undefined) {
      if (m[1].replace(/\\["\\]/g, '').includes('\\')) throw bad('a phrase may only escape " and \\ with a backslash');
      tokens.push({ kind: 'phrase', text: m[1].replace(/\\(.)/g, '$1') });
    }
    else if (m[2]) tokens.push({ kind: '(', text: '(' });
    else if (m[3]) tokens.push({ kind: ')', text: ')' });
    else if (m[4] === 'AND' || m[4] === 'OR' || m[4] === 'NOT') tokens.push({ kind: m[4], text: m[4] });
    else tokens.push({ kind: 'word', text: m[4] });
  }
  if (text.slice(at).trim()) throw bad(/"/.test(text.slice(at)) ? 'a phrase is not closed' : `can't read "${text.slice(at).trim()}"`);
  if (!tokens.length) throw bad('it is empty');
  const terms = tokens.filter((t) => t.kind === 'word' || t.kind === 'phrase').length;
  if (terms > SEARCH_LIMIT.terms) throw bad(`it has ${terms} terms; at most ${SEARCH_LIMIT.terms}`);
  // Each term is one parameter per text field; SQLite takes at most 32,766 in one statement.
  if (terms * columns.length > 30_000) throw bad(`${terms} terms over ${columns.length} text fields is too many: use fewer terms`);
  // Parameters in the order the SQL names them: pushed as terms are read, never copied.
  const params: SqlValue[] = [];
  let depth = 0;
  let i = 0;
  const peek = () => tokens[i];
  const term = (t: string): Expr => {
    if (!t) throw bad('a phrase is empty');
    for (let k = 0; k < columns.length; k++) params.push(t);
    return { sql: `(${columns.map((c) => `instr(lower(coalesce(${q(c.field)}, '')), lower(?)) > 0`).join(' OR ')})` };
  };
  const nested = (fn: () => Expr): Expr => {
    if (++depth > SEARCH_LIMIT.depth) throw bad(`it nests NOT and parentheses more than ${SEARCH_LIMIT.depth} deep`);
    const e = fn();
    depth--;
    return e;
  };
  const or = (): Expr => {
    let a = and();
    while (peek()?.kind === 'OR') {
      i++;
      const b = and();
      a = { sql: `(${a.sql} OR ${b.sql})` };
    }
    return a;
  };
  // AND binds tighter than OR; two terms side by side are joined by AND.
  const and = (): Expr => {
    let a = not();
    while (peek() && (peek().kind === 'AND' || peek().kind === 'NOT' || peek().kind === 'word' || peek().kind === 'phrase' || peek().kind === '(')) {
      if (peek().kind === 'AND') i++;
      const b = not();
      a = { sql: `(${a.sql} AND ${b.sql})` };
    }
    return a;
  };
  const not = (): Expr => {
    if (peek()?.kind === 'NOT') {
      i++;
      const a = nested(not);
      return { sql: `NOT ${a.sql}` };
    }
    return primary();
  };
  const primary = (): Expr => {
    const t = tokens[i++];
    if (!t) throw bad('it ends too soon');
    if (t.kind === '(') {
      const e = nested(or);
      if (tokens[i++]?.kind !== ')') throw bad('a "(" is not closed');
      return e;
    }
    if (t.kind === 'word' || t.kind === 'phrase') return term(t.text);
    throw bad(`"${t.text}" is out of place`);
  };
  const e = or();
  if (i < tokens.length) throw bad(`"${tokens[i].text}" is out of place`);
  return { where: e.sql, params, fields: columns.map((c) => c.field) };
}

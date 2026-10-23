// Lexical boundaries shared by SQL rewriting and the read-only gate. This is
// not a SQL parser: unsupported grammar is still left to the query compiler.
import { CalcError, ERR } from '../../calc/src/values.ts';

export interface SqlToken {
  kind: 'word' | 'string' | 'identifier' | 'comment' | 'space' | 'symbol' | 'parameter';
  text: string;
  start: number;
  end: number;
}

const invalid = (message: string): never => { throw new CalcError(ERR.calculation, message); };

export function sqlTokens(sql: string, postgres = false): SqlToken[] {
  if (sql.includes('\0')) invalid('SQL text contains a NUL byte');
  const out: SqlToken[] = [];
  for (let i = 0; i < sql.length;) {
    const start = i;
    let kind: SqlToken['kind'] = 'symbol';
    const c = sql[i];
    const previous = out[out.length - 1];
    const bracketIndex = postgres && c === '[' && previous && previous.end === i
      && (['word', 'identifier', 'string'].includes(previous.kind) || [')', ']'].includes(previous.text));
    const arrayBracket = postgres && c === '[' && /\bARRAY\s*$/i.test(sql.slice(Math.max(0, i - 16), i));
    if (/[ \t\n\r\f]/.test(c)) {
      kind = 'space';
      while (i < sql.length && /[ \t\n\r\f]/.test(sql[i])) i++;
    } else if (sql.startsWith('--', i)) {
      kind = 'comment';
      const end = sql.indexOf('\n', i + 2);
      i = end < 0 ? sql.length : end;
    } else if (sql.startsWith('/*', i)) {
      kind = 'comment';
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) invalid('Unterminated SQL comment');
    } else if (postgres && c === '$' && /^\$(?:[A-Za-z_][\w]*\$|\$)/.test(sql.slice(i))) {
      kind = 'string';
      const delimiter = /^\$(?:[A-Za-z_]\w*\$|\$)/.exec(sql.slice(i))![0];
      const end = sql.indexOf(delimiter, i + delimiter.length);
      if (end < 0) invalid('Unterminated SQL string');
      i = end + delimiter.length;
    } else if (c === "'" || c === '"' || c === '`' || (c === '[' && !bracketIndex && !arrayBracket) || (postgres && /[eE]/.test(c) && sql[i + 1] === "'")) {
      const escape = postgres && /[eE]/.test(c);
      if (escape) i++;
      const quote = sql[i++];
      const close = quote === '[' ? ']' : quote;
      kind = quote === "'" ? 'string' : 'identifier';
      let closed = false;
      while (i < sql.length) {
        if (escape && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] !== close) continue;
        if (quote !== '[' && sql[i] === close) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) invalid('Unterminated SQL quote');
    } else if ((c === '$' || c === '?') && /\d/.test(sql[i + 1] ?? '')) {
      kind = 'parameter';
      i += 2;
      while (/\d/.test(sql[i] ?? '')) i++;
    } else if (/[\w$\u0080-\uffff]/.test(c)) {
      kind = 'word';
      i++;
      // SQLite accepts non-ASCII characters in bare names, including emoji
      // and typographic quotes. They must not disappear from privilege scans.
      while (i < sql.length && /[\w$\u0080-\uffff]/.test(sql[i])) i++;
    } else i++;
    out.push({ kind, text: sql.slice(start, i), start, end: i });
  }
  return out;
}

export function sqlName(token: SqlToken): string {
  if (token.kind !== 'identifier' && token.kind !== 'string') return token.text;
  const quote = token.text[0];
  const name = token.text.slice(1, -1);
  return quote === '[' ? name : name.split(quote + quote).join(quote);
}

/** Same offsets, with literals, identifiers and comments hidden from code rewrites. */
export function maskSql(sql: string, postgres = false): string {
  return sqlTokens(sql, postgres).map((t) => ['string', 'identifier', 'comment'].includes(t.kind) ? ' '.repeat(t.text.length) : t.text).join('');
}

/** Remove comments before handing SQL to SQLite, whose block comments do not nest. */
export function cleanSql(sql: string, postgres = false): string {
  return sqlTokens(sql, postgres).map((t) => {
    if (t.kind === 'comment') return ' ';
    if (t.kind === 'identifier') return `"${sqlName(t).replace(/"/g, '""')}"`;
    if (postgres && t.kind === 'string' && t.text[0] !== "'") {
      let value: string;
      if (t.text[0] === '$') {
        const delimiter = t.text.slice(0, t.text.indexOf('$', 1) + 1);
        value = t.text.slice(delimiter.length, -delimiter.length);
      } else {
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', "'": "'", '"': '"', '\\': '\\' };
        value = t.text.slice(2, -1).replace(/''|\\([\s\S])/g, (m, c: string | undefined) => {
          if (c === undefined) return "'";
          if (!(c in escapes)) invalid('Unsupported SQL string escape');
          return escapes[c];
        });
      }
      return `'${value.replace(/'/g, "''")}'`;
    }
    return t.text;
  }).join('');
}

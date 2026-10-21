// FileMaker SQL's date and time syntax, for SQLite underneath. Dates, times and
// timestamps are kept as ISO text ("2024-02-03", "10:30:00", "2024-02-03T10:30:00"),
// so a literal written the FileMaker or standard way becomes that text, and the
// date functions read it.
import { sqlTokens } from './sql-tokens.ts';
import { charCount } from '../../calc/src/text.ts';
import { CalcError, ERR } from '../../calc/src/values.ts';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

const two = (n: number) => String(n).padStart(2, '0');

function isoDate(s: string): string | undefined {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const real = (y: number, mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
  if (m) return real(+m[1], +m[2], +m[3]) ? `${m[1]}-${two(+m[2])}-${two(+m[3])}` : undefined;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m && real(+m[3], +m[1], +m[2]) ? `${m[3]}-${two(+m[1])}-${two(+m[2])}` : undefined;
}

function isoTime(s: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(s.trim());
  return m ? `${two(+m[1])}:${m[2]}:${m[3] === undefined ? '00' : m[3].replace(/^(\d)(\.|$)/, '0$1$2')}` : undefined;
}

function isoTimestamp(s: string): string | undefined {
  const m = /^(\S+)[ T](\S+)$/.exec(s.trim());
  const d = m && isoDate(m[1]);
  const t = m && isoTime(m[2]);
  return d && t ? `${d}T${t}` : undefined;
}

const LITERALS: Record<string, (s: string) => string | undefined> = { d: isoDate, date: isoDate, t: isoTime, time: isoTime, ts: isoTimestamp, timestamp: isoTimestamp };

/** Reads a quoted run (a string or a quoted name) from `i`, up to and including its closing quote. */
function quoted(sql: string, i: number): string {
  const q = sql[i];
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === q) {
      if (sql[j + 1] !== q) return sql.slice(i, j + 1);
      j++;
    }
    j++;
  }
  return sql.slice(i);
}

/** The query split into code, quoted runs, and comments: [text, isCode] pieces. */
function pieces(sql: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  for (const t of sqlTokens(sql)) {
    const code = !['string', 'identifier', 'comment'].includes(t.kind);
    const last = out[out.length - 1];
    if (code && last?.[1]) last[0] += t.text;
    else out.push([t.text, code]);
  }
  return out;
}

/** Closing parenthesis matching the one before `from`, skipping strings; -1 when there is none. */
export function closing(sql: string, from: number): number {
  for (let i = from, depth = 1; i < sql.length;) {
    const c = sql[i];
    if (c === "'" || c === '"') i += quoted(sql, i).length;
    else if (sql.startsWith('--', i) || sql.startsWith('/*', i)) {
      const line = sql[i + 1] === '-';
      const end = line ? sql.indexOf('\n', i + 2) : sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + (line ? 0 : 2);
    }
    else if (c === '(') depth++, i++;
    else if (c === ')' && --depth === 0) return i;
    else i++;
  }
  return -1;
}

/** Top-level position of the word IN in `s`, outside strings and brackets; -1 when there is none. */
function topLevelIn(s: string): number {
  for (let i = 0, depth = 0; i < s.length;) {
    const c = s[i];
    if (c === "'" || c === '"') i += quoted(s, i).length;
    else if (s.startsWith('--', i) || s.startsWith('/*', i)) {
      const line = s[i + 1] === '-';
      const end = line ? s.indexOf('\n', i + 2) : s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + (line ? 0 : 2);
    }
    else if (c === '(') depth++, i++;
    else if (c === ')') depth--, i++;
    else if (depth === 0 && /^\sIN\s/i.test(s.slice(i, i + 4))) return i;
    else i++;
  }
  return -1;
}

const LITERAL_LEAD = /(?:(\{\s*)(d|t|ts)|\b(DATE|TIMESTAMP|TIME))\s*$/i;
const LEAD_TAIL = 256;

/**
 * What ends `out` as {d / {t / {ts or DATE / TIME / TIMESTAMP. `tail` is the last LEAD_TAIL characters of `out`, kept as
 * it grows: reading `out` itself for every string made a query of thousands of strings quadratic. The tail answers when it
 * holds the whole lead, the word and what is before it; when blanks (or a long word) push the start of the lead out of
 * it, the whole of `out` is searched.
 */
function literalLead(out: string, tail: string): RegExpExecArray | null {
  const base = out.length - tail.length;
  if (base > 0 && !holdsLead(tail)) return LITERAL_LEAD.exec(out);
  const found = LITERAL_LEAD.exec(tail);
  if (found) found.index += base;
  return found;
}

function holdsLead(tail: string): boolean {
  const core = tail.trimEnd();
  const word = core.length - /[A-Za-z]*$/.exec(core)![0].length;
  let before = word;
  while (before > 0 && /\s/.test(core[before - 1])) before--;
  return before > 0;
}

/**
 * Date and time literals ({d '2026-01-01'}, {t '10:30:00'}, {ts '...'}, DATE '...',
 * TIME '...', TIMESTAMP '...'), the ROWMODID column, EXTRACT ( unit FROM x ) and
 * POSITION ( a IN b ), CURRENT_DATE / CURRENT_TIME / CURRENT_TIMESTAMP (the local time, where
 * SQLite's own are UTC) and `x + INTERVAL n UNIT`, written the way SQLite reads them.
 */
export function fileMakerSqlSyntax(sql: string, columnKind?: (name: string) => 'string' | 'date' | undefined): string {
  if (!/[{+\-^]|\*\*|\b(?:DATE|TIME|TIMESTAMP|ROWMODID|EXTRACT|POSITION|STRVAL|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|INTERVAL)\b/i.test(sql)) return sql;
  sql = withBooleanStrval(withOperators(withPower(sql), columnKind));
  const parts = pieces(sql);
  let out = '';
  let tail = '';
  for (let i = 0; i < parts.length; i++) {
    const [text, isCode] = parts[i];
    if (isCode) {
      out += text;
      tail = (tail + text).slice(-LEAD_TAIL);
      continue;
    }
    // A string straight after {d / DATE: the literal, in ISO form (and the closing brace of {d '...'} goes with it).
    const lead = text[0] === "'" ? literalLead(out, tail) : null;
    const iso = lead && LITERALS[(lead[2] ?? lead[3]).toLowerCase()](text.slice(1, -1).replace(/''/g, "'"));
    const next = parts[i + 1];
    const braces = !!lead?.[1];
    if (iso && (!braces || (next?.[1] && /^\s*\}/.test(next[0])))) {
      out = out.slice(0, lead.index) + `'${iso}'`;
      tail = out.slice(-LEAD_TAIL);
      if (braces) next![0] = next![0].replace(/^\s*\}/, '');
    } else if (lead && !iso && (!braces || (next?.[1] && /^\s*\}/.test(next[0])))) {
      // Not a real date, time or timestamp: an error when the query runs (the rewrite itself never fails).
      const kind = (lead[2] ?? lead[3]).toLowerCase();
      out = out.slice(0, lead.index) + `fm_invalid('${kind === 'd' || kind === 'date' ? 'date' : kind === 't' || kind === 'time' ? 'time' : 'timestamp'}', ${text})`;
      tail = out.slice(-LEAD_TAIL);
      if (braces) next![0] = next![0].replace(/^\s*\}/, '');
    } else {
      out += text;
      tail = (tail + text).slice(-LEAD_TAIL);
    }
  }
  out = pieces(out).map(([text, isCode]) => isCode
    ? text.replace(/\bROWMODID\b/gi, '_fm_mod_id').replace(/\bEXTRACT\s*\(\s*(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)\s+FROM\s+/gi, '$1(')
    : text[0] === '"' ? text.replace(/^"ROWMODID"$/i, '"_fm_mod_id"') : text).join('');
  out = withLocalNow(out);
  out = withIntervals(out);
  for (let from = 0, at: number; ;) {
    at = -1;
    let pos = 0;
    for (const [text, isCode] of pieces(out)) {
      if (isCode && at < 0) {
        const start = Math.max(0, from - pos);
        const found = /\bPOSITION\s*\(/i.exec(text.slice(start));
        if (found) at = pos + start + found.index;
      }
      pos += text.length;
    }
    if (at < 0) break;
    const open = out.indexOf('(', at);
    const end = closing(out, open + 1);
    // If this opening has no matching close, no later opening can have one either.
    if (end < 0) break;
    const split = topLevelIn(out.slice(open + 1, end));
    if (split < 0) {
      // Not the standard form: left for SQLite to report.
      from = end + 1;
      continue;
    }
    const inner = out.slice(open + 1, end);
    out = `${out.slice(0, at)}instr(${inner.slice(split + 4)}, ${inner.slice(0, split)})${out.slice(end + 1)}`;
    from = at;
  }
  return out;
}

/** CURRENT_DATE, CURRENT_TIME and CURRENT_TIMESTAMP as the local-time functions (outside strings and names). */
function withLocalNow(sql: string): string {
  const call: Record<string, string> = { DATE: 'CURDATE()', TIME: 'CURTIME()', TIMESTAMP: 'NOW()' };
  const swap = (text: string) => text.replace(/\bCURRENT_(DATE|TIME|TIMESTAMP)\b(?!\s*\()/gi, (_m: string, w: string) => call[w.toUpperCase()]);
  return pieces(sql).map(([text, isCode]) => (isCode ? swap(text) : text)).join('');
}

/**
 * USER, USERNAME and CURRENT_USER: the signed-in account's name as a string. A word that is also a field's name, a
 * qualified name (t.USER) or a call (USER()) is left alone.
 */
export function withAccount(sql: string, account: string, fieldNames: ReadonlySet<string>): string {
  if (!/\b(?:USER|USERNAME|CURRENT_USER)\b/i.test(sql)) return sql;
  const literal = `'${account.replace(/'/g, "''")}'`;
  return pieces(sql).map(([text, isCode]) => (isCode
    ? text.replace(/(\.\s*)?\b(USER|USERNAME|CURRENT_USER)\b(?!\s*[(.])/gi, (m: string, dot: string | undefined, word: string) =>
      (dot || fieldNames.has(word.toLowerCase()) ? m : literal))
    : text)).join('');
}

/** Start of the operand that ends just before `end`: a quoted run, a name, a number, or a call with its brackets. */
export function operandStart(sql: string, end: number): number {
  let i = end;
  while (i > 0 && /\s/.test(sql[i - 1])) i--;
  if (i === 0) return -1;
  const last = sql[i - 1];
  if (last === "'") {
    for (let j = i - 2; j >= 0; j--) {
      if (sql[j] === last) {
        if (sql[j - 1] === last) j--;
        else return j;
      }
    }
    return -1;
  }
  if (last === ')') {
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (sql[j] === ')') depth++;
      else if (sql[j] === '(' && --depth === 0) {
        let k = j;
        while (k > 0 && /[\w.]/.test(sql[k - 1])) k--;
        return k;
      }
    }
    return -1;
  }
  const component = (at: number): number => {
    if (sql[at - 1] === '"') {
      for (let j = at - 2; j >= 0; j--) {
        if (sql[j] === '"') {
          if (sql[j - 1] === '"') j--;
          else return j;
        }
      }
      return -1;
    }
    let j = at;
    while (j > 0 && /[\w?\u0080-\uffff]/.test(sql[j - 1])) j--;
    return j < at ? j : -1;
  };
  let start = component(i);
  if (start < 0) return -1;
  while (start > 0) {
    let dot = start;
    while (dot > 0 && /\s/.test(sql[dot - 1])) dot--;
    if (sql[dot - 1] !== '.') break;
    let before = dot - 1;
    while (before > 0 && /\s/.test(sql[before - 1])) before--;
    const previous = component(before);
    if (previous < 0) break;
    start = previous;
  }
  return start;
}

/** Length of the quoted run or comment starting at `i`, 0 when there is none. */
function skippable(sql: string, i: number): number {
  const c = sql[i];
  if (c === "'" || c === '"') return quoted(sql, i).length;
  if ((c === '-' && sql[i + 1] === '-') || (c === '/' && sql[i + 1] === '*')) {
    const line = c === '-';
    const end = line ? sql.indexOf('\n', i + 2) : sql.indexOf('*/', i + 2);
    return (end < 0 ? sql.length : end + (line ? 0 : 2)) - i;
  }
  return 0;
}

/** Operands longer than this, and operators beyond the first MAX_REWRITES in a query, are left as SQLite reads them. */
const WINDOW = 5000;
const MAX_REWRITES = 2000;
/** Queries longer than this keep SQLite's reading of the operators altogether. */
const MAX_OPERATOR_QUERY = 200_000;

/** closing(), giving up after `limit` characters. */
function closingWithin(sql: string, from: number, limit: number): number {
  for (let i = from, depth = 1, stop = Math.min(sql.length, from + limit); i < stop;) {
    const skip = skippable(sql, i);
    if (skip) i += skip;
    else if (sql[i] === '(') depth++, i++;
    else if (sql[i] === ')' && --depth === 0) return i;
    else i++;
  }
  return -1;
}

/** Words that are never the operand of an operator (a keyword in front of the operator is not its left side). */
const KEYWORDS = new Set(['SELECT', 'DISTINCT', 'ALL', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ON', 'BY', 'HAVING', 'AS', 'UNION', 'LIMIT', 'OFFSET', 'SET', 'VALUES', 'EXISTS', 'ANY', 'SOME', 'ESCAPE', 'GROUP', 'ORDER', 'JOIN', 'USING', 'WITH', 'INTERVAL', 'ASC', 'DESC', 'COLLATE', 'BY']);

/** The operand ending the text: a quoted run, a name, a number, a call with its brackets, or a date constant. */
function leftOperand(text: string, end = text.trimEnd().length): { start: number; text: string } | undefined {
  let start: number;
  if (text[end - 1] === '}') start = text.lastIndexOf('{', end - 1);
  else {
    start = operandStart(text, end);
    if (start >= 0 && text[start] === "'") {
      const typed = /\b(?:DATE|TIME|TIMESTAMP)\s*$/i.exec(text.slice(Math.max(0, start - 12), start));
      if (typed) start -= typed[0].length;
    }
  }
  if (start < 0) return undefined;
  const word = /^[A-Za-z_]\w*/.exec(text.slice(start, start + 40));
  if (word && KEYWORDS.has(word[0].toUpperCase())) return undefined;
  return { start, text: text.slice(start, end) };
}

/** The operand starting at or after `from`: the same shapes, with an optional sign. */
function rightOperand(sql: string, from: number, signed = false): { end: number; text: string } | undefined {
  let i = from;
  while (i < sql.length && /\s/.test(sql[i])) i++;
  const start = i;
  if (signed && (sql[i] === '-' || sql[i] === '+')) {
    i++;
    while (i < sql.length && /\s/.test(sql[i])) i++;
  }
  const typed = /^(?:DATE|TIMESTAMP|TIME)\s*(?=')/i.exec(sql.slice(i, i + 12));
  if (typed) i += typed[0].length;
  const c = sql[i];
  if (c === "'" || c === '"') i += quoted(sql, i).length;
  else if (c === '{') {
    const close = sql.indexOf('}', i);
    if (close < 0 || close - i > WINDOW) return undefined;
    i = close + 1;
  } else if (c === '(') {
    const close = closingWithin(sql, i + 1, WINDOW);
    if (close < 0) return undefined;
    i = close + 1;
  } else {
    const word = /^[\w.?]+/.exec(sql.slice(i, i + 200));
    if (!word || KEYWORDS.has(word[0].toUpperCase())) return undefined;
    i += word[0].length;
    let j = i;
    while (j < sql.length && j - i < 50 && /\s/.test(sql[j])) j++;
    if (sql[j] === '(') {
      const close = closingWithin(sql, j + 1, WINDOW);
      if (close < 0) return undefined;
      i = close + 1;
    }
  }
  return { end: i, text: sql.slice(start, i) };
}

/**
 * The text before an operator, and the operator's own rewrite: `cut` is where in `before` the left operand starts,
 * `end` where in the query the right operand ends, and `call` replaces everything between.
 */
type Rewrite = (width: number, before: string, sql: string, opEnd: number) => { cut: number; end: number; call: string } | undefined;

/**
 * Rewrites the infix operators `operator` finds (outside strings, names and comments), left to right, each with
 * its operands as `make` reads them from a window of the text around it, so a long query costs time in proportion
 * to its length. Returns the query itself when nothing was rewritten.
 */
function rewriteInfix(sql: string, operator: (sql: string, i: number) => number, make: Rewrite, budget: { left: number }): string {
  const done: string[] = [];
  let doneLength = 0;
  let tail = '';
  let copied = 0;
  let rewrites = 0;
  const push = (text: string) => {
    if (!text) return;
    done.push(text);
    doneLength += text.length;
  };
  const trim = (n: number) => {
    while (n > 0 && done.length) {
      const last = done[done.length - 1];
      if (last.length <= n) {
        done.pop();
        n -= last.length;
        doneLength -= last.length;
      } else {
        done[done.length - 1] = last.slice(0, last.length - n);
        doneLength -= n;
        n = 0;
      }
    }
  };
  const retail = () => {
    let k = done.length;
    for (let len = 0; k > 0 && len < WINDOW;) len += done[--k].length;
    tail = done.slice(k).join('').slice(-WINDOW);
  };
  for (let i = 0; i < sql.length;) {
    const skip = skippable(sql, i);
    if (skip) {
      i += skip;
      continue;
    }
    const width = operator(sql, i);
    if (!width) {
      i++;
      continue;
    }
    const gap = i - copied;
    const before = gap >= WINDOW ? sql.slice(i - WINDOW, i) : (tail + sql.slice(copied, i)).slice(-WINDOW);
    const hit = budget.left > 0 ? make(width, before, sql, i + width) : undefined;
    // An operand that reaches the start of a window that is not the start of the text may be longer than the window.
    if (!hit || (hit.cut === 0 && doneLength + gap > WINDOW)) {
      i += width;
      continue;
    }
    const removed = before.length - hit.cut;
    if (removed <= gap) push(sql.slice(copied, i - removed));
    else {
      push(sql.slice(copied, i));
      trim(removed);
    }
    push(hit.call);
    retail();
    copied = hit.end;
    i = hit.end;
    rewrites++;
    budget.left--;
  }
  return rewrites ? done.join('') + sql.slice(copied) : sql;
}

/** A rewrite repeated until it changes nothing (a rewritten operand's own arguments are looked at on the next round). */
function untilSteady(sql: string, step: (sql: string) => string): string {
  for (let round = 0; round < 16; round++) {
    const next = step(sql);
    if (next === sql) return sql;
    sql = next;
  }
  return sql;
}

const STRING_FUNCTIONS = new Set(['CHR', 'SPACE', 'RTRIM', 'LTRIM', 'TRIM', 'UPPER', 'LOWER', 'LEFT', 'RIGHT', 'SUBSTR', 'SUBSTRING', 'STRVAL', 'DAYNAME', 'MONTHNAME', 'FM_CAT', 'FM_CATB']);
const DATE_FUNCTIONS = new Set(['DATEVAL', 'CURDATE', 'TODAY', 'FM_DATEADD']);

type Kind = 'string' | 'text' | 'date';

/**
 * What an operand is known to be from how it is written: 'string' for a string constant or a string function's
 * result, 'date' for a date constant, date function or date field, 'text' for a text field (which, unlike a string
 * constant, joins only another string or text field), or nothing certain.
 */
function kindOf(operand: string, columnKind?: (name: string) => 'string' | 'date' | undefined): Kind | undefined {
  const t = operand.trim();
  if (t[0] === "'") return 'string';
  if (/^DATE\s*'/i.test(t) || /^\{\s*d\b/i.test(t) || /^CURRENT_DATE\b(?!\s*\()/i.test(t)) return 'date';
  const call = /^([A-Za-z_]\w*)\s*\(/.exec(t);
  if (call) {
    const name = call[1].toUpperCase();
    return STRING_FUNCTIONS.has(name) ? 'string' : DATE_FUNCTIONS.has(name) ? 'date' : undefined;
  }
  const field = t[0] === '"' && t.endsWith('"') && t.length > 1 ? t.slice(1, -1).replace(/""/g, '"') : /^[\w.]+$/.test(t) ? t.slice(t.lastIndexOf('.') + 1) : undefined;
  const kind = field === undefined ? undefined : columnKind?.(field.toLowerCase());
  return kind === 'string' ? 'text' : kind;
}

/** The operand at the left of an operator, widened over any `*`, `/` or `%` chain in front of it (they bind tighter). */
function widenedLeft(before: string): { start: number; text: string } | undefined {
  const end = before.trimEnd().length;
  let left = leftOperand(before, end);
  while (left) {
    const head = before.slice(0, left.start).trimEnd();
    if (head.endsWith('||')) return undefined;
    if (!/[*/%]$/.test(head)) break;
    left = leftOperand(head.slice(0, -1), head.length - 1);
    if (left) left = { start: left.start, text: before.slice(left.start, end) };
  }
  return left;
}

/** The operand at the right of an operator, widened over any `*`, `/` or `%` chain after it. */
function widenedRight(sql: string, from: number): { end: number; text: string } | undefined {
  const first = rightOperand(sql, from);
  if (!first) return undefined;
  let end = first.end;
  for (;;) {
    let j = end;
    while (j < sql.length && /\s/.test(sql[j])) j++;
    if (sql.startsWith('||', j)) return undefined;
    if (!'*/%'.includes(sql[j] ?? '\u0000') || sql.startsWith('**', j)) break;
    const next = rightOperand(sql, j + 1, true);
    if (!next) return undefined;
    end = next.end;
  }
  return { end, text: sql.slice(first.end - first.text.length, end) };
}

/**
 * Operators SQLite reads differently from FileMaker SQL, when an operand shows what it is: `+` and `-` on strings
 * (joining them; `-` moves the first one's trailing blanks to the end) and on dates (a date plus or minus days, one
 * date minus another as a number of days). A text field joins only a string or another text field, so a number
 * kept as text still adds. Anything else is left as SQLite does arithmetic.
 */
function withOperators(sql: string, columnKind?: (name: string) => 'string' | 'date' | undefined): string {
  if (sql.length > MAX_OPERATOR_QUERY) return sql;
  const budget = { left: MAX_REWRITES };
  return untilSteady(sql, (text) => rewriteInfix(text, (q, i) => (q[i] === '+' || q[i] === '-' ? 1 : 0), (width, before, q, opEnd) => {
    if (/^\s*INTERVAL\b/i.test(q.slice(opEnd, opEnd + 12))) return undefined;
    const right = widenedRight(q, opEnd);
    const left = right && widenedLeft(before);
    if (!left || !right) return undefined;
    const lk = kindOf(left.text, columnKind);
    const rk = kindOf(right.text, columnKind);
    const op = q[opEnd - width];
    const strong = lk === 'string' || rk === 'string';
    const dates = lk === 'date' || rk === 'date';
    const join = strong || (!dates && lk === 'text' && rk === 'text');
    if (!join && !dates) return undefined;
    const call = join ? `${op === '-' ? 'fm_catb' : 'fm_cat'}(${left.text}, ${right.text})` : `fm_dateadd(${left.text}, ${right.text}, ${op === '-' ? -1 : 1})`;
    return { cut: left.start, end: right.end, call };
  }, budget));
}

/**
 * `a ^ b` and `a ** b` (exponentiation) as power(a, b). A minus sign in front of the base belongs to it, as
 * the Claris precedence list puts the unary minus above the exponent: -2 ^ 2 is 4.
 */
function withPower(sql: string): string {
  if (!/\^|\*\*/.test(sql) || sql.length > MAX_OPERATOR_QUERY) return sql;
  const operator = (q: string, i: number) => (q[i] === '^' ? 1 : q[i] === '*' && q[i + 1] === '*' ? 2 : 0);
  const budget = { left: MAX_REWRITES };
  return untilSteady(sql, (text) => rewriteInfix(text, operator, (width, before, q, opEnd) => {
    const right = rightOperand(q, opEnd, true);
    const left = right && leftOperand(before);
    if (!left || !right) return undefined;
    let start = left.start;
    const sign = /(?:^|[(,=<>+*/^-]|\b(?:SELECT|DISTINCT|WHERE|AND|OR|WHEN|THEN|ELSE|ON|BY|HAVING|NOT))\s*([+-])\s*$/i.exec(before.slice(0, start));
    if (sign) start = before.slice(0, start).lastIndexOf(sign[1]);
    return { cut: start, end: right.end, call: `power(${before.slice(start).trim()}, ${right.text.trim()})` };
  }, budget));
}

/**
 * STRVAL of a comparison (or other condition) gives the text False or True, as the Claris page shows with
 * STRVAL(4 = 5). SQLite has no boolean type, so the argument is wrapped in fm_strbool when its top level is a
 * condition: a comparison, AND, OR, NOT, IS, LIKE, BETWEEN, IN or EXISTS outside every bracket and CASE.
 */
function withBooleanStrval(sql: string): string {
  if (!/\bSTRVAL\s*\(/i.test(sql) || sql.length > MAX_OPERATOR_QUERY) return sql;
  // The query with strings, names and comments blanked out, so positions line up with `sql`.
  const code = pieces(sql).map(([text, isCode]) => (isCode ? text : ' '.repeat(text.length))).join('');
  const edits: { open: number; end: number }[] = [];
  for (const m of code.matchAll(/\bSTRVAL\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    if (edits.length > MAX_REWRITES) break;
    const end = closing(code, open + 1);
    if (end < 0) continue;
    let depth = 0;
    let cases = 0;
    let condition = false;
    let comma = false;
    const inner = code.slice(open + 1, end);
    for (const t of inner.matchAll(/[(),]|<>|!=|<=|>=|[=<>]|\b[A-Za-z_]+\b/g)) {
      const w = t[0].toUpperCase();
      if (w === '(') depth++;
      else if (w === ')') depth--;
      else if (w === 'CASE') cases++;
      else if (w === 'END') cases--;
      else if (depth === 0 && cases === 0) {
        if (w === ',') comma = true;
        else if (/^(?:<>|!=|<=|>=|=|<|>|AND|OR|NOT|IS|LIKE|BETWEEN|IN|EXISTS)$/.test(w)) condition = true;
      }
    }
    if (condition && !comma) edits.push({ open, end });
  }
  if (!edits.length) return sql;
  // Every edit is a pair of insertions, applied from the right so earlier positions stay where they are.
  const at = edits.flatMap((e) => [{ pos: e.open + 1, text: 'fm_strbool(' }, { pos: e.end, text: ')' }]).sort((x, y) => y.pos - x.pos);
  let out = sql;
  for (const i of at) out = out.slice(0, i.pos) + i.text + out.slice(i.pos);
  return out;
}

/**
 * `x + INTERVAL n UNIT` and `x - INTERVAL n UNIT` (YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, with
 * or without a final S), as a call of fm_date_add. An INTERVAL with no value to its left is
 * left for SQLite to report, as the Claris page says it cannot stand alone.
 */
function withIntervals(sql: string): string {
  const re = /([+-])\s*INTERVAL\s+(\d+|\?\d*)\s+(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)S?\b/gi;
  const hits: { at: number; end: number; sign: string; n: string; unit: string }[] = [];
  let pos = 0;
  for (const [text, isCode] of pieces(sql)) {
    if (isCode) {
      re.lastIndex = 0;
      for (let m: RegExpExecArray | null; (m = re.exec(text));) {
        hits.push({ at: pos + m.index, end: pos + m.index + m[0].length, sign: m[1], n: m[2], unit: m[3].toUpperCase() });
      }
    }
    pos += text.length;
  }
  if (!hits.length) return sql;
  const edits: { start: number; end: number; replacement: string }[] = [];
  for (const hit of hits) {
    let start = operandStart(sql, hit.at);
    if (start < 0) continue;
    const previous = edits.at(-1);
    // The source operand can begin inside an earlier edit (a chain), or enclose
    // earlier edits (a parenthesized expression or a call). Fold both cases.
    if (previous && start > previous.start && start < previous.end) start = previous.start;
    const included: typeof edits = [];
    while (edits.length && edits[edits.length - 1].start >= start) included.push(edits.pop()!);
    let operand = '';
    let cursor = start;
    for (let i = included.length - 1; i >= 0; i--) {
      const edit = included[i];
      operand += sql.slice(cursor, edit.start) + edit.replacement;
      cursor = edit.end;
    }
    operand += sql.slice(cursor, hit.at);
    edits.push({ start, end: hit.end, replacement: `fm_date_add(${operand.trimEnd()}, ${hit.n}, '${hit.unit}', ${hit.sign === '-' ? -1 : 1})` });
  }
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += sql.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + sql.slice(cursor);
}

const NAMES_OF_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NAMES_OF_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Parts { y?: number; m?: number; d?: number; h?: number; mi?: number; s?: number }

function partsOf(v: SQLOutputValue): Parts | undefined {
  if (typeof v !== 'string') return undefined;
  const ts = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/.exec(v);
  if (ts) return { y: +ts[1], m: +ts[2], d: +ts[3], ...(ts[4] === undefined ? {} : { h: +ts[4], mi: +ts[5], s: +ts[6] }) };
  const t = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(v);
  return t ? { h: +t[1], mi: +t[2], s: +t[3] } : undefined;
}

const field = (key: keyof Parts) => (v: SQLOutputValue): SQLInputValue => partsOf(v)?.[key] ?? null;

const now = () => new Date();
const localDate = (n: Date) => `${n.getFullYear()}-${two(n.getMonth() + 1)}-${two(n.getDate())}`;
const localTime = (n: Date) => `${two(n.getHours())}:${two(n.getMinutes())}:${two(n.getSeconds())}`;

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A date, time or timestamp moved by n units; years and months stop at the end of a shorter month.
 * SQL timestamps have no zone or offset here. UTC component arithmetic avoids host-TZ normalization, so an
 * interval may produce a local time inside a DST gap. Claris's SQL reference does not specify that gap case. */
function addInterval(v: SQLOutputValue, n: number, unit: string): SQLInputValue {
  const p = partsOf(v);
  if (!p || !Number.isInteger(n)) return null;
  const dated = p.y !== undefined;
  const timed = p.h !== undefined;
  if (unit === 'YEAR' || unit === 'MONTH' || unit === 'DAY') {
    if (!dated) return null;
    let y = p.y!;
    let m = p.m!;
    let d = p.d!;
    if (unit !== 'DAY') {
      const total = y * 12 + (m - 1) + (unit === 'YEAR' ? n * 12 : n);
      y = Math.floor(total / 12);
      m = (total % 12 + 12) % 12 + 1;
      d = Math.min(d, daysIn(y, m));
    } else {
      const t = new Date(Date.UTC(y, m - 1, d + n));
      [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
    }
    const date = `${String(y).padStart(4, '0')}-${two(m)}-${two(d)}`;
    return timed ? `${date}T${two(p.h!)}:${two(p.mi!)}:${two(p.s!)}` : date;
  }
  if (!timed) return null;
  const secs = unit === 'HOUR' ? n * 3600 : unit === 'MINUTE' ? n * 60 : n;
  if (!dated) {
    const t = (((p.h! * 3600 + p.mi! * 60 + p.s! + secs) % 86400) + 86400) % 86400;
    return `${two(Math.floor(t / 3600))}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)}`;
  }
  const t = new Date(Date.UTC(p.y!, p.m! - 1, p.d!, p.h!, p.mi!, p.s! + secs));
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}T${two(t.getUTCHours())}:${two(t.getUTCMinutes())}:${two(t.getUTCSeconds())}`;
}

/** The date, time, string and number functions of FileMaker SQL (and ODBC), for SQLite functions of the same names. */
export const SQL_DATE_FUNCTIONS: Record<string, (...args: SQLOutputValue[]) => SQLInputValue> = {
  YEAR: field('y'), MONTH: field('m'), DAY: field('d'), HOUR: field('h'), MINUTE: field('mi'), SECOND: field('s'),
  DAYOFWEEK: (v) => {
    const p = partsOf(v);
    return p?.y === undefined ? null : new Date(Date.UTC(p.y, p.m! - 1, p.d!)).getUTCDay() + 1;
  },
  DAYNAME: (v) => {
    const p = partsOf(v);
    return p?.y === undefined ? null : NAMES_OF_DAYS[new Date(Date.UTC(p.y, p.m! - 1, p.d!)).getUTCDay()];
  },
  MONTHNAME: (v) => {
    const p = partsOf(v);
    return p?.m === undefined ? null : NAMES_OF_MONTHS[p.m - 1];
  },
  CURDATE: () => localDate(now()),
  CURTIME: () => localTime(now()),
  NOW: () => { const instant = now(); return `${localDate(instant)}T${localTime(instant)}`; },
  CURTIMESTAMP: () => { const instant = now(); return `${localDate(instant)}T${localTime(instant)}`; },
  TODAY: () => localDate(now()),
  DATEVAL: (v) => (typeof v === 'string' ? isoDate(v) ?? null : null),
  TIMEVAL: (v) => (typeof v === 'string' ? isoTime(v) ?? null : null),
  TIMESTAMPVAL: (v) => (typeof v === 'string' ? isoTimestamp(v) ?? null : null),
  fm_invalid: (kind, text) => { throw new CalcError(ERR.calculation, `Invalid ${String(kind)} constant '${String(text)}'`); },
  fm_date_add: (v, n, unit, sign) => addInterval(v, Number(n) * Number(sign), String(unit)),
  LEFT: (v, n) => (v === null || n === null ? null : [...String(v)].slice(0, Math.max(0, Math.trunc(Number(n)))).join('')),
  RIGHT: (v, n) => {
    if (v === null || n === null) return null;
    const chars = [...String(v)];
    return chars.slice(Math.max(0, chars.length - Math.max(0, Math.trunc(Number(n))))).join('');
  },
  SPACE: (n) => (n === null ? null : ' '.repeat(Math.min(Math.max(0, Math.trunc(Number(n))), 1_000_000))),
  CHR: (n) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 127 ? String.fromCharCode(n) : null),
  STRVAL: (v) => (v === null ? null : String(v)),
  // The argument of a STRVAL that is a condition (see withBooleanStrval): SQLite's 0 and 1 as FileMaker's False and True.
  fm_strbool: (v) => (v === null ? null : v === 0 || v === 0n ? 'False' : v === 1 || v === 1n ? 'True' : String(v)),
  NUMVAL: (v) => {
    if (typeof v === 'number') return v;
    const t = typeof v === 'string' ? v.trim() : '';
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return Number(t);
    // The Claris page: the function fails when the string is not a valid number (an empty one is just empty).
    if (t) throw new CalcError(ERR.calculation, `NUMVAL: ${JSON.stringify(t)} is not a valid number`);
    return null;
  },
  INT: (v) => (typeof v === 'number' ? Math.trunc(v) : null),
  // ROUND(x, digits): half away from zero, and a negative digits rounds to tens, hundreds... (SQLite's round has no such thing).
  ROUND: (v, digits) => {
    if (v === null) return null;
    // As SQLite's own round for what it reads: text that is not a number is 0, and digits far out change nothing.
    const x = Number(v);
    if (Number.isNaN(x)) return 0;
    const n = digits === undefined || digits === null || Number.isNaN(Number(digits)) ? 0 : Math.trunc(Number(digits));
    if (!Number.isFinite(x) || n > 30) return x;
    if (n < -300) return 0;
    const abs = Math.abs(x);
    // Through the decimal text where it can be, so 1.005 rounds to 1.01.
    const rounded = Math.round(/e/i.test(String(abs)) ? abs * 10 ** n : Number(`${abs}e${n}`));
    return Math.sign(x) * (/e/i.test(String(rounded)) ? rounded / 10 ** n : Number(`${rounded}e${-n}`));
  },
  // `+` and `-` on strings (see withOperators); a missing operand gives a missing result.
  fm_cat: (a, b) => (a === null || b === null ? null : String(a) + String(b)),
  fm_catb: (a, b) => {
    if (a === null || b === null) return null;
    const first = String(a);
    const second = String(b);
    const kept = first.replace(/ +$/, '') + second.replace(/ +$/, '');
    return kept + ' '.repeat(first.length + second.length - kept.length);
  },
  // `+` and `-` on dates: a date plus or minus days, a date minus a date (days between); otherwise plain arithmetic.
  fm_dateadd: (a, b, sign) => {
    if (a === null || b === null) return null;
    const day = (v: SQLOutputValue) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const days = (v: string) => Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / 86_400_000;
    const s = Number(sign);
    if (day(a) && day(b)) return s < 0 ? days(a as string) - days(b as string) : null;
    if (day(a)) return addInterval(a, Math.trunc(Number(b)) * s, 'DAY');
    if (day(b) && s > 0) return addInterval(b, Math.trunc(Number(a)), 'DAY');
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? x + s * y : null;
  },
  DEG: (v) => (typeof v === 'number' ? (v * 180) / Math.PI : null),
  DEGREES: (v) => (typeof v === 'number' ? (v * 180) / Math.PI : null),
  CHAR_LENGTH: (v) => (v === null ? null : charCount(String(v))),
  // Claris SQL changes each letter's case, as in calculation Lower and Upper (not SQLite's ASCII-only defaults).
  // https://help.claris.com/en/sql-reference/content/functions-that-return-character-strings.html
  LOWER: (v) => (v === null ? null : String(v).toLowerCase()),
  UPPER: (v) => (v === null ? null : String(v).toUpperCase()),
};

/** How many positional slots SQLite allocates, outside strings, names and comments. */
export function placeholders(sql: string): number {
  let highest = 0;
  for (const [text, isCode] of pieces(sql)) {
    if (!isCode) continue;
    for (const m of text.matchAll(/\?(\d*)/g)) {
      if (m[1]) highest = Math.max(highest, +m[1]);
      else highest++;
    }
  }
  return highest;
}

/** The statement alone: a query may end in a semicolon, but not carry a second statement after it. */
export function oneStatement(sql: string): boolean {
  let seen = false;
  for (const [text, isCode] of pieces(sql)) {
    if (!isCode) {
      if (seen && (text[0] === "'" || text[0] === '"')) return false;
      continue;
    }
    for (const ch of text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')) {
      if (ch === ';') seen = true;
      else if (seen && !/\s/.test(ch)) return false;
    }
  }
  return true;
}

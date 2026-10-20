// Reference copied from main's SQL rewrite before the single-pass interval change.
// Keep this independent of production helpers so it detects output regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileMakerSqlSyntax } from '../src/sql-dates.ts';

const two = (n: number) => String(n).padStart(2, '0');

function isoDate(s: string): string | undefined {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${two(+m[2])}-${two(+m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${two(+m[1])}-${two(+m[2])}` : undefined;
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

/** The query with its code split from its quoted strings and names: [text, isCode] pieces. */
function pieces(sql: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let code = '';
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'" || sql[i] === '"') {
      if (code) out.push([code, true]), (code = '');
      const q = quoted(sql, i);
      out.push([q, false]);
      i += q.length;
    } else code += sql[i++];
  }
  if (code) out.push([code, true]);
  return out;
}

/** Closing parenthesis matching the one before `from`, skipping strings; -1 when there is none. */
function closing(sql: string, from: number): number {
  for (let i = from, depth = 1; i < sql.length;) {
    const c = sql[i];
    if (c === "'" || c === '"') i += quoted(sql, i).length;
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
    else if (c === '(') depth++, i++;
    else if (c === ')') depth--, i++;
    else if (depth === 0 && /^\sIN\s/i.test(s.slice(i, i + 4))) return i;
    else i++;
  }
  return -1;
}

/**
 * Date and time literals ({d '2026-01-01'}, {t '10:30:00'}, {ts '...'}, DATE '...',
 * TIME '...', TIMESTAMP '...'), the ROWMODID column, EXTRACT ( unit FROM x ) and
 * POSITION ( a IN b ), CURRENT_DATE / CURRENT_TIME / CURRENT_TIMESTAMP (the local time, where
 * SQLite's own are UTC) and `x + INTERVAL n UNIT`, written the way SQLite reads them.
 */
function referenceFileMakerSqlSyntax(sql: string): string {
  if (!/\{|\b(?:DATE|TIME|TIMESTAMP|ROWMODID|EXTRACT|POSITION|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|INTERVAL)\b/i.test(sql)) return sql;
  const parts = pieces(sql);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const [text, isCode] = parts[i];
    if (isCode) {
      out += text;
      continue;
    }
    // A string straight after {d / DATE: the literal, in ISO form (and the closing brace of {d '...'} goes with it).
    const lead = text[0] === "'" ? /(?:(\{\s*)(d|t|ts)|\b(DATE|TIMESTAMP|TIME))\s*$/i.exec(out) : null;
    const iso = lead && LITERALS[(lead[2] ?? lead[3]).toLowerCase()](text.slice(1, -1).replace(/''/g, "'"));
    const next = parts[i + 1];
    const braces = !!lead?.[1];
    if (iso && (!braces || (next?.[1] && /^\s*\}/.test(next[0])))) {
      out = out.slice(0, lead.index) + `'${iso}'`;
      if (braces) next![0] = next![0].replace(/^\s*\}/, '');
    } else out += text;
  }
  out = out.replace(/\bROWMODID\b/gi, '_fm_mod_id').replace(/\bEXTRACT\s*\(\s*(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)\s+FROM\s+/gi, '$1(');
  out = withLocalNow(out);
  out = withIntervals(out);
  for (let from = 0, at: number; (at = out.slice(from).search(/\bPOSITION\s*\(/i)) >= 0;) {
    at += from;
    const open = out.indexOf('(', at);
    const end = closing(out, open + 1);
    const split = end < 0 ? -1 : topLevelIn(out.slice(open + 1, end));
    if (split < 0) {
      // Not the standard form: left for SQLite to report.
      from = open;
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

/** Start of the operand that ends just before `end`: a quoted run, a name, a number, or a call with its brackets. */
function operandStart(sql: string, end: number): number {
  let i = end;
  while (i > 0 && /\s/.test(sql[i - 1])) i--;
  if (i === 0) return -1;
  const last = sql[i - 1];
  if (last === "'" || last === '"') {
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
  let k = i;
  while (k > 0 && /[\w.?]/.test(sql[k - 1])) k--;
  return k < i ? k : -1;
}

/**
 * `x + INTERVAL n UNIT` and `x - INTERVAL n UNIT` (YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, with
 * or without a final S), as a call of fm_date_add. An INTERVAL with no value to its left is
 * left for SQLite to report, as the Claris page says it cannot stand alone.
 */
function withIntervals(sql: string): string {
  const re = /([+-])\s*INTERVAL\s+(\d+|\?\d*)\s+(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)S?\b/i;
  let out = sql;
  for (let from = 0; ;) {
    const code = pieces(out);
    let pos = 0;
    let hit: { at: number; len: number; sign: string; n: string; unit: string } | undefined;
    for (const [text, isCode] of code) {
      if (isCode && !hit) {
        const m = re.exec(text.slice(Math.max(0, from - pos)));
        if (m) hit = { at: pos + Math.max(0, from - pos) + m.index, len: m[0].length, sign: m[1], n: m[2], unit: m[3].toUpperCase() };
      }
      pos += text.length;
    }
    if (!hit) return out;
    const start = operandStart(out, hit.at);
    if (start < 0) {
      from = hit.at + hit.len;
      continue;
    }
    const operand = out.slice(start, hit.at).trimEnd();
    out = `${out.slice(0, start)}fm_date_add(${operand}, ${hit.n}, '${hit.unit}', ${hit.sign === '-' ? -1 : 1})${out.slice(hit.at + hit.len)}`;
    from = start;
  }
}


const corpus = [
  "SELECT d + INTERVAL 1 DAY + INTERVAL 2 DAY",
  "SELECT (d + INTERVAL 1 DAY) + INTERVAL 2 DAY",
  "SELECT DATE(d + INTERVAL 1 DAY) + INTERVAL 2 DAY",
  "SELECT ((d - INTERVAL 1 HOUR)) - INTERVAL 1 MINUTE",
  "SELECT DATE '2024-1-2' + INTERVAL 2 DAYS",
  "SELECT {d '2024-1-2'} - INTERVAL ? MONTHS",
  "SELECT POSITION('a' IN 'cat')",
  "SELECT POSITION('a' IN POSITION('b' IN c))",
  "SELECT EXTRACT(YEAR FROM d), EXTRACT(MONTH FROM d)",
  "SELECT CURRENT_DATE, CURRENT_TIME, CURRENT_TIMESTAMP",
  "SELECT d + INTERVAL 1 DAY, t - INTERVAL 2 HOURS",
  "SELECT (d + INTERVAL 1 DAY), t - INTERVAL 2 HOURS",
  "SELECT ABS(d + INTERVAL 1 DAY) + INTERVAL 2 DAYS",
  "SELECT POSITION('x' IN (d + INTERVAL 1 DAY))",
  "SELECT DATE '2024-1-2' + INTERVAL 1 DAY + INTERVAL 1 MONTH",
  "SELECT (d + INTERVAL 1 DAY) + INTERVAL 2 DAY + INTERVAL 3 DAY",
  ...['d', '(d)', 'DATE(d)', '((d))'].flatMap((operand) =>
    [' + INTERVAL 1 DAY', ' - INTERVAL ?2 HOURS'].flatMap((first) =>
      ['', ' + INTERVAL 2 DAYS', ' - INTERVAL 3 MINUTES'].map((second) =>
        `SELECT ${operand}${first}${second}`))),
  ...['YEAR', 'MONTH', 'DAY', 'HOUR'].map((unit) =>
    `SELECT POSITION('x' IN EXTRACT(${unit} FROM d + INTERVAL 1 DAY))`),
];

test('SQL rewrite matches main for interval, POSITION and EXTRACT corpus', () => {
  for (const query of corpus) assert.equal(fileMakerSqlSyntax(query), referenceFileMakerSqlSyntax(query), query);
});

test('SQL rewrite handles long interval and POSITION stress inputs promptly', () => {
  const inputs = [
    'SELECT ' + "'x' ".repeat(3000) + ' + INTERVAL 1 DAY'.repeat(3000),
    'POSITION('.repeat(12000),
  ];
  for (const query of inputs) {
    const start = performance.now();
    fileMakerSqlSyntax(query);
    assert.ok(performance.now() - start < 2000, 'SQL rewrite exceeded two seconds');
  }
});

// The two rules of FileMaker's SQL that SQLite does not enforce and the Claris reference states: every column in the
// select list and HAVING of a grouped query is grouped or aggregated (FQL0025), and the columns of the two sides of a
// UNION have the same types (FQL0027). Both work on the query text outside strings, quoted names and comments, and
// refuse only what they can see for certain: a name that is a field of the file, outside every aggregate and subquery,
// and not named by the GROUP BY; two sides whose columns are both plain fields of known, different types. A query
// they cannot read with certainty runs as written, so what FileMaker accepts is never refused here.
import { CalcError, ERR } from '../../calc/src/values.ts';
import { blanked } from './sql-grammar.ts';

/** Queries longer than this, and queries with more selects, are not checked. */
const MAX_CHECKED_QUERY = 200_000;
/** Token comparisons the GROUP BY check may spend on one expression list (about a tenth of a second). */
const MAX_GROUP_WORK = 20_000_000;
const MAX_CHECKED_SELECTS = 50;

interface Token { kind: 'id' | 'str' | 'num' | 'punct'; text: string }

/** The tokens of an expression: names (quotes removed), strings, numbers and single punctuation marks. */
function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (/\s/.test(c)) i++;
    else if (c === '-' && text[i + 1] === '-') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i + 2) < 0 ? text.length : text.indexOf('*/', i + 2) + 2;
    else if (c === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      out.push({ kind: 'str', text: text.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      out.push({ kind: 'id', text: text.slice(i + 1, j).replace(/""/g, '"').toLowerCase() });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[\w$]+/.exec(text.slice(i))!;
      out.push({ kind: 'id', text: m[0].toLowerCase() });
      i += m[0].length;
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(text[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(text.slice(i))!;
      out.push({ kind: 'num', text: m[0] });
      i += m[0].length;
    } else {
      out.push({ kind: 'punct', text: c });
      i++;
    }
  }
  return out;
}

/** Text split at the commas that are not inside brackets. */
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

interface Select { listStart: number; listEnd: number; group?: [number, number]; having?: [number, number]; setOperator: boolean; depth: number; end: number }

/** Every SELECT of the query with the extent of its select list, GROUP BY and HAVING. */
function selectsOf(sql: string): Select[] | undefined {
  const plain = blanked(sql);
  const depthAt: number[] = [];
  for (let i = 0, d = 0; i < plain.length; i++) {
    if (plain[i] === ')') d--;
    depthAt[i] = d;
    if (plain[i] === '(') d++;
  }
  const found = [...plain.matchAll(/\bSELECT\b/gi)];
  if (found.length > MAX_CHECKED_SELECTS) return undefined;
  const out: Select[] = [];
  for (const m of found) {
    const depth = depthAt[m.index];
    const listStart = m.index + m[0].length;
    const marks: { word: string; at: number; length: number }[] = [];
    let end = plain.length;
    let setOperator = false;
    for (const k of plain.slice(listStart).matchAll(/\b(FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|FETCH|WINDOW|UNION|INTERSECT|EXCEPT)\b|;/gi)) {
      const at = listStart + k.index;
      if (depthAt[at] < depth) break;
      if (depthAt[at] !== depth) continue;
      const word = k[0].toUpperCase().replace(/\s+/g, ' ');
      if (word === ';') { end = at; break; }
      if (/^(?:UNION|INTERSECT|EXCEPT)$/.test(word)) { end = at; setOperator = true; break; }
      marks.push({ word, at, length: k[0].length });
    }
    // The end of the select is the first closing bracket of its own level, when no set operator or semicolon came first.
    if (end === plain.length) {
      for (let i = listStart; i < plain.length; i++) if (depthAt[i] < depth) { end = i; break; }
    }
    const group = marks.find((x) => x.word === 'GROUP BY');
    const having = marks.find((x) => x.word === 'HAVING');
    const stops = (at: number) => Math.min(end, ...marks.filter((x) => x.at > at).map((x) => x.at));
    out.push({
      listStart,
      listEnd: Math.min(end, ...marks.map((x) => x.at)),
      group: group ? [group.at + group.length, stops(group.at)] : undefined,
      having: having ? [having.at + having.length, stops(having.at)] : undefined,
      setOperator,
      depth,
      end,
    });
  }
  return out;
}

/** Words that are not column references wherever they stand. */
const WORDS = new Set([
  'and', 'or', 'not', 'is', 'null', 'true', 'false', 'in', 'like', 'between', 'exists', 'any', 'some', 'all', 'case', 'when', 'then', 'else', 'end',
  'as', 'distinct', 'asc', 'desc', 'escape', 'collate', 'interval', 'date', 'time', 'timestamp', 'current_date', 'current_time', 'current_timestamp',
  'cast', 'user', 'username', 'current_user', 'select', 'from', 'where', 'by', 'year', 'month', 'day', 'hour', 'minute', 'second',
]);
/** Functions that take a group of rows: the columns inside them are aggregated. FileMaker lists five; the rest are what SQLite also reads as aggregates. */
const AGGREGATES = new Set(['sum', 'avg', 'count', 'max', 'min', 'total', 'group_concat', 'stdev', 'stddev', 'var', 'variance']);

/** The index just after the bracket that closes the one opened at `open`. */
function skipBrackets(list: Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < list.length; i++) {
    if (list[i].text === '(' && list[i].kind === 'punct') depth++;
    else if (list[i].text === ')' && list[i].kind === 'punct' && --depth === 0) return i + 1;
  }
  return list.length;
}


/** A column of the file used outside every aggregate and subquery that `grouped` does not cover, or undefined. */
function ungrouped(expression: string, fields: ReadonlySet<string>, grouped: Set<string>, groupedExpressions: Token[][], ignore: ReadonlySet<string>): string | undefined {
  const list = tokens(expression);
  const masked = new Array<boolean>(list.length).fill(false);
  // Every place the select list repeats a grouped expression is found by comparing tokens, stopping at the first
  // that differs. A query that would need more than MAX_GROUP_WORK comparisons is left unchecked, like one that is
  // too long: the check is a courtesy to the author, and it must not be a way to hold the server's thread.
  if (list.length * groupedExpressions.reduce((n, g) => n + g.length, 0) > MAX_GROUP_WORK) return undefined;
  for (const g of groupedExpressions) {
    for (let i = 0; i + g.length <= list.length; i++) {
      let k = 0;
      while (k < g.length && list[i + k].text === g[k].text) k++;
      if (k === g.length) for (let m = i; m < i + g.length; m++) masked[m] = true;
    }
  }
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (masked[i] || t.kind !== 'id') continue;
    const next = list[i + 1];
    const before = list[i - 1];
    if (next?.text === '(' && next.kind === 'punct') {
      if (AGGREGATES.has(t.text)) i = skipBrackets(list, i + 1) - 1;
      continue;
    }
    if (next?.text === '.' && next.kind === 'punct') continue; // a qualifier
    if (before?.text === 'as' || (WORDS.has(t.text) && before?.text !== '.')) continue;
    if (before?.text === 'interval' || list[i - 2]?.text === 'interval') continue;
    if (!fields.has(t.text) || grouped.has(t.text) || ignore.has(t.text)) continue;
    return t.text;
  }
  return undefined;
}

/** The item without its alias: `SUM(x) AS total` and `x total` are `SUM(x)` and `x`. */
function itemOf(item: string): { expression: string; alias?: string } {
  const m = /^([\s\S]*?[\w)"'\]])\s+(AS\s+)?([A-Za-z_]\w*|"(?:[^"]|"")+")\s*$/i.exec(item);
  const last = m ? /(\w+)\s*$/.exec(m[1])?.[1].toLowerCase() : undefined;
  const aliased = m && (m[2] || (!WORDS.has(m[3].toLowerCase()) && !(last && WORDS.has(last))));
  return aliased ? { expression: m![1].trim(), alias: m![3].replace(/^"|"$/g, '').toLowerCase() } : { expression: item.trim() };
}

/**
 * FQL0025: in a query with a GROUP BY, a column in the select list or HAVING must be grouped or inside an aggregate.
 * A group item may be a name, an expression the select list repeats, a position, or a select-list alias.
 */
export function checkGrouping(sql: string, fields: ReadonlySet<string>): void {
  if (sql.length > MAX_CHECKED_QUERY || !/\bGROUP\s+BY\b/i.test(sql)) return;
  const selects = selectsOf(sql);
  if (!selects) return;
  for (const select of selects) {
    if (!select.group) continue;
    const items = splitTop(sql.slice(select.listStart, select.listEnd)).map(itemOf);
    const byAlias = new Map<string, (typeof items)[number]>();
    for (const i of items) if (i.alias && !byAlias.has(i.alias)) byAlias.set(i.alias, i);
    const grouped = new Set<string>();
    const groupedExpressions: Token[][] = [];
    const addGroup = (expression: string) => {
      const t = tokens(expression);
      if (t.length === 1 && t[0].kind === 'id') grouped.add(t[0].text);
      else if (t.length === 3 && t[0].kind === 'id' && t[1].text === '.' && t[2].kind === 'id') grouped.add(t[2].text);
      else if (t.length) groupedExpressions.push(t);
    };
    for (const g of splitTop(sql.slice(...select.group))) {
      const bare = g.trim();
      if (/^\d+$/.test(bare)) {
        const item = items[Number(bare) - 1];
        if (item) addGroup(item.expression);
        continue;
      }
      addGroup(bare);
      // A name that is also a select-list alias groups that item too.
      const alias = byAlias.get(bare.replace(/^"|"$/g, '').toLowerCase());
      if (alias) addGroup(alias.expression);
    }
    const aliases = new Set(items.flatMap((i) => (i.alias ? [i.alias] : [])));
    const where = [...items.map((i) => ({ text: i.expression, ignore: new Set<string>() })), ...(select.having ? [{ text: sql.slice(...select.having), ignore: aliases }] : [])];
    for (const { text, ignore } of where) {
      // A subquery in the item has its own grouping: its text is taken out before the walk.
      const own = removeSubqueries(text);
      // A window function ranges over the rows of the groups in ways not read here.
      if (/\bOVER\b/i.test(blanked(own))) continue;
      const bad = ungrouped(own, fields, grouped, groupedExpressions, ignore);
      if (bad) throw new CalcError(ERR.calculation, `FQL0025: all non-aggregated column references in the SELECT list and HAVING clause must be in the GROUP BY clause (${bad})`);
    }
  }
}

/** The text with every bracketed subquery (a bracket that opens with SELECT or WITH) replaced by a space. */
function removeSubqueries(text: string): string {
  const plain = blanked(text);
  let out = '';
  let copied = 0;
  for (const m of plain.matchAll(/\(\s*(?:SELECT|WITH)\b/gi)) {
    if (m.index < copied) continue;
    let depth = 0;
    let close = plain.length - 1;
    for (let i = m.index; i < plain.length; i++) {
      if (plain[i] === '(') depth++;
      else if (plain[i] === ')' && --depth === 0) { close = i; break; }
    }
    out += text.slice(copied, m.index) + ' 0 ';
    copied = close + 1;
  }
  return out + text.slice(copied);
}

/**
 * FQL0027: the corresponding columns of the two sides of a UNION must have the same type. Only a column that is a plain
 * field of the file counts, with a type the file gives it once (a name two tables give different types is unknown),
 * and a side with a star in its select list is not compared.
 */
export function checkUnionTypes(sql: string, typeOf: (field: string) => string | undefined): void {
  if (sql.length > MAX_CHECKED_QUERY || !/\bUNION\b/i.test(sql)) return;
  const selects = selectsOf(sql);
  if (!selects) return;
  for (let i = 0; i < selects.length; i++) {
    if (!selects[i].setOperator) continue;
    // The select that follows at the same level is the other side.
    const next = selects.slice(i + 1).find((s) => s.depth === selects[i].depth && s.listStart > selects[i].end);
    if (!next) continue;
    const types = (s: Select) => splitTop(sql.slice(s.listStart, s.listEnd)).map((item) => {
      const t = tokens(itemOf(item).expression);
      if (t.some((x) => x.text === '*')) return null;
      const name = t.length === 1 && t[0].kind === 'id' ? t[0].text : t.length === 3 && t[0].kind === 'id' && t[1].text === '.' && t[2].kind === 'id' ? t[2].text : undefined;
      return name ? typeOf(name) : undefined;
    });
    const left = types(selects[i]);
    const right = types(next);
    if (left.includes(null) || right.includes(null) || left.length !== right.length) continue;
    for (let k = 0; k < left.length; k++) {
      if (left[k] && right[k] && left[k] !== right[k]) throw new CalcError(ERR.calculation, `FQL0027: column ${k + 1} of the two sides of a UNION has different types (${left[k]} and ${right[k]})`);
    }
  }
}

// FileMaker find requests -> SQL. Supports the operators people use most:
//   abc      a word in the field starts with "abc" (FileMaker's default)
//   =abc     a word in the field matches "abc" exactly
//   ==abc    the whole field matches "abc" exactly
//   =        field is empty          *     field is not empty
//   <, <=, >, >=, a...b (range)     *, @ and # wildcards, "quoted phrase"
//   ! duplicates, // today, ? invalid numeric/temporal data, ~ relaxed text
// Requests are applied in order: includes add records and omits subtract them.
// Related fields ("Occurrence::Field") match a record when one of its related
// records matches all of that occurrence's criteria; the store supplies that.

import type { FieldType } from '../../fmp12/src/index.ts';
import type { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { q } from './import.ts';
import { compareKeys, foldText, sortKey, sortLanguage } from '../../calc/src/collation.ts';
import { wordQuery } from './words.ts';
import { nativeValue } from './native-types.ts';

export type FindRequest = Record<string, string | number> & { omit?: string | boolean };
export type SqlValue = string | number | null;

export interface FieldInfo {
  name: string;
  type: FieldType;
  /** Calculation fields are read-only. */
  calculated?: boolean;
  /** Default language: Japanese-indexed fields support contains matching for relaxed text, and every language orders the words of a range find its own way. */
  indexLanguage?: string;
  /** Summary fields have a value per found set, not per record. */
  summary?: boolean;
  /** A repeating field (more than one repetition), kept as a JSON array: a criterion matches any repetition. */
  repetitions?: number;
}

export class FindError extends Error {
  readonly code: number;
  constructor(message: string, code = 102) {
    super(message);
    this.code = code;
  }
}

/** The table (or computed source) before this find's other criteria and omit requests. */
export type FindSource = () => { from: string; params: SqlValue[] };

const temporal = (type: FieldType) => type === 'date' || type === 'time' || type === 'timestamp';
const textType = (type: FieldType) => type === 'text' || type === 'unknown';
const nativeNumber = (type: FieldType) => type === 'integer' || type === 'decimal';
const scalarOnly = (type: FieldType) => type === 'boolean' || type === 'json' || type === 'uuid';

/** Unicode compatibility forms include width variants and compatibility ideographs. */
function fold(text: string, relaxed: boolean): string {
  let s = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  if (relaxed) {
    s = s.replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCodePoint(c.codePointAt(0)! - 0x60));
    const small = 'ぁぃぅぇぉっゃゅょゎゕゖ';
    const large = 'あいうえおつやゆよわかけ';
    s = s.replace(/[ぁぃぅぇぉっゃゅょゎゕゖ]/g, (c) => large[small.indexOf(c)]);
  }
  return s;
}

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, month, day] = m.slice(1).map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && y <= 4000 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function validTime(s: string, timestamp = false): boolean {
  const m = /^(-?)(\d+):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s);
  return !!m && Number(m[3]) < 60 && Number(m[4] ?? 0) < 60
    && (!timestamp || (!m[1] && Number(m[2]) < 24));
}

const regexLiteral = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Bound both compilation and the iterative matcher. These limits apply on every find surface.
const MAX_CRITERION = 4096;
const MAX_MATCH_WORK = 4_000_000;
// Count requests and fields together, leaving room for each criterion's SQL below SQLite's expression depth limit.
const MAX_QUERY_PARTS = 256;
const matchBudget = new AsyncLocalStorage<{ remaining: number } | undefined>();

/** One budget for a complete find, including related fields, repetitions and repeated SQL evaluations. */
export function beginFindBudget(): () => void {
  const previous = matchBudget.getStore();
  if (!previous) matchBudget.enterWith({ remaining: MAX_MATCH_WORK });
  return () => matchBudget.enterWith(previous);
}

const tooComplex = () => new FindError('Find criterion exceeds the supported complexity limit', 400);
const boundary = (c: string) => /[\s\p{P}]/u.test(c);
type Token = { kind: '*' | '@' | '#' } | { kind: 'literal'; value: RegExp };
type TextPattern = (value: string) => boolean;

/** Compile a small NFA: each input character advances all active states once, without backtracking or recursion. */
function textPattern(raw: string, relaxed: boolean, japanese = false): TextPattern {
  if (raw.length > MAX_CRITERION) throw tooComplex();
  const whole = raw.startsWith('==');
  const exact = whole || raw.startsWith('=');
  const s = [...raw.slice(whole ? 2 : exact ? 1 : 0)];
  const tokens: Token[] = [];
  let quoted = false, wildcard = false;
  const literal = (c: string) => {
    for (const v of foldText(relaxed ? fold(c, true) : c)) tokens.push({ kind: 'literal', value: new RegExp(`^${regexLiteral(v)}$`, 'iu') });
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (++i === s.length) throw new FindError('A find escape must be followed by a character', 400);
      literal(s[i]);
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '*' || c === '@' || c === '#')) {
      wildcard = true;
      // Adjacent stars have identical meaning and need only one state.
      if (c !== '*' || tokens.at(-1)?.kind !== '*') tokens.push({ kind: c });
    } else literal(c);
  }
  if (quoted) throw new FindError('A find phrase must have a closing quote', 400);
  const contains = japanese && !exact;
  return (value) => {
    // Relaxed matching also bounds normalization. Ordinary values are streamed, without a character array.
    const budget = matchBudget.getStore() ?? { remaining: MAX_MATCH_WORK };
    if (relaxed && (budget.remaining -= value.length) < 0) throw tooComplex();
    const chars = foldText(relaxed ? fold(value, true) : value)[Symbol.iterator]();
    let previous: string | undefined;
    let states = new Uint8Array(tokens.length + 1);
    let next = new Uint8Array(tokens.length + 1);
    for (let part = chars.next(); ; part = chars.next()) {
      budget.remaining -= tokens.length + 1;
      if (budget.remaining < 0) throw tooComplex();
      const char = part.done ? undefined : part.value;
      if (previous === undefined || (!whole && (contains || boundary(previous)))) states[0] = 1;
      // Epsilon transitions for zero characters consumed by '*'.
      for (let j = 0; j < tokens.length; j++) if (states[j] && tokens[j].kind === '*') states[j + 1] = 1;
      // A trailing star can consume the entire remaining value, so no further input is needed.
      if (states[tokens.length] && (tokens.at(-1)?.kind === '*' || char === undefined
        || (!whole && (contains || (!exact && !wildcard) || boundary(char))))) return true;
      if (char === undefined) break;
      next.fill(0);
      for (let j = 0; j < tokens.length; j++) {
        if (!states[j]) continue;
        const token = tokens[j];
        if (token.kind === '*') next[j] = 1;
        else if (token.kind === '@' || (token.kind === '#' ? /^[0-9]$/.test(char) : token.kind === 'literal' && token.value.test(char))) next[j + 1] = 1;
      }
      [states, next] = [next, states];
      previous = char;
    }
    return false;
  };
}

/** Functions used only by the shared find compiler; no caller interprets operators itself. */
export function registerFindFunctions(db: DatabaseSync): void {
  db.function('fm_find_key', { deterministic: true }, (v) => v == null ? null : fold(String(v), false));
  db.function('fm_find_invalid', { deterministic: true }, (v, type) => {
    if (v == null || v === '') return 0;
    const s = String(v);
    const parts = s.split('T');
    const valid = type === 'number' ? /[0-9]/.test(s) : type === 'date' ? validDate(s) : type === 'time' ? validTime(s)
      : parts.length === 2 && validDate(parts[0]) && validTime(parts[1], true);
    return valid ? 0 : 1;
  });
  // A text range: some word of the value lies between the bounds in index order (Claris: "Text: first to last word,
  // based on the index order of words"), which is the order of the field's language: the order a sort on it gives.
  // A null bound is open; op says whether it counts. The bounds come in as typed, and are put in order here.
  db.function('fm_find_word_range', { deterministic: true }, (v, lo, loIncl, hi, hiIncl, language) => {
    if (v == null || v === '') return 0;
    const id = typeof language === 'string' ? language : 'en';
    const low = lo == null ? undefined : sortKey(String(lo), id);
    const high = hi == null ? undefined : sortKey(String(hi), id);
    for (const w of String(v).split(/[\s\p{P}]+/u)) {
      if (!w) continue;
      const k = sortKey(w, id);
      if (low !== undefined && (loIncl ? compareKeys(k, low) < 0 : compareKeys(k, low) <= 0)) continue;
      if (high !== undefined && (hiIncl ? compareKeys(k, high) > 0 : compareKeys(k, high) >= 0)) continue;
      return 1;
    }
    return 0;
  });
  const patterns = new Map<string, TextPattern>();
  db.function('fm_find_text', { deterministic: true }, (v, raw, relaxed) => {
    if (v == null || v === '') return 0;
    const key = `${relaxed}:${raw}`;
    let pattern = patterns.get(key);
    if (!pattern) {
      pattern = textPattern(String(raw), !!relaxed, relaxed === 2);
      if (patterns.size >= 128) patterns.clear();
      patterns.set(key, pattern);
    }
    return pattern(String(v)) ? 1 : 0;
  });
}

/** The word index (FTS5 table, quoted) to narrow a find on a field with an FTS5 query, if worth it. */
export type WordIndex = (field: string, match: string) => string | undefined;

/** Converts a user-typed date/time to the ISO form the store keeps. */
export type Normalizer = (value: string, type: FieldType) => SqlValue;

const like = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

function compare(col: string, type: FieldType, op: string, raw: string, norm: Normalizer, params: SqlValue[], language: string): string {
  if (scalarOnly(type)) throw new FindError(`Range operators are unavailable for ${type} fields`, 400);
  if (textType(type)) {
    // Text compares word by word in index order, ignoring case and accents.
    const bound = String(norm(raw.trim(), type));
    const lower = op === '>' || op === '>=';
    params.push(...(lower ? [bound, op === '>=' ? 1 : 0, null, 0] : [null, 0, bound, op === '<=' ? 1 : 0]), language);
    return `fm_find_word_range(${col}, ?, ?, ?, ?, ?) = 1`;
  }
  params.push(norm(raw.trim(), type));
  const lhs = type === 'number' ? `CAST(${col} AS REAL)` : type === 'decimal' ? `fm_decimal_key(${col})` : col;
  return `${col} IS NOT NULL AND ${col} != '' AND ${lhs} ${op} ${type === 'decimal' ? 'fm_decimal_key(?)' : '?'}`;
}

/** A date typed without a time (7/3/2026, 2026-07-03), as the ISO date the store keeps; undefined when it has a time. */
function dayOnly(raw: string, norm: Normalizer): string | undefined {
  const v = raw.trim().replace(/^=/, '');
  if (!v || /\d:\d/.test(v)) return undefined;
  const d = norm(v, 'date');
  return typeof d === 'string' && validDate(d) ? d : undefined;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * A timestamp field searched with dates alone means whole days, as in FileMaker: 7/3/2026 finds that day's
 * records, ...7/3/2026 and <=7/3/2026 include all of that day. Undefined when the criterion isn't dates alone.
 */
function timestampDays(col: string, v: string, norm: Normalizer, params: SqlValue[]): string | undefined {
  const has = `${col} IS NOT NULL AND ${col} != ''`;
  const range = /^(.+?)(?:\.\.\.|…)(.+)$/.exec(v);
  if (range) {
    const a = dayOnly(range[1], norm);
    const b = dayOnly(range[2], norm);
    if (!a || !b) return undefined;
    params.push(a, nextDay(b));
    return `${has} AND ${col} >= ? AND ${col} < ?`;
  }
  const op = /^(<=|>=|<|>|≤|≥)/.exec(v)?.[1];
  const day = dayOnly(op ? v.slice(op.length) : v, norm);
  if (!day) return undefined;
  switch (op) {
    case '<': params.push(day); return `${has} AND ${col} < ?`;
    case '<=': case '≤': params.push(nextDay(day)); return `${has} AND ${col} < ?`;
    case '>': params.push(nextDay(day)); return `${has} AND ${col} >= ?`;
    case '>=': case '≥': params.push(day); return `${has} AND ${col} >= ?`;
    default: params.push(day, nextDay(day)); return `${has} AND ${col} >= ? AND ${col} < ?`;
  }
}

function criterion(col: string, type: FieldType, value: string, norm: Normalizer, params: SqlValue[], index?: (match: string) => string | undefined, duplicates?: (col: string) => string, language = 'en'): string {
  const japanese = language === 'ja';
  if (value.length > MAX_CRITERION) throw tooComplex();
  let v = value.trim();
  if (nativeNumber(type) && /(?:^|[^\p{L}\p{N}])[-+]?\d+(?:\.\d+)?[eE][+-]?\d+/u.test(v)) {
    throw new FindError('Exponent literals are unsupported in Find mode; use a plain number', 400);
  }
  if (v === '=') return `(${col} IS NULL OR ${col} = '')`;
  if (v.startsWith('!')) {
    if (type === 'container' || !duplicates) throw new FindError('Duplicate find is unavailable for this field', 400);
    const dup = duplicates(col);
    return v.length === 1 ? dup : `(${dup} AND ${criterion(col, type, v.slice(1), norm, params, index, undefined, language)})`;
  }
  if (type === 'json') {
    if (v === '*') return `(${col} IS NOT NULL AND ${col} != '')`;
    if (/^(?:<=|>=|<|>|≤|≥)/.test(v) || /(?:\.\.\.|…)/.test(v)) throw new FindError('Range operators are unavailable for json fields', 400);
    const canonical = nativeValue(v.replace(/^==/, ''), 'json');
    if (typeof canonical !== 'string') throw new FindError('JSON Find requires a valid complete JSON value', 400);
    params.push(canonical);
    return `${col} = ?`;
  }
  if (v === '?') {
    if (!temporal(type) && type !== 'number') return '0';
    params.push(type);
    return `fm_find_invalid(${col}, ?) = 1`;
  }
  if (v.startsWith('~')) {
    if (!textType(type)) return '0';
    v = v.slice(1);
    if (!v.trim()) throw new FindError('A relaxed find requires text after ~', 400);
    textPattern(v, true, japanese);
    params.push(v, japanese ? 2 : 1);
    return `fm_find_text(${col}, ?, ?) = 1`;
  }
  if ((type === 'date' || type === 'timestamp') && v.includes('//')) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    v = v.replace(/\/\//g, today);
  } else if (v.includes('//') && !textType(type)) return '0';
  // Open ranges are comparisons, including //... (today and later).
  const open = /^(.*?)(?:\.\.\.|…)(.*?)$/.exec(v);
  if (open && (type === 'number' || nativeNumber(type) || temporal(type))) {
    for (const raw of open.slice(1)) {
      if (raw === '') continue; // Open ranges have only one endpoint.
      const endpoint = norm(raw.trim(), type);
      const parts = typeof endpoint === 'string' ? endpoint.split('T') : [];
      const valid = type === 'number' || type === 'integer' ? typeof endpoint === 'number' && Number.isFinite(endpoint)
        : type === 'decimal' ? typeof endpoint === 'string' && /^-?\d+(?:\.\d+)?$/.test(endpoint)
        : type === 'date' ? typeof endpoint === 'string' && validDate(endpoint)
        : type === 'time' ? typeof endpoint === 'string' && validTime(endpoint)
        : !!dayOnly(raw, norm) || (parts.length === 2 && validDate(parts[0]) && validTime(parts[1], true));
      if (!valid) throw new FindError('Invalid range endpoint in Find mode', 508);
    }
  }
  if (open && (!open[1] || !open[2])) {
    if (!open[1] && !open[2]) throw new FindError('A find range requires an endpoint', 400);
    v = open[1] ? `>=${open[1]}` : `<=${open[2]}`;
  }
  if (v.includes('#') && !textType(type) && type !== 'number') return '0';
  if (/[#@*"\\]/.test(v) && v !== '*' && (textType(type) || type === 'number')) {
    if (type === 'number') v = '==' + v.replace(/^={1,2}/, '');
    textPattern(v, false);
    params.push(v, 0);
    return `fm_find_text(${col}, ?, ?) = 1`;
  }
  if (type === 'timestamp' && !v.startsWith('==')) {
    const days = timestampDays(col, v, norm, params);
    if (days) return days;
  }
  if (v === '*') return `(${col} IS NOT NULL AND ${col} != '')`;
  if (v.startsWith('==')) {
    const whole = norm(v.slice(2), type);
    if (type === 'boolean' || type === 'integer' || type === 'decimal' || type === 'uuid') {
      params.push(whole);
      return type === 'decimal' ? `fm_decimal_key(${col}) = fm_decimal_key(?)` : `${col} = ?`;
    }
    // Text ignores case and accents in every script (SQLite's NOCASE would know ASCII only).
    params.push(typeof whole === 'string' ? foldText(whole) : whole);
    return `fm_fold(${col}) = ?`;
  }
  for (const op of ['<=', '>=', '<', '>', '≤', '≥']) {
    if (v.startsWith(op)) {
      const sqlOp = op === '≤' ? '<=' : op === '≥' ? '>=' : op;
      return compare(col, type, sqlOp, v.slice(op.length), norm, params, language);
    }
  }
  const range = /^(.+?)(?:\.\.\.|…)(.+)$/.exec(v);
  if (range && textType(type)) {
    params.push(String(norm(range[1].trim(), type)), 1, String(norm(range[2].trim(), type)), 1, language);
    return `fm_find_word_range(${col}, ?, ?, ?, ?, ?) = 1`;
  }
  if (range) {
    if (scalarOnly(type)) throw new FindError(`Ranges are unavailable for ${type} fields`, 400);
    const lhs = type === 'number' ? `CAST(${col} AS REAL)` : type === 'decimal' ? `fm_decimal_key(${col})` : col;
    params.push(norm(range[1].trim(), type), norm(range[2].trim(), type));
    return `${col} IS NOT NULL AND ${col} != '' AND ${lhs} BETWEEN ${type === 'decimal' ? 'fm_decimal_key(?)' : '?'} AND ${type === 'decimal' ? 'fm_decimal_key(?)' : '?'}`;
  }
  if (type !== 'text' && type !== 'unknown' && !/[*@"]/.test(v)) {
    // Typed fields: a plain value means equality (2007-05-14, 42).
    params.push(norm(v.replace(/^=/, ''), type));
    return type === 'number' ? `CAST(${col} AS REAL) = ?` : type === 'decimal' ? `fm_decimal_key(${col}) = fm_decimal_key(?)` : `${col} = ?`;
  }
  const exactWord = v.startsWith('=');
  let text = exactWord ? v.slice(1) : v;
  const phrase = /^"(.*)"$/.exec(text);
  if (phrase) text = phrase[1];
  // The word index narrows the records; the LIKE rule below decides.
  const words = index && wordQuery(foldText(text), exactWord);
  const fts = words ? index(words) : undefined;
  let narrow = '';
  if (fts) {
    params.push(words!);
    narrow = `_fm_record_id IN (SELECT rowid FROM ${fts} WHERE ${col} MATCH ?) AND `;
  }
  const p = like(foldText(text)).replace(/\*/g, '%').replace(/@/g, '_');
  const fcol = `fm_fold(${col})`;
  const esc = ` ESCAPE '\\'`;
  if (exactWord) {
    // A whole word equals the text.
    params.push(p, `${p} %`, `% ${p}`, `% ${p} %`);
    return `(${narrow}(${fcol} LIKE ?${esc} OR ${fcol} LIKE ?${esc} OR ${fcol} LIKE ?${esc} OR ${fcol} LIKE ?${esc}))`;
  }
  // A word starts with the text.
  params.push(`${p}%`, `% ${p}%`);
  return `(${narrow}(${fcol} LIKE ?${esc} OR ${fcol} LIKE ?${esc}))`;
}

/**
 * A criterion on a repeating field, whose column holds its repetitions as a JSON array: the record matches when any
 * repetition does, as a find in FileMaker searches every repetition. "=" (empty) matches when none has a value.
 * A value written before the field repeated (not an array) counts as its first repetition.
 */
const repetitions = (col: string) => `json_each(CASE WHEN json_valid(${col}) AND json_type(${col}) = 'array' THEN ${col} ELSE json_array(${col}) END)`;

function repeating(col: string, type: FieldType, value: string, norm: Normalizer, params: SqlValue[], duplicates?: (col: string) => string, language = 'en'): string {
  if (value.length > MAX_CRITERION) throw tooComplex();
  const reps = repetitions(col);
  if (value.trim() === '=') return `NOT EXISTS (SELECT 1 FROM ${reps} AS _rep WHERE _rep.value IS NOT NULL AND _rep.value != '')`;
  return `EXISTS (SELECT 1 FROM ${reps} AS _rep WHERE ${criterion('_rep.value', type, value, norm, params, undefined, duplicates, language)})`;
}

/** Duplicate membership is decided before intersecting criteria, and never counts one record twice. */
function duplicateCriterion(f: FieldInfo, col: string, params: SqlValue[], source?: FindSource): string {
  if (!source) throw new FindError('Duplicate find requires a record source', 400);
  const many = (f.repetitions ?? 1) > 1;
  const other = many ? '_dup_rep.value' : `_dup.${q(f.name)}`;
  const key = (c: string) => textType(f.type) ? `fm_find_key(substr(${c}, 1, 100))` : c;
  const src = source();
  params.push(...src.params);
  const from = `${src.from} AS _dup` + (many ? `, ${repetitions(`_dup.${q(f.name)}`)} AS _dup_rep` : '');
  return `(${col} IS NOT NULL AND ${col} != '' AND ${key(col)} IN (SELECT ${key(other)} FROM ${from}
    WHERE ${other} IS NOT NULL AND ${other} != '' GROUP BY ${key(other)} HAVING count(DISTINCT _dup._fm_record_id) > 1))`;
}

/** SQL condition for criteria on one related occurrence's fields, or undefined when it has no such fields. */
export type RelatedCriteria = (occurrence: string, criteria: Record<string, string>) => { where: string; params: SqlValue[] } | undefined;

/** WHERE clause for a list of find requests. */
export function findWhere(
  requests: FindRequest[], fields: Map<string, FieldInfo>, norm: Normalizer, related?: RelatedCriteria, words?: WordIndex, source?: FindSource,
): { where: string; params: SqlValue[] } {
  let complexity = requests.length;
  if (complexity > MAX_QUERY_PARTS) throw tooComplex();
  for (const req of requests) {
    complexity += Object.keys(req).length;
    if (complexity > MAX_QUERY_PARTS) throw tooComplex();
  }
  const params: SqlValue[] = [];
  let where = '1';
  let first = true;
  for (const req of requests) {
    const parts: string[] = [];
    const byOccurrence = new Map<string, Record<string, string>>();
    for (const [name, value] of Object.entries(req)) {
      if (name === 'omit') continue;
      const f = fields.get(name);
      const at = name.indexOf('::');
      if (!f && related && at > 0) {
        if (value === '' || value === null || value === undefined) continue;
        const occ = name.slice(0, at);
        byOccurrence.set(occ, { ...byOccurrence.get(occ), [name.slice(at + 2)]: String(value) });
        continue;
      }
      if (!f) throw new FindError(`Field "${name}" is missing`);
      if (f.summary) throw new FindError(`Field "${name}" is a summary field and cannot be searched`);
      if (value === '' || value === null || value === undefined) continue;
      const duplicates = (col: string) => duplicateCriterion(f, col, params, source);
      parts.push((f.repetitions ?? 1) > 1
        ? repeating(q(f.name), f.type, String(value), norm, params, duplicates, sortLanguage(f.indexLanguage))
        : criterion(q(f.name), f.type, String(value), norm, params, words && ((m) => words(f.name, m)), duplicates, sortLanguage(f.indexLanguage)));
    }
    for (const [occ, criteria] of byOccurrence) {
      const c = related!(occ, criteria);
      if (!c) throw new FindError(`Field "${occ}::${Object.keys(criteria)[0]}" is missing`);
      parts.push(c.where);
      params.push(...c.params);
    }
    const clause = parts.length ? `(${parts.join(' AND ')})` : '1';
    const omitting = req.omit === true || req.omit === 'true';
    // A record whose field is empty gives NULL for the clause, and NOT NULL is NULL: it is not matched, so omitting does not drop it.
    const omit = `NOT COALESCE(${clause}, 0)`;
    where = first ? (omitting ? omit : clause)
      : `(${where} ${omitting ? `AND ${omit}` : `OR ${clause}`})`;
    first = false;
  }
  return { where, params };
}

// FileMaker calculation values and the conversions between them.
//
// FileMaker numbers are decimal with up to 400 digits. Ordinary calculations
// use doubles shown to 16 significant digits; SetPrecision results retain a
// decimal string. Dates count days from 1/1/0001 (day 1), times count seconds,
// and timestamps count seconds from 1/1/0001 00:00:00, as FileMaker's
// GetAsNumber does.

export type Value =
  /** Text; `runs` are the fonts, sizes, colors and styles on parts of it (styled.ts), when it has any. */
  | { type: 'text'; value: string; runs?: StyleRun[] }
  /** `exact`: a large whole number; `decimal`: a SetPrecision result; `value` is the nearest double. */
  | { type: 'number'; value: number; exact?: bigint; decimal?: string }
  | { type: 'date'; value: number }
  | { type: 'time'; value: number }
  | { type: 'timestamp'; value: number }
  /** A file or binary result: `value` is its reference or file name; `data` holds bytes when known. */
  /** changed: a file stored outside the database that is missing or not as it was stored (VerifyContainer). */
  /** size and head: the file's length and its first bytes, without reading all of it (a stored file's size, image headers). */
  | { type: 'container'; value: string; data?: Uint8Array; changed?: true; size?: number; head?: (bytes: number) => Uint8Array };

export type ValueType = Value['type'];
export type StoredType = ValueType | 'unknown' | 'boolean' | 'integer' | 'decimal' | 'json' | 'uuid';
import type { StyleRun } from './styled.ts';
export type DateOrder = 'MDY' | 'DMY' | 'YMD' | 'ISO';
/**
 * How a file writes dates as text: the field order, and whether months and
 * days get two digits ("09/05/2026"). A bare order means no padding.
 */
export type DateStyle = DateOrder | { order: DateOrder; padded?: boolean };
export const dateOrderOf = (f: DateStyle): DateOrder => (typeof f === 'string' ? f : f.order);

/** A calculation error; FileMaker shows "?" and EvaluationError returns the code. */
/**
 * Thrown by a host's callback when it must do slow work (an AI call) before the formula can give its answer: the
 * host does it and evaluates again. Nothing in a formula catches it, as nothing catches a host's own errors.
 */
export class HostWait extends Error {}

export class CalcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** A calculation nesting limit reached while evaluating a formula. Hosts that
 * treat ordinary calculation errors as a value can let this fail the whole operation. */
export class CalcNestingError extends CalcError {}

/** Error codes FileMaker uses for calculation problems. */
export const ERR = {
  /** Field is missing */
  fieldMissing: 102,
  /** Value not found / out of range */
  outOfRange: 1200,
  /** Generic calculation error */
  calculation: 1200,
  /** Too few parameters */
  tooFewParameters: 1201,
  /** Too many parameters */
  tooManyParameters: 1202,
  /** Unexpected end of calculation */
  unexpectedEnd: 1203,
  /** Number, text constant, field name or "(" expected */
  operandExpected: 1204,
  /** Comment is not terminated */
  unterminatedComment: 1205,
  /** Text constant must end with a quotation mark */
  unterminatedText: 1206,
  /** Unbalanced parenthesis */
  unbalanced: 1207,
  /** Operator missing, function not found or "(" not expected */
  unknownFunction: 1208,
  /** Name (such as field name or layout name) is missing */
  nameMissing: 1209,
  /** Division by zero is not shown as an error but as "?" */
  divideByZero: 1200,
  /** Recursion limit: FileMaker has no code of its own for it, so the generic one */
  recursion: 1200,
  /** Field reference expected */
  fieldExpected: 1214,
} as const;

export const text = (value: string): Value => ({ type: 'text', value });
export const num = (value: number): Value => ({ type: 'number', value });
export const bool = (b: boolean): Value => ({ type: 'number', value: b ? 1 : 0 });
export const EMPTY: Value = text('');

const SECONDS_PER_DAY = 86400;
// Day number of 1/1/1970 in FileMaker's count (1/1/0001 = 1).
const UNIX_EPOCH_DAY = 719163;

/** FileMaker day number for a proleptic Gregorian date; month and day may overflow, as Date() allows. */
export function dayNumber(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  return Math.round(d.getTime() / 86400000) + UNIX_EPOCH_DAY;
}

export function fromDayNumber(n: number): { year: number; month: number; day: number; weekday: number } {
  const d = new Date((n - UNIX_EPOCH_DAY) * 86400000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() + 1 };
}

export function timestampFromDate(ms: number): number {
  return ms / 1000 + (UNIX_EPOCH_DAY - 1) * SECONDS_PER_DAY;
}

/** Number as FileMaker writes it: no exponent, at most 16 significant digits, no trailing zeros. */
/**
 * Sum like FileMaker's decimal arithmetic: the result keeps no more decimal
 * places than the inputs have, so 0.1 added a thousand times is exactly 100.
 */
export function decimalSum(ns: number[]): number {
  let places = 0;
  let plain = false;
  let sum = 0;
  for (const raw of ns) {
    // Whole numbers (most of a large table's values) need no look at their decimals.
    if (Number.isInteger(raw) && Math.abs(raw) < 1e15) {
      sum += raw;
      continue;
    }
    // Binary noise from earlier arithmetic (13.950000000000001) is not a real decimal place.
    const n = Number(raw.toPrecision(15));
    sum += n;
    if (plain) continue;
    const str = String(n);
    const dot = str.indexOf('.');
    if (dot >= 0 && !/e/i.test(str)) places = Math.max(places, str.length - dot - 1);
    if (places > 12 || /e/i.test(str)) plain = true;
  }
  if (plain) return sum;
  const scale = 10 ** places;
  return Math.round(sum * scale) / scale;
}

/**
 * Drops the binary noise from the result of + - * / ^ (0.7+0.1 is 0.7999999999999999, 4.35*100 is 434.9999999999999),
 * as FileMaker, which computes in decimal, never shows it. A result that is a short decimal once rounded to 15
 * significant digits is that decimal; one that needs more digits (1/3) is left as the double it is.
 */
export function tidy(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n;
  const rounded = Number(n.toPrecision(15));
  const text = String(rounded);
  if (/e/i.test(text)) return n;
  if (text.replace(/^-?0*\.?0*/, '').replace('.', '').length > 14) return n;
  // Noise from one operation is a unit or two in the last place; sqrt(2) = 1.4142135623730951 is also near the
  // 14 digit 1.4142135623731 but further off than that.
  const ulp = 2 ** (Math.floor(Math.log2(Math.abs(n))) - 52);
  return Math.abs(rounded - n) <= 2 * ulp ? rounded : n;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n === 0) return '0';
  // The shortest form that reads back as the same double, when it fits in
  // FileMaker's 16 digits: 77308.04, not 77308.03999999999.
  const short = String(n);
  if (!/e/i.test(short) && short.replace(/^-?0*\.?0*/, '').replace('.', '').length <= 16) return short;
  let s = n.toPrecision(16);
  if (/e/i.test(s)) {
    s = Number(s).toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 16 });
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0');

export function formatDate(day: number, order: DateStyle = 'MDY'): string {
  const { year, month, day: d } = fromDayNumber(day);
  const o = dateOrderOf(order);
  // Year-first systems (Japanese, ISO-like) write months and days with two digits.
  if (o === 'ISO') return `${pad(year, 4)}-${pad(month)}-${pad(d)}`;
  if (o === 'YMD') return `${year}/${pad(month)}/${pad(d)}`;
  const p = typeof order !== 'string' && order.padded ? pad : String;
  return o === 'DMY' ? `${p(d)}/${p(month)}/${year}` : `${p(month)}/${p(d)}/${year}`;
}

/** `places`: decimal places kept in the seconds (a timestamp passes fewer: its double has no digits to spare past them). */
export function formatTime(seconds: number, places = 6): string {
  const neg = seconds < 0;
  const scale = 10 ** places;
  let s = Math.round(Math.abs(seconds) * scale) / scale;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const whole = Math.floor(s);
  const frac = formatNumber(Math.round((s - whole) * scale) / scale).replace(/^0/, '');
  return `${neg ? '-' : ''}${h}:${pad(m)}:${pad(whole)}${frac === '' || frac === '0' ? '' : frac}`;
}

export function formatTimestamp(ts: number, order: DateStyle = 'MDY'): string {
  const day = Math.floor(ts / SECONDS_PER_DAY) + 1;
  if (dateOrderOf(order) === 'ISO') return isoTimestamp(ts);
  return `${formatDate(day, order)} ${formatTime(ts - (day - 1) * SECONDS_PER_DAY, 3)}`;
}

/** Text of a value, as GetAsText gives it. */
export function asText(v: Value, order: DateStyle = 'MDY'): string {
  switch (v.type) {
    case 'text': case 'container': return v.value;
    case 'number': return v.decimal ?? (v.exact !== undefined ? v.exact.toString() : formatNumber(v.value));
    case 'date': return formatDate(v.value, order);
    case 'time': return formatTime(v.value);
    case 'timestamp': return formatTimestamp(v.value, order);
  }
}

/**
 * Number in a text, the way FileMaker reads one: digits are kept, the first
 * decimal point and a leading minus count, everything else is ignored.
 * Undefined when there are no digits.
 */
export function numberFromText(s: string): number | undefined {
  let digits = '';
  let point = false;
  let neg = false;
  let seenDigit = false;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      seenDigit = true;
    } else if (ch === '.' && !point) {
      digits += '.';
      point = true;
    } else if ((ch === '-' || ch === '(') && !seenDigit && !point) {
      // A minus sign or an opening parenthesis before the first digit makes it negative, unless a period came first (Claris).
      neg = true;
    }
  }
  if (!seenDigit) return undefined;
  const n = Number(digits);
  return neg ? -n : n;
}

/** FileMaker's limit on the digits of a number. */
const MAX_DIGITS = 400;

/** A plain whole-number literal or argument outside the supported number range. */
export function isOverlongWholeText(s: string): boolean {
  const t = s.trim();
  return /^[+-]?\d+$/.test(t) && t.replace(/^[+-]/, '').length > MAX_DIGITS;
}

/** A whole number written as digits that a double cannot hold exactly (past 2^53), or undefined. */
export function exactIntegerText(s: string): bigint | undefined {
  const t = s.trim();
  if (!/^[+-]?\d{16,}$/.test(t) || t.replace(/^[+-]/, '').length > MAX_DIGITS) return undefined;
  return Number.isSafeInteger(Number(t)) ? undefined : BigInt(t);
}

/** The whole number a value holds, digit for digit, when it is one (a number, or text of digits); undefined for anything else. */
export function exactOf(v: Value): bigint | undefined {
  if (v.type === 'number') return v.exact ?? (Number.isSafeInteger(v.value) ? BigInt(v.value) : undefined);
  if (v.type === 'text') return exactIntegerText(v.value) ?? (/^\s*[+-]?\d{1,15}\s*$/.test(v.value) ? BigInt(v.value.trim()) : undefined);
  return undefined;
}

/** Whether a value holds a whole number past 2^53 (so that doubles would lose digits). */
export const isBeyondDouble = (v: Value): boolean => (v.type === 'number' && v.exact !== undefined) || (v.type === 'text' && exactIntegerText(v.value) !== undefined);

/** A number value for a whole number: a plain double while one holds it, else exact; "?" (NaN) past 400 digits. */
export function fromExact(b: bigint): Value {
  if (b.toString().replace('-', '').length > MAX_DIGITS) return { type: 'number', value: NaN };
  const n = Number(b);
  return Number.isSafeInteger(n) ? { type: 'number', value: n } : { type: 'number', value: n, exact: b };
}

export function exactAbs(v: Value): bigint | undefined {
  const x = exactOf(v);
  return x === undefined ? undefined : x < 0n ? -x : x;
}

export function exactSign(v: Value): bigint | undefined {
  const x = exactOf(v);
  return x === undefined ? undefined : x < 0n ? -1n : x > 0n ? 1n : 0n;
}

export function exactDivFloor(a: Value, b: Value): bigint | undefined {
  const x = exactOf(a), y = exactOf(b);
  if (x === undefined || y === undefined || y === 0n) return undefined;
  const q = x / y, r = x % y;
  return r !== 0n && (r < 0n) !== (y < 0n) ? q - 1n : q;
}

export function exactMod(a: Value, b: Value): bigint | undefined {
  const x = exactOf(a), y = exactOf(b);
  if (x === undefined || y === undefined || y === 0n) return undefined;
  return x - y * exactDivFloor(a, b)!;
}

/** A small overflow witness; fromExact remains the only place that applies the digit cap. */
const overflowExact = () => 10n ** BigInt(MAX_DIGITS);

export function exactPow(a: Value, b: Value): bigint | undefined {
  const x = exactOf(a), e = exactOf(b);
  if (x === undefined || e === undefined || e < 0n) return undefined;
  const magnitude = x < 0n ? -x : x;
  if (e === 0n) return 1n;
  if (magnitude <= 1n) return x === -1n ? (e % 2n === 0n ? 1n : -1n) : x;
  // The bit length gives a strict lower bound on decimal digits, before exponentiation.
  const lowerBits = magnitude.toString(2).length - 1;
  if (e * BigInt(lowerBits) > BigInt(Math.ceil(MAX_DIGITS / Math.log10(2)) + 1)) return overflowExact();
  return x ** e;
}

export function exactRound(a: Value, places: Value): bigint | undefined {
  return exactRounded(a, places, true);
}

export function exactTruncate(a: Value, places: Value): bigint | undefined {
  return exactRounded(a, places, false);
}

function exactRounded(a: Value, places: Value, halfAway: boolean): bigint | undefined {
  const x = exactOf(a), p = exactOf(places);
  if (x === undefined || p === undefined) return undefined;
  if (p >= 0n || x === 0n) return x;
  const magnitude = x < 0n ? -x : x;
  // Larger scales can only round a bounded whole number to zero.
  if (-p > BigInt(MAX_DIGITS)) return 0n;
  const scale = 10n ** -p;
  const quotient = magnitude / scale;
  const rounded = quotient + (halfAway && magnitude % scale * 2n >= scale ? 1n : 0n);
  return (x < 0n ? -rounded : rounded) * scale;
}

/** Number of a value, or undefined for empty / non-numeric text. */
export function asNumberOrEmpty(v: Value): number | undefined {
  if (v.type === 'text' || v.type === 'container') return numberFromText(v.value);
  if (v.type === 'date') return v.value;
  return v.value;
}

/** Number of a value; empty counts as 0 in arithmetic. */
export const asNumber = (v: Value): number => asNumberOrEmpty(v) ?? 0;

export function asBoolean(v: Value): boolean {
  const n = asNumberOrEmpty(v);
  return n !== undefined && n !== 0;
}

export function isEmpty(v: Value): boolean {
  return asText(v) === '';
}

/**
 * A two-digit year as the four-digit year within the next 30 years or the preceding 70 of `nowYear` (Claris,
 * "Entering dates with two-digit years": entered in 2019, 46 is 2046 and 50 is 1950). A year of more digits stays.
 */
export function fullYear(year: number, nowYear = new Date().getFullYear()): number {
  if (year >= 100) return year;
  return year + Math.floor((nowYear + 30 - year) / 100) * 100;
}

/** ISO (native) text dates must name a real day; compat orders keep rolling over (docs/consistency.md A4-09, A4-11). */
function parsedDay(year: number, month: number, day: number): number | undefined {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? dayNumber(year, month, day) : undefined;
}

export function parseDateText(s: string, order: DateStyle = 'MDY', nowYear?: number): number | undefined {
  const t = s.trim();
  if (dateOrderOf(order) === 'ISO') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    return iso ? parsedDay(+iso[1], +iso[2], +iso[3]) : undefined;
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return dayNumber(+m[1], +m[2], +m[3]);
  m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(t);
  if (!m) return undefined;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  const o = dateOrderOf(order);
  if (o === 'YMD' || m[1].length === 4) return dayNumber(m[1].length <= 2 ? fullYear(a, nowYear) : a, b, c);
  const year = m[3].length <= 2 ? fullYear(c, nowYear) : c;
  return o === 'DMY' ? dayNumber(year, b, a) : dayNumber(year, a, b);
}

export function parseTimeText(s: string): number | undefined {
  const m = /^(-?)(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?\s*([AaPp][Mm])?$/.exec(s.trim());
  if (!m) return undefined;
  let h = +m[2];
  if (m[5]) {
    const pm = m[5].toLowerCase() === 'pm';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  const secs = h * 3600 + +m[3] * 60 + (m[4] ? Number(m[4]) : 0);
  return m[1] ? -secs : secs;
}

export function parseTimestampText(s: string, order: DateStyle = 'MDY'): number | undefined {
  if (dateOrderOf(order) === 'ISO' && !/^\d{4}-\d{2}-\d{2}[T ]/.test(s.trim())) return undefined;
  const t = s.trim().replace('T', ' ');
  const sp = t.indexOf(' ');
  const d = parseDateText(sp < 0 ? t : t.slice(0, sp), order);
  if (d === undefined) return undefined;
  const tm = sp < 0 ? 0 : parseTimeText(t.slice(sp + 1));
  if (tm === undefined) return undefined;
  return (d - 1) * SECONDS_PER_DAY + tm;
}

export function asDate(v: Value, order: DateStyle = 'MDY'): number | undefined {
  switch (v.type) {
    case 'date': return v.value;
    case 'timestamp': return Math.floor(v.value / SECONDS_PER_DAY) + 1;
    case 'number': return Math.trunc(v.value);
    case 'time': return undefined;
    default: {
      const d = parseDateText(v.value, order);
      if (d !== undefined) return d;
      const ts = parseTimestampText(v.value, order);
      return ts === undefined ? undefined : Math.floor(ts / SECONDS_PER_DAY) + 1;
    }
  }
}

export function asTime(v: Value): number | undefined {
  switch (v.type) {
    case 'time': return v.value;
    case 'timestamp': return v.value - Math.floor(v.value / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    case 'number': return v.value;
    case 'date': return undefined;
    default: {
      const t = parseTimeText(v.value);
      if (t !== undefined) return t;
      const ts = parseTimestampText(v.value);
      return ts === undefined ? undefined : ts - Math.floor(ts / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    }
  }
}

export function asTimestamp(v: Value, order: DateStyle = 'MDY'): number | undefined {
  switch (v.type) {
    case 'timestamp': case 'time': case 'number': return v.value;
    case 'date': return (v.value - 1) * SECONDS_PER_DAY;
    default: return parseTimestampText(v.value, order);
  }
}

/** A value converted to a field's type, the way a calculation result is stored. */
export function coerce(v: Value, type: ValueType, order: DateStyle = 'MDY'): Value {
  if (v.type === type) return v;
  if (isEmpty(v)) return EMPTY;
  // FileMaker keeps a text result as text whatever the field's result type
  // (seen in stored values: a number calculation holding "\"Billing\"").
  if (v.type === 'text' && type !== 'container') return v;
  switch (type) {
    case 'text': return text(asText(v, order));
    case 'number': {
      const n = asNumberOrEmpty(v);
      return n === undefined ? EMPTY : num(n);
    }
    case 'date': {
      const d = asDate(v, order);
      return d === undefined ? EMPTY : { type: 'date', value: d };
    }
    case 'time': {
      const t = asTime(v);
      return t === undefined ? EMPTY : { type: 'time', value: t };
    }
    case 'timestamp': {
      const t = asTimestamp(v, order);
      return t === undefined ? EMPTY : { type: 'timestamp', value: t };
    }
    case 'container': return { type: 'container', value: asText(v, order) };
  }
}

// --- ISO forms, as the Tabularius store keeps dates and times -----------------

export function isoDate(day: number): string {
  const { year, month, day: d } = fromDayNumber(day);
  return `${pad(year, 4)}-${pad(month)}-${pad(d)}`;
}

export function isoTime(seconds: number): string {
  const t = formatTime(seconds);
  return t.replace(/^(-?)(\d):/, '$10$2:');
}

export function isoTimestamp(ts: number): string {
  const day = Math.floor(ts / SECONDS_PER_DAY) + 1;
  return `${isoDate(day)}T${isoTime(ts - (day - 1) * SECONDS_PER_DAY)}`;
}

/** A stored value of a field type (ISO dates as the store keeps them) as a calculation value. */
export function fromStored(v: string | number | null | undefined, type: StoredType): Value {
  if (v === null || v === undefined || v === '') return EMPTY;
  const s = String(v);
  switch (type) {
    case 'boolean': case 'integer': case 'number': {
      if (typeof v === 'number') return num(v);
      const n = numberFromText(s);
      // Text typed into a number field stays text until used as a number.
      return n !== undefined && String(n) === s.trim() ? num(n) : text(s);
    }
    case 'date': {
      const d = parseDateText(s);
      return d === undefined ? text(s) : { type: 'date', value: d };
    }
    case 'time': {
      const t = parseTimeText(s);
      return t === undefined ? text(s) : { type: 'time', value: t };
    }
    case 'timestamp': {
      const t = parseTimestampText(s);
      return t === undefined ? text(s) : { type: 'timestamp', value: t };
    }
    case 'container': return { type: 'container', value: s };
    // The store keeps returns as \n (the reader's form); calculations use \r, as FileMaker does.
    default: return text(s.includes('\n') ? s.replace(/\n/g, '\r') : s);
  }
}

/** A calculation value in the store's form for a field type. */
export function toStored(v: Value, type: StoredType, order: DateStyle = 'MDY'): string | number | null {
  if (isEmpty(v)) return null;
  const target: ValueType | 'unknown' = type === 'boolean' || type === 'integer' ? 'number'
    : type === 'decimal' || type === 'json' || type === 'uuid' ? 'text' : type;
  const c = target === 'unknown' ? v : coerce(v, target, order);
  switch (c.type) {
    case 'number': return c.value;
    case 'date': return isoDate(c.value);
    case 'time': return isoTime(c.value);
    case 'timestamp': return isoTimestamp(c.value);
    default: return c.value === '' ? null : c.value.replace(/\r\n?/g, '\n');
  }
}

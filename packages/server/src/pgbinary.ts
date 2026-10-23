// PostgreSQL's binary format for values, for clients that ask for it: asyncpg
// and Npgsql use it for every value whose type they know, and psycopg and
// pgjdbc can. Results come in the column types the Postgres wire server
// describes (text, numeric, bool, bytea, int8, uuid, jsonb); parameters come in
// the types the client named at Parse (or a cast in the query names), and are
// read into the value the text format gives, so a query sees the same thing
// whichever format the client picked. Booleans are the exception: 1 or 0, as
// FileMaker keeps them. Arrays and intervals are read into PostgreSQL's text
// form of them ({1,2,3}, 1 year 2 mons), which is what a client sending text
// would have sent.
//
// Every reader checks lengths before it reads: input that is short, too long
// or not a value of its type is a BinaryFormatError with the SQLSTATE
// PostgreSQL answers, never a RangeError thrown out of the connection.

import { isUtf8 } from 'node:buffer';
import { maskSql } from '../../store/src/sql-tokens.ts';
import type { SqlValue } from '../../store/src/find.ts';

export const BINARY_OID = {
  bool: 16, bytea: 17, name: 19, int8: 20, int2: 21, int4: 23, text: 25, oid: 26, json: 114, float4: 700, float8: 701,
  unknown: 705, bpchar: 1042, varchar: 1043, date: 1082, time: 1083, timestamp: 1114, timestamptz: 1184, interval: 1186, numeric: 1700,
  uuid: 2950, jsonb: 3802,
} as const;

/** Array types, by the array type's oid, with their element type's oid. */
export const ARRAY_ELEMENT: Readonly<Record<number, number>> = {
  1000: BINARY_OID.bool, 1001: BINARY_OID.bytea, 1003: BINARY_OID.name, 1016: BINARY_OID.int8, 1005: BINARY_OID.int2,
  1007: BINARY_OID.int4, 1009: BINARY_OID.text, 1028: BINARY_OID.oid, 199: BINARY_OID.json, 1021: BINARY_OID.float4,
  1022: BINARY_OID.float8, 1014: BINARY_OID.bpchar, 1015: BINARY_OID.varchar, 1182: BINARY_OID.date, 1183: BINARY_OID.time,
  1115: BINARY_OID.timestamp, 1185: BINARY_OID.timestamptz, 1187: BINARY_OID.interval, 1231: BINARY_OID.numeric,
  2951: BINARY_OID.uuid, 3807: BINARY_OID.jsonb,
};
const ARRAY_OF = new Map(Object.entries(ARRAY_ELEMENT).map(([array, element]) => [element, Number(array)]));

/** Binary input or output that is not a value of its type, with the SQLSTATE to answer it with. */
export class BinaryFormatError extends Error {
  readonly code: string;
  constructor(message: string, code = '22P03') {
    super(message);
    this.name = 'BinaryFormatError';
    this.code = code;
  }
}

const short = () => new BinaryFormatError('insufficient data left in message', '08P01');
const malformed = (what = 'incorrect binary data format') => new BinaryFormatError(what, '22P03');

/** A value of exactly n bytes: fewer is a short message, more is a malformed value (as PostgreSQL tells them apart). */
function fixed(b: Buffer, n: number): Buffer {
  if (b.length < n) throw short();
  if (b.length > n) throw malformed();
  return b;
}

/** Reads a value's parts in order; reading past its end is a short message, never a RangeError. */
class Reader {
  private readonly b: Buffer;
  private pos = 0;
  constructor(b: Buffer) { this.b = b; }
  private take(n: number): number {
    if (n < 0 || this.pos + n > this.b.length) throw short();
    const at = this.pos;
    this.pos += n;
    return at;
  }
  get left(): number { return this.b.length - this.pos; }
  i16(): number { return this.b.readInt16BE(this.take(2)); }
  u16(): number { return this.b.readUInt16BE(this.take(2)); }
  i32(): number { return this.b.readInt32BE(this.take(4)); }
  u32(): number { return this.b.readUInt32BE(this.take(4)); }
  bytes(n: number): Buffer { const at = this.take(n); return this.b.subarray(at, at + n); }
  end(): void { if (this.pos !== this.b.length) throw malformed(); }
}

/** Wire text is UTF-8 without NUL, in either format: replacement decoding would silently change a value. */
function utf8Text(b: Buffer): string {
  if (!isUtf8(b) || b.includes(0)) throw new BinaryFormatError('invalid byte sequence for encoding "UTF8"', '22021');
  return b.toString('utf8');
}

/** The one rule for false, shared by the text (f) and binary (0) forms of a bool column. */
export function isFalse(v: unknown): boolean {
  return v === 0 || v === 0n || v === '0' || v === 'f' || v === false;
}

// --- numeric ---------------------------------------------------------------------

const NUMERIC_POS = 0x0000;
const NUMERIC_NEG = 0x4000;
const NUMERIC_NAN = 0xc000;
const NUMERIC_PINF = 0xd000;
const NUMERIC_NINF = 0xf000;
/** numeric keeps at most this many digits after the point (its display scale field's mask). */
const NUMERIC_MAX_DSCALE = 0x3fff;
/**
 * The most digits a numeric's whole part may have here, read or written. FileMaker numbers keep 400; PostgreSQL's
 * own limit (131,072) would let a ten-byte binary value become 131 KB of text.
 */
export const NUMERIC_MAX_WHOLE_DIGITS = 1000;
/** An exponent beyond this is past the cap above (or a fraction as long); checked before any digits are written out. */
const MAX_EXPONENT = 1000;
const overflow = () => new BinaryFormatError(`value overflows numeric format: more than ${NUMERIC_MAX_WHOLE_DIGITS} digits before the point, or an exponent past ${MAX_EXPONENT}`, '22003');

/** A number written out: sign, digits with at most one point, an optional exponent. One way to match each string, so linear time on any input. */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export const isPlainNumber = (s: string): boolean => PLAIN_NUMBER.test(s);

/** A plain decimal string ("-12.5", never exponent notation) for a number field's value; undefined when it holds no number. */
export function decimalText(v: unknown): string | undefined {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? expand(String(v)) : undefined;
  const s = String(v).trim();
  return isPlainNumber(s) ? expand(s) : undefined;
}

/** "1.5e-7" -> "0.00000015", "1e+21" -> "1000000000000000000000". */
function expand(s: string): string {
  const m = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  if (!m) return s;
  const [, sign, int, frac, exp] = m;
  // "1e999999999" (or "1e150000") in a number field must not become that many zeros.
  if (Math.abs(Number(exp ?? 0)) > MAX_EXPONENT) throw overflow();
  let digits = (int || '') + (frac || '');
  let point = (int || '').length + Number(exp ?? 0);
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '') || '0';
  if (whole.length > NUMERIC_MAX_WHOLE_DIGITS) throw overflow();
  const rest = digits.slice(point);
  return `${sign === '-' ? '-' : ''}${whole}${rest ? '.' + rest : ''}`;
}

/** numeric's binary form: digit count, weight, sign and display scale, then base-10000 digits. Takes a plain decimal, NaN or [-]Infinity. */
export function encodeNumeric(text: string): Buffer {
  const special = text === 'NaN' ? NUMERIC_NAN : text === 'Infinity' ? NUMERIC_PINF : text === '-Infinity' ? NUMERIC_NINF : undefined;
  if (special !== undefined) {
    const out = Buffer.alloc(8);
    out.writeUInt16BE(special, 4);
    return out;
  }
  const neg = text.startsWith('-');
  const [int, frac = ''] = text.replace(/^[+-]/, '').split('.');
  const dscale = frac.length;
  const intPadded = int.padStart(Math.ceil(int.length / 4) * 4, '0');
  const fracPadded = frac.padEnd(Math.ceil(frac.length / 4) * 4, '0');
  const groups: number[] = [];
  for (let i = 0; i < intPadded.length; i += 4) groups.push(Number(intPadded.slice(i, i + 4)));
  let weight = groups.length - 1;
  for (let i = 0; i < fracPadded.length; i += 4) groups.push(Number(fracPadded.slice(i, i + 4)));
  let first = 0;
  while (first < groups.length && groups[first] === 0) {
    first++;
    weight--;
  }
  let last = groups.length;
  while (last > first && groups[last - 1] === 0) last--;
  const digits = groups.slice(first, last);
  if (!digits.length) weight = 0;
  if (dscale > NUMERIC_MAX_DSCALE || weight > 0x7fff || weight < -0x8000 || digits.length > 0xffff) throw overflow();
  const out = Buffer.alloc(8 + digits.length * 2);
  out.writeUInt16BE(digits.length, 0);
  out.writeInt16BE(weight, 2);
  out.writeUInt16BE(digits.length && neg ? NUMERIC_NEG : NUMERIC_POS, 4);
  out.writeUInt16BE(dscale, 6);
  digits.forEach((g, i) => out.writeInt16BE(g, 8 + i * 2));
  return out;
}

/** numeric's binary form as text ("-12.50", "NaN", "Infinity"); checked as PostgreSQL's numeric_recv checks it. */
export function decodeNumeric(b: Buffer): string {
  const r = new Reader(b);
  const n = r.u16();
  const weight = r.i16();
  const sign = r.u16();
  const dscale = r.u16();
  if (![NUMERIC_POS, NUMERIC_NEG, NUMERIC_NAN, NUMERIC_PINF, NUMERIC_NINF].includes(sign)) throw malformed('invalid sign in external "numeric" value');
  if (dscale > NUMERIC_MAX_DSCALE) throw malformed('invalid scale in external "numeric" value');
  const groups: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = r.i16();
    if (g < 0 || g >= 10000) throw malformed('invalid digit in external "numeric" value');
    groups.push(g);
  }
  r.end();
  if (sign === NUMERIC_NAN) return 'NaN';
  if (sign === NUMERIC_PINF) return 'Infinity';
  if (sign === NUMERIC_NINF) return '-Infinity';
  // The text is never longer than the cap before the point and the display scale after it, whatever the weight says.
  if (n && (weight + 1) * 4 > NUMERIC_MAX_WHOLE_DIGITS) throw overflow();
  // The whole part is the groups up to the weight, the ones past the last given being zero: one pad for those, not one step each.
  const whole = n ? weight + 1 : 0;
  let int = '';
  for (let i = 0; i < Math.min(n, whole); i++) int += i ? String(groups[i]).padStart(4, '0') : String(groups[i]);
  if (whole > n) int += '0000'.repeat(whole - n);
  // Digits past the display scale are cut, as PostgreSQL does; a value that is then zero has no sign.
  const lead = weight < -1 ? (-weight - 1) * 4 : 0;
  let frac = '0'.repeat(Math.min(lead, dscale));
  for (let i = Math.max(0, weight + 1); i < n && frac.length < dscale; i++) frac += String(groups[i]).padStart(4, '0');
  frac = frac.padEnd(dscale, '0').slice(0, dscale);
  const zero = !/[1-9]/.test(int + frac);
  return `${sign === NUMERIC_NEG && !zero ? '-' : ''}${int || '0'}${frac ? '.' + frac : ''}`;
}

// --- dates and times ------------------------------------------------------------------

const pad = (n: number | bigint, w = 2) => String(n).padStart(w, '0');
const DAY_US = 86_400_000_000n;
const INT64_MAX = 0x7fffffffffffffffn;
const INT64_MIN = -0x8000000000000000n;
/** PostgreSQL's date range, in days from 2000-01-01: 4714-11-24 BC up to (not including) 5874898-01-01. */
const DATE_MIN = -2_451_545;
const DATE_END = 2_145_031_949;
/** PostgreSQL's timestamp range, in microseconds from 2000-01-01: 4714-11-24 BC up to (not including) 294277-01-01. */
const TIMESTAMP_MIN = -211_813_488_000_000_000n;
const TIMESTAMP_END = 9_223_371_331_200_000_000n;
const timeOverflow = (type: string) => new BinaryFormatError(`${type} out of range`, '22008');

/** Days from 2000-01-01 to a date of the proleptic Gregorian calendar PostgreSQL uses (year 0 is 1 BC). */
function daysFrom(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468 - 10_957;
}

/** The date a day count from 2000-01-01 falls on; plain integer arithmetic, so the whole of PostgreSQL's range works. */
function civil(days: number): [number, number, number] {
  const z = days + 10_957 + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** ISO text for a date, BC dates as "0044-03-15 BC" (PostgreSQL's ISO style). */
function dayText(days: number): { text: string; bc: boolean } {
  const [y, m, d] = civil(days);
  return { text: `${pad(y > 0 ? y : 1 - y, 4)}-${pad(m)}-${pad(d)}`, bc: y <= 0 };
}

function dateText(days: number): string {
  if (days === 0x7fffffff) return 'infinity';
  if (days === -0x80000000) return '-infinity';
  if (days < DATE_MIN || days >= DATE_END) throw timeOverflow('date');
  const { text, bc } = dayText(days);
  return bc ? `${text} BC` : text;
}

const fracText = (f: bigint) => (f ? '.' + pad(f, 6).replace(/0+$/, '') : '');

function clockText(us: bigint): string {
  const s = us / 1_000_000n;
  return `${pad(s / 3600n)}:${pad((s / 60n) % 60n)}:${pad(s % 60n)}${fracText(us % 1_000_000n)}`;
}

function timeText(us: bigint): string {
  if (us < 0n || us > DAY_US) throw timeOverflow('time');
  return clockText(us);
}

/** A timestamp's text, in UTC with no offset written (timestamptz too: it is compared with stored values that have none). */
function timestampText(us: bigint): string {
  if (us === INT64_MAX) return 'infinity';
  if (us === INT64_MIN) return '-infinity';
  if (us < TIMESTAMP_MIN || us >= TIMESTAMP_END) throw timeOverflow('timestamp');
  let days = us / DAY_US;
  let rest = us % DAY_US;
  if (rest < 0n) {
    rest += DAY_US;
    days -= 1n;
  }
  const { text, bc } = dayText(Number(days));
  return `${text} ${clockText(rest)}${bc ? ' BC' : ''}`;
}

/**
 * An interval in PostgreSQL's default output style (IntervalStyle postgres): "1 year 2 mons 3 days 04:05:06.5",
 * "-1 days +02:03:00". Follows PostgreSQL's EncodeInterval; unverified against a running server for negative
 * single units, which this writes as "-1 days" (PostgreSQL's code pluralises every value but 1).
 */
function intervalText(us: bigint, days: number, months: number): string {
  let out = '';
  let zero = true;
  let before = false;
  const part = (value: number, unit: string) => {
    if (!value) return;
    out += `${zero ? '' : ' '}${before && value > 0 ? '+' : ''}${value} ${unit}${value !== 1 ? 's' : ''}`;
    before = value < 0;
    zero = false;
  };
  part(Math.trunc(months / 12), 'year');
  part(months % 12, 'mon');
  part(days, 'day');
  if (zero || us !== 0n) {
    const minus = us < 0n;
    const a = minus ? -us : us;
    out += `${zero ? '' : ' '}${minus ? '-' : before ? '+' : ''}${pad(a / 3_600_000_000n)}:${pad((a / 60_000_000n) % 60n)}:${pad((a / 1_000_000n) % 60n)}${fracText(a % 1_000_000n)}`;
  }
  return out;
}

/** An interval's binary form, from its three parts (PostgreSQL keeps them apart: a month is not a number of days). */
export function encodeInterval(v: { micros: bigint; days: number; months: number }): Buffer {
  const out = Buffer.alloc(16);
  out.writeBigInt64BE(v.micros, 0);
  out.writeInt32BE(v.days, 8);
  out.writeInt32BE(v.months, 12);
  return out;
}

const DATE_TEXT = /^(\d{4,})-(\d{1,2})-(\d{1,2})( BC)?$/;
const CLOCK_TEXT = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

function parseDays(s: string): number {
  if (s === 'infinity') return 0x7fffffff;
  if (s === '-infinity') return -0x80000000;
  const m = DATE_TEXT.exec(s);
  if (!m) throw new BinaryFormatError('a date column holds a value that is not a date; ask for the column in the text format', '22007');
  const year = m[4] ? 1 - Number(m[1]) : Number(m[1]);
  const days = daysFrom(year, Number(m[2]), Number(m[3]));
  const [y, mo, d] = civil(days);
  if (y !== year || mo !== Number(m[2]) || d !== Number(m[3])) throw new BinaryFormatError('date field value out of range', '22008');
  if (days < DATE_MIN || days >= DATE_END) throw timeOverflow('date');
  return days;
}

function parseClock(s: string): bigint {
  const m = CLOCK_TEXT.exec(s);
  if (!m) throw new BinaryFormatError('a time column holds a value that is not a time; ask for the column in the text format', '22007');
  const [h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mi > 59 || se > 59) throw new BinaryFormatError('time field value out of range', '22008');
  const us = BigInt((h * 3600 + mi * 60 + se) * 1_000_000) + BigInt((m[4] ?? '').padEnd(6, '0') || '0');
  if (us > DAY_US) throw timeOverflow('time');
  return us;
}

/**
 * A timestamp's date, clock and " BC" mark, split the way `/^(\S+)[ T](\S+?)( BC)?$/` splits it (the date is as long as it can
 * be) but in one pass: that pattern tried every `T` in a long run of them, each time reading on to the end.
 */
export function splitTimestamp(s: string): [date: string, clock: string, bc: string | undefined] | undefined {
  const space = s.indexOf(' ');
  if (space === 0) return undefined;
  // The tail after a separator: no blank in it, or a single " BC" at the end after a clock with none.
  const tail = (from: number): [string, string | undefined] | undefined => {
    const t = s.slice(from);
    const blank = t.indexOf(' ');
    if (blank === -1) return t ? [t, undefined] : undefined;
    return blank > 0 && blank === t.length - 3 && t.endsWith(' BC') ? [t.slice(0, blank), ' BC'] : undefined;
  };
  if (space > 0) {
    const t = tail(space + 1);
    if (t) return [s.slice(0, space), t[0], t[1]];
    // Only a " BC" at the end can follow a separator before the blank.
    if (!s.endsWith(' BC') || space !== s.length - 3) return undefined;
  }
  // The date reaches the last `T` that leaves a clock behind it (before the blank, if there is one).
  const i = s.lastIndexOf('T', (space === -1 ? s.length : space) - 2);
  if (i < 1) return undefined;
  const t = tail(i + 1);
  return t ? [s.slice(0, i), t[0], t[1]] : undefined;
}

function parseTimestamp(s: string): bigint {
  if (s === 'infinity') return INT64_MAX;
  if (s === '-infinity') return INT64_MIN;
  const m = splitTimestamp(s);
  if (!m) throw new BinaryFormatError('a timestamp column holds a value that is not a timestamp; ask for the column in the text format', '22007');
  const us = BigInt(parseDays(m[0] + (m[2] ?? ''))) * DAY_US + parseClock(m[1]);
  if (us < TIMESTAMP_MIN || us >= TIMESTAMP_END) throw timeOverflow('timestamp');
  return us;
}

// --- results ----------------------------------------------------------------------------

const notWhole = (type: string) => new BinaryFormatError(`a value in an ${type} column is not a whole number; ask for the column in the text format`, '22P02');

/** A whole number in a two's-complement range, from a number, a bigint or its decimal text. */
function wholeNumber(v: unknown, type: string, min: bigint, max: bigint): bigint {
  let n: bigint;
  if (typeof v === 'bigint') n = v;
  else if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw notWhole(type);
    n = BigInt(v);
  } else {
    const s = String(v).trim();
    if (!/^[+-]?\d+$/.test(s)) throw notWhole(type);
    n = BigInt(s);
  }
  if (n < min || n > max) throw new BinaryFormatError(`a value is out of range for type ${type}`, '22003');
  return n;
}

function floatOf(v: unknown, type: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const s = String(v).trim();
  if (/^(NaN|[+-]?Infinity)$/.test(s) || isPlainNumber(s)) return Number(s);
  throw new BinaryFormatError(`a value in a ${type} column is not a number; ask for the column in the text format`, '22P02');
}

function uuidBytes(v: unknown): Buffer {
  const hex = String(v).trim().replace(/^\{(.*)\}$/, '$1').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new BinaryFormatError('a uuid column holds a value that is not a uuid; ask for the column in the text format', '22P02');
  return Buffer.from(hex, 'hex');
}

const TEXT_OIDS: ReadonlySet<number> = new Set([0, BINARY_OID.text, BINARY_OID.varchar, BINARY_OID.bpchar, BINARY_OID.name, BINARY_OID.unknown, BINARY_OID.json]);

function int(n: bigint, bytes: 2 | 4 | 8, unsigned = false): Buffer {
  const out = Buffer.alloc(bytes);
  if (bytes === 8) out.writeBigInt64BE(n);
  else if (bytes === 2) out.writeInt16BE(Number(n));
  else if (unsigned) out.writeUInt32BE(Number(n));
  else out.writeInt32BE(Number(n));
  return out;
}

/**
 * A result value in the binary format of its column's type; null for SQL NULL (or a number field holding no number).
 * A value its type cannot hold is a BinaryFormatError, never bytes the client would misread.
 */
export function binaryValue(value: SqlValue, oid: number): Buffer | null {
  const v = value as unknown;
  if (v === null || v === undefined) return null;
  switch (oid) {
    case BINARY_OID.bool: return Buffer.from([isFalse(v) ? 0 : 1]);
    case BINARY_OID.int2: return int(wholeNumber(v, 'int2', -0x8000n, 0x7fffn), 2);
    case BINARY_OID.int4: return int(wholeNumber(v, 'int4', -0x80000000n, 0x7fffffffn), 4);
    case BINARY_OID.oid: return int(wholeNumber(v, 'oid', 0n, 0xffffffffn), 4, true);
    case BINARY_OID.int8: return int(wholeNumber(v, 'int8', INT64_MIN, INT64_MAX), 8);
    case BINARY_OID.float4: {
      const out = Buffer.alloc(4);
      out.writeFloatBE(floatOf(v, 'float4'));
      return out;
    }
    case BINARY_OID.float8: {
      const out = Buffer.alloc(8);
      out.writeDoubleBE(floatOf(v, 'float8'));
      return out;
    }
    case BINARY_OID.uuid: return uuidBytes(v);
    case BINARY_OID.jsonb: return Buffer.concat([Buffer.from([1]), Buffer.from(String(v), 'utf8')]);
    case BINARY_OID.bytea: return Buffer.from(v instanceof Uint8Array ? v : Buffer.from(String(v), 'utf8'));
    case BINARY_OID.numeric: {
      const t = decimalText(v);
      return t === undefined ? null : encodeNumeric(t);
    }
    case BINARY_OID.date: return int(BigInt(parseDays(String(v).trim())), 4);
    case BINARY_OID.time: return int(parseClock(String(v).trim()), 8);
    case BINARY_OID.timestamp: case BINARY_OID.timestamptz: return int(parseTimestamp(String(v).trim()), 8);
    default:
      if (TEXT_OIDS.has(oid)) return Buffer.from(String(v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : v), 'utf8');
      throw new BinaryFormatError(`results of type ${oid} have no binary form here; ask for the column in the text format`, '0A000');
  }
}

/** A one-dimensional array's binary form (lower bound 1), its elements encoded as binaryValue encodes them. */
export function encodeArray(elements: SqlValue[], elementOid: number): Buffer {
  const head = Buffer.alloc(elements.length ? 20 : 12);
  head.writeInt32BE(elements.length ? 1 : 0, 0);
  head.writeInt32BE(elements.some((e) => e === null || e === undefined) ? 1 : 0, 4);
  head.writeUInt32BE(elementOid, 8);
  if (elements.length) {
    head.writeInt32BE(elements.length, 12);
    head.writeInt32BE(1, 16);
  }
  return Buffer.concat([head, ...elements.map((e) => {
    const b = binaryValue(e, elementOid);
    const len = Buffer.alloc(4);
    len.writeInt32BE(b ? b.length : -1);
    return b ? Buffer.concat([len, b]) : len;
  })]);
}

// --- parameters --------------------------------------------------------------------------

/** A float's text: the shortest form that reads back as the same value, the exponent with two digits as PostgreSQL writes it. */
function floatText(x: number, single: boolean): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (Object.is(x, -0)) return '-0';
  let s = String(x);
  if (single) {
    for (let p = 1; p <= 9; p++) {
      const t = x.toPrecision(p);
      if (Math.fround(Number(t)) === x) {
        s = String(Number(t));
        break;
      }
    }
  }
  // Where it switches to exponent notation follows JavaScript, not PostgreSQL (unverified for very large and small values).
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}

/** An element's text inside an array's text form: quoted when it is empty, NULL, or holds a brace, comma, quote, backslash or space. */
function quoted(s: string): string {
  return s === '' || /^null$/i.test(s) || /[{}",\\ \t\n\r\v\f]/.test(s) ? `"${s.replace(/["\\]/g, '\\$&')}"` : s;
}

function elementText(b: Buffer, oid: number): string {
  switch (oid) {
    case BINARY_OID.bool: return fixed(b, 1)[0] ? 't' : 'f';
    case BINARY_OID.int8: return fixed(b, 8).readBigInt64BE(0).toString();
    case BINARY_OID.float4: return floatText(fixed(b, 4).readFloatBE(0), true);
    case BINARY_OID.float8: return floatText(fixed(b, 8).readDoubleBE(0), false);
    case BINARY_OID.numeric: return decodeNumeric(b);
    default: return String(binaryParam(b, oid));
  }
}

const MAX_ARRAY_DIMENSIONS = 6;

/** What the array parameters of one Bind may expand to, in characters: kept per message, so portals cannot hold more. */
export interface ExpansionBudget { left: number; readonly total: number }
const EXPANSION_BASE = 256 * 1024;
/** Characters allowed per byte received: every element type's text fits in it (a bytea element is about two per byte), a crafted numeric does not. */
const EXPANSION_PER_BYTE = 4;
export function expansionBudget(bytes: number): ExpansionBudget {
  const total = EXPANSION_BASE + EXPANSION_PER_BYTE * bytes;
  return { left: total, total };
}

/** Takes `chars` of text from the Bind's allowance; 54000 once it is spent. */
function charge(budget: ExpansionBudget, chars: number): void {
  budget.left -= chars;
  if (budget.left < 0) {
    throw new BinaryFormatError(`the numeric and array parameters of one Bind may expand to at most ${budget.total} characters (${EXPANSION_BASE} plus ${EXPANSION_PER_BYTE} per byte sent); send the list in smaller parts`, '54000');
  }
}

/** An array parameter as PostgreSQL's text form of it, checked as its array_recv checks it. */
function arrayText(b: Buffer, element: number, budget: ExpansionBudget): string {
  const r = new Reader(b);
  const ndim = r.i32();
  const flags = r.i32();
  const given = r.u32();
  if (ndim < 0) throw malformed(`invalid number of dimensions: ${ndim}`);
  if (ndim > MAX_ARRAY_DIMENSIONS) throw new BinaryFormatError(`number of array dimensions (${ndim}) exceeds the maximum allowed (${MAX_ARRAY_DIMENSIONS})`, '54000');
  if (flags !== 0 && flags !== 1) throw malformed('invalid array flags');
  if (given !== element) throw new BinaryFormatError(`binary data has array element type ${given} instead of expected ${element}`, '42804');
  const dims: number[] = [];
  const lower: number[] = [];
  let count = ndim ? 1 : 0;
  for (let i = 0; i < ndim; i++) {
    const d = r.i32();
    const lb = r.i32();
    if (d < 0) throw malformed('invalid array dimensions');
    if (lb + d - 1 > 0x7fffffff) throw new BinaryFormatError('array upper bound is too large', '54000');
    dims.push(d);
    lower.push(lb);
    count *= d;
    // Every element takes at least its four-byte length, so a count the bytes cannot hold is refused before any work.
    if (count * 4 > r.left) throw short();
  }
  if (!count) {
    r.end();
    return '{}';
  }
  const items: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = r.i32();
    if (len < -1) throw short();
    const item = len === -1 ? 'NULL' : quoted(elementText(r.bytes(len), element));
    // Each element is charged as it is read, so the text stops growing as soon as the Bind's allowance is spent.
    charge(budget, item.length + 1);
    items.push(item);
  }
  r.end();
  let at = 0;
  const nest = (dim: number): string => {
    const parts: string[] = [];
    for (let i = 0; i < dims[dim]; i++) parts.push(dim + 1 < dims.length ? nest(dim + 1) : items[at++]);
    return `{${parts.join(',')}}`;
  };
  const bounds = lower.some((l) => l !== 1) ? dims.map((d, i) => `[${lower[i]}:${lower[i] + d - 1}]`).join('') + '=' : '';
  return bounds + nest(0);
}

/**
 * A parameter sent in the binary format, as the value its text format would give; undefined for a type it can't read.
 * Input that is not a value of the type (short, too long, out of range) is a BinaryFormatError. An array's text is
 * charged to `budget`, which a Bind shares among its parameters (54000 once spent).
 */
export function binaryParam(b: Buffer, oid: number, budget: ExpansionBudget = expansionBudget(b.length)): SqlValue | undefined {
  const element = ARRAY_ELEMENT[oid];
  if (element !== undefined) return arrayText(b, element, budget);
  switch (oid) {
    case BINARY_OID.bool: return fixed(b, 1)[0] ? 1 : 0;
    case BINARY_OID.int2: return fixed(b, 2).readInt16BE(0);
    case BINARY_OID.int4: return fixed(b, 4).readInt32BE(0);
    case BINARY_OID.oid: return fixed(b, 4).readUInt32BE(0);
    // Numbers as the text format reads them (Number of the text), so both formats find the same rows.
    case BINARY_OID.int8: return Number(fixed(b, 8).readBigInt64BE(0));
    case BINARY_OID.float4: return fixed(b, 4).readFloatBE(0);
    case BINARY_OID.float8: return fixed(b, 8).readDoubleBE(0);
    case BINARY_OID.numeric: {
      // As the text path: Number of the text, except NaN, which stays the text NaN.
      const t = decodeNumeric(b);
      // A ten-byte value can read as 16 KB of text (the scale), and a Bind may hold 65,535 of them.
      charge(budget, t.length);
      return t === 'NaN' ? 'NaN' : Number(t);
    }
    case BINARY_OID.bytea: return '\\x' + b.toString('hex');
    case BINARY_OID.date: return dateText(fixed(b, 4).readInt32BE(0));
    case BINARY_OID.time: return timeText(fixed(b, 8).readBigInt64BE(0));
    case BINARY_OID.timestamp: case BINARY_OID.timestamptz: return timestampText(fixed(b, 8).readBigInt64BE(0));
    case BINARY_OID.interval: {
      fixed(b, 16);
      return intervalText(b.readBigInt64BE(0), b.readInt32BE(8), b.readInt32BE(12));
    }
    case BINARY_OID.uuid: {
      const h = fixed(b, 16).toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    case BINARY_OID.jsonb: {
      if (!b.length) throw short();
      if (b[0] !== 1) throw malformed(`unsupported jsonb version number ${b[0]}`);
      return utf8Text(b.subarray(1));
    }
    default:
      return TEXT_OIDS.has(oid) ? utf8Text(b) : undefined;
  }
}

const CAST_TYPES: Record<string, number> = {
  int2: BINARY_OID.int2, smallint: BINARY_OID.int2, int4: BINARY_OID.int4, int: BINARY_OID.int4, integer: BINARY_OID.int4,
  int8: BINARY_OID.int8, bigint: BINARY_OID.int8, float4: BINARY_OID.float4, real: BINARY_OID.float4,
  float8: BINARY_OID.float8, 'double precision': BINARY_OID.float8, numeric: BINARY_OID.numeric, decimal: BINARY_OID.numeric,
  bool: BINARY_OID.bool, boolean: BINARY_OID.bool, date: BINARY_OID.date, time: BINARY_OID.time,
  timestamp: BINARY_OID.timestamp, timestamptz: BINARY_OID.timestamptz, text: BINARY_OID.text, varchar: BINARY_OID.varchar, bytea: BINARY_OID.bytea,
  oid: BINARY_OID.oid, name: BINARY_OID.name, uuid: BINARY_OID.uuid, json: BINARY_OID.json, jsonb: BINARY_OID.jsonb, interval: BINARY_OID.interval,
};

/**
 * Parameter types a query names with a cast ($1::numeric, $2::oid[]), by position, for
 * the ones its Parse left unspecified: Describe tells the client these, so a
 * driver that encodes by type (asyncpg) sends a Decimal, a date or a list as such.
 */
export function castParamTypes(sql: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of maskSql(sql).matchAll(/\$(\d+)\s*::\s*(double\s+precision|[a-z][a-z0-9]*)/gi)) {
    const base = CAST_TYPES[m[2].toLowerCase().replace(/\s+/g, ' ')];
    // The mask hides [] (a bracketed name to the tokenizer), at the same offsets: read it from the query itself.
    const array = /^\s*\[\s*\]/.test(sql.slice(m.index + m[0].length));
    const oid = base && array ? ARRAY_OF.get(base) : base;
    if (oid && !out.has(Number(m[1]))) out.set(Number(m[1]), oid);
  }
  return out;
}

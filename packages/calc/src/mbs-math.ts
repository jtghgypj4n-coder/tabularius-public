// MBS ( "Math.…" ) and ( "Time.…" ): MonkeyBread's number and time functions, following MBS's own function pages
// (mbsplugins.eu). Where a page leaves something out, the comment says what Tabularius does and that it's inferred.
// Not here: Math.Median (its page's one example disagrees with a median), Math.TextToNumber (its comma or dot
// detection isn't described), Math.InsidePolygon (deprecated, no result described), Time.Sleep and Time.Wait
// (they would hold up the server). They give an "isn't available" MBS error.

import { MbsError } from './mbs-text.ts';
import { decimalSum, num, text, type Value } from './values.ts';

const SECONDS_PER_DAY = 86400;
const UNIX_EPOCH_DAY = 719163;

/** What a function is given: each parameter as text (FileMaker's text of it) and as the value itself. */
export interface MathArgs { values: Value[]; texts: string[]; now: () => Date }
type MbsMath = (a: MathArgs) => Value;

// --- numbers ---------------------------------------------------------------------------------

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numberOf(s: string, what = 'value'): number {
  const t = s.trim();
  if (!NUMBER.test(t)) throw new MbsError(`"${s}" is not a number (${what})`);
  return Number(t);
}
const optional = (s: string | undefined, d: number, what?: string) => (s === undefined || s.trim() === '' ? d : numberOf(s, what));

/** Every number in the parameters: each may be one value or a list (one per line). Empty lines are skipped (inferred). */
function valuesOf(texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) for (const line of t.split(/\r\n|\r|\n/)) if (line.trim() !== '') out.push(numberOf(line));
  return out;
}
const list = (ns: number[]) => text(ns.map((n) => numText(n)).join('\r'));
/** A number as text, as FileMaker writes it (dot, no exponent for ordinary sizes). */
function numText(n: number): string {
  if (!Number.isFinite(n)) throw new MbsError('The result is not a finite number');
  const s = String(Number(n.toPrecision(16)));
  if (!/e/i.test(s)) return s;
  return n.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 16 });
}

// --- 64-bit integers ---------------------------------------------------------------------------
// The Bitwise functions use 64-bit signed integers (MBS since 7.3); GetBit, SetBit, ClearBit and BitwiseRotate show
// bit 63 unsigned in MBS's example (SetBit ( 0 ; 63 ) is 9223372036854775808). Fractions are cut off (inferred).

function int64(s: string, what = 'value'): bigint {
  const t = s.trim();
  if (/^[+-]?\d+$/.test(t)) return BigInt(t);
  const n = numberOf(t, what);
  if (!Number.isFinite(n)) throw new MbsError(`"${s}" is too large for a 64-bit integer`);
  return BigInt(Math.trunc(n));
}
/** A large integer as a number when a double holds it exactly, else as its digits. */
const big = (b: bigint): Value => (b >= -(2n ** 53n) && b <= 2n ** 53n ? num(Number(b)) : text(b.toString()));
const signed = (b: bigint) => big(BigInt.asIntN(64, b));
const unsigned = (b: bigint) => big(BigInt.asUintN(64, b));
function bitOf(s: string | undefined): bigint {
  const n = int64(s ?? '', 'bit');
  if (n < 0n || n > 63n) throw new MbsError('The bit number must be from 0 to 63');
  return n;
}
const fold = (op: (a: bigint, b: bigint) => bigint): MbsMath => ({ texts }) => {
  if (!texts.length) throw new MbsError('No values were given');
  return signed(texts.slice(1).reduce((acc, t) => op(acc, int64(t)), int64(texts[0])));
};

// --- binary numbers -----------------------------------------------------------------------------

function encodeNumber(type: string, bits: number, value: string, bigEndian: boolean): string {
  const kind = type.trim().toLowerCase();
  if (![8, 16, 24, 32, 64].includes(bits)) throw new MbsError('A number has 8, 16, 24, 32 or 64 bits');
  const b = Buffer.alloc(bits / 8);
  if (kind === 'float') {
    if (bits === 32) bigEndian ? b.writeFloatBE(numberOf(value)) : b.writeFloatLE(numberOf(value));
    else if (bits === 64) bigEndian ? b.writeDoubleBE(numberOf(value)) : b.writeDoubleLE(numberOf(value));
    else throw new MbsError('A float has 32 or 64 bits');
  } else if (kind === 'integer' || kind === 'unsignedinteger') {
    if (![8, 16, 24, 32, 64].includes(bits)) throw new MbsError('An integer has 8, 16, 24, 32 or 64 bits');
    const n = int64(value);
    const min = kind === 'integer' ? -(2n ** BigInt(bits - 1)) : 0n;
    const max = kind === 'integer' ? 2n ** BigInt(bits - 1) - 1n : 2n ** BigInt(bits) - 1n;
    if (n < min || n > max) throw new MbsError(`${value} doesn't fit in ${bits} bits`);
    let u = BigInt.asUintN(bits, n);
    for (let i = 0; i < bits / 8; i++) {
      b[bigEndian ? bits / 8 - 1 - i : i] = Number(u & 0xffn);
      u >>= 8n;
    }
  } else throw new MbsError(`Unknown number type "${type}": use Float, Integer or UnsignedInteger`);
  return b.toString('hex').toUpperCase();
}

function decodeNumber(type: string, bits: number, hex: string, bigEndian: boolean): Value {
  const kind = type.trim().toLowerCase();
  if (![8, 16, 24, 32, 64].includes(bits)) throw new MbsError('A number has 8, 16, 24, 32 or 64 bits');
  const h = hex.replace(/\s+/g, '');
  if (!/^[0-9a-f]*$/i.test(h) || h.length !== bits / 4) throw new MbsError(`Expected ${bits / 4} hex digits`);
  const b = Buffer.from(h, 'hex');
  if (kind === 'float') {
    if (bits === 32) return num(bigEndian ? b.readFloatBE() : b.readFloatLE());
    if (bits === 64) return num(bigEndian ? b.readDoubleBE() : b.readDoubleLE());
    throw new MbsError('A float has 32 or 64 bits');
  }
  if (kind !== 'integer' && kind !== 'unsignedinteger') throw new MbsError(`Unknown number type "${type}": use Float, Integer or UnsignedInteger`);
  if (![8, 16, 24, 32, 64].includes(bits)) throw new MbsError('An integer has 8, 16, 24, 32 or 64 bits');
  let u = 0n;
  for (let i = 0; i < bits / 8; i++) u = (u << 8n) | BigInt(b[bigEndian ? i : bits / 8 - 1 - i]);
  return big(kind === 'integer' ? BigInt.asIntN(bits, u) : u);
}

// --- Google's encoded polyline (one value) ---------------------------------------------------------

// Plain arithmetic rather than 32-bit bit operations, so values past ±10737 don't wrap.
function polylineEncode(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw new MbsError('The value is too large to encode');
  let n = Math.sign(v) * Math.round(Math.abs(v) * 1e5);
  n = n < 0 ? -2 * n - 1 : 2 * n;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n % 0x20)) + 63);
    n = Math.floor(n / 0x20);
  }
  return out + String.fromCharCode(n + 63);
}
function polylineDecode(s: string): number {
  let n = 0;
  let scale = 1;
  let i = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i) - 63;
    if (c < 0 || c > 63 || i >= 10) throw new MbsError('Not an encoded polyline value');
    n += (c % 0x20) * scale;
    scale *= 0x20;
    if (c < 0x20) break;
  }
  if (i !== s.length - 1) throw new MbsError('Pass one encoded value');
  return (n % 2 ? -(n + 1) / 2 : n / 2) / 1e5;
}

// --- statistics and finance --------------------------------------------------------------------

/** The normal distribution's inverse (Wichura's AS 241, accurate to about 1e-16), as Excel's NORM.INV. */
function normInv(p: number): number {
  if (!(p > 0 && p < 1)) throw new MbsError('The probability must be between 0 and 1');
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608)
      / (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  let x: number;
  if (r <= 5) {
    r -= 1.6;
    x = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734)
      / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    x = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772)
      / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -x : x;
}

/**
 * Excel's RATE: the rate per period, found by Newton's method from the guess. MBS: "If the successive results of
 * RATE do not converge to within 0.0000001 after 20 iterations, RATE returns an error."
 */
function rate(nper: number, pmt: number, pv: number, fv: number, type: number, guess: number): number {
  const f = (r: number) => {
    if (Math.abs(r) < 1e-12) return pv + pmt * nper + fv;
    const g = (1 + r) ** nper;
    return pv * g + pmt * (1 + r * type) * ((g - 1) / r) + fv;
  };
  // Newton from 0.1 needs more than 20 steps for a 30-year loan (360 periods), which Excel and LibreOffice still
  // solve, so Tabularius allows 150 as LibreOffice does (inferred).
  let r = guess;
  for (let i = 0; i < 150; i++) {
    const h = Math.max(1e-7, Math.abs(r) * 1e-7);
    const d = (f(r + h) - f(r - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - f(r) / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-7) return next;
    r = next;
  }
  throw new MbsError("Math.Rate doesn't converge for these values");
}

/** Math.MovingAverage, as MBS's examples show: until the window is full, it averages the values so far. */
function movingAverage(mode: string, values: number[], size: number): number[] {
  if (!(size >= 1)) throw new MbsError('The window size must be at least 1');
  const m = mode.trim().toLowerCase();
  if (m === 'simple' || m === 'weighted') {
    // Running sums, so a long list with a wide window stays linear. Weighted: the newest value counts most,
    // 1, 2, … n (MBS's numbers bear this out); each step every weight drops by one, the oldest to nothing.
    const out: number[] = [];
    let sum = 0;
    let weighted = 0;
    for (let i = 0; i < values.length; i++) {
      const len = Math.min(i + 1, size);
      if (i >= size) {
        weighted += size * values[i] - sum;
        sum += values[i] - values[i - size];
      } else {
        weighted += len * values[i];
        sum += values[i];
      }
      out.push(m === 'simple' ? sum / len : weighted / ((len * (len + 1)) / 2));
    }
    return out;
  }
  if (m === 'exponential' || m === 'exponential2') {
    const out: number[] = [];
    let last = values[0];
    for (const v of values) {
      last = out.length === 0 ? v : m === 'exponential' ? ((v - last) * 2) / size + last : (v * 2) / (size + 1) + last * (1 - 2 / (size + 1));
      out.push(last);
    }
    return out;
  }
  throw new MbsError(`Unknown mode "${mode}": use Simple, Weighted, Exponential or Exponential2`);
}

/** Luhn's check. Spaces and dashes between the digits are allowed (inferred). */
function luhn(s: string): boolean {
  const digits = s.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Math.FormatNumber: rounded half away from zero on the decimal digits (inferred: MBS says only "Values are
 * rounded"), with the decimal separator given (an empty one is "." as in MBS's own examples) and an optional
 * thousands separator; one the same as the decimal separator switches to the other character.
 */
function formatNumber(value: string, digitsText: string | undefined, decimalText: string | undefined, thousandsText: string | undefined): string {
  const t = value.trim();
  if (!NUMBER.test(t)) throw new MbsError(`"${value}" is not a number`);
  const digits = Math.trunc(optional(digitsText, 0, 'digits'));
  if (digits < 0 || digits > 20) throw new MbsError('Digits must be from 0 to 20');
  const decimal = decimalText?.trim() ? decimalText.trim() : '.';
  let thousands = thousandsText ?? '';
  if (thousands !== '' && thousands === decimal) thousands = decimal === '.' ? ',' : '.';
  // The value's own decimal digits, so 2.675 rounds as written rather than as its nearest double.
  const neg = t.startsWith('-');
  const [mant, exp = '0'] = t.replace(/^[+-]/, '').toLowerCase().split('e');
  const [ip = '', fp = ''] = mant.split('.');
  let digitsAll = (ip + fp).replace(/^0+(?=\d)/, '');
  // FileMaker's numbers go to about 1e400 either way; past that the digits would only use up memory.
  if (Math.abs(Number(exp)) > 400 || digitsAll.length > 1000) throw new MbsError(`"${value}" is too large to format`);
  let point = digitsAll.length - fp.length + Number(exp);
  if (point < 0) {
    digitsAll = '0'.repeat(-point) + digitsAll;
    point = 0;
  }
  if (point > digitsAll.length) digitsAll += '0'.repeat(point - digitsAll.length);
  let whole = digitsAll.slice(0, point) || '0';
  let frac = digitsAll.slice(point);
  if (frac.length > digits) {
    const up = Number(frac[digits]) >= 5;
    frac = frac.slice(0, digits);
    if (up) {
      const all = (BigInt(whole + frac) + 1n).toString().padStart(whole.length + frac.length, '0');
      whole = all.slice(0, all.length - digits) || '0';
      frac = all.slice(all.length - digits);
    }
  }
  frac = frac.padEnd(digits, '0');
  whole = whole.replace(/^0+(?=\d)/, '');
  let grouped = whole;
  if (thousands) {
    const groups: string[] = [];
    for (let end = whole.length; end > 0; end -= 3) groups.unshift(whole.slice(Math.max(0, end - 3), end));
    grouped = groups.join(thousands);
  }
  const zero = /^0*$/.test(whole + frac);
  return (neg && !zero ? '-' : '') + grouped + (digits ? decimal + frac : '');
}

// --- time -------------------------------------------------------------------------------------------
// A FileMaker timestamp is local time on the server (as Get ( CurrentTimeStamp ) is), and the offset is the one in
// force on that day, so daylight saving counts (inferred: MBS's 1956 example and its DST fixes point that way).

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number }
/** A date, time or timestamp parameter as FileMaker seconds since 1/1/0001; a date is its midnight. */
function fmSeconds(v: Value | undefined, what: string): number | undefined {
  if (!v) return undefined;
  if (v.type === 'timestamp') return v.value;
  if (v.type === 'date') return (v.value - 1) * SECONDS_PER_DAY;
  if (v.type === 'text' && v.value.trim() === '') return undefined;
  throw new MbsError(`The ${what} must be a timestamp or a date`);
}
/** A UTC Date for a calendar day, years 0-99 included (Date.UTC would take them as 1900-1999). */
function utcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  d.setUTCHours(hour, minute, second, 0);
  return d;
}
/** FileMaker's timestamps run from 1/1/0001 to 12/31/4000. */
function inRange(fm: number): number {
  if (!(fm >= 0 && fm < 1460970 * SECONDS_PER_DAY)) throw new MbsError('The timestamp is outside FileMaker\'s range (years 1 to 4000)');
  return fm;
}
function partsOf(fm: number): Parts {
  const d = new Date((inRange(fm) - (UNIX_EPOCH_DAY - 1) * SECONDS_PER_DAY) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() + d.getUTCMilliseconds() / 1000 };
}
/** FileMaker seconds for wall-clock parts (taken as UTC arithmetic: no zone). */
const fmOf = (p: Parts) => inRange(utcDate(p.year, p.month - 1, p.day, p.hour, p.minute).getTime() / 1000 + p.second + (UNIX_EPOCH_DAY - 1) * SECONDS_PER_DAY);
/** Unix seconds for a local FileMaker timestamp. */
function unixOfLocal(fm: number): number {
  const p = partsOf(fm);
  const d = new Date(p.year, p.month - 1, p.day, p.hour, p.minute, Math.floor(p.second));
  if (p.year < 100) d.setFullYear(p.year);
  return d.getTime() / 1000 + (p.second - Math.floor(p.second));
}
const unixOfUTC = (fm: number) => inRange(fm) - (UNIX_EPOCH_DAY - 1) * SECONDS_PER_DAY;
/** A local FileMaker timestamp for Unix seconds. */
function localOfUnix(unix: number): number {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) throw new MbsError('The time is outside FileMaker\'s range (years 1 to 4000)');
  return fmOf({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() + d.getMilliseconds() / 1000 });
}
const timestamp = (fm: number): Value => ({ type: 'timestamp', value: fm });
const pad = (n: number, w = 2, c = '0') => String(Math.trunc(n)).padStart(w, c);

/** "+01:00" or "+0100" for an offset in minutes east of UTC. */
const offsetText = (minutes: number, colon: boolean) =>
  (minutes < 0 ? '-' : '+') + pad(Math.floor(Math.abs(minutes) / 60)) + (colon ? ':' : '') + pad(Math.abs(minutes) % 60);

/** MBS's locale names ("FR_fr", "de_DE") as BCP 47; empty is English (C locale). */
function localeOf(s: string | undefined): string {
  const t = (s ?? '').trim();
  if (!t) return 'en-US';
  const [lang, region] = t.replace(/[.@].*$/, '').split(/[_-]/);
  const tag = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    throw new MbsError(`Unknown locale "${t}"`);
  }
}
function names(locale: string) {
  const at = (month: number, day: number) => new Date(Date.UTC(2023, month, day, 12));
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' });
  return {
    months: Array.from({ length: 12 }, (_, m) => f({ month: 'long' }).format(at(m, 1))),
    monthsShort: Array.from({ length: 12 }, (_, m) => f({ month: 'short' }).format(at(m, 1)).replace(/\.$/, '')),
    // 1 January 2023 was a Sunday.
    days: Array.from({ length: 7 }, (_, d) => f({ weekday: 'long' }).format(at(0, 1 + d))),
    daysShort: Array.from({ length: 7 }, (_, d) => f({ weekday: 'short' }).format(at(0, 1 + d)).replace(/\.$/, '')),
  };
}

/** ISO 8601 week and week-based year. */
function isoWeek(p: Parts): { week: number; year: number } {
  // The week's Thursday decides its year.
  const d = utcDate(p.year, p.month - 1, p.day);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { week: Math.ceil(((d.getTime() - utcDate(year, 0, 1).getTime()) / 86400000 + 1) / 7), year };
}

/** strftime, as Time.Format: the C library's conversions, with names in the locale asked for. */
function strftime(fm: number, format: string, locale: string): string {
  const p = partsOf(fm);
  const n = names(locale);
  const date = utcDate(p.year, p.month - 1, p.day);
  const weekday = date.getUTCDay();
  const yday = Math.round((date.getTime() - utcDate(p.year, 0, 1).getTime()) / 86400000) + 1;
  const unix = unixOfLocal(fm);
  const offset = -new Date(unix * 1000).getTimezoneOffset();
  const hour12 = p.hour % 12 || 12;
  // Each worked out once per call: a long format string repeating %Z, %c or %x stays quick.
  let zoneText: string | undefined;
  const zone = () =>
    (zoneText ??= new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date(unix * 1000)).find((x) => x.type === 'timeZoneName')?.value ?? '');
  let cText: string | undefined;
  let xText: string | undefined;
  const one = (c: string): string => {
    switch (c) {
      case 'a': return n.daysShort[weekday];
      case 'A': return n.days[weekday];
      case 'b': case 'h': return n.monthsShort[p.month - 1];
      case 'B': return n.months[p.month - 1];
      case 'c': return locale === 'en-US' ? `${one('a')} ${one('b')} ${one('e')} ${one('T')} ${p.year}` : (cText ??= new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'medium', timeZone: 'UTC' }).format(utcDate(p.year, p.month - 1, p.day, p.hour, p.minute, Math.floor(p.second))));
      case 'C': return pad(Math.floor(p.year / 100));
      case 'd': return pad(p.day);
      case 'D': return `${one('m')}/${one('d')}/${one('y')}`;
      case 'e': return pad(p.day, 2, ' ');
      case 'F': return `${pad(p.year, 4)}-${one('m')}-${one('d')}`;
      case 'G': return pad(isoWeek(p).year, 4);
      case 'g': return pad(isoWeek(p).year % 100);
      case 'H': return pad(p.hour);
      case 'I': return pad(hour12);
      case 'j': return pad(yday, 3);
      case 'k': return pad(p.hour, 2, ' ');
      case 'l': return pad(hour12, 2, ' ');
      case 'm': return pad(p.month);
      case 'M': return pad(p.minute);
      case 'n': return '\n';
      case 'p': return p.hour < 12 ? 'AM' : 'PM';
      case 'P': return p.hour < 12 ? 'am' : 'pm';
      case 'r': return `${one('I')}:${one('M')}:${one('S')} ${one('p')}`;
      case 'R': return `${one('H')}:${one('M')}`;
      case 's': return String(Math.floor(unix));
      case 'S': return pad(Math.floor(p.second));
      case 't': return '\t';
      case 'T': return `${one('H')}:${one('M')}:${one('S')}`;
      case 'u': return String(weekday || 7);
      case 'U': return pad(Math.floor((yday + 6 - weekday) / 7));
      case 'V': return pad(isoWeek(p).week);
      case 'w': return String(weekday);
      case 'W': return pad(Math.floor((yday + 6 - ((weekday + 6) % 7)) / 7));
      case 'x': return locale === 'en-US' ? `${one('m')}/${one('d')}/${one('y')}` : (xText ??= new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(utcDate(p.year, p.month - 1, p.day)));
      case 'X': return `${one('H')}:${one('M')}:${one('S')}`;
      case 'y': return pad(p.year % 100);
      case 'Y': return String(p.year);
      case 'z': return offsetText(offset, false);
      case 'Z': return zone();
      case '%': return '%';
      default: throw new MbsError(`Unknown format "%${c}"`);
    }
  };
  // %E and %O fall back to the plain conversion (MBS: when the locale has no alternative).
  return format.replace(/%[EO]?(.)/gs, (_, c: string) => one(c));
}

/** strptime, as Time.Parse: the result is a local timestamp. A date has to be in the text (inferred). */
function strptime(input: string, format: string, locale: string): number {
  const n = names(locale);
  let i = 0;
  const p: Partial<Parts> & { pm?: boolean; hour12?: number; century?: number; year2?: number } = {};
  const fail = (): never => {
    throw new MbsError(`"${input}" doesn't match the format "${format}"`);
  };
  const ws = () => {
    while (i < input.length && /\s/.test(input[i])) i++;
  };
  const numberAt = (max: number, lo: number, hi: number) => {
    ws();
    const m = new RegExp(`^[+-]?\\d{1,${max}}`).exec(input.slice(i));
    if (!m) fail();
    const v = Number(m![0]);
    if (v < lo || v > hi) fail();
    i += m![0].length;
    return v;
  };
  const nameAt = (long: string[], short: string[]) => {
    ws();
    for (const list of [long, short]) {
      const at = list.findIndex((x) => input.slice(i, i + x.length).toLowerCase() === x.toLowerCase());
      if (at >= 0) {
        i += list[at].length;
        return at;
      }
    }
    return fail();
  };
  const conv = (c: string): void => {
    switch (c) {
      case 'Y': p.year = numberAt(4, 0, 9999); break;
      case 'y': p.year2 = numberAt(2, 0, 99); break;
      case 'C': p.century = numberAt(2, 0, 99); break;
      case 'm': p.month = numberAt(2, 1, 12); break;
      case 'd': case 'e': p.day = numberAt(2, 1, 31); break;
      case 'H': case 'k': p.hour = numberAt(2, 0, 23); break;
      case 'I': case 'l': p.hour12 = numberAt(2, 1, 12); break;
      case 'M': p.minute = numberAt(2, 0, 59); break;
      case 'S': p.second = numberAt(2, 0, 60); break;
      case 'j': numberAt(3, 1, 366); break;
      case 'b': case 'B': case 'h': p.month = nameAt(n.months, n.monthsShort) + 1; break;
      case 'a': case 'A': nameAt(n.days, n.daysShort); break;
      case 'p': case 'P': {
        ws();
        const m = /^(am|pm)/i.exec(input.slice(i));
        if (!m) fail();
        p.pm = m![1].toLowerCase() === 'pm';
        i += 2;
        break;
      }
      case 'D': conv('m'); lit('/'); conv('d'); lit('/'); conv('y'); break;
      case 'F': conv('Y'); lit('-'); conv('m'); lit('-'); conv('d'); break;
      case 'R': conv('H'); lit(':'); conv('M'); break;
      case 'T': conv('H'); lit(':'); conv('M'); lit(':'); conv('S'); break;
      case 'r': conv('I'); lit(':'); conv('M'); lit(':'); conv('S'); conv('p'); break;
      case 'n': case 't': ws(); break;
      case '%': lit('%'); break;
      default: throw new MbsError(`The format "%${c}" isn't available in Tabularius's Time.Parse`);
    }
  };
  const lit = (x: string) => {
    if (/\s/.test(x)) return ws();
    if (input[i]?.toLowerCase() !== x.toLowerCase()) fail();
    i++;
  };
  for (let k = 0; k < format.length; k++) {
    if (format[k] === '%') {
      let c = format[++k];
      if (c === 'E' || c === 'O') c = format[++k];
      if (c === undefined) throw new MbsError('The format ends with %');
      conv(c);
    } else lit(format[k]);
  }
  // strptime: 69-99 are 1969-1999, 00-68 2000-2068; with %C, the century given.
  if (p.year === undefined && p.year2 !== undefined) p.year = p.century !== undefined ? p.century * 100 + p.year2 : p.year2 + (p.year2 < 69 ? 2000 : 1900);
  if (p.hour === undefined && p.hour12 !== undefined) p.hour = (p.hour12 % 12) + (p.pm ? 12 : 0);
  else if (p.hour !== undefined && p.pm !== undefined && p.hour < 12 && p.pm) p.hour += 12;
  if (p.year === undefined || p.month === undefined || p.day === undefined) throw new MbsError('The format needs a year, a month and a day');
  const days = utcDate(p.year, p.month, 0).getUTCDate();
  if (p.day > days) fail();
  return fmOf({ year: p.year, month: p.month, day: p.day, hour: p.hour ?? 0, minute: p.minute ?? 0, second: p.second ?? 0 });
}

// --- the functions --------------------------------------------------------------------------------

const units = (f: (v: number, dpi: number) => number): MbsMath => ({ texts: [v = '', dpi] }) => {
  const resolution = optional(dpi, 72, 'resolution');
  if (resolution <= 0) throw new MbsError('The resolution must be more than 0');
  return num(f(numberOf(v), resolution));
};

export const MBS_MATH: Record<string, MbsMath> = {
  'math.sum': ({ texts }) => {
    const v = valuesOf(texts);
    return v.length ? num(decimalSum(v)) : text('');
  },
  'math.average': ({ texts }) => {
    const v = valuesOf(texts);
    return v.length ? num(decimalSum(v) / v.length) : text('');
  },
  'math.min': ({ texts }) => {
    const v = valuesOf(texts);
    return v.length ? num(v.reduce((a, b) => (b < a ? b : a))) : text('');
  },
  'math.max': ({ texts }) => {
    const v = valuesOf(texts);
    return v.length ? num(v.reduce((a, b) => (b > a ? b : a))) : text('');
  },
  // The population's standard deviation, which MBS's example bears out (3.1232… for 12.5, 7, 10, 7.8, 15.5).
  'math.standarddeviation': ({ texts }) => {
    const v = valuesOf(texts);
    if (!v.length) return text('');
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return num(Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length));
  },
  // Each value times its factor: one factor for all, or a list matched line by line (shorter lists are an error, inferred).
  'math.multiply': ({ texts: [values = '', factors = ''] }) => {
    const v = valuesOf([values]);
    const f = valuesOf([factors]);
    if (f.length !== 1 && f.length !== v.length) throw new MbsError('Pass one factor, or one for each value');
    return list(v.map((x, i) => x * (f.length === 1 ? f[0] : f[i])));
  },
  // Zero stays zero (MBS: "We pass through values, which are zero").
  'math.reciprocal': ({ texts }) => list(valuesOf(texts).map((x) => (x === 0 ? 0 : 1 / x))),
  'math.movingaverage': ({ texts: [mode = '', values = '', size = ''] }) => list(movingAverage(mode, valuesOf([values]), Math.trunc(numberOf(size, 'window size')))),

  'math.bitwiseand': fold((a, b) => a & b),
  'math.bitwiseor': fold((a, b) => a | b),
  'math.bitwisexor': fold((a, b) => a ^ b),
  'math.bitwisenot': ({ texts: [v = ''] }) => signed(~int64(v)),
  'math.bitwiseshiftleft': ({ texts: [v = '', steps = ''] }) => {
    const s = int64(steps, 'steps');
    if (s < 0n || s > 63n) throw new MbsError('Steps must be from 0 to 63');
    return signed(int64(v) << s);
  },
  // An arithmetic shift: a negative number stays negative (inferred).
  'math.bitwiseshiftright': ({ texts: [v = '', steps = ''] }) => {
    const s = int64(steps, 'steps');
    if (s < 0n || s > 63n) throw new MbsError('Steps must be from 0 to 63');
    return signed(BigInt.asIntN(64, int64(v)) >> s);
  },
  // Left by Bits; a negative number of bits rotates right (MBS's example: 128 by -1 is 64).
  'math.bitwiserotate': ({ texts: [v = '', bits = ''] }) => {
    const b = int64(bits, 'bits');
    if (b < -63n || b > 63n) throw new MbsError('Bits must be from -63 to 63');
    const s = ((b % 64n) + 64n) % 64n;
    const u = BigInt.asUintN(64, int64(v));
    return unsigned(s === 0n ? u : (u << s) | (u >> (64n - s)));
  },
  'math.getbit': ({ texts: [v = '', bit] }) => num(Number((BigInt.asUintN(64, int64(v)) >> bitOf(bit)) & 1n)),
  'math.setbit': ({ texts: [v = '', bit] }) => unsigned(BigInt.asUintN(64, int64(v)) | (1n << bitOf(bit))),
  'math.clearbit': ({ texts: [v = '', bit] }) => unsigned(BigInt.asUintN(64, int64(v)) & ~(1n << bitOf(bit))),
  // 32-bit; a negative number is its two's complement (inferred).
  'math.dectohex': ({ texts: [v = '', noZeros] }) => {
    const n = int64(v);
    if (n < -(2n ** 31n) || n >= 2n ** 32n) throw new MbsError(`${v} doesn't fit in 32 bits`);
    const hex = BigInt.asUintN(32, n).toString(16).toUpperCase().padStart(8, '0');
    return text(optional(noZeros, 0) ? hex.replace(/^0+(?=.)/, '') : hex);
  },
  // Up to 8 hex digits, read as unsigned (inferred).
  'math.hextodec': ({ texts: [hex = ''] }) => {
    const h = hex.trim().replace(/^0x/i, '');
    if (!/^[0-9a-f]{1,8}$/i.test(h)) throw new MbsError(`"${hex}" is not a hex number of up to 8 digits`);
    return num(parseInt(h, 16));
  },
  'math.encodenumber': ({ texts: [type = '', bits = '', value = '', be] }) => text(encodeNumber(type, Math.trunc(numberOf(bits, 'bits')), value, optional(be, 0) === 1)),
  'math.decodenumber': ({ texts: [type = '', bits = '', hex = '', be] }) => decodeNumber(type, Math.trunc(numberOf(bits, 'bits')), hex, optional(be, 0) === 1),

  'math.inchtopixel': units((v, dpi) => v * dpi),
  'math.pixeltoinch': units((v, dpi) => v / dpi),
  'math.millimetertopixel': units((v, dpi) => (v / 25.4) * dpi),
  'math.pixeltomillimeter': units((v, dpi) => (v * 25.4) / dpi),
  'math.polylineencode': ({ texts: [v = ''] }) => text(polylineEncode(numberOf(v))),
  'math.polylinedecode': ({ texts: [s = ''] }) => num(polylineDecode(s)),
  'math.isvalidcc': ({ texts: [s = ''] }) => num(luhn(s) ? 1 : 0),

  // Excel's NORM.INV; the mean and standard deviation have to be given (MBS doesn't say what they default to).
  'math.norminv': ({ texts: [p = '', mean, sd] }) => {
    if (mean === undefined || sd === undefined) throw new MbsError('Pass the probability, the mean and the standard deviation');
    const s = numberOf(sd, 'standard deviation');
    if (s <= 0) throw new MbsError('The standard deviation must be more than 0');
    return num(numberOf(mean, 'mean') + s * normInv(numberOf(p, 'probability')));
  },
  'math.rate': ({ texts: [nper = '', pmt = '', pv = '', fv, type, guess] }) => {
    const n = numberOf(nper, 'periods');
    if (n <= 0) throw new MbsError('The number of periods must be more than 0');
    return num(rate(n, numberOf(pmt, 'payment'), numberOf(pv, 'present value'), optional(fv, 0), optional(type, 0) ? 1 : 0, optional(guess, 0.1)));
  },
  'math.formatnumber': ({ texts: [v = '', digits, decimal, thousands] }) => text(formatNumber(v, digits, decimal, thousands)),
  // Always with a dot, as FileMaker's own text of a number.
  'math.numbertotext': ({ texts: [v = ''] }) => text(numText(numberOf(v))),

  'math.random.normaldistribution': ({ texts: [mean = '', sd = ''] }) => {
    const u = 1 - Math.random();
    return num(numberOf(mean, 'mean') + numberOf(sd, 'standard deviation') * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()));
  },
  'math.random.exponentialdistribution': ({ texts: [lambda = ''] }) => {
    const l = numberOf(lambda, 'lambda');
    if (l <= 0) throw new MbsError('Lambda must be more than 0');
    return num(-Math.log(1 - Math.random()) / l);
  },
  'math.random.poissondistribution': ({ texts: [mean = ''] }) => {
    const m = numberOf(mean, 'mean');
    // Knuth's method, in parts of at most 500 (a sum of Poisson draws is Poisson with the summed mean), since e^-m
    // underflows past about 700. The cap keeps the draw quick (inferred: MBS gives none).
    if (m <= 0 || m > 1e6) throw new MbsError('The mean must be more than 0 and at most 1000000');
    let k = 0;
    for (let left = m; left > 0; left -= 500) {
      const limit = Math.exp(-Math.min(left, 500));
      for (let p = Math.random(); p > limit; p *= Math.random()) k++;
    }
    return num(k);
  },

  // --- Time.* -----------------------------------------------------------------------------------
  // MBS 15.0: an empty timestamp gives an empty result.
  'time.format': ({ values: [ts], texts: [, format = '', locale] }) => {
    const fm = fmSeconds(ts, 'timestamp');
    return text(fm === undefined ? '' : strftime(fm, format, localeOf(locale)));
  },
  'time.parse': ({ texts: [input = '', format = '', locale] }) => timestamp(strptime(input, format, localeOf(locale))),
  // With no timestamp, now; a timestamp passed is local unless gmt is 1 (local when left out, inferred from MBS's
  // "Be aware that the system timezone is used").
  'time.unixtimestamp': ({ values: [ts], texts: [, gmt], now }) => {
    const fm = fmSeconds(ts, 'timestamp');
    if (fm === undefined) return num(Math.floor(now().getTime() / 1000));
    return num(Math.floor(optional(gmt, 0) === 1 ? unixOfUTC(fm) : unixOfLocal(fm)));
  },
  'time.unixtimestamptofilemaker': ({ texts: [unix = '', gmt] }) => {
    const u = numberOf(unix, 'unix time');
    return timestamp(optional(gmt, 0) === 1 ? inRange(u + (UNIX_EPOCH_DAY - 1) * SECONDS_PER_DAY) : localOfUnix(u));
  },
  'time.timestamptoutc': ({ values: [ts], texts: [, asText] }) => {
    const fm = fmSeconds(ts, 'timestamp');
    if (fm === undefined) throw new MbsError('Pass a timestamp');
    const utc = inRange(unixOfLocal(fm) + (UNIX_EPOCH_DAY - 1) * SECONDS_PER_DAY);
    if (!optional(asText, 0)) return timestamp(utc);
    const p = partsOf(utc);
    return text(`${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(Math.floor(p.second))}Z`);
  },
  // Now's offset east of UTC: seconds, or "+01:00".
  'time.timezoneoffset': ({ texts: [asText], now }) => {
    const minutes = -now().getTimezoneOffset();
    return optional(asText, 0) ? text(offsetText(minutes, true)) : num(minutes * 60);
  },
};

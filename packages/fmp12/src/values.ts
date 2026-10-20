// Conversion of stored field text to typed values. FileMaker stores every
// value as the text the user saw, so dates and timestamps follow the file's
// date format (month/day/year in US-created files).

import type { FieldType } from './schema.ts';

export type DateOrder = 'MDY' | 'DMY' | 'YMD' | 'ISO';
/** A date order, or an order with two-digit months and days ("09/05/2026"). */
export type DateStyle = DateOrder | { order: DateOrder; padded?: boolean };
export const dateOrderOf = (f: DateStyle): DateOrder => (typeof f === 'string' ? f : f.order);
export type Value = string | number | null;

const DATE_RE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*([AaPp][Mm])?$/;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function parseDate(s: string, format: DateStyle = 'MDY'): string | undefined {
  const order = dateOrderOf(format);
  if (order === 'ISO') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!iso) return undefined;
    const [y, mo, d] = iso.slice(1).map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1] ? `${pad(y, 4)}-${pad(mo)}-${pad(d)}` : undefined;
  }
  const m = DATE_RE.exec(s.trim());
  if (!m) return undefined;
  const [a, b, c] = [m[1], m[2], m[3]].map(Number);
  let y: number, mo: number, d: number;
  const yearFirst = m[1].length === 4 || order === 'YMD';
  if (yearFirst) [y, mo, d] = [a, b, c];
  else if (order === 'DMY') [d, mo, y] = [a, b, c];
  else [mo, d, y] = [a, b, c];
  // A two-digit year gets a century; "2026-07-03" has a four-digit one.
  if ((yearFirst ? m[1] : m[3]).length <= 2) y += y < 50 ? 2000 : 1900;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

export function parseTime(s: string): string | undefined {
  const m = TIME_RE.exec(s.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const ampm = m[5]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${pad(h)}:${m[2]}:${m[3] ?? '00'}${m[4] ?? ''}`;
}

export function parseTimestamp(s: string, order: DateStyle = 'MDY'): string | undefined {
  const t = s.trim();
  // ISO: a T or a space between the date and the time, as ExecuteSQL reads timestamps.
  const sp = dateOrderOf(order) === 'ISO' ? t.search(/[T ]/) : t.indexOf(' ');
  if (dateOrderOf(order) === 'ISO' && sp < 0) return undefined;
  if (sp < 0) return parseDate(t, order) ? `${parseDate(t, order)}T00:00:00` : undefined;
  const d = parseDate(t.slice(0, sp), order);
  const tm = parseTime(t.slice(sp + 1));
  return d && tm ? `${d}T${tm}` : undefined;
}

/**
 * Typed value for a field: numbers as numbers, dates/times as ISO 8601 text.
 * Anything that doesn't parse is returned as the original text, because
 * FileMaker lets users store free text in typed fields.
 */
export function typedValue(text: string, type: FieldType, order: DateStyle = 'MDY'): Value {
  if (text === '') return null;
  switch (type) {
    case 'number': {
      const n = Number(text.trim().replace(/,/g, ''));
      return text.trim() !== '' && Number.isFinite(n) ? n : text;
    }
    case 'date': return parseDate(text, order) ?? text;
    case 'time': return parseTime(text) ?? text;
    case 'timestamp': return parseTimestamp(text, order) ?? text;
    default: return text;
  }
}

/** Guess a file's date order from sample date values. */
export function inferDateOrder(samples: string[]): DateOrder {
  for (const s of samples) {
    const m = DATE_RE.exec(s.trim());
    if (!m) continue;
    if (m[1].length === 4) return 'YMD';
    if (Number(m[1]) > 12) return 'DMY';
    if (Number(m[2]) > 12) return 'MDY';
  }
  return 'MDY';
}

/**
 * Whether a file writes months and days with two digits, from sample date
 * and timestamp values: most of them do when the file's format does.
 */
export function inferDatePadding(samples: string[]): boolean {
  let padded = 0, plain = 0;
  for (const s of samples) {
    const m = DATE_RE.exec(s.trim().split(' ')[0]);
    if (!m || m[1].length === 4) continue;
    if (/^0\d$/.test(m[1]) || /^0\d$/.test(m[2])) padded++;
    else if (m[1].length === 1 || m[2].length === 1) plain++;
  }
  return padded > plain;
}

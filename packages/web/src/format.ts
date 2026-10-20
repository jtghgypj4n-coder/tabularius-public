// Field data formatting: values as a field's Inspector settings show them.

import type { DataFormat, DateFormat, NumberFormat, TimeFormat } from './types.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const padTo = (n: number | string, pad: string) => (pad ? String(n).padStart(2, pad) : String(n));

/** The digits of a non-negative finite number written out in full (never 1e-7 or 1e+21): whole part and fraction. */
function plainDigits(abs: number): [whole: string, frac: string] {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(abs))!;
  const digits = m[1] + (m[2] ?? '');
  const point = m[1].length + Number(m[3] ?? 0);
  if (point <= 0) return ['0', '0'.repeat(-point) + digits];
  if (point >= digits.length) return [digits.padEnd(point, '0'), ''];
  return [digits.slice(0, point), digits.slice(point)];
}

/** Moves the decimal point two places right (a percentage). */
function percentDigits([whole, frac]: [string, string]): [string, string] {
  const f = frac.padEnd(2, '0');
  return [(whole + f.slice(0, 2)).replace(/^0+(?=\d)/, ''), f.slice(2)];
}

/**
 * Rounds written-out digits to `places` decimals, halves away from zero, by the decimal digits themselves, so 1.005 at
 * two places is 1.01 (the binary double behind it is a hair under, which toFixed would follow).
 */
function roundDigits([whole, frac]: [string, string], places: number): [string, string] {
  if (frac.length <= places) return [whole, frac.padEnd(places, '0')];
  let kept = whole + frac.slice(0, places);
  if (frac[places] >= '5') kept = (BigInt(kept) + 1n).toString().padStart(kept.length, '0');
  kept = kept.padStart(places + 1, '0');
  return [kept.slice(0, kept.length - places), places ? kept.slice(-places) : ''];
}

function formatNumber(value: string, n: NumberFormat): { text: string; color?: string } | undefined {
  const x = Number(value);
  if (!Number.isFinite(x)) return undefined;
  if (n.boolean) return { text: x !== 0 ? n.boolean.true : n.boolean.false };
  if (n.blankIfZero && x === 0) return { text: '' };
  const percent = n.notation === '%';
  const written = plainDigits(Math.abs(x));
  const scaled = percent ? percentDigits(written) : written;
  // Keep the usual ten-place display for non-fixed formats. If that rounds a nonzero value to zero,
  // show its actual digits instead; explicit decimal settings still round as requested.
  let [whole, frac] = n.decimals === undefined
    ? roundDigits(scaled, 10)
    : roundDigits(scaled, Math.min(n.decimals, 20));
  if (n.decimals === undefined) {
    if (x !== 0 && whole === '0' && !/[1-9]/.test(frac)) [whole, frac] = scaled;
    else frac = frac.replace(/0+$/, '');
  }
  if (n.thousands) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, n.thousands);
  const digits = whole + (frac ? n.decimalPoint + frac : '');
  const note = (s: string) => (!n.notation ? s : n.leading ? n.notation + s : s + n.notation);
  const negative = (s: string) => {
    if (x >= 0) return s;
    switch (n.negativeStyle) {
      case 1: return `${s}-`;
      case 2: return `(${s})`;
      case 3: return `<${s}>`;
      case 4: return `${s} CR`;
      case 5: return `▲${s}`;
      default: return `-${s}`;
    }
  };
  const text = n.outside ? note(negative(digits)) : negative(note(digits));
  return { text, color: x < 0 ? n.negativeColor : undefined };
}

function formatDate(value: string, d: DateFormat): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/.exec(value.trim());
  if (!m) return undefined;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12) return undefined;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  const weekday = DAYS[date.getUTCDay()];
  const el = (e: number): string => {
    switch (e) {
      case 1: return padTo(day, d.dayPad);
      case 2: return weekday.slice(0, 3);
      case 3: return weekday;
      case 4: return padTo(month, d.monthPad);
      case 5: return MONTHS[month - 1].slice(0, 3);
      case 6: return MONTHS[month - 1];
      case 7: return String(year % 100).padStart(2, '0');
      case 8: return String(year);
      default: return '';
    }
  };
  switch (d.style) {
    case 1: {
      const sep = d.separators ?? [];
      return (d.elements ?? []).reduce((s, e, i) => s + el(e) + (sep[i + 1] ?? ''), sep[0] ?? '');
    }
    case 3: return `${el(5)} ${el(1)}, ${year}`;
    case 4: return `${el(6)} ${el(1)}, ${year}`;
    case 5: return `${el(2)}, ${el(5)} ${el(1)}, ${year}`;
    case 6: return `${el(3)}, ${el(6)} ${el(1)}, ${year}`;
    default: return [el(4), el(1), year].join(d.separator);
  }
}

function formatTime(value: string, t: TimeFormat): string | undefined {
  const m = /^(-?\d+):(\d{1,2})(?::(\d{1,2})(\.\d+)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const hour = Number(m[1]);
  // A duration below an hour that is negative (-0:30:00) has no hour to carry its sign; it is not a time of day either.
  const below = m[1].startsWith('-');
  const clock = !t.h24 && !below && hour >= 0 && hour < 24;
  const parts = [below && hour === 0 ? '-' + padTo(0, t.hourPad) : padTo(clock ? hour % 12 || 12 : hour, t.hourPad)];
  if (t.minutes) parts.push(padTo(Number(m[2]), t.minSecPad));
  if (t.seconds) parts.push(padTo(Number(m[3] ?? 0), t.minSecPad) + (m[4] ?? ''));
  const time = parts.join(t.separator);
  const mark = clock ? (hour < 12 ? t.am : t.pm) : t.h24 ? t.am : '';
  return t.prefix ? mark + time : time + mark;
}

/**
 * A value as the field's data formatting shows it, or undefined to show it as
 * stored. Number formats apply to number fields, date and time formats to
 * date, time and timestamp fields (Data API strings: MM/DD/YYYY, HH:MM:SS).
 */
export function formatValue(value: string, type: string | undefined, format: DataFormat | undefined): { text: string; color?: string } | undefined {
  if (!format || value.trim() === '') return undefined;
  if (type === 'number') return format.number && formatNumber(value, format.number);
  if (type === 'date') {
    const text = format.date && formatDate(value, format.date);
    return text === undefined ? undefined : { text };
  }
  if (type === 'time') {
    const text = format.time && formatTime(value, format.time);
    return text === undefined ? undefined : { text };
  }
  if (type === 'timestamp' && (format.date || format.time)) {
    const m = /^(\S+)\s+(\S+)$/.exec(value.trim());
    if (!m) return undefined;
    const date = (format.date && formatDate(m[1], format.date)) ?? m[1];
    const time = (format.time && formatTime(m[2], format.time)) ?? m[2];
    return { text: `${date} ${time}` };
  }
  return undefined;
}

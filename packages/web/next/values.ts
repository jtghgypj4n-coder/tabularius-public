// How values read in the alternative client: dates in words, numbers grouped, empty as nothing at all.

import type { Value } from '../src/types.ts';
import type { Column } from './model.ts';

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const STAMP = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function date(m: RegExpExecArray): Date {
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  if (m[4] !== undefined) d.setHours(Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return d;
}

/** A value as text for reading (not for editing: the field keeps the stored form). */
export function show(v: Value | undefined, c?: Pick<Column, 'type'>): string {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v);
  const type = c?.type;
  if (type === 'date') {
    const m = DATE.exec(s);
    if (m) return date(m).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  if (type === 'timestamp') {
    const m = STAMP.exec(s);
    if (m) return date(m).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (type === 'number' && typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 10 });
  if (type === 'number' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s).toLocaleString(undefined, { maximumFractionDigits: 10 });
  return s;
}

/** The stored form of a date for an <input type="date"> and back (MM/DD/YYYY <-> YYYY-MM-DD). */
export function toInputDate(v: string): string {
  const m = DATE.exec(v);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}
export function fromInputDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : v;
}

/** Whether a container's value is a picture the browser can draw. */
export function isImage(v: Value | undefined): boolean {
  return typeof v === 'string' && /^(\/|https?:)/.test(v) && /\.(png|jpe?g|gif|webp|svg|heic|bmp)(\?|$)/i.test(v.split('?')[0] + '?');
}

/** The file name a container URL ends with ("/tabularius/containers/Shop/12/Menu%20card.pdf?…" -> "Menu card.pdf"). */
export function fileName(url: string): string {
  const last = url.split('?')[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(last) || 'File';
  } catch {
    return last || 'File';
  }
}

/** Initials for a record without a picture: "Ada Lovelace" -> "AL". */
export function initials(s: string): string {
  const words = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}

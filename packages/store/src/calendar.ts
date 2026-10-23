// iCalendar (RFC 5545) for date fields: a feed built from a layout's records, and a reader for .ics files.
//
// Times. A date field is an all-day event. A timestamp field has no zone, so by default an event is written as a
// floating time (the clock reading, with no zone: a calendar app shows it at the same reading wherever it is). Say
// which zone the readings are in (an IANA name, or UTC) and they are written as UTC instants instead. A reading that
// does not exist in that zone (the hour a clock skips forward) is moved forward by the length of the skip, and one
// that happens twice (the hour a clock repeats) is taken as its first time. Those two choices are Tabularius's own.
//
// An all-day event's end date is inclusive: a record that ends on the 17th is shown through the 17th. (iCalendar's
// own DTEND is exclusive, so the feed writes the day after, and the reader takes it back.) Also Tabularius's choice.

import { StoreError } from './errors.ts';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const DAY = 86_400_000;

/** A calendar date, "YYYY-MM-DD", or undefined when the text is not one (2026-02-30 is not, and nor is a year before 1000). */
export function parseDate(text: string): string | undefined {
  const m = DATE.exec(text.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1000 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** A clock reading, "YYYY-MM-DDTHH:MM:SS", or undefined when the text is not one. A fraction of a second is dropped. */
export function parseStamp(text: string): string | undefined {
  const m = STAMP.exec(text.trim());
  if (!m) return undefined;
  const date = parseDate(`${m[1]}-${m[2]}-${m[3]}`);
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (!date || h > 23 || mi > 59 || s > 59) return undefined;
  return `${date}T${m[4]}:${m[5]}:${String(s).padStart(2, '0')}`;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const wallMs = (stamp: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(stamp)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
};
/** A clock reading from milliseconds, or undefined when the result is not a year between 1000 and 9999. */
const safeText = (ms: number): string | undefined => (ms >= MIN_MS && ms <= MAX_MS ? wallText(ms) : undefined);
const wallText = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

const MIN_MS = -30_610_224_000_000; // 1000-01-01T00:00:00Z
const MAX_MS = 253_402_300_799_000; // 9999-12-31T23:59:59Z

/** The day after (or before) a date, kept between years 1000 and 9999 (a date beyond is the nearest one inside). */
export function addDays(date: string, days: number): string {
  const m = DATE.exec(date)!;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY;
  if (!(ms >= MIN_MS)) return '1000-01-01';
  if (!(ms <= MAX_MS)) return '9999-12-31';
  return new Date(ms).toISOString().slice(0, 10);
}

// --- zones -----------------------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

/** An IANA zone name as the platform spells it ("europe/london" is "Europe/London"), or undefined when it is not one. */
export function zoneName(zone: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(ms: number, zone: string): number {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, f);
  }
  const part: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') part[p.type] = Number(p.value);
  // The era-less year of a date before year 1 never occurs here: stamps are four-digit years.
  const shown = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return shown - Math.floor(ms / 1000) * 1000;
}

/** The UTC reading ("YYYY-MM-DDTHH:MM:SS") of a clock reading in a zone; undefined when it falls outside years 1000 to 9999. */
export function zonedToUtc(stamp: string, zone: string): string | undefined {
  const wall = wallMs(stamp);
  const before = offsetAt(wall - DAY, zone);
  const after = offsetAt(wall + DAY, zone);
  const instants = [...new Set([before, after])].map((o) => wall - o).filter((t) => offsetAt(t, zone) === wall - t).sort((a, b) => a - b);
  // A reading the zone skips: the offset from before the skip puts it just after.
  return safeText(instants.length ? instants[0] : wall - before);
}

/** The clock reading in a zone of a UTC reading; undefined when it falls outside years 1000 to 9999. */
export function utcToZoned(stamp: string, zone: string): string | undefined {
  const ms = wallMs(stamp);
  return safeText(ms + offsetAt(ms, zone));
}

// --- the feed --------------------------------------------------------------------------------------------------------

/** When something happens: a day, a clock reading with no zone, or a UTC reading. */
export type When = { date: string } | { floating: string } | { utc: string };

export interface FeedEvent {
  /** Stable for the record, so a calendar app updates the event rather than adding a second one. */
  uid: string;
  start: When;
  /** For a day, the last day (inclusive). */
  end?: When;
  summary: string;
  description?: string;
  location?: string;
  /** Counts the changes to the record. */
  sequence?: number;
}

/** Text in an iCalendar TEXT value: control characters dropped, line breaks and the characters it reserves escaped. */
export function escapeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** A content line folded at 75 octets (a continuation starts with one space), never inside a UTF-8 character. */
export function foldLine(line: string): string[] {
  if (Buffer.byteLength(line) <= 75) return [line];
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (out.length ? 74 : 75)) {
      out.push(out.length ? ' ' + current : current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(out.length ? ' ' + current : current);
  return out;
}

const compact = (stamp: string) => stamp.replace(/[-:]/g, '');
const dateValue = (when: { date: string }) => when.date.replace(/-/g, '');

function whenLine(name: 'DTSTART' | 'DTEND', when: When, endOfDay = false): string {
  if ('date' in when) return `${name};VALUE=DATE:${dateValue(endOfDay ? { date: addDays(when.date, 1) } : when)}`;
  if ('utc' in when) return `${name}:${compact(when.utc)}Z`;
  return `${name}:${compact(when.floating)}`;
}

const kind = (when: When) => Object.keys(when)[0];
const instant = (when: When): string => 'date' in when ? `${when.date}T00:00:00` : 'utc' in when ? when.utc : when.floating;

/**
 * The iCalendar text for some events. `stamp` is when it was made (DTSTAMP). An end that is not after the start,
 * or is not the same kind of time as it, is left out.
 */
export function buildCalendar(events: FeedEvent[], opts: { name: string; stamp: Date; refreshHours?: number }): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//tabularius//calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
  ];
  if (opts.refreshHours) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshHours}H`, `X-PUBLISHED-TTL:PT${opts.refreshHours}H`);
  }
  const stamp = opts.stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, whenLine('DTSTART', e.start));
    if (e.end && kind(e.end) === kind(e.start) && instant(e.end) >= instant(e.start)) {
      // A one-day event needs no end; a timed event ending as it starts keeps it.
      if (!('date' in e.end)) lines.push(whenLine('DTEND', e.end));
      else if (e.end.date > (e.start as { date: string }).date) lines.push(whenLine('DTEND', e.end, true));
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.sequence) lines.push(`SEQUENCE:${e.sequence}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(foldLine).join('\r\n') + '\r\n';
}

// --- reading ---------------------------------------------------------------------------------------------------------

export interface ReadEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  /** The time as the file gives it. */
  start: ReadTime;
  /** The end as the file gives it, or a duration worked out from it (an all-day end is exclusive here, as in the file). */
  end?: ReadTime;
}

/** A day, a clock reading with no zone (or in the zone `tzid` names), or a UTC reading. */
export type ReadTime = { date: string } | { floating: string; tzid?: string } | { utc: string };

export interface ReadResult {
  events: ReadEvent[];
  /** What was not carried over, in words (no event content). */
  notes: string[];
}

export const READ_LIMITS = { events: 5000, occurrencesPerEvent: 366, bytes: 8 * 1024 * 1024 } as const;

/** A calendar file that cannot be read as a whole (too many events, too much repeat work, cut off). The message is for the person importing it. */
export class CalendarReadError extends StoreError {
  constructor(message: string) { super(960, message); }
}

/** Content lines with folds undone: a line starting with a space or a tab continues the one before it. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | undefined {
  // The name and parameters end at the first colon that is not inside a quoted parameter value.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return undefined;
  const head: string[] = [];
  let current = '';
  quoted = false;
  for (const c of line.slice(0, colon)) {
    if (c === '"') quoted = !quoted;
    if (c === ';' && !quoted) {
      head.push(current);
      current = '';
    } else current += c;
  }
  head.push(current);
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Undoes escapeText. */
export function unescapeText(text: string): string {
  return text.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function readTime(p: Prop): ReadTime | undefined {
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    const date = m && parseDate(`${m[1]}-${m[2]}-${m[3]}`);
    return date ? { date } : undefined;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return undefined;
  const stamp = parseStamp(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  if (!stamp) return undefined;
  if (m[7]) return { utc: stamp };
  return { floating: stamp, ...(p.params.TZID ? { tzid: p.params.TZID } : {}) };
}

const seconds = (d: string): number | undefined => {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d.trim());
  if (!m) return undefined;
  const n = (i: number) => Number(m[i] ?? 0);
  const total = n(2) * 604800 + n(3) * 86400 + n(4) * 3600 + n(5) * 60 + n(6);
  return m[1] === '-' ? -total : total;
};

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: string;
  byDay?: number[];
  wkst: number;
}

/** The rule, or why it is not one this reader works out. */
function parseRule(value: string): Rule | string {
  const parts = Object.fromEntries(value.split(';').map((x) => x.split('=') as [string, string]));
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return `a ${freq ?? 'missing'} repeat is not read`;
  for (const key of Object.keys(parts)) {
    if (!['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'].includes(key)) return `a repeat with ${key} is not read`;
  }
  const interval = parts.INTERVAL === undefined ? 1 : Number(parts.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return 'a repeat with an invalid INTERVAL is not read';
  const wkst = parts.WKST === undefined ? 1 : WEEKDAYS.indexOf(parts.WKST);
  if (wkst < 0) return 'a repeat with an invalid WKST is not read';
  const rule: Rule = { freq, interval, wkst };
  if (parts.COUNT !== undefined) {
    rule.count = Number(parts.COUNT);
    if (!Number.isInteger(rule.count) || rule.count < 1) return 'a repeat with an invalid COUNT is not read';
  }
  if (parts.UNTIL !== undefined) {
    const until = readTime({ name: 'UNTIL', params: {}, value: parts.UNTIL });
    if (!until) return 'a repeat with an invalid UNTIL is not read';
    rule.until = instant(until as When);
  }
  if (parts.BYDAY !== undefined) {
    if (freq !== 'WEEKLY') return `a ${freq} repeat on named days is not read`;
    const days = parts.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d));
    if (days.some((d) => d < 0)) return 'a repeat on numbered weekdays is not read';
    rule.byDay = [...new Set(days)];
  }
  return rule;
}

/** The first `max` start readings of a repeating event, as clock readings (a date's with 00:00:00). */
function occurrences(first: string, rule: Rule, max: number, excluded: Set<string>, budget: { left: number }): string[] {
  const out: string[] = [];
  const base = wallMs(first);
  const clock = first.slice(10);
  const date0 = first.slice(0, 10);
  const limit = (stamp: string) => rule.until !== undefined && stamp > rule.until;
  let last = '';
  const push = (day: string): boolean => {
    // Past year 9999 (or before 0001) the days stop moving: that is the end of the repeat.
    if (!parseDate(day) || day <= last) return false;
    last = day;
    const stamp = day + clock;
    if (limit(stamp)) return false;
    if (!excluded.has(stamp) && !excluded.has(day)) out.push(stamp);
    return true;
  };
  let n = 0; // occurrences counted against COUNT (an excluded one still counts)
  // Every pass of every loop below spends from one budget for the whole file, so no mix of rules can keep the reader busy.
  const more = () => --budget.left >= 0 && out.length < max && (rule.count === undefined || n < rule.count);
  const startDate = new Date(base);
  if (rule.freq === 'DAILY') {
    for (let i = 0; more() && i < 20_000; i++, n++) if (!push(addDays(date0, i * rule.interval))) break;
  } else if (rule.freq === 'WEEKLY') {
    const days = (rule.byDay ?? [startDate.getUTCDay()]).map((day) => (day - rule.wkst + 7) % 7).sort((a, b) => a - b);
    const weekOffset = (startDate.getUTCDay() - rule.wkst + 7) % 7;
    const weekStart = addDays(date0, -weekOffset);
    scan: for (let w = 0; ; w++) {
      for (const d of days) {
        const day = addDays(weekStart, w * 7 * rule.interval + d);
        if (day < date0) continue;
        if (!more()) break scan;
        n++;
        if (!push(day)) break scan;
      }
      if (!more() || w > 5200) break;
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let i = 0, guard = 0; more() && guard < 12_000; i++, guard++) {
      const t = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i * rule.interval, 1));
      if (!(t.getUTCFullYear() <= 9999)) break; // past the calendar's last year: the repeat is over
      const day = `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${date0.slice(8)}`;
      if (!parseDate(day)) continue; // a month without a 31st has no occurrence
      n++;
      if (!push(day)) break;
    }
  } else {
    for (let i = 0, guard = 0; more() && guard < 2000; i++, guard++) {
      if (startDate.getUTCFullYear() + i * rule.interval > 9999) break; // past the calendar's last year: the repeat is over
      const day = `${pad(startDate.getUTCFullYear() + i * rule.interval, 4)}${date0.slice(4)}`;
      if (!parseDate(day)) continue; // February 29 in a year without one
      n++;
      if (!push(day)) break;
    }
  }
  return out;
}

/**
 * The events in an .ics file. A repeating event becomes one event per occurrence (up to READ_LIMITS.occurrencesPerEvent),
 * for the rules this reads: DAILY, WEEKLY (optionally on named days), MONTHLY on the start's day of the month and YEARLY,
 * with INTERVAL, COUNT, UNTIL and EXDATE. Any other rule imports the first occurrence only, and says so in `notes`.
 * All or nothing: a calendar with more than READ_LIMITS.events events (counting each occurrence), one that asks for
 * too much repeat work, or one that ends inside an event is refused with a CalendarReadError, never read in part.
 */
export function readCalendar(text: string): ReadResult {
  const notes: string[] = [];
  const events: ReadEvent[] = [];
  const unread = new Map<string, number>();
  const note = (reason: string) => unread.set(reason, (unread.get(reason) ?? 0) + 1);
  const lines = unfold(text);
  let depth = 0;
  let props: Prop[] | undefined;
  // Every event the file holds, counting occurrences, for the message. Once it is over the limit nothing more is worked
  // out: each further event counts as one, and the message says "at least".
  let total = 0;
  let loose = false;
  // Work the repeat rules may do in all, whatever the file holds.
  const budget = { left: 400_000 };
  for (const line of lines) {
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT' && depth === 0) {
      props = [];
      depth = 1;
      continue;
    }
    if (!props) continue;
    if (upper.startsWith('BEGIN:')) {
      depth++; // an alarm inside the event
      continue;
    }
    if (upper.startsWith('END:')) {
      depth--;
      if (depth > 0) continue;
      const done = props;
      props = undefined;
      depth = 0;
      if (total > READ_LIMITS.events) {
        total++;
        loose = true;
        continue;
      }
      const one = (n: string) => done.find((p) => p.name === n);
      const start = one('DTSTART') && readTime(one('DTSTART')!);
      if (!start) {
        note('an event with no readable start was skipped');
        continue;
      }
      if (one('RECURRENCE-ID')) {
        note('a changed occurrence of a repeating event was imported as its own event');
      }
      let end = one('DTEND') && readTime(one('DTEND')!);
      if (!end && one('DURATION')) {
        const s = seconds(one('DURATION')!.value);
        if (s !== undefined && s >= 0) {
          if ('date' in start) end = { date: addDays(start.date, Math.ceil(s / 86400)) };
          else {
            const to = safeText(wallMs('utc' in start ? start.utc : start.floating) + s * 1000);
            if (to) end = 'utc' in start ? { utc: to } : { floating: to, ...(start.tzid ? { tzid: start.tzid } : {}) };
          }
        }
      }
      const text = (n: string) => { const p = one(n); return p ? unescapeText(p.value) : undefined; };
      const base: ReadEvent = {
        ...(text('UID') ? { uid: text('UID') } : {}),
        ...(text('SUMMARY') !== undefined ? { summary: text('SUMMARY') } : {}),
        ...(text('DESCRIPTION') !== undefined ? { description: text('DESCRIPTION') } : {}),
        ...(text('LOCATION') !== undefined ? { location: text('LOCATION') } : {}),
        start,
        ...(end ? { end } : {}),
      };
      const rrule = one('RRULE');
      let list: ReadEvent[] = [base];
      if (rrule) {
        const rule = parseRule(rrule.value);
        if (typeof rule === 'string') note(rule + ': its first occurrence was imported');
        else {
          const first = instant(start as When);
          const excluded = new Set<string>();
          for (const p of done.filter((x) => x.name === 'EXDATE')) {
            for (const v of p.value.split(',')) {
              const t = readTime({ ...p, value: v });
              if (t) excluded.add('date' in t ? t.date : instant(t as When));
            }
          }
          const all = occurrences(first, rule, READ_LIMITS.occurrencesPerEvent + 1, excluded, budget);
          if (all.length > READ_LIMITS.occurrencesPerEvent) {
            note(`a repeating event with more than ${READ_LIMITS.occurrencesPerEvent} occurrences was cut at ${READ_LIMITS.occurrencesPerEvent}`);
            all.length = READ_LIMITS.occurrencesPerEvent;
          }
          const span = end ? wallMs(instant(end as When)) - wallMs(first) : undefined;
          const moved = (stamp: string): string | undefined => (span === undefined ? undefined : safeText(wallMs(stamp) + span));
          list = all.map((stamp, i) => {
            const day = stamp.slice(0, 10);
            const move = (t: ReadTime, at: string): ReadTime => 'date' in t ? { date: at.slice(0, 10) } : 'utc' in t ? { utc: at } : { floating: at, ...(t.tzid ? { tzid: t.tzid } : {}) };
            const to = end && moved(stamp);
            return {
              ...base,
              ...(base.uid ? { uid: `${base.uid}#${i + 1}` } : {}),
              start: 'date' in start ? { date: day } : move(start, stamp),
              ...(end && to ? { end: move(end, to) } : {}),
            };
          });
          if (!list.length) note('a repeating event with every occurrence excluded was skipped');
        }
      }
      total += list.length;
      for (const e of list) if (events.length < READ_LIMITS.events) events.push(e);
      continue;
    }
    if (depth === 1 && total <= READ_LIMITS.events) {
      const p = parseLine(line);
      if (p) props.push(p);
    }
  }
  if (props) throw new CalendarReadError('The file ends inside an event (a BEGIN:VEVENT with no END:VEVENT), so it looks cut short. Nothing was imported');
  if (total > READ_LIMITS.events) {
    throw new CalendarReadError(`The calendar has ${loose ? 'at least ' : ''}${total} events; at most ${READ_LIMITS.events} can be imported at once. Nothing was imported. Split the file into smaller calendars`);
  }
  if (budget.left < 0) {
    throw new CalendarReadError('The calendar asks for too much repeat work (repeating events that go on for years, or that exclude most of their days). Nothing was imported. Remove those events or split the file');
  }
  for (const [reason, n] of unread) notes.push(`${reason} (${n})`);
  return { events, notes };
}

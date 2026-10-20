// The dates, times and timestamps of a FileMaker XML (FMPXMLRESULT) file are written the way the file that made
// it showed them: the DATABASE element's DATEFORMAT and TIMEFORMAT say how ("M/d/yyyy", "dd.MM.yyyy", "h:mm:ss a").
// Read by that pattern they become ISO text (2024-03-05, 14:30:00), which a field of any date order takes.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface Pattern { source: string; parts: string[] }

/** A date or time format ("MM/dd/yyyy") as the regular expression that reads it, and what each group holds. */
function pattern(format: string): Pattern | undefined {
  let source = '';
  const parts: string[] = [];
  // A letter that comes twice ("ydyd") is no format, and its runs of digits, side by side, take exponential time to match.
  const letters = new Set<string>();
  for (const run of format.match(/'[^']*'|([A-Za-z])\1*|[\s\S]/g) ?? []) {
    const letter = run[0];
    if (/[A-Za-z]/.test(letter) && letters.has(letter)) return undefined;
    letters.add(letter);
    if (letter === "'") source += run.slice(1, -1).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    // Spaces side by side are one run of white space: "\s+\s+" takes exponential time on a long one that fails.
    else if (letter === ' ') source += source.endsWith('\\s+') ? '' : '\\s+';
    else if (!/[A-Za-z]/.test(letter)) source += letter.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    else if (letter === 'y') { source += run.length === 2 ? '(\\d{2})' : '(\\d{1,4})'; parts.push(run.length === 2 ? 'yy' : 'y'); }
    else if (letter === 'M') { source += run.length >= 3 ? '([^\\W\\d_]+)\\.?' : '(\\d{1,2})'; parts.push(run.length >= 3 ? 'MMM' : 'M'); }
    else if ('dHhms'.includes(letter) && run.length <= 2) { source += '(\\d{1,2})'; parts.push(letter); }
    else if (letter === 'a') { source += '([AaPp]\\.?[Mm]\\.?)'; parts.push('a'); }
    else if (letter === 'S') { source += '(?:\\d+)'; }
    else return undefined;
  }
  // White space at either end is what the reader's own \s* (or \s+ between a date and a time) takes; twice over is quadratic.
  source = source.replace(/^\\s\+|\\s\+$/g, '');
  return parts.length ? { source, parts } : undefined;
}

const two = (n: number) => String(n).padStart(2, '0');

/** A reader of the dates and times of a file, which leaves what it can't read as it was. */
export function fmpXmlReader(dateFormat: string | undefined, timeFormat: string | undefined): (type: string, value: string) => string {
  const date = dateFormat ? pattern(dateFormat) : undefined;
  const time = timeFormat ? pattern(timeFormat) : undefined;
  const dateOnly = date && new RegExp(`^\\s*${date.source}\\s*$`);
  const timeOnly = time && new RegExp(`^\\s*${time.source}\\s*$`);
  const both = date && time && new RegExp(`^\\s*${date.source}\\s+${time.source}\\s*$`);

  const isoDate = (m: RegExpExecArray, p: string[]): string | undefined => {
    const at = (k: string) => (p.includes(k) ? m[p.indexOf(k) + 1] : undefined);
    let year = Number(at('y') ?? NaN);
    if (at('y') === undefined && !p.includes('yy')) return undefined;
    if (p.includes('yy')) {
      const yy = Number(at('yy'));
      year = Math.floor(new Date().getFullYear() / 100) * 100 + yy;
      if (year > new Date().getFullYear() + 20) year -= 100;
    }
    const month = p.includes('MMM') ? MONTHS.indexOf(at('MMM')!.slice(0, 3).toLowerCase()) + 1 : Number(at('M'));
    const day = Number(at('d'));
    if (!(year >= 0) || month < 1 || month > 12 || day < 1) return undefined;
    const real = new Date(Date.UTC(2000, month - 1, day));
    if (real.getUTCMonth() !== month - 1 || (month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) || day > 31) return undefined;
    return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`;
  };
  const isoTime = (m: RegExpExecArray, p: string[], offset: number): string | undefined => {
    const at = (k: string) => (p.includes(k) ? m[p.indexOf(k) + 1 + offset] : undefined);
    let hour = Number(at('H') ?? at('h') ?? NaN);
    const minute = Number(at('m') ?? 0);
    const second = Number(at('s') ?? 0);
    const meridiem = at('a')?.[0].toLowerCase();
    if (meridiem && p.includes('h')) hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
    return hour >= 0 && hour < 24 && minute < 60 && second < 60 ? `${two(hour)}:${two(minute)}:${two(second)}` : undefined;
  };

  return (type, value) => {
    if (!value) return value;
    if (type === 'DATE' && date && dateOnly) {
      const m = dateOnly.exec(value);
      return (m && isoDate(m, date.parts)) ?? value;
    }
    if (type === 'TIME' && time && timeOnly) {
      const m = timeOnly.exec(value);
      return (m && isoTime(m, time.parts, 0)) ?? value;
    }
    if (type === 'TIMESTAMP' && date && time && both) {
      const m = both.exec(value);
      const d = m && isoDate(m, date.parts);
      const t = m && isoTime(m, time.parts, date.parts.length);
      return d && t ? `${d}T${t}` : value;
    }
    return value;
  };
}

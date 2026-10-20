// Styled text: the fonts, sizes, colors and styles FileMaker keeps on parts of a text value (TextColor,
// TextStyleAdd, Browse mode's Format menu). A text value carries them as runs over its characters; the text itself
// is unchanged, so finds, sorts and every other function see plain text, as in FileMaker.

/** Styles of a run, as bits (TextStyleAdd's style names). FileMaker doesn't document its values; these are distinct bits, so + combines them. */
export const STYLE_BITS: Record<string, number> = {
  plain: 0,
  highlightyellow: 1,
  superscript: 4,
  subscript: 8,
  uppercase: 16,
  lowercase: 32,
  titlecase: 48,
  doubleunderline: 64,
  smallcaps: 128,
  bold: 256,
  italic: 512,
  underline: 1024,
  strikethrough: 2048,
  wordunderline: 4096,
  condense: 8192,
  extend: 16384,
};
export const ALL_STYLES = Object.values(STYLE_BITS).reduce((a, b) => a | b, 0);

/** Formatting of a stretch of text: style bits, a font, a size in points, a color as #RRGGBB. */
export interface TextFormat { style?: number; font?: string; size?: number; color?: string }
/** A run of formatted characters: [start, end) in UTF-16 units of the text. */
export interface StyleRun extends TextFormat { start: number; end: number }

const same = (a: TextFormat, b: TextFormat) => (a.style ?? 0) === (b.style ?? 0) && a.font === b.font && a.size === b.size && a.color === b.color;
const blank = (f: TextFormat) => !f.style && f.font === undefined && f.size === undefined && f.color === undefined;
const formatOf = (r: TextFormat): TextFormat => ({
  ...(r.style ? { style: r.style } : {}), ...(r.font !== undefined ? { font: r.font } : {}),
  ...(r.size !== undefined ? { size: r.size } : {}), ...(r.color !== undefined ? { color: r.color } : {}),
});

/** Runs sorted, inside the text, without empty or unformatted ones, and neighbours with the same format joined. */
export function tidyRuns(runs: readonly StyleRun[], length: number): StyleRun[] {
  const out: StyleRun[] = [];
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, r.start);
    const end = Math.min(length, r.end);
    if (end <= start || blank(r)) continue;
    const last = out.at(-1);
    if (last && last.end >= start && same(last, r)) last.end = Math.max(last.end, end);
    else out.push({ start: last ? Math.max(start, last.end) : start, end, ...formatOf(r) });
  }
  return out.filter((r) => r.end > r.start);
}

/** Every character's runs, gaps included as unformatted runs, covering [0, length). */
function cover(runs: readonly StyleRun[], length: number): StyleRun[] {
  const out: StyleRun[] = [];
  let at = 0;
  for (const r of tidyRuns(runs, length)) {
    if (r.start > at) out.push({ start: at, end: r.start });
    out.push({ ...r });
    at = r.end;
  }
  if (at < length) out.push({ start: at, end: length });
  return out;
}

/** The runs with each one's format changed by `f` over the whole text. */
export function restyle(runs: readonly StyleRun[] | undefined, length: number, f: (format: TextFormat) => TextFormat): StyleRun[] {
  return tidyRuns(cover(runs ?? [], length).map((r) => ({ start: r.start, end: r.end, ...formatOf(f(formatOf(r))) })), length);
}

/** The runs of `a` followed by those of `b` shifted past `a`'s text. */
export function concatRuns(a: readonly StyleRun[] | undefined, aLength: number, b: readonly StyleRun[] | undefined, bLength: number): StyleRun[] {
  return tidyRuns([...(a ?? []), ...(b ?? []).map((r) => ({ ...r, start: r.start + aLength, end: r.end + aLength }))], aLength + bLength);
}

/** The runs of the characters [start, end), from 0. */
export function sliceRuns(runs: readonly StyleRun[] | undefined, start: number, end: number): StyleRun[] {
  return tidyRuns((runs ?? []).map((r) => ({ ...r, start: r.start - start, end: Math.min(r.end, end) - start })), Math.max(0, end - start));
}

/** #RRGGBB of a FileMaker RGB ( r ; g ; b ) number. */
export function rgbHex(n: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.trunc(n)));
  return `#${v.toString(16).toUpperCase().padStart(6, '0')}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A font name as it can go into CSS and HTML: letters, digits, spaces and . , - _ only (anything else is dropped). */
export const fontName = (s: string) => s.replace(/[^\p{L}\p{N} .,_-]/gu, '').trim();

/** CSS declarations of a format, in GetAsCSS's order: font-family, font-size, color, then styles. */
export function formatCss(f: TextFormat): string {
  const s = f.style ?? 0;
  const decorations = [s & (STYLE_BITS.underline | STYLE_BITS.wordunderline | STYLE_BITS.doubleunderline) ? 'underline' : '', s & STYLE_BITS.strikethrough ? 'line-through' : ''].filter(Boolean);
  return [
    f.font !== undefined && fontName(f.font) ? `font-family: '${fontName(f.font)}';` : '',
    f.size !== undefined ? `font-size: ${f.size}px;` : '',
    f.color !== undefined ? `color: ${f.color};` : '',
    s & STYLE_BITS.bold ? 'font-weight: bold;' : '',
    s & STYLE_BITS.italic ? 'font-style: italic;' : '',
    decorations.length ? `text-decoration: ${decorations.join(' ')};` : '',
    s & STYLE_BITS.doubleunderline ? 'text-decoration-style: double;' : '',
    s & STYLE_BITS.highlightyellow ? 'background-color: #FFFF00;' : '',
    s & STYLE_BITS.smallcaps ? 'font-variant: small-caps;' : '',
    (s & STYLE_BITS.titlecase) === STYLE_BITS.titlecase ? 'text-transform: capitalize;' : s & STYLE_BITS.uppercase ? 'text-transform: uppercase;' : s & STYLE_BITS.lowercase ? 'text-transform: lowercase;' : '',
    s & STYLE_BITS.superscript ? 'vertical-align: super;' : s & STYLE_BITS.subscript ? 'vertical-align: sub;' : '',
    s & STYLE_BITS.condense ? 'letter-spacing: -0.05em;' : s & STYLE_BITS.extend ? 'letter-spacing: 0.1em;' : '',
  ].join('');
}

/**
 * GetAsCSS: the text as HTML, each formatted run in a span with its CSS, as FileMaker writes it
 * (`<span style = "font-family: 'Helvetica';font-size: 12px;color: #FF0000;font-weight: bold;">Frank</span>`).
 * Returns become <br>. Unformatted text is written as it is, escaped.
 */
export function toCss(value: string, runs: readonly StyleRun[] | undefined): string {
  const html = (s: string) => escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');
  return cover(runs ?? [], value.length).map((r) => {
    const css = formatCss(r);
    const t = html(value.slice(r.start, r.end));
    return css ? `<span style = "${css}">${t}</span>` : t;
  }).join('');
}

/**
 * The runs of `before` moved onto `after`, an edit of it: the characters before and after the changed stretch keep
 * their formatting, and text typed in takes the formatting of the character before it, as typing does.
 */
export function editRuns(runs: readonly StyleRun[] | undefined, before: string, after: string): StyleRun[] {
  if (!runs?.length || before === after) return tidyRuns(runs ?? [], after.length);
  let head = 0;
  const most = Math.min(before.length, after.length);
  while (head < most && before.charCodeAt(head) === after.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < most - head && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
  const removedEnd = before.length - tail;
  const typed = after.length - tail - head;
  const shift = after.length - before.length;
  const out: StyleRun[] = [];
  for (const r of runs) {
    // Before the change a position stays, after it it moves; inside it, a start goes past the typed text and an end to its start.
    const start = r.start < head ? r.start : r.start >= removedEnd ? r.start + shift : head + typed;
    let end = r.end <= head ? r.end : r.end >= removedEnd ? r.end + shift : head;
    // Typed text takes the formatting of the character before it.
    if (typed > 0 && r.start < head && end === head) end = head + typed;
    out.push({ ...r, start, end });
  }
  return tidyRuns(out, after.length);
}

const COLOR = /^#[0-9A-F]{6}$/;
/** Limits on runs taken from a request: how many, and a font name's length. */
export const RUN_LIMITS = { runs: 5000, font: 100 };

/** Runs from untrusted input (a request), checked and tidied for a text of `length`; undefined when they aren't runs. */
export function cleanRuns(input: unknown, length: number): StyleRun[] | undefined {
  if (!Array.isArray(input) || input.length > RUN_LIMITS.runs) return undefined;
  const out: StyleRun[] = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') return undefined;
    const { start, end, style, font, size, color } = r as Record<string, unknown>;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
    if (style !== undefined && !Number.isInteger(style)) return undefined;
    if (font !== undefined && (typeof font !== 'string' || font.length > RUN_LIMITS.font || fontName(font) !== font)) return undefined;
    if (size !== undefined && (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 999)) return undefined;
    if (color !== undefined && (typeof color !== 'string' || !COLOR.test(color.toUpperCase()))) return undefined;
    out.push({
      start: start as number, end: end as number,
      ...(style ? { style: (style as number) & ALL_STYLES } : {}),
      ...(font ? { font: font as string } : {}),
      ...(size !== undefined ? { size: size as number } : {}),
      ...(color !== undefined ? { color: (color as string).toUpperCase() } : {}),
    });
  }
  return tidyRuns(out, length);
}

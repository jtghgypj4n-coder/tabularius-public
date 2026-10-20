// Styled text from the server (a calculation's TextColor, TextStyleAdd, …): runs of fonts, sizes, colors and styles
// over a value's characters, shown as spans. A copy of the calc package's CSS so the client stays dependency-free.

import type { StyleRun } from './types.ts';

const BOLD = 256, ITALIC = 512, UNDERLINE = 1024, STRIKE = 2048, WORD_UNDERLINE = 4096, DOUBLE_UNDERLINE = 64;
const HIGHLIGHT = 1, SUPER = 4, SUB = 8, UPPER = 16, LOWER = 32, SMALL_CAPS = 128, CONDENSE = 8192, EXTEND = 16384;

/** The run's look as CSS properties. */
export function runStyle(r: StyleRun): Partial<CSSStyleDeclaration> {
  const s = r.style ?? 0;
  const lines = [s & (UNDERLINE | WORD_UNDERLINE | DOUBLE_UNDERLINE) ? 'underline' : '', s & STRIKE ? 'line-through' : ''].filter(Boolean);
  const css: Partial<CSSStyleDeclaration> = {};
  const font = r.font?.replace(/[^\p{L}\p{N} .,_-]/gu, '').trim();
  if (font) css.fontFamily = `'${font}'`;
  if (r.size !== undefined) css.fontSize = `${r.size}px`;
  if (r.color !== undefined && /^#[0-9A-F]{6}$/i.test(r.color)) css.color = r.color;
  if (s & BOLD) css.fontWeight = 'bold';
  if (s & ITALIC) css.fontStyle = 'italic';
  if (lines.length) css.textDecorationLine = lines.join(' ');
  if (s & DOUBLE_UNDERLINE) css.textDecorationStyle = 'double';
  if (s & HIGHLIGHT) {
    css.backgroundColor = '#FFFF00';
    if (r.color === undefined) css.color = '#000000';
  }
  if (s & SMALL_CAPS) css.fontVariant = 'small-caps';
  css.textTransform = (s & (UPPER | LOWER)) === (UPPER | LOWER) ? 'capitalize' : s & UPPER ? 'uppercase' : s & LOWER ? 'lowercase' : '';
  css.verticalAlign = s & SUPER ? 'super' : s & SUB ? 'sub' : '';
  if (s & (SUPER | SUB)) css.fontSize = 'smaller';
  css.letterSpacing = s & CONDENSE ? '-0.05em' : s & EXTEND ? '0.1em' : '';
  return css;
}

/** The value as text nodes and spans, one span per formatted run. */
export function styledNodes(value: string, runs: readonly StyleRun[]): Node[] {
  const out: Node[] = [];
  let at = 0;
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    const start = Math.max(at, r.start), end = Math.min(value.length, r.end);
    if (end <= start) continue;
    if (start > at) out.push(document.createTextNode(value.slice(at, start)));
    const span = document.createElement('span');
    Object.assign(span.style, runStyle(r));
    span.textContent = value.slice(start, end);
    out.push(span);
    at = end;
  }
  if (at < value.length) out.push(document.createTextNode(value.slice(at)));
  return out;
}

/** A run's formatting without its range. */
export type TextFormat = Omit<StyleRun, 'start' | 'end'>;

const formatOf = (r: TextFormat): TextFormat => ({
  ...(r.style ? { style: r.style } : {}), ...(r.font !== undefined ? { font: r.font } : {}),
  ...(r.size !== undefined ? { size: r.size } : {}), ...(r.color !== undefined ? { color: r.color } : {}),
});
const same = (a: TextFormat, b: TextFormat) => (a.style ?? 0) === (b.style ?? 0) && a.font === b.font && a.size === b.size && a.color === b.color;

/** Runs inside the text, sorted, without unformatted ones, neighbours with the same formatting joined. */
export function tidyRuns(runs: readonly StyleRun[], length: number): StyleRun[] {
  const out: StyleRun[] = [];
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, r.start, out.at(-1)?.end ?? 0), end = Math.min(length, r.end);
    const f = formatOf(r);
    if (end <= start || !Object.keys(f).length) continue;
    const last = out.at(-1);
    if (last && last.end === start && same(last, f)) last.end = end;
    else out.push({ start, end, ...f });
  }
  return out;
}

/** The runs with the formatting of [from, to) changed by `change`. */
export function restyleRange(runs: readonly StyleRun[], length: number, from: number, to: number, change: (f: TextFormat) => TextFormat): StyleRun[] {
  const cuts = [...new Set([0, length, from, to, ...runs.flatMap((r) => [r.start, r.end])])].filter((n) => n >= 0 && n <= length).sort((a, b) => a - b);
  const out: StyleRun[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [start, end] = [cuts[i], cuts[i + 1]];
    const f = formatOf(runs.find((r) => r.start <= start && r.end >= end) ?? { });
    out.push({ start, end, ...(start >= from && end <= to ? formatOf(change(f)) : f) });
  }
  return tidyRuns(out, length);
}

/** The formatting shared by all of [from, to): what the Format menu shows checked. */
export function formatAt(runs: readonly StyleRun[], from: number, to: number): TextFormat {
  const parts = restyleRange(runs, Math.max(to, ...runs.map((r) => r.end)), from, to, (f) => f).filter((r) => r.end > from && r.start < to);
  const covered = parts.reduce((n, r) => n + Math.min(r.end, to) - Math.max(r.start, from), 0);
  if (!parts.length || covered < to - from) return {};
  const [first, ...rest] = parts;
  return {
    style: rest.reduce((s, r) => s & (r.style ?? 0), first.style ?? 0) || undefined,
    ...(rest.every((r) => r.font === first.font) && first.font !== undefined ? { font: first.font } : {}),
    ...(rest.every((r) => r.size === first.size) && first.size !== undefined ? { size: first.size } : {}),
    ...(rest.every((r) => r.color === first.color) && first.color !== undefined ? { color: first.color } : {}),
  };
}

/** The runs of `before` moved onto `after`, an edit of it; typed text takes the formatting before it (as the server does). */
export function editRuns(runs: readonly StyleRun[], before: string, after: string): StyleRun[] {
  if (!runs.length || before === after) return tidyRuns(runs, after.length);
  let head = 0;
  const most = Math.min(before.length, after.length);
  while (head < most && before.charCodeAt(head) === after.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < most - head && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
  const removedEnd = before.length - tail, typed = after.length - tail - head, shift = after.length - before.length;
  return tidyRuns(runs.map((r) => {
    const start = r.start < head ? r.start : r.start >= removedEnd ? r.start + shift : head + typed;
    let end = r.end <= head ? r.end : r.end >= removedEnd ? r.end + shift : head;
    if (typed > 0 && r.start < head && end === head) end = head + typed;
    return { ...r, start, end };
  }), after.length);
}

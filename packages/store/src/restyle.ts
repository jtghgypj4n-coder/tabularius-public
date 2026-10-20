// Restyling a layout: "make this layout look like that one", or "apply the
// theme consistently". Only looks change (theme, styles, local formatting of
// the layout, its parts and objects); nothing moves and no behavior changes.
// The result is the design an updateLayout change sets, for a person to look
// at before it's applied.

import type { LayoutDesign, LayoutDesigns, LayoutObject, LayoutPart, ObjectStyle, Theme } from '../../fmp12/src/index.ts';

export interface RestyleOptions {
  /** Take the look of this layout: its theme, and each kind of object's most common style and formatting. */
  like?: LayoutDesign;
  /** Switch to this theme. */
  themeId?: number;
  /** Drop local formatting, so every object shows its theme style as the theme draws it. */
  consistent?: boolean;
}

export interface Restyled {
  /** What updateLayout's `design` sets. */
  design: Pick<LayoutDesign, 'style' | 'parts' | 'objects'> & { themeId?: number };
  /** What changed, a line each. */
  notes: string[];
  /** Objects whose look changed. */
  changed: number[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Every object, inside groups, portals, tab and slide panels and popovers too; copies of components are left to their component. */
function walk(objs: LayoutObject[], fn: (o: LayoutObject, part: string) => void, partOf: (o: LayoutObject) => string, inherited?: string): void {
  for (const o of objs) {
    const part = inherited ?? partOf(o);
    fn(o, part);
    if (o.children && !o.component) walk(o.children, fn, partOf, part);
  }
}

/** Which part an object starts in: header, body, footer... */
function partFinder(parts: LayoutPart[]): (o: LayoutObject) => string {
  const sorted = [...parts].sort((a, b) => a.top - b.top);
  return (o) => {
    let kind = sorted[0]?.kind ?? 'body';
    for (const p of sorted) if (o.bounds.top >= p.top) kind = p.kind;
    return kind;
  };
}

/** The look an object can take from another: its style name and its own formatting. */
type Look = Pick<ObjectStyle, 'name' | 'displayName' | 'rules'>;
const lookOf = (s: ObjectStyle): Look => ({ ...(s.name !== undefined ? { name: s.name } : {}), ...(s.displayName !== undefined ? { displayName: s.displayName } : {}), ...(s.rules?.length ? { rules: s.rules } : {}) });

/** The most common look per kind of object in a layout, keyed from most to least specific. */
function looks(design: LayoutDesign): Map<string, Look> {
  const counts = new Map<string, Map<string, { look: Look; n: number }>>();
  const count = (key: string, look: Look) => {
    const byLook = counts.get(key) ?? counts.set(key, new Map()).get(key)!;
    const k = JSON.stringify(look);
    const e = byLook.get(k) ?? byLook.set(k, { look, n: 0 }).get(k)!;
    e.n++;
  };
  walk(design.objects, (o, part) => {
    for (const key of keys(o, part)) count(key, lookOf(o.style));
  }, partFinder(design.parts));
  const out = new Map<string, Look>();
  for (const [key, byLook] of counts) out.set(key, [...byLook.values()].sort((a, b) => b.n - a.n)[0].look);
  return out;
}

/** An object's kind: the same kind and theme element in the same part, else anywhere, else just the element. */
function keys(o: LayoutObject, part: string): string[] {
  const el = o.style.element ?? -1;
  return [`${o.kind}|${el}|${part}`, `${o.kind}|${el}`, `|${el}`];
}

/** Whether a theme has a style of that name for that element. */
function hasStyle(theme: Theme | undefined, name: string | undefined, element: number | undefined): boolean {
  if (!name) return true;
  return !!theme?.styles.some((s) => s.name === name && (s.element === undefined || element === undefined || s.element === element));
}

export function restyleLayout(designs: LayoutDesigns, target: LayoutDesign, opts: RestyleOptions): Restyled {
  const out = clone({ style: target.style, parts: target.parts, objects: target.objects });
  const notes: string[] = [];
  const changed = new Set<number>();
  const themeId = opts.themeId ?? opts.like?.themeId ?? target.themeId;
  const theme = designs.themes.find((t) => t.id === themeId);
  const themeChanged = themeId !== target.themeId;
  if (themeChanged) notes.push(`Theme: ${designs.themes.find((t) => t.id === target.themeId)?.name ?? 'none'} → ${theme?.name ?? themeId}.`);

  let restyled = 0;
  let parts = 0;
  if (opts.like) {
    const like = opts.like;
    const model = looks(like);
    walk(out.objects, (o, part) => {
      const key = keys(o, part).find((k) => model.has(k));
      if (!key) return;
      const look = model.get(key)!;
      if (same(lookOf(o.style), look)) return;
      o.style = { ...(o.style.element !== undefined ? { element: o.style.element } : {}), ...clone(look) };
      changed.add(o.id);
      restyled++;
    }, partFinder(out.parts));
    for (const p of out.parts) {
      const from = like.parts.find((x) => x.kind === p.kind) ?? (p.kind.includes('summary') ? undefined : like.parts.find((x) => x.kind === 'body'));
      if (from && !same(lookOf(p.style), lookOf(from.style))) {
        p.style = { ...(p.style.element !== undefined ? { element: p.style.element } : {}), ...clone(lookOf(from.style)) };
        parts++;
      }
    }
    if (!same(lookOf(out.style), lookOf(like.style))) {
      out.style = { ...(out.style.element !== undefined ? { element: out.style.element } : {}), ...clone(lookOf(like.style)) };
      notes.push(`Layout background as on ${like.name}.`);
    }
    if (restyled) notes.push(`${plural(restyled, 'object')} styled as the same kind of object is on ${like.name}.`);
    if (parts) notes.push(`${plural(parts, 'part')} styled as on ${like.name}.`);
  }

  // Styles the theme doesn't have draw as nothing in particular; they go back to the element's default look.
  let unknown = 0;
  let cleared = 0;
  const tidy = (s: ObjectStyle, id?: number) => {
    let touched = false;
    if (s.name && !hasStyle(theme, s.name, s.element)) {
      delete s.name;
      delete s.displayName;
      unknown++;
      touched = true;
    }
    if (opts.consistent && s.rules?.length) {
      delete s.rules;
      cleared++;
      touched = true;
    }
    if (touched && id !== undefined) changed.add(id);
  };
  if (themeChanged || opts.consistent) {
    walk(out.objects, (o) => tidy(o.style, o.id), () => '');
    for (const p of out.parts) tidy(p.style);
    tidy(out.style);
    if (unknown) notes.push(`${plural(unknown, 'style')} the theme doesn't have went back to its default look.`);
    if (cleared) notes.push(`Local formatting dropped in ${plural(cleared, 'place')}, so each shows its theme style.`);
  }
  if (!notes.length) notes.push('Nothing to change: it already looks that way.');
  const design: Restyled['design'] = { ...out, ...(themeId !== undefined ? { themeId } : {}) };
  return { design, notes, changed: [...changed] };
}

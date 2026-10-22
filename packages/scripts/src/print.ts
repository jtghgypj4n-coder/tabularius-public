// Lays a FileMaker layout out on PDF pages, the way printing or Save Records
// as PDF does: headers and footers on every page, then the parts the caller
// lists (leading summaries, a body per record, sub-summaries) flowing down.
// Objects are drawn at their layout positions with their theme and local
// styles. Record data comes from a PrintSource, so this file knows nothing
// about the script engine.

import type { LayoutDesign, LayoutObject, LayoutPart, ObjectStyle, StyleRule, Theme } from '../../fmp12/src/index.ts';
import type { PageSetup } from '../../fmp12/src/schema.ts';
import { pageSize, paginateColumns, slide, type SlideBox } from '../../fmp12/src/page-geometry.ts';
import { textWidth, wrap, type FontName, type PdfOp, type PdfPage, type Rgb, type Stroke, type TextStyle } from './pdf.ts';

/** Record data for the objects being drawn, in whatever record and portal row is current. */
export interface PrintSource {
  /** A field object's value: text, or a container's file. */
  field(o: LayoutObject, repetition: number): { text: string; file?: Uint8Array };
  /** Static text with merge fields (<<TO::Field>>) and symbols ({{PageNumber}}) filled in. */
  merge(text: string, page: number): string;
  /** The object's "Hide object when" formula is true. */
  hidden(o: LayoutObject): boolean;
  /** Style rules of the object's conditional formats whose formulas are true. */
  conditions(o: LayoutObject): StyleRule[];
  /** A graphic's image from the file's image library. */
  image(id: number): Uint8Array | undefined;
  /** How many related records a portal shows. */
  portalCount(o: LayoutObject): number;
  /** Make a portal row (1-based) current, or none. */
  portalRow(o: LayoutObject, row: number | undefined): void;
  /** The page number being laid out now (1-based, starting again where a part restarts page numbers), for Get ( PageNumber ). */
  page?(n: number): void;
}

/** How the pages are set up: the file's page setup (paper and margins), as Preview mode uses it. */
export interface PrintOptions {
  setup?: PageSetup;
}

/** One part to print, after `select` makes its record (or group of records) current. */
export interface PrintItem {
  part: LayoutPart;
  /** Makes the part's record current; it may be called more than once (printing in columns measures every part first). */
  select?: () => void;
}

// --- styles ------------------------------------------------------------------

const KIND_ELEMENTS: Record<string, number> = {
  field: 61, text: 70, line: 50, rectangle: 51, 'rounded-rectangle': 52, oval: 53, button: 80, portal: 83,
  'tab-control': 81, 'tab-panel': 82, graphic: 84, 'web-viewer': 85, chart: 86, 'popover-button': 80, popover: 89,
  'slide-control': 91, 'slide-panel': 92, 'button-bar': 78,
};
const FIELD_ELEMENTS: Record<string, number> = { edit: 61, popup: 63, dropdown: 62, checkbox: 64, radio: 65, calendar: 66 };
const PART_ELEMENTS: Record<string, number> = {
  'title-header': 31, header: 32, 'leading-grand-summary': 33, body: 34, 'sub-summary-leading': 36, 'sub-summary-trailing': 36,
  'trailing-grand-summary': 37, footer: 38, 'title-footer': 39,
};
/** Theme element parents: every field kind is also a "field", every part a "part". */
const PARENTS: Record<number, number> = {
  31: 30, 32: 30, 33: 30, 34: 30, 35: 30, 36: 30, 37: 30, 38: 30, 39: 30, 40: 30, 41: 30,
  61: 60, 62: 60, 63: 60, 64: 60, 65: 60, 66: 60, 67: 60, 68: 60,
};

export function objectElement(o: LayoutObject): number | undefined {
  if (o.style.element !== undefined) return o.style.element;
  if (o.field) return FIELD_ELEMENTS[o.field.display] ?? 61;
  return KIND_ELEMENTS[o.kind];
}

export function partElement(p: LayoutPart): number | undefined {
  return p.style.element ?? PART_ELEMENTS[p.kind];
}

type Css = Record<string, string>;

/**
 * The normal-state CSS of an object (or part) for one style part (1 the
 * object, 2 its text): theme defaults, rules for the element inside its
 * containers, the named style, local styles, then conditional formats.
 */
export function resolveCss(theme: Theme | undefined, style: ObjectStyle, element: number | undefined, inside: number[], part: 1 | 2, extra: StyleRule[] = []): Css {
  const css: Css = {};
  const take = (rules: StyleRule[] | undefined) => {
    for (const r of rules ?? []) if (r.state === 1 && r.part === part) Object.assign(css, r.css);
  };
  if (theme && element !== undefined) {
    if (PARENTS[element] !== undefined) take(theme.defaults[PARENTS[element]]);
    take(theme.defaults[element]);
    for (const c of theme.contextual ?? []) {
      const last = c.path[c.path.length - 1];
      if ((last === element || last === PARENTS[element]) && c.path.slice(0, -1).every((e) => inside.includes(e))) take(c.rules);
    }
  }
  if (theme && style.name) {
    const named = theme.styles.find((s) => s.name === style.name && s.element === element) ?? theme.styles.find((s) => s.name === style.name);
    take(named?.rules);
  }
  take(style.rules);
  take(extra);
  return css;
}

/** A CSS color as RGB; none for transparent ones. */
export function cssColor(v: string | undefined): Rgb | undefined {
  if (!v) return undefined;
  let m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return a < 0.05 ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  m = /#([0-9a-f]{3,8})\b/i.exec(v);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join('') : m[1];
    if (h.length === 8 && parseInt(h.slice(6, 8), 16) < 13) return undefined;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return undefined;
}

/** A length in points: FileMaker's "px" are points; em counts from the font size. */
function length(v: string | undefined, size: number): number {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.trim().endsWith('em') ? n * size : n;
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/** The object's box: its fill (the first color of a gradient), borders and corner radius. */
function boxOps(css: Css, left: number, top: number, width: number, height: number, shape: 'rect' | 'oval' = 'rect'): PdfOp[] {
  const fill = cssColor(css['background-color']) ?? cssColor(/gradient\((.*)\)/.exec(css['background-image'] ?? '')?.[1]);
  const sides = SIDES.map((s): Stroke | undefined => {
    const style = css[`border-${s}-style`];
    const w = length(css[`border-${s}-width`], 12);
    const color = cssColor(css[`border-${s}-color`]);
    return style && style !== 'none' && style !== 'hidden' && w > 0 && color ? { color, width: w } : undefined;
  });
  const radius = length(css['border-top-left-radius'], 12);
  const same = sides.every((s) => s && sides[0] && s.width === sides[0].width && s.color.join() === sides[0].color.join());
  const box = { left, top, width, height };
  if (shape === 'oval') return fill || sides[0] ? [{ kind: 'oval', ...box, fill, border: sides[0] }] : [];
  if (same || (radius > 0 && sides.some(Boolean))) {
    const border = sides.find(Boolean);
    // A stroke is centered on its path; inset it so it stays inside the box, as CSS borders do.
    const inset = (border?.width ?? 0) / 2;
    const ops: PdfOp[] = [];
    if (fill) ops.push({ kind: 'rect', ...box, fill, radius });
    if (border) ops.push({ kind: 'rect', left: left + inset, top: top + inset, width: width - 2 * inset, height: height - 2 * inset, border, radius: Math.max(0, radius - inset) });
    return ops;
  }
  const ops: PdfOp[] = [];
  if (fill) ops.push({ kind: 'rect', ...box, fill, radius });
  if (sides.some(Boolean)) ops.push({ kind: 'sides', ...box, sides });
  return ops;
}

function fontOf(css: Css): FontName {
  const family = (css['font-family'] ?? '').toLowerCase();
  const bold = /bold|[6-9]00/.test(css['font-weight'] ?? '');
  const italic = /italic|oblique/.test(css['font-style'] ?? '');
  const base = /courier|mono/.test(family) ? 'Courier' : /times|georgia|garamond|palatino|(^|[^-])serif/.test(family) && !/sans/.test(family) ? 'Times' : 'Helvetica';
  if (base === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  return `${base}${bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''}` as FontName;
}

/** Text style from CSS (the object's own rules with its text rules on top). */
export function textStyle(css: Css, height: number, themed: boolean): TextStyle {
  const size = parseFloat(css['font-size'] ?? '') || (themed ? 12 : Math.max(4, Math.min(12, height - 2)));
  const lh = css['line-height'];
  const lineHeight = !lh ? 1.2 : /px$/.test(lh) ? parseFloat(lh) / size : /em$/.test(lh) ? parseFloat(lh) : parseFloat(lh) || 1.2;
  const valign = css['--fm-vertical-align'];
  return {
    font: fontOf(css),
    size,
    color: cssColor(css.color) ?? [0, 0, 0],
    align: css['text-align'] === 'center' ? 'center' : css['text-align'] === 'right' ? 'right' : 'left',
    valign: valign === 'center' ? 'middle' : valign === 'flex-end' ? 'bottom' : 'top',
    lineHeight,
    padding: SIDES.map((s) => length(css[`padding-${s}`], size) + length(css[`border-${s}-width`], size)) as [number, number, number, number],
    underline: /underline/.test(css['text-decoration-line'] ?? css['text-decoration'] ?? ''),
  };
}

// --- drawing -----------------------------------------------------------------

type Box = { top: number; left: number; bottom: number; right: number };
/** Where a part's objects end up after sliding, and the part's height. */
type Slid = { bounds: Map<string, Box>; height: number };

export class LayoutPrinter {
  readonly pages: PdfPage[] = [];
  private page?: PdfPage;
  private pageIndex = 0;
  private onPage?: (page: PdfPage) => void;
  private y = 0;
  private bottom = 0;
  /** The page number shown on the current page: 1, 2, ... starting again after a part that restarts page numbers. */
  private number = 0;
  private restart = false;
  private readonly width: number;
  private readonly height: number;
  /** The printable area's top left corner on the paper. */
  private readonly ox: number;
  private readonly oy: number;
  /** The bottom margin. */
  private readonly mb: number;
  /** How wide parts are drawn: the layout's width. */
  private readonly partWidth: number;
  private readonly themed: boolean;
  private readonly design: LayoutDesign;
  private readonly theme: Theme | undefined;
  private readonly src: PrintSource;
  /** Layout Setup's "Print in N columns": each column's width. */
  private readonly columnWidth: number;

  constructor(design: LayoutDesign, theme: Theme | undefined, src: PrintSource, opts: PrintOptions = {}) {
    this.design = design;
    this.theme = theme;
    this.src = src;
    const right = Math.max(0, ...design.objects.map((o) => o.bounds.right));
    const layoutWidth = Math.max(design.width ?? right, right);
    // The file's paper and margins when it has a page setup; otherwise US Letter with half-inch margins, landscape for a wide layout (as Preview mode does).
    // Layout Setup's fixed page margins replace the margins. Page Setup's scale isn't applied: the PDF prints at 100%.
    const size = pageSize(layoutWidth, opts.setup && { ...opts.setup, scale: undefined }, design.fixedMargins);
    this.ox = size.margins.left;
    this.oy = size.margins.top;
    this.mb = size.margins.bottom;
    this.height = size.paper.height;
    // Page Setup fixes the physical sheet. Content outside its printable area
    // is clipped by the sheet instead of silently changing the paper size.
    this.width = size.paper.width;
    this.partWidth = Math.max(layoutWidth, size.width);
    this.themed = !!theme;
    const columns = design.printColumns?.count ?? 1;
    this.columnWidth = columns > 1 ? size.width / columns : 0;
  }

  private parts(...kinds: string[]): LayoutPart[] {
    return this.design.parts.filter((p) => kinds.includes(p.kind) && p.height > 0);
  }

  /**
   * Print the items, starting new pages as they fill, before a part set to
   * break before each occurrence and after every so many occurrences of one
   * set to (Part Definition). Sliding objects shrink and move up first, so
   * the part takes the height it has left.
   */
  print(items: Iterable<PrintItem>): PdfPage[] {
    if (this.columnWidth) return this.printColumns(Array.from(items));
    const seen = new Map<LayoutPart, number>();
    let breakNext = false;
    for (const item of items) {
      item.select?.();
      const slid = this.slidePart(item.part);
      const o = item.part.options;
      const onPage = this.y > this.headerHeight();
      if (!this.page || (onPage && (breakNext || o?.pageBreakBefore || this.y + slid.height > this.bottom))) this.newPage();
      this.drawPart(item.part, this.y, slid);
      this.y += slid.height;
      const n = (seen.get(item.part) ?? 0) + 1;
      seen.set(item.part, n);
      breakNext = !!o?.pageBreakEvery && n % o.pageBreakEvery === 0;
      if (o?.restartPageNumbers) this.restart = true;
    }
    if (!this.page) this.newPage();
    return this.pages;
  }

  /** Complete pages go to `consume` as they are made; no page list is retained. */
  printTo(items: Iterable<PrintItem>, consume: (page: PdfPage) => void): number {
    this.onPage = consume;
    try {
      this.print(items);
      if (this.page) consume(this.page);
      return this.pageIndex;
    } finally {
      this.onPage = undefined;
    }
  }

  /**
   * Print in columns (Layout Setup): records side by side, across first or down first, grand summaries
   * across the page (see paginateColumns). Parts slide first, so each takes the height it has left.
   */
  private printColumns(items: PrintItem[]): PdfPage[] {
    const slid = items.map((item) => {
      item.select?.();
      return this.slidePart(item.part);
    });
    const seen = new Map<LayoutPart, number>();
    const nth = items.map((x) => {
      const n = (seen.get(x.part) ?? 0) + 1;
      seen.set(x.part, n);
      return n;
    });
    const height = (parts: LayoutPart[]) => parts.reduce((n, p) => n + p.height, 0);
    const frame = { header: (page: number) => height(this.headers(page === 1).head), footer: (page: number) => height(this.headers(page === 1).foot) };
    const { pages } = paginateColumns(slid.map((x) => x.height), (k) => items[k].part.kind.endsWith('grand-summary'), frame, this.height - this.oy - this.mb, this.design.printColumns!, {
      before: (k) => !!items[k].part.options?.pageBreakBefore,
      after: (k) => {
        const every = items[k].part.options?.pageBreakEvery;
        return !!every && nth[k] % every === 0;
      },
    });
    for (const onPage of pages) {
      // The header shows the page's first record.
      if (onPage[0]) items[onPage[0].index].select?.();
      this.newPage();
      const flowTop = this.y;
      for (const x of onPage) {
        const item = items[x.index];
        item.select?.();
        this.drawPart(item.part, flowTop + x.top, slid[x.index], x.column < 0 ? undefined : { dx: x.column * this.columnWidth, width: this.columnWidth });
        if (item.part.options?.restartPageNumbers) this.restart = true;
      }
    }
    if (!this.page) this.newPage();
    return this.pages;
  }

  private headerHeight(): number {
    return this.oy + this.headers(this.pageIndex === 1).head.reduce((n, p) => n + p.height, 0);
  }

  private headers(first: boolean): { head: LayoutPart[]; foot: LayoutPart[] } {
    const title = this.parts('title-header');
    const titleFoot = this.parts('title-footer');
    return {
      head: first && title.length ? title : this.parts('header'),
      foot: first && titleFoot.length ? titleFoot : this.parts('footer'),
    };
  }

  private newPage(): void {
    if (this.page) this.onPage?.(this.page);
    this.page = { width: this.width, height: this.height, ops: [] };
    this.pageIndex++;
    if (!this.onPage) this.pages.push(this.page);
    // A part that restarts page numbers ends its page's run: the next page is 1 again.
    this.number = this.restart ? 1 : this.number + 1;
    this.restart = false;
    this.src.page?.(this.number);
    const { head, foot } = this.headers(this.pageIndex === 1);
    this.y = this.oy;
    for (const part of head) {
      this.drawPart(part, this.y);
      this.y += part.height;
    }
    this.bottom = this.height - this.mb - foot.reduce((n, p) => n + p.height, 0);
    let fy = this.bottom;
    for (const part of foot) {
      this.drawPart(part, fy);
      fy += part.height;
    }
  }

  private partObjects(part: LayoutPart): LayoutObject[] {
    return this.design.objects.filter((o) => o.bounds.top >= part.top && o.bounds.top < part.top + part.height);
  }

  /**
   * Sliding & Visibility, as Preview mode does it (see slide()): sliding
   * fields and texts shrink to their content (an empty one to nothing), a
   * sliding portal to its filled rows, and objects below move up into the
   * space; the part shrinks too when an object asks for it.
   */
  private slidePart(part: LayoutPart): Slid {
    const objects = this.partObjects(part);
    if (!objects.some((o) => o.sliding)) return { bounds: new Map(), height: part.height };
    const boxes = objects.map((o): SlideBox => {
      const b = o.bounds;
      const box: SlideBox = { id: String(o.id), top: b.top - part.top, left: b.left, bottom: b.bottom - part.top, right: b.right, up: o.sliding?.up, left_: o.sliding?.left, resizePart: o.sliding?.resizePart };
      if (o.sliding) Object.assign(box, this.contentSize(o));
      return box;
    });
    const out = slide(boxes, part.height);
    for (const b of out.bounds.values()) {
      b.top += part.top;
      b.bottom += part.top;
    }
    return out;
  }

  /** How big a sliding object's content is when printed; undefined keeps its size. */
  private contentSize(o: LayoutObject): { contentHeight?: number; contentWidth?: number } {
    if (this.src.hidden(o) || o.hideWhenPrinting) return { contentHeight: 0, contentWidth: 0 };
    const height = o.bounds.bottom - o.bounds.top;
    const width = o.bounds.right - o.bounds.left;
    if (o.kind === 'portal') {
      const rows = Math.max(1, o.portal?.rows ?? 1);
      const shown = Math.max(0, Math.min(rows, this.src.portalCount(o) - (o.portal?.initialRow ?? 1) + 1));
      return { contentHeight: shown ? (height / rows) * shown : 0 };
    }
    let text: string;
    if (o.kind === 'field') {
      if ((o.field?.repetitions ?? 1) > 1) return {};
      const v = this.src.field(o, 1);
      if (v.file) return {};
      text = v.text;
    } else if (o.kind === 'text') text = this.src.merge(o.text ?? '', this.number);
    else return {};
    if (!text.trim()) return { contentHeight: 0, contentWidth: 0 };
    const el = objectElement(o);
    const extra = o.conditions?.length ? this.src.conditions(o) : [];
    const st = textStyle({ ...resolveCss(this.theme, o.style, el, [20], 1, extra), ...resolveCss(this.theme, o.style, el, [20], 2, extra) }, height, this.themed);
    const [pt, pr, pb, pl] = st.padding ?? [1, 1, 1, 1];
    // A part cannot span sheets. Measuring beyond one printable page only
    // allocates work for text that the PDF will clip anyway.
    const lineHeight = (st.size ?? 10) * (st.lineHeight ?? 1.2);
    const maxLines = Math.max(1, Math.ceil((this.height - this.oy - this.mb) / Math.max(1, lineHeight)) + 1);
    const lines = wrap(text, st.size ?? 10, Math.max(1, width - pl - pr), st.font, maxLines);
    return {
      contentHeight: Math.ceil(lines.length * (st.size ?? 10) * (st.lineHeight ?? 1.2) + pt + pb),
      contentWidth: Math.ceil(Math.max(...lines.map((l) => textWidth(l, st.size ?? 10, st.font))) + pl + pr),
    };
  }

  /** A part's background and objects, with the part's top at `top` on the page; slid objects where sliding put them. */
  /** A part at `top`; in a column, moved right by `dx` and cut at its width (objects starting beyond it aren't printed). */
  private drawPart(part: LayoutPart, top: number, slid?: Slid, column?: { dx: number; width: number }): void {
    const el = partElement(part);
    const css = resolveCss(this.theme, part.style, el, [20], 1);
    const dx = column?.dx ?? 0;
    this.page!.ops.push(...boxOps(css, this.ox + dx, top, column?.width ?? this.partWidth, slid?.height ?? part.height));
    const dy = top - part.top;
    const inside = el === undefined ? [20] : [20, 30, el];
    for (const o of this.partObjects(part)) {
      if (column && o.bounds.left >= column.width) continue;
      const b = slid?.bounds.get(String(o.id));
      if (!b) this.drawObject(o, dy, inside, dx);
      else this.drawObject(o, dy + b.top - o.bounds.top, inside, dx + b.left - o.bounds.left, { width: b.right - b.left, height: b.bottom - b.top });
    }
  }

  /** An object, moved down by dy and right by dx; `size` is the size sliding left it. */
  private drawObject(o: LayoutObject, dy: number, inside: number[], dx = 0, size?: { width: number; height: number }): void {
    if (o.hideWhenPrinting || this.src.hidden(o)) return;
    const ops = this.page!.ops;
    const el = objectElement(o);
    const extra = o.conditions?.length ? this.src.conditions(o) : [];
    const css = resolveCss(this.theme, o.style, el, inside, 1, extra);
    const left = o.bounds.left + dx + this.ox;
    const top = o.bounds.top + dy;
    const width = size?.width ?? o.bounds.right - o.bounds.left;
    const height = size?.height ?? o.bounds.bottom - o.bounds.top;
    const within = el === undefined ? inside : [...inside, el];
    const text = () => textStyle({ ...css, ...resolveCss(this.theme, o.style, el, inside, 2, extra) }, height, this.themed);
    switch (o.kind) {
      case 'line': {
        const side = SIDES.map((s) => ({ w: length(css[`border-${s}-width`], 12), c: cssColor(css[`border-${s}-color`]), s: css[`border-${s}-style`] }))
          .find((x) => x.w > 0 && x.c && x.s !== 'none');
        const stroke: Stroke = side ? { color: side.c!, width: side.w } : { color: [0, 0, 0], width: 1 };
        // A line's bounds box it; flat boxes are horizontal or vertical lines.
        if (height <= stroke.width + 1) ops.push({ kind: 'line', x1: left, y1: top + height / 2, x2: left + width, y2: top + height / 2, stroke });
        else if (width <= stroke.width + 1) ops.push({ kind: 'line', x1: left + width / 2, y1: top, x2: left + width / 2, y2: top + height, stroke });
        else ops.push({ kind: 'line', x1: left, y1: top, x2: left + width, y2: top + height, stroke });
        return;
      }
      case 'oval':
        ops.push(...boxOps(css, left, top, width, height, 'oval'));
        return;
      case 'graphic': {
        ops.push(...boxOps(css, left, top, width, height));
        const data = o.imageId !== undefined ? this.src.image(o.imageId) : undefined;
        if (data) ops.push({ kind: 'image', left, top, width, height, data });
        return;
      }
      case 'field': {
        ops.push(...boxOps(css, left, top, width, height));
        const reps = Math.max(1, o.field?.repetitions ?? 1);
        const st = text();
        for (let r = 1; r <= reps; r++) {
          const h = height / reps;
          const v = this.src.field(o, r);
          const box = { left, top: top + (r - 1) * h, width, height: h };
          if (v.file) ops.push({ kind: 'image', ...box, data: v.file });
          else if (v.text) ops.push({ kind: 'text', ...box, text: v.text, style: st });
        }
        return;
      }
      case 'portal': {
        ops.push(...boxOps(css, left, top, width, height));
        const p = o.portal;
        const rows = Math.max(1, p?.rows ?? 1);
        // Rows keep their height when a sliding portal shrinks to its filled ones.
        const rowHeight = (o.bounds.bottom - o.bounds.top) / rows;
        const count = this.src.portalCount(o);
        for (let r = 0; r < rows && (p?.initialRow ?? 1) + r <= count; r++) {
          this.src.portalRow(o, (p?.initialRow ?? 1) + r);
          for (const c of o.children ?? []) this.drawObject(c, dy + r * rowHeight, within, dx);
        }
        this.src.portalRow(o, undefined);
        return;
      }
      case 'tab-control': case 'slide-control': {
        ops.push(...boxOps(css, left, top, width, height));
        const panels = o.children ?? [];
        const front = panels.find((c) => c.id === o.target) ?? panels[0];
        if (front) this.drawObject(front, dy, within, dx);
        return;
      }
      case 'popover':
        return; // only shown when its button is clicked
      default: {
        ops.push(...boxOps(css, left, top, width, height));
        const label = o.kind === 'text' || o.kind === 'button' || o.kind === 'popover-button' ? o.text : undefined;
        if (label) {
          const t = this.src.merge(label, this.number);
          if (t) ops.push({ kind: 'text', left, top, width, height, text: t, style: text() });
        }
        for (const c of o.children ?? []) if (c.kind !== 'popover') this.drawObject(c, dy, within, dx);
      }
    }
  }
}

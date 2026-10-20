// Preview mode: the found set laid out on printed pages, as FileMaker does.
// Each page has the header (the title header on page one) at the top and
// the footer (or title footer) at the bottom; grand summaries, sub-summaries
// and bodies fill the space between, a part never split across pages.

/** US Letter, portrait, in layout points (1/72 in). */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
/** FileMaker's default page margins: half an inch all round. */
export const PAGE_MARGIN = 36;

/** At most this many records are laid out; FileMaker would print them all, but the browser has to draw them. */
export const PREVIEW_MAX = 500;

/** The file's page setup (see packages/fmp12/src/schema.ts): paper size and the printer's margins, in points. */
export interface PageSetup {
  orientation: 'portrait' | 'landscape';
  paper?: string;
  width: number;
  height: number;
  margins: { top: number; left: number; bottom: number; right: number };
  scale?: number;
}

export interface PageSize {
  orientation: 'portrait' | 'landscape';
  /** The printable area. */
  width: number;
  height: number;
  /** The sheet of paper and the margins around the printable area. */
  paper: { width: number; height: number };
  margins: { top: number; left: number; bottom: number; right: number };
  /** Page Setup's print scale, as a fraction (1 is 100%). */
  scale?: number;
}

/** A4 and US Letter, portrait, in points. */
const SHEETS = [{ width: 595.28, height: 841.89 }, { width: PAGE_WIDTH, height: PAGE_HEIGHT }];

/**
 * The page a layout prints on: the file's page setup when it has one (set
 * on a Mac). A layout exactly as wide as a sheet of A4 or Letter (either
 * way round) is drawn to that sheet edge to edge, with no margins (inferred:
 * report layouts named "A4 Portrait" and "A4 Landscape" are 595 and 841
 * points wide). Otherwise US Letter with half-inch margins, landscape when
 * the layout is wider than a portrait page's printable width, as such
 * layouts are designed to.
 */
export function pageSize(layoutWidth: number, setup?: PageSetup, fixedMargins?: PageSize['margins']): PageSize {
  if (setup) {
    const { width, height, orientation } = setup;
    const margins = fixedMargins ?? setup.margins;
    const scale = setup.scale && setup.scale > 0 ? setup.scale : 1;
    return { orientation, width: Math.max(0, width - margins.left - margins.right) / scale, height: Math.max(0, height - margins.top - margins.bottom) / scale, paper: { width, height }, margins, scale };
  }
  for (const sheet of SHEETS) {
    const none = { top: 0, left: 0, bottom: 0, right: 0 };
    if (Math.abs(layoutWidth - sheet.width) < 1.5) return withMargins({ orientation: 'portrait', width: sheet.width, height: sheet.height, paper: { ...sheet }, margins: none }, fixedMargins);
    if (Math.abs(layoutWidth - sheet.height) < 1.5) return withMargins({ orientation: 'landscape', width: sheet.height, height: sheet.width, paper: { width: sheet.height, height: sheet.width }, margins: none }, fixedMargins);
  }
  const landscape = layoutWidth > PAGE_WIDTH - 2 * PAGE_MARGIN;
  const m = PAGE_MARGIN;
  const margins = { top: m, left: m, bottom: m, right: m };
  return withMargins(landscape
    ? { orientation: 'landscape', width: PAGE_HEIGHT - 2 * m, height: PAGE_WIDTH - 2 * m, paper: { width: PAGE_HEIGHT, height: PAGE_WIDTH }, margins }
    : { orientation: 'portrait', width: PAGE_WIDTH - 2 * m, height: PAGE_HEIGHT - 2 * m, paper: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margins }, fixedMargins);
}

function withMargins(size: PageSize, margins?: PageSize['margins']): PageSize {
  if (!margins) return size;
  return { ...size, width: Math.max(0, size.paper.width - margins.left - margins.right), height: Math.max(0, size.paper.height - margins.top - margins.bottom), margins };
}

/** A message when Preview's rendering cap would omit found records from browser printing: OK saves them all as PDF, Cancel prints nothing. */
export function printLimitNotice(foundCount: number): string | undefined {
  return foundCount > PREVIEW_MAX
    ? `Preview can print only the first ${PREVIEW_MAX} of ${foundCount} found records. Choose OK to save all records as PDF instead, or Cancel to print nothing.`
    : undefined;
}

export interface PageFrame {
  /** Header height on a page (1-based). */
  header(page: number): number;
  footer(page: number): number;
}

/**
 * Which parts go on which page: indexes into `heights`, page by page. A part
 * taller than a page still gets one to itself.
 */
export function paginate(heights: number[], frame: PageFrame, pageHeight = PAGE_HEIGHT - 2 * PAGE_MARGIN, breaks: PageBreaks = {}): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  let breakNext = false;
  for (let i = 0; i < heights.length; i++) {
    const page = pages.length;
    const room = pageHeight - frame.header(page) - frame.footer(page);
    if (pages[pages.length - 1].length && (breakNext || breaks.before?.(i) || used + heights[i] > room)) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(i);
    used += heights[i];
    breakNext = !!breaks.after?.(i);
  }
  return pages;
}

/** Where a part goes on its page in columns: its column (-1 spans the page) and its top below the header. */
export interface Placed {
  index: number;
  column: number;
  top: number;
}

/**
 * Layout Setup's "Print in N columns": which parts go on which page and where. Parts that `span` (grand
 * summaries) take the whole width; the others (records' body and sub-summary parts) fill the columns, across
 * first (a row of N side by side, as tall as the tallest) or down first (one column to the bottom of the page,
 * then the next). Each page's list is in print order, with the height its flow takes.
 */
export function paginateColumns(heights: number[], span: (i: number) => boolean, frame: PageFrame, pageHeight: number, columns: { count: number; order?: 'across' | 'down' },
  breaks: PageBreaks = {}): { pages: Placed[][]; used: number[] } {
  const n = Math.max(1, Math.floor(columns.count));
  const down = columns.order === 'down';
  const pages: Placed[][] = [[]];
  const used: number[] = [0];
  // The current band of columns: where it starts, and how far each column (across: the row) has filled.
  let band = 0;
  let col = 0;
  let fill = Array<number>(n).fill(0);
  let rowTop = 0;
  let rowHeight = 0;
  let breakNext = false;
  const room = () => pageHeight - frame.header(pages.length) - frame.footer(pages.length);
  const bandBottom = () => band + (down ? Math.max(...fill) : rowTop + rowHeight);
  const newPage = () => {
    pages.push([]);
    used.push(0);
    band = 0;
    col = 0;
    fill = Array<number>(n).fill(0);
    rowTop = 0;
    rowHeight = 0;
  };
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const page = pages[pages.length - 1];
    if (page.length && (breakNext || breaks.before?.(i))) newPage();
    if (span(i)) {
      let top = bandBottom();
      if (pages[pages.length - 1].length && top + h > room()) {
        newPage();
        top = 0;
      }
      pages[pages.length - 1].push({ index: i, column: -1, top });
      band = top + h;
      col = 0;
      fill = Array<number>(n).fill(0);
      rowTop = 0;
      rowHeight = 0;
    } else if (down) {
      // Down the column; the next column when this one is full, the next page after the last.
      while (fill[col] > 0 && band + fill[col] + h > room()) {
        if (++col < n) continue;
        newPage();
      }
      if (fill[col] === 0 && col === 0 && pages[pages.length - 1].length && band + h > room()) newPage();
      pages[pages.length - 1].push({ index: i, column: col, top: band + fill[col] });
      fill[col] += h;
    } else {
      // Across: a new row after N, a new page when the row wouldn't fit.
      if (col === n) {
        rowTop += rowHeight;
        rowHeight = 0;
        col = 0;
      }
      if (pages[pages.length - 1].length && band + rowTop + Math.max(rowHeight, h) > room()) {
        newPage();
      }
      pages[pages.length - 1].push({ index: i, column: col, top: band + rowTop });
      rowHeight = Math.max(rowHeight, h);
      col++;
    }
    used[used.length - 1] = Math.max(used[used.length - 1], bandBottom(), span(i) ? band : 0);
    breakNext = !!breaks.after?.(i);
  }
  return { pages, used };
}

/** Part Definition's page breaks: a new page before part `i`, or after it. */
export interface PageBreaks {
  before?(i: number): boolean;
  after?(i: number): boolean;
}

/**
 * Page numbers: 1, 2, ... starting again at 1 after a page holding a part
 * whose Part Definition restarts page numbers.
 */
export function pageNumbers(pages: number[][], restartsAfter: (i: number) => boolean): number[] {
  let n = 0;
  return pages.map((onPage) => {
    const number = ++n;
    if (onPage.some(restartsAfter)) n = 0;
    return number;
  });
}

/** An object of a part for sliding: its bounds in the part, its Sliding & Visibility settings, and how big its content is. */
export interface SlideBox {
  id: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  up?: boolean;
  left_?: boolean;
  resizePart?: boolean;
  /** The content's height (an empty field: 0); undefined keeps the object's height. */
  contentHeight?: number;
  contentWidth?: number;
}

/**
 * Sliding in Preview mode and printing, as FileMaker does it: an object set to
 * slide shrinks to its content (an empty field to nothing), and moves up (or
 * left) as far as every nearest object above it (beside it, for left) that
 * it overlaps has given up space; one with a fixed object above it stays put.
 * Left comes first, then up. When an object asks for it, the part shrinks by
 * the space freed at the bottom. Returns each object's new bounds and the part's height.
 */
export function slide(boxes: SlideBox[], partHeight: number): { bounds: Map<string, { top: number; left: number; bottom: number; right: number }>; height: number } {
  type B = SlideBox & { nTop: number; nLeft: number; nBottom: number; nRight: number };
  const all: B[] = boxes.map((b) => ({ ...b, nTop: b.top, nLeft: b.left, nBottom: b.bottom, nRight: b.right }));
  const pass = (horizontal: boolean) => {
    const start = (b: B) => (horizontal ? b.left : b.top);
    const end = (b: B) => (horizontal ? b.right : b.bottom);
    const overlaps = (a: B, b: B) => (horizontal ? a.top < b.bottom && a.bottom > b.top : a.left < b.right && a.right > b.left);
    const done: B[] = [];
    for (const b of [...all].sort((x, y) => start(x) - start(y))) {
      const slides = horizontal ? b.left_ : b.up;
      if (slides) {
        const content = horizontal ? b.contentWidth : b.contentHeight;
        // Earlier passes moved it; measure from where it is now.
        const size = horizontal ? b.nRight - b.nLeft : b.nBottom - b.nTop;
        const shrunk = content === undefined ? size : Math.max(0, Math.min(size, content));
        // The nearest objects above it: those with no other one between them and it.
        const above = done.filter((p) => end(p) <= start(b) && overlaps(p, b));
        const before = above.filter((p) => !above.some((q) => q !== p && start(q) >= end(p) && overlaps(q, p)));
        const shift = before.length ? Math.max(0, Math.min(...before.map((p) => (horizontal ? p.right - p.nRight : p.bottom - p.nBottom)))) : 0;
        if (horizontal) {
          b.nLeft -= shift;
          b.nRight = b.nLeft + shrunk;
        } else {
          b.nTop -= shift;
          b.nBottom = b.nTop + shrunk;
        }
      }
      done.push(b);
    }
  };
  pass(true);
  pass(false);
  let height = partHeight;
  if (all.some((b) => b.resizePart && (b.up || b.left_)) && all.length) {
    const freed = Math.max(...all.map((b) => b.bottom)) - Math.max(...all.map((b) => b.nBottom));
    height = Math.max(0, partHeight - Math.max(0, freed));
  }
  return { bounds: new Map(all.map((b) => [b.id, { top: b.nTop, left: b.nLeft, bottom: b.nBottom, right: b.nRight }])), height };
}

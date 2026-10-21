// Draws a FileMaker layout: parts stacked top to bottom, objects placed at
// their stored coordinates, styled from the layout's theme. Works for one
// record (form view), a record per body row (list view), or a find request.

import { webViewerBridge, viewerMessage, restoreViewer, type ViewerState } from './web-viewer.ts';
import { StyleSheet, elementOf } from './styles.ts';
import { formatValue } from './format.ts';
import { editRuns, styledNodes } from './styled.ts';
import { rotationOf, turnedBox } from './rotation.ts';
import type { DataFormat, DataRecord, FieldMeta, FieldRef, LayoutMeta, LayoutObject, LayoutPart, PortalRow, Value, ViewState } from './types.ts';

export type Mode = 'browse' | 'find';

/** The effective layout width used by both the editor and Preview, including objects beyond the saved width. */
export function layoutWidth(width: number | undefined, objects: LayoutObject[]): number {
  let right = 0;
  const walk = (os: LayoutObject[]) => {
    for (const o of os) {
      right = Math.max(right, o.bounds.right);
      if (o.children) walk(o.children);
    }
  };
  walk(objects);
  return Math.max(width ?? 0, Math.ceil(right));
}

/** How much a container's contents stretch: all of the window's extra height when it is anchored top and bottom, none when it only moves. */
export function innerStretch(anchors: { top?: boolean; bottom?: boolean }, stretch: number): number {
  return anchors.top && anchors.bottom ? stretch : 0;
}

/** How many rows a portal shows: its own count, plus one per whole row of extra height the window gave it (not on paper, where nothing stretches). */
export function portalRowsShown(rows: number, rowHeight: number, stretch: number, onPaper: boolean): number {
  return rows + (onPaper || rowHeight <= 0 ? 0 : Math.max(0, Math.floor(stretch / rowHeight)));
}

/** Where a field's value lives: the record itself, or a row of a portal. */
export interface RowContext {
  portal: string;
  row: PortalRow;
  /** A portal's empty last row: the table occurrence a new related record goes in. */
  occurrence?: string;
  /** The row's number in the portal (1 is its first related record), so screen readers can tell rows apart. */
  number?: number;
}

/** The empty last row of a portal in Browse mode: no related record yet, so none of the record's formulas apply. */
const newRow = (host: Host, row?: RowContext): boolean => !!row && !row.row.recordId && host.mode === 'browse';

const currentDate = (d: Date, native: boolean): string => native
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : d.toLocaleDateString('en-US');

export interface Host {
  viewer?(object: LayoutObject, row: RowContext | undefined, address: string | undefined): { key: string; state: ViewerState };
  mode: Mode;
  /** The record being shown (browse mode). */
  record?: DataRecord;
  /** Find mode: criteria typed so far, by field key. */
  criteria?: Record<string, string>;
  /** Saves a field value. key is "Field", "TO::Field" or "Field(2)". */
  save(key: string, value: string, row?: RowContext): void;
  /** A field object was entered, left, or had its value changed (for script triggers). */
  fieldEvent?(o: LayoutObject, event: 'OnObjectEnter' | 'OnObjectExit' | 'OnObjectModify' | 'OnObjectSave', row?: RowContext): void;
  upload(key: string, file: File, row?: RowContext): void;
  /** A container field was tapped or clicked: what can be done with it (preview, download, insert, photo, signature). */
  containerAction?(key: string, url: string, anchor: HTMLElement, editable: boolean, row?: RowContext): void;
  action(o: LayoutObject, row?: RowContext): void;
  /** Record number and found count, for {{RecordNumber}} and friends. */
  recordNumber?: number;
  /** Preview mode: the page being drawn, for {{PageNumber}}. */
  pageNumber?: number;
  foundCount?: number;
  totalCount?: number;
  /** Results of the layout's formulas for this record: hidden objects, tooltips, placeholders. */
  state?: ViewState;
  /** Panels chosen in tab and slide controls, kept while moving between records. */
  panels: Map<number, number>;
  /** A field's values in other records starting with `prefix`, for auto-complete. */
  fieldIndex?(key: string, prefix: string): Promise<string[]>;
  /**
   * A found-set portal's rows (a portal on the layout's own occurrence): one place per record of the window's found set,
   * the rows fetched so far filled in. `shown` is how many rows the portal shows at once.
   */
  foundSetRows?(portal: string, shown: number): (PortalRow | undefined)[] | undefined;
  /** A found-set portal scrolled: rows `first` to `last` (0-based) are in view, so they are fetched if they aren't yet. */
  foundSetScrolled?(portal: string, top: number, first: number, last: number): void;
  /** Where a found-set portal was scrolled to, to put it back when the layout is drawn again. */
  foundSetScrollTop?(portal: string): number;
  /**
   * A scrolling portal of the record shown has more related records than the record came with (the Data API sends
   * 50 of each portal): fetches the rest after the `have` it already shows, up to `total`, and gives them back.
   */
  morePortalRows?(portal: string, record: DataRecord, have: number, total: number): Promise<PortalRow[]>;
  /** Clicking a found-set portal's row: go to that record. */
  goToRecordId?(recordId: string): void;
  /** Before panel `p` of tab or slide control `o` comes to the front (OnPanelSwitch); true to switch it in place. */
  switchPanel?(o: LayoutObject, p: LayoutObject): Promise<boolean>;
  /** Working from the offline copy: portals don't offer an empty row for new related records. */
  offline?: boolean;
}

const PART_ORDER = ['top-navigation', 'title-header', 'header', 'leading-grand-summary', 'sub-summary-leading', 'body', 'sub-summary-trailing', 'trailing-grand-summary', 'footer', 'title-footer', 'bottom-navigation'];

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|heic|tiff?)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|caf)$/i;

/** What a container holds, from its file name: drawn as a picture, a player, a PDF's first page or a file. */
export function containerKind(path: string): 'image' | 'video' | 'audio' | 'pdf' | 'file' {
  return IMAGE_EXT.test(path) ? 'image' : VIDEO_EXT.test(path) ? 'video' : AUDIO_EXT.test(path) ? 'audio' : /\.pdf$/i.test(path) ? 'pdf' : 'file';
}

/** A container picture's or PDF's thumbnail URL, for a box `px` device pixels across (the server makes it once). */
export function thumbUrl(url: string, px: number): string {
  // In steps of 64 so boxes of nearly the same size share one thumbnail.
  const size = Math.min(1024, Math.max(64, Math.ceil(px / 64) * 64));
  return `${url}${url.includes('?') ? '&' : '?'}thumb=${size}`;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

export class LayoutRenderer {
  readonly meta: LayoutMeta;
  readonly sheet: StyleSheet;
  readonly width: number;
  readonly parts: LayoutPart[];
  /** Top-level objects, grouped by the part their top edge falls in. */
  private readonly byPart = new Map<LayoutPart, LayoutObject[]>();
  private readonly fieldTypes = new Map<string, FieldMeta>();
  private styleEl: HTMLStyleElement;

  constructor(meta: LayoutMeta, scope: string) {
    this.meta = meta;
    const d = meta.design;
    this.sheet = new StyleSheet(`.${scope}`, meta.theme);
    this.width = layoutWidth(d.width, d.objects);
    this.parts = [...d.parts].sort((a, b) => a.top - b.top);
    if (!this.parts.length) this.parts.push({ kind: 'body', kindId: 4, top: 0, height: Math.max(...d.objects.map((o) => o.bounds.bottom), 100), style: {} });
    for (const p of this.parts) this.byPart.set(p, []);
    for (const o of d.objects) {
      const part = [...this.parts].reverse().find((p) => o.bounds.top >= p.top) ?? this.parts[0];
      this.byPart.get(part)!.push(o);
    }
    for (const [to, fields] of Object.entries(meta.fields)) {
      for (const f of fields) this.fieldTypes.set(to === meta.layout.occurrence ? f.name : `${to}::${f.name}`, f);
    }
    for (const os of this.byPart.values()) this.findLabels(os);
    this.styleEl = document.createElement('style');
  }

  /** Each field's label: the text drawn just left of it on its row, or just above it, in the same part, group or panel. */
  private readonly labels = new Map<number, string>();
  private findLabels(os: LayoutObject[]): void {
    const texts = os.flatMap((t) => {
      if (t.kind !== 'text' || !t.text) return [];
      // Plain words only: merge fields and symbols aren't a label, and neither is a paragraph.
      const words = t.text.replace(/<<[^<>]*>>|\{\{\w+\}\}/g, '').trim().replace(/\s*:$/, '');
      return words && words.length <= 60 && !/\n/.test(words) ? [{ b: t.bounds, words }] : [];
    });
    for (const o of os) {
      if (o.kind === 'field' && texts.length) {
        const f = o.bounds;
        const middle = (b: typeof f) => (b.top + b.bottom) / 2;
        const left = texts.filter((t) => t.b.right <= f.left + 2 && f.left - t.b.right <= 60 && middle(t.b) >= f.top && middle(t.b) <= f.bottom)
          .sort((a, b) => b.b.right - a.b.right)[0];
        const above = texts.filter((t) => t.b.bottom <= f.top + 2 && f.top - t.b.bottom <= 24 && Math.abs(t.b.left - f.left) <= 20)
          .sort((a, b) => b.b.bottom - a.b.bottom)[0];
        const label = left ?? above;
        if (label) this.labels.set(o.id, label.words);
      }
      // A portal's fields repeat by row (named with their row instead); groups and panels have labels of their own.
      if (o.children && o.kind !== 'portal') this.findLabels(o.children);
    }
  }

  /** The <style> element with this layout's CSS; call after rendering so per-object rules are in. */
  style(): HTMLStyleElement {
    this.styleEl.textContent = this.sheet.text();
    return this.styleEl;
  }

  part(kind: string): LayoutPart | undefined {
    return this.parts.find((p) => p.kind === kind);
  }

  /** Parts in FileMaker's display order. */
  partsOfKind(kinds: string[]): LayoutPart[] {
    return this.parts.filter((p) => kinds.includes(p.kind)).sort((a, b) => PART_ORDER.indexOf(a.kind) - PART_ORDER.indexOf(b.kind) || a.top - b.top);
  }

  /** A layout object by id, at any depth (the data-id an object's element carries). */
  /** Whether any object of a part slides in Preview mode. */
  slides(part: LayoutPart): boolean {
    return (this.byPart.get(part) ?? []).some((o) => o.sliding);
  }

  /** Whether the part shows the page number ({{PageNumber}}), so Preview draws it again for each page it lands on. */
  showsPageNumber(part: LayoutPart): boolean {
    const shows = (os: LayoutObject[]): boolean => os.some((o) => /\{\{(?:PageNumber|1015)\}\}/.test(o.text ?? '') || (!!o.children && shows(o.children)));
    return shows(this.byPart.get(part) ?? []);
  }

  objectById(id: number): LayoutObject | undefined {
    const find = (os: LayoutObject[]): LayoutObject | undefined => {
      for (const o of os) {
        if (o.id === id) return o;
        const inner = o.children && find(o.children);
        if (inner) return inner;
      }
      return undefined;
    };
    return find(this.meta.design.objects);
  }

  /** Field key as the Data API names it. */
  fieldKey(o: LayoutObject, rep = 1): string | undefined {
    return this.refKey(o.field, rep);
  }

  refKey(f: FieldRef | undefined, rep = 1): string | undefined {
    if (!f?.field) return undefined;
    const base = !f.tableOccurrence || f.tableOccurrence === this.meta.layout.occurrence ? f.field : `${f.tableOccurrence}::${f.field}`;
    return rep > 1 ? `${base}(${rep})` : base;
  }

  /** Every field on the layout outside portals, as Data API keys (for quick find and table view). */
  fieldKeys(): string[] {
    const out: string[] = [];
    const walk = (os: LayoutObject[]) => {
      for (const o of os) {
        const k = this.fieldKey(o);
        if (k && !out.includes(k)) out.push(k);
        if (o.children && o.kind !== 'portal') walk(o.children);
      }
    };
    walk(this.meta.design.objects);
    return out;
  }

  fieldType(key: string): FieldMeta | undefined {
    return this.fieldTypes.get(key.replace(/\(\d+\)$/, ''));
  }

  /** One part, with its objects, for one record (or none). */
  renderPart(part: LayoutPart, host: Host, opts: { stretch?: number } = {}): HTMLElement {
    const el = h('div', { class: `fm fm-part fm-part-${part.kind}`, 'data-part': String(part.top), 'data-record': host.record?.recordId ?? '' });
    this.sheet.apply(el, part.style, part.style.element ?? ({ body: 34, header: 32, footer: 38, 'top-navigation': 40, 'bottom-navigation': 41, 'title-header': 31, 'title-footer': 39 } as Record<string, number>)[part.kind], `p${part.top}`);
    const height = part.height + (opts.stretch ?? 0);
    el.style.height = `${height}px`;
    el.style.setProperty('--fm-layout-width', `${this.width}px`);
    for (const o of this.byPart.get(part) ?? []) {
      const node = this.renderObject(o, host, { top: part.top, left: 0 }, undefined, opts.stretch ?? 0);
      if (node) el.append(node);
    }
    return el;
  }

  /**
   * One object, positioned relative to `origin` (layout coordinates of the
   * container's top-left, and its right edge when it isn't the layout's).
   * `stretch` is extra height the part got from the
   * window, for objects anchored to the bottom.
   */
  renderObject(o: LayoutObject, host: Host, origin: { top: number; left: number; right?: number }, row?: RowContext, stretch = 0): HTMLElement | undefined {
    if (this.hidden(o, host, row)) return undefined;
    const b = o.bounds;
    const el = h('div', { class: `fm fm-${o.kind}${o.hideWhenPrinting ? ' fm-print-hide' : ''}`, 'data-id': String(o.id) });
    el.style.top = `${b.top - origin.top}px`;
    el.style.height = `${b.bottom - b.top + (o.anchors.top && o.anchors.bottom ? stretch : 0)}px`;
    if (o.anchors.bottom && !o.anchors.top) el.style.top = `${b.top - origin.top + stretch}px`;
    // What's inside stretches with this object only when it stretches itself (anchored top and bottom); otherwise it moves with it.
    const inner = innerStretch(o.anchors, stretch);
    // Horizontal anchoring: objects pinned to the right edge move or stretch with the window.
    // Inside a group, panel, popover or portal row the edge is the container's, which moves or stretches the same way.
    if (o.anchors.right && (!row || origin.right !== undefined)) {
      el.style.right = `${(origin.right ?? this.width) - b.right}px`;
      if (o.anchors.left) el.style.left = `${b.left - origin.left}px`;
      else el.style.width = `${b.right - b.left}px`;
    } else {
      el.style.left = `${b.left - origin.left}px`;
      el.style.width = `${b.right - b.left}px`;
    }
    // A turned object keeps to its bounds as laid out: it is placed by them, not anchored to the window's edges.
    const turn = rotationOf(o);
    if (turn) {
      const box = turnedBox(b, turn, origin);
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.right = '';
      el.style.transform = box.transform;
    }
    this.sheet.apply(el, o.style, elementOf(o), `o${o.id}`);
    const tip = row?.row.recordId ? host.state?.rows?.[row.portal]?.[row.row.recordId]?.tooltips?.[o.id] : host.state?.tooltips[o.id];
    if (tip) el.title = tip;

    switch (o.kind) {
      case 'field': this.renderField(el, o, host, row); break;
      case 'text': el.append(h('div', { class: 'fm-content fm-text' }, this.mergeText(o.text ?? '', host, row))); break;
      case 'button': case 'popover-button': this.renderButton(el, o, host, row); break;
      case 'graphic': {
        const src = o.imageId !== undefined ? this.meta.images[o.imageId] : undefined;
        if (src) el.append(h('img', { src, alt: '', class: 'fm-content fm-graphic', draggable: 'false' }));
        break;
      }
      case 'portal': this.renderPortal(el, o, host, inner); return el;
      case 'tab-control': case 'slide-control': this.renderPanels(el, o, host, row, inner); return el;
      case 'popover': return undefined; // drawn when its button is clicked
      case 'chart':
        if (o.chart && host.mode === 'browse' && host.record) {
          const loading = h('div', { class: 'fm-content fm-placeholder' }, 'Chart');
          el.append(loading);
          void import('./chart.ts').then(({ renderChart }) => {
            if (!loading.isConnected) return;
            const chart = renderChart(o.chart!, host.state?.charts?.[o.id], b.right - b.left, b.bottom - b.top);
            // No title: screen readers say its tooltip or name instead of just "image".
            if (!chart.hasAttribute('aria-label') && (tip || o.name)) chart.setAttribute('aria-label', tip || o.name!);
            loading.replaceWith(chart);
          });
          break;
        }
        el.append(h('div', { class: 'fm-content fm-placeholder' }, 'Chart'));
        break;
      case 'web-viewer':
        const shown = host.mode === 'browse' || (host.mode === 'find' && o.webOptions?.findMode === true);
        const setup = shown ? row?.row.recordId ? host.state?.rows?.[row.portal]?.[row.row.recordId]?.web?.[o.id] : host.state?.web?.[o.id] : undefined;
        const runtime = host.mode === 'browse' ? host.viewer?.(o, row, setup) : undefined;
        const address = runtime ? runtime.state.url : setup;
        // In Browse mode a web viewer with no address yet (a script sets one) is blank, as in FileMaker.
        const content = webViewerBlank(o.webOptions, host.mode, address, !!host.state) ? h('div', { class: 'fm-content fm-webviewer fm-webviewer-blank' }) : webViewer(address, o.webOptions?.jsBridge === true && host.mode === 'browse');
        // Web Viewer Setup's "Allow interaction with web viewer content" off: the page shows but takes no clicks.
        if (runtime && content instanceof HTMLIFrameElement && runtime.state.hash !== undefined) content.addEventListener('load', () => restoreViewer(content, runtime.state));
        if (runtime) {
          content.dataset.viewerKey = runtime.key;
          content.dataset.viewerGeneration = String(runtime.state.generation);
        }
        if (o.webOptions?.interaction === false) content.style.pointerEvents = 'none';
        if (content instanceof HTMLIFrameElement && (tip || o.name)) content.title = tip || o.name!;
        el.append(content);
        // Web Viewer Setup's progress bar and status messages: under the page while it loads.
        const chrome = content instanceof HTMLIFrameElement ? webViewerChrome(o.webOptions) : undefined;
        if (chrome && content instanceof HTMLIFrameElement && content.dataset.loaded !== '1') {
          const bar = h('div', { class: 'fm-webviewer-bar', 'aria-hidden': 'true' },
            ...(chrome.progress ? [h('progress', {})] : []), ...(chrome.status ? [h('span', {}, 'Loading…')] : []));
          content.addEventListener('load', () => bar.remove(), { once: true });
          el.append(bar);
        }
        break;
    }
    this.conditionalFormat(el, o, host, row);
    if (o.action && o.kind !== 'button' && o.kind !== 'popover-button') {
      el.classList.add('fm-clickable');
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('input,textarea,select')) return;
        host.action(o, row);
      });
      // A text or picture set up as a button is one for the keyboard and screen readers too
      // (a field keeps its own box as the way in).
      if (o.kind !== 'field') {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        if (!el.textContent?.trim()) el.setAttribute('aria-label', tip || o.name || o.action.script || o.action.step);
        el.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
            e.preventDefault();
            host.action(o, row);
          }
        });
      }
    }
    // Children of groups and button bars are positioned on the layout like any object.
    if (o.children && o.kind !== 'portal') {
      const active = o.kind === 'button-bar' ? this.activeSegment(o, host, row) : undefined;
      for (const c of o.children) {
        const node = this.renderObject(c, host, { top: b.top, left: b.left, right: b.right }, row, inner);
        if (node && c.id === active) node.classList.add('fm-checked');
        if (node && active !== undefined) node.querySelector('button')?.setAttribute('aria-pressed', String(c.id === active));
        if (node) el.append(node);
      }
    }
    return el;
  }

  /** The segment Button Bar Setup makes active: a fixed one, or the one a calculation names. */
  private activeSegment(o: LayoutObject, host: Host, row?: RowContext): number | undefined {
    if (o.activeSegment !== undefined) return o.activeSegment;
    if (!o.activeSegmentFormula || host.mode !== 'browse' || newRow(host, row)) return undefined;
    const name = row?.row.recordId ? host.state?.rows?.[row.portal]?.[row.row.recordId]?.active?.[o.id] : host.state?.active?.[o.id];
    return name ? o.children?.find((c) => c.name === name)?.id : undefined;
  }

  /** Hide conditions: FileMaker doesn't draw an object whose "hide object when" is true. */
  private hidden(o: LayoutObject, host: Host, row?: RowContext): boolean {
    if (!o.hide || !host.state) return false;
    // Hide conditions in portals mostly test the related record (IsEmpty ( Lines::id ) hides a row's delete button),
    // so in the empty row, where there's nothing to test, the object stays hidden.
    if (newRow(host, row)) return true;
    if (row?.row.recordId) return host.state.rows?.[row.portal]?.[row.row.recordId]?.hidden.includes(o.id) ?? false;
    return host.state.hidden.includes(o.id);
  }

  /**
   * Conditional formatting: the formats of the conditions that are true, in
   * order (a later one wins), over the object's own style.
   */
  private conditionalFormat(el: HTMLElement, o: LayoutObject, host: Host, row?: RowContext): void {
    if (!o.conditions || !host.state || newRow(host, row)) return;
    const on = row?.row.recordId ? host.state.rows?.[row.portal]?.[row.row.recordId]?.styles?.[o.id] : host.state.styles?.[o.id];
    for (const i of on ?? []) {
      for (const r of o.conditions[i]?.rules ?? []) {
        if (r.state !== 1) continue;
        const targets = r.part === 4 ? [...el.querySelectorAll<HTMLElement>(':scope > .fm-icon, :scope > button .fm-icon')] : r.part === 1 || r.part === 2 ? [el] : [];
        for (const t of targets) for (const [k, v] of Object.entries(r.css)) t.style.setProperty(k, v);
      }
    }
  }

  /** Replaces <<merge fields>> and {{symbols}} in static text. */
  private mergeText(text: string, host: Host, row?: RowContext): string {
    return text
      // <<ƒ:formula>>: text calculated by a formula (FileMaker 2025's calculated merge text); it may hold < and >.
      .replace(/<<(ƒ:[\s\S]*?|[^<>]+)>>/g, (all, name: string) => {
        if (name.startsWith('ƒ:')) {
          if (host.mode === 'find') return '';
          return (row?.row.recordId ? host.state?.rows?.[row.portal]?.[row.row.recordId]?.merges?.[name] : host.state?.merges?.[name]) ?? '';
        }
        const key = name.startsWith(`${this.meta.layout.occurrence}::`) ? name.slice(this.meta.layout.occurrence.length + 2) : name;
        if (host.mode === 'find' || (!row && !host.record) || newRow(host, row)) return '';
        const merged = row?.row.recordId ? host.state?.rows?.[row.portal]?.[row.row.recordId]?.merges?.[name] : host.state?.merges?.[name];
        const v = row?.row[name] ?? host.record?.fieldData[key] ?? host.record?.fieldData[name] ?? merged;
        return v === undefined ? all : String(v);
      })
      .replace(/\{\{(\w+)\}\}/g, (all, sym: string) => {
        // Layout clock symbols use the browser's local clock. Server-evaluated Get defaults use the host clock.
        const now = new Date();
        switch (sym) {
          case 'CurrentDate': return currentDate(now, this.meta.fileMode === 'native');
          case 'CurrentTime': return now.toLocaleTimeString('en-US');
          case 'RecordNumber': return String(host.recordNumber ?? '');
          case 'FoundCount': return String(host.foundCount ?? '');
          case 'PageNumber': case '1015': return String(host.pageNumber ?? 1);
          // Newer files store a symbol as 1000 + its Get ( ) function id.
          case '1002': return currentDate(now, this.meta.fileMode === 'native');
          case '1029': return now.toLocaleTimeString('en-US');
          case '1007': return String(host.foundCount ?? '');
          case '1019': return String(host.totalCount ?? '');
          case '1020': return String(host.recordNumber ?? '');
          default: return /^\d+$/.test(sym) ? '' : all;
        }
      });
  }

  private value(key: string, host: Host, row?: RowContext): Value {
    if (host.mode === 'find') return host.criteria?.[row ? `${row.portal}|${key}` : key] ?? '';
    if (row) return row.row[key] ?? '';
    return host.record?.fieldData[key] ?? '';
  }

  private renderField(el: HTMLElement, o: LayoutObject, host: Host, row?: RowContext): void {
    // A field object whose field is gone (deleted, or in a file that isn't hosted): FileMaker's "<Field Missing>".
    const missing = () => el.append(h('div', { class: 'fm-content fm-missing', title: 'Field is missing' }, '<Field Missing>'));
    if (!o.field) {
      missing();
      return;
    }
    const f = o.field;
    const reps = Math.max(1, f.repetitions);
    const keyBase = this.fieldKey(o);
    // Inside a portal, values are keyed "TO::Field" even when the TO is the layout's.
    const keyFor = (rep: number) => {
      if (!keyBase) return undefined;
      if (row && f.tableOccurrence && !keyBase.includes('::')) return `${f.tableOccurrence}::${keyBase}${rep > 1 ? `(${rep})` : ''}`;
      return rep > 1 ? `${keyBase}(${rep})` : keyBase;
    };
    if (!keyBase) {
      missing();
      return;
    }
    const meta = this.fieldType(keyBase);
    // Field behavior: "view" fields can't be entered at all, "select" ones can be selected and copied but not changed.
    const entry = host.mode === 'find' ? f.behavior?.find : host.mode === 'browse' ? f.behavior?.browse : undefined;
    // In the empty row only the new record's own fields take typing: not another occurrence's, nor a global.
    const foreign = newRow(host, row) && (meta?.global || !keyFor(1)!.startsWith(`${row!.occurrence}::`));
    const readOnly = (host.mode === 'browse' && (meta?.calculated || meta?.summary || meta?.readOnly || !host.record || foreign)) || entry === 'view' || entry === 'select';
    const repHeight = (o.bounds.bottom - o.bounds.top) / reps;
    for (let rep = 1; rep <= reps; rep++) {
      const key = keyFor(rep)!;
      const value = this.value(key, host, row);
      const cell = reps > 1 ? h('div', { class: 'fm-rep' }) : el;
      if (reps > 1) {
        cell.style.height = `${repHeight}px`;
        el.append(cell);
      }
      if (meta?.type === 'container' && host.mode === 'browse') {
        this.renderContainer(cell, String(value), key, host, row, { width: o.bounds.right - o.bounds.left, height: repHeight, readOnly: !!readOnly });
        if (f.format?.container) cell.classList.add(`fm-pict-${f.format.container}`);
        continue;
      }
      const list = f.valueListId;
      const values = list !== undefined ? host.state?.valueLists?.[list] ?? this.meta.valueLists[list] : undefined;
      const labels = list !== undefined ? (host.state?.valueLists?.[list] ? host.state.valueListLabels?.[list] : this.meta.valueListLabels?.[list]) : undefined;
      const save = (v: string) => {
        if (host.mode === 'find') host.criteria![row ? `${row.portal}|${key}` : key] = v;
        else {
          host.save(key, v, row);
          host.fieldEvent?.(o, 'OnObjectModify', row);
          // Leaving the changed field: OnObjectValidate (which can keep the cursor in it), then OnObjectSave.
          host.fieldEvent?.(o, 'OnObjectSave', row);
        }
      };
      const input = this.input(f.display, String(value), values, repHeight, !!readOnly, save, o, labels, meta?.type, host.mode === 'find');
      // A total or SQL result from just before the latest change, shown while the server works it out again.
      if (!row && host.mode === 'browse' && host.record?.updating?.includes(key)) {
        cell.classList.add('fm-updating');
        cell.title = 'Updating…';
        cell.setAttribute('aria-busy', 'true');
      }
      const placeholder = rep === 1 ? host.state?.placeholders[o.id] : undefined;
      const box = input.matches('input, textarea') ? input : input.querySelector('input');
      // Formatting kept with the data shows wherever the field does: on the record, in related fields and in portal rows.
      const runs = host.mode !== 'browse' ? undefined : row ? (row.row.recordId ? host.record?.portalStyles?.[row.portal]?.[row.row.recordId]?.[key] : undefined) : host.record?.styles?.[key];
      const styled = runs?.length && box === input && box.matches('input.fm-input, textarea.fm-input') ? this.showStyled(box as HTMLInputElement, runs) : undefined;
      if (!styled && host.mode === 'browse' && box?.matches('input.fm-input, textarea.fm-input')) this.showFormatted(box as HTMLInputElement, meta?.type, f.format);
      if (placeholder && box) (box as HTMLInputElement).placeholder = placeholder;
      // Screen readers say the label drawn beside or above the field, else the field's name; a set of
      // check boxes or radio buttons is a named group.
      // In a portal the row is said too: every row repeats the same fields.
      const spoken = `${(!row && this.labels.get(o.id)) || keyBase.split('::').pop()}${reps > 1 ? ` ${rep}` : ''}${row?.number ? `, row ${row.number}` : newRow(host, row) ? ', new row' : ''}`;
      if (input.matches('.fm-choices')) input.setAttribute('role', 'group');
      const named = input.matches('.fm-choices, select') ? input : box;
      if (named && !named.hasAttribute('aria-label')) named.setAttribute('aria-label', spoken);
      if (box && !row && host.mode === 'browse') (box as HTMLElement).dataset.key = key;
      // Touch keyboards: a number pad for number fields; Return finishes a one-line field.
      if (box && host.mode === 'browse' && !readOnly) {
        if (meta?.type === 'number') (box as HTMLInputElement).inputMode = 'decimal';
        if (box.matches('input')) box.setAttribute('enterkeyhint', 'done');
      }
      if (box instanceof HTMLInputElement && f.behavior?.autoComplete && f.display !== 'dropdown' && host.mode === 'browse' && !readOnly && host.fieldIndex) {
        this.autoComplete(box, (prefix) => host.fieldIndex!(key, prefix));
      }
      if (entry === 'view') {
        input.inert = true;
      }
      if (box && f.behavior?.concealed) {
        // Dots instead of the data, as FileMaker's concealed edit box (it isn't encrypted).
        if (box instanceof HTMLInputElement) box.type = 'password';
        else box.style.setProperty('-webkit-text-security', 'disc');
        box.setAttribute('autocomplete', 'off');
      }
      if (box instanceof HTMLTextAreaElement && f.behavior?.scrollBar) box.style.overflowY = 'scroll';
      if (box && f.behavior?.selectOnEntry && entry !== 'view') {
        // After the click that entered the field has placed the cursor.
        box.addEventListener('focus', () => setTimeout(() => document.activeElement === box && (box as HTMLInputElement).select()));
      }
      if (box && f.behavior?.noTab && !readOnly) {
        // Tab isn't one of the keys that moves to the next object: it types a tab.
        box.addEventListener('keydown', (e) => {
          const k = e as KeyboardEvent;
          if (k.key !== 'Tab' || k.shiftKey || k.altKey || k.metaKey || k.ctrlKey) return;
          k.preventDefault();
          k.stopPropagation();
          // Typed as the person's own input, so it's undoable and saved when they leave the field.
          if (!document.execCommand('insertText', false, '\t')) {
            const b = box as HTMLInputElement;
            b.setRangeText('\t', b.selectionStart ?? b.value.length, b.selectionEnd ?? b.value.length, 'end');
            b.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
      }
      if (o.triggers?.length && host.mode === 'browse' && !readOnly) {
        // Moving within the field (between checkboxes, say) is neither entering nor leaving it.
        input.addEventListener('focusin', (e) => {
          if (!input.contains((e as FocusEvent).relatedTarget as Node | null)) host.fieldEvent?.(o, 'OnObjectEnter', row);
        });
        input.addEventListener('focusout', (e) => {
          if (!input.contains((e as FocusEvent).relatedTarget as Node | null)) host.fieldEvent?.(o, 'OnObjectExit', row);
        });
      }
      cell.append(styled ? h('div', { class: 'fm-styled-box fm-styled-host' }, input, styled) : input);
    }
  }

  /** Formatted text (a calculation's TextColor, a text field formatted from the Format menu) to show over the field; the field shows its plain text while it has the cursor. */
  private showStyled(input: HTMLInputElement | HTMLTextAreaElement, runs: NonNullable<DataRecord['styles']>[string]): HTMLElement {
    return styledOverlay(input, runs);
  }

  /** Shows the formatted value until the field is entered, as FileMaker does. */
  private showFormatted(input: HTMLInputElement | HTMLTextAreaElement, type: string | undefined, format: DataFormat | undefined): void {
    if (!format) return;
    if (this.meta.fileMode === 'native' && (type === 'date' || type === 'timestamp')) return;
    let raw = input.value;
    const show = () => {
      const f = formatValue(raw, type, format);
      input.value = f?.text ?? raw;
      input.style.color = f?.color ?? '';
    };
    input.addEventListener('focus', () => {
      input.value = raw;
      input.style.color = '';
    });
    input.addEventListener('blur', () => {
      raw = input.value;
      show();
    });
    show();
  }

  private input(display: string, value: string, values: string[] | undefined, height: number, readOnly: boolean, save: (v: string) => void, o: LayoutObject, labels?: string[], type?: string, find = false): HTMLElement {
    const label = (v: string) => labels?.[values!.indexOf(v)] ?? v;
    const name = `f${o.id}-${Math.random().toString(36).slice(2, 7)}`;
    const allowOther = !!o.field?.behavior?.otherValue && !readOnly;
    if (this.meta.fileMode === 'native' && type === 'boolean' && !find && !values?.length) {
      const input = h('input', { class: 'fm-content fm-native-boolean', type: 'checkbox' }) as HTMLInputElement;
      input.checked = value === '1' || value.toLowerCase() === 'true';
      input.disabled = readOnly;
      input.addEventListener('change', () => save(input.checked ? '1' : '0'));
      const clear = h('button', { type: 'button', 'aria-label': 'Clear boolean field' }, 'Clear') as HTMLButtonElement;
      clear.className = 'fm-native-boolean-clear';
      clear.disabled = readOnly;
      const control = h('span', { class: 'fm-content fm-native-boolean-control' }, input, clear);
      const showEmpty = (empty: boolean) => { control.classList.toggle('fm-native-boolean-empty', empty); clear.disabled = readOnly || empty; };
      showEmpty(value === '');
      input.addEventListener('change', () => showEmpty(false));
      clear.addEventListener('click', () => { input.checked = false; save(''); showEmpty(true); });
      return control;
    }
    if ((display === 'checkbox' || display === 'radio') && values?.length) {
      const box = h('div', { class: 'fm-content fm-choices' });
      const lines = value.split(/\r\n|[\r\n]/).filter((v) => v !== '');
      const checked = new Set(lines);
      // Values in the field that aren't in the list: kept when boxes are ticked, and shown by "Other…".
      let others = lines.filter((v) => !values.includes(v));
      const boxes: HTMLInputElement[] = [];
      let otherBox: HTMLInputElement | undefined;
      const listed = () => boxes.filter((x) => x.checked).map((x) => x.value);
      for (const v of values) {
        const input = h('input', { type: display, name, value: v }) as HTMLInputElement;
        input.checked = checked.has(v);
        input.disabled = readOnly;
        input.addEventListener('change', () => {
          // A radio button is the field's one value.
          if (display === 'radio') {
            others = [];
            if (otherBox) otherBox.checked = false;
          }
          save([...listed(), ...others].join('\r'));
        });
        boxes.push(input);
        // A lone box drawn without its value still says what ticking it means.
        const bare = values.length === 1 && o.bounds.right - o.bounds.left < 40;
        if (bare) input.setAttribute('aria-label', label(v));
        box.append(h('label', { class: 'fm-choice' }, input, bare ? '' : label(v)));
      }
      if (allowOther) {
        const input = h('input', { type: display, name, value: '' }) as HTMLInputElement;
        otherBox = input;
        input.checked = others.length > 0;
        input.addEventListener('click', (e) => {
          // Ticked or not once a value is typed, not by the click itself.
          e.preventDefault();
          void otherDialog(others.join('\n'), display === 'checkbox').then((typed) => {
            if (typed === undefined) return;
            others = typed.split('\n').map((v) => v.trim()).filter((v) => v !== '');
            if (display === 'radio') {
              others = others.slice(0, 1);
              if (others.length) for (const b of boxes) b.checked = false;
            }
            input.checked = others.length > 0;
            save([...listed(), ...others].join('\r'));
          });
        });
        box.append(h('label', { class: 'fm-choice' }, input, 'Other…'));
      }
      return box;
    }
    if (display === 'popup' && values) {
      const sel = h('select', { class: 'fm-content fm-input' }) as HTMLSelectElement;
      const opts = values.includes(value) || value === '' ? ['', ...values] : ['', value, ...values];
      // A "-" in a value list is a divider in a pop-up menu.
      for (const v of opts) sel.append(v === '-' && values.includes('-') ? h('option', { disabled: '', value: '-' }, '──────────') : h('option', { value: v }, label(v)));
      const OTHER = '\u0000other';
      if (allowOther) sel.append(h('option', { value: OTHER }, 'Other…'));
      sel.value = value;
      sel.disabled = readOnly;
      let current = value;
      sel.addEventListener('change', () => {
        if (sel.value !== OTHER) {
          current = sel.value;
          save(sel.value);
          return;
        }
        sel.value = current;
        void otherDialog(values.includes(current) ? '' : current, false).then((typed) => {
          const v = typed?.trim();
          if (v === undefined || v === '' || v === current) return;
          if (![...sel.options].some((x) => x.value === v)) sel.options[0].after(h('option', { value: v }, v));
          sel.value = current = v;
          save(v);
        });
      });
      return sel;
    }
    const native = this.meta.fileMode === 'native';
    const multiline = (native && type === 'json') || height > 34 || value.includes('\r') || value.includes('\n');
    const nativeNumeric = native && (type === 'integer' || type === 'decimal') && !find;
    const input = (multiline ? h('textarea', { class: 'fm-content fm-input' }) : h('input', { class: 'fm-content fm-input', type: 'text', ...(nativeNumeric ? { inputmode: 'decimal' } : {}) })) as HTMLInputElement | HTMLTextAreaElement;
    input.value = value.replace(/\r\n?/g, '\n');
    input.readOnly = readOnly;
    input.spellcheck = false;
    // Each value reads in its own direction (Arabic, Hebrew); the field's own alignment still decides where it sits.
    input.dir = 'auto';
    if (nativeNumeric) {
      const validate = () => {
        const s = input.value.trim();
        const valid = !s || (type === 'integer' ? /^[+-]?\d+$/.test(s) && Number.isSafeInteger(Number(s)) : /^[+-]?\d+(?:\.\d+)?$/.test(s) && (s.replace(/^[+-]?/, '').split('.')[0].length <= 1000) && ((s.split('.')[1]?.length ?? 0) <= 30));
        input.setCustomValidity(valid ? '' : `Enter a valid ${type} without an exponent`);
      };
      input.addEventListener('input', validate);
      input.addEventListener('change', (event) => { validate(); if (!input.checkValidity()) { event.stopImmediatePropagation(); input.reportValidity(); } }, { capture: true });
    }
    if (native && type === 'json' && !find) {
      const validate = () => {
        try { if (input.value.trim()) JSON.parse(input.value); input.setCustomValidity(''); }
        catch { input.setCustomValidity('Enter valid JSON'); }
      };
      input.addEventListener('input', validate);
      input.addEventListener('change', (event) => { validate(); if (!input.checkValidity()) { event.stopImmediatePropagation(); input.reportValidity(); } }, { capture: true });
    }
    if (display === 'calendar' && (type === 'date' || type === 'timestamp') && !readOnly && input instanceof HTMLInputElement) {
      return this.calendar(input, value, type, !!o.field?.behavior?.calendarIcon, find, save);
    }
    if (display === 'dropdown' && values?.length) {
      const id = `${name}-list`;
      input.setAttribute('list', id);
      const list = h('datalist', { id });
      for (const v of values) list.append(h('option', { value: v, ...(labels ? { label: label(v) } : {}) }));
      const wrap = h('div', { class: 'fm-content fm-dropdown' }, input, list);
      input.classList.remove('fm-content');
      this.bindSave(input, value, save);
      return wrap;
    }
    this.bindSave(input, value, save);
    return input;
  }

  /**
   * A drop-down calendar: the browser's date picker opens when the field is clicked (or
   * from its icon), and the date picked goes into the field as the field shows dates.
   */
  private calendar(input: HTMLInputElement, value: string, type: string, icon: boolean, find: boolean, save: (v: string) => void): HTMLElement {
    const picker = h('input', { type: 'date', class: 'fm-calendar-picker', tabindex: '-1', 'aria-hidden': 'true' }) as HTMLInputElement;
    const wrap = h('div', { class: 'fm-content fm-calendar' }, input, picker);
    input.classList.remove('fm-content');
    const native = this.meta.fileMode === 'native';
    const open = () => {
      picker.value = isoDate(input.value.trim().split(native ? /[T\s]+/ : /\s+/)[0] ?? '') ?? '';
      try {
        picker.showPicker();
      } catch {
        // Not from a click (Tab into the field), or a browser without showPicker: the date is typed.
      }
    };
    if (icon) {
      const button = h('button', { type: 'button', class: 'fm-calendar-icon', tabindex: '-1', title: 'Calendar', 'aria-label': 'Calendar' });
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => {
        input.focus();
        open();
      });
      wrap.append(button);
    } else {
      input.addEventListener('click', open);
    }
    picker.addEventListener('change', () => {
      const iso = picker.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      input.focus();
      const picked = pickedDate(iso, input.value, type, native);
      input.value = picked.shown;
      if (find) save(input.value);
      else save(picked.saved);
    });
    this.bindSave(input, value, save);
    return wrap;
  }

  /**
   * Auto-complete using previously entered values: as a value is typed, the first
   * value in the field's index that starts with it is filled in after the cursor
   * (selected, so typing on replaces it), and the others are offered in a list.
   */
  private autoComplete(input: HTMLInputElement, lookup: (prefix: string) => Promise<string[]>): void {
    const list = h('datalist', { id: `ac-${Math.random().toString(36).slice(2, 9)}` });
    input.setAttribute('list', list.id);
    input.after(list);
    // The input may not be in a parent yet: attach the list once it is.
    queueMicrotask(() => list.isConnected || input.after(list));
    let asked = 0;
    input.addEventListener('input', (e) => {
      const typed = input.value;
      const inserting = (e as InputEvent).inputType?.startsWith('insert') && input.selectionEnd === typed.length;
      const n = ++asked;
      if (typed.trim() === '') {
        list.replaceChildren();
        return;
      }
      void lookup(typed).then((values) => {
        // Only the answer for what's typed now.
        if (n !== asked || input.value !== typed) return;
        list.replaceChildren(...values.filter((v) => v !== typed).map((v) => h('option', { value: v })));
        const first = values.find((v) => v.length > typed.length && v.toLowerCase().startsWith(typed.toLowerCase()));
        if (inserting && first && document.activeElement === input) {
          input.value = typed + first.slice(typed.length);
          input.setSelectionRange(typed.length, input.value.length);
        }
      }, () => undefined);
    });
  }

  private bindSave(input: HTMLInputElement | HTMLTextAreaElement, original: string, save: (v: string) => void): void {
    let last = original.replace(/\r\n?/g, '\n');
    // What the field showed before any typing: the window compares it with what's typed and with another user's change.
    input.dataset.shown = last;
    input.addEventListener('change', () => {
      // Drawn again with what's typed carried over to the new box, which saves it.
      if (input.value === last || input.dataset.replaced) return;
      last = input.dataset.shown = input.value;
      save(input.value.replace(/\n/g, '\r'));
    });
    // Enter commits a single-line field, as in FileMaker; Tab moves on.
    if (input instanceof HTMLInputElement) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }
  }

  private renderContainer(el: HTMLElement, url: string, key: string, host: Host, row: RowContext | undefined, size: { width: number; height: number; readOnly: boolean }): void {
    const box = h('div', { class: 'fm-content fm-container' });
    const editable = !!host.record && !size.readOnly && !newRow(host, row);
    const field = key.replace(/\(\d+\)$/, '');
    if (url) {
      const path = url.split('?')[0];
      const filename = decodeURIComponent(path.split('/').pop() ?? 'file');
      const kind = containerKind(path);
      box.dataset.kind = kind;
      // Pictures and PDFs show as thumbnails the server makes at the size drawn (sharp on high-density screens),
      // so a list of photos doesn't load every full-size picture; video and sound play in place.
      const thumb = () => thumbUrl(url, Math.max(size.width, size.height) * (globalThis.devicePixelRatio || 1));
      if (kind === 'image') {
        box.append(h('img', { src: /\.svg$/i.test(path) ? url : thumb(), alt: filename, draggable: 'false', loading: 'lazy', decoding: 'async' }));
      } else if (kind === 'video') {
        box.append(h('video', { src: url, controls: '', preload: 'metadata', playsinline: '', 'aria-label': filename }));
      } else if (kind === 'audio') {
        box.append(h('audio', { src: url, controls: '', preload: 'metadata', 'aria-label': filename }));
      } else if (kind === 'pdf') {
        const img = h('img', { src: thumb(), alt: filename, draggable: 'false', loading: 'lazy', decoding: 'async' });
        // No thumbnail (the server has no PDF renderer): the file's name instead.
        img.addEventListener('error', () => img.replaceWith(h('span', { class: 'fm-file' }, h('span', { class: 'fm-file-icon', 'aria-hidden': 'true' }, 'PDF'), h('span', { class: 'fm-file-name' }, filename))), { once: true });
        box.append(img, h('span', { class: 'fm-badge', 'aria-hidden': 'true' }, 'PDF'));
      } else {
        const ext = (/\.([a-z0-9]{1,5})$/i.exec(filename)?.[1] ?? 'file').toUpperCase();
        box.append(h('span', { class: 'fm-file' }, h('span', { class: 'fm-file-icon', 'aria-hidden': 'true' }, ext), h('span', { class: 'fm-file-name' }, filename)));
      }
      box.setAttribute('aria-label', `${field}: ${filename}`);
    } else {
      box.classList.add('fm-empty');
      box.setAttribute('aria-label', `${field}: empty`);
    }
    if (host.containerAction && (url || editable)) {
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-haspopup', 'menu');
      const open = () => host.containerAction!(key, url, box, editable, row);
      box.addEventListener('click', (e) => {
        // A video's or sound's own controls play it.
        if ((e.target as Element).closest('video, audio')) return;
        e.stopPropagation();
        open();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    }
    if (editable) {
      box.addEventListener('dragover', (e) => {
        e.preventDefault();
        box.classList.add('fm-drop');
      });
      box.addEventListener('dragleave', () => box.classList.remove('fm-drop'));
      box.addEventListener('drop', (e) => {
        e.preventDefault();
        box.classList.remove('fm-drop');
        const file = e.dataTransfer?.files[0];
        if (file) host.upload(key, file, row);
      });
      box.title = url ? 'Click for options, or drop a file here to replace it' : 'Click to insert a picture or file, or drop one here';
    } else if (url) {
      box.title = 'Click to open or download';
    }
    el.append(box);
  }

  private renderButton(el: HTMLElement, o: LayoutObject, host: Host, row?: RowContext): void {
    const btn = h('button', { class: 'fm-content fm-button-face', type: 'button' });
    const icon = o.icon && this.meta.images[o.icon.imageId];
    if (icon && o.icon) {
      const img = h('span', { class: 'fm-icon', 'aria-hidden': 'true' });
      img.style.setProperty('--fm-icon-url', `url("${icon}")`);
      // The object's own icon size (points) wins over the theme's relative default.
      img.style.width = img.style.height = o.icon.size ? `${o.icon.size}px` : 'var(--fm-icon-size, 1em)';
      btn.append(img);
      btn.classList.add(`fm-icon-${o.icon.display}`);
    }
    const label = o.label !== undefined
      ? (newRow(host, row) ? undefined : row?.row.recordId ? host.state?.rows?.[row.portal]?.[row.row.recordId]?.labels?.[o.id] : host.state?.labels?.[o.id])
      : o.text && this.mergeText(o.text, host, row);
    if (label && o.icon?.display !== 'icon') btn.append(h('span', { class: 'fm-label' }, label));
    if (o.action) btn.title = host.state?.tooltips[o.id] ?? (o.action.script ? `${o.action.step}: ${o.action.script}` : o.action.step);
    // An icon-only button is still named by its label (or tooltip, object name, or what it does).
    if (!btn.textContent?.trim()) {
      const name = label || host.state?.tooltips[o.id] || o.name || o.action?.script || o.action?.step;
      if (name) btn.setAttribute('aria-label', name);
    }
    // A popover button says it opens a dialog, and whether it is open (the window keeps that up to date).
    if (o.kind === 'popover-button') {
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      host.action(o, row);
    });
    el.append(btn);
  }

  /** A portal's rows; `stretch` is how much taller the window made it, which shows more rows (as FileMaker does), not taller ones. */
  private renderPortal(el: HTMLElement, o: LayoutObject, host: Host, stretch = 0): void {
    const p = o.portal!;
    const name = o.name ?? p.tableOccurrence ?? '';
    // By its own name first: two portals can show the same occurrence with different filters and sorts.
    const portal = this.meta.portals.find((x) => x.name === name) ?? this.meta.portals.find((x) => x.occurrence === p.tableOccurrence);
    // A portal on the layout's own occurrence lists the found set, with the current record's row marked.
    const foundSet = !!portal?.foundSet;
    // A portal without vertical scrolling shows its rows from the initial row, as many as fit;
    // so does every portal in Preview mode and on paper, where nothing scrolls.
    const rowHeight = Math.max(8, (o.bounds.bottom - o.bounds.top - 2) / Math.max(1, p.rows));
    const shown = portalRowsShown(p.rows, rowHeight, stretch, host.pageNumber !== undefined);
    // A found-set portal's rows not fetched yet are holes, filled as they scroll into view.
    const all: (PortalRow | undefined)[] = host.mode !== 'browse' ? [] : foundSet
      ? host.foundSetRows?.(portal!.name, Math.max(0, p.initialRow - 1) + shown) ?? host.record?.portalData[portal!.name] ?? []
      : host.record?.portalData[portal?.name ?? name] ?? [];
    const firstRow = p.scrolling && host.pageNumber === undefined ? 0 : Math.max(0, p.initialRow - 1);
    const rows = all.slice(firstRow, p.scrolling && host.pageNumber === undefined ? undefined : firstRow + shown);
    const inner = h('div', { class: 'fm-portal-rows' });
    const origin = { top: o.bounds.top + 1, left: o.bounds.left + 1, right: o.bounds.right - 1 };
    // FileMaker's empty last row, in Browse mode when the relationship allows creating related records: typing in it
    // adds one. A portal that doesn't scroll shows it only when there's room under its rows.
    const adding = host.mode === 'browse' && host.pageNumber === undefined && !!portal?.create && !foundSet && !!host.record && !host.offline
      && (p.scrolling || rows.length < shown);
    let count = host.mode === 'find' ? 1 : rows.length + (adding ? 1 : 0);
    // Portal Setup's "Use alternate row state" off: every row looks the same.
    const alternate = !o.style.rules?.some((x) => x.css['-fm-portal-alt-background'] === 'false');
    const drawRow = (i: number): void => {
      const r = rows[i];
      const rowEl = h('div', { class: `fm-portal-row${alternate && i % 2 ? ' fm-alt' : ''}` });
      rowEl.style.top = `${i * rowHeight}px`;
      rowEl.style.height = `${rowHeight}px`;
      // A found-set portal's row not fetched yet: an empty row of the right height, until it scrolls into view.
      if (!r && foundSet && i < rows.length) {
        inner.append(rowEl);
        return;
      }
      const ctx: RowContext | undefined = r ? { portal: portal?.name ?? name, row: r, number: firstRow + i + 1 } : host.mode === 'find' || adding ? { portal: portal?.name ?? name, row: { recordId: '', modId: '' } as PortalRow, occurrence: portal?.occurrence } : undefined;
      if (!r && adding) rowEl.classList.add('fm-portal-new');
      if (r) {
        rowEl.dataset.row = r.recordId;
        rowEl.dataset.portalName = ctx!.portal;
      }
      // Delete Record deletes the related record when the cursor is in a row of a portal that allows it.
      if (r && p.allowDelete && !foundSet) rowEl.dataset.portal = ctx!.portal;
      for (const c of o.children ?? []) {
        const node = this.renderObject(c, host, origin, ctx);
        if (node) rowEl.append(node);
      }
      if (r && foundSet) {
        // A found-set portal's row is a record of the found set: the current one is marked, clicking another goes to it.
        // Its fields are changed on the record itself, so here they only show.
        const current = r.recordId === host.record?.recordId;
        rowEl.classList.add('fm-found-row');
        if (current) {
          rowEl.classList.add('fm-portal-current');
          rowEl.setAttribute('aria-current', 'true');
        }
        for (const box of rowEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')) {
          if ('readOnly' in box && !(box instanceof HTMLSelectElement)) box.readOnly = true;
          else box.disabled = true;
          box.tabIndex = -1;
        }
        if (!current && host.goToRecordId && host.pageNumber === undefined) {
          rowEl.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button, a')) return;
            e.preventDefault();
            host.goToRecordId!(r.recordId);
          });
        }
      }
      inner.append(rowEl);
    };
    for (let i = 0; i < count; i++) drawRow(i);
    inner.style.height = `${Math.max(count, shown) * rowHeight}px`;
    // The rest of a long related list: the record came with 50 rows; the others are fetched once the portal is drawn
    // and added under them, before the empty last row.
    const info = !foundSet && p.scrolling && host.mode === 'browse' && host.pageNumber === undefined ? host.record?.portalDataInfo?.find((x) => x.portalObjectName === portal?.name) : undefined;
    if (info && host.record && host.morePortalRows && info.foundCount > rows.length) {
      void host.morePortalRows(portal!.name, host.record, rows.length, info.foundCount).then((more) => {
        if (!more.length || !inner.isConnected) return;
        inner.querySelector('.fm-portal-new')?.remove();
        const from = rows.length;
        rows.push(...more);
        count = rows.length + (adding ? 1 : 0);
        for (let i = from; i < count; i++) drawRow(i);
        inner.style.height = `${Math.max(count, shown) * rowHeight}px`;
      });
    }
    if (foundSet && p.scrolling && host.pageNumber === undefined && host.foundSetScrolled) {
      // Rows load as they scroll into view; the portal stays where it was scrolled to when the layout is drawn again.
      const seen = () => host.foundSetScrolled!(portal!.name, inner.scrollTop, Math.floor(inner.scrollTop / rowHeight), Math.ceil((inner.scrollTop + inner.clientHeight) / rowHeight));
      inner.addEventListener('scroll', seen, { passive: true });
      const top = host.foundSetScrollTop?.(portal!.name) ?? 0;
      if (top) requestAnimationFrame(() => {
        inner.scrollTop = top;
        seen();
      });
    }
    if (!p.scrolling) inner.classList.add('fm-no-scroll');
    else if (p.scrollBarWhenScrolling) {
      // The scroll bar shows only while the rows are scrolling.
      inner.classList.add('fm-scroll-quiet');
      let timer: ReturnType<typeof setTimeout> | undefined;
      inner.addEventListener('scroll', () => {
        inner.classList.add('fm-scrolling');
        clearTimeout(timer);
        timer = setTimeout(() => inner.classList.remove('fm-scrolling'), 800);
      });
    }
    el.append(inner);
  }

  /** Tab controls and slide controls: show one panel at a time. */
  private renderPanels(el: HTMLElement, o: LayoutObject, host: Host, row?: RowContext, stretch = 0): void {
    const panels = (o.children ?? []).filter((c) => c.kind === 'tab-panel' || c.kind === 'slide-panel');
    if (!panels.length) return;
    const chosen = host.panels.get(o.id) ?? (o.target && panels.some((p) => p.id === o.target) ? o.target : panels[0].id);
    const tabs = o.kind === 'tab-control';
    const strip = h('div', { class: tabs ? 'fm-tabs' : 'fm-dots' });
    if (tabs) strip.setAttribute('role', 'tablist');
    const tabId = (p: LayoutObject) => `fm-tab-${o.id}-${p.id}`;
    const TAB_HEIGHT = o.tabHeight ?? 24;
    if (tabs) {
      strip.style.height = `${TAB_HEIGHT}px`;
      strip.style.justifyContent = tabJustify(panels, o.bounds.right - o.bounds.left) ?? '';
    }
    let current = Math.max(0, panels.findIndex((p) => p.id === chosen));
    const show = async (i: number): Promise<void> => {
      const p = panels[i];
      // OnPanelSwitch may cancel, or redraw the layout with the panel in front.
      if (host.switchPanel && !(await host.switchPanel(o, p))) return;
      host.panels.set(o.id, p.id);
      current = i;
      const content = el.querySelectorAll<HTMLElement>(':scope > .fm-panel');
      content.forEach((c) => (c.hidden = c.dataset.panel !== String(p.id)));
      strip.querySelectorAll('.fm-tab, .fm-dot').forEach((t, k) => {
        t.classList.toggle('fm-checked', k === i);
        // A tab says it is selected and is the one in the tab order; a slide dot is a pressed button.
        if (tabs) { t.setAttribute('aria-selected', String(k === i)); t.setAttribute('tabindex', k === i ? '0' : '-1'); }
        else t.setAttribute('aria-pressed', String(k === i));
      });
    };
    // Slide controls also change panels with a sideways swipe, as on FileMaker Go, unless swipes are turned off.
    if (!tabs && !o.noSwipe) {
      el.dataset.swipes = '';
      let start: { x: number; y: number } | undefined;
      el.addEventListener('pointerdown', (e) => {
        // The innermost slide control takes the swipe.
        const claimed = e as PointerEvent & { fmSlide?: boolean };
        if (e.pointerType === 'mouse' || claimed.fmSlide) return;
        claimed.fmSlide = true;
        start = { x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointerup', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        start = undefined;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const next = current + (dx < 0 ? 1 : -1);
        if (next >= 0 && next < panels.length) void show(next);
      });
      el.addEventListener('pointercancel', () => (start = undefined));
    }
    panels.forEach((p, i) => {
      const tab = h('button', { type: 'button', class: `fm e${p.style.element ?? 82} ${tabs ? 'fm-tab' : 'fm-dot'}${p.id === chosen ? ' fm-checked' : ''}` }, tabs ? p.text ?? '' : '');
      // Which tab or slide is in front, said as well as drawn; a dot is named by its panel.
      if (tabs) {
        tab.id = tabId(p);
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(p.id === chosen));
        tab.setAttribute('tabindex', p.id === chosen ? '0' : '-1');
        // Arrow keys, Home and End move between tabs and bring the one reached to the front.
        tab.addEventListener('keydown', (e) => {
          const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % panels.length
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + panels.length - 1) % panels.length
            : e.key === 'Home' ? 0 : e.key === 'End' ? panels.length - 1 : -1;
          if (to < 0) return;
          e.preventDefault();
          void show(to).then(() => strip.querySelectorAll<HTMLElement>('.fm-tab')[to]?.focus());
        });
      } else {
        tab.setAttribute('aria-pressed', String(p.id === chosen));
        tab.setAttribute('aria-label', p.name || `Slide ${i + 1} of ${panels.length}`);
      }
      if (tabs) {
        tab.style.height = `${TAB_HEIGHT}px`;
        if (p.tab?.width) tab.style.width = `${p.tab.width}px`;
        // Tabs overlap or space out as the file lays them out.
        const next = panels[i + 1]?.tab;
        if (p.tab?.width && next) tab.style.marginRight = `${next.left - p.tab.left - p.tab.width}px`;
        if (i === 0 && p.tab && !strip.style.justifyContent) tab.style.marginLeft = `${p.tab.left}px`;
      }
      tab.addEventListener('click', () => void show(i));
      strip.append(tab);
      // Panel contents are positioned on the layout: draw them in a layer at the control's origin.
      const layer = h('div', { class: 'fm-panel', 'data-panel': String(p.id) });
      if (tabs) layer.style.setProperty('--fm-tab-height', `${TAB_HEIGHT}px`);
      layer.hidden = p.id !== chosen;
      if (tabs) { layer.setAttribute('role', 'tabpanel'); layer.setAttribute('aria-labelledby', tabId(p)); }
      const box = h('div', { class: 'fm-panel-box' });
      this.sheet.apply(box, p.style, p.style.element ?? (tabs ? 82 : 92), `o${p.id}`);
      // The tab takes the panel's theme style too: its borders, and its own tab part.
      if (tabs) for (const c of box.classList) if (c !== 'fm-panel-box') tab.classList.add(c);
      if (tabs) box.style.top = `${TAB_HEIGHT}px`;
      layer.append(box);
      for (const c of p.children ?? []) {
        const node = this.renderObject(c, host, { top: o.bounds.top, left: o.bounds.left, right: o.bounds.right }, row, stretch);
        if (node) layer.append(node);
      }
      el.append(layer);
    });
    // Slide controls can hide their navigation dots: they are still there for the keyboard and screen readers,
    // and show while one has the focus, so the slides can be changed without swiping.
    if (!tabs && o.noDots) strip.classList.add('fm-dots-hidden');
    el.prepend(strip);
  }

  /** A popover, drawn on demand at its layout position. */
  renderPopover(id: number, host: Host, partTop: number): HTMLElement | undefined {
    const find = (os: LayoutObject[]): LayoutObject | undefined => {
      for (const o of os) {
        if (o.id === id) return o;
        const c = o.children && find(o.children);
        if (c) return c;
      }
      return undefined;
    };
    const pop = find(this.meta.design.objects);
    if (!pop) return undefined;
    const el = h('div', { class: 'fm fm-popover-open' });
    const b = pop.bounds;
    Object.assign(el.style, { top: `${b.top - partTop}px`, left: `${b.left}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px` });
    this.sheet.apply(el, pop.style, elementOf(pop), `o${pop.id}`);
    // The title bar sits on top of the popover's content area.
    if (pop.titleBar) el.append(h('div', { class: 'fm-popover-title' }, host.state?.labels?.[pop.id] ?? pop.text ?? 'Popover'));
    for (const c of pop.children ?? []) {
      const node = this.renderObject(c, host, { top: b.top, left: b.left, right: b.right });
      if (node) el.append(node);
    }
    return el;
  }

  /** The part that holds an object (for placing its popover). */
  partOf(id: number): LayoutPart | undefined {
    for (const [part, objs] of this.byPart) {
      const has = (os: LayoutObject[]): boolean => os.some((o) => o.id === id || (o.children ? has(o.children) : false));
      if (has(objs)) return part;
    }
    return undefined;
  }
}

/**
 * How a tab strip is justified, from where the file puts its tabs: centered
 * when the space before the first tab matches the space after the last,
 * right when the last tab ends at the control's edge. Undefined: left, from
 * the first tab's offset.
 */
/**
 * A web viewer's content. Nothing is loaded from the network: the hosting
 * rules keep solutions offline unless someone opts in. A data:text/html
 * address (HTML a solution builds from its fields) shows in a sandboxed
 * frame whose content security policy blocks every request; data: images
 * show as images; any other address shows as text.
 */
/**
 * Whether a web viewer is drawn empty. In Browse mode one with no address yet (a script sets one) is blank, as in
 * FileMaker; in Find mode it shows its page only when Web Viewer Setup's "Display content in Find mode" is on.
 */
export function webViewerBlank(options: LayoutObject['webOptions'], mode: string, address: string | undefined, hasState: boolean): boolean {
  if (mode === 'find') return options?.findMode !== true || address === undefined;
  return address === undefined && mode === 'browse' && hasState;
}

/** What Web Viewer Setup asks to draw under a page that is loading: the options default to on. */
export function webViewerChrome(options: LayoutObject['webOptions']): { progress: boolean; status: boolean } | undefined {
  const progress = options?.progressBar !== false;
  const status = options?.statusMessages !== false;
  return progress || status ? { progress, status } : undefined;
}

export function webViewer(url: string | undefined, bridge = false): HTMLElement {
  const html = url !== undefined ? dataHtml(url) : undefined;
  if (html !== undefined) {
    // No allow-same-origin: the page can't reach the app, its cookies or the session.
    const frame = h('iframe', { class: 'fm-content fm-webviewer', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', title: 'Web viewer' });
    frame.dataset.viewerDocument = crypto.randomUUID();
    frame.dataset.viewerAddress = url;
    // "Allow JavaScript to perform FileMaker scripts": the page gets FileMaker.PerformScript and Tabularius's data calls,
    // each asked of the window by message and answered as the signed-in account.
    if (bridge) frame.dataset.bridge = '1';
    frame.srcdoc = pageCsp(bridge) + webViewerBridge(location.origin, frame.dataset.viewerDocument) + (bridge ? PAGE_API : '') + html;
    frame.addEventListener('load', () => {
      if (frame.dataset.loaded === '1') frame.dataset.viewerDocument = crypto.randomUUID();
      frame.dataset.loaded = '1';
    });
    return frame;
  }
  if (url && /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(url)) return h('img', { class: 'fm-content fm-webviewer', src: url, alt: '' });
  const box = h('div', { class: 'fm-content fm-placeholder fm-webviewer-off' }, 'Web viewer');
  if (url) {
    box.title = url;
    box.append(h('small', {}, ' (not loaded: hosted files stay offline)'));
  }
  return box;
}

/**
 * What a web viewer page with "Allow JavaScript to perform FileMaker scripts" on can call. FileMaker.PerformScript and
 * PerformScriptWithOption are FileMaker Pro's own; window.tabularius reads and changes records, as the signed-in account,
 * so a page (a modern layout) needs no HTML built in calculations. Each call returns a promise.
 */
const PAGE_API = `<script>(function(){var n=0,w={},ls={},tag=Math.random().toString(36).slice(2)+'.';function ask(m,a){return new Promise(function(ok,no){var id=tag+(++n);w[id]={ok:ok,no:no};parent.postMessage({tabularius:'ask',id:id,method:m,args:a},'*')})}` +
  `addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d)return;if(d.tabularius==='answer'&&w[d.id]){var p=w[d.id];delete w[d.id];d.error!==undefined?p.no(new Error(d.error)):p.ok(d.value)}` +
  `else if(d.tabularius==='event'){(ls[d.name]||[]).forEach(function(f){try{f(d.value)}catch(x){console.error(x)}})}});` +
  `window.FileMaker={PerformScript:function(s,p){ask('performScript',[String(s),p==null?'':String(p),0]);},PerformScriptWithOption:function(s,p,o){ask('performScript',[String(s),p==null?'':String(p),Number(o)||0]);}};` +
  `window.tabularius={context:function(){return ask('context',[])},records:function(l,o){return ask('records',[l,o||{}])},find:function(l,q,o){return ask('find',[l,q,o||{}])},` +
  `record:function(l,id){return ask('record',[l,String(id)])},create:function(l,f){return ask('create',[l,f||{}])},update:function(l,id,f){return ask('update',[l,String(id),f||{}])},` +
  `layouts:function(){return ask('layouts',[])},goToLayout:function(n){return ask('goToLayout',[String(n)])},remove:function(l,id){return ask('remove',[l,String(id)])},summarize:function(w){return ask('summarize',[w])},valueList:function(n){return ask('valueList',[String(n)])},performScript:function(s,p){return ask('performScript',[String(s),p==null?'':String(p),0])},print:function(){return ask('print',[])},` +
  `image:function(u,n){u=String(u||'');if(u.indexOf('/tabularius/containers/')<0)return '';if(n===undefined)return u;n=Math.min(1024,Math.max(16,Math.round(Number(n))||16));var q=u.indexOf('?')<0?'?':'&';return u.split('&thumb=')[0].split('?thumb=')[0]+q+'thumb='+n},` +
  `on:function(name,f){(ls[name]=ls[name]||[]).push(f)}};window.openhbam=window.tabularius;})();</script>`;

/** A page's call to the window: which web viewer (its object id) asked, the method and its arguments. */
export type PageCall = (objectId: number, method: string, args: unknown[]) => Promise<unknown>;

let pageCall: PageCall | undefined;

/**
 * Answers calls from web viewer pages that have the bridge (see PAGE_API). Only frames this client drew with the bridge
 * on are listened to; anything else posting to the window is ignored.
 */
export function answerPageCalls(handler: PageCall): void {
  const first = !pageCall;
  pageCall = handler;
  if (!first) return;
  addEventListener('message', (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.tabularius !== 'ask' || typeof d.method !== 'string' || !Array.isArray(d.args)) return;
    const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe.fm-webviewer[data-bridge="1"]')].find((f) => f.contentWindow === e.source);
    const objectId = Number(frame?.closest<HTMLElement>('.fm[data-id]')?.dataset.id);
    if (!frame || !Number.isFinite(objectId)) return;
    const reply = (msg: { value?: unknown; error?: string }) => frame.contentWindow?.postMessage({ tabularius: 'answer', id: d.id, ...msg }, '*');
    pageCall!(objectId, d.method, d.args).then(
      (value) => reply({ value: sameOriginContainers(value) }),
      (err: unknown) => reply({ error: err instanceof Error ? err.message : String(err) }),
    );
  });
}

/** Tells every bridged page in `scope` that something happened (tabularius.on(name, fn) in the page). */
export function tellPages(scope: ParentNode, name: string, value?: unknown): void {
  for (const f of scope.querySelectorAll<HTMLIFrameElement>('iframe.fm-webviewer[data-bridge="1"]')) f.contentWindow?.postMessage({ tabularius: 'event', name, value }, '*');
}

/** Calls a global function of a web viewer's page, once the page has loaded (Perform JavaScript in Web Viewer). */
export async function callWebViewer(frame: HTMLIFrameElement, fn: string, args: string[]): Promise<void> {
  if (frame.dataset.loaded !== '1') {
    await new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 5000);
    });
  }
  const id = crypto.randomUUID();
  const documentId = frame.dataset.viewerDocument;
  const source = frame.contentWindow;
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); window.removeEventListener('message', answered); resolve(); };
    const answered = (e: MessageEvent) => { if (viewerMessage(e, frame) && e.source === source && frame.dataset.viewerDocument === documentId && e.data?.tabularius === 'called' && e.data.id === id) finish(); };
    const timer = setTimeout(finish, 5000);
    window.addEventListener('message', answered);
    frame.contentWindow?.postMessage({ tabularius: 'call', fn, args, id, documentId }, '*');
  });
}

const CSP = (img: string) => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src ${img}; font-src data:; media-src data: blob:">`;

/**
 * Every request from web viewer content is refused; inline scripts, styles, data: images and fonts still work. A page
 * with the bridge may also show pictures from this server's container URLs (and nothing else): those are the signed,
 * expiring links the server gives with a record's container fields, so it can show only what the account may read.
 */
function pageCsp(bridge: boolean): string {
  return CSP(bridge ? `data: blob: ${location.origin}/tabularius/containers/` : 'data: blob:');
}

const CONTAINER_URL = /^https?:\/\/[^/?#\s]+(\/tabularius\/containers\/[^\s]*)$/;

/**
 * A value from a page call with each container URL in it (the links the server puts in container fields) pointed at
 * the address this window was opened from, which the page's image policy allows. The server writes the address it
 * knows itself by (a public address, or localhost), which can differ from the one in use.
 */
export function sameOriginContainers<T>(value: T, origin = location.origin): T {
  if (typeof value === 'string') return (CONTAINER_URL.test(value) ? value.replace(CONTAINER_URL, origin + '$1') : value) as T;
  if (Array.isArray(value)) return value.map((v) => sameOriginContainers(v, origin)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sameOriginContainers(v, origin)])) as T;
  return value;
}

/** The HTML of a data:text/html address (base64 or percent-encoded), or undefined for any other address. */
export function dataHtml(url: string): string | undefined {
  const m = /^data:text\/html((?:;[^,;]*)*?)(;base64)?,(.*)$/is.exec(url.trim());
  if (!m) return undefined;
  try {
    if (m[2]) return new TextDecoder().decode(Uint8Array.from(atob(m[3].replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
    return decodeURIComponent(m[3]);
  } catch {
    return m[2] ? undefined : m[3];
  }
}

export function tabJustify(panels: { tab?: { left: number; width: number } }[], width: number): 'center' | 'flex-end' | undefined {
  const first = panels[0]?.tab;
  const last = panels[panels.length - 1]?.tab;
  if (!first || !last || !last.width || first.left <= 0) return undefined;
  const trail = width - last.left - last.width;
  if (Math.abs(first.left - trail) <= 4) return 'center';
  if (trail <= 2) return 'flex-end';
  return undefined;
}

/**
 * FileMaker's "Other…" dialog: a value that isn't in the value list (several,
 * one per line, for checkboxes). Undefined when cancelled.
 */
function otherDialog(current: string, several: boolean): Promise<string | undefined> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'replace-dialog other-dialog', 'aria-label': 'Other' }) as HTMLDialogElement;
    const box = (several ? h('textarea', { rows: '4', 'aria-label': 'Other value' }) : h('input', { type: 'text', 'aria-label': 'Other value' })) as HTMLInputElement | HTMLTextAreaElement;
    box.value = current;
    let result: string | undefined;
    const ok = () => {
      result = box.value;
      dialog.close();
    };
    box.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && !several) {
        e.preventDefault();
        ok();
      }
    });
    const cancel = h('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', () => dialog.close());
    const okButton = h('button', { type: 'button', class: 'primary' }, 'OK');
    okButton.addEventListener('click', ok);
    dialog.append(
      h('h2', {}, 'Other'),
      h('p', {}, several ? 'Values not in the list, one per line:' : 'A value not in the list:'),
      box,
      h('div', { class: 'actions' }, h('span', { class: 'spacer' }), cancel, okButton),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    box.select();
  });
}

/** The four-digit year for a two-digit one: within the next 30 years or the preceding 70 (as the server reads it). */
const fullYear = (y: number, nowYear: number) => y + Math.floor((nowYear + 30 - y) / 100) * 100;

/** "2026-10-12" from a date as the web client shows dates ("10/12/2026"), or undefined when it isn't one. */
/**
 * A date picked in the drop-down calendar (`iso`, from the date input) as the field shows it and as it is saved,
 * keeping the time of a timestamp. Compat files show MM/DD/YYYY and save ISO, which reads the same whatever the
 * file's date order is; native files show and save ISO 8601, in Browse and Find mode alike.
 */
export function pickedDate(iso: string, current: string, type: string, native = false): { shown: string; saved: string } {
  if (native) {
    const time = type === 'timestamp' ? current.trim().split(/[T\s]+/)[1] ?? '00:00:00' : undefined;
    const text = time ? `${iso}T${time}` : iso;
    return { shown: text, saved: text };
  }
  const time = type === 'timestamp' ? current.trim().split(/\s+/)[1] ?? '0:00:00' : undefined;
  const [y, m, d] = iso.split('-');
  return { shown: `${m}/${d}/${y}${time ? ` ${time}` : ''}`, saved: time ? `${iso}T${time}` : iso };
}

export function isoDate(text: string, nowYear = new Date().getFullYear()): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/.exec(text.trim()) ?? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return undefined;
  let [y, mo, d] = m[1].length === 4 ? [+m[1], +m[2], +m[3]] : [+m[3], +m[1], +m[2]];
  if (m[1].length !== 4 && m[3].length <= 2) y = fullYear(y, nowYear);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

type Runs = NonNullable<DataRecord['styles']>[string];

/** A field's formatting as shown: the text it was drawn for and its runs, to follow edits made while it was entered. */
const styledState = new WeakMap<HTMLElement, { text: string; runs: Runs; shown: HTMLElement }>();

function overlayFor(input: HTMLInputElement | HTMLTextAreaElement, runs: Runs): HTMLElement {
  // The spans sit in one inline box: a flex container would drop text between them that is only spaces.
  const line = h('span', { class: 'fm-styled-line' }, ...styledNodes(input.value, runs));
  return h('div', { class: `fm-styled${input instanceof HTMLTextAreaElement ? ' fm-styled-wrap' : ''}`, 'aria-hidden': 'true' }, line);
}

/**
 * Shows formatted text over a field, the field's own text taking over while it has the cursor. When it is left
 * changed (and not drawn again), the formatting follows the edit, as the server keeps it.
 */
function styledOverlay(input: HTMLInputElement | HTMLTextAreaElement, runs: Runs): HTMLElement {
  const shown = overlayFor(input, runs);
  styledState.set(input, { text: input.value, runs, shown });
  input.classList.add('fm-styled-input');
  input.addEventListener('blur', () => {
    const st = styledState.get(input);
    if (!st || st.text === input.value) return;
    const next = editRuns(st.runs, st.text, input.value);
    const fresh = overlayFor(input, next);
    fresh.style.cssText = st.shown.style.cssText;
    st.shown.replaceWith(fresh);
    styledState.set(input, { text: input.value, runs: next, shown: fresh });
  });
  return shown;
}

/**
 * Shows a field's new formatting while it keeps the cursor (just after a Format menu command), until the next
 * keystroke or click in it, when its plain text comes back for editing.
 */
export function previewStyled(input: HTMLInputElement | HTMLTextAreaElement, runs: Runs): void {
  const host = input.parentElement;
  if (!host) return;
  const was = styledState.get(input);
  const shown = was ? overlayFor(input, runs) : styledOverlay(input, runs);
  if (was) {
    shown.style.cssText = was.shown.style.cssText;
    was.shown.replaceWith(shown);
    styledState.set(input, { text: input.value, runs, shown });
  } else {
    // A field not drawn with formatting: laid over it where it is (moving the field would take its cursor away).
    Object.assign(shown.style, { inset: 'auto', left: `${input.offsetLeft}px`, top: `${input.offsetTop}px`, width: `${input.offsetWidth}px`, height: `${input.offsetHeight}px` });
    host.classList.add('fm-styled-host');
    host.append(shown);
  }
  host.classList.add('fm-styled-preview');
  const end = () => {
    host.classList.remove('fm-styled-preview');
    for (const t of ['keydown', 'mousedown', 'blur'] as const) input.removeEventListener(t, end);
  };
  for (const t of ['keydown', 'mousedown', 'blur'] as const) input.addEventListener(t, end);
}

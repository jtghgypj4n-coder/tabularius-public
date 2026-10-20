// Offline, script-session scoped first slice of the MBS DynaPDF API.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asNumber, asText, num, text, type Value } from '../../calc/src/index.ts';
import { pdf, wrap, type FontName, type PdfOp, type PdfPage, type Rgb } from './pdf.ts';
import { PDF_IMPORT_LIMITS, readPdfImport, type PdfImportedPage } from '../../calc/src/pdf-text.ts';

const MAX_HANDLES = 32;
const MAX_PAGES = 500;
const MAX_OBJECTS = 10_000;
const states = new WeakMap<object, State>();

interface State { initialized: boolean; next: number; handles: Map<string, Doc> }
interface Doc {
  pages: PdfPage[]; current?: PdfPage; width: number; height: number; coords: 'topdown' | 'bottomup';
  font: FontName; size: number; underline: boolean; fill: Rgb; rect?: { x: number; y: number; w: number; h: number };
  metadata: Record<string, string>; objects: number; released: boolean;
  importing?: PdfImportedPage[];
  cropBox?: number[];
}

const t = (v: Value | undefined) => v === undefined ? '' : asText(v);
const n = (v: Value | undefined) => v === undefined ? 0 : asNumber(v);
const error = (s: string) => text(`[MBS] ERROR: ${s}`);
const ok = () => text('OK');
const docOf = (s: State, v: Value | undefined) => s.handles.get(t(v));
const rgb = (v: number[]): Rgb => [0, 1, 2].map((i) => Math.max(0, Math.min(255, v[i] ?? 0))) as Rgb;

/** Account for retained sources once, even when pages are imported repeatedly. Check before committing state. */
function fitsImports(state: State, target: Doc, pages: PdfPage[], importing = target.importing): boolean {
  const sessionSources = new Set<PdfImportedPage['source']>();
  for (const d of state.handles.values()) {
    const ownPages = d === target ? pages : d.pages;
    const source = d === target ? importing : d.importing;
    const sources = new Set([...ownPages.flatMap(p => p.imported ? [p.imported.source] : []), ...(source?.length ? [source[0].source] : [])]);
    let bytes = 0, objects = 0;
    for (const s of sources) { bytes += s.bytes; objects += s.objects; sessionSources.add(s); }
    if (bytes > PDF_IMPORT_LIMITS.bytes || (sources.size && objects + d.objects + ownPages.length * 4 + 15 > MAX_OBJECTS)) return false;
  }
  return [...sessionSources].reduce((n, s) => n + s.bytes, 0) <= 64 * 1024 * 1024;
}

function font(name: string, style: number): FontName | undefined {
  const raw = name.trim().toLowerCase().replace(/\s+/g, '-');
  const family = raw === 'arial' || raw === 'sans' || raw === 'sans-serif' ? 'Helvetica'
    : raw === 'times' || raw === 'times-new-roman' ? 'Times-Roman'
      : raw === 'courier-new' ? 'Courier' : name;
  const base = (['Helvetica', 'Times-Roman', 'Courier'].includes(family) ? family : undefined) as FontName | undefined;
  if (!base) return undefined;
  const bold = (style & 2) !== 0, italic = (style & 1) !== 0;
  if (base === 'Times-Roman') return (bold ? italic ? 'Times-BoldItalic' : 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman');
  const stem = base === 'Courier' ? 'Courier' : 'Helvetica';
  return `${stem}${bold && italic ? (stem === 'Helvetica' ? '-BoldOblique' : '-BoldOblique') : bold ? '-Bold' : italic ? (stem === 'Helvetica' ? '-Oblique' : '-Oblique') : ''}` as FontName;
}

function textOps(d: Doc, raw: string, align: string, rect: { x: number; y: number; w: number; h: number }, markup = true): PdfOp[] {
  const allowed = ['\\le#', '\\re#', '\\ce#'];
  let current = ['right', 'center'].includes(align.toLowerCase()) ? align.toLowerCase() : 'left';
  const chunks: { text: string; align: 'left' | 'right' | 'center' }[] = [];
  let pending = '';
  if (!markup) chunks.push({ text: raw, align: current === 'right' || current === 'center' ? current : 'left' });
  for (let i = 0; markup && i < raw.length;) {
    if (raw[i] === '\\') {
      const tag = allowed.find((x) => raw.startsWith(x, i));
      if (!tag) return [];
      if (pending) chunks.push({ text: pending, align: current === 'right' || current === 'center' ? current : 'left' });
      pending = '';
      current = tag === '\\re#' ? 'right' : tag === '\\ce#' ? 'center' : 'left';
      i += tag.length;
      continue;
    }
    pending += raw[i++];
  }
  if (pending) chunks.push({ text: pending, align: current === 'right' || current === 'center' ? current : 'left' });
  const out: PdfOp[] = [];
  const lines = chunks.flatMap((chunk) => wrap(chunk.text, d.size, rect.w, d.font).map((line) => ({ line, align: chunk.align })));
  const lineHeight = d.size * 1.2;
  let y = rect.y;
  for (const { line, align: a } of lines) {
    if (y + lineHeight > rect.y + rect.h) break;
    out.push({ kind: 'text', text: line, left: rect.x, top: y, width: rect.w, height: lineHeight, style: { font: d.font, size: d.size, color: d.fill, align: a, underline: d.underline } });
    y += lineHeight;
  }
  return out;
}

/** Called by the calculation evaluator for DynaPDF functions. Undefined leaves the regular MBS missing result in place. */
export function dynapdfCall(name: string, args: Value[], session: object, documents?: string, write?: (path: string, bytes: Uint8Array) => boolean): Value | undefined {
  const f = name.toLowerCase();
  if (!f.startsWith('dynapdf.')) return undefined;
  let s = states.get(session);
  if (!s) { s = { initialized: false, next: 20_000, handles: new Map() }; states.set(session, s); }
  const a = (i: number) => args[i];
  const handle = () => docOf(s!, a(0));
  // The public pages do not specify exact error strings for these cases. Use the existing missing result.
  const missing = () => error(`${name} is not available in Tabularius`);
  try {
    if (f === 'dynapdf.initialize') { s.initialized = true; return ok(); }
    if (f === 'dynapdf.isinitialized') return num(s.initialized ? 1 : 0);
    if (f === 'dynapdf.new') {
      if (!s.initialized) return error('DynaPDF.Initialize must be called before DynaPDF.New');
      if (s.handles.size >= MAX_HANDLES) return error('DynaPDF handle limit reached');
      const id = String(s.next++);
      s.handles.set(id, { pages: [], width: 595, height: 842, coords: 'bottomup', font: 'Helvetica', size: 12, underline: false, fill: [0, 0, 0], metadata: {}, objects: 0, released: false });
      return num(Number(id));
    }
    if (f === 'dynapdf.release') {
      const d = handle(); if (!d) return text('?');
      s.handles.delete(t(a(0))); d.released = true; return ok();
    }
    if (f === 'dynapdf.renderpage') return error('DynaPDF.RenderPage is not available in Tabularius');
    const d = handle();
    if (!d) return text('?');
    const add = (ops: PdfOp[]) => {
      if (!d.current) return error('DynaPDF.AppendPage must be called before drawing');
      if (d.objects + ops.length > MAX_OBJECTS) return error('DynaPDF object limit reached');
      d.objects += ops.length;
      if (!fitsImports(s, d, d.pages)) { d.objects -= ops.length; return missing(); }
      d.current.ops.push(...ops); return ok();
    };
    if (f === 'dynapdf.openpdffromcontainer') {
      const input = a(1);
      if (args.length < 2 || args.length > 4 || input?.type !== 'container' || !input.data || (a(2) !== undefined && ![0, 1].includes(n(a(2)))) || t(a(3))) return missing();
      const importing = readPdfImport(input.data);
      if (!importing || !fitsImports(s, d, d.pages, importing)) return missing();
      d.importing = importing;
      return num(0);
    }
    if (f === 'dynapdf.closeimportfile') { if (args.length !== 1) return missing(); d.importing = undefined; return ok(); }
    if (f === 'dynapdf.getimportpagecount') return args.length === 1 && d.importing ? num(d.importing.length) : missing();
    if (f === 'dynapdf.setimportflags') {
      if (args.length !== 2) return missing();
      const value = t(a(1)).trim();
      const flags = new Set(value.toLowerCase().split(/[\s¶]+/));
      // ImportAll | ImportAsPage is the documented MBS default; other flag behaviours are a follow-up.
      return Number(value) === 2415919102 || (flags.size === 2 && flags.has('importall') && flags.has('importaspage')) ? ok() : missing();
    }
    if (f === 'dynapdf.importpdffile' || f === 'dynapdf.importpdfpage') {
      const all = f === 'dynapdf.importpdffile';
      if (!d.importing || args.length > 4 || (!all && args.length < 2) || args.slice(2).some(v => n(v) !== 1)) return missing();
      const index = a(1) === undefined ? 1 : n(a(1));
      if (!Number.isInteger(index) || index < 1 || (all ? index !== d.pages.length + 1 : index > d.importing.length)) return missing();
      const chosen = all ? d.importing : [d.importing[index - 1]];
      if (d.pages.length + chosen.length > MAX_PAGES) return missing();
      const pages = [...d.pages, ...chosen.map(imported => ({ width: imported.width, height: imported.height, cropBox: imported.cropBox, ops: [], imported }))];
      if (!fitsImports(s, d, pages)) return missing();
      // Materialize in a temporary output to catch copy/serialization limits before changing the working PDF.
      if (pdf(pages, d.metadata).length > PDF_IMPORT_LIMITS.bytes) return missing();
      d.pages = pages; d.current = undefined;
      d.width = pages.at(-1)!.width; d.height = pages.at(-1)!.height;
      d.cropBox = pages.at(-1)!.cropBox;
      return all ? num(pages.length) : ok();
    }
    if (f === 'dynapdf.editpage') {
      const index = n(a(1));
      if (args.length !== 2 || d.current || !Number.isInteger(index) || index < 1 || index > MAX_PAGES) return missing();
      const pages = [...d.pages];
      while (pages.length < index) pages.push({ width: d.width, height: d.height, cropBox: d.cropBox, ops: [] });
      if (!fitsImports(s, d, pages)) return missing();
      d.pages = pages; d.current = pages[index - 1];
      d.width = d.current.width; d.height = d.current.height;
      d.cropBox = d.current.cropBox;
      return ok();
    }
    if (f === 'dynapdf.appendpage') {
      if (args.length > 2 || (a(1) !== undefined && ![0, 1].includes(n(a(1))))) return missing();
      if (d.pages.length >= MAX_PAGES) return error('DynaPDF page limit reached');
      const page: PdfPage = { width: d.width, height: d.height, cropBox: d.cropBox, ops: [] };
      if (!fitsImports(s, d, [...d.pages, page])) return missing();
      d.current = page; d.pages.push(page); return ok();
    }
    if (f === 'dynapdf.endpage') { if (!d.current) return text('?'); d.current = undefined; return ok(); }
    if (f === 'dynapdf.setpagewidth') { const value = n(a(1)); if (value <= 0) return error('page width must be greater than zero'); d.width = value; if (d.current) d.current.width = d.width; return ok(); }
    if (f === 'dynapdf.setpageheight') { const value = n(a(1)); if (value <= 0) return error('page height must be greater than zero'); d.height = value; if (d.current) d.current.height = d.height; return ok(); }
    if (f === 'dynapdf.getpagewidth') return num(d.current?.width ?? d.pages.at(-1)?.width ?? d.width);
    if (f === 'dynapdf.getpageheight') return num(d.current?.height ?? d.pages.at(-1)?.height ?? d.height);
    if (f === 'dynapdf.getpagecount') return num(d.pages.length);
    if (f === 'dynapdf.setpagecoords') {
      const v = t(a(1)).toLowerCase(); if (v !== 'topdown' && v !== 'bottomup') return error('DynaPDF.SetPageCoords expects TopDown or BottomUp');
      d.coords = v; return ok();
    }
    if (f === 'dynapdf.setfont') {
      const styleValue = t(a(2)).toLowerCase();
      const style = Number.isFinite(Number(styleValue)) ? Number(styleValue) : (styleValue.includes('italic') ? 1 : 0) | (styleValue.includes('bold') ? 2 : 0) | (styleValue.includes('underlined') ? 4 : 0) | (styleValue.includes('striked') ? 8 : 0);
      const selected = font(t(a(1)), style);
      if (!selected) return error(`font "${t(a(1))}" is not available in the supported standard fonts`);
      d.font = selected; d.size = n(a(3)) || 12; d.underline = (style & 4) !== 0; return num(1);
    }
    if (f === 'dynapdf.setfillcolor') {
      if (args.length !== 4) return error('DynaPDF.SetFillColor currently supports exactly three DeviceRGB components');
      const values = args.slice(1).map((x) => asNumber(x));
      if (values.some((x) => x < 0 || x > 1)) return error('DeviceRGB components must be between 0 and 1');
      d.fill = rgb(values.map((x) => Math.round(x * 255))); return ok();
    }
    if (f === 'dynapdf.rectangle') {
      const x = n(a(1)), y = n(a(2)), w = n(a(3)), h = n(a(4)), mode = t(a(5)).toLowerCase();
      const modes = ['fillnoclose', 'strokenoclose', 'fillstrokenoclose', 'fill', 'stroke', 'fillstroke', 'fillevodd', 'fillstrokeevodd', 'fillevoddnoclose', 'fillstrokeevoddnoclose', 'nofill', 'close'];
      if (!modes.includes(mode)) return error(`unsupported rectangle fill mode "${mode}"`);
      const top = d.coords === 'topdown' ? y : d.height - y - h;
      if (mode === 'nofill' || mode === 'close') return ok();
      const op: PdfOp = { kind: 'rect', left: x, top, width: w, height: h, ...(mode.includes('fill') ? { fill: d.fill } : {}), ...(mode.includes('stroke') ? { border: { color: [0, 0, 0], width: 1 } } : {}) };
      return add([op]);
    }
    if (f === 'dynapdf.settextrect') {
      const x = n(a(1)), y = n(a(2)), w = n(a(3)), rawHeight = n(a(4));
      const h = rawHeight < 0 ? d.height : rawHeight;
      d.rect = { x, y: d.coords === 'topdown' ? y : d.height - y - h, w, h }; return ok();
    }
    if (f === 'dynapdf.writeftext' || f === 'dynapdf.writeftextex') {
      const ex = f.endsWith('ex');
      const rect = ex
        ? { x: n(a(1)), y: n(a(2)), w: n(a(3)), h: n(a(4)) < 0 ? d.height : n(a(4)) }
        : d.rect;
      if (!rect) return error('DynaPDF.SetTextRect must be called before DynaPDF.WriteFText');
      const align = ex ? t(a(5)) : t(a(1));
      if (!['left', 'center', 'right'].includes(align.toLowerCase())) return error(`unsupported text alignment "${align}"`);
      let value = t(a(ex ? 6 : 2));
      const plain = n(a(ex ? 7 : 3)) === 1;
      if (!plain && (/\\(?!le#|re#|ce#)[A-Za-z][^#]*#/.test(value) || /\\(?!le#|re#|ce#)[A-Za-z]{1,2}#/.test(value))) return error('unsupported WriteFText markup');
      const converted = { ...rect, y: ex && d.coords === 'bottomup' ? d.height - rect.y - rect.h : rect.y };
      const ops = textOps(d, value, align, converted, !plain);
      if (!plain && value.includes('\\') && !ops.length) return error('unsupported WriteFText markup');
      return add(ops);
    }
    if (f === 'dynapdf.setdocinfo') {
      const allowed = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'Company'];
      const key = t(a(1)); if (!allowed.includes(key)) return error(`unsupported DynaPDF document info key "${key}"`);
      d.metadata[key] = t(a(2)); return ok();
    }
    if (f === 'dynapdf.setsavenewimageformat') return ok();
    if (f === 'dynapdf.save') {
      const bytes = pdf(d.pages, d.metadata);
      if (d.pages.some(p => p.imported) && bytes.length > PDF_IMPORT_LIMITS.bytes) return missing();
      const filename = t(a(1));
      if (filename) {
        const base = filename.replace(/^.*[/\\:]/, '');
        if (!base || base.startsWith('.') || !documents || !(write ? write(join(documents, base), bytes) : (writeFileSync(join(documents, base), bytes), true))) return error('DynaPDF.Save could not write the file');
      }
      d.current = undefined;
      return { type: 'container', value: filename || 'document.pdf', data: bytes };
    }
    return undefined;
  } catch (e) {
    if (['dynapdf.openpdffromcontainer', 'dynapdf.importpdffile', 'dynapdf.importpdfpage', 'dynapdf.editpage'].includes(f)) return missing();
    return error(e instanceof Error ? e.message : 'DynaPDF operation failed');
  }
}

// GetTextFromPDF: the text of a PDF's pages, read from its content streams. Objects are found by scanning the file
// (so damaged cross-reference tables don't matter) and in compressed object streams; text is decoded through each
// font's ToUnicode map, or its simple encoding (WinAnsi, MacRoman, Standard, with Differences). Layout is kept only
// as line breaks. Encrypted files, and files with no text (a scan), give undefined.

import { ResourceLimitError, withWorkBudget, workBudget } from './work-budget.ts';
import { inflateSync } from 'node:zlib';
import { ComplexityError } from './complexity-error.ts';

/** A complete page traversal or result would exceed the supported PDF limits. */
export class PdfLimitError extends ComplexityError {
  constructor(message = 'PDF page count or page tree depth exceeds the supported limit') {
    super(message);
    this.name = 'PdfLimitError';
  }
}

type Obj = null | boolean | number | Name | Str | Ref | Obj[] | Dict | Stream;
interface Name { n: string }
interface Str { s: Uint8Array }
interface Ref { r: number }
type Dict = Map<string, Obj>;
interface Stream { dict: Dict; raw: Uint8Array }

/** Limits on what one call reads, so a hostile file can't make it run or allocate without end. */
const MAX_STREAM = 64 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_PAGES = 5000;
const MAX_DEPTH = 8;

const isName = (o: Obj | undefined): o is Name => !!o && typeof o === 'object' && 'n' in o;
const isStr = (o: Obj | undefined): o is Str => !!o && typeof o === 'object' && 's' in o;
const isRef = (o: Obj | undefined): o is Ref => !!o && typeof o === 'object' && 'r' in o;
const isDict = (o: Obj | undefined): o is Dict => o instanceof Map;
const isStream = (o: Obj | undefined): o is Stream => !!o && typeof o === 'object' && 'raw' in o;

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const regular = (c: number) => !WS.has(c) && !DELIM.has(c);

/** Reads PDF tokens and objects from bytes. */
class Lexer {
  readonly b: Uint8Array;
  pos: number;
  private strict: boolean;
  private budget: { left: number };
  constructor(b: Uint8Array, pos = 0, strict = false, budget = { left: 200_000 }) {
    this.b = b;
    this.pos = pos;
    this.strict = strict;
    this.budget = budget;
  }

  skip(): void {
    const b = this.b;
    while (this.pos < b.length) {
      if (WS.has(b[this.pos])) this.pos++;
      else if (b[this.pos] === 0x25) while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      else break;
    }
  }

  /** A bare word (operator, number, true, R, obj ...), or undefined at a delimiter. */
  word(): string | undefined {
    this.skip();
    const start = this.pos;
    while (this.pos < this.b.length && regular(this.b[this.pos])) this.pos++;
    return this.pos > start ? latin1(this.b.subarray(start, this.pos)) : undefined;
  }

  /** The next object; `ops` lets a content stream's operators through as names prefixed with "op:". */
  object(depth = 0): Obj | undefined {
    if (this.strict && --this.budget.left < 0) throw new Error('PDF token limit');
    if (depth > 64) throw new Error('nested too deeply');
    this.skip();
    const b = this.b;
    const c = b[this.pos];
    if (c === undefined) return undefined;
    if (c === 0x2f) { // /Name
      const start = ++this.pos;
      while (this.pos < b.length && regular(b[this.pos])) this.pos++;
      return { n: latin1(b.subarray(start, this.pos)).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === 0x28) return { s: this.literal() };
    if (c === 0x3c && b[this.pos + 1] === 0x3c) { // << dict >>
      this.pos += 2;
      const d: Dict = new Map();
      for (;;) {
        this.skip();
        if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) { this.pos += 2; break; }
        if (this.pos >= b.length) { if (this.strict) throw new Error('unterminated dictionary'); break; }
        const k = this.object(depth + 1);
        if (!isName(k) || (this.strict && k.n.startsWith('op:'))) { if (this.strict) throw new Error('invalid dictionary key'); this.pos++; continue; }
        const v = this.object(depth + 1);
        if (v === undefined) { if (this.strict) throw new Error('missing dictionary value'); break; }
        if (this.strict && d.has(k.n)) throw new Error('duplicate dictionary key');
        d.set(k.n, v);
      }
      return d;
    }
    if (c === 0x3c) { // <hex>
      const end = b.indexOf(0x3e, this.pos);
      if (this.strict && (end < 0 || /[^0-9a-f\s]/i.test(latin1(b.subarray(this.pos + 1, end))))) throw new Error('invalid hex string');
      const hex = latin1(b.subarray(this.pos + 1, end < 0 ? b.length : end)).replace(/[^0-9a-f]/gi, '');
      this.pos = end < 0 ? b.length : end + 1;
      return { s: Uint8Array.from(Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex')) };
    }
    if (c === 0x5b) { // [array]
      this.pos++;
      const a: Obj[] = [];
      for (;;) {
        this.skip();
        if (b[this.pos] === 0x5d) { this.pos++; break; }
        if (this.pos >= b.length) { if (this.strict) throw new Error('unterminated array'); break; }
        const v = this.object(depth + 1);
        if (v === undefined) { this.pos++; continue; }
        a.push(v);
      }
      return a;
    }
    if (c === 0x29 || c === 0x3e || c === 0x5d || c === 0x7b || c === 0x7d) { if (this.strict) throw new Error('unexpected delimiter'); this.pos++; return null; }
    const w = this.word();
    if (w === undefined) { this.pos++; return null; }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      // "n g R" is a reference.
      if (/^\d+$/.test(w)) {
        const save = this.pos;
        const g = this.word();
        const r = g !== undefined && /^\d+$/.test(g) ? this.word() : undefined;
        if (r === 'R') {
          if (this.strict && (g !== '0' || !Number.isSafeInteger(Number(w)) || Number(w) < 1)) throw new Error('unsupported reference');
          return { r: Number(w) };
        }
        this.pos = save;
      }
      if (this.strict && !Number.isFinite(Number(w))) throw new Error('invalid number');
      return Number(w);
    }
    if (this.strict) throw new Error('unexpected keyword');
    return { n: `op:${w}` };
  }

  literal(): Uint8Array {
    const b = this.b;
    const out: number[] = [];
    let level = 0;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        const e = b[this.pos++];
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
        if (e in map) out.push(map[e]);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let i = 0; i < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; i++) v = v * 8 + b[this.pos++] - 0x30;
          out.push(v & 0xff);
        } else if (e === 0x0d) { if (b[this.pos] === 0x0a) this.pos++; } else if (e !== 0x0a && e !== undefined) out.push(e);
      } else if (c === 0x28) { level++; out.push(c); } else if (c === 0x29) {
        if (level === 0) return Uint8Array.from(out);
        level--;
        out.push(c);
      } else out.push(c);
    }
    if (this.strict) throw new Error('unterminated string');
    return Uint8Array.from(out);
  }
}

const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');

class Doc {
  readonly objects = new Map<number, Obj>();
  readonly trailers: Dict[] = [];
  private budget = MAX_TOTAL;

  constructor(b: Uint8Array, strict = false) {
    if (strict) { readStrictObjects(this, b); return; }
    const text = latin1(b);
    const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m; (m = objRe.exec(text));) {
      const lx = new Lexer(b, m.index + m[0].length);
      let o: Obj | undefined;
      try {
        o = lx.object();
      } catch {
        continue;
      }
      if (o === undefined) continue;
      if (isDict(o)) {
        lx.skip();
        if (text.startsWith('stream', lx.pos)) {
          let start = lx.pos + 6;
          if (b[start] === 0x0d) start++;
          if (b[start] === 0x0a) start++;
          const len = o.get('Length');
          let end = typeof len === 'number' && len >= 0 && /^\s*endstream/.test(text.slice(start + len, start + len + 20)) ? start + len : -1;
          if (end < 0) {
            end = text.indexOf('endstream', start);
            if (end < 0) end = b.length;
            while (end > start && (b[end - 1] === 0x0a || b[end - 1] === 0x0d)) end--;
          }
          o = { dict: o, raw: b.subarray(start, end) };
          objRe.lastIndex = end;
        }
      }
      this.objects.set(Number(m[1]), o);
      if (isStream(o) && isName(o.dict.get('Type')) && (o.dict.get('Type') as Name).n === 'XRef') this.trailers.push(o.dict);
    }
    const trailerRe = /trailer\s*<</g;
    for (let m; (m = trailerRe.exec(text));) {
      try {
        const d = new Lexer(b, m.index + 7).object();
        if (isDict(d)) this.trailers.push(d);
      } catch { /* a damaged trailer is skipped */ }
    }
    // Objects inside compressed object streams, unless the file also has them directly.
    for (const o of [...this.objects.values()]) {
      if (!isStream(o) || (o.dict.get('Type') as Name | undefined)?.n !== 'ObjStm') continue;
      const data = this.data(o);
      if (!data) continue;
      const n = Number(this.get(o.dict.get('N')) ?? 0);
      const first = Number(this.get(o.dict.get('First')) ?? 0);
      const head = new Lexer(data);
      const pairs: [number, number][] = [];
      for (let i = 0; i < n && i < 100000; i++) {
        const num = head.object();
        const off = head.object();
        if (typeof num !== 'number' || typeof off !== 'number') break;
        pairs.push([num, off]);
      }
      for (const [num, off] of pairs) {
        if (this.objects.has(num)) continue;
        try {
          const v = new Lexer(data, first + off).object();
          if (v !== undefined) this.objects.set(num, v);
        } catch { /* skip */ }
      }
    }
  }

  get(o: Obj | undefined, depth = 0): Obj | undefined {
    while (isRef(o) && depth++ < 32) o = this.objects.get(o.r);
    return isRef(o) ? undefined : o;
  }

  dict(o: Obj | undefined): Dict | undefined {
    const v = this.get(o);
    return isDict(v) ? v : isStream(v) ? v.dict : undefined;
  }

  /** A stream's decoded bytes, or undefined for a filter not read here. */
  data(s: Stream): Uint8Array | undefined {
    let data: Uint8Array = s.raw;
    const f = this.get(s.dict.get('Filter'));
    const filters = (Array.isArray(f) ? f : f ? [f] : []).map((x) => this.get(x));
    const parms = this.get(s.dict.get('DecodeParms'));
    for (const [i, filter] of filters.entries()) {
      if (!isName(filter)) return undefined;
      if (filter.n === 'FlateDecode' || filter.n === 'Fl') {
        try {
          data = inflateSync(data, { maxOutputLength: Math.min(MAX_STREAM, this.budget), finishFlush: 2 /* Z_SYNC_FLUSH: keep what a truncated stream gives */ });
        } catch {
          return undefined;
        }
        const p = this.dict(Array.isArray(parms) ? parms[i] : parms);
        const predictor = Number(this.get(p?.get('Predictor')) ?? 1);
        if (predictor >= 10) data = unpredict(data, Number(this.get(p?.get('Columns')) ?? 1));
      } else if (filter.n === 'ASCIIHexDecode' || filter.n === 'AHx') {
        const hex = latin1(data).replace(/>.*$/s, '').replace(/[^0-9a-f]/gi, '');
        data = Uint8Array.from(Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'));
      } else if (filter.n === 'ASCII85Decode' || filter.n === 'A85') {
        data = ascii85(data);
      } else {
        return undefined;
      }
    }
    this.budget -= data.length;
    if (this.budget < 0) throw new Error('too much data');
    return data;
  }

  encrypted(): boolean {
    return this.trailers.some((t) => t.has('Encrypt'));
  }

  /** The pages in order, each with the resources it inherits. */
  pages(strict = false): { page: Dict; resources?: Dict; attributes: Dict }[] {
    const root = this.trailers.map((t) => this.dict(t.get('Root'))).find((r) => r) ??
      [...this.objects.values()].map((o) => (isDict(o) ? o : undefined)).find((d) => (d?.get('Type') as Name | undefined)?.n === 'Catalog');
    const out: { page: Dict; resources?: Dict; attributes: Dict }[] = [];
    const seen = new Set<Dict>();
    const walk = (node: Dict | undefined, resources: Dict | undefined, attributes: Dict, depth: number): number => {
      if (!node || seen.has(node)) {
        if (strict) throw new Error('invalid or excessive page tree');
        return 0;
      }
      // An import refuses a tree that is too deep or holds too many pages by name; a plain read stops with the limit error.
      if (depth > 64 || out.length >= (strict ? PDF_IMPORT_LIMITS.pages : MAX_PAGES)) throw strict ? new Error('invalid or excessive page tree') : new PdfLimitError();
      seen.add(node);
      if (strict && node.has('Resources') && !isDict(this.get(node.get('Resources')))) throw new Error('invalid resources');
      const own = this.dict(node.get('Resources')) ?? resources;
      const inherited = new Map(attributes);
      for (const key of ['MediaBox', 'CropBox', 'Rotate']) if (node.has(key)) inherited.set(key, node.get(key)!);
      const kids = this.get(node.get('Kids'));
      if (Array.isArray(kids)) {
        if (strict && (node.get('Type') as Name)?.n !== 'Pages') throw new Error('invalid page tree node');
        let count = 0;
        for (const k of kids) {
          const child = this.dict(k);
          if (strict && (!isRef(k) || this.dict(child?.get('Parent')) !== node)) throw new Error('invalid page parent');
          count += walk(child, own, inherited, depth + 1);
        }
        if (strict && this.get(node.get('Count')) !== count) throw new Error('invalid page count');
        return count;
      }
      if (strict && (node.get('Type') as Name)?.n !== 'Page') throw new Error('invalid page');
      out.push({ page: node, resources: own, attributes: inherited });
      return 1;
    };
    walk(this.dict(root?.get('Pages')), undefined, new Map(), 0);
    return out;
  }
}

/** Local import limits, not DynaPDF vendor limits. No repair or external I/O. */
export const PDF_IMPORT_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, objects: 10_000, pages: 500, stream: 8 * 1024 * 1024 });

/** Strict classic-xref reader for the import slice. Compressed xrefs/object streams are deliberately deferred. */
function readStrictObjects(doc: Doc, b: Uint8Array): void {
  if (b.length > PDF_IMPORT_LIMITS.bytes) throw new Error('PDF size limit');
  const text = latin1(b);
  if (!/^%PDF-1\.[0-7][\r\n]/.test(text)) throw new Error('unsupported PDF header');
  const tail = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!tail) throw new Error('incomplete PDF');
  const budget = { left: 200_000 };
  const offsets = new Map<number, number>();
  const sections = new Set<number>();
  let entries = 0;
  let at: number | undefined = Number(tail[1]);
  while (at !== undefined) {
    if (sections.has(at) || sections.size >= 32 || !text.startsWith('xref', at)) throw new Error('unsupported cross-reference');
    sections.add(at);
    const lx = new Lexer(b, at + 4, true, budget);
    for (;;) {
      const first = lx.word();
      if (first === 'trailer') break;
      const count = lx.word();
      if (!first || !count || !/^\d+$/.test(first) || !/^\d+$/.test(count)) throw new Error('invalid xref subsection');
      const from = Number(first), n = Number(count);
      if (!Number.isSafeInteger(from + n) || from + n > 10_000_000 || (entries += n) > PDF_IMPORT_LIMITS.objects + 1) throw new Error('PDF object limit');
      for (let i = 0; i < n; i++) {
        const offset = lx.word(), generation = lx.word(), state = lx.word();
        if (!offset || !/^\d{10}$/.test(offset) || !generation || !/^\d{5}$/.test(generation) || (state !== 'n' && state !== 'f')) throw new Error('invalid xref entry');
        if (state === 'n' && (generation !== '00000' || Number(offset) >= at)) throw new Error('unsupported xref entry');
        if (!offsets.has(from + i)) offsets.set(from + i, state === 'n' ? Number(offset) : -1);
      }
    }
    const trailer = lx.object();
    if (!isDict(trailer) || trailer.has('Encrypt') || trailer.has('XRefStm')) throw new Error('unsupported trailer');
    const size = trailer.get('Size');
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > 10_000_000) throw new Error('invalid trailer size');
    doc.trailers.push(trailer);
    const end = lx.word(), offset = lx.word();
    if (end !== 'startxref' || offset !== String(at)) throw new Error('invalid xref footer');
    const prev = trailer.get('Prev');
    if (prev !== undefined && (typeof prev !== 'number' || !Number.isSafeInteger(prev) || prev < 0 || prev >= at)) throw new Error('invalid previous xref');
    at = prev as number | undefined;
  }
  const reading = new Set<number>();
  const ranges: [number, number][] = [];
  const read = (id: number): Obj => {
    const cached = doc.objects.get(id);
    if (cached !== undefined) return cached;
    const offset = offsets.get(id);
    if (offset === undefined || offset < 0 || reading.has(id) || reading.size > 64) throw new Error('invalid reference');
    reading.add(id);
    const lx = new Lexer(b, offset, true, budget);
    if (lx.word() !== String(id) || lx.word() !== '0' || lx.word() !== 'obj') throw new Error('invalid object offset');
    let o = lx.object();
    if (o === undefined) throw new Error('missing object');
    const next = lx.word();
    if (next === 'stream' && isDict(o)) {
      let start = lx.pos;
      if (b[start] === 13) start++;
      if (b[start] === 10) start++;
      if (start === lx.pos) throw new Error('invalid stream delimiter');
      const length = o.get('Length');
      const n = isRef(length) ? read(length.r) : length;
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > PDF_IMPORT_LIMITS.stream || start + n > b.length) throw new Error('invalid stream length');
      o = { dict: o, raw: b.subarray(start, start + n) };
      lx.pos = start + n;
      if (lx.word() !== 'endstream' || lx.word() !== 'endobj') throw new Error('incomplete stream');
    } else if (next !== 'endobj') throw new Error('incomplete object');
    ranges.push([offset, lx.pos]);
    doc.objects.set(id, o);
    reading.delete(id);
    return o;
  };
  for (const [id, offset] of offsets) if (offset >= 0) read(id);
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw new Error('overlapping objects');
  let decodedBytes = 0;
  const validate = (o: Obj, depth = 0): void => {
    if (depth > 64) throw new Error('nested too deeply');
    if (isRef(o)) { if (!doc.objects.has(o.r)) throw new Error('dangling reference'); return; }
    if (Array.isArray(o)) { for (const v of o) validate(v, depth + 1); return; }
    if (isStream(o)) {
      if (o.dict.has('F') || o.dict.has('FFilter') || o.dict.has('FDecodeParms')) throw new Error('external stream');
      const filter = doc.get(o.dict.get('Filter'));
      const filters = (Array.isArray(filter) ? filter : filter ? [filter] : []).map(v => doc.get(v));
      if (filters.length > 1) throw new Error('unsupported filter chain');
      if (filters.length && (!isName(filters[0]) || !['FlateDecode', 'DCTDecode'].includes(filters[0].n))) throw new Error('unsupported filter');
      if (isName(filters[0]) && filters[0].n === 'FlateDecode') {
        const decoded = inflateSync(o.raw, { maxOutputLength: Math.min(PDF_IMPORT_LIMITS.stream, PDF_IMPORT_LIMITS.bytes - decodedBytes) });
        decodedBytes += decoded.length;
        if (decodedBytes >= PDF_IMPORT_LIMITS.bytes) throw new Error('decoded byte limit');
      }
      validate(o.dict, depth + 1); return;
    }
    if (isDict(o)) {
      const type = doc.get(o.get('Type'));
      if (isName(type) && ['Filespec', 'ObjStm', 'XRef'].includes(type.n)) throw new Error('unsupported object');
      // External references/actions never survive an import, even in an unused object.
      for (const key of ['FS', 'EF', 'RF', 'URI', 'URL', 'GoToR', 'Launch', 'JavaScript', 'JS', 'Ref', 'OPI', 'AA', 'OpenAction']) if (o.has(key)) throw new Error('external or active object');
      const action = doc.get(o.get('S'));
      if (isName(action) && ['URI', 'GoToR', 'GoToE', 'Launch', 'JavaScript', 'SubmitForm', 'ImportData'].includes(action.n)) throw new Error('external action');
      for (const v of o.values()) validate(v, depth + 1);
    }
  };
  for (const o of doc.objects.values()) validate(o);
  const catalog = doc.dict(doc.trailers[0]?.get('Root'));
  if (!catalog || (catalog.get('Type') as Name)?.n !== 'Catalog' || [...catalog.keys()].some(k => !['Type', 'Pages'].includes(k))) throw new Error('unsupported catalog');
}

/** Opaque page source retained by the script PDF writer; the bytes have been copied and validated. */
export interface PdfImportedPage {
  readonly width: number;
  readonly height: number;
  readonly cropBox?: number[];
  readonly source: { doc: Doc; bytes: number; objects: number };
  readonly page: Dict;
  readonly attributes: Dict;
  readonly resources?: Dict;
}

/** A bounded import, or undefined for encrypted, malformed or unsupported input. Never repairs a file. */
export function readPdfImport(bytes: Uint8Array): PdfImportedPage[] | undefined {
  try {
    if (bytes.length > PDF_IMPORT_LIMITS.bytes) return undefined;
    const doc = new Doc(Uint8Array.from(bytes), true);
    const source = { doc, bytes: bytes.length, objects: doc.objects.size };
    const pages = doc.pages(true);
    if (!pages.length) return undefined;
    return pages.map(({ page, resources, attributes }) => {
      for (const key of ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) {
        const value = attributes.get(key) ?? page.get(key);
        if (value === undefined) continue;
        const box = doc.get(value);
        if (!Array.isArray(box) || box.length !== 4 || box.some(v => typeof v !== 'number' || !Number.isFinite(v)) || !(Number(box[2]) > Number(box[0])) || !(Number(box[3]) > Number(box[1]))) throw new Error('invalid page box');
      }
      const box = doc.get(attributes.get('MediaBox'));
      if (!Array.isArray(box) || box.length !== 4 || box.some(v => typeof v !== 'number' || !Number.isFinite(v)) || !(Number(box[2]) > Number(box[0])) || !(Number(box[3]) > Number(box[1]))) throw new Error('invalid media box');
      const rotation = doc.get(attributes.get('Rotate')) ?? 0;
      if (typeof rotation !== 'number' || !Number.isInteger(rotation / 90)) throw new Error('invalid rotation');
      if (resources === undefined || [...page.keys()].some(k => !['Type', 'Parent', 'MediaBox', 'CropBox', 'Rotate', 'Resources', 'Contents', 'Group', 'BleedBox', 'TrimBox', 'ArtBox'].includes(k))) throw new Error('unsupported page');
      const contents = doc.get(page.get('Contents'));
      for (const part of Array.isArray(contents) ? contents : contents === undefined ? [] : [contents]) if (!isStream(doc.get(part))) throw new Error('invalid page contents');
      const cropBox = doc.get(attributes.get('CropBox')) as number[] | undefined;
      return { source, page, resources, attributes, cropBox, width: Number(box[2]) - Number(box[0]), height: Number(box[3]) - Number(box[1]) };
    });
  } catch { return undefined; }
}

function unpredict(data: Uint8Array, columns: number): Uint8Array {
  const row = columns + 1;
  const out = new Uint8Array(Math.floor(data.length / row) * columns);
  const prev = new Uint8Array(columns);
  for (let r = 0; r * row + row <= data.length; r++) {
    const type = data[r * row];
    for (let i = 0; i < columns; i++) {
      const x = data[r * row + 1 + i];
      const a = i > 0 ? out[r * columns + i - 1] : 0;
      const b = prev[i];
      const c = i > 0 ? (r > 0 ? out[(r - 1) * columns + i - 1] : 0) : 0;
      let v = x;
      if (type === 1) v = x + a;
      else if (type === 2) v = x + b;
      else if (type === 3) v = x + ((a + b) >> 1);
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[r * columns + i] = v & 0xff;
    }
    prev.set(out.subarray(r * columns, r * columns + columns));
  }
  return out;
}

function ascii85(data: Uint8Array): Uint8Array {
  const s = latin1(data).replace(/~>.*$/s, '').replace(/\s/g, '');
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * 85 + (group[i] ?? 84);
    for (let i = 0; i < n; i++) out.push((v >>> (24 - 8 * i)) & 0xff);
    group = [];
  };
  for (const ch of s.replace(/^<~/, '')) {
    if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length > 1) flush(group.length - 1);
  return Uint8Array.from(out);
}

// --- fonts --------------------------------------------------------------------------

/** WinAnsi's bytes 0x80 to 0x9F (the rest is Latin-1); unassigned ones are left out. */
const WIN_ANSI_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

/** Glyph names a Differences array uses most, beyond single letters and uniXXXX. */
const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
  braceright: '}', asciitilde: '~', bullet: '•', endash: '–', emdash: '—', quoteleft: '‘', quoteright: '’',
  quotedblleft: '“', quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„', ellipsis: '…', fi: 'fi', fl: 'fl',
  ff: 'ff', ffi: 'ffi', ffl: 'ffl', Euro: '€', copyright: '©', registered: '®', trademark: '™', degree: '°',
  section: '§', paragraph: '¶', dagger: '†', daggerdbl: '‡', minus: '−', multiply: '×', divide: '÷', nbspace: ' ',
  germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', oslash: 'ø', Oslash: 'Ø', dotlessi: 'ı', sterling: '£', yen: '¥',
  cent: '¢', guillemotleft: '«', guillemotright: '»', periodcentered: '·', exclamdown: '¡', questiondown: '¿',
};
const ACCENTS: Record<string, string> = { acute: '́', grave: '̀', circumflex: '̂', dieresis: '̈', tilde: '̃', ring: '̊', cedilla: '̧', caron: '̌' };

function glyph(name: string): string | undefined {
  const base = name.replace(/\..*$/, '');
  if (GLYPHS[base]) return GLYPHS[base];
  if (/^[A-Za-z]$/.test(base)) return base;
  let m = /^uni([0-9A-F]{4})+$/.exec(base);
  if (m) return base.slice(3).match(/.{4}/g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join('');
  m = /^u([0-9A-F]{4,6})$/.exec(base);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)$/.exec(base);
  if (m) return (m[1] + ACCENTS[m[2]]).normalize('NFC');
  return undefined;
}

function baseEncoding(name: string | undefined): (code: number) => string {
  if (name === 'MacRomanEncoding') {
    try {
      const mac = new TextDecoder('macintosh');
      return (c) => (c < 0x80 ? String.fromCharCode(c) : mac.decode(Uint8Array.of(c)));
    } catch { /* fall through to WinAnsi */ }
  }
  if (name === 'StandardEncoding') return (c) => (c === 0x27 ? '’' : c === 0x60 ? '‘' : c < 0x80 ? String.fromCharCode(c) : '');
  return (c) => (c >= 0x80 && c <= 0x9f ? WIN_ANSI_HIGH[c - 0x80] : String.fromCharCode(c));
}

interface Glyph {
  text: string;
  /** Advance width in thousandths of the font size. */
  width: number;
  /** A one-byte code 32, which word spacing applies to. */
  space: boolean;
}

interface Font {
  /** Splits a string's bytes into codes: each code's text and width. */
  decode(bytes: Uint8Array): Glyph[];
}

/** A PDF text string: UTF-16 after a byte order mark, else PDFDocEncoding (Latin-1 for the letters that matter). */
function textString(b: Uint8Array): string {
  if (b[0] === 0xfe && b[1] === 0xff) return utf16(b.subarray(2));
  return latin1(b);
}

function hexCode(s: Uint8Array): number {
  let v = 0;
  for (const x of s) v = v * 256 + x;
  return v;
}

function utf16(s: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < s.length; i += 2) out += String.fromCharCode((s[i] << 8) | s[i + 1]);
  return out;
}

/** A ToUnicode CMap: code lengths from its codespace ranges, and the text for each code. */
function toUnicode(data: Uint8Array): { lengths: number[]; map: Map<number, string>; ranges: [number, number, number, string | string[]][] } {
  const lx = new Lexer(data);
  const lengths = new Set<number>();
  const map = new Map<number, string>();
  const ranges: [number, number, number, string | string[]][] = [];
  const tokens: Obj[] = [];
  for (let i = 0; i < 2_000_000; i++) {
    const o = lx.object();
    if (o === undefined) break;
    tokens.push(o);
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isName(t)) continue;
    if (t.n === 'op:begincodespacerange') {
      for (i++; i + 1 < tokens.length && isStr(tokens[i]); i += 2) lengths.add((tokens[i] as Str).s.length);
    } else if (t.n === 'op:beginbfchar') {
      for (i++; i + 1 < tokens.length && isStr(tokens[i]); i += 2) {
        const src = tokens[i] as Str;
        const dst = tokens[i + 1];
        if (isStr(dst)) map.set(hexCode(src.s) + src.s.length * 2 ** 32, utf16(dst.s));
      }
    } else if (t.n === 'op:beginbfrange') {
      for (i++; i + 2 < tokens.length && isStr(tokens[i]); i += 3) {
        const lo = tokens[i] as Str;
        const hi = tokens[i + 1];
        const dst = tokens[i + 2];
        if (!isStr(hi)) break;
        const from = hexCode(lo.s);
        const to = Math.min(hexCode(hi.s), from + 65535);
        if (isStr(dst)) ranges.push([lo.s.length, from, to, utf16(dst.s)]);
        else if (Array.isArray(dst)) ranges.push([lo.s.length, from, to, dst.map((d) => (isStr(d) ? utf16(d.s) : ''))]);
      }
    }
  }
  return { lengths: [...lengths].sort(), map, ranges };
}

/** A width when the font gives none (the standard 14 fonts): about an average Latin letter. */
const DEFAULT_WIDTH = 500;

function font(doc: Doc, f: Dict | undefined): Font {
  const subtype = (doc.get(f?.get('Subtype')) as Name | undefined)?.n;
  const tu = doc.get(f?.get('ToUnicode'));
  const cmap = isStream(tu) ? (() => { const d = doc.data(tu); return d ? toUnicode(d) : undefined; })() : undefined;
  const lookup = (len: number, code: number): string | undefined => {
    const hit = cmap?.map.get(code + len * 2 ** 32);
    if (hit !== undefined) return hit;
    for (const [l, from, to, dst] of cmap?.ranges ?? []) {
      if (l !== len || code < from || code > to) continue;
      if (Array.isArray(dst)) return dst[code - from];
      // The last UTF-16 unit counts up through the range.
      return dst.slice(0, -1) + String.fromCharCode(dst.charCodeAt(dst.length - 1) + code - from);
    }
    return undefined;
  };
  if (subtype === 'Type0') {
    const lengths = cmap?.lengths.length ? cmap.lengths : [2];
    // The descendant font's widths: W lists "c [w1 w2 ...]" and "cFirst cLast w"; DW is the rest.
    const kids = doc.get(f?.get('DescendantFonts'));
    const cid = doc.dict(Array.isArray(kids) ? kids[0] : undefined);
    const dw = Number(doc.get(cid?.get('DW')) ?? 1000);
    const widths = new Map<number, number>();
    const w = doc.get(cid?.get('W'));
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length;) {
        const first = doc.get(w[i]);
        const next = doc.get(w[i + 1]);
        workBudget()?.work();
        if (typeof first !== 'number') break;
        if (!Number.isSafeInteger(first) || first < 0 || first > 65535) throw new ResourceLimitError('invalid CID width range');
        if (Array.isArray(next)) {
          if (next.length > 65536 - first) throw new ResourceLimitError('invalid CID width range');
          workBudget()?.nodes(next.length);
          next.forEach((x, k) => { const v = doc.get(x); if (typeof v === 'number') widths.set(first + k, v); });
          i += 2;
        } else {
          const last = next;
          const v = doc.get(w[i + 2]);
          if (typeof last !== 'number') break;
          if (!Number.isSafeInteger(last) || last < first || last > 65535) throw new ResourceLimitError('invalid CID width range');
          if (typeof v !== 'number') break;
          const count = last - first + 1;
          workBudget()?.nodes(count);
          for (let k = 0; k < count; k++) widths.set(first + k, v);
          i += 3;
        }
      }
    }
    return {
      decode(bytes) {
        const out: Glyph[] = [];
        for (let i = 0; i < bytes.length;) {
          const len = Math.max(1, lengths.find((l) => lookup(l, hexCode(bytes.subarray(i, i + l))) !== undefined) ?? lengths[lengths.length - 1]);
          const code = hexCode(bytes.subarray(i, i + len));
          out.push({ text: lookup(len, code) ?? '', width: widths.get(code) ?? dw, space: len === 1 && code === 32 });
          i += len;
        }
        return out;
      },
    };
  }
  const enc = doc.get(f?.get('Encoding'));
  const encDict = isDict(enc) ? enc : undefined;
  const base = baseEncoding(isName(enc) ? enc.n : (doc.get(encDict?.get('BaseEncoding')) as Name | undefined)?.n);
  const diffs = new Map<number, string>();
  const d = doc.get(encDict?.get('Differences'));
  if (Array.isArray(d)) {
    let code = 0;
    for (const x of d) {
      if (typeof x === 'number') code = x;
      else if (isName(x)) { const g = glyph(x.n); if (g !== undefined) diffs.set(code, g); code++; }
    }
  }
  const firstChar = Number(doc.get(f?.get('FirstChar')) ?? 0);
  const ws = doc.get(f?.get('Widths'));
  const width = (c: number) => {
    const v = Array.isArray(ws) ? doc.get(ws[c - firstChar]) : undefined;
    return typeof v === 'number' ? v : DEFAULT_WIDTH;
  };
  return { decode: (bytes) => [...bytes].map((c) => ({ text: lookup(1, c) ?? diffs.get(c) ?? base(c), width: width(c), space: c === 32 })) };
}

// --- content ------------------------------------------------------------------------

function runContent(doc: Doc, data: Uint8Array, resources: Dict | undefined, out: string[], depth: number, fonts: Map<Dict, Font>): void {
  if (depth > MAX_DEPTH) return;
  const lx = new Lexer(data);
  const ops: Obj[] = [];
  let current: Font | undefined;
  let size = 12;
  let charSpacing = 0;
  let wordSpacing = 0;
  let scale = 1;
  let line = '';
  // Where the text line starts (Td and Tm set it), where the last text shown ended, and the text matrix's scale,
  // all in the text matrix's units: enough to tell a new line (y moves) and a gap between words (x jumps).
  let lineX = 0;
  let lineY = 0;
  /** The y of the line text was last shown on, kept across BT, which resets the line matrix. */
  let lastY: number | undefined;
  let endX = 0;
  let unit = 1;
  const newline = () => {
    out.push(line);
    line = '';
  };
  const space = () => { if (line && !line.endsWith(' ')) line += ' '; };
  const show = (s: Str) => {
    if (!current) return;
    for (const g of current.decode(s.s)) {
      line += g.text;
      endX += ((g.width / 1000) * size + charSpacing + (g.space ? wordSpacing : 0)) * scale * unit;
    }
  };
  /** The text moves to (x, y): a new line when y changes, a space when it skips ahead along the line. */
  const moveTo = (x: number, y: number) => {
    if (lastY !== undefined && Math.abs(y - lastY) > Math.abs(size * unit) * 0.3) {
      if (line) newline();
    } else if (lastY !== undefined && x - endX > Math.abs(size * unit) * 0.15) {
      space();
    }
    lineX = x;
    lineY = y;
    lastY = y;
    endX = x;
  };
  const fontNamed = (name: string) => {
    const fd = doc.dict(doc.dict(resources?.get('Font'))?.get(name));
    if (!fd) return undefined;
    let f = fonts.get(fd);
    if (!f) fonts.set(fd, (f = font(doc, fd)));
    return f;
  };
  const num = (o: Obj | undefined, d = 0) => (typeof o === 'number' ? o : d);
  // Marked content with ActualText stands for the glyphs inside it (a ligature, a symbol drawn as a picture).
  const marked: { actual?: string; at: number; lines: number }[] = [];
  for (let guard = 0; guard < 10_000_000; guard++) {
    let o: Obj | undefined;
    try {
      o = lx.object();
    } catch {
      break;
    }
    if (o === undefined) break;
    if (!isName(o) || !o.n.startsWith('op:')) { ops.push(o); continue; }
    const op = o.n.slice(3);
    const arg = (k: number) => ops[ops.length - k];
    switch (op) {
      case 'Tf': { const n = arg(2); current = isName(n) ? fontNamed(n.n) : undefined; size = num(arg(1), size); break; }
      case 'Tc': charSpacing = num(arg(1)); break;
      case 'Tw': wordSpacing = num(arg(1)); break;
      case 'Tz': scale = num(arg(1), 100) / 100; break;
      case 'Tj': { const s = arg(1); if (isStr(s)) show(s); break; }
      case "'": case '"': {
        if (op === '"') { wordSpacing = num(arg(3)); charSpacing = num(arg(2)); }
        newline();
        endX = lineX;
        const s = arg(1);
        if (isStr(s)) show(s);
        break;
      }
      case 'TJ': {
        const a = arg(1);
        if (Array.isArray(a)) {
          for (const x of a) {
            if (isStr(x)) show(x);
            else if (typeof x === 'number') {
              // A wide gap between pieces (in thousandths of the font size) is a space between words.
              if (x < -250) space();
              endX -= (x / 1000) * size * scale * unit;
            }
          }
        }
        break;
      }
      case 'T*': newline(); endX = lineX; break;
      case 'Td': case 'TD': moveTo(lineX + num(arg(2)) * unit, lineY + num(arg(1)) * unit); break;
      case 'Tm': {
        const a = num(arg(6), 1), b = num(arg(5));
        unit = Math.hypot(a, b) || 1;
        moveTo(num(arg(2)), num(arg(1)));
        break;
      }
      case 'BT': unit = 1; lineX = 0; lineY = 0; break;
      // A new transformation can put the next text anywhere, so it starts a line of its own.
      case 'cm': if (line) newline(); lastY = undefined; break;
      case 'Do': {
        const n = arg(1);
        const x = isName(n) ? doc.get(doc.dict(resources?.get('XObject'))?.get(n.n)) : undefined;
        if (isStream(x) && (doc.get(x.dict.get('Subtype')) as Name | undefined)?.n === 'Form') {
          const d = doc.data(x);
          if (d) {
            if (line) newline();
            runContent(doc, d, doc.dict(x.dict.get('Resources')) ?? resources, out, depth + 1, fonts);
            lastY = undefined;
          }
        }
        break;
      }
      case 'BMC': marked.push({ at: line.length, lines: out.length }); break;
      case 'BDC': {
        const p = arg(1);
        const props = isDict(p) ? p : isName(p) ? doc.dict(doc.dict(resources?.get('Properties'))?.get(p.n)) : undefined;
        const actual = doc.get(props?.get('ActualText'));
        marked.push({ at: line.length, lines: out.length, ...(isStr(actual) ? { actual: textString(actual.s) } : {}) });
        break;
      }
      case 'EMC': {
        const m = marked.pop();
        if (m?.actual !== undefined && m.lines === out.length) line = line.slice(0, m.at) + m.actual;
        break;
      }
      case 'ID': {
        // Inline image data runs to "EI" on its own.
        const b = lx.b;
        let i = lx.pos + 1;
        while (i + 2 < b.length && !(WS.has(b[i - 1]) && b[i] === 0x45 && b[i + 1] === 0x49 && (i + 2 >= b.length || WS.has(b[i + 2])))) i++;
        lx.pos = i + 2;
        break;
      }
    }
    ops.length = 0;
  }
  if (line) newline();
}

/** The text of a PDF, pages and lines separated by carriage returns, or undefined when there is none to read. Throws PdfLimitError on page limits. */
export function pdfText(bytes: Uint8Array): string | undefined {
  return withWorkBudget(() => {
    if (latin1(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) return undefined;
    try {
      const doc = new Doc(bytes);
      if (doc.encrypted()) return undefined;
      const lines: string[] = [];
      const fonts = new Map<Dict, Font>();
      for (const { page, resources } of doc.pages()) {
        const c = doc.get(page.get('Contents'));
        const parts = (Array.isArray(c) ? c.map((x) => doc.get(x)) : [c]).filter(isStream);
        // A page's content may be split across streams anywhere, even inside an operator, so they are read as one.
        const chunks = parts.map((p) => doc.data(p)).filter((d): d is Uint8Array => !!d);
        const data = new Uint8Array(chunks.reduce((n, d) => n + d.length + 1, 0));
        let at = 0;
        for (const d of chunks) { data.set(d, at); data[at + d.length] = 0x0a; at += d.length + 1; }
        runContent(doc, data, resources, lines, 0, fonts);
      }
      const text = lines.map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/\s+$/, '')).join('\r').replace(/\r{3,}/g, '\r\r').trim();
      return text ? text : undefined;
    } catch (e) {
      if (e instanceof ResourceLimitError || e instanceof PdfLimitError) throw e;
      return undefined;
    }
  });
}

/** How many pages a PDF has, or undefined for something that is not a readable, unencrypted PDF. Throws PdfLimitError on page limits. */
export function pdfPageCount(bytes: Uint8Array): number | undefined {
  if (latin1(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) return undefined;
  try {
    const doc = new Doc(bytes);
    const n = doc.encrypted() ? 0 : doc.pages().length;
    return n || undefined;
  } catch (e) {
    if (e instanceof PdfLimitError) throw e;
    return undefined;
  }
}

/**
 * A new PDF holding pages `from` to `to` (1-based, `to` defaulting to the last page) of another, or undefined for
 * something that is not a readable, unencrypted PDF or a range outside it. Each page keeps what it inherits (resources,
 * boxes, rotation) and everything it points to; a link to a page that is not kept points nowhere. The streams are copied
 * as they are, so nothing is decoded or recompressed. Throws PdfLimitError on page limits, even for a small selection.
 */
export function pdfPageRange(bytes: Uint8Array, from: number, to?: number): Uint8Array | undefined {
  if (latin1(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) return undefined;
  try {
    const doc = new Doc(bytes);
    if (doc.encrypted()) return undefined;
    const all = doc.pages();
    const last = to ?? all.length;
    if (!Number.isInteger(from) || !Number.isInteger(last) || from < 1 || last < from || from > all.length) return undefined;
    return buildPdf([{ doc, kept: all.slice(from - 1, Math.min(last, all.length)) }]);
  } catch (e) {
    if (e instanceof PdfLimitError) throw e;
    return undefined;
  }
}

/** Why a PDF cannot be merged: it is not a readable PDF with a page, or it is encrypted. */
export type PdfMergeProblem = 'unreadable' | 'encrypted' | 'limit';

/** What is wrong with these bytes as a PDF to open or append, if anything. */
export function pdfProblem(bytes: Uint8Array): PdfMergeProblem | undefined {
  if (latin1(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) return 'unreadable';
  try {
    const doc = new Doc(bytes);
    if (doc.encrypted()) return 'encrypted';
    return doc.pages().length ? undefined : 'unreadable';
  } catch (e) {
    if (e instanceof PdfLimitError) return 'limit';
    return 'unreadable';
  }
}

/**
 * One PDF holding every page of each PDF given, in order, or undefined when one is not a readable, unencrypted PDF
 * (see pdfProblem). Pages keep what they inherit and what they point to, as in pdfPageRange; the streams are copied as
 * they are. Links between pages of the same file are kept, links across files and document-level features (outlines,
 * form fields, named destinations, the document information) are not carried over. Throws PdfLimitError on input or combined page limits.
 */
export function pdfMerge(parts: Uint8Array[]): Uint8Array | undefined {
  try {
    const sources = parts.map((bytes) => {
      const problem = pdfProblem(bytes);
      if (problem === 'limit') throw new PdfLimitError();
      if (problem) throw new Error(problem);
      const doc = new Doc(bytes);
      return { doc, kept: doc.pages() };
    });
    return buildPdf(sources);
  } catch (e) {
    if (e instanceof PdfLimitError) throw e;
    return undefined;
  }
}

/** A PDF of the kept pages of each source document, one after another. */
function buildPdf(sources: { doc: Doc; kept: ReturnType<Doc['pages']> }[]): Uint8Array | undefined {
  if (sources.reduce((n, source) => n + source.kept.length, 0) > MAX_PAGES) throw new PdfLimitError();
  const keptNodes = new Map<Dict, number>(); // a kept page's dictionary, to its number in the new file
  const out = new Map<number, Obj>(); // new number, to the object
  let next = 3; // 1 is the catalog, 2 the page tree
  const pageNumbers: number[] = [];
  for (const { kept } of sources) for (const { page } of kept) { keptNodes.set(page, next); pageNumbers.push(next++); }
  const pagesRef: Ref = { r: 2 };
  let position = 0;
  for (const { doc, kept } of sources) {
    const copied = new Map<number, number>(); // old number, to new
    const queue: number[] = [];
    const isPageNode = (d: Dict) => { const t = d.get('Type'); return isName(t) && (t.n === 'Page' || t.n === 'Pages'); };
    const copy = (o: Obj, depth = 0): Obj => {
      if (depth > 64) return null;
      if (isRef(o)) {
        const target = doc.objects.get(o.r);
        if (target === undefined) return null;
        if (isDict(target) && isPageNode(target)) { const k = keptNodes.get(target); return k === undefined ? null : { r: k }; }
        let n = copied.get(o.r);
        if (n === undefined) { n = next++; copied.set(o.r, n); queue.push(o.r); }
        return { r: n };
      }
      if (Array.isArray(o)) return o.map((x) => copy(x, depth + 1));
      if (isStream(o)) return { dict: copy(o.dict, depth + 1) as Dict, raw: o.raw };
      if (isDict(o)) { const d: Dict = new Map(); for (const [k, v] of o) d.set(k, copy(v, depth + 1)); return d; }
      return o;
    };
    kept.forEach(({ page, resources, attributes }) => {
      const d: Dict = new Map();
      for (const [k, v] of page) if (k !== 'Parent') d.set(k, copy(v));
      for (const key of ['MediaBox', 'CropBox', 'Rotate']) if (!d.has(key)) { const v = attributes.get(key); if (v !== undefined) d.set(key, copy(v)); }
      if (!d.has('Resources')) d.set('Resources', resources ? copy(resources) : new Map());
      d.set('Parent', pagesRef);
      out.set(pageNumbers[position++], d);
    });
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const old = queue[cursor];
      let o = doc.objects.get(old)!;
      // A stream's length is its own, whatever the old file said (it may have named another object).
      if (isStream(o)) o = { dict: new Map([...o.dict].filter(([k]) => k !== 'Length')), raw: o.raw };
      const c = copy(o);
      if (isStream(c)) c.dict.set('Length', c.raw.length);
      out.set(copied.get(old)!, c);
      if (next > 2_000_000) return undefined;
    }
  }
  out.set(1, new Map<string, Obj>([['Type', { n: 'Catalog' }], ['Pages', pagesRef]]));
  out.set(2, new Map<string, Obj>([['Type', { n: 'Pages' }], ['Kids', pageNumbers.map((r) => ({ r }))], ['Count', pageNumbers.length]]));
  return writePdf(out, next - 1);
}

function pdfObjectText(o: Obj): string {
  if (o === null) return 'null';
  if (typeof o === 'boolean') return o ? 'true' : 'false';
  if (typeof o === 'number') {
    // PDF has no exponent notation. Preserve small values instead of rounding them to zero.
    const value = String(o);
    if (!/[eE]/.test(value)) return value;
    const [mantissa, exponent] = value.split(/[eE]/);
    const sign = mantissa.startsWith('-') ? '-' : '';
    const [whole, fraction = ''] = mantissa.replace(/^-/, '').split('.');
    const digits = whole + fraction, point = whole.length + Number(exponent);
    return sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point));
  }
  if (isName(o)) return '/' + [...Buffer.from(o.n, 'latin1')].map((c) => (c > 0x20 && c < 0x7f && !DELIM.has(c) && c !== 0x23 ? String.fromCharCode(c) : '#' + c.toString(16).padStart(2, '0'))).join('');
  if (isStr(o)) return '<' + Buffer.from(o.s).toString('hex') + '>';
  if (isRef(o)) return `${o.r} 0 R`;
  if (Array.isArray(o)) return '[' + o.map(pdfObjectText).join(' ') + ']';
  if (isDict(o)) return '<<' + [...o].map(([k, v]) => pdfObjectText({ n: k }) + ' ' + pdfObjectText(v)).join(' ') + '>>';
  return '';
}

/** The bytes of a PDF made of these objects (numbers 1 to `count`, the first the catalog) with a classic cross-reference table. */
function writePdf(objects: Map<number, Obj>, count: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  const put = (s: string | Uint8Array) => { const b = typeof s === 'string' ? Buffer.from(s, 'latin1') : s; parts.push(b); length += b.length; };
  const offsets: number[] = [];
  put('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
  for (let n = 1; n <= count; n++) {
    offsets[n] = length;
    const o = objects.get(n) ?? null;
    put(`${n} 0 obj\n`);
    if (isStream(o)) { put(pdfObjectText(o.dict) + '\nstream\n'); put(o.raw); put('\nendstream'); } else put(pdfObjectText(o));
    put('\nendobj\n');
  }
  const xref = length;
  put(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<</Size ${count + 1} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

export type PdfCopiedObject = string | { dict: string; data: Buffer };

/** Copies references as objects, never by replacing text inside strings or binary streams. Shared per output document. */
export class PdfPageCopier {
  private readonly copied = new Map<Doc, Map<number, number>>();
  private readonly add: (object: PdfCopiedObject) => number;
  private readonly set: (id: number, object: PdfCopiedObject) => void;
  constructor(add: (object: PdfCopiedObject) => number, set: (id: number, object: PdfCopiedObject) => void) {
    this.add = add; this.set = set;
  }

  page(input: PdfImportedPage, parent: string, width: number, height: number, overlay?: number): string {
    const doc = input.source.doc;
    let copied = this.copied.get(doc);
    if (!copied) { copied = new Map(); this.copied.set(doc, copied); }
    const queue: number[] = [];
    const copy = (o: Obj, depth = 0): Obj => {
      if (depth > 64) throw new Error('PDF nesting limit');
      if (isRef(o)) {
        let id = copied!.get(o.r);
        if (id === undefined) {
          if (!doc.objects.has(o.r)) throw new Error('missing PDF object');
          id = this.add('null'); copied!.set(o.r, id); queue.push(o.r);
        }
        return { r: id };
      }
      if (Array.isArray(o)) return o.map(v => copy(v, depth + 1));
      if (isStream(o)) return { dict: copy(new Map([...o.dict].filter(([k]) => k !== 'Length')), depth + 1) as Dict, raw: o.raw };
      if (isDict(o)) {
        if (['Page', 'Pages', 'Catalog'].includes((o.get('Type') as Name)?.n)) throw new Error('unsupported page reference');
        return new Map([...o].map(([k, v]) => [k, copy(v, depth + 1)]));
      }
      return o;
    };
    const page: Dict = new Map();
    for (const [k, v] of input.page) if (!['Parent', 'Resources', 'Contents'].includes(k)) page.set(k, copy(v));
    for (const [k, v] of input.attributes) page.set(k, copy(v));
    const box = doc.get(input.attributes.get('MediaBox')) as number[];
    page.set('MediaBox', [box[0], box[1], box[0] + width, box[1] + height]);
    // Explicit defaults prevent attributes leaking in from an append destination's tree.
    if (!page.has('CropBox')) page.set('CropBox', page.get('MediaBox')!);
    if (!page.has('Rotate')) page.set('Rotate', 0);
    const resources = new Map(input.resources);
    const xobjects = doc.dict(resources.get('XObject'));
    // Dereference the category dictionary before adding our private overlay resource.
    if (xobjects) resources.set('XObject', xobjects);
    const copiedResources = copy(resources) as Dict;
    page.set('Resources', copiedResources);
    const contents = doc.get(input.page.get('Contents'));
    const parts = contents === undefined ? [] : Array.isArray(contents) ? contents : [input.page.get('Contents')!];
    const copiedContents = parts.map(v => copy(v));
    if (overlay !== undefined) {
      const xo = (copiedResources.get('XObject') as Dict | undefined) ?? new Map<string, Obj>();
      let name = 'OHOverlay';
      while (xo.has(name)) name += '_';
      xo.set(name, { r: overlay }); copiedResources.set('XObject', xo);
      const id = this.add({ dict: '', data: Buffer.from(`q /${name} Do Q`, 'latin1') });
      copiedContents.push({ r: id });
    }
    if (copiedContents.length) page.set('Contents', copiedContents);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const old = queue[cursor];
      const value = copy(doc.objects.get(old)!);
      const result = isStream(value)
        ? { dict: pdfObjectText(value.dict).slice(2, -2), data: Buffer.from(value.raw) }
        : pdfObjectText(value);
      this.set(copied.get(old)!, result);
    }
    return pdfObjectText(page).replace(/>>$/, ` /Parent ${parent} >>`);
  }
}

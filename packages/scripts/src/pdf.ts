// A minimal PDF (1.4) writer for Save Records as PDF: filled and stroked
// shapes, text in embedded WinAnsi TrueType subsets, and JPEG or PNG images.
// Coordinates are points from the page's top left, as on a FileMaker layout.
// Characters the fonts can't show have replacement glyphs; ActualText keeps
// their Unicode text for extraction.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { PdfPageCopier, PDF_IMPORT_LIMITS, type PdfImportedPage } from '../../calc/src/pdf-text.ts';

export type Rgb = [number, number, number];

export interface Stroke {
  color: Rgb;
  width: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type FontName =
  | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Helvetica-BoldOblique'
  | 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Times-BoldItalic'
  | 'Courier' | 'Courier-Bold' | 'Courier-Oblique' | 'Courier-BoldOblique';

export interface TextStyle {
  font?: FontName;
  size?: number;
  color?: Rgb;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Line height, as a multiple of the size. */
  lineHeight?: number;
  /** Inner space: top, right, bottom, left. */
  padding?: [number, number, number, number];
  underline?: boolean;
}

export type PdfOp =
  | ({ kind: 'rect'; fill?: Rgb; radius?: number; border?: Stroke } & Box)
  /** Borders drawn per side (top, right, bottom, left). */
  | ({ kind: 'sides'; sides: (Stroke | undefined)[] } & Box)
  | ({ kind: 'oval'; fill?: Rgb; border?: Stroke } & Box)
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  | ({ kind: 'text'; text: string; style?: TextStyle } & Box)
  /** An image scaled to fit the box, keeping its proportions, centered. */
  | ({ kind: 'image'; data: Uint8Array } & Box);

export interface PdfPage {
  width: number;
  height: number;
  ops: PdfOp[];
  imported?: PdfImportedPage;
  cropBox?: number[];
}

/**
 * Text width from the embedded font's WinAnsi metrics, in points. Combining
 * marks share the preceding glyph's advance; complex shaping is unsupported.
 */
export function textWidth(s: string, size: number, font: FontName = 'Helvetica'): number {
  const metrics = fontMetrics(Math.max(0, FONTS.indexOf(font)));
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    // Combining marks share the preceding glyph's advance. This is an estimate,
    // not complex-script shaping.
    const byte = c >= 32 && c <= 126 ? c : c >= 160 && c <= 255 ? c : WIN_ANSI[c] ?? 63;
    const fallback = c > 255 && WIN_ANSI[c] === undefined
      ? metrics.unicode[String(c)]?.[1] ?? fontMetrics(12).unicode[String(c)]?.[1]
      : undefined;
    w += /\p{Mark}/u.test(ch) ? 0 : fallback ?? metrics.widths[byte - 32] ?? metrics.widths[31];
  }
  return w * size / 1000;
}

/** Lines of text, including words longer than the box. `maxLines` bounds work for clipped fields. */
export function wrap(s: string, size: number, width: number, font?: FontName, maxLines = Infinity): string[] {
  const out: string[] = [];
  if (maxLines <= 0) return out;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const para of s.split(/\r\n|[\r\n\v]/)) {
    let line = '';
    for (const word of para.split(/(?<= )/)) {
      if (line && textWidth(line + word.trimEnd(), size, font) > width) {
        out.push(line.trimEnd());
        if (out.length >= maxLines) return out;
        line = '';
      }
      if (textWidth(word.trimEnd(), size, font) <= width) {
        line += word;
        continue;
      }
      // A field may contain a megabyte with no spaces. Keep only the lines it
      // can display and never build one megabyte-long PDF text operand.
      for (const { segment } of segmenter.segment(word)) {
        if (line && textWidth(line + segment, size, font) > width) {
          out.push(line.trimEnd());
          if (out.length >= maxLines) return out;
          line = '';
          if (segment === ' ') continue;
        }
        line += segment;
      }
    }
    out.push(line.trimEnd());
    if (out.length >= maxLines) return out;
  }
  return out;
}

// WinAnsi codes for the characters outside Latin-1 that it holds.
const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88,
  0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b,
  0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f,
};

/** A PDF string literal in WinAnsi bytes. */
function literal(s: string): string {
  let out = '(';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const b = c >= 32 && c <= 126 ? c : c >= 0xa0 && c <= 0xff ? c : WIN_ANSI[c] ?? 63;
    if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}

/** A PDF text string that keeps metadata and marked-content text in Unicode. */
function unicodeString(s: string): string {
  const b = Buffer.alloc(2 + s.length * 2);
  b.writeUInt16BE(0xfeff, 0);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2 + 2);
  return `<${b.toString('hex').toUpperCase()}>`;
}

/** Map the WinAnsi font's byte values to Unicode for text extractors. */
function winAnsiCMap(): Buffer {
  const reverse = new Map<number, number>();
  for (const [code, byte] of Object.entries(WIN_ANSI)) reverse.set(byte, Number(code));
  const rows: string[] = [];
  for (let byte = 32; byte <= 255; byte++) {
    const code = reverse.get(byte) ?? (byte >= 160 ? byte : byte <= 126 ? byte : undefined);
    if (code !== undefined) rows.push(`<${byte.toString(16).padStart(2, '0')}> <${code.toString(16).padStart(4, '0')}>`);
  }
  const groups: string[] = [];
  for (let i = 0; i < rows.length; i += 100) groups.push(`${Math.min(100, rows.length - i)} beginbfchar\n${rows.slice(i, i + 100).join('\n')}\nendbfchar`);
  return Buffer.from(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Tabularius-WinAnsi def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${groups.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`, 'ascii');
}

function codepointHex(cp: number): string {
  if (cp <= 0xffff) return cp.toString(16).padStart(4, '0').toUpperCase();
  const n = cp - 0x10000;
  return (0xd800 + (n >> 10)).toString(16).padStart(4, '0').toUpperCase()
    + (0xdc00 + (n & 1023)).toString(16).padStart(4, '0').toUpperCase();
}

function unicodeCMap(i: number): Buffer {
  const rows = new Map<number, number>();
  for (const [code, [gid]] of Object.entries(fontMetrics(i).unicode)) if (!rows.has(gid)) rows.set(gid, Number(code));
  const mappings = [...rows].sort((a, b) => a[0] - b[0]).map(([gid, cp]) => `<${gid.toString(16).padStart(4, '0').toUpperCase()}> <${codepointHex(cp)}>`);
  const blocks: string[] = [];
  for (let at = 0; at < mappings.length; at += 100) blocks.push(`${Math.min(100, mappings.length - at)} beginbfchar\n${mappings.slice(at, at + 100).join('\n')}\nendbfchar`);
  return Buffer.from(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Tabularius-Unicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`, 'ascii');
}

const FONTS: FontName[] = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
];

type EmbeddedFont = { widths: number[]; unicode: Record<string, [number, number]>; bbox: number[]; ascent: number; descent: number; italic: number; glyphs: number; sourceGlyphs: number };
const fontFiles = [
  'Arimo-Regular', 'Arimo-Bold', 'Arimo-Italic', 'Arimo-BoldItalic',
  'Tinos-Regular', 'Tinos-Bold', 'Tinos-Italic', 'Tinos-BoldItalic',
  'Cousine-Regular', 'Cousine-Bold', 'Cousine-Italic', 'Cousine-BoldItalic',
  'NotoEmoji-Regular',
];
let fontMetadata: Record<string, EmbeddedFont> | undefined;
const fontBytes = new Map<number, Buffer>();
function fontMetrics(i: number): EmbeddedFont {
  fontMetadata ??= JSON.parse(readFileSync(new URL('../fonts/metrics.json', import.meta.url), 'utf8')) as Record<string, EmbeddedFont>;
  const name = fontFiles[i];
  const metrics = fontMetadata[name];
  if (!metrics || metrics.widths.length !== 224 || metrics.glyphs >= metrics.sourceGlyphs) throw new Error(`Invalid embedded PDF font ${name}`);
  return metrics;
}
function embeddedFont(i: number): { data: Buffer; metrics: EmbeddedFont; name: string } {
  const name = fontFiles[i];
  let data = fontBytes.get(i);
  if (!data) { data = readFileSync(new URL(`../fonts/${name}.ttf`, import.meta.url)); fontBytes.set(i, data); }
  return { data, metrics: fontMetrics(i), name: `TABUL${String.fromCharCode(65 + i)}+${name}` };
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const rgb = (c: Rgb) => c.map((x) => num(Math.max(0, Math.min(255, x)) / 255)).join(' ');

/** A PDF image: its dictionary entries and data, plus an alpha mask. */
interface Image {
  width: number;
  height: number;
  dict: string;
  data: Buffer;
  mask?: { dict: string; data: Buffer };
}

/** A JPEG's size and color channels, from its frame header. */
function jpeg(b: Buffer): Image | undefined {
  for (let at = 2; at + 9 < b.length;) {
    if (b[at] !== 0xff) return undefined;
    const marker = b[at + 1];
    const length = b.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.readUInt16BE(at + 5);
      const width = b.readUInt16BE(at + 7);
      const channels = b[at + 9];
      const space = channels === 1 ? '/DeviceGray' : channels === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      return { width, height, dict: `/ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode`, data: b };
    }
    at += 2 + length;
  }
  return undefined;
}

/** Undoes PNG's per-row filters. */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const at = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[at + x - bpp] : 0;
      const b = y ? out[at - stride + x] : 0;
      const c = x >= bpp && y ? out[at - stride + x - bpp] : 0;
      let v = row[x];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[at + x] = v & 0xff;
    }
  }
  return out;
}

const MAX_IMAGE_PIXELS = 25_000_000;

/** A PNG: passed through with PDF's PNG predictor, or split into color and alpha when it has an alpha channel. */
function png(b: Buffer): Image | undefined {
  if (b.length < 8 || !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined;
  let at = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let transparent = false;
  let palette: Buffer | undefined;
  const idat: Buffer[] = [];
  while (at + 8 <= b.length) {
    const length = b.readUInt32BE(at);
    if (length > b.length - at - 12) return undefined;
    const kind = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      if (length < 13) return undefined;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') transparent = true;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  // A header can promise any size; a picture past this is left out rather than inflated (a small file can hold gigabytes).
  if (!width || !height || transparent || interlace > 1 || !idat.length || width * height > MAX_IMAGE_PIXELS) return undefined;
  if (![0, 2, 3, 4, 6].includes(type) || (interlace && depth !== 8 && !([4, 6].includes(type) && depth === 16))) return undefined;
  if ([4, 6].includes(type) && depth !== 8 && depth !== 16) return undefined;
  if (type === 0 && ![1, 2, 4, 8, 16].includes(depth)) return undefined;
  if (type === 2 && depth !== 8 && depth !== 16) return undefined;
  if (type === 3 && (![1, 2, 4, 8].includes(depth) || !palette || !palette.length || palette.length % 3 || palette.length > 768)) return undefined;
  const zipped = Buffer.concat(idat);
  const channels = type === 2 ? 3 : type === 4 ? 2 : type === 6 ? 4 : 1;
  const bytesPerPixel = channels * (depth === 16 ? 2 : 1);
  let pixels: Buffer | undefined;
  if (interlace || type === 4 || type === 6) {
    const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    const sizes = passes.filter(([x, y]) => x < width && y < height).map(([x, y, dx, dy]) => [Math.ceil((width - x) / dx), Math.ceil((height - y) / dy), x, y, dx, dy]);
    const expected = sizes.reduce((sum, [w, h]) => sum + h * (w * bytesPerPixel + 1), 0);
    let inflated: Buffer;
    try {
      inflated = inflateSync(zipped, { maxOutputLength: expected });
    } catch {
      return undefined;
    }
    if (inflated.length !== expected) return undefined;
    pixels = Buffer.alloc(width * height * bytesPerPixel);
    let offset = 0;
    for (const [w, h, x0, y0, dx, dy] of sizes) {
      const length = h * (w * bytesPerPixel + 1);
      for (let y = 0; y < h; y++) if (inflated[offset + y * (w * bytesPerPixel + 1)] > 4) return undefined;
      const pass = unfilter(inflated.subarray(offset, offset + length), w, h, bytesPerPixel);
      offset += length;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        pass.copy(pixels, ((y0 + y * dy) * width + x0 + x * dx) * bytesPerPixel, (y * w + x) * bytesPerPixel, (y * w + x + 1) * bytesPerPixel);
      }
    }
  }
  if (type === 0 || type === 2 || type === 3) {
    if (!pixels) {
      const rowBytes = Math.ceil(width * channels * depth / 8);
      const expected = height * (rowBytes + 1);
      let raw: Buffer;
      try {
        raw = inflateSync(zipped, { maxOutputLength: expected });
      } catch {
        return undefined;
      }
      if (raw.length !== expected) return undefined;
      for (let y = 0; y < height; y++) if (raw[y * (rowBytes + 1)] > 4) return undefined;
    }
    const colors = type === 2 ? 3 : 1;
    const space = type === 3 && palette
      ? `[/Indexed /DeviceRGB ${palette.length / 3 - 1} <${palette.toString('hex')}>]`
      : type === 2 ? '/DeviceRGB' : '/DeviceGray';
    const data = pixels ? (() => {
      const rows = Buffer.alloc(height * (width * bytesPerPixel + 1));
      for (let y = 0; y < height; y++) pixels!.copy(rows, y * (width * bytesPerPixel + 1) + 1, y * width * bytesPerPixel, (y + 1) * width * bytesPerPixel);
      return deflateSync(rows);
    })() : zipped;
    return {
      width, height, data,
      dict: `/ColorSpace ${space} /BitsPerComponent ${depth} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent ${depth} /Columns ${width} >>`,
    };
  }
  if (!pixels) return undefined;
  const color = Buffer.alloc(width * height * (channels - 1));
  const alpha = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < channels - 1; k++) color[i * (channels - 1) + k] = pixels[i * bytesPerPixel + k * (depth === 16 ? 2 : 1)];
    alpha[i] = pixels[i * bytesPerPixel + (channels - 1) * (depth === 16 ? 2 : 1)];
  }
  return {
    width, height, data: deflateSync(color),
    dict: `/ColorSpace ${type === 6 ? '/DeviceRGB' : '/DeviceGray'} /BitsPerComponent 8 /Filter /FlateDecode`,
    mask: { dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, data: deflateSync(alpha) },
  };
}

/** The image in a file's bytes, when it is a JPEG or a PNG PDF can hold. */
export function readImage(data: Uint8Array): Image | undefined {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (b.toString('latin1', 1, 4) === 'PNG') return png(b);
  return undefined;
}

/** A rounded rectangle's path, with the corners drawn as Bézier curves. */
function roundedPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  const k = r * 0.5523;
  return [
    `${num(x + r)} ${num(y)} m`,
    `${num(x + w - r)} ${num(y)} l`, `${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c`,
    `${num(x + w)} ${num(y + h - r)} l`, `${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c`,
    `${num(x + r)} ${num(y + h)} l`, `${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c`,
    `${num(x)} ${num(y + r)} l`, `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`,
  ].join(' ');
}

function ovalPath(x: number, y: number, w: number, h: number): string {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry, kx = rx * 0.5523, ky = ry * 0.5523;
  return [
    `${num(cx + rx)} ${num(cy)} m`,
    `${num(cx + rx)} ${num(cy + ky)} ${num(cx + kx)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c`,
    `${num(cx - kx)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ky)} ${num(cx - rx)} ${num(cy)} c`,
    `${num(cx - rx)} ${num(cy - ky)} ${num(cx - kx)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c`,
    `${num(cx + kx)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ky)} ${num(cx + rx)} ${num(cy)} c h`,
  ].join(' ');
}

/** Paint a closed path: fill, stroke or both. */
function paint(path: string, fill?: Rgb, border?: Stroke): string {
  if (!fill && !border) return '';
  let s = 'q ';
  if (fill) s += `${rgb(fill)} rg `;
  if (border) s += `${rgb(border.color)} RG ${num(border.width)} w `;
  return `${s}${path} ${fill && border ? 'B' : fill ? 'f' : 'S'} Q`;
}

function lineText(s: string, fontIndex: number, size: number, unicodeUsed?: Set<number>): { operators: string; actual: boolean } {
  const runs: { font?: number; text: string }[] = [];
  const main = fontMetrics(fontIndex).unicode;
  const emoji = fontMetrics(12).unicode;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)) {
    const cp = segment.codePointAt(0)!;
    const single = segment.length === (cp > 0xffff ? 2 : 1);
    const font = single && main[String(cp)] ? fontIndex : single && emoji[String(cp)] ? 12 : undefined;
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += segment;
    else runs.push({ font, text: segment });
  }
  const parts: string[] = [];
  let actual = false;
  for (const run of runs) {
    if (run.font === undefined) {
      parts.push(`${literal(run.text)} Tj`);
      actual ||= [...run.text].some((ch) => ch.codePointAt(0)! > 255 && WIN_ANSI[ch.codePointAt(0)!] === undefined);
      continue;
    }
    unicodeUsed?.add(run.font);
    actual = true;
    const glyphs = /[\u0590-\u05ff]/u.test(run.text) ? [...run.text].reverse() : [...run.text];
    const map = fontMetrics(run.font).unicode;
    const bytes = glyphs.map((ch) => map[String(ch.codePointAt(0)!)]![0].toString(16).padStart(4, '0')).join('');
    parts.push(`/U${run.font + 1} ${num(size)} Tf <${bytes}> Tj /F${fontIndex + 1} ${num(size)} Tf`);
  }
  return { operators: parts.join(' '), actual };
}

function content(page: PdfPage, images: Image[], imageIndex: Map<string, number>, fontsUsed?: Set<number>, pageImages?: Set<number>, unicodeUsed?: Set<number>): string {
  const H = page.height;
  const ops: string[] = [];
  for (const op of page.ops) {
    switch (op.kind) {
      case 'rect': {
        if (op.width <= 0 || op.height <= 0) break;
        const y = H - op.top - op.height;
        const path = op.radius ? roundedPath(op.left, y, op.width, op.height, op.radius) : `${num(op.left)} ${num(y)} ${num(op.width)} ${num(op.height)} re`;
        ops.push(paint(path, op.fill, op.border));
        break;
      }
      case 'oval':
        if (op.width > 0 && op.height > 0) ops.push(paint(ovalPath(op.left, H - op.top - op.height, op.width, op.height), op.fill, op.border));
        break;
      case 'sides': {
        const [t, r, b, l] = op.sides;
        const x1 = op.left, x2 = op.left + op.width, y1 = H - op.top, y2 = H - op.top - op.height;
        const side = (s: Stroke | undefined, ax: number, ay: number, bx: number, by: number) => {
          if (s && s.width > 0) ops.push(`q ${rgb(s.color)} RG ${num(s.width)} w ${num(ax)} ${num(ay)} m ${num(bx)} ${num(by)} l S Q`);
        };
        // Strokes sit inside the box, as CSS borders do.
        side(t, x1, y1 - (t?.width ?? 0) / 2, x2, y1 - (t?.width ?? 0) / 2);
        side(r, x2 - (r?.width ?? 0) / 2, y1, x2 - (r?.width ?? 0) / 2, y2);
        side(b, x1, y2 + (b?.width ?? 0) / 2, x2, y2 + (b?.width ?? 0) / 2);
        side(l, x1 + (l?.width ?? 0) / 2, y1, x1 + (l?.width ?? 0) / 2, y2);
        break;
      }
      case 'line':
        if (op.stroke.width > 0) ops.push(`q ${rgb(op.stroke.color)} RG ${num(op.stroke.width)} w ${num(op.x1)} ${num(H - op.y1)} m ${num(op.x2)} ${num(H - op.y2)} l S Q`);
        break;
      case 'image': {
        // One copy of each picture, however many pages show it (a logo on every page of a big found set).
        const key = createHash('sha1').update(op.data).digest('hex');
        let n = imageIndex.get(key);
        if (n === undefined) {
          const img = readImage(op.data);
          if (!img) break;
          n = images.push(img) - 1;
          imageIndex.set(key, n);
        }
        pageImages?.add(n);
        const img = images[n];
        const scale = Math.min(op.width / img.width, op.height / img.height);
        const w = img.width * scale, h = img.height * scale;
        const x = op.left + (op.width - w) / 2, y = H - op.top - op.height + (op.height - h) / 2;
        ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /I${n} Do Q`);
        break;
      }
      case 'text': {
        if (!op.text || op.width <= 0 || op.height <= 0) break;
        const st = op.style ?? {};
        const font = st.font ?? 'Helvetica';
        const fontIndex = Math.max(0, FONTS.indexOf(font));
        fontsUsed?.add(fontIndex);
        const size = st.size ?? 10;
        const lead = size * (st.lineHeight ?? 1.2);
        const [pt, pr, pb, pl] = st.padding ?? [1, 1, 1, 1];
        const inner = op.width - pl - pr;
        const shown = wrap(op.text, size, Math.max(1, inner), font, Math.max(1, Math.ceil((op.height - pt - pb) / lead)));
        const block = shown.length * lead;
        const free = op.height - pt - pb - block;
        const top = op.top + pt + (st.valign === 'middle' ? free / 2 : st.valign === 'bottom' ? free : 0);
        // Clip to the box, as FileMaker cuts off text that doesn't fit.
        ops.push(`q ${num(op.left)} ${num(H - op.top - op.height)} ${num(op.width)} ${num(op.height)} re W n`);
        ops.push(`BT /F${fontIndex + 1} ${num(size)} Tf ${rgb(st.color ?? [0, 0, 0])} rg`);
        // The baseline sits about 80% of the size below the top of the line box, with the extra leading split above and below.
        let prev = [0, 0];
        shown.forEach((l, i) => {
          const w = textWidth(l, size, font);
          const x = op.left + pl + (st.align === 'center' ? (inner - w) / 2 : st.align === 'right' ? inner - w : 0);
          const y = H - (top + i * lead + (lead - size) / 2 + size * 0.8);
          // ActualText preserves the logical Unicode string when the standard
          // font has no glyph or bidi reorders a simple RTL run.
          const display = l.normalize('NFC');
          const shown = lineText(display, fontIndex, size, unicodeUsed);
          const replacement = display !== l || shown.actual;
          ops.push(`${num(x - prev[0])} ${num(y - prev[1])} Td ${replacement ? `/Span << /ActualText ${unicodeString(l)} >> BDC ` : ''}${shown.operators}${replacement ? ' EMC' : ''}`);
          prev = [x, y];
        });
        ops.push('ET');
        if (st.underline) {
          shown.forEach((l, i) => {
            const w = textWidth(l, size, font);
            const x = op.left + pl + (st.align === 'center' ? (inner - w) / 2 : st.align === 'right' ? inner - w : 0);
            const y = H - (top + i * lead + (lead - size) / 2 + size * 0.9);
            if (w > 0) ops.push(`${rgb(st.color ?? [0, 0, 0])} RG ${num(size / 15)} w ${num(x)} ${num(y)} m ${num(x + w)} ${num(y)} l S`);
          });
        }
        ops.push('Q');
        break;
      }
    }
  }
  return ops.filter(Boolean).join('\n');
}

type PdfObject = string | { dict: string; data: Buffer };

function addFont(i: number, cmap: number, add: (o: PdfObject) => number): number {
  const { data, metrics, name } = embeddedFont(i);
  const program = add({ dict: `/Length1 ${data.length}`, data });
  const descriptor = add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${metrics.italic ? 96 : 32} /FontBBox [${metrics.bbox.join(' ')}] /ItalicAngle ${num(metrics.italic)} /Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${metrics.ascent} /StemV ${i % 4 === 1 || i % 4 === 3 ? 120 : 80} /FontFile2 ${program} 0 R >>`);
  return add(`<< /Type /Font /Subtype /TrueType /BaseFont /${name} /FirstChar 32 /LastChar 255 /Widths [${metrics.widths.join(' ')}] /FontDescriptor ${descriptor} 0 R /Encoding /WinAnsiEncoding /ToUnicode ${cmap} 0 R >>`);
}

function addUnicodeFont(i: number, add: (o: PdfObject) => number): number {
  const { data, metrics, name } = embeddedFont(i);
  const program = add({ dict: `/Length1 ${data.length}`, data });
  const descriptor = add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${metrics.italic ? 96 : 32} /FontBBox [${metrics.bbox.join(' ')}] /ItalicAngle ${num(metrics.italic)} /Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${metrics.ascent} /StemV 80 /FontFile2 ${program} 0 R >>`);
  const widths = [...new Map(Object.values(metrics.unicode).map(([gid, width]) => [gid, width])).entries()].sort((a, b) => a[0] - b[0]);
  const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 500 /W [${widths.map(([gid, width]) => `${gid} [${width}]`).join(' ')}] /CIDToGIDMap /Identity >>`);
  const cmap = add({ dict: '', data: unicodeCMap(i) });
  return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${cmap} 0 R >>`);
}

/**
 * The objects that draw these pages: fonts, images, then each page's content
 * and page. Numbered from `first`; each page names `parent` as its page tree.
 */
function pageObjects(pages: PdfPage[], first: number, parent: string, explicit = false): { objects: PdfObject[]; kids: string[] } {
  const images: Image[] = [];
  const imageIndex = new Map<string, number>();
  const fontsUsed = new Set<number>();
  const unicodeUsed = new Set<number>();
  const streams = pages.map((p) => Buffer.from(content(p, images, imageIndex, fontsUsed, undefined, unicodeUsed), 'latin1'));
  const objects: PdfObject[] = [];
  const hasImports = pages.some(p => p.imported);
  let copiedBytes = 0;
  const objectSize = (o: PdfObject) => (typeof o === 'string' ? o.length : o.dict.length + o.data.length) + 128;
  const account = (delta: number) => {
    if (hasImports && copiedBytes + delta > PDF_IMPORT_LIMITS.bytes) throw new PdfAppendError('PDF size limit');
    copiedBytes += delta;
  };
  const add = (o: PdfObject) => {
    if (hasImports && objects.length >= PDF_IMPORT_LIMITS.objects) throw new PdfAppendError('PDF object limit');
    account(objectSize(o));
    objects.push(o);
    return first + objects.length - 1;
  };
  // Pages that are only imported draw nothing, so they need no fonts and no text map.
  const needsDrawing = pages.some(p => !p.imported || p.ops.length);
  const cmapRef = needsDrawing ? add({ dict: '', data: winAnsiCMap() }) : 0;
  const fontRefs = [...fontsUsed].sort((a, b) => a - b).map((i) => `/F${i + 1} ${addFont(i, cmapRef, add)} 0 R`);
  const unicodeRefs = [...unicodeUsed].sort((a, b) => a - b).map((i) => `/U${i + 1} ${addUnicodeFont(i, add)} 0 R`);
  const imageRefs = images.map((img, i) => {
    const mask = img.mask ? ` /SMask ${add(img.mask)} 0 R` : '';
    return `/I${i} ${add({ dict: `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ${img.dict}${mask}`, data: img.data })} 0 R`;
  });
  const resources = `<< /Font << ${[...fontRefs, ...unicodeRefs].join(' ')} >>${imageRefs.length ? ` /XObject << ${imageRefs.join(' ')} >>` : ''} >>`;
  const copier = new PdfPageCopier(add, (id, o) => {
    account(objectSize(o) - objectSize(objects[id - first]));
    objects[id - first] = o;
  });
  const kids = pages.map((p, i) => {
    if (p.imported) {
      const overlay = p.ops.length ? add({ dict: `/Type /XObject /Subtype /Form /BBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources ${resources}`, data: streams[i] }) : undefined;
      return `${add(copier.page(p.imported, parent, p.width, p.height, overlay))} 0 R`;
    }
    const contentRef = add({ dict: '', data: streams[i] });
    const box = `[0 0 ${num(p.width)} ${num(p.height)}]`;
    // Pages added to another PDF's tree say what they would otherwise inherit from it (a crop box, a rotation).
    const crop = p.cropBox ? `[${p.cropBox.map(num).join(' ')}]` : box;
    const own = explicit ? ` /CropBox ${crop} /Rotate 0` : p.cropBox ? ` /CropBox ${crop}` : '';
    return `${add(`<< /Type /Page /Parent ${parent} /MediaBox ${box}${own} /Resources ${resources} /Contents ${contentRef} 0 R >>`)} 0 R`;
  });
  return { objects, kids };
}

/** An object's bytes, as numbered. */
function objectBytes(n: number, o: PdfObject, gen = 0): Buffer[] {
  if (typeof o === 'string') return [Buffer.from(`${n} ${gen} obj\n${o}\nendobj\n`, 'latin1')];
  return [Buffer.from(`${n} ${gen} obj\n<< ${o.dict}${o.dict ? ' ' : ''}/Length ${o.data.length} >>\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')];
}

/** The bytes of a PDF with these pages. */
export function pdf(pages: PdfPage[], metadata: string | Record<string, string> = ''): Buffer {
  if (!pages.length) pages = [{ width: 612, height: 792, ops: [] }];
  const fields = typeof metadata === 'string' ? { Title: metadata } : metadata;
  const names: Record<string, string> = { Title: 'Title', Author: 'Author', Subject: 'Subject', Keywords: 'Keywords', Creator: 'Creator', Producer: 'Producer', Company: 'Company' };
  const info = Object.entries(fields).filter(([k]) => names[k] && k !== 'Producer').map(([k, v]) => `/${names[k]} ${unicodeString(v)}`).join(' ');
  // Objects: 1 catalog, 2 page tree, 3 info, then fonts, images (and masks), and a content and page per page.
  const drawn = pageObjects(pages, 4, '2 0 R');
  const objects: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${drawn.kids.join(' ')}] /Count ${pages.length} >>`,
    `<< /Producer (Tabularius) ${info} >>`,
    ...drawn.objects,
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let size = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(size);
    for (const b of objectBytes(i + 1, o)) {
      chunks.push(b);
      size += b.length;
    }
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(chunks);
}

/** Incremental PDF serializer: only one drawn page and the page IDs stay in memory. */
export function createPdfWriter(sink: (bytes: Buffer) => void, title = '') {
  const offsets: number[] = [];
  let length = 0;
  let next = 4;
  const push = (bytes: Buffer) => { sink(bytes); length += bytes.length; };
  const reserve = () => next++;
  const write = (id: number, obj: PdfObject) => {
    offsets[id] = length;
    for (const bytes of objectBytes(id, obj)) push(bytes);
  };
  push(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'));
  const cmap = reserve();
  write(cmap, { dict: '', data: winAnsiCMap() });
  const add = (obj: PdfObject) => { const id = reserve(); write(id, obj); return id; };
  const fontIds = new Map<number, number>();
  const unicodeIds = new Map<number, number>();
  const images: Image[] = [];
  const imageIndex = new Map<string, number>();
  const imageIds: number[] = [];
  const kids: number[] = [];
  const emit = (page: PdfPage) => {
    const pageFonts = new Set<number>();
    const pageImages = new Set<number>();
    const pageUnicode = new Set<number>();
    const drawn = Buffer.from(content(page, images, imageIndex, pageFonts, pageImages, pageUnicode), 'latin1');
    for (const i of pageFonts) if (!fontIds.has(i)) fontIds.set(i, addFont(i, cmap, add));
    for (const i of pageUnicode) if (!unicodeIds.has(i)) unicodeIds.set(i, addUnicodeFont(i, add));
    while (imageIds.length < images.length) {
      const img = images[imageIds.length];
      const mask = img.mask ? ` /SMask ${(() => { const id = reserve(); write(id, img.mask!); return id; })()} 0 R` : '';
      const id = reserve();
      write(id, { dict: `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ${img.dict}${mask}`, data: img.data });
      imageIds.push(id);
      // The image object is on disk now. Repeated uses need dimensions and its
      // object number, not another copy of its compressed pixels.
      img.data = Buffer.alloc(0);
      if (img.mask) img.mask.data = Buffer.alloc(0);
    }
    const contents = reserve();
    write(contents, { dict: '', data: drawn });
    const id = reserve();
    const box = `[0 0 ${num(page.width)} ${num(page.height)}]`;
    const fonts = [
      ...[...pageFonts].sort((a, b) => a - b).map((i) => `/F${i + 1} ${fontIds.get(i)} 0 R`),
      ...[...pageUnicode].sort((a, b) => a - b).map((i) => `/U${i + 1} ${unicodeIds.get(i)} 0 R`),
    ].join(' ');
    const xobjects = pageImages.size ? ` /XObject << ${[...pageImages].map((i) => `/I${i} ${imageIds[i]} 0 R`).join(' ')} >>` : '';
    write(id, `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Resources << /Font << ${fonts} >>${xobjects} >> /Contents ${contents} 0 R >>`);
    kids.push(id);
  };
  let finished = false;
  return {
    addPage(page: PdfPage): void {
      if (finished) throw new Error('PDF writer is finished');
      emit(page);
    },
    finish(): void {
      if (finished) throw new Error('PDF writer is finished');
      if (!kids.length) emit({ width: 612, height: 792, ops: [] });
      write(1, '<< /Type /Catalog /Pages 2 0 R >>');
      write(2, `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`);
      write(3, `<< /Producer (Tabularius) /Title ${unicodeString(title)} >>`);
      const xrefAt = length;
      const size = next;
      push(Buffer.from(`xref\n0 ${size}\n0000000000 65535 f \n`, 'ascii'));
      for (let id = 1; id < size; id++) {
        if (offsets[id] === undefined) throw new Error(`PDF object ${id} was not written`);
        push(Buffer.from(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`, 'ascii'));
      }
      push(Buffer.from(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'ascii'));
      finished = true;
    },
  };
}

/** Serialize pages one at a time to a caller's sink. */
export function writePdf(pages: Iterable<PdfPage>, sink: (bytes: Buffer) => void, title = ''): void {
  const writer = createPdfWriter(sink, title);
  for (const page of pages) writer.addPage(page);
  writer.finish();
}

/**
 * Save Records as PDF [ Append ]: the bytes to add at the end of the PDF in
 * `existing` so it has these pages after its own, as an incremental update
 * (the bytes already there stay as they are; a new page tree object and the
 * new pages follow, so the file is only ever appended to). Works on
 * PDFs with a classic cross-reference table, as this writer makes, and on
 * ones with Flate-compressed cross-reference and object streams (PDF 1.5);
 * throws PdfAppendError for one it can't add to (encrypted, compressed some
 * other way, a damaged file).
 */
export function appendPdf(existing: Buffer, pages: PdfPage[]): Buffer {
  /** Objects the cross-reference sections of a PDF to add to may list in all (a file of a million objects is a large one). */
  const MAX_XREF_ENTRIES = 1_000_000;
  let listed = 0;
  if (!pages.length) return Buffer.alloc(0);
  const text = existing.toString('latin1');
  const fail = (why: string): never => {
    throw new PdfAppendError(why);
  };
  const sx = text.lastIndexOf('startxref');
  if (sx < 0) fail('it has no cross-reference table');
  const lastXref = Number(/^startxref\s+(\d+)/.exec(text.slice(sx))?.[1] ?? NaN);
  if (!Number.isFinite(lastXref) || lastXref >= existing.length) fail('its cross-reference offset is wrong');

  // Every object's place, newest section first, following /Prev back: an offset
  // in the file, or (in a PDF with compressed cross-references) an index in an
  // object stream; `at` -1 is a free object a newer section saw first.
  const offsets = new Map<number, { at: number; gen: number } | { in: number; index: number }>();
  let trailer = '';
  let streams = false; // the newest section is a cross-reference stream, so ours is one too
  const seen = new Set<number>();
  const crossReferenceStream = (at: number): string => {
    const head = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(at, at + 40)) ?? fail('a cross-reference section is damaged');
    const dict = dictAt(text, text.indexOf('<<', at + head![0].length)) ?? fail('a cross-reference stream is damaged');
    if (!/\/Type\s*\/XRef\b/.test(dict)) fail('a cross-reference section is damaged');
    const w = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dict)?.slice(1).map(Number) ?? fail('a cross-reference stream has no field widths');
    const width = w[0] + w[1] + w[2];
    if (!width || w.some((n) => n > 8)) fail('a cross-reference stream is damaged');
    const index = (/\/Index\s*\[([\d\s]*)\]/.exec(dict)?.[1].trim().split(/\s+/).map(Number))
      ?? [0, Number(/\/Size\s+(\d+)/.exec(dict)?.[1] ?? NaN)];
    if (index.length % 2 || index.some((n) => !Number.isFinite(n))) fail('a cross-reference stream is damaged');
    // Its rows can't be more than the objects it counts (/Size), nor more than this reader keeps in all its sections.
    let count = 0;
    for (let i = 1; i < index.length; i += 2) count += index[i];
    listed += count;
    if (count > Number(/\/Size\s+(\d+)/.exec(dict)?.[1] ?? NaN)) fail('a cross-reference stream lists more objects than its size');
    if (listed > MAX_XREF_ENTRIES) fail('it lists too many objects to add to');
    // Inflated no further than its rows need (a row, and the predictor's byte in front of it), so each section costs what it lists.
    const data = decoded(dict, streamBytes(text.indexOf('<<', at + head![0].length) + dict.length, dict, true), Math.max(1, count * (width + 1)));
    const field = (from: number, size: number) => {
      let v = 0;
      for (let k = 0; k < size; k++) v = v * 256 + data[from + k];
      return v;
    };
    let row = 0;
    for (let i = 0; i < index.length; i += 2) {
      for (let k = 0; k < index[i + 1]; k++, row++) {
        const from = row * width;
        if (from + width > data.length) fail('a cross-reference stream is damaged');
        const n = index[i] + k;
        if (offsets.has(n)) continue;
        const type = w[0] ? field(from, w[0]) : 1;
        const [a, b] = [field(from + w[0], w[1]), field(from + w[0] + w[1], w[2])];
        if (type === 1) offsets.set(n, { at: a, gen: b });
        else if (type === 2) offsets.set(n, { in: a, index: b });
        else offsets.set(n, { at: -1, gen: 0 }); // free, or a type this reader doesn't know: nothing to find there
      }
    }
    return dict;
  };
  for (let at: number | undefined = lastXref; at !== undefined;) {
    if (seen.has(at) || seen.size > 1000) fail('its cross-references loop');
    seen.add(at);
    let dict: string;
    if (text.startsWith('xref', at)) {
      const t = text.indexOf('trailer', at);
      if (t < 0) fail('a cross-reference section has no trailer');
      const lines = text.slice(at + 4, t).trim().split(/\r\n|\r|\n/);
      const free: number[] = [];
      for (let i = 0; i < lines.length;) {
        const head = /^(\d+)\s+(\d+)$/.exec(lines[i].trim());
        if (!head) fail('a cross-reference section is damaged');
        const [from, count] = [Number(head![1]), Number(head![2])];
        listed += count;
        if (listed > MAX_XREF_ENTRIES) fail('it lists too many objects to add to');
        for (let k = 0; k < count; k++) {
          const e = /^(\d{10})\s+(\d{5})\s+([nf])/.exec(lines[i + 1 + k]?.trim() ?? '');
          if (!e) fail('a cross-reference entry is damaged');
          if (e![3] === 'n' && !offsets.has(from + k)) offsets.set(from + k, { at: Number(e![1]), gen: Number(e![2]) });
          else if (e![3] === 'f') free.push(from + k);
        }
        i += 1 + count;
      }
      dict = dictAt(text, text.indexOf('<<', t)) ?? fail('a trailer is damaged');
      // A hybrid file's table marks free what its stream keeps compressed, for older readers.
      const hybrid = /\/XRefStm\s+(\d+)/.exec(dict);
      if (hybrid) crossReferenceStream(Number(hybrid[1]));
      for (const n of free) if (!offsets.has(n)) offsets.set(n, { at: -1, gen: 0 }); // free: a newer section saw it first
    } else {
      dict = crossReferenceStream(at);
      if (!trailer) streams = true;
    }
    if (!trailer) trailer = dict;
    const prev = /\/Prev\s+(\d+)/.exec(dict);
    at = prev ? Number(prev[1]) : undefined;
  }
  if (/\/Encrypt\b/.test(trailer)) fail('it is encrypted');
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? NaN);
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trailer);
  if (!Number.isFinite(size) || !root) fail('its trailer names no catalog');

  /** The bytes of the stream whose dictionary ends at `end`; a length kept in another object is looked up unless `direct`. */
  function streamBytes(end: number, dict: string, direct = false): Buffer {
    const start = /^\s*stream(\r\n|\n)/.exec(text.slice(end, end + 20)) ?? fail('a stream is damaged');
    const length = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict) ?? fail('a stream has no length');
    const n = length![2] === undefined ? Number(length![1])
      : direct ? fail('a cross-reference stream is damaged') : Number(/^\s*(\d+)/.exec(body(Number(length![1])))?.[1] ?? NaN);
    const from = end + start![0].length;
    if (!Number.isFinite(n) || from + n > existing.length) fail('a stream is damaged');
    return existing.subarray(from, from + n);
  }
  /** A stream's data, inflated and un-predicted (the PNG predictors cross-reference streams use). */
  function decoded(dict: string, raw: Buffer, limit = 256 * 1024 * 1024): Buffer {
    const list = /\/Filter\s*\[([^\]]*)\]/.exec(dict);
    const filters = list ? list[1].match(/\/\w+/g) ?? [] : (/\/Filter\s*(\/\w+)/.exec(dict)?.slice(1) ?? []);
    if (!filters.length) return raw;
    if (filters.length > 1 || filters[0] !== '/FlateDecode') fail('it uses a compression it cannot read');
    let data: Buffer;
    try {
      data = inflateSync(raw, { maxOutputLength: limit });
    } catch {
      return fail('a compressed stream is damaged');
    }
    const predictor = Number(/\/Predictor\s+(\d+)/.exec(dict)?.[1] ?? 1);
    if (predictor === 1) return data;
    if (predictor < 10) fail('it uses a compression it cannot read');
    const columns = Number(/\/Columns\s+(\d+)/.exec(dict)?.[1] ?? 1);
    if (/\/Colors\s+(?!1\b)\d+/.test(dict) || /\/BitsPerComponent\s+(?!8\b)\d+/.test(dict)) fail('it uses a compression it cannot read');
    const rows = Math.floor(data.length / (columns + 1));
    const out = Buffer.alloc(rows * columns);
    for (let r = 0; r < rows; r++) {
      const kind = data[r * (columns + 1)];
      for (let c = 0; c < columns; c++) {
        const x = data[r * (columns + 1) + 1 + c];
        const left = c ? out[r * columns + c - 1] : 0;
        const up = r ? out[(r - 1) * columns + c] : 0;
        const corner = r && c ? out[(r - 1) * columns + c - 1] : 0;
        const paeth = () => {
          const p = left + up - corner;
          const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
          return pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
        };
        const base = kind === 0 ? 0 : kind === 1 ? left : kind === 2 ? up : kind === 3 ? (left + up) >> 1 : kind === 4 ? paeth() : fail('a compressed stream is damaged');
        out[r * columns + c] = (x + base) & 0xff;
      }
    }
    return out;
  }
  const objectStreams = new Map<number, string>();
  /** Object n's text, starting just after its "n g obj". */
  function body(n: number): string {
    const o = offsets.get(n);
    if (!o || ('at' in o && o.at < 0)) return fail(`object ${n} is missing`);
    if ('at' in o) {
      const m = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(o.at, o.at + 40));
      if (!m || Number(m[1]) !== n) fail(`object ${n} is not where its cross-reference says`);
      return text.slice(o.at + m![0].length);
    }
    let held = objectStreams.get(o.in);
    if (held === undefined) {
      const at = offsets.get(o.in);
      if (!at || !('at' in at)) return fail(`object ${n} is missing`);
      const own = body(o.in);
      const start = own.indexOf('<<');
      const dict = dictAt(own, start) ?? fail(`object ${o.in} is not a dictionary`);
      const headLength = text.length - own.length;
      held = decoded(dict, streamBytes(headLength + start + dict.length, dict)).toString('latin1');
      objectStreams.set(o.in, held);
    }
    const stm = body(o.in);
    const dict = dictAt(stm, stm.indexOf('<<')) ?? '';
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    const pairs = held.slice(0, first).trim().split(/\s+/).map(Number);
    if (!Number.isFinite(first) || pairs[o.index * 2] !== n) fail(`object ${n} is not where its cross-reference says`);
    return held.slice(first + pairs[o.index * 2 + 1]);
  }
  const object = (n: number): { body: string; gen: number } => {
    const text = body(n);
    const start = text.indexOf('<<');
    const dict = (/^\s*<</.test(text) ? dictAt(text, start) : undefined) ?? fail(`object ${n} is not a dictionary`);
    const o = offsets.get(n)!;
    return { body: dict, gen: 'gen' in o ? o.gen : 0 };
  };
  const catalog = object(Number(root![1])).body;
  const pagesRef = /\/Pages\s+(\d+)\s+(\d+)\s+R/.exec(catalog) ?? fail('its catalog has no page tree');
  const treeNum = Number(pagesRef![1]);
  const tree = object(treeNum);
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(tree.body) ?? fail('its page tree has no list of pages');
  const count = Number(/\/Count\s+(\d+)/.exec(tree.body)?.[1] ?? NaN);
  if (!Number.isFinite(count)) fail('its page tree has no page count');

  const drawn = pageObjects(pages, size, `${treeNum} ${tree.gen} R`, true);
  const newTree = tree.body
    .replace(kids![0], `/Kids [${kids![1].trim()}${kids![1].trim() ? ' ' : ''}${drawn.kids.join(' ')}]`)
    .replace(/\/Count\s+\d+/, `/Count ${count + pages.length}`);

  const chunks: Buffer[] = [];
  let at = existing.length;
  const push = (b: Buffer) => {
    chunks.push(b);
    at += b.length;
  };
  if (existing[existing.length - 1] !== 0x0a) push(Buffer.from('\n', 'latin1'));
  const treeAt = at;
  objectBytes(treeNum, newTree, tree.gen).forEach(push);
  const added: number[] = [];
  drawn.objects.forEach((o, i) => {
    added.push(at);
    objectBytes(size + i, o).forEach(push);
  });
  const info = /\/Info\s+\d+\s+\d+\s+R/.exec(trailer)?.[0];
  const idAt = /\/ID\s*\[/.exec(trailer);
  const idEnd = idAt ? valueEnd(trailer, idAt.index + idAt[0].length - 1) : undefined;
  const id = idAt && idEnd !== undefined ? trailer.slice(idAt.index, idEnd) : undefined;
  const keep = `/Root ${root![1]} ${root![2]} R${info ? ` ${info}` : ''}${id ? ` ${id}` : ''} /Prev ${lastXref}`;
  if (streams) {
    // A file whose newest section is a cross-reference stream gets one too (PDF 1.5), uncompressed:
    // the new page tree, the new objects, and the stream itself, which comes last.
    const xref = size + added.length;
    const rows = [[treeAt, tree.gen], ...added.map((o) => [o, 0]), [at, 0]];
    const data = Buffer.alloc(rows.length * 7);
    rows.forEach(([offset, gen], i) => {
      data[i * 7] = 1;
      data.writeUInt32BE(offset, i * 7 + 1);
      data.writeUInt16BE(gen, i * 7 + 5);
    });
    const xrefAt = at;
    objectBytes(xref, { dict: `/Type /XRef /Size ${xref + 1} /W [1 4 2] /Index [${treeNum} 1 ${size} ${added.length + 1}] ${keep}`, data }).forEach(push);
    push(Buffer.from(`startxref\n${xrefAt}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
  const entry = (offset: number, gen = 0) => `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} n \n`;
  let tail = `xref\n0 1\n0000000000 65535 f \n${treeNum} 1\n${entry(treeAt, tree.gen)}${size} ${added.length}\n`;
  for (const o of added) tail += entry(o);
  tail += `trailer\n<< /Size ${size + added.length} ${keep} >>\nstartxref\n${at}\n%%EOF\n`;
  push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(chunks);
}

/** Why a PDF couldn't take more pages. */
export class PdfAppendError extends Error {}

/** The dictionary starting at `start` ("<<" ... the matching ">>"), or undefined. */
function dictAt(text: string, start: number): string | undefined {
  if (start < 0 || !text.startsWith('<<', start)) return undefined;
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '(') {
      // A string: skip it, minding escapes and nested parentheses.
      let d = 1;
      for (i++; i < text.length && d; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '(') d++;
        else if (text[i] === ')') d--;
      }
      i--;
    } else if (c === '%') {
      // A comment, to the end of its line.
      const end = text.slice(i).search(/[\r\n]/);
      if (end < 0) return undefined;
      i += end;
    } else if (c === '<' && text[i + 1] !== '<') {
      // A hex string.
      const end = text.indexOf('>', i);
      if (end < 0) return undefined;
      i = end;
    } else if (c === '<' && text[i + 1] === '<') {
      depth++;
      i++;
    } else if (c === '>' && text[i + 1] === '>') {
      depth--;
      i++;
      if (!depth) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Where the array starting at `start` ("[") ends: the index after its "]", minding strings and comments; undefined when it doesn't. */
function valueEnd(text: string, start: number): number | undefined {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      let d = 1;
      for (i++; i < text.length && d; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '(') d++;
        else if (text[i] === ')') d--;
      }
      i--;
    } else if (c === '%') {
      const end = text.slice(i).search(/[\r\n]/);
      if (end < 0) return undefined;
      i += end;
    } else if (c === '[') depth++;
    else if (c === ']' && !--depth) return i + 1;
  }
  return undefined;
}

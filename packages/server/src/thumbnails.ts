// Small previews of container files: images are decoded here (PNG, GIF and
// JPEG, without dependencies) and shrunk to fit a square; PDFs and other
// formats use a converter the machine has (pdftoppm from Poppler, or sips on
// macOS), when there is one. Thumbnails are PNG.
//
// JPEGs are read at an eighth of their size straight from each 8x8 block's
// average (its DC coefficient), skipping the rest of the picture data: a
// 12-megapixel photo becomes 500x375 pixels without a full decode, which is
// plenty for a thumbnail.

import { inflateSync, deflateSync } from 'node:zlib';

export interface Picture {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel. */
  rgba: Uint8Array;
}

/** Pictures bigger than this many pixels (decoded) are not thumbnailed. */
const MAX_PIXELS = 60_000_000;
const MAX_SCANS = 64;
const MAX_GIF_DECODED_BYTES = MAX_PIXELS * 4;

/** A picture decoded from PNG, GIF or JPEG bytes; undefined for other formats. */
export function decodeImage(data: Uint8Array): Picture | undefined {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return decodePng(data);
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return decodeGif(data);
  if (data[0] === 0xff && data[1] === 0xd8) return decodeJpeg(data);
  return undefined;
}

/** A PNG, GIF or JPEG's width and height, from its header, without decoding it. */
export function imageSize(d: Uint8Array): { width: number; height: number } | undefined {
  if (d[0] === 0x89 && d[1] === 0x50 && d.length >= 24) return { width: ((d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19]) >>> 0, height: ((d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23]) >>> 0 };
  if (d[0] === 0x47 && d[1] === 0x49 && d.length >= 10) return { width: d[6] | (d[7] << 8), height: d[8] | (d[9] << 8) };
  if (d[0] !== 0xff || d[1] !== 0xd8) return undefined;
  for (let pos = 2; pos + 9 < d.length;) {
    if (d[pos] !== 0xff) return undefined;
    const marker = d[pos + 1];
    if (marker === 0xff) { pos++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: (d[pos + 7] << 8) | d[pos + 8], height: (d[pos + 5] << 8) | d[pos + 6] };
    }
    pos += 2 + ((d[pos + 2] << 8) | d[pos + 3]);
  }
  return undefined;
}

/** A PNG thumbnail fitting `size` x `size`, or undefined when the format can't be read here. */
export function thumbnailOf(data: Uint8Array, size: number): Uint8Array | undefined {
  const pic = decodeImage(data);
  return pic && encodePng(fit(pic, size));
}

// --- resizing ----------------------------------------------------------------

/** Shrinks a picture to fit `size` x `size` (never enlarging it), averaging the pixels each new one covers. */
export function fit(pic: Picture, size: number): Picture {
  const scale = Math.min(1, size / pic.width, size / pic.height);
  const w = Math.max(1, Math.round(pic.width * scale));
  const h = Math.max(1, Math.round(pic.height * scale));
  if (w === pic.width && h === pic.height) return pic;
  const out = new Uint8Array(w * h * 4);
  const sx = pic.width / w;
  const sy = pic.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * pic.width + xx) * 4;
          const alpha = pic.rgba[i + 3];
          r += pic.rgba[i] * alpha;
          g += pic.rgba[i + 1] * alpha;
          b += pic.rgba[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * w + x) * 4;
      const n = (y1 - y0) * (x1 - x0);
      if (a) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, rgba: out };
}

// --- PNG -------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGBA as PNG; fully opaque pictures are saved without the alpha channel. */
export function encodePng(pic: Picture): Uint8Array {
  const { width: w, height: h, rgba } = pic;
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const bpp = opaque ? 3 : 4;
  const stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const row = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < bpp; c++) row[x * bpp + c] = rgba[(y * w + x) * 4 + c];
    }
    // Paeth filter on every row: good for photos, fine for the rest.
    const o = y * (stride + 1);
    raw[o] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      raw[o + 1 + i] = (row[i] - paeth(a, b, c)) & 0xff;
    }
    prev.set(row);
  }
  const chunk = (type: string, body: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32([head.subarray(4), body]), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0)),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(data: Uint8Array): Picture | undefined {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (kind === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
  }
  if (!w || !h || w * h > MAX_PIXELS) return undefined;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return undefined;
  const bitsPP = channels * depth;
  // What the header's size can hold, with each row's filter byte and the seven interlace passes' extra rows; more is a bomb.
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (Math.ceil((w * bitsPP) / 8) + 8) * (h + 8) });
  } catch {
    return undefined;
  }
  const bpp = Math.max(1, bitsPP >> 3);
  const rgba = new Uint8Array(w * h * 4);
  const max = (1 << depth) - 1;
  let at = 0;

  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) return;
    const stride = Math.ceil((pw * bitsPP) / 8);
    let prev = new Uint8Array(stride);
    for (let r = 0; r < ph; r++) {
      const filter = raw[at];
      const line = new Uint8Array(raw.subarray(at + 1, at + 1 + stride));
      at += stride + 1;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        line[i] = (line[i] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0)) & 0xff;
      }
      prev = line;
      const sample = (x: number, ch: number): number => {
        if (depth === 8) return line[x * channels + ch];
        if (depth === 16) return line[(x * channels + ch) * 2];
        const bit = (x * channels + ch) * depth;
        return (((line[bit >> 3] >> (8 - depth - (bit & 7))) & max) * 255) / max;
      };
      const raw16 = (x: number, ch: number) => (depth === 16 ? (line[(x * channels + ch) * 2] << 8) | line[(x * channels + ch) * 2 + 1] : depth === 8 ? line[x * channels + ch] : (line[((x * channels + ch) * depth) >> 3] >> (8 - depth - (((x * channels + ch) * depth) & 7))) & max);
      for (let x = 0; x < pw; x++) {
        const o = ((y0 + r * dy) * w + x0 + x * dx) * 4;
        if (type === 3) {
          const idx = raw16(x, 0);
          rgba[o] = palette?.[idx * 3] ?? 0;
          rgba[o + 1] = palette?.[idx * 3 + 1] ?? 0;
          rgba[o + 2] = palette?.[idx * 3 + 2] ?? 0;
          rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
        } else if (type === 0 || type === 4) {
          const g = sample(x, 0);
          rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
          rgba[o + 3] = type === 4 ? sample(x, 1) : trns && trns.length >= 2 && raw16(x, 0) === trns.readUInt16BE(0) ? 0 : 255;
        } else {
          rgba[o] = sample(x, 0);
          rgba[o + 1] = sample(x, 1);
          rgba[o + 2] = sample(x, 2);
          rgba[o + 3] = type === 6 ? sample(x, 3)
            : trns && trns.length >= 6 && raw16(x, 0) === trns.readUInt16BE(0) && raw16(x, 1) === trns.readUInt16BE(2) && raw16(x, 2) === trns.readUInt16BE(4) ? 0 : 255;
        }
      }
    }
  };
  if (interlace) {
    for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) pass(x0, y0, dx, dy);
  } else pass(0, 0, 1, 1);
  return { width: w, height: h, rgba };
}

// --- GIF (the first frame) ----------------------------------------------------------

export function decodeGif(d: Uint8Array): Picture | undefined {
  if (d.length < 13 || !['GIF87a', 'GIF89a'].includes(Buffer.from(d.subarray(0, 6)).toString('ascii'))) return undefined;
  const w = d[6] | (d[7] << 8);
  const h = d[8] | (d[9] << 8);
  if (!w || !h || w * h > MAX_PIXELS) return undefined;
  let pos = 13;
  let global: Uint8Array | undefined;
  if (d[10] & 0x80) {
    const n = 3 * (1 << ((d[10] & 7) + 1));
    if (pos + n > d.length) return undefined;
    global = d.subarray(pos, pos + n);
    pos += n;
  }
  let transparent = -1;
  while (pos < d.length) {
    const b = d[pos++];
    if (b === 0x21) {
      const label = d[pos++];
      if (label === 0xf9 && d[pos] >= 4 && d[pos + 1] & 1) transparent = d[pos + 4];
      while (pos < d.length && d[pos]) pos += d[pos] + 1;
      pos++;
    } else if (b === 0x2c) {
      if (pos + 9 > d.length) return undefined;
      const left = d[pos] | (d[pos + 1] << 8), top = d[pos + 2] | (d[pos + 3] << 8);
      const iw = d[pos + 4] | (d[pos + 5] << 8), ih = d[pos + 6] | (d[pos + 7] << 8);
      const pixels = iw * ih;
      // Account for the canvas, indices, row order and fixed LZW tables together.
      if (!iw || !ih || pixels > MAX_PIXELS || left + iw > w || top + ih > h
        || w * h * 4 + pixels + ih * 4 + 28_673 > MAX_GIF_DECODED_BYTES) return undefined;
      const flags = d[pos + 8];
      pos += 9;
      let table = global;
      if (flags & 0x80) {
        const n = 3 * (1 << ((flags & 7) + 1));
        if (pos + n > d.length) return undefined;
        table = d.subarray(pos, pos + n);
        pos += n;
      }
      const minCode = d[pos++];
      if (!table || minCode < 2 || minCode > 8 || minCode === undefined) return undefined;
      const parts: Uint8Array[] = [];
      while (pos < d.length && d[pos]) {
        if (pos + 1 + d[pos] > d.length) return undefined;
        parts.push(d.subarray(pos + 1, pos + 1 + d[pos]));
        pos += d[pos] + 1;
      }
      if (pos >= d.length) return undefined;
      const indices = lzw(Buffer.concat(parts), minCode, iw * ih);
      const rows = flags & 0x40 ? interlacedRows(ih) : undefined;
      const rgba = new Uint8Array(w * h * 4);
      for (let r = 0; r < ih; r++) {
        const y = top + (rows ? rows[r] : r);
        if (y >= h) continue;
        for (let x = 0; x < iw && left + x < w; x++) {
          const idx = indices[r * iw + x];
          if (idx === transparent) continue;
          const o = (y * w + left + x) * 4;
          rgba[o] = table?.[idx * 3] ?? 0;
          rgba[o + 1] = table?.[idx * 3 + 1] ?? 0;
          rgba[o + 2] = table?.[idx * 3 + 2] ?? 0;
          rgba[o + 3] = 255;
        }
      }
      return { width: w, height: h, rgba };
    } else break;
  }
  return undefined;
}

function interlacedRows(h: number): Uint32Array {
  const rows = new Uint32Array(h);
  let i = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows[i++] = y;
  return rows;
}

function lzw(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const end = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    first[i] = i;
  }
  let size = minCode + 1, next = end + 1, prev = -1;
  let bits = 0, acc = 0, n = 0;
  const stack = new Uint8Array(4097);
  for (let i = 0; i < data.length && n < count; i++) {
    acc |= data[i] << bits;
    bits += 8;
    while (bits >= size && n < count) {
      const code = acc & ((1 << size) - 1);
      acc >>>= size;
      bits -= size;
      if (code === clear) {
        size = minCode + 1;
        next = end + 1;
        prev = -1;
        continue;
      }
      if (code === end) return out;
      let c = code;
      let sp = 0;
      if (prev !== -1 && code >= next) {
        stack[sp++] = first[prev];
        c = prev;
      }
      if (c >= next && prev === -1) return out;
      while (c >= clear) {
        stack[sp++] = suffix[c];
        c = prefix[c];
      }
      stack[sp++] = c;
      const head = c;
      while (sp && n < count) out[n++] = stack[--sp];
      if (prev !== -1 && next < 4096) {
        prefix[next] = prev;
        suffix[next] = head;
        first[next] = first[prev];
        next++;
        if (next === 1 << size && size < 12) size++;
      }
      prev = code;
    }
  }
  return out;
}

// --- JPEG, at an eighth of its size ----------------------------------------------------

/** A Huffman table as canonical codes: per code length, the first code, how many, and where their symbols start. */
interface Huffman { first: Int32Array; count: Int32Array; offset: Int32Array; symbols: Uint8Array; fast: Uint16Array }

const FAST = 9;

function huffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const first = new Int32Array(17), count = new Int32Array(17), offset = new Int32Array(17);
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    first[len] = code;
    count[len] = counts[len - 1];
    offset[len] = k;
    code = (code + counts[len - 1]) << 1;
    k += counts[len - 1];
  }
  // Codes up to FAST bits long, looked up at once by the next FAST bits: (length << 8) | symbol.
  const fast = new Uint16Array(1 << FAST);
  for (let len = 1; len <= FAST; len++) {
    for (let i = 0; i < count[len]; i++) {
      const lo = (first[len] + i) << (FAST - len);
      fast.fill((len << 8) | symbols[offset[len] + i], lo, lo + (1 << (FAST - len)));
    }
  }
  return { first, count, offset, symbols: new Uint8Array(symbols), fast };
}

interface Component { id: number; h: number; v: number; tq: number; bw: number; bh: number; dc: Int32Array; td: number; ta: number; pred: number }

export function decodeJpeg(d: Uint8Array): Picture | undefined {
  const quant: Uint16Array[] = [];
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0, height = 0, progressive = false, restart = 0, adobe = -1, orientation = 1;
  let hmax = 1, vmax = 1;
  let scans = 0;
  let pos = 2;
  const u16 = (p: number) => (d[p] << 8) | d[p + 1];
  while (pos < d.length) {
    if (d[pos] !== 0xff) { pos++; continue; }
    const marker = d[pos + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { pos += marker === 0xff ? 1 : 2; continue; }
    if (marker === 0xd9) break;
    const len = u16(pos + 2);
    const seg = d.subarray(pos + 4, pos + 2 + len);
    pos += 2 + len;
    switch (marker) {
      case 0xdb: {
        for (let i = 0; i < seg.length;) {
          const sixteen = seg[i] >> 4, id = seg[i] & 15;
          quant[id] = new Uint16Array(64);
          for (let k = 0; k < 64; k++) quant[id][k] = sixteen ? u16Of(seg, i + 1 + k * 2) : seg[i + 1 + k];
          i += 1 + 64 * (sixteen ? 2 : 1);
        }
        break;
      }
      case 0xc4: {
        for (let i = 0; i < seg.length;) {
          const cls = seg[i] >> 4, id = seg[i] & 15;
          const counts = seg.subarray(i + 1, i + 17);
          const total = counts.reduce((a, b) => a + b, 0);
          (cls ? acTables : dcTables)[id] = huffman(counts, seg.subarray(i + 17, i + 17 + total));
          i += 17 + total;
        }
        break;
      }
      case 0xc0: case 0xc1: case 0xc2: {
        // One frame per picture: a second header would allocate the planes again.
        if (comps.length) return undefined;
        progressive = marker === 0xc2;
        height = u16Of(seg, 1);
        width = u16Of(seg, 3);
        if (!width || !height || width * height > MAX_PIXELS * 4) return undefined;
        // Only grey, colour and CMYK pictures are drawn, and each component is a plane of the picture's size:
        // 255 of them on a large picture would take a gigabyte before anything was refused.
        if (seg[5] !== 1 && seg[5] !== 3 && seg[5] !== 4) return undefined;
        comps = [];
        for (let i = 0; i < seg[5]; i++) {
          const o = 6 + i * 3;
          comps.push({ id: seg[o], h: seg[o + 1] >> 4 || 1, v: seg[o + 1] & 15 || 1, tq: seg[o + 2], bw: 0, bh: 0, dc: new Int32Array(0), td: 0, ta: 0, pred: 0 });
        }
        hmax = Math.max(...comps.map((c) => c.h));
        vmax = Math.max(...comps.map((c) => c.v));
        const mcusX = Math.ceil(width / (8 * hmax)), mcusY = Math.ceil(height / (8 * vmax));
        for (const c of comps) {
          c.bw = mcusX * c.h;
          c.bh = mcusY * c.v;
          c.dc = new Int32Array(c.bw * c.bh);
        }
        break;
      }
      case 0xc3: case 0xc5: case 0xc6: case 0xc7: case 0xc9: case 0xca: case 0xcb: case 0xcd: case 0xce: case 0xcf:
        return undefined; // lossless, hierarchical or arithmetic-coded: rare
      case 0xdd: restart = u16Of(seg, 0); break;
      case 0xee: if (seg.length >= 12 && String.fromCharCode(...seg.subarray(0, 5)) === 'Adobe') adobe = seg[11]; break;
      case 0xe1: orientation = exifOrientation(seg) ?? orientation; break;
      case 0xda: {
        // A picture of any size has a handful of scans (a progressive one about ten); thousands are a way to make
        // the decoder walk the whole picture again and again.
        if (++scans > MAX_SCANS) return undefined;
        const n = seg[0];
        const scan: Component[] = [];
        for (let i = 0; i < n; i++) {
          const c = comps.find((x) => x.id === seg[1 + i * 2]);
          if (!c) return undefined;
          c.td = seg[2 + i * 2] >> 4;
          c.ta = seg[2 + i * 2] & 15;
          scan.push(c);
        }
        const o = 1 + n * 2;
        const ss = seg[o], se = seg[o + 1], ah = seg[o + 2] >> 4, al = seg[o + 2] & 15;
        pos = progressive && ss > 0 ? skipScan(d, pos) : decodeScan(d, pos, scan, { progressive, ss, se, ah, al, restart, dcTables, acTables, mcusX: Math.ceil(width / (8 * hmax)), hmax, vmax, width, height });
        break;
      }
    }
  }
  if (!width || !comps.length) return undefined;

  // Each block's average, from its DC coefficient: one pixel per 8x8 block.
  const w = Math.ceil(width / 8), h = Math.ceil(height / 8);
  const planes = comps.map((c) => {
    const q = quant[c.tq]?.[0] ?? 1;
    const plane = new Uint8Array(c.bw * c.bh);
    for (let i = 0; i < plane.length; i++) plane[i] = clamp((c.dc[i] * q) / 8 + 128);
    return plane;
  });
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = comps.map((c, i) => planes[i][Math.floor((y * c.v) / vmax) * c.bw + Math.floor((x * c.h) / hmax)]);
      const o = (y * w + x) * 4;
      let r: number, g: number, b: number;
      if (comps.length === 1) r = g = b = v[0];
      else if (comps.length === 3 && adobe !== 0) [r, g, b] = ycc(v[0], v[1], v[2]);
      else if (comps.length === 3) [r, g, b] = v;
      else if (comps.length === 4) {
        // Adobe CMYK (stored inverted), or YCCK.
        const [c, m, yy] = adobe === 2 ? ycc(v[0], v[1], v[2]) : [v[0], v[1], v[2]];
        const k = v[3];
        [r, g, b] = [(c * k) / 255, (m * k) / 255, (yy * k) / 255];
      } else return undefined;
      rgba[o] = clamp(r);
      rgba[o + 1] = clamp(g);
      rgba[o + 2] = clamp(b);
      rgba[o + 3] = 255;
    }
  }
  return orient({ width: w, height: h, rgba }, orientation);
}

const u16Of = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function ycc(y: number, cb: number, cr: number): [number, number, number] {
  return [y + 1.402 * (cr - 128), y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128), y + 1.772 * (cb - 128)];
}

/** Past an entropy-coded segment we don't need, to the next marker. */
function skipScan(d: Uint8Array, pos: number): number {
  while (pos < d.length - 1) {
    if (d[pos] === 0xff && d[pos + 1] !== 0 && !(d[pos + 1] >= 0xd0 && d[pos + 1] <= 0xd7)) return pos;
    pos++;
  }
  return d.length;
}

/** Reads a scan's DC coefficients (skipping AC ones); returns where the scan ends. */
function decodeScan(d: Uint8Array, start: number, scan: Component[], o: {
  progressive: boolean; ss: number; se: number; ah: number; al: number; restart: number;
  dcTables: Huffman[]; acTables: Huffman[]; mcusX: number; hmax: number; vmax: number; width: number; height: number;
}): number {
  // Bits wait in `acc` (the low `bits` of it); past the scan's end they read as zeros, the lowest `fake` of them.
  let pos = start, acc = 0, bits = 0, ended = false, fake = 0;
  const fill = () => {
    while (bits <= 24) {
      let byte = 0, real = false;
      if (!ended && pos < d.length) {
        byte = d[pos++];
        real = true;
        if (byte === 0xff) {
          if (d[pos] === 0) pos++;
          else {
            // A marker: the scan's data has ended (or a restart is due).
            pos--;
            ended = true;
            byte = 0;
            real = false;
          }
        }
      }
      if (!real) fake += 8;
      acc = ((acc << 8) | byte) >>> 0;
      bits += 8;
    }
  };
  const take = (n: number): number => {
    if (bits < n) fill();
    bits -= n;
    return (acc >>> bits) & ((1 << n) - 1);
  };
  const bit = () => take(1);
  const receive = (n: number) => (n ? take(n) : 0);
  const extend = (v: number, n: number) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decode = (t: Huffman | undefined): number => {
    if (!t) throw new Error('missing Huffman table');
    if (bits < 16) fill();
    const hit = t.fast[(acc >>> (bits - FAST)) & ((1 << FAST) - 1)];
    if (hit) {
      bits -= hit >> 8;
      return hit & 0xff;
    }
    for (let len = FAST + 1; len <= 16; len++) {
      const code = (acc >>> (bits - len)) & ((1 << len) - 1);
      const i = code - t.first[len];
      if (i >= 0 && i < t.count[len]) {
        bits -= len;
        return t.symbols[t.offset[len] + i];
      }
    }
    throw new Error('bad Huffman code');
  };
  const block = (c: Component, row: number, col: number) => {
    if (row >= c.bh || col >= c.bw) return;
    const i = row * c.bw + col;
    if (!o.progressive || o.ah === 0) {
      const t = decode(o.dcTables[c.td]);
      c.pred += t ? extend(receive(t), t) : 0;
      c.dc[i] = o.progressive ? c.pred * (1 << o.al) : c.pred;
    } else if (bit()) c.dc[i] |= 1 << o.al;
    if (o.progressive) return;
    // Baseline: step over the 63 AC coefficients.
    for (let k = 1; k < 64;) {
      const rs = decode(o.acTables[c.ta]);
      const r = rs >> 4, s = rs & 15;
      if (!s) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      receive(s);
      k += r + 1;
    }
  };
  const single = scan.length === 1;
  const total = single
    ? Math.ceil(Math.ceil((o.width * scan[0].h) / o.hmax) / 8) * Math.ceil(Math.ceil((o.height * scan[0].v) / o.vmax) / 8)
    : o.mcusX * Math.ceil(o.height / (8 * o.vmax));
  const perRow = single ? Math.ceil(Math.ceil((o.width * scan[0].h) / o.hmax) / 8) : o.mcusX;
  for (const c of scan) c.pred = 0;
  try {
    for (let m = 0; m < total; m++) {
      if (o.restart && m && m % o.restart === 0) {
        // Restart: realign to the RSTn marker and reset predictions.
        bits = 0;
        fake = 0;
        ended = false;
        while (pos < d.length - 1 && !(d[pos] === 0xff && d[pos + 1] >= 0xd0 && d[pos + 1] <= 0xd7)) pos++;
        pos += 2;
        for (const c of scan) c.pred = 0;
      }
      if (bits < fake) {
        // The data ran out: the rest of the scan would be read from zeros, which is a walk over the whole picture
        // for a few bytes. Its blocks stay as they are, and a picture with restarts goes on at the next interval.
        if (!o.restart) break;
        m += o.restart - (m % o.restart) - 1;
        continue;
      }
      const row = Math.floor(m / perRow), col = m % perRow;
      if (single) block(scan[0], row, col);
      else for (const c of scan) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, row * c.v + v, col * c.h + h);
    }
  } catch {
    // A damaged scan: keep what was read.
  }
  return skipScan(d, pos);
}

/** The EXIF orientation (1-8) in an APP1 segment. */
function exifOrientation(seg: Uint8Array): number | undefined {
  if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 4)) !== 'Exif') return undefined;
  const t = 6;
  const le = seg[t] === 0x49;
  const r16 = (p: number) => (le ? seg[p] | (seg[p + 1] << 8) : (seg[p] << 8) | seg[p + 1]);
  const r32 = (p: number) => (le ? (seg[p] | (seg[p + 1] << 8) | (seg[p + 2] << 16)) + seg[p + 3] * 2 ** 24 : seg[p] * 2 ** 24 + ((seg[p + 1] << 16) | (seg[p + 2] << 8) | seg[p + 3]));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > seg.length) return undefined;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > seg.length) return undefined;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : undefined;
    }
  }
  return undefined;
}

/** A picture turned upright by its EXIF orientation. */
export function orient(pic: Picture, orientation: number): Picture {
  if (orientation <= 1 || orientation > 8) return pic;
  const swap = orientation >= 5;
  const w = swap ? pic.height : pic.width, h = swap ? pic.width : pic.height;
  const out = new Uint8Array(pic.rgba.length);
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      let nx: number, ny: number;
      switch (orientation) {
        case 2: nx = pic.width - 1 - x; ny = y; break;
        case 3: nx = pic.width - 1 - x; ny = pic.height - 1 - y; break;
        case 4: nx = x; ny = pic.height - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = pic.height - 1 - y; ny = x; break;
        case 7: nx = pic.height - 1 - y; ny = pic.width - 1 - x; break;
        default: nx = y; ny = pic.width - 1 - x; break;
      }
      out.set(pic.rgba.subarray((y * pic.width + x) * 4, (y * pic.width + x) * 4 + 4), (ny * w + nx) * 4);
    }
  }
  return { width: w, height: h, rgba: out };
}

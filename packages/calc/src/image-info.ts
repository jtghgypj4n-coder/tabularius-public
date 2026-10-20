// What GetWidth, GetHeight and GetContainerAttribute's image attributes read from a
// container's bytes: the size in pixels, the resolution when the file states it, and
// whether the image has transparency. PNG, GIF, JPEG, BMP, WebP and TIFF headers are read;
// anything else isn't an image here.

export interface ImageInfo {
  width: number;
  height: number;
  /** Pixels per inch, only when the file says. */
  dpiWidth?: number;
  dpiHeight?: number;
  transparency: boolean;
}

/** Throws when a header field would run past the end, so a truncated file isn't measured from zeros. */
function at(d: Uint8Array, i: number, n: number): number {
  if (i < 0 || i + n > d.length) throw new RangeError('truncated');
  return i;
}
const be16 = (d: Uint8Array, i: number) => (d[at(d, i, 2)] << 8) | d[i + 1];
const be32 = (d: Uint8Array, i: number) => ((d[at(d, i, 4)] << 24) >>> 0) + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3];
const le16 = (d: Uint8Array, i: number) => d[at(d, i, 2)] | (d[i + 1] << 8);
const le24 = (d: Uint8Array, i: number) => d[at(d, i, 3)] | (d[i + 1] << 8) | (d[i + 2] << 16);
const le32 = (d: Uint8Array, i: number) => (d[at(d, i, 4)] | (d[i + 1] << 8) | (d[i + 2] << 16)) + ((d[i + 3] << 24) >>> 0);
const ascii = (d: Uint8Array, at: number, n: number) => String.fromCharCode(...d.subarray(at, at + n));
/** Pixels per metre to pixels per inch, rounded as resolutions are shown. */
const perInch = (perMetre: number) => Math.round(perMetre * 0.0254);

/** Whether bytes start like one of the images read here (so a file that doesn't needn't be read further). */
export function isImageHeader(d: Uint8Array): boolean {
  const a = (at: number, n: number) => (d.length >= at + n ? ascii(d, at, n) : '');
  return (d[0] === 0x89 && a(1, 3) === 'PNG') || a(0, 4) === 'GIF8' || (d[0] === 0xff && d[1] === 0xd8)
    || a(0, 2) === 'BM' || (a(0, 4) === 'RIFF' && a(8, 4) === 'WEBP') || a(0, 4) === 'II*\0' || a(0, 4) === 'MM\0*';
}

export function imageInfo(d: Uint8Array): ImageInfo | undefined {
  const info = read(d);
  // An image has pixels; a header that says otherwise isn't one.
  return info && info.width > 0 && info.height > 0 ? info : undefined;
}

function read(d: Uint8Array): ImageInfo | undefined {
  try {
    if (d.length >= 24 && be32(d, 0) === 0x89504e47 && be32(d, 4) === 0x0d0a1a0a) return png(d);
    if (d.length >= 13 && (ascii(d, 0, 6) === 'GIF87a' || ascii(d, 0, 6) === 'GIF89a')) return gif(d);
    if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) return jpeg(d);
    if (d.length >= 30 && d[0] === 0x42 && d[1] === 0x4d) return bmp(d);
    if (d.length >= 30 && ascii(d, 0, 4) === 'RIFF' && ascii(d, 8, 4) === 'WEBP') return webp(d);
    if (d.length >= 8 && (ascii(d, 0, 4) === 'II*\0' || ascii(d, 0, 4) === 'MM\0*')) return tiff(d);
  } catch {
    // A truncated header reads past the end; it isn't an image we can measure.
  }
  return undefined;
}

function png(d: Uint8Array): ImageInfo | undefined {
  if (ascii(d, 12, 4) !== 'IHDR') return undefined;
  const info: ImageInfo = { width: be32(d, 16), height: be32(d, 20), transparency: d[25] === 4 || d[25] === 6 };
  for (let at = 8; at + 8 <= d.length;) {
    const len = be32(d, at);
    const type = ascii(d, at + 4, 4);
    if (type === 'tRNS') info.transparency = true;
    // pHYs: pixels per unit on each axis, and unit 1 for metres (0 is an aspect ratio only).
    if (type === 'pHYs' && len >= 9 && d[at + 16] === 1) {
      info.dpiWidth = perInch(be32(d, at + 8));
      info.dpiHeight = perInch(be32(d, at + 12));
    }
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + len;
  }
  return info;
}

function gif(d: Uint8Array): ImageInfo {
  const info: ImageInfo = { width: le16(d, 6), height: le16(d, 8), transparency: false };
  // Walk the blocks after the global colour table: a Graphic Control Extension (21 F9) whose flags have bit 0 set
  // names a transparent colour. Colour tables and image data are skipped, so their bytes can't pass for one.
  const table = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
  const subBlocks = (i: number) => {
    while (i < d.length && d[i]) i += d[i] + 1;
    return i + 1;
  };
  let i = 13 + table(d[10]);
  while (i < d.length) {
    if (d[i] === 0x21) {
      if (d[i + 1] === 0xf9 && d[i + 2] === 4 && (d[i + 3] & 1)) {
        info.transparency = true;
        break;
      }
      i = subBlocks(i + 2);
    } else if (d[i] === 0x2c) {
      i = subBlocks(i + 10 + table(d[i + 9]) + 1);
    } else {
      break;
    }
  }
  return info;
}

function jpeg(d: Uint8Array): ImageInfo | undefined {
  let dpi: { x: number; y: number } | undefined;
  for (let at = 2; at + 4 <= d.length;) {
    if (d[at] !== 0xff) return undefined;
    const marker = d[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const len = be16(d, at + 2);
    // JFIF APP0: density units 1 (per inch) or 2 (per centimetre).
    if (marker === 0xe0 && ascii(d, at + 4, 5) === 'JFIF\0') {
      const units = d[at + 11];
      const x = be16(d, at + 12);
      const y = be16(d, at + 14);
      if (units === 1) dpi = { x, y };
      else if (units === 2) dpi = { x: Math.round(x * 2.54), y: Math.round(y * 2.54) };
    }
    // Start of frame (C0-CF, other than DHT C4, JPG C8 and DAC CC): precision, height, width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: be16(d, at + 7), height: be16(d, at + 5), transparency: false, ...(dpi ? { dpiWidth: dpi.x, dpiHeight: dpi.y } : {}) };
    }
    if (marker === 0xda || marker === 0xd9) return undefined;
    at += 2 + len;
  }
  return undefined;
}

function bmp(d: Uint8Array): ImageInfo | undefined {
  // "BM" starts plenty of text, so the header must look like a bitmap's: a known header size and one plane.
  const header = le32(d, 14);
  if (header === 12) return le16(d, 22) === 1 ? { width: le16(d, 18), height: le16(d, 20), transparency: false } : undefined;
  if (![40, 52, 56, 108, 124].includes(header) || le16(d, 26) !== 1 || d.length < 14 + header) return undefined;
  // Height is negative for a top-down bitmap.
  const height = Math.abs(le32(d, 22) | 0);
  const info: ImageInfo = { width: Math.abs(le32(d, 18) | 0), height, transparency: false };
  const x = le32(d, 38);
  const y = le32(d, 42);
  if (x && y) {
    info.dpiWidth = perInch(x);
    info.dpiHeight = perInch(y);
  }
  // Version 4 and 5 headers carry an alpha mask for 32-bit images.
  if (header >= 56 && le16(d, 28) === 32 && d.length >= 70 && le32(d, 66)) info.transparency = true;
  return info;
}

function webp(d: Uint8Array): ImageInfo | undefined {
  const chunk = ascii(d, 12, 4);
  if (chunk === 'VP8X') return { width: le24(d, 24) + 1, height: le24(d, 27) + 1, transparency: (d[20] & 0x10) !== 0 };
  if (chunk === 'VP8L' && d[20] === 0x2f) {
    const bits = le32(d, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, transparency: ((bits >>> 28) & 1) === 1 };
  }
  if (chunk === 'VP8 ' && d[23] === 0x9d && d[24] === 0x01 && d[25] === 0x2a) {
    return { width: le16(d, 26) & 0x3fff, height: le16(d, 28) & 0x3fff, transparency: false };
  }
  return undefined;
}

function tiff(d: Uint8Array): ImageInfo | undefined {
  const le = d[0] === 0x49;
  const u16 = (at: number) => (le ? le16(d, at) : be16(d, at));
  const u32 = (at: number) => (le ? le32(d, at) : be32(d, at));
  const ifd = u32(4);
  const tags = new Map<number, { type: number; at: number }>();
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const at = ifd + 2 + i * 12;
    tags.set(u16(at), { type: u16(at + 2), at: at + 8 });
  }
  // A SHORT (3) or LONG (4) value sits in the entry itself; a RATIONAL (5) is at the offset it gives.
  const value = (tag: number) => {
    const t = tags.get(tag);
    return !t ? undefined : t.type === 3 ? u16(t.at) : t.type === 4 ? u32(t.at) : undefined;
  };
  const rational = (tag: number) => {
    const t = tags.get(tag);
    if (!t || t.type !== 5) return undefined;
    const at = u32(t.at);
    const den = u32(at + 4);
    return den ? u32(at) / den : undefined;
  };
  const width = value(256);
  const height = value(257);
  if (width === undefined || height === undefined) return undefined;
  const info: ImageInfo = { width, height, transparency: tags.has(338) };
  // ResolutionUnit: 2 (the default) is inches, 3 centimetres, 1 none.
  const unit = value(296) ?? 2;
  const x = rational(282);
  const y = rational(283);
  if (x && y && unit !== 1) {
    info.dpiWidth = Math.round(unit === 3 ? x * 2.54 : x);
    info.dpiHeight = Math.round(unit === 3 ? y * 2.54 : y);
  }
  return info;
}

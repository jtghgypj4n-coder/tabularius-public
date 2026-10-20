// Decoder for the Standard Compression Scheme for Unicode (UTS #6), which
// fmp12 uses for text. Ported from evanmiller/fmptools src/scsu.c (MIT).
// Unlike that port, tabs and line breaks are kept as-is: FileMaker stores
// CR as its paragraph separator, which we normalise to LF.

const SQ0 = 0x01, SQ7 = 0x08, SDX = 0x0b, SQU = 0x0e, SCU = 0x0f;
const SC0 = 0x10, SC7 = 0x17, SD0 = 0x18, SD7 = 0x1f;
const UC0 = 0xe0, UC7 = 0xe7, UD0 = 0xe8, UD7 = 0xef, UQU = 0xf0, UDX = 0xf1;

const STATIC_WINDOWS = [0x0000, 0x0080, 0x0100, 0x0300, 0x2000, 0x2080, 0x2100, 0x3000];
const DEFAULT_DYNAMIC = [0x0080, 0x00c0, 0x0400, 0x0600, 0x0900, 0x3040, 0x30a0, 0xff00];

function windowOffset(x: number): number {
  if (x > 0 && x < 0x68) return x * 0x80;
  if (x >= 0x68 && x < 0xa8) return x * 0x80 + 0xac00;
  switch (x) {
    case 0xf9: return 0x00c0;
    case 0xfa: return 0x0250;
    case 0xfb: return 0x0370;
    case 0xfc: return 0x0530;
    case 0xfd: return 0x3040;
    case 0xfe: return 0x30a0;
    case 0xff: return 0xff60;
  }
  return 0;
}

function extendedOffset(hi: number, lo: number): number {
  return 0x10000 + 0x80 * (((hi & 0x1f) << 8) + lo);
}

export function decodeScsu(src: Uint8Array): string {
  return scsu(src, Infinity).text;
}

/**
 * Decode until `maxUnits` UTF-16 code units have been produced (or the input
 * ends). Returns the text and how many input bytes were used.
 */
export function scsu(src: Uint8Array, maxUnits: number): { text: string; end: number } {
  const dyn = DEFAULT_DYNAMIC.slice();
  const units: number[] = [];
  let active = 0;
  let unicodeMode = false;
  let i = 0;
  const n = src.length;
  const emit = (cp: number) => {
    if (cp > 0xffff) {
      cp -= 0x10000;
      units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      units.push(cp);
    }
  };
  while (i < n && units.length < maxUnits) {
    const c = src[i++];
    if (unicodeMode) {
      if (c >= UC0 && c <= UC7) {
        active = c - UC0;
        unicodeMode = false;
      } else if (c >= UD0 && c <= UD7) {
        if (i >= n) break;
        active = c - UD0;
        dyn[active] = windowOffset(src[i++]);
        unicodeMode = false;
      } else if (c === UDX) {
        if (i + 2 > n) break;
        active = (src[i] & 0xe0) >> 5;
        dyn[active] = extendedOffset(src[i], src[i + 1]);
        i += 2;
        unicodeMode = false;
      } else if (c === UQU) {
        if (i + 2 > n) break;
        units.push((src[i] << 8) | src[i + 1]);
        i += 2;
      } else {
        if (i >= n) break;
        units.push((c << 8) | src[i++]);
      }
      continue;
    }
    if (c >= SQ0 && c <= SQ7) {
      if (i >= n) break;
      const w = c - SQ0;
      const b = src[i++];
      emit(b < 0x80 ? STATIC_WINDOWS[w] + b : dyn[w] + (b - 0x80));
    } else if (c === SCU) {
      unicodeMode = true;
    } else if (c === SQU) {
      if (i + 2 > n) break;
      units.push((src[i] << 8) | src[i + 1]);
      i += 2;
    } else if (c >= SC0 && c <= SC7) {
      active = c - SC0;
    } else if (c >= SD0 && c <= SD7) {
      if (i >= n) break;
      active = c - SD0;
      dyn[active] = windowOffset(src[i++]);
    } else if (c === SDX) {
      if (i + 2 > n) break;
      active = (src[i] & 0xe0) >> 5;
      dyn[active] = extendedOffset(src[i], src[i + 1]);
      i += 2;
    } else if (c >= 0x80) {
      emit(dyn[active] + (c - 0x80));
    } else {
      units.push(c); // ASCII, TAB, CR, LF and NUL pass through
    }
  }
  // String.fromCharCode has an argument limit; chunk large values.
  let out = '';
  for (let k = 0; k < units.length; k += 8192) {
    out += String.fromCharCode(...units.slice(k, k + 8192));
  }
  return { text: out, end: i };
}

/** Un-XOR (0x5A) and SCSU-decode a stored fmp12 string. */
export function decodeText(raw: Uint8Array, xorMask = 0x5a): string {
  const b = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k++) b[k] = raw[k] ^ xorMask;
  return decodeScsu(b).replace(/\r\n?/g, '\n');
}

/** decodeText for a value of known length in characters; also returns the bytes used. */
export function decodeTextChars(raw: Uint8Array, chars: number, xorMask = 0x5a): { text: string; end: number } {
  const b = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k++) b[k] = raw[k] ^ xorMask;
  const r = scsu(b, chars);
  return { text: r.text.replace(/\r\n?/g, '\n'), end: r.end };
}

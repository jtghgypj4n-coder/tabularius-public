import { checkTextSize, joinText, substituteText } from './text-budget.ts';

// MBS ( "Text.…" ): the text functions of MonkeyBread Software's FileMaker plug-in, run natively.
// Behaviour follows MBS's own function pages (mbsplugins.eu, one page per function); where a page
// leaves something open, the comment on that function says what Tabularius does and that it is inferred.
// Every function here is pure computation: no files, network or clipboard.

/** An MBS error: the plug-in returns "[MBS] ERROR: …" and MBS ( "IsError" ) gives 1. */
export class MbsError extends Error {}

// --- text encodings --------------------------------------------------------------
// MBS takes ANSI, ISO-8859-1, Latin1, Mac, Native, UTF-8, UTF-16 (LE/BE), DOS, Hex and Base64, in any case and
// with or without the hyphen ("utf8", "UTF-8"). Native is the platform's own: Mac Roman on a Mac, Windows-1252
// on Windows, and (inferred) UTF-8 on Linux, where FileMaker Server's MBS has no other.

function singleByte(label: string): { decode: (b: Uint8Array) => string; encode: (s: string) => Uint8Array } {
  const decoder = new TextDecoder(label);
  const chars = decoder.decode(Uint8Array.from({ length: 256 }, (_, i) => i));
  const back = new Map<string, number>();
  for (let i = 255; i >= 0; i--) back.set(chars[i], i);
  return {
    decode: (b) => decoder.decode(b),
    // A character the encoding has no byte for becomes "?", as text converters do.
    encode: (s) => Uint8Array.from([...s], (c) => back.get(c) ?? 0x3f),
  };
}
let mac: ReturnType<typeof singleByte> | undefined;
let windows: ReturnType<typeof singleByte> | undefined;
const macRoman = () => (mac ??= singleByte('macintosh'));
const windows1252 = () => (windows ??= singleByte('windows-1252'));

type Encoding = 'utf8' | 'utf16le' | 'utf16be' | 'latin1' | 'windows' | 'mac' | 'hex' | 'base64';

export function encodingOf(name: string, platform: NodeJS.Platform = process.platform): Encoding {
  const n = name.trim().toLowerCase().replace(/[-_\s]/g, '');
  switch (n) {
    case 'utf8': return 'utf8';
    case 'utf16': case 'utf16le': return 'utf16le';
    case 'utf16be': return 'utf16be';
    case 'iso88591': case 'latin1': return 'latin1';
    case 'ansi': case 'windows': case 'windows1252': case 'cp1252': return 'windows';
    case 'mac': case 'macroman': return 'mac';
    case 'hex': return 'hex';
    case 'base64': return 'base64';
    case '': case 'native': return platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'utf8';
    default: throw new MbsError(`Unknown text encoding "${name}"`);
  }
}

/** Text as bytes in an encoding; for Hex and Base64 the text is read as hex or base64. */
export function toBytes(s: string, encoding: string): Uint8Array {
  switch (encodingOf(encoding)) {
    case 'utf8': return new TextEncoder().encode(s);
    case 'utf16le': return Buffer.from(s, 'utf16le');
    case 'utf16be': return Buffer.from(s, 'utf16le').swap16();
    case 'latin1': return Uint8Array.from([...s], (c) => (c.codePointAt(0)! < 256 ? c.codePointAt(0)! : 0x3f));
    case 'windows': return windows1252().encode(s);
    case 'mac': return macRoman().encode(s);
    case 'hex': {
      const h = s.replace(/\s+/g, '');
      if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new MbsError('Invalid hex string');
      return Buffer.from(h, 'hex');
    }
    case 'base64': return Buffer.from(s.replace(/\s+/g, ''), 'base64');
  }
}

// UTF-16 needs whole pairs of bytes: a stray last byte is dropped.
const even = (b: Uint8Array) => (b.length % 2 ? b.subarray(0, b.length - 1) : b);

/** Bytes as text in an encoding; for Hex and Base64 the bytes are written as hex (upper case) or base64. */
export function fromBytes(b: Uint8Array, encoding: string): string {
  switch (encodingOf(encoding)) {
    case 'utf8': return new TextDecoder().decode(b);
    case 'utf16le': return Buffer.from(even(b)).toString('utf16le');
    case 'utf16be': return Buffer.from(even(b)).swap16().toString('utf16le');
    case 'latin1': return Buffer.from(b).toString('latin1');
    case 'windows': return windows1252().decode(b);
    case 'mac': return macRoman().decode(b);
    case 'hex': return Buffer.from(b).toString('hex').toUpperCase();
    case 'base64': return Buffer.from(b).toString('base64');
  }
}

// --- HTML entities (HTML 4's set, which MBS writes and reads) -------------------------

const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
const OTHER = 'quot 34 amp 38 apos 39 lt 60 gt 62 OElig 338 oelig 339 Scaron 352 scaron 353 Yuml 376 fnof 402 circ 710 tilde 732 '
  + 'Alpha 913 Beta 914 Gamma 915 Delta 916 Epsilon 917 Zeta 918 Eta 919 Theta 920 Iota 921 Kappa 922 Lambda 923 Mu 924 Nu 925 Xi 926 Omicron 927 Pi 928 Rho 929 '
  + 'Sigma 931 Tau 932 Upsilon 933 Phi 934 Chi 935 Psi 936 Omega 937 alpha 945 beta 946 gamma 947 delta 948 epsilon 949 zeta 950 eta 951 theta 952 iota 953 '
  + 'kappa 954 lambda 955 mu 956 nu 957 xi 958 omicron 959 pi 960 rho 961 sigmaf 962 sigma 963 tau 964 upsilon 965 phi 966 chi 967 psi 968 omega 969 '
  + 'thetasym 977 upsih 978 piv 982 ensp 8194 emsp 8195 thinsp 8201 zwnj 8204 zwj 8205 lrm 8206 rlm 8207 ndash 8211 mdash 8212 lsquo 8216 rsquo 8217 '
  + 'sbquo 8218 ldquo 8220 rdquo 8221 bdquo 8222 dagger 8224 Dagger 8225 bull 8226 hellip 8230 permil 8240 prime 8242 Prime 8243 lsaquo 8249 rsaquo 8250 '
  + 'oline 8254 frasl 8260 euro 8364 image 8465 weierp 8472 real 8476 trade 8482 alefsym 8501 larr 8592 uarr 8593 rarr 8594 darr 8595 harr 8596 crarr 8629 '
  + 'lArr 8656 uArr 8657 rArr 8658 dArr 8659 hArr 8660 forall 8704 part 8706 exist 8707 empty 8709 nabla 8711 isin 8712 notin 8713 ni 8715 prod 8719 '
  + 'sum 8721 minus 8722 lowast 8727 radic 8730 prop 8733 infin 8734 ang 8736 and 8743 or 8744 cap 8745 cup 8746 int 8747 there4 8756 sim 8764 cong 8773 '
  + 'asymp 8776 ne 8800 equiv 8801 le 8804 ge 8805 sub 8834 sup 8835 nsub 8836 sube 8838 supe 8839 oplus 8853 otimes 8855 perp 8869 sdot 8901 lceil 8968 '
  + 'rceil 8969 lfloor 8970 rfloor 8971 lang 9001 rang 9002 loz 9674 spades 9824 clubs 9827 hearts 9829 diams 9830';
const ENTITY = new Map<string, number>();
LATIN1.split(' ').forEach((name, i) => ENTITY.set(name, 160 + i));
for (let i = 0, o = OTHER.split(' '); i < o.length; i += 2) ENTITY.set(o[i], Number(o[i + 1]));
const NAME_OF = new Map([...ENTITY].map(([name, code]) => [code, name]));
const XML_ESCAPES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

function decodeEntities(s: string, named: (name: string) => number | undefined): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (all, ref: string) => {
    const code = ref[0] !== '#' ? named(ref) : ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code !== undefined && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

// --- accents ---------------------------------------------------------------------
// Letters with no decomposition, and punctuation, as MBS's Text.RemoveAccents example maps them (ß to a single s).
const PLAIN: Record<string, string> = {
  Æ: 'AE', æ: 'ae', Ð: 'D', ð: 'd', Ø: 'O', ø: 'o', Þ: 'P', þ: 'p', ß: 's', Ł: 'L', ł: 'l', Œ: 'OE', œ: 'oe', Đ: 'D', đ: 'd', ı: 'i',
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '‟': '"', '•': '*',
  '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
  '⅐': '1/7', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅑': '1/9', '⅒': '1/10', '↉': '0/3',
};
export const removeAccents = (s: string) =>
  [...s].map((c) => PLAIN[c] ?? (/[\p{L}]/u.test(c) ? c.normalize('NFD').replace(/\p{M}+/gu, '') : c)).join('');

// --- the rest ----------------------------------------------------------------------

/** Trim: characters up to space, DEL and the no-break space ("alt-space"), and nothing else. */
const SPACE = '[\\u0000-\\u0020\\u007f\\u00a0]';
const isSpace = (c: number) => c <= 0x20 || c === 0x7f || c === 0xa0;
const leftTrim = (s: string) => s.replace(new RegExp(`^${SPACE}+`), '');
// A scan from the end: an end-anchored pattern is quadratic on a long run of spaces followed by another character.
const rightTrim = (s: string) => {
  let end = s.length;
  while (end > 0 && isSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(0, end);
};
/** Words: runs of letters and digits (with their combining marks); everything else separates them. */
const words = (s: string) => s.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
// Lower case one character at a time, keeping any character whose lower case is longer (such as "İ"),
// so positions found in the folded text are the same in the original.
const fold = (s: string, sensitive: boolean) =>
  sensitive ? s : s.replace(/[\s\S]/gu, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c));
const truthy = (s: string | undefined) => s !== undefined && s.trim() !== '' && Number(s) !== 0 && !Number.isNaN(Number(s));
const int = (s: string | undefined, d: number) => (s === undefined || s.trim() === '' || Number.isNaN(Number(s)) ? d : Math.trunc(Number(s)));

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  // The search window grows with the texts, so the work is about a.length × b.length / 2: very long texts are refused.
  if (a.length * b.length > 50_000_000) throw new MbsError('Text.JaroWinklerDistance: the texts are too long to compare');
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k++]) t++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function levenshtein(a: string, b: string): number {
  // The table is a.length × b.length: two very long texts would hold the server's calculations up, so they're refused.
  if (a.length * b.length > 25_000_000) throw new MbsError('Text.LevenshteinDistance: the texts are too long to compare');
  // The distance is the same either way round; the row is kept to the shorter text.
  if (b.length > a.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** American Soundex: the first letter and three digits. Accented letters count as their base letter. */
function soundex(s: string): string {
  const letters = removeAccents(s).toUpperCase().replace(/[^A-Z]/g, '');
  if (!letters) return '';
  const code = (c: string) => ('BFPV'.includes(c) ? '1' : 'CGJKQSXZ'.includes(c) ? '2' : 'DT'.includes(c) ? '3' : c === 'L' ? '4' : 'MN'.includes(c) ? '5' : c === 'R' ? '6' : '');
  let out = letters[0];
  let last = code(letters[0]);
  for (const c of letters.slice(1)) {
    const d = code(c);
    if (d && d !== last) out += d;
    // H and W don't separate letters with the same code; vowels do.
    if (c !== 'H' && c !== 'W') last = d;
    if (out.length === 4) break;
  }
  return out.padEnd(4, '0');
}

/** IMAP's modified UTF-7 (RFC 3501): &…- holds base64 (with "," for "/") of UTF-16BE; "&-" is "&". */
function decodeImapUtf7(s: string): string {
  return s.replace(/&([A-Za-z0-9+,]*)-/g, (_, b64: string) => {
    if (!b64) return '&';
    return Buffer.from(even(Buffer.from(b64.replace(/,/g, '/'), 'base64'))).swap16().toString('utf16le');
  });
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', json: 'application/json', xml: 'application/xml', js: 'text/javascript',
  rtf: 'application/rtf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', epub: 'application/epub+zip',
  fmp12: 'application/x-filemaker', exe: 'application/octet-stream', bin: 'application/octet-stream', dmg: 'application/x-apple-diskimage',
  txt: 'text/plain', csv: 'text/csv', tab: 'text/tab-separated-values', tsv: 'text/tab-separated-values', htm: 'text/html', html: 'text/html',
  css: 'text/css', md: 'text/markdown', ics: 'text/calendar', vcf: 'text/vcard', eml: 'message/rfc822',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', ico: 'image/x-icon',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', ogg: 'audio/ogg',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', webm: 'video/webm',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
// The usual extension for each type: the first one listed for it.
const EXTENSION_OF = new Map<string, string>();
for (const [ext, type] of Object.entries(MIME_TYPES)) if (!EXTENSION_OF.has(type)) EXTENSION_OF.set(type, ext);

/** Size expanding encodings first, then build in chunks without a per-character array or rope for the whole result. */
function checkedEncode<T>(input: Iterable<T>, encode: (item: T) => string, overhead = 0): string {
  let size = overhead;
  checkTextSize(size);
  for (const item of input) {
    size += encode(item).length;
    checkTextSize(size);
  }
  const chunks: string[] = [], pieces: string[] = [];
  for (const item of input) {
    pieces.push(encode(item));
    if (pieces.length === 4096) { chunks.push(pieces.join('')); pieces.length = 0; }
  }
  chunks.push(pieces.join(''));
  return chunks.join('');
}

function encodeBinary(s: string, encoding: string, format: 'base64' | 'base64url' | 'hex'): string {
  const bytes = toBytes(s, encoding);
  checkTextSize(format === 'hex' ? bytes.length * 2 : format === 'base64' ? Math.ceil(bytes.length / 3) * 4 : Math.ceil(bytes.length * 4 / 3));
  const result = Buffer.from(bytes).toString(format);
  return format === 'hex' ? result.toUpperCase() : result;
}

/** Quoted-printable bytes; soft line breaks ("=" CRLF) keep lines to the line length. */
function quotedPrintable(b: Uint8Array, lineLength: number): string {
  const max = Math.max(4, lineLength);
  const plain = (byte: number, i: number) => (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && i !== b.length - 1);
  let size = 0, column = 0;
  for (let i = 0; i < b.length; i++) {
    const width = plain(b[i], i) ? 1 : 3;
    if (column + width > max - 1) { size += 3; column = 0; }
    size += width;
    column += width;
    checkTextSize(size);
  }
  const chunks: string[] = [], pieces: string[] = [];
  column = 0;
  b.forEach((byte, i) => {
    const piece = plain(byte, i) ? String.fromCharCode(byte) : '=' + byte.toString(16).toUpperCase().padStart(2, '0');
    if (column + piece.length > max - 1) {
      pieces.push('=\r\n');
      column = 0;
    }
    pieces.push(piece);
    column += piece.length;
    if (pieces.length >= 4096) { chunks.push(pieces.join('')); pieces.length = 0; }
  });
  chunks.push(pieces.join(''));
  return chunks.join('');
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const body = s.replace(/=(\r\n|\r|\n)/g, '');
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const hex = body[i] === '=' && /^[0-9a-f]{2}$/i.test(body.slice(i + 1, i + 3)) ? body.slice(i + 1, i + 3) : undefined;
    if (hex) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      // A whole character, so an emoji's two UTF-16 halves are encoded together.
      const c = String.fromCodePoint(body.codePointAt(i)!);
      out.push(...new TextEncoder().encode(c));
      i += c.length - 1;
    }
  }
  return Uint8Array.from(out);
}

const percent = (b: Uint8Array, keep: RegExp, space?: string) =>
  checkedEncode(b, (x) => (space && x === 32 ? space : keep.test(String.fromCharCode(x)) ? String.fromCharCode(x) : '%' + x.toString(16).toUpperCase().padStart(2, '0')));
function unpercent(s: string, plusIsSpace: boolean): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (plusIsSpace && s[i] === '+') out.push(32);
    else {
      const c = String.fromCodePoint(s.codePointAt(i)!);
      out.push(...new TextEncoder().encode(c));
      i += c.length - 1;
    }
  }
  return Uint8Array.from(out);
}

function replaceNewLine(s: string, mode: number, wrap: number): string {
  const nul = s.indexOf('\u0000');
  let t = nul >= 0 ? s.slice(0, nul) : s;
  const base = mode & 7;
  if (base > 5) throw new MbsError(`Text.ReplaceNewLine: mode ${mode} is not one of 0 to 5 (plus 8)`);
  let lines = t.split(/\r\n|\r|\n/);
  if (mode & 8) lines = lines.filter((l, i) => l !== '' || i === 0 || i === lines.length - 1);
  if (wrap > 0) {
    // Lines longer than Wrap break at the last space that fits, or at Wrap characters when there is none (inferred).
    lines = lines.flatMap((line) => {
      const parts: string[] = [];
      let rest = line;
      while (rest.length > wrap) {
        const at = rest.lastIndexOf(' ', wrap);
        const cut = at > 0 ? at : wrap;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(at > 0 ? cut + 1 : cut);
      }
      return [...parts, rest];
    });
  }
  t = lines.join(['', '\r', '\n', '\r\n', '<br>', '<br />'][base]);
  return t;
}

function encodeHtml(s: string, mode: number): string {
  const numeric = mode & 3;
  const all = (mode & 8) !== 0;
  return checkedEncode(s, (c) => {
    const code = c.codePointAt(0)!;
    // Lower-ASCII control characters are dropped; tab, CR and LF stay (inferred: the page says "ignored").
    if (code < 32 && c !== '\t' && c !== '\r' && c !== '\n') return '';
    const name = NAME_OF.get(code);
    const special = code > 126 || '"&\'<>'.includes(c);
    if (!special && !all) return c;
    if (name && numeric === 0 && name !== 'apos') return `&${name};`;
    if (numeric === 2) return `&#x${code.toString(16)};`;
    return `&#${code};`;
  });
}

type MbsText = (a: string[]) => string | number;

/** The Text functions by lower-case name ("text.trim"). Each takes its parameters as text. */
export const MBS_TEXT: Record<string, MbsText> = {
  'text.capitalcase': ([s = '']) => s.toLowerCase().replace(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu, (w) => w[0].toUpperCase() + w.slice(1)),
  'text.character': ([n = '']) => {
    const code = Number(n);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) throw new MbsError(`${n} is not a Unicode code point`);
    return String.fromCodePoint(code);
  },
  'text.characters': ([s = '']) => [...s].map((c) => c.codePointAt(0)).join(' '),
  'text.code': ([s = '']) => (s ? s.codePointAt(0)! : 0),
  'text.concat': (a) => joinText(a),
  'text.concatwithdelimiter': ([d = '', ...rest]) => joinText(rest.filter((x) => x !== ''), d),
  'text.convertunicodetocharactercomposition': ([s = '']) => s.normalize('NFC'),
  'text.convertunicodetocharacterdecomposition': ([s = '']) => s.normalize('NFD'),
  // One line per word, "count<tab>word". MBS says its list is not sorted; Tabularius lists words as they first appear.
  'text.countwords': ([s = '']) => {
    const counts = new Map<string, number>();
    for (const w of words(s)) counts.set(w, (counts.get(w) ?? 0) + 1);
    return [...counts].map(([w, n]) => `${n}\t${w}`).join('\r');
  },
  'text.decodefrombase64': ([s = '', e = 'Native']) => fromBytes(Buffer.from(s.replace(/\s+/g, ''), 'base64'), e),
  'text.decodefrombase64url': ([s = '', e = 'Native']) => fromBytes(Buffer.from(s.replace(/\s+/g, ''), 'base64url'), e),
  'text.decodefromhtml': ([s = '', options]) => decodeEntities(s, (name) => (int(options, 0) === 1 && XML_ESCAPES.has(name) ? undefined : ENTITY.get(name))),
  'text.decodefromhex': ([s = '', e = 'Native']) => fromBytes(toBytes(s, 'hex'), e),
  'text.decodefromquotedprintable': ([s = '', e = 'Native']) => fromBytes(decodeQuotedPrintable(s), e),
  'text.decodefromurl': ([s = '', e = 'Native']) => fromBytes(unpercent(s, true), e),
  'text.decodefromxml': ([s = '']) => decodeEntities(s, (name) => (XML_ESCAPES.has(name) ? ENTITY.get(name) : undefined)),
  // The page shows no Encoding, but its own example passes one; UTF-8 when none is given, as before.
  'text.decodeurlcomponent': ([s = '', e = 'UTF-8']) => fromBytes(unpercent(s, false), e),
  'text.decodeimapfoldername': ([s = '']) => decodeImapUtf7(s),
  'text.encodeemailsubject': ([s = '']) => {
    if (/^[\x20-\x7e]*$/.test(s)) { checkTextSize(s.length); return s; }
    const q = checkedEncode(new TextEncoder().encode(s), (b) => (b === 32 ? '_' : /[A-Za-z0-9!*+\-/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0')), 12);
    return `=?UTF-8?Q?${q}?=`;
  },
  'text.encodetobase64': ([s = '', e = 'Native']) => encodeBinary(s, e, 'base64'),
  'text.encodetobase64url': ([s = '', e = 'Native']) => encodeBinary(s, e, 'base64url'),
  'text.encodetohtml': ([s = '', mode]) => encodeHtml(s, int(mode, 0)),
  'text.encodetohex': ([s = '', e = 'Native']) => encodeBinary(s, e, 'hex'),
  'text.encodetoquotedprintable': ([s = '', e = 'Native', len]) => quotedPrintable(toBytes(s, e), int(len, 72) > 0 ? int(len, 72) : 72),
  // As PHP's urlencode: letters, digits and - _ . stay; a space is "+".
  'text.encodetourl': ([s = '', e = 'Native']) => percent(toBytes(s, e), /[A-Za-z0-9\-_.]/, '+'),
  'text.encodetoxml': ([s = '']) => checkedEncode(s, (c) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c) ? ''
    : ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c),
  // Only letters and digits stay ("." is %2E in MBS's own example).
  'text.encodeurlcomponent': ([s = '', e = 'Native']) => percent(toBytes(s, e), /[A-Za-z0-9]/),
  'text.fileextensiontomimetype': ([s = '']) => {
    const ext = s.replace(/^.*[./\\:]/, '').toLowerCase();
    const type = MIME_TYPES[ext];
    if (!type) throw new MbsError(`No mime type known for "${s}"`);
    return type;
  },
  'text.mimetypetofileextension': ([s = '']) => {
    const ext = EXTENSION_OF.get(s.trim().toLowerCase().replace(/;.*$/, '').trim());
    if (!ext) throw new MbsError(`No file extension known for "${s}"`);
    return '.' + ext;
  },
  // Accents first, then anything outside 7-bit ASCII is the Replacement, once per UTF-16 unit (an emoji twice), as MBS does.
  'text.filterascii': ([s = '', replacement = '']) => removeAccents(s).replace(/[^\u0000-\u007f]/g, replacement),
  'text.findbetween': ([s = '', start = '', end = '', ignoreCase, nth]) => {
    const hay = fold(s, !truthy(ignoreCase));
    const [a, b] = [fold(start, !truthy(ignoreCase)), fold(end, !truthy(ignoreCase))];
    let from = 0;
    for (let skip = Math.max(0, int(nth, 0)); ; skip--) {
      const i = hay.indexOf(a, from);
      if (i < 0) return '';
      const j = hay.indexOf(b, i + a.length);
      if (j < 0) return '';
      if (skip === 0) return s.slice(i + a.length, j);
      // Empty tags would find the same place again and again.
      if (j + b.length <= from) return '';
      from = j + b.length;
    }
  },
  'text.jarowinklerdistance': ([a = '', b = '']) => 1 - jaroWinkler(a, b),
  'text.lefttrim': ([s = '']) => leftTrim(s),
  'text.length': ([s = '']) => s.length,
  // Edits divided by the first text's length: MBS says the value can pass 1 when the lengths differ a lot (inferred).
  'text.levenshteindistance': ([a = '', b = '']) => (a.length ? levenshtein(a, b) / a.length : b.length ? 1 : 0),
  'text.list': (a) => a.join('\r'),
  'text.listwords': ([s = '']) => words(s).join('\r'),
  'text.lowercase': ([s = '']) => s.toLowerCase(),
  'text.removeaccents': ([s = '']) => removeAccents(s),
  'text.removeaccentscaseinsensitive': ([s = '']) => removeAccents(s).toUpperCase(),
  'text.removecontrolcharacters': ([s = '']) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f﻿]/g, ''),
  'text.removenewline': ([s = '']) => s.replace(/[\r\n]/g, ''),
  'text.removepostfix': ([s = '', post = '', sensitive]) =>
    post && fold(s, truthy(sensitive)).endsWith(fold(post, truthy(sensitive))) ? s.slice(0, s.length - post.length) : s,
  'text.removeprefix': ([s = '', pre = '', sensitive]) =>
    pre && fold(s, truthy(sensitive)).startsWith(fold(pre, truthy(sensitive))) ? s.slice(pre.length) : s,
  'text.replaceall': ([s = '', find = '', by = '']) => substituteText(s, find, by, true),
  'text.replacenewline': ([s = '', mode, wrap]) => replaceNewLine(s, int(mode, 0), int(wrap, 0)),
  'text.reverse': ([s = '']) => [...s].reverse().join(''),
  'text.righttrim': ([s = '']) => rightTrim(s),
  'text.soundex': ([s = '']) => soundex(s),
  'text.splitbylength': ([s = '', len]) => {
    const n = Math.max(1, int(len, 1));
    const chars = [...s];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(''));
    return out.join('\r');
  },
  'text.trim': ([s = '']) => rightTrim(leftTrim(s)),
  'text.uppercase': ([s = '']) => s.toUpperCase(),
};
// The page's own examples spell it without "Name".
MBS_TEXT['text.decodeimapfolder'] = MBS_TEXT['text.decodeimapfoldername'];

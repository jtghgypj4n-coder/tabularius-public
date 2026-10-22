// A minimal Excel workbook (.xlsx): one sheet of rows, written for Export Records
// and read for Import Records. Numbers are number cells, dates, times and timestamps are
// serial numbers with a display format, everything else is text. node:zlib only.

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** Total bytes inflated from the workbook parts actually read; separate from the compressed upload limit. */
export const MAX_XLSX_BYTES = 256 * 1024 * 1024;

export type XlsxCell = string | number;
/** A date, time or timestamp for the writer: Excel's serial number (days since 1899-12-30; a time is a fraction of a day). */
export interface XlsxTyped { serial: number; kind: 'date' | 'time' | 'timestamp' }
export type XlsxOutCell = XlsxCell | XlsxTyped;

const typed = (v: XlsxOutCell): v is XlsxTyped => typeof v === 'object';

/** Excel's serial for a FileMaker date (day 1 is 0001-01-01), time (seconds) or timestamp (seconds since 0001-01-01 00:00:00). */
export const serialOf = {
  date: (day: number): XlsxTyped => ({ serial: day - 693594, kind: 'date' }),
  time: (seconds: number): XlsxTyped => ({ serial: seconds / 86400, kind: 'time' }),
  timestamp: (seconds: number): XlsxTyped => ({ serial: seconds / 86400 - 693593, kind: 'timestamp' }),
};

/** A date, time or timestamp written as ISO text (2026-10-15, 13:45:00, 2026-10-15T13:45:00) as a typed cell; anything else stays text. */
export function isoCell(text: string, kind: 'date' | 'time' | 'timestamp'): XlsxOutCell {
  const m = kind === 'time'
    ? /^(\d{1,2}):(\d\d)(?::(\d\d)(?:\.(\d+))?)?$/.exec(text.trim())
    : /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d{1,2}):(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?$/.exec(text.trim());
  if (!m) return text;
  if (kind === 'time') return { serial: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) + Number(`0.${m[4] ?? 0}`)) / 86400, kind };
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  // Month 13, day 40 and the like: not a date.
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return text;
  if (kind === 'date') return { serial: ms / 86400000 + 25569, kind };
  return { serial: ms / 86400000 + 25569 + (Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0) + Number(`0.${m[7] ?? 0}`)) / 86400, kind };
}

/** Cell styles in the styles part: 1 is the bold header, 2 to 4 are the date, time and timestamp formats. */
const STYLE = { header: 1, date: 2, time: 3, timestamp: 4 } as const;
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="hh:mm:ss"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

const xml = (s: string) => s
  // Characters XML 1.0 can't hold.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/\r/g, '&#13;');

/** Decode ST_Xstring escapes in cell text in one pass, without decoding a literal escaped underscore twice. */
export const ooxmlString = (s: string): string => s.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

const escapeOoxmlString = (s: string): string => s.replace(/_x[0-9a-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`);

/** A, B, ... Z, AA, AB, ... */
export function columnName(n: number): string {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function sheet(rows: XlsxOutCell[][], header: boolean): string {
  const width = (c: XlsxOutCell) => (typed(c) ? (c.kind === 'date' ? 10 : c.kind === 'time' ? 8 : 19) : String(c).split(/\r\n|\r|\n/).reduce((m, l) => Math.max(m, [...l].length), 0));
  const columns = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths: number[] = Array.from({ length: columns }, () => 0);
  // The first thousand rows are enough to size a column.
  for (const row of rows.slice(0, 1000)) row.forEach((c, i) => { widths[i] = Math.max(widths[i], width(c)); });
  const cols = columns ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, w + 2))}" customWidth="1"/>`).join('')}</cols>` : '';
  const view = header && rows.length ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    const ref = `${columnName(c)}${r + 1}`;
    if (typed(v)) return Number.isFinite(v.serial) ? `<c r="${ref}" s="${STYLE[v.kind]}"><v>${v.serial}</v></c>` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${Object.is(v, -0) ? '-0' : v}</v></c>`;
    if (v === '') return '';
    return `<c r="${ref}"${header && r === 0 ? ` s="${STYLE.header}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xml(escapeOoxmlString(String(v)))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const filter = header && rows.length && columns ? `<autoFilter ref="A1:${columnName(columns - 1)}${rows.length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

const PARTS = (sheetXml: string, name: string, filter = ''): [string, string][] => [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>${filter}</workbook>`],
  ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['xl/styles.xml', STYLES],
  ['xl/worksheets/sheet1.xml', sheetXml],
];

/**
 * The workbook's bytes: a zip of the parts above, deflated. With `header`, the first row is the column names:
 * bold, frozen, with a filter button on each column.
 */
export function xlsx(rows: XlsxOutCell[][], sheetName = 'Sheet1', opts: { header?: boolean } = {}): Uint8Array {
  if (rows.length > 1_048_576) throw new SheetLimitError('Excel allows at most 1,048,576 rows');
  for (const row of rows) {
    if (row.length > 16_384) throw new SheetLimitError('Excel allows at most 16,384 columns');
    for (const value of row) {
      if (!typed(value) && typeof value === 'string' && value.length > 32_767)
        throw new SheetLimitError('Excel allows at most 32,767 characters in a cell');
    }
  }
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // Sheet names: at most 31 characters, none of []:*?/\
  const name = sheetName.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).replace(/^'+|'+$/g, '').trim() || 'Sheet1';
  const header = !!opts.header && rows.length > 0;
  const columns = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const filter = header && columns ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xml(`'${name.replace(/'/g, "''")}'!$A$1:$${columnName(columns - 1)}$${rows.length}`)}</definedName></definedNames>` : '';
  for (const [path, content] of PARTS(sheet(rows, header), name, filter)) {
    const data = Buffer.from(content, 'utf8');
    const packed = deflateRawSync(data);
    const file = Buffer.from(path, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0, 10); // time
    head.writeUInt16LE(0x21, 12); // date: 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(file.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, file, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(file.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, file);
    offset += head.length + file.length + packed.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(PARTS('', '').length, 8);
  end.writeUInt16LE(PARTS('', '').length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dirBytes, end]));
}

/** XML text with its character references and the five named entities decoded; a reference to no character is left as written. */
export const unxml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (all, e: string) => {
  const k = e.toLowerCase();
  if (k === 'lt') return '<';
  if (k === 'gt') return '>';
  if (k === 'quot') return '"';
  if (k === 'apos') return "'";
  if (k === 'amp') return '&';
  const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : Number(k.slice(1));
  return code <= 0x10ffff ? String.fromCodePoint(code) : all;
});

/** The text of an XML element's content: entities decoded, and a <![CDATA[...]]> section taken as it is. */
export const xmlText = (s: string) => {
  // Split only up to the last "]]>": a section opened after it never closes, and searching on for it is quadratic.
  const last = s.lastIndexOf(']]>');
  const cut = last < 0 ? 0 : last + 3;
  const parts = s.slice(0, cut).split(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  parts[parts.length - 1] += s.slice(cut);
  return parts.map((part, i) => (i % 2 ? part : unxml(part))).join('');
};

/** A cheap directory-only guard; unread parts may be larger than the inflation budget. */
const MAX_DECLARED_XLSX_BYTES = 4 * MAX_XLSX_BYTES;

/**
 * A reader of the files in a zip archive (stored or deflated): each call inflates only the files it names, so parts
 * nobody reads (pivot caches, pictures, other sheets) are never inflated, and all calls share one budget. Of entries
 * with the same name the last counts; the others are never inflated. A damaged archive throws an Error saying so.
 * `inflateBudget` is the most bytes all the calls inflate together.
 */
export function zipReader(zip: Uint8Array, inflateBudget = MAX_XLSX_BYTES): { names: () => Iterable<string>; read: (names: Iterable<string>) => Map<string, Uint8Array> } {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const bad = (): never => { throw new Error('bad zip directory'); };
  const u16 = (at: number) => (at >= 0 && at + 2 <= zip.length ? view.getUint16(at, true) : bad());
  const u32 = (at: number) => (at >= 0 && at + 4 <= zip.length ? view.getUint32(at, true) : bad());
  const rejectZip64Extra = (from: number, length: number) => {
    const end = from + length;
    for (let at = from; at < end;) {
      if (at + 4 > end) bad();
      const size = u16(at + 2);
      if (at + 4 + size > end) bad();
      if (u16(at) === 1) throw new Error('bad zip directory (Zip64 is unsupported)');
      at += 4 + size;
    }
  };
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === zip.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip file');
  const count = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) throw new Error('bad zip directory (multi-disk archive)');
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff) throw new Error('bad zip directory (Zip64 is unsupported)');
  if (end >= 20 && u32(end - 20) === 0x07064b50) throw new Error('bad zip directory (Zip64 is unsupported)');
  if (directoryStart + directorySize !== end) bad();
  let at = directoryStart;
  type Entry = { name: string; flags: number; method: number; packed: number; size: number; local: number; start: number };
  const directory: Entry[] = [];
  const entries = new Map<string, Entry>();
  let declared = 0;
  // Validate every directory entry before touching any compressed stream. Duplicate names also count.
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) bad();
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const packed = u32(at + 20);
    const size = u32(at + 24);
    const nameLen = u16(at + 28);
    const extra = u16(at + 30);
    const comment = u16(at + 32);
    if (u16(at + 34)) throw new Error('bad zip directory (multi-disk archive)');
    const local = u32(at + 42);
    const next = at + 46 + nameLen + extra + comment;
    if (next > end) bad();
    rejectZip64Extra(at + 46 + nameLen, extra);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('bad zip directory (Zip64 is unsupported)');
    if (flags & 1) throw new Error(`bad zip entry ${name} (encrypted archive)`);
    if (method !== 0 && method !== 8) throw new Error(`bad zip entry ${name} (unsupported compression method)`);
    if (method === 0 && packed !== size) throw new Error(`bad zip entry ${name} (incorrect uncompressed size)`);
    declared += size;
    if (declared > MAX_DECLARED_XLSX_BYTES) throw new Error(`bad zip directory (declared total over ${MAX_DECLARED_XLSX_BYTES} bytes unpacked)`);
    const entry = { name, flags, method, packed, size, local, start: 0 };
    directory.push(entry);
    entries.set(name, entry);
    at = next;
  }
  if (at !== end) bad();
  // Header and payload bounds are cheap to check for unread parts too. Bit 3 allows sizes in a data descriptor.
  for (const entry of directory) {
    const { name, flags, method, packed, size, local } = entry;
    if (local + 30 > directoryStart || u32(local) !== 0x04034b50) throw new Error(`bad zip entry ${name} (local header)`);
    if (u16(local + 6) !== flags || u16(local + 8) !== method) throw new Error(`bad zip entry ${name} (local header mismatch)`);
    if (!(flags & 8) && (u32(local + 18) !== packed || u32(local + 22) !== size)) throw new Error(`bad zip entry ${name} (local size mismatch)`);
    const localNameLen = u16(local + 26), localExtraLen = u16(local + 28);
    entry.start = local + 30 + localNameLen + localExtraLen;
    if (entry.start + packed > directoryStart) throw new Error(`bad zip entry ${name} (payload past directory)`);
    rejectZip64Extra(local + 30 + localNameLen, localExtraLen);
  }
  let budget = inflateBudget;
  const cache = new Map<string, Uint8Array>();
  const overBudget = (): never => { throw new Error(`the zip file expands to more than ${inflateBudget / 1024 / 1024} MB`); };
  const read = (names: Iterable<string>) => {
    const out = new Map<string, Uint8Array>();
    for (const name of names) {
      const entry = entries.get(name);
      if (entry === undefined || out.has(name)) continue;
      const cached = cache.get(name);
      if (cached) { out.set(name, cached); continue; }
      if (entry.size > budget) overBudget();
      const raw = zip.subarray(entry.start, entry.start + entry.packed);
      let file: Uint8Array;
      if (entry.method === 0) file = raw;
      else {
        try {
          file = inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) });
        } catch (e) {
          if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') overBudget();
          throw new Error(`bad zip entry ${name} (${(e as Error).message})`);
        }
      }
      if (file.length > budget) overBudget();
      if (file.length !== entry.size) throw new Error(`bad zip entry ${name} (incorrect uncompressed size)`);
      budget -= file.length;
      cache.set(name, file);
      out.set(name, file);
    }
    return out;
  };
  return { names: () => entries.keys(), read };
}

/** The files in a zip archive (stored or deflated), by name. A damaged archive throws an Error saying so. */
export function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const archive = zipReader(zip);
  return archive.read(archive.names());
}

/**
 * The <tag> elements of XML text, in order: each one's attribute text and its content (undefined when it closes
 * itself). Linear in the text, where a lazy regular expression takes quadratic time over tags that are never closed.
 */
export function* xmlElements(xml: string, tag: string): Generator<[attributes: string, content: string | undefined]> {
  const open = '<' + tag, close = `</${tag}>`;
  // Once a <tag> is never closed no later one can be, but one that closes itself still counts.
  let closes = true;
  for (let at = xml.indexOf(open); at >= 0; at = xml.indexOf(open, at)) {
    const from = at + open.length;
    at = from;
    if (/\w/.test(xml[from] ?? '')) continue;
    const gt = xml.indexOf('>', from);
    if (gt < 0) return;
    at = gt + 1;
    if (gt > from && xml[gt - 1] === '/') yield [xml.slice(from, gt - 1), undefined];
    else if (closes) {
      const stop = xml.indexOf(close, at);
      if (stop < 0) closes = false;
      else {
        yield [xml.slice(from, gt), xml.slice(at, stop)];
        at = stop + close.length;
      }
    }
  }
}

/** The matches of a regular expression that ends with ">", in linear time: past the last ">" no attempt can match, so none is made there. */
export const xmlTags = (xml: string, re: RegExp) => xml.slice(0, xml.lastIndexOf('>') + 1).matchAll(re);

/** `s` without the matches of `re`, all of which end with `end`: cut at the last `end` so no attempt runs on to the end of the text and fails. */
const removeUpTo = (s: string, re: RegExp, end: string) => {
  const cut = s.lastIndexOf(end);
  return cut < 0 ? s : s.slice(0, cut + end.length).replace(re, '') + s.slice(cut + end.length);
};

/** "AB12" -> 27 (the column, from 0). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

const decode = (file: Uint8Array | undefined) => (file ? new TextDecoder().decode(file) : undefined);

/** The parts that list a workbook's sheets: all xlsxSheetNames reads, and what readXlsx reads first. */
const WORKBOOK_PARTS = ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'];
const MAX_SHEETS = 256;

/** The sheets of a workbook, in order: their names and the part each is stored in. */
function workbookSheets(files: Map<string, Uint8Array>): { name: string; path: string }[] {
  const text = (name: string) => decode(files.get(name));
  // By Id (the first of an Id wins), so a workbook of many sheets is not a search of every relationship for each one.
  const rels = new Map<string, string>();
  for (const [r] of xmlTags(text('xl/_rels/workbook.xml.rels') ?? '', /<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(r)?.[1];
    if (id !== undefined && !rels.has(id)) rels.set(id, r);
  }
  const sheets = [...xmlTags(text('xl/workbook.xml') ?? '', /<sheet\b[^>]*>/g)].map((m, n) => {
    const name = unxml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? `Sheet${n + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const rel = rid && rels.get(rid);
    const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    return { name, path: target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : `xl/worksheets/sheet${n + 1}.xml` };
  });
  // Every sheet is a part of its own. A workbook that lists thousands of sheets, or many that share one part, is
  // not a workbook but a way to have a small upload read again and again.
  if (sheets.length > MAX_SHEETS) throw new Error(`The workbook has ${sheets.length} sheets; more than ${MAX_SHEETS} are not read`);
  // Excel never repeats a sheet name (the comparison ignores case), and a name that picks two sheets would read the first one every time.
  const parts = new Set<string>();
  const names = new Set<string>();
  for (const s of sheets) {
    if (names.has(s.name.toLowerCase())) throw new Error(`The workbook is not valid: it has more than one sheet called "${s.name}"`);
    names.add(s.name.toLowerCase());
    if (parts.has(s.path)) throw new Error(`The workbook is not valid: the sheet "${s.name}" is stored in the same part as another sheet`);
    parts.add(s.path);
  }
  return sheets.length ? sheets : [{ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' }];
}

/** The names of the sheets in a workbook, in order. */
export function xlsxSheetNames(data: Uint8Array): string[] {
  return workbookSheets(zipReader(data).read(WORKBOOK_PARTS)).map((s) => s.name);
}

/** The workbook has no sheet of the name asked for. */
export class MissingSheetError extends Error {}

/** The built-in number formats that show a date or a time (ECMA-376 18.8.30). */
const DATE_FORMATS = new Set([...Array(9).keys()].map((n) => n + 14).concat([27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]));

/** Whether a custom number format shows a date or a time: it has a day, month, year, hour or second outside quotes, escapes and [colours]. */
function isDateCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/_./g, '');
  return /[dmyhs]/i.test(removeUpTo(bare, /\[(?![hms]+\])[^\]]*\]/gi, ']'));
}

/** For each cell style (by index), whether it shows a date or a time. */
function dateStyles(styles: string): boolean[] {
  const codes = new Map([...xmlTags(styles, /<numFmt\b[^>]*>/g)].map((m) => [Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1]), unxml(/\bformatCode="([^"]*)"/.exec(m[0])?.[1] ?? '')] as const));
  const xfs = xmlElements(styles, 'cellXfs').next().value?.[1] ?? '';
  return [...xmlTags(xfs, /<xf\b[^>]*>/g)].map((m) => {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    const code = codes.get(id);
    return code !== undefined ? isDateCode(code) : DATE_FORMATS.has(id);
  });
}

/** A cell or row reference past Excel's last row or column, or a sheet too big to fill in. */
export class SheetLimitError extends Error {}

/** Excel's last row and its last column, XFD (from 1). */
const MAX_ROW = 1_048_576, MAX_COLUMN = 16_384;

/** The most cells a sheet may come to, the empty ones between its cells and rows counted: 400 MB of slots. */
const MAX_CELLS = 50_000_000;

/** Days between Excel's two date systems (1900 and 1904). */
const DATE_1904_OFFSET = 1462;

/**
 * A sheet of an Excel workbook (.xlsx) as rows: the first, or the one named `sheet`. Numbers are numbers
 * (dates stay Excel serial numbers, in the 1900 system even when the workbook counts from 1904), shared and
 * inline strings are text (without the phonetic guide runs Japanese text carries), booleans are 1 and 0.
 * Empty cells are ''. A sheet that is not there throws MissingSheetError.
 */
export function readXlsx(data: Uint8Array, sheetName?: string): XlsxCell[][] {
  return openXlsx(data).read(sheetName);
}

/** An opened workbook: the sheets can be read one after another, sharing one archive, one inflate budget and one cell budget. */
export interface XlsxWorkbook {
  sheetNames: string[];
  read(sheetName?: string): XlsxCell[][];
}

/**
 * A workbook opened once. Reading several sheets of it (an import of every sheet) inflates the shared strings
 * once, and all the sheets together stay within the budgets one sheet has: inflated bytes (MAX_XLSX_BYTES) and cells.
 */
export function openXlsx(data: Uint8Array): XlsxWorkbook {
  const archive = zipReader(data);
  const book = archive.read(WORKBOOK_PARTS);
  const sheets = workbookSheets(book);
  // A workbook that counts days from 1904 (Excel for Mac's old default) is read as the 1900 system, so every date means what it did.
  const from1904 = [...xmlTags(decode(book.get(WORKBOOK_PARTS[0])) ?? '', /<workbookPr\b[^>]*>/gi)].some((m) => /\bdate1904="(?:1|true)"/i.test(m[0]));
  let shared: string[] | undefined;
  let dates: boolean[] | undefined;
  let cellsInBook = 0;
  return { sheetNames: sheets.map((s) => s.name), read: (sheetName) => readSheet(sheetName) };

  function readSheet(sheetName?: string): XlsxCell[][] {
    const wanted = sheetName === undefined ? sheets[0] : sheets.find((s) => s.name === sheetName) ?? sheets.find((s) => s.name.toLowerCase() === sheetName.toLowerCase());
    if (!wanted) throw new MissingSheetError(`the workbook has no sheet called "${sheetName}"`);
    // Only the parts this sheet needs, all inflated before any is decoded: the budget stops a bomb before its text fills memory.
    // The shared strings and styles are inflated by the first sheet read and kept for the rest.
    const parts = archive.read([wanted.path, ...(shared ? [] : ['xl/sharedStrings.xml']), ...(from1904 && !dates ? ['xl/styles.xml'] : [])]);
    const text = (name: string) => decode(parts.get(name));
    const phonetic = (si: string) => removeUpTo(si, /<rPh\b[\s\S]*?<\/rPh>/g, '</rPh>');
    const runs = (si: string) => ooxmlString([...xmlElements(phonetic(si), 't')].map(([, t]) => unxml(t ?? '')).join(''));
    shared ??= [...xmlElements(text('xl/sharedStrings.xml') ?? '', 'si')].map(([, si]) => runs(si ?? ''));
    const sheet = text(wanted.path);
    if (sheet === undefined) throw new Error('the workbook has no sheet');
    dates ??= from1904 ? dateStyles(text('xl/styles.xml') ?? '') : [];
    const rows: XlsxCell[][] = [];
    // The empty cells a row skips are filled in only once the whole sheet is known to fit, so a few bytes saying
    // "XFD1" on every row can't fill memory first. Until then such a row is its columns and values.
    const sparse: { at: number; cols: number[]; values: XlsxCell[]; width: number }[] = [];
    let cells = 0;
    const count = (n: number) => {
      if ((cells += n) > MAX_CELLS || (cellsInBook += n) > MAX_CELLS) throw new SheetLimitError(`the sheet comes to more than ${MAX_CELLS} cells, counting the empty ones between`);
    };
    for (const [attributes, content] of xmlElements(sheet, 'row')) {
      const r = /\br="(\d+)"/.exec(attributes)?.[1];
      const rowNum = r === undefined ? rows.length + 1 : Number(r);
      if (rowNum > MAX_ROW) throw new SheetLimitError(`row ${r} is past Excel's last row, ${MAX_ROW}`);
      const values: XlsxCell[] = [];
      // Each value's column, kept from the first cell out of its place on (the rest are in order).
      let cols: number[] | undefined;
      let next = 0, width = 0;
      for (const [cell, body = ''] of xmlElements(content ?? '', 'c')) {
        const ref = /\br="([A-Z]+\d+)"/.exec(cell)?.[1];
        const col = ref ? columnIndex(ref) : next;
        if (ref && col >= MAX_COLUMN) throw new SheetLimitError(`cell ${ref} is past Excel's last column, XFD`);
        next = col + 1;
        const type = /\bt="([^"]+)"/.exec(cell)?.[1];
        const v = xmlElements(body, 'v').next().value?.[1];
        let value: XlsxCell = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = runs(body);
        else if (type === 'str' || type === 'e' || type === 'd') value = ooxmlString(unxml(v ?? '')); // 'd' is an ISO 8601 date, 'e' an error such as #DIV/0!
        else if (type === 'b') value = v === '1' ? 1 : 0;
        else if (v !== undefined) {
          value = Number.isFinite(Number(v)) ? Number(v) : unxml(v);
          const style = Number(/\bs="(\d+)"/.exec(cell)?.[1] ?? -1);
          if (from1904 && typeof value === 'number' && dates[style]) value += DATE_1904_OFFSET;
        }
        if (!cols && col !== values.length) cols = values.map((_, i) => i);
        cols?.push(col);
        values.push(value);
        width = Math.max(width, next);
      }
      if (rowNum - 1 > rows.length) count(rowNum - 1 - rows.length);
      while (rows.length < rowNum - 1) rows.push([]);
      count(Math.max(width, 1));
      if (!cols) rows.push(values);
      else {
        sparse.push({ at: rows.length, cols, values, width });
        rows.push([]);
      }
    }
    for (const { at, cols, values, width } of sparse) {
      const row: XlsxCell[] = Array(width).fill('');
      cols.forEach((col, i) => { row[col] = values[i]; });
      rows[at] = row;
    }
    return rows;
  }
}

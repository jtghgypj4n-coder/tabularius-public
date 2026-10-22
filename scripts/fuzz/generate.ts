// All inputs originate here. No external corpus or file input is accepted.
import { zip, type ZipEntry } from '../../packages/calc/src/zip.ts';
import { BINARY_OID, binaryValue, encodeArray, encodeInterval, encodeNumeric } from '../../packages/server/src/pgbinary.ts';
export const TARGETS = ['filemaker-xml', 'fmpxmlresult', 'csv', 'tsv', 'merge', 'xlsx', 'zip', 'ics', 'json', 'ohplugin', 'clipboard', 'script', 'calc', 'sql', 'odata-filter', 'data-api', 'multipart', 'mime-headers', 'fmp12', 'pgwire-binary'] as const;
export type Target = typeof TARGETS[number];
export const MAX_INPUT = 256 * 1024;
export type Random = (n: number) => number;
export function random(seed: number): Random {
  let state = seed >>> 0;
  return n => {
    let x = state = (state + 0x6d2b79f5) >>> 0;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return Math.floor(((x ^ (x >>> 14)) >>> 0) / 0x100000000 * n);
  };
}
const bytes = (s: string) => Buffer.from(s);
export const manifest = { id: 'org.example.fuzz', name: 'Synthetic', version: '1.0.0', api: '^1.0', publisher: 'Synthetic', main: 'main.js', functions: [{ name: 'Synthetic', min: 0 }] };
export function archive(entries: ZipEntry[]): Buffer {
  // A pre-1980 date makes the ZIP writer independent of wall clock and timezone.
  return Buffer.from(zip(entries, new Date(0)));
}
export function packageSeed(signature?: unknown): Buffer {
  return archive([{ name: 'plugin.json', data: bytes(JSON.stringify(manifest)) }, { name: 'main.js', data: bytes('export const Synthetic = () => 1;') }, ...(signature === undefined ? [] : [{ name: 'signature.json', data: bytes(JSON.stringify(signature)) }])]);
}
export function fmpSeed(): Buffer {
  const b = Buffer.alloc(4 * 4096);
  b.set([0, 1, 0, 0, 0, 2, 0, 1, 0, 5, 0, 2, 0, 2, 0xc0]);
  b.write('HBAM7', 15); b[521] = 0x1e;
  b.writeUInt32BE(3, 4096 + 8); b.writeUInt16BE(1, 4096 + 12);
  b.writeUInt32BE(3, 8192 + 8); b.writeUInt32BE(2, 12288 + 4);
  b.set([1, 7, 42], 8192 + 20); b.set([1, 8, 43], 12288 + 20);
  return b;
}
export function workbook(xml = '<row r="1"><c r="A1" t="inlineStr"><is><t>synthetic</t></is></c></row>'): Buffer {
  return archive([
    { name: 'xl/workbook.xml', data: bytes('<workbook><sheets><sheet name="Synthetic" sheetId="1" r:id="r1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: bytes('<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: bytes(`<worksheet><sheetData>${xml}</sheetData></worksheet>`) },
  ]);
}
export function seeds(target: Target): Buffer[] {
  switch (target) {
    case 'filemaker-xml': return [bytes('<FMSaveAsXML><Structure><BaseTable id="1" name="Synthetic" UUID="generated"/></Structure></FMSaveAsXML>')];
    case 'fmpxmlresult': return [bytes('<FMPXMLRESULT><DATABASE DATEFORMAT="M/d/yyyy" TIMEFORMAT="h:mm:ss a"/><METADATA><FIELD NAME="Synthetic" TYPE="TEXT"/></METADATA><RESULTSET FOUND="1"><ROW RECORDID="1"><COL><DATA>synthetic</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>')];
    case 'csv': case 'merge': return [bytes('"Name","Value"\r\n"Synthetic","a,b"\r\n')];
    case 'tsv': return [bytes('Name\tValue\r\nSynthetic\t1\r\n')];
    case 'xlsx': return [workbook()];
    case 'zip': return [archive([{ name: 'synthetic.txt', data: bytes('synthetic') }])];
    case 'ohplugin': return [packageSeed(), packageSeed({ publisherKey: '', sig: '' })];
    case 'ics': return [bytes('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic\r\nDTSTART:20260101T120000Z\r\nSUMMARY:Synthetic\r\nRRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')];
    case 'json': case 'data-api': return [bytes('{"fieldData":{"Synthetic":"value"},"portalData":{},"limit":1}'), bytes('{"query":[{"Synthetic":"==value"}],"sort":[{"fieldName":"Synthetic","sortOrder":"ascend"}]}')];
    case 'clipboard': return [bytes('<fmxmlsnippet type="FMObjectList"><Step id="89" name="Comment"><Text>synthetic</Text></Step></fmxmlsnippet>'), bytes('<fmxmlsnippet type="LayoutObjectList"><Object type="Text"><Bounds top="0" left="0" bottom="10" right="10"/><Text>synthetic</Text></Object></fmxmlsnippet>')];
    case 'script': return [bytes('Set Variable [ $x ; Value: 1 ]\nIf [ $x = 1 ]\nExit Script [ Text Result: $x ]\nEnd If')];
    case 'calc': return [bytes('Let ( [ x = 1 ; y = 2 ] ; x + y )'), bytes('If ( 1 ; "synthetic" ; "" )')];
    case 'sql': return [bytes("SELECT CAST('2026-01-01' AS DATE) FROM Synthetic WHERE id IN (1,2) FETCH FIRST 2 ROWS ONLY")];
    case 'odata-filter': return [bytes("contains(Name,'synthetic') and Count ge 1"), bytes('(Count add 1) eq 2')];
    case 'multipart': return [bytes('--fuzz\r\nContent-Disposition: form-data; name="upload"; filename="synthetic.txt"\r\nContent-Type: text/plain\r\n\r\nsynthetic\r\n--fuzz--\r\n')];
    case 'mime-headers': return [bytes('--fuzz\r\nContent-Type: application/http\r\nContent-ID: 1\r\n\r\nGET /Synthetic HTTP/1.1\r\nAccept: application/json\r\n\r\n\r\n--fuzz--\r\n')];
    case 'fmp12': return [fmpSeed()];
    // Binary parameter values as drivers send them; the target reads each input as every type the server knows.
    case 'pgwire-binary': return [
      encodeNumeric('-12345.678'), encodeNumeric('NaN'), binaryValue('2024-03-09 00:30:00.5', BINARY_OID.timestamp)!, binaryValue('2024-03-09', BINARY_OID.date)!,
      encodeInterval({ micros: 14_706_500_000n, days: -3, months: 14 }), binaryValue('0123abcd-4567-89ef-0123-456789abcdef', BINARY_OID.uuid)!,
      binaryValue('{"synthetic":[1,null]}', BINARY_OID.jsonb)!, encodeArray([1, -2, null], BINARY_OID.int4), encodeArray(['synthetic', 'a b', null], BINARY_OID.text),
      encodeArray(['-1.5'], BINARY_OID.numeric), encodeArray([16, 17], BINARY_OID.oid),
    ];
  }
}

/** A binary value's mutation: a length, count or header field set to an extreme, a cut, or bytes added. */
function binaryMutation(input: Buffer, r: Random): Buffer {
  const out = Buffer.from(input.length ? input : Buffer.alloc(4));
  switch (r(4)) {
    case 0: {
      const at = r(Math.max(1, out.length - 3)) & ~1;
      if (at + 4 <= out.length) out.writeInt32BE([0, -1, -2, 1, 6, 7, 0x7fffffff, -0x80000000, r(65536)][r(9)], at);
      else if (at + 2 <= out.length) out.writeUInt16BE([0, 0xffff, 0x4000, 0xc000, 0xd000, 0x3fff, 10000][r(7)], at);
      return out;
    }
    case 1: return out.subarray(0, r(out.length + 1));
    case 2: return Buffer.concat([out, Buffer.from(Array.from({ length: 1 + r(16) }, () => r(256)))]);
    default: out[r(out.length)] ^= 1 << r(8); return out;
  }
}
const atoms = ['synthetic', '', '0', '-1', '2147483647', '1e999', 'null', '"', "'", '\u0000', '&#1114112;', '&#x110000;', '&amp;', '<![CDATA[x]]>', '__proto__', 'é', '\r\n'];
function textMutation(text: string, r: Random, tokens: RegExp): string {
  const matches = [...text.matchAll(tokens)];
  if (!matches.length) return text + atoms[r(atoms.length)];
  const m = matches[r(matches.length)], at = m.index!, token = m[0];
  const replacement = [atoms[r(atoms.length)], '', token.repeat(2 + r(32)), token + atoms[r(atoms.length)]][r(4)];
  return text.slice(0, at) + replacement + text.slice(at + token.length);
}
// Openers and closers per family, for nesting deep enough to reach recursion limits in recursive-descent readers.
const NESTING: Partial<Record<Target, [string, string]>> = {
  'filemaker-xml': ['<a>', '</a>'], fmpxmlresult: ['<ROW>', '</ROW>'], clipboard: ['<Step>', '</Step>'],
  json: ['[', ']'], 'data-api': ['{"query":[', ']}'], calc: ['(', ')'], sql: ['(', ')'], 'odata-filter': ['(', ')'],
  script: ['If [ 1 ]\n', 'End If\n'], ics: ['BEGIN:VEVENT\r\n', 'END:VEVENT\r\n'],
};
function nest(text: string, target: Target, r: Random): string {
  const [open, close] = NESTING[target]!;
  const depth = [10, 100, 1000, 5000, 20000][r(5)], at = r(text.length + 1);
  const unbalanced = r(4) === 0;
  return (text.slice(0, at) + open.repeat(depth) + (unbalanced ? '' : close.repeat(depth)) + text.slice(at)).slice(0, MAX_INPUT);
}
/** Copies a random slice of the input to another random place, so structures repeat or interleave. */
function splice(text: string, r: Random): string {
  const from = r(text.length + 1), to = from + r(text.length - from + 1), at = r(text.length + 1);
  return text.slice(0, at) + text.slice(from, to) + text.slice(at);
}
export function mutate(target: Target, input: Buffer, r: Random): Buffer {
  let out: Buffer;
  if (target === 'pgwire-binary') {
    out = binaryMutation(input, r);
  } else if (r(5) === 0) {
    out = Buffer.from(input);
    if (out.length) { const at = r(out.length); if (r(3) === 0) out = out.subarray(0, at); else out[at] ^= 1 << r(8); }
    else out = bytes(atoms[r(atoms.length)]);
  } else if (target === 'fmp12') {
    out = Buffer.from(input.length >= 16384 ? input : fmpSeed());
    const block = 1 + r(3), offset = [0, 4, 8, 12, 20, 21, 22][r(7)];
    out.writeUInt32BE([0, 1, 2, 3, 0xffffffff, r(256)][r(6)], block * 4096 + offset);
  } else if (target === 'ohplugin') {
    const value = [null, [], 1, 'synthetic', {}, { publisherKey: '', sig: '' }][r(6)];
    out = r(2) ? packageSeed(value) : archive([{ name: ['plugin.json', '../plugin.json', 'plugin.json'][r(3)], data: bytes(JSON.stringify(r(2) ? value : { ...manifest, functions: value })) }, { name: 'main.js', data: bytes('') }]);
  } else if (target === 'xlsx') {
    out = workbook(textMutation('<row r="1"><c r="A1" t="inlineStr"><is><t>synthetic</t></is></c></row>', r, /<[^>]+>|[^<>]+/g));
    if (r(3) === 0) out.writeUInt32LE([0, 0xffffffff, r(out.length)][r(3)], out.length - 6);
  } else if (target === 'zip') {
    out = archive([{ name: ['synthetic.txt', '../synthetic', '', '__proto__'][r(4)], data: bytes(atoms[r(atoms.length)].repeat(1 + r(1024))) }]);
    const at = out.indexOf(Buffer.from('504b0102', 'hex'));
    if (at >= 0 && r(2)) out.writeUInt32LE([0, 0xffffffff, r(4096)][r(3)], at + [20, 24, 42][r(3)]);
  } else {
    const text = input.toString('utf8');
    if (['json', 'data-api'].includes(target) && r(2)) {
      const value = [null, [], {}, atoms[r(atoms.length)], r(100)][r(5)];
      out = bytes(JSON.stringify(r(2) ? value : { fieldData: value, portalData: value, query: [value] }));
    } else {
      const tokens = ['filemaker-xml', 'fmpxmlresult', 'clipboard'].includes(target) ? /<[^>]*>|&[^;]*;|[^<>&]+/g
        : ['csv', 'tsv', 'merge'].includes(target) ? /"(?:[^"]|"")*"|[,\t]|\r?\n|[^",\t\r\n]+/g
        : ['ics', 'multipart', 'mime-headers'].includes(target) ? /[^\r\n:;]+|[:;]|\r\n/g
        : /"(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z_$][\w.$]*|\d+|[()[\]{},;:+*/=<>-]/g;
      const roll = r(12);
      out = bytes(roll === 0 && NESTING[target] ? nest(text, target, r) : roll === 1 ? splice(text, r) : textMutation(text, r, tokens));
    }
  }
  return Buffer.from(out.subarray(0, MAX_INPUT));
}

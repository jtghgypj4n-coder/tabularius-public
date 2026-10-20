// Deterministic, dependency-free fuzzing of the Import Records readers: delimited text (CSV, tab, merge),
// Excel workbooks and the unzip under them, FileMaker XML (FMPXMLRESULT, with and without an XSLT style sheet).
// Run with Node >=22.20: node --test packages/scripts/test/import-fuzz.test.ts
// Same shape as packages/store/test/parser-fuzz.test.ts: each case runs in a worker with a deadline and heap and
// stack limits, so a hang or a blow-up fails the case instead of the run. Every input may only end in the reader's
// own errors; a case with `want` must also read back as those rows, one with `reads` must read, and one with `rejects`
// must be refused with that error. Stress ids carry a recipe for their input.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';

type Target = 'delimited' | 'xlsx' | 'import';
type Case = { id: string; text?: string; bytes?: Uint8Array; name?: string; sep?: string; strict?: boolean; stylesheet?: string; want?: unknown; rejects?: RegExp; reads?: true };
type Result = { error?: string; domain?: boolean; ms: number; cpu?: number; heap: number };
const SEEDS = [1, 0x12345678, 0xdeadbeef];
const LIMIT_MS = 2_000;
// A case that misses LIMIT_MS is run once more in a fresh worker, so a starved CPU on a loaded runner (load 50-190 on
// 18 cores) is not a failure. The retry has RETRY_MS of wall time, a hang guard only, and passes only on at most
// RETRY_CPU_MS of the worker thread's own CPU time, which load does not stretch the way it stretches wall time: the real
// bugs cost 17 s to minutes of CPU (F6 yd x 12 was 17 s). Node before 22.19 has no process.threadCpuUsage (22.20, the minimum, has it); there
// the retry's wall time is held to RETRY_CPU_MS instead.
const RETRY_MS = 30_000;
const RETRY_CPU_MS = 5_000; // CPU time still inflates a little under load (2087 ms seen on a busy runner); real bugs are 17 s or more
const READY_MS = 60_000;
const HEAP_MB = 128;
const STACK_MB = 1;

// Known, unfixed findings: a matching case is expected to fail with `error`; once it passes the test fails, so the entry is
// removed when the fix lands. None are open.
const KNOWN: { finding: string; id: RegExp; error: RegExp }[] = [];

// Mulberry32: unsigned 32-bit state, no global randomness.
function random(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    let x = state = (state + 0x6d2b79f5) >>> 0;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return Math.floor(((x ^ (x >>> 14)) >>> 0) / 0x100000000 * n);
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
let sampledHeap = 0;

/**
 * A zip of `entries`: deflated, or `raw` bytes under `method` (0, stored, by default); `size` and `packed` overstate the
 * directory's sizes. `central` repeats directory entries (by index, renamed) to fan one stream out.
 */
function zip(entries: { name: string; data: Uint8Array; raw?: true; method?: number; size?: number; packed?: number }[], central: { of: number; name: string }[] = []): Uint8Array {
  const locals: Buffer[] = [], dir: Buffer[] = [], heads: { head: Buffer; offset: number }[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.raw ? Buffer.from(e.data) : deflateRawSync(e.data);
    const method = e.method ?? (e.raw ? 0 : 8);
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(method, 10);
    head.writeUInt32LE(e.packed ?? body.length, 20);
    head.writeUInt32LE(e.size ?? e.data.length, 24);
    heads.push({ head, offset });
    locals.push(local, name, body);
    offset += 30 + name.length + body.length;
  }
  const add = (k: number, name: string) => {
    const head = Buffer.from(heads[k].head), file = Buffer.from(name);
    head.writeUInt16LE(file.length, 28);
    head.writeUInt32LE(heads[k].offset, 42);
    dir.push(head, file);
  };
  entries.forEach((e, k) => add(k, e.name));
  for (const c of central) add(c.of, c.name);
  const directory = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(dir.length / 2, 8);
  end.writeUInt16LE(dir.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
const book = (sheet: string, more: { name: string; data: Uint8Array }[] = []) => zip([{ name: 'xl/worksheets/sheet1.xml', data: enc(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`) }, ...more]);
const fmpxml = (body: string, db = '') => `<?xml version="1.0"?><FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult"><DATABASE${db} NAME="db"/><METADATA><FIELD NAME="a" TYPE="TEXT"/><FIELD NAME="d" TYPE="DATE"/></METADATA><RESULTSET>${body}</RESULTSET></FMPXMLRESULT>`;
const TO_FM = (select: string) => `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><FMPXMLRESULT><RESULTSET><ROW><COL><DATA><xsl:value-of select="${select}"/></DATA></COL></ROW></RESULTSET></FMPXMLRESULT></xsl:template></xsl:stylesheet>`;
const LAUGHS = '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>';
// Text that is hard for a reader: separators, quotes, every line ending, NUL, lone surrogates, astral and combining characters.
const NASTY = ['', 'a', ' ', '"', '""', ',', ';', '|', '\t', '\r', '\n', '\r\n', '\n\r', '\0', '\ud800', '\udfff', '\ud83d\ude00', 'e\u0301', '\ufeff', '\v', '<', '&amp;', ']]>', 'x'.repeat(300)];

function mutate(bytes: Uint8Array, r: (n: number) => number): Uint8Array {
  const out = Uint8Array.from(bytes);
  const at = r(out.length || 1);
  switch (r(4)) {
    case 0: out[at] ^= 1 << r(8); return out;
    case 1: out[at] = [0, 0xff, 0x7f, 0x80][r(4)]; return out;
    case 2: return out.subarray(0, at);
    default: return new Uint8Array([...out.subarray(0, at), ...out.subarray(at, at + 1 + r(64)), ...out.subarray(at)]);
  }
}

function corpus(target: Target, x: { xlsx: (rows: (string | number)[][]) => Uint8Array; fmpXmlResult: (rows: string[][]) => string }): Case[] {
  const out: Case[] = [];
  const add = (c: Case) => out.push(c);
  if (target === 'delimited') {
    const base = 'name,"note, with comma"\r\nAnn,"line\nbreak"\nBo,"say ""hi"""\r"x\t",\ufeff\0\ud800';
    // Truncation at every length, for each separator and both modes.
    for (const sep of [',', '\t', ';', '|']) {
      const text = sep === ',' ? base : base.replaceAll(',', sep);
      for (let n = 0; n <= text.length; n++) for (const strict of [false, true]) add({ id: `truncate/${JSON.stringify(sep)}/${strict}/${n}`, text: text.slice(0, n), sep, strict });
    }
    for (const seed of SEEDS) {
      const r = random(seed);
      for (let i = 0; i < 150; i++) {
        // Round trip: every value quoted, as the exporter writes it, reads back exactly in strict mode.
        const sep = [',', '\t', ';', '|'][r(4)];
        const rows = Array.from({ length: 1 + r(5) }, () => Array.from({ length: 1 + r(5) }, () => Array.from({ length: r(4) }, () => NASTY[r(NASTY.length)]).join('')));
        const eol = ['\r\n', '\n', '\r'][r(3)];
        const text = rows.map((row) => row.map((v) => '"' + v.replace(/"/g, '""') + '"').join(sep)).join(eol);
        add({ id: `seed=${seed}/case=${i}/roundtrip`, text, sep, strict: true, want: rows });
        const alphabet = ['"', ',', '\t', '\r', '\n', '\r\n', 'a', '\0', '\ud800', '\ufeff', ' '];
        add({ id: `seed=${seed}/case=${i}/random`, text: Array.from({ length: r(200) }, () => alphabet[r(alphabet.length)]).join(''), sep, strict: !!r(2) });
      }
    }
  }
  if (target === 'xlsx') {
    const workbook = x.xlsx([['name', 'n', 'when'], ['Ann <&>', 1.5, 46310], ['\ud83d\ude00 e\u0301', -0, '']]);
    // Truncation at every length of a small archive and of the sheet inside an archive that is whole; the
    // exporter's full workbook (2 KB) every 16 bytes and at every length of its directory.
    const small = book('<row><c t="s"><v>0</v></c></row>', [{ name: 'xl/sharedStrings.xml', data: enc('<sst><si><t>a</t></si></sst>') }]);
    for (let n = 0; n <= small.length; n++) add({ id: `truncate/small-zip/${n}`, bytes: small.subarray(0, n) });
    for (let n = 0; n <= workbook.length; n++) if (n % 16 === 0 || n > workbook.length - 600) add({ id: `truncate/zip/${n}`, bytes: workbook.subarray(0, n) });
    const sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>Ann</t><rPh><t>an</t></rPh></is></c><c r="B1"><v>2</v></c><c r="C1" t="b"><v>1</v></c></row><row r="3"><c r="B3" t="str"><v>x&amp;y</v></c></row>';
    for (let n = 0; n <= sheet.length; n++) add({ id: `truncate/sheet/${n}`, bytes: book(sheet.slice(0, n)) });
    for (const seed of SEEDS) {
      const r = random(seed);
      for (let i = 0; i < 60; i++) {
        const rows = Array.from({ length: 1 + r(4) }, () => Array.from({ length: 1 + r(4) }, () => (r(3) ? ['Ann', 'a b', 'x'.repeat(300), '<&>"\'', '\ud83d\ude00', 'e\u0301', '\u00e9\u00e8'][r(7)] : r(100000) / 8)));
        add({ id: `seed=${seed}/case=${i}/roundtrip`, bytes: x.xlsx(rows), want: rows });
        add({ id: `seed=${seed}/case=${i}/mutated`, bytes: mutate(workbook, r) });
      }
    }
    // Nested and duplicate entries: a zip inside a zip, a sheet named twice (the later wins), a directory entry repeated.
    add({ id: 'zip/nested', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: workbook }]), want: [] });
    add({ id: 'zip/duplicate-name', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<row><c><v>1</v></c></row>') }, { name: 'xl/worksheets/sheet1.xml', data: enc('<row><c><v>2</v></c></row>') }]), want: [[2]] });
    add({ id: 'zip/duplicate-central', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<row><c><v>1</v></c></row>') }], [{ of: 0, name: 'xl/worksheets/sheet1.xml' }]), want: [[1]] });
    // Sizes that lie: declared huge, declared past the end of the file, a stored entry longer than the archive.
    add({ id: 'zip/declares-4GB', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<row><c><v>1</v></c></row>'), size: 0xffffffff }]), rejects: /^bad zip directory \(Zip64 is unsupported\)$/ });
    add({ id: 'zip/packed-past-end', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<row><c><v>1</v></c></row>'), packed: 0xffffffff }]) });
    add({ id: 'zip/stored-past-end', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<row/>'), raw: true, packed: 0xfffffff0 }]) });
    add({ id: 'zip/garbage-stream', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('\xff not deflate'), raw: true, method: 8 }]), rejects: /^bad zip entry xl\/worksheets\/sheet1\.xml \(/ });
    add({ id: 'zip/unknown-method', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<row/>'), raw: true, method: 14 }]) });
    add({ id: 'zip/laughs', bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc(LAUGHS + '<worksheet><sheetData><row><c t="inlineStr"><is><t>&lol3;</t></is></c></row></sheetData></worksheet>') }]), want: [['&lol3;']] });
    add({ id: 'xlsx/missing-sheet', bytes: x.xlsx([['a']]), name: 'Nope' });
    add({ id: 'xlsx/nul-surrogate', bytes: book('<row><c t="inlineStr"><is><t>\0\ud800\udfff</t></is></c></row>') });
  }
  if (target === 'import') {
    const xml = fmpxml('<ROW MODID="1" RECORDID="1"><COL><DATA>Ann</DATA></COL><COL><DATA>3/5/2024</DATA></COL></ROW><ROW><COL><DATA><![CDATA[<b>&]]></DATA><DATA>two</DATA></COL><COL/></ROW>', ' DATEFORMAT="M/d/yyyy" TIMEFORMAT="h:mm:ss a"');
    for (let n = 0; n <= xml.length; n++) add({ id: `truncate/xml/${n}`, bytes: enc(xml.slice(0, n)), name: 'a.xml' });
    const csv = '\ufeffa,b\r\n"x,""y""",\v\n';
    for (const name of ['a.csv', 'a.tab', 'a.mer', 'a.txt']) for (let n = 0; n <= csv.length; n++) add({ id: `truncate/${name}/${n}`, bytes: enc(csv.slice(0, n)), name });
    for (const seed of SEEDS) {
      const r = random(seed);
      for (let i = 0; i < 80; i++) {
        // Round trip through the exporter's own FMPXMLRESULT, for text that XML can carry; a line break comes back as
        // FileMaker's return (the exporter writes &#13;).
        const rows = Array.from({ length: 1 + r(4) }, () => Array.from({ length: 1 + r(3) }, () => ['', 'Ann', '<&>"\'', ']]>', '\ud83d\ude00', 'e\u0301', 'a\nb', 'x'.repeat(300)][r(8)]));
        add({ id: `seed=${seed}/case=${i}/xml-roundtrip`, bytes: enc(x.fmpXmlResult(rows)), name: 'a.xml', want: rows.map((row) => row.map((v) => v.replace(/\n/g, '\r'))) });
        add({ id: `seed=${seed}/case=${i}/xml-mutated`, bytes: mutate(enc(xml), r), name: 'a.xml' });
        add({ id: `seed=${seed}/case=${i}/bytes`, bytes: Uint8Array.from({ length: r(64) }, () => [0, 0xff, 0xfe, 0xef, 0xbb, 0xbf, 0x22, 0x2c, 0x0a, 0x0d, 0xd8, 0xdc, 0x80][r(13)]), name: ['a.csv', 'a.tab', 'a.txt', 'a.mer', 'a.xml', 'a.xlsx'][r(6)] });
      }
    }
    // Entities: only the five XML defines and character references are read; a DTD's own are left as written.
    add({ id: 'xml/laughs', bytes: enc(LAUGHS + fmpxml('<ROW><COL><DATA>&lol3;</DATA></COL></ROW>')), name: 'a.xml', want: [['&lol3;']] });
    add({ id: 'xslt/laughs', bytes: enc(LAUGHS + '<a>&lol3;</a>'), name: 'a.xml', stylesheet: TO_FM('.') });
    add({ id: 'xml/references', bytes: enc(fmpxml('<ROW><COL><DATA>&#0;&#xD800;&#x110000;&#99999999999;&#x41;</DATA></COL></ROW>')), name: 'a.xml' });
    // Formats the date fix must still read: with separators, digits side by side, and a leading space.
    for (const [format, value, read] of [['M/d/yyyy', '3/5/2024', '2024-03-05'], ['yyyyMMdd', '20240305', '2024-03-05'], [' dd.MM.yyyy', ' 05.03.2024', '2024-03-05'], ['d  MMM yyyy', '5   Mar 2024', '2024-03-05'], ['ydyd', '1212', '1212']]) {
      add({ id: `xml/date-format/${format}`, bytes: enc(fmpxml(`<ROW><COL><DATA>a</DATA></COL><COL><DATA>${value}</DATA></COL></ROW>`, ` DATEFORMAT="${format}"`)), name: 'a.xml', want: [['a', read]] });
    }
    // A self-closed COL is an empty column, not the start of one that runs into the next.
    add({ id: 'xml/self-closed-col', bytes: enc(fmpxml('<ROW><COL/><COL><DATA>x</DATA></COL></ROW>')), name: 'a.xml', want: [['', 'x']] });
    // UTF-16 with an odd byte, lone surrogates in UTF-16, invalid UTF-8 (read as Windows-1252).
    add({ id: 'text/utf16-odd', bytes: new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c]), name: 'a.csv' });
    add({ id: 'text/utf16be-odd', bytes: new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00]), name: 'a.csv' });
    add({ id: 'text/utf16-surrogate', bytes: new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x2c, 0x00, 0x00, 0xdc]), name: 'a.csv' });
    add({ id: 'text/cp1252', bytes: new Uint8Array([0x80, 0x2c, 0x9f, 0x0d, 0x0a, 0xff]), name: 'a.csv', want: [['\u20ac', '\u0178'], ['\u00ff']] });
  }
  return out;
}

/** Inputs sized so the readers as they were exceeded the deadline or the heap; each names its finding. */
function stress(target: Target): Case[] {
  const out: Case[] = [];
  const add = (id: string, c: Omit<Case, 'id'>) => out.push({ id: 'stress/' + id, ...c });
  const N = 200_000;
  if (target === 'delimited') {
    add('F7 huge field: \'"\' + "x".repeat(8e6) + \'"\'', { text: '"' + 'x'.repeat(8e6) + '"', sep: ',' });
    add('huge row: "a,".repeat(1e6)', { text: 'a,'.repeat(1e6), sep: ',' });
    add('F7 doubled quotes: \'"\' + \'""\'.repeat(4e6)', { text: '"' + '""'.repeat(4e6), sep: ',', strict: true });
    add('tab opens: \'\\t"\'.repeat(5e5) + \'"\'', { text: '\t"'.repeat(5e5) + '"', sep: '\t' });
    add('tab lone quote: \'"\' + \'\\tb""\'.repeat(5e5) + \'"x\'', { text: '"' + '\tb""'.repeat(5e5) + '"x', sep: '\t' });
    add('F8 mixed line ends and blank lines: "a\\r\\n\\n\\r".repeat(2.5e5)', { text: 'a\r\n\n\r'.repeat(2.5e5), sep: ',' });
  }
  if (target === 'xlsx') {
    add(`F1 unclosed rows: "<row>".repeat(${N})`, { bytes: book('<row>'.repeat(N)) });
    add(`F1 unclosed cells: "<row>" + "<c>".repeat(${N}) + "</row>"`, { bytes: book('<row>' + '<c>'.repeat(N) + '</row>') });
    add(`F1 rows without ">": "<row ".repeat(${N}) + "</row>"`, { bytes: book('<row '.repeat(N) + '</row>') });
    add(`F1 unclosed shared strings: "<si>".repeat(${N})`, { bytes: book('<row><c t="s"><v>0</v></c></row>', [{ name: 'xl/sharedStrings.xml', data: enc('<sst>' + '<si>'.repeat(N)) }]) });
    add(`F1 unclosed runs: "<si>" + "<t>".repeat(${N}) + "</si>"`, { bytes: book('<row><c t="s"><v>0</v></c></row>', [{ name: 'xl/sharedStrings.xml', data: enc('<sst><si>' + '<t>'.repeat(N) + '</si></sst>') }]) });
    add(`F1 unclosed phonetic runs: "<si>" + "<rPh>".repeat(${N}) + "</si>"`, { bytes: book('<row><c t="s"><v>0</v></c></row>', [{ name: 'xl/sharedStrings.xml', data: enc('<sst><si>' + '<rPh>'.repeat(N) + '</si></sst>') }]) });
    add(`F1 1904 styles without ">": "<numFmt ".repeat(${N})`, { bytes: book('<row><c s="0"><v>1</v></c></row>', [{ name: 'xl/workbook.xml', data: enc('<workbook><workbookPr date1904="1"/></workbook>') }, { name: 'xl/styles.xml', data: enc('<styleSheet>' + '<numFmt '.repeat(N)) }]) });
    add(`F1 1904 format code: formatCode="[".repeat(${N})`, { bytes: book('<row><c s="0"><v>1</v></c></row>', [{ name: 'xl/workbook.xml', data: enc('<workbook><workbookPr date1904="1"/></workbook>') }, { name: 'xl/styles.xml', data: enc(`<styleSheet><numFmts><numFmt numFmtId="164" formatCode="${'['.repeat(N)}"/></numFmts><cellXfs><xf numFmtId="164"/></cellXfs></styleSheet>`) }]) });
    add(`F1 workbookPr without ">": "<workbookPr ".repeat(${N})`, { bytes: book('<row/>', [{ name: 'xl/workbook.xml', data: enc('<workbook>' + '<workbookPr '.repeat(N) + '>') }]) });
    const sheets = 20_000;
    add(`F2 many sheets: ${sheets} <sheet r:id> and <Relationship Id> pairs`, { bytes: book('<row/>', [
      { name: 'xl/workbook.xml', data: enc('<workbook><sheets>' + Array.from({ length: sheets }, (_, i) => `<sheet name="s${i}" r:id="r${i}"/>`).join('') + '</sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships>' + Array.from({ length: sheets }, (_, i) => `<Relationship Id="r${i}" Target="worksheets/sheet1.xml"/>`).join('') + '</Relationships>') },
    ]) });
    add('F3 far column: <c r="ZZZZZZZZZZ1">', { bytes: book('<row r="1"><c r="ZZZZZZZZZZ1"><v>1</v></c></row>'), rejects: /^cell ZZZZZZZZZZ1 is past Excel's last column, XFD$/ });
    add('F3 far row: <row r="99999999999">', { bytes: book('<row r="99999999999"><c><v>1</v></c></row>'), rejects: /^row 99999999999 is past Excel's last row, 1048576$/ });
    add('F3 every row at column XFD: \'<row><c r="XFD1"/></row>\'.repeat(4096)', { bytes: book('<row><c r="XFD1"/></row>'.repeat(4096)), rejects: /^the sheet comes to more than 50000000 cells/ });
    add('last column Excel has: <c r="XFD1">', { bytes: book('<row r="1"><c r="XFD1"><v>1</v></c></row>'), reads: true });
    // 100k rows of A to E with a note in AX: 5M cells, 4.4M of them empty, read as Excel shows it.
    add('sparse sheet: 100k rows of A-E and AX', { bytes: book(Array.from({ length: 1e5 }, (_, i) => `<row r="${i + 1}">${'ABCDE'.split('').map((c) => `<c r="${c}${i + 1}"><v>${i}</v></c>`).join('')}<c r="AX${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`).join('')), reads: true });
    add('last row Excel has: <row r="1048576">', { bytes: book('<row r="1048576"><c><v>1</v></c></row>') });
    add('huge row: "<c><v>1</v></c>".repeat(2e5)', { bytes: book('<row>' + '<c><v>1</v></c>'.repeat(2e5) + '</row>') });
    add('huge field: inline string of 4e6 "x"', { bytes: book('<row><c t="inlineStr"><is><t>' + 'x'.repeat(4e6) + '</t></is></c></row>') });
    add('deep nesting: "<is>".repeat(1e5)', { bytes: book('<row><c t="inlineStr">' + '<is>'.repeat(1e5) + '<t>x</t></c></row>') });
    // One 96 MB stream of zeros (96 KB packed) behind the sheet, shared strings and styles a 1904 workbook reads: 288 MB,
    // past the 256 MB the parts read may expand to.
    const zeros = new Uint8Array(96 * 1024 * 1024);
    const expands = /^the zip file expands to more than 256 MB$/;
    add('F4 fan-out bomb: one 96 MB stream behind the three parts a sheet reads', { bytes: zip([{ name: 'xl/workbook.xml', data: enc('<workbook><workbookPr date1904="1"/></workbook>') }, { name: 'xl/worksheets/sheet1.xml', data: zeros }], [{ of: 1, name: 'xl/sharedStrings.xml' }, { of: 1, name: 'xl/styles.xml' }]), rejects: expands });
    // Of entries with one name only the last is inflated. The directory's declared total stays under its 4x guard.
    add('F4 duplicate-name fan-out: 1000 entries named sheet1.xml for one 1 MB stream', { bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: new Uint8Array(1024 * 1024) }], Array.from({ length: 999 }, () => ({ of: 0, name: 'xl/worksheets/sheet1.xml' }))), reads: true });
    // Parts no sheet reads (pivot caches, pictures) are never inflated, however big.
    add('big unused parts: a one-cell sheet beside 288 MB of pivot cache and media', { bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>') }, { name: 'xl/pivotCache/pivotCacheRecords1.xml', data: zeros }], [{ of: 1, name: 'xl/pivotCache/pivotCacheRecords2.xml' }, { of: 1, name: 'xl/media/image1.png' }]), want: [[1]] });
    add('bomb within budget: a 32 MB sheet of zeros', { bytes: zip([{ name: 'xl/worksheets/sheet1.xml', data: new Uint8Array(32 * 1024 * 1024) }]) });
    add('F5 directory past the end: 65534 entries declared, none there', { bytes: (() => { const z = Buffer.from(book('<row/>')); z.writeUInt16LE(0xfffe, z.length - 14); z.writeUInt16LE(0xfffe, z.length - 12); z.writeUInt32LE(0xfffffff0, z.length - 6); return new Uint8Array(z); })(), rejects: /^bad zip directory$/ });
  }
  if (target === 'import') {
    add(`F1 unclosed ROW: "<ROW>".repeat(${N})`, { bytes: enc('<FMPXMLRESULT>' + '<ROW>'.repeat(N)), name: 'a.xml' });
    add(`F1 ROW without ">": "<ROW ".repeat(${N}) + "</ROW>"`, { bytes: enc('<FMPXMLRESULT>' + '<ROW '.repeat(N) + '</ROW>'), name: 'a.xml' });
    add(`F1 unclosed COL: "<ROW>" + "<COL>".repeat(${N}) + "</ROW>"`, { bytes: enc('<FMPXMLRESULT><ROW>' + '<COL>'.repeat(N) + '</ROW>'), name: 'a.xml' });
    add(`F1 unclosed DATA: "<COL>" + "<DATA>".repeat(${N}) + "</COL>"`, { bytes: enc('<FMPXMLRESULT><ROW><COL>' + '<DATA>'.repeat(N) + '</COL></ROW>'), name: 'a.xml' });
    add(`F1 unclosed CDATA: "<DATA>" + "<![CDATA[".repeat(${N})`, { bytes: enc('<FMPXMLRESULT><ROW><COL><DATA>' + '<![CDATA['.repeat(N) + '</DATA></COL></ROW>'), name: 'a.xml' });
    add(`F1 DATABASE without ">": "<DATABASE ".repeat(${N})`, { bytes: enc('<FMPXMLRESULT' + '<DATABASE '.repeat(N)), name: 'a.xml' });
    add(`F1 unclosed METADATA: "<METADATA>".repeat(${N})`, { bytes: enc('<FMPXMLRESULT>' + '<METADATA>'.repeat(N)), name: 'a.xml' });
    const date = (format: string, value: string) => enc(fmpxml(`<ROW><COL><DATA>a</DATA></COL><COL><DATA>${value}</DATA></COL></ROW>`, ` DATEFORMAT="${format}"`));
    add('F6 date format with repeated fields: DATEFORMAT="yd".repeat(12), DATA "1".repeat(36) + "x"', { bytes: date('yd'.repeat(12), '1'.repeat(36) + 'x'), name: 'a.xml', want: [['a', '1'.repeat(36) + 'x']] });
    add('F6 date format with a run of spaces: DATEFORMAT="d" + " ".repeat(30) + "M", DATA "1" + " ".repeat(60) + "x"', { bytes: date('d' + ' '.repeat(30) + 'M', '1' + ' '.repeat(60) + 'x'), name: 'a.xml', want: [['a', '1' + ' '.repeat(60) + 'x']] });
    add('F6 date format with a leading space: DATEFORMAT=" M/d/yyyy", DATA " ".repeat(2e5) + "x"', { bytes: date(' M/d/yyyy', ' '.repeat(2e5) + 'x'), name: 'a.xml' });
    add('huge XML row: "<COL><DATA>x</DATA></COL>".repeat(2e5)', { bytes: enc(fmpxml('<ROW>' + '<COL><DATA>x</DATA></COL>'.repeat(2e5) + '</ROW>')), name: 'a.xml' });
    add('huge XML field: DATA of 8e6 "x"', { bytes: enc(fmpxml('<ROW><COL><DATA>' + 'x'.repeat(8e6) + '</DATA></COL></ROW>')), name: 'a.xml' });
    add('deep XML: "<ROW>".repeat(2e5) + "</ROW>".repeat(2e5)', { bytes: enc(fmpxml('<ROW>'.repeat(2e5) + '</ROW>'.repeat(2e5))), name: 'a.xml' });
    for (const depth of [500, 1000, 2000, 4000, 1e5]) add(`deep XML through XSLT: "<a>".repeat(${depth})`, { bytes: enc('<a>'.repeat(depth) + 'x' + '</a>'.repeat(depth)), name: 'a.xml', stylesheet: TO_FM('count(//*)') });
    add('huge CSV: "a,b\\r\\n".repeat(2e5)', { bytes: enc('a,b\r\n'.repeat(2e5)), name: 'a.csv' });
    add('L1 streaming import: "a,b\\r\\n".repeat(1e6)', { bytes: enc('a,b\r\n'.repeat(1e6)), name: 'a.csv' });
    add('F7 huge merge field: \'"\' + "x".repeat(8e6)', { bytes: enc('"' + 'x'.repeat(8e6)), name: 'a.mer' });
    add('long .txt first line: "a;".repeat(1e6)', { bytes: enc('a;'.repeat(1e6) + '\n' + 'a;'.repeat(1e6)), name: 'a.txt' });
  }
  return out;
}

async function checker(target: Target): Promise<(c: Case) => boolean> {
  const same = (actual: unknown, want: unknown) => assert.ok(isDeepStrictEqual(actual, want), `read back ${JSON.stringify(actual).slice(0, 400)}, not ${JSON.stringify(want).slice(0, 400)}`);
  const cells = (rows: unknown) => assert.ok(Array.isArray(rows) && rows.every((r) => Array.isArray(r) && r.every((v) => typeof v === 'string' || (typeof v === 'number' && !Number.isNaN(v)))), 'rows of text and numbers');
  if (target === 'delimited') {
    const { parseDelimited } = await import('../../store/src/delimited.ts');
    return (c) => {
      let rows: string[][];
      try { rows = parseDelimited(c.text!, c.sep!, c.strict); } catch (e) {
        if (c.strict && e instanceof Error && e.constructor === Error && /^(Malformed CSV quoting|Unclosed CSV quote)$/.test(e.message) && c.want === undefined) return true;
        throw e;
      }
      cells(rows);
      if (c.want !== undefined) same(rows, c.want);
      return false;
    };
  }
  if (target === 'xlsx') {
    const { readXlsx, xlsxSheetNames, MissingSheetError, SheetLimitError } = await import('../src/xlsx.ts');
    const DOMAIN = /^(not a zip file|bad zip directory|bad zip entry |the zip file expands to more than |the workbook has no sheet)/;
    return (c) => {
      let rows: unknown;
      try {
        rows = readXlsx(c.bytes!, c.name);
        assert.ok(xlsxSheetNames(c.bytes!).length > 0, 'a workbook has a sheet');
      } catch (e) {
        if (c.want === undefined && !c.reads && (e instanceof MissingSheetError || e instanceof SheetLimitError || (e instanceof Error && e.constructor === Error && DOMAIN.test(e.message))) && (!c.rejects || c.rejects.test(e.message))) return true;
        throw e;
      }
      assert.ok(!c.rejects, `read, where it should be refused with ${c.rejects}`);
      cells(rows);
      if (c.want !== undefined) same(rows, c.want);
      return false;
    };
  }
  const { importFileRows, importFileRowIterator, ScriptError } = await import('../src/engine.ts');
  return (c) => {
    if (c.id.startsWith('stress/L1 ')) {
      let count = 0;
      for (const row of importFileRowIterator(c.name!, c.bytes!)) {
        assert.deepEqual(row, ['a', 'b']);
        count++;
        if ((count & 0x3fff) === 0) sampledHeap = Math.max(sampledHeap, process.memoryUsage().heapUsed);
      }
      assert.equal(count, 1_000_000);
      return false;
    }
    let rows: unknown;
    try { rows = importFileRows(c.name!, c.bytes!, undefined, c.stylesheet); } catch (e) {
      if (e instanceof ScriptError && c.want === undefined && !c.reads) return true;
      throw e;
    }
    cells(rows);
    if (c.want !== undefined) same(rows, c.want);
    return false;
  };
}

if (!isMainThread) {
  const check = await checker(workerData as Target);
  parentPort!.on('message', (c: Case) => {
    sampledHeap = 0;
    const start = performance.now(), cpu = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : undefined;
    let result: Result;
    try { result = { domain: check(c), ms: 0, heap: 0 }; } catch (e) {
      result = { error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 1200)}\n${e.stack?.split('\n').slice(1, 6).join('\n')}` : `Non-Error thrown: ${String(e)}`, ms: 0, heap: 0 };
    }
    result.ms = performance.now() - start;
    if (cpu) { const used = process.threadCpuUsage(cpu); result.cpu = (used.user + used.system) / 1000; }
    result.heap = Math.max(sampledHeap, process.memoryUsage().heapUsed);
    parentPort!.postMessage(result);
  });
  parentPort!.postMessage('ready');
} else {
  const writers = async () => {
    const { xlsx } = await import('../src/xlsx.ts');
    const { fmpXmlResult } = await import('../../store/src/fmexport.ts');
    return {
      xlsx: (rows: (string | number)[][]) => xlsx(rows),
      fmpXmlResult: (rows: string[][]) => fmpXmlResult('db', rows[0].map((_, i) => ({ name: `f${i}`, type: 'text' as const })), rows.map((row, k) => ({ recordId: k + 1, modId: 0, cells: row.map((v) => [v]) }))),
    };
  };
  test('a quote never closed is reported on its line, blank lines counted', async () => {
    const { parseDelimited } = await import('../../store/src/delimited.ts');
    const report: { unclosedQuoteRow?: number } = {};
    assert.deepEqual(parseDelimited('a\r\n\n\r"b,c', ',', false, report), [['a'], ['b,c']]);
    assert.equal(report.unclosedQuoteRow, 4);
  });
  describe('fixed-seed import reader fuzzing', { concurrency: 6 }, () => {
    for (const [target, isStress] of (['delimited', 'xlsx', 'import'] as const).flatMap((x) => [[x, false], [x, true]] as const)) {
      const label = isStress ? `${target} stress` : target;
      // The stress cases are sized against V8's heap on macOS, where the worker's limit stops them: on Linux (Node 22.22)
      // the same worker keeps 190 to 390 MiB of heapUsed and the case listed as known to run out of memory doesn't.
      // They stay in the macOS run (ci.yml's test-mac); the cases from the corpus run everywhere.
      test(label, { timeout: 120_000, skip: isStress && process.platform !== 'darwin' && 'stress sizes are calibrated to macOS heap behaviour' }, async (t) => {
        const started = performance.now();
        let worker: Worker | undefined;
        let passed = 0, rejected = 0, peakHeap = 0, l1PeakHeap = 0, total = 0, knownFailed = 0;
        const retried: string[] = [];
        const failures: string[] = [], expected = new Set<string>();
        const startWorker = async () => {
          worker = new Worker(new URL(import.meta.url), { workerData: target, resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 16, stackSizeMb: STACK_MB } });
          // A worker given up on (past its deadline) can still run out of memory before it is terminated; with no listener
          // that 'error' would be uncaught and fail the run. request() listens for the errors of the case it runs.
          worker.on('error', () => {});
          await request(undefined, READY_MS).catch((e: Error) => { throw new Error(`Worker not ready: ${e.message}`); });
        };
        const request = (c: Case | undefined, ms: number): Promise<Result> => new Promise((resolve, reject) => {
          const w = worker!;
          const done = (error?: Error, result?: Result) => {
            clearTimeout(timer);
            w.off('message', message); w.off('error', errorEvent); w.off('exit', exitEvent);
            if (error) reject(error); else resolve(result!);
          };
          const message = (result: Result) => done(undefined, result);
          const errorEvent = (error: Error) => done(error);
          const exitEvent = (code: number) => done(new Error(`Worker exited (${code})`));
          const timer = setTimeout(() => done(new Error(`Deadline exceeded (${ms} ms)`)), ms);
          w.once('message', message); w.once('error', errorEvent); w.once('exit', exitEvent);
          if (c) w.postMessage(c);
        });
        const restart = async () => {
          await worker!.terminate();
          await startWorker();
        };
        try {
          await startWorker();
          for (const c of isStress ? stress(target) : corpus(target, await writers())) {
            const ks = KNOWN.filter((k) => k.id.test(c.id));
            total++;
            try {
              let ms = LIMIT_MS, result: Result;
              try {
                result = await request(c, ms);
                assert.ok(result.ms <= ms, `Reader exceeded ${ms} ms`);
              } catch (e) {
                if (!/Deadline exceeded|Reader exceeded/.test(e instanceof Error ? e.message : String(e))) throw e;
                await restart();
                ms = RETRY_MS;
                result = await request(c, ms).catch((e: Error) => { throw new Error(`${e.message}, retried after missing ${LIMIT_MS} ms`); });
                retried.push(`${c.id} ${result.ms.toFixed(0)} ms/${result.cpu?.toFixed(0) ?? '?'} ms CPU`);
                assert.ok((result.cpu ?? result.ms) <= RETRY_CPU_MS, `Reader exceeded ${RETRY_CPU_MS} ms of ${result.cpu === undefined ? 'wall' : 'CPU'} time on a retry (${result.ms.toFixed(0)} ms wall, ${result.cpu?.toFixed(0) ?? '?'} ms CPU)`);
              }
              peakHeap = Math.max(peakHeap, result.heap);
              if (c.id.startsWith('stress/L1 ')) l1PeakHeap = result.heap;
              if (result.error) throw new Error(result.error);
              assert.ok(result.ms <= ms, `Reader exceeded ${ms} ms`);
              assert.ok(result.heap <= (HEAP_MB + 16) * 1024 * 1024, 'Worker heap budget exceeded');
              if (c.id.startsWith('stress/L1 ')) assert.ok(result.heap <= 128 * 1024 * 1024, 'L1 exceeded the 128 MiB worker heap bound');
              passed++;
              if (result.domain) rejected++;
              for (const k of ks) failures.push(`${c.id}: listed as known (${k.finding}) but passed; remove it from KNOWN`);
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e);
              const k = ks.find((x) => x.error.test(error));
              if (k) expected.add(k.finding), knownFailed++;
              else {
                const input = c.text ?? (c.bytes && Buffer.from(c.bytes.subarray(0, 300)).toString('latin1'));
                failures.push(`${c.id}; length=${(c.text ?? c.bytes)?.length}; input=${JSON.stringify(input?.slice(0, 300))}\n${error}`);
              }
              if (/Deadline exceeded|Worker exited|memory limit/i.test(error)) {
                await restart();
              }
            }
          }
        } finally {
          await worker?.terminate();
        }
        t.diagnostic(`${label}: ${total} cases: ${passed} pass / ${failures.length} fail / ${knownFailed} known-failing; known: ${[...expected].join(', ') || 'none'}; ${rejected} domain rejections; ${retried.length} retried${retried.length ? ` (${retried.join(', ')})` : ''}; ${(performance.now() - started).toFixed(0)} ms; peak sampled heap ${(peakHeap / 1024 / 1024).toFixed(1)} MiB${l1PeakHeap ? `; L1 sampled peak ${(l1PeakHeap / 1024 / 1024).toFixed(1)} MiB` : ''}`);
        assert.equal(failures.length, 0, failures.join('\n\n'));
      });
    }
  });
}

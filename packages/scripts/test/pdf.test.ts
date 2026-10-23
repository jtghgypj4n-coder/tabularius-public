import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { pdfPageCount } from '@tabularius/calc';
import type { Script } from '@tabularius/fmp12';
import { createStore, importFmp12, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';
import { appendPdf, pdf, PdfAppendError, readImage, wrap } from '../src/pdf.ts';
import { cssColor, LayoutPrinter, resolveCss, textStyle, type PrintSource } from '../src/print.ts';
import type { LayoutDesign, LayoutObject, LayoutPart } from '@tabularius/fmp12';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');

/** The objects of a PDF, by number, with their streams inflated when compressed. */
function objects(b: Buffer): Map<number, { dict: string; stream?: Buffer }> {
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  const offsets = s.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  const out = new Map<number, { dict: string; stream?: Buffer }>();
  offsets.forEach((o, i) => {
    assert.ok(s.startsWith(`${i + 1} 0 obj\n`, o), `object ${i + 1} at ${o}`);
    const body = s.slice(o, s.indexOf('\nendobj', o));
    const at = body.indexOf('\nstream\n');
    if (at < 0) return out.set(i + 1, { dict: body });
    const dict = body.slice(0, at);
    const length = Number(/\/Length (\d+)/.exec(dict)![1]);
    const raw = b.subarray(o + at + 8, o + at + 8 + length);
    out.set(i + 1, { dict, stream: raw });
  });
  return out;
}

/** The text the page contents show, line by line. */
function shownText(b: Buffer): string[] {
  return [...objects(b).values()].filter((o) => o.stream && !/Subtype \/Image/.test(o.dict))
    .flatMap((o) => [...o.stream!.toString('latin1').matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) => m[1].replace(/\\([0-7]{3}|.)/g, (_, c: string) => (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c))));
}

/** A small PNG with an alpha channel: 2x1, one opaque red pixel and one clear blue one. */
function png(): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  // Filter 1 (Sub): the second pixel is stored as its difference from the first.
  const row = Buffer.from([1, 255, 0, 0, 255, 1, 0, 255, 1]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(row)), chunk('IEND', Buffer.alloc(0))]);
}

function testPng(width: number, height: number, depth: 8 | 16, type: 0 | 2 | 3 | 4 | 6, interlace: boolean): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind), data]);
    const len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const sample = (x: number, y: number) => Buffer.from(Array.from({ length: channels }, (_, c) => (x * 37 + y * 61 + c * 53) & 255)
    .flatMap((v) => depth === 16 ? [v, 7] : [v]));
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows: Buffer[] = [];
  for (const [x0, y0, dx, dy] of passes) {
    if (x0 >= width || y0 >= height) continue;
    for (let y = y0; y < height; y += dy) {
      const pixels: Buffer[] = [];
      for (let x = x0; x < width; x += dx) pixels.push(sample(x, y));
      const raw = Buffer.concat(pixels);
      if (interlace) {
        const filtered = Buffer.alloc(raw.length);
        const bpp = channels * (depth === 16 ? 2 : 1);
        for (let i = 0; i < raw.length; i++) filtered[i] = (raw[i] - (i >= bpp ? raw[i - bpp] : 0)) & 255;
        rows.push(Buffer.from([1]), filtered);
      } else rows.push(Buffer.from([0]), raw);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = type; ihdr[12] = Number(interlace);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    ...(type === 3 ? [chunk('PLTE', Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0]))] : []),
    chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('PDF: truncated PNG is skipped and the rest of the PDF is written', () => {
  const bad = testPng(1, 1, 8, 2, false).subarray(0, 8 + 8 + 7);
  assert.equal(readImage(bad), undefined);
  const badLength = Buffer.from(testPng(1, 1, 8, 2, false));
  badLength.writeUInt32BE(0xffff_ffff, 8);
  assert.equal(readImage(badLength), undefined);
  const badPixels = Buffer.from(testPng(1, 1, 8, 2, false));
  badPixels[8 + 25 + 8] = 0; // corrupt the compressed IDAT stream
  assert.equal(readImage(badPixels), undefined);
  const result = pdf([{ width: 100, height: 100, ops: [{ kind: 'image', left: 0, top: 0, width: 10, height: 10, data: bad }] }]);
  assert.equal([...objects(result).values()].filter((o) => /Subtype \/Image/.test(o.dict)).length, 0);
});

test('PDF: Adam7 PNG pixels match ordinary PNG pixels for supported color types', () => {
  for (const type of [0, 2, 3, 4, 6] as const) {
    const plain = readImage(testPng(9, 9, 8, type, false))!;
    const adam7 = readImage(testPng(9, 9, 8, type, true))!;
    assert.ok(adam7, `type ${type}`);
    assert.deepEqual(inflateSync(adam7.data), inflateSync(plain.data), `color, type ${type}`);
    if (plain.mask) assert.deepEqual(inflateSync(adam7.mask!.data), inflateSync(plain.mask.data), `alpha, type ${type}`);
  }
});

test('PDF: 16-bit PNG alpha uses the high byte, including Adam7 images', () => {
  for (const type of [4, 6] as const) {
    const high = readImage(testPng(9, 9, 8, type, false))!;
    for (const interlace of [false, true]) {
      const image = readImage(testPng(9, 9, 16, type, interlace))!;
      assert.ok(image, `type ${type}, interlace ${interlace}`);
      assert.deepEqual(inflateSync(image.data), inflateSync(high.data));
      assert.deepEqual(inflateSync(image.mask!.data), inflateSync(high.mask!.data));
    }
  }
});

test('PDF: PNG tRNS transparency remains unsupported', () => {
  const base = testPng(2, 2, 8, 3, false);
  const body = Buffer.concat([Buffer.from('tRNS'), Buffer.from([0, 255, 0])]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(3);
  checksum.writeUInt32BE(crc32(body));
  const at = 8 + 25 + 21; // signature, IHDR and the three-color PLTE
  const transparent = Buffer.concat([base.subarray(0, at), length, body, checksum, base.subarray(at)]);
  assert.equal(readImage(transparent), undefined);
});

test('PDF: shapes, text and images make a valid file', () => {
  const b = pdf([{
    width: 612, height: 792, ops: [
      { kind: 'rect', left: 10, top: 10, width: 100, height: 40, fill: [255, 0, 0], radius: 5, border: { color: [0, 0, 0], width: 1 } },
      { kind: 'text', left: 10, top: 10, width: 100, height: 40, text: 'Café (1) \\ ok', style: { font: 'Times-Bold', size: 12, align: 'center', valign: 'middle', underline: true } },
      { kind: 'image', left: 200, top: 10, width: 100, height: 50, data: png() },
      { kind: 'line', x1: 0, y1: 100, x2: 612, y2: 100, stroke: { color: [0, 0, 255], width: 2 } },
    ],
  }], 'Report');
  const objs = objects(b);
  assert.deepEqual(shownText(b), ['Café (1) \\ ok']);
  const images = [...objs.values()].filter((o) => /Subtype \/Image/.test(o.dict));
  // The color image and its alpha mask.
  assert.equal(images.length, 2);
  const mask = images.find((o) => /DeviceGray/.test(o.dict))!;
  assert.deepEqual([...inflateSync(mask.stream!)], [255, 0]);
  const color = images.find((o) => /SMask/.test(o.dict))!;
  assert.deepEqual([...inflateSync(color.stream!)], [255, 0, 0, 0, 0, 255]);
  assert.match([...objs.values()].map((o) => o.dict).join('\n'), /\/BaseFont \/[A-Z]{6}\+Tinos-Bold/);
});

test('PDF: the same picture on many pages is stored once', () => {
  // Separate copies of the same bytes, as each read from the file gives.
  const page = () => ({ width: 612, height: 792, ops: [{ kind: 'image' as const, left: 0, top: 0, width: 20, height: 10, data: png() }] });
  const b = pdf([page(), page(), page()]);
  const images = [...objects(b).values()].filter((o) => /Subtype \/Image/.test(o.dict));
  assert.equal(images.length, 2); // one picture and its alpha mask
});

test('PDF: images it cannot hold are left out; JPEG sizes come from the frame header', () => {
  assert.equal(readImage(Buffer.from('GIF89a')), undefined);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0, 0, 0, 0xff, 0xd9]);
  const img = readImage(jpeg)!;
  assert.deepEqual([img.width, img.height], [30, 20]);
  assert.match(img.dict, /DCTDecode/);
});

/**
 * The PDF this writer makes for `pages`, rewritten the way PDF 1.5 writers save:
 * the catalog, page tree and info inside a compressed object stream, and a
 * compressed cross-reference stream with the PNG Up predictor in place of the
 * table. With `hybrid`, a classic table of the other objects points at the
 * stream with /XRefStm, as files kept readable by older readers do.
 */
function compressedPdf(pages: Parameters<typeof pdf>[0], hybrid = false): Buffer {
  const all = objects(pdf(pages));
  const places = new Map<number, [number, number, number]>(); // type, offset or stream, generation or index
  const loose = [...all].filter(([n]) => n > 3);
  const chunks: Buffer[] = [];
  const add = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    chunks.push(buf);
    return buf.length;
  };
  let at = add('%PDF-1.5\n');
  for (const [n, o] of loose) {
    places.set(n, [1, at, 0]);
    if (!o.stream) at += add(`${o.dict}\nendobj\n`);
    else {
      at += add(`${o.dict}\nstream\n`);
      at += add(o.stream);
      at += add('\nendstream\nendobj\n');
    }
  }
  // Objects 1 to 3 go in object stream 100.
  const bodies = [1, 2, 3].map((n) => all.get(n)!.dict.replace(/^\d+ 0 obj\n/, ''));
  let header = '';
  let data = '';
  bodies.forEach((b, i) => {
    header += `${i + 1} ${data.length} `;
    data += `${b}\n`;
    places.set(i + 1, [2, 100, i]);
  });
  const packed = deflateSync(Buffer.from(header + data, 'latin1'));
  places.set(100, [1, at, 0]);
  at += add(`100 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode /Length 101 0 R >>\nstream\n`);
  at += add(packed);
  at += add('\nendstream\nendobj\n');
  places.set(101, [1, at, 0]);
  at += add(`101 0 obj\n${packed.length}\nendobj\n`);
  // The cross-reference stream (object 102), rows of [type, 3-byte offset, generation], each after a PNG Up filter byte.
  const size = 103;
  places.set(0, [0, 0, 255]);
  places.set(102, [1, at, 0]);
  const raw = Buffer.alloc(size * 5);
  for (let n = 0; n < size; n++) {
    const [type, a, b] = places.get(n) ?? [0, 0, 0];
    raw.set([type, (a >> 16) & 255, (a >> 8) & 255, a & 255, b], n * 5);
  }
  const predicted = Buffer.alloc(size * 6);
  for (let r = 0; r < size; r++) {
    predicted[r * 6] = 2;
    for (let c = 0; c < 5; c++) predicted[r * 6 + 1 + c] = (raw[r * 5 + c] - (r ? raw[(r - 1) * 5 + c] : 0)) & 255;
  }
  const stream = deflateSync(predicted);
  const xrefAt = at;
  at += add(`102 0 obj\n<< /Type /XRef /Size ${size} /W [1 3 1] /Root 1 0 R /Info 3 0 R /ID [<00FF> <00FF>] /Filter [/FlateDecode] /DecodeParms [<< /Predictor 12 /Columns 5 >>] /Length ${stream.length} >>\nstream\r\n`);
  at += add(stream);
  at += add('\nendstream\nendobj\n');
  if (!hybrid) {
    add(`startxref\n${xrefAt}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
  // Older readers see only the table, which leaves out objects 1 to 3.
  const entry = (n: number) => `${String(places.get(n)![1]).padStart(10, '0')} 00000 n \n`;
  let table = 'xref\n0 1\n0000000000 65535 f \n';
  table += `4 ${loose.length}\n${loose.map(([n]) => entry(n)).join('')}100 3\n${entry(100)}${entry(101)}${entry(102)}`;
  add(`${table}trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R /XRefStm ${xrefAt} >>\nstartxref\n${at}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

test('PDF: Append adds pages to a PDF with compressed cross-references and object streams', () => {
  for (const hybrid of [false, true]) {
    const before = compressedPdf([{ width: 300, height: 400, ops: [{ kind: 'text', left: 10, top: 10, width: 100, height: 20, text: 'first' }] }], hybrid);
    const once = Buffer.concat([before, appendPdf(before, [{ width: 200, height: 200, ops: [] }])]);
    assert.equal(once.subarray(0, before.length).compare(before), 0, 'the bytes already there stay as they were');
    const added = once.subarray(before.length).toString('latin1');
    assert.match(added, /^2 0 obj\n<< \/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2 >>/);
    // A stream file gets a cross-reference stream naming the new page tree; a hybrid one a table.
    if (hybrid) assert.match(added, /trailer\n<< \/Size \d+ \/Root 1 0 R \/Info 3 0 R \/Prev \d+ >>/);
    else assert.match(added, /\/Type \/XRef \/Size \d+ \/W \[1 4 2\] \/Index \[2 1 103 \d+\] \/Root 1 0 R \/Info 3 0 R \/ID \[<00FF> <00FF>\] \/Prev \d+/);
    // Appending again reads back the section it wrote.
    const twice = Buffer.concat([once, appendPdf(once, [{ width: 100, height: 100, ops: [] }])]);
    assert.match(twice.subarray(once.length).toString('latin1'), /^2 0 obj\n<< \/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R \d+ 0 R\] \/Count 3 >>/);
    assert.equal(pdfPageCount(twice), 3);
  }
});

test('PDF: Append refuses compressed cross-references it cannot read', () => {
  const good = compressedPdf([{ width: 10, height: 10, ops: [] }]).toString('latin1');
  for (const [why, bytes] of [
    ['another compression', good.replace('/Filter [/FlateDecode]', '/Filter [/LZWDecode]')],
    ['a TIFF predictor', good.replace('/Predictor 12', '/Predictor 2')],
    ['a damaged stream', good.replace(/(\/Type \/XRef[^]*?stream\r\n)(.)/, (_, a: string, c: string) => a + String.fromCharCode(c.charCodeAt(0) ^ 0xff))],
    ['no field widths', good.replace('/W [1 3 1]', '')],
  ]) {
    assert.throws(() => appendPdf(Buffer.from(bytes, 'latin1'), [{ width: 1, height: 1, ops: [] }]), PdfAppendError, why);
  }
});

test('PDF: text wraps at spaces and breaks at returns', () => {
  // "aaa bbb" is 38.9 points wide at size 10 in Helvetica.
  assert.deepEqual(wrap('aaa bbb ccc\rddd', 10, 40), ['aaa bbb', 'ccc', 'ddd']);
});

test('styles: theme defaults, named styles, local rules and conditions stack in that order', () => {
  const theme = {
    id: 1, name: 't', styles: [{ name: 'Big', element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '24px', color: 'rgb(0 0 255)' } }] }],
    defaults: { 70: [{ part: 1, state: 1, css: { 'font-size': '12px', color: 'rgb(1 2 3)', 'text-align': 'center' } }], 60: [{ part: 1, state: 1, css: { color: 'rgb(9 9 9)' } }] },
    contextual: [{ path: [32, 70], rules: [{ part: 1, state: 1, css: { 'font-weight': 'bold' } }] }],
  };
  const style = { name: 'Big', rules: [{ part: 1, state: 1, css: { color: 'rgb(0 128 0)' } }, { part: 1, state: 2, css: { color: 'rgb(255 0 0)' } }] };
  const inHeader = resolveCss(theme, style, 70, [20, 30, 32], 1);
  assert.deepEqual(inHeader, { 'font-size': '24px', color: 'rgb(0 128 0)', 'text-align': 'center', 'font-weight': 'bold' });
  assert.equal(resolveCss(theme, style, 70, [20, 30, 34], 1)['font-weight'], undefined);
  const red = resolveCss(theme, style, 70, [], 1, [{ part: 1, state: 1, css: { color: 'rgb(255 0 0)' } }]);
  assert.equal(red.color, 'rgb(255 0 0)');
  const st = textStyle(inHeader, 30, true);
  assert.deepEqual([st.font, st.size, st.color, st.align], ['Helvetica-Bold', 24, [0, 128, 0], 'center']);
  assert.deepEqual(cssColor('rgb(10 20 30 / 0)'), undefined);
  assert.deepEqual(cssColor('#fa0'), [255, 170, 0]);
});

/** Run script text on a fixture's layout and read back the PDF it saved. */
async function save(file: string, layout: string, text: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    importFmp12(join(fixtures, file), join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'));
    try {
      const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const r = await runScript(store, { id: 1, name: 't', steps } as Script, { layout, foundSet: store.findIds(layout), documents: join(dir, 'Documents') });
      assert.equal(r.error, 0);
      return readFileSync(join(dir, 'Documents', 'out.pdf'));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
}

test('Save Records as PDF draws portal rows from the related records', { skip: !existsSync(join(fixtures, 'InterMediator_TestDB.fmp12')) && 'fixtures missing' }, async () => {
  const b = await save('InterMediator_TestDB.fmp12', 'person_layout', 'Save Records as PDF [ With dialog: Off ; “out.pdf” ; Current record ; Create folders: Off ]');
  const shown = shownText(b);
  assert.ok(shown.includes('Masayuki Nii'));
  // The contact portal's three rows, in order.
  const rows = shown.filter((t) => ['Telephone', 'Meeting', 'Mail'].includes(t));
  assert.deepEqual(rows, ['Telephone', 'Meeting', 'Mail']);
  assert.ok(shown.includes('Hight School'));
});

test('Save Records as PDF prints sub-summaries around each group of the sorted records', { skip: !existsSync(join(fixtures, 'FMburgh_2012_11_07_Database.fmp12')) && 'fixtures missing' }, async () => {
  const sorted = 'Sort Records [ Restore ; With dialog: Off ; Comics_Muddled::Type ; ascending ; Comics_Muddled::Publisher ; ascending ]\n';
  const save1 = 'Save Records as PDF [ With dialog: Off ; “out.pdf” ; Records being browsed ; Create folders: Off ]';
  const plain = shownText(await save('FMburgh_2012_11_07_Database.fmp12', 'Muddled Comics Report', save1));
  const grouped = shownText(await save('FMburgh_2012_11_07_Database.fmp12', 'Muddled Comics Report', sorted + save1));
  // Sorted by their break fields, the report adds sub-summary lines around each group.
  assert.ok(grouped.length > plain.length);
  // The first group of the sorted report: one DC Comics, Inc. limited series, counted in its trailing sub-summary.
  const at = grouped.indexOf('Superman: Secret Origin');
  assert.ok(at > 0);
  assert.deepEqual(grouped.slice(at + 4, at + 7).map((x) => x.trim()), ['DC Comics, Inc.', 'DC Comics, Inc.', '1']);
});

test('Create PDF, Save Records as PDF into it, then Close PDF to a file or a variable; Cancel PDF discards', { skip: !existsSync(join(fixtures, 'InterMediator_TestDB.fmp12')) && 'fixtures missing' }, async () => {
  const one = 'Save Records as PDF [ With dialog: Off ; Current record ; Currently open PDF ]';
  const b = await save('InterMediator_TestDB.fmp12', 'person_layout', [
    'Set Error Capture [ On ]',
    'Close PDF [ Save to: File ; “nothing.pdf” ]',
    'If [ Get ( LastError ) ≠ 5 ]', 'Halt Script', 'End If',
    'Create PDF', 'Create PDF',
    'If [ Get ( LastError ) ≠ 833 ]', 'Halt Script', 'End If',
    one, 'Go to Record/Request/Page [ Next ]', one,
    'Close PDF [ Save to: File ; “out.pdf” ; Create folders: Off ]',
  ].join('\n'));
  const pages = [...objects(b).values()].filter((o) => /\/Type \/Page\b/.test(o.dict));
  assert.equal(pages.length, 2);
  assert.ok(shownText(b).includes('Masayuki Nii'));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    importFmp12(join(fixtures, 'InterMediator_TestDB.fmp12'), join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'));
    try {
      const steps = parseScriptText(['Create PDF', one, 'Close PDF [ Save to: Target ; Target: $pdf ; Filename: "Report" ]', 'Create PDF', 'Cancel PDF',
        'Set Variable [ $x ; Value: GetContainerAttribute ( $pdf ; "filename" ) & "/" & ( GetContainerAttribute ( $pdf ; "fileSize" ) > 100 ) ]', 'Exit Script [ Text Result: $x ]'].join('\n'), store.schema)
        .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const r = await runScript(store, { id: 1, name: 't', steps } as Script, { layout: 'person_layout', foundSet: store.findIds('person_layout'), documents: join(dir, 'Documents') });
      assert.equal(r.error, 0);
      assert.equal(r.result, 'Report.pdf/1');
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Get ( PageNumber ): the page being printed, in a footer calculation and in formulas; 0 otherwise', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Pages');
    try {
      store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }, { name: 'PageLabel', kind: 'calculation', calculation: '"Page " & Get ( PageNumber )', options: { unstored: true } }] }] as never);
      const d = store.designs().layouts[0];
      // A tall body puts each record on its own page; the page label goes in the footer.
      const parts = d.parts.map((p) => (p.kind === 'body' ? { ...p, height: 650 } : p.kind === 'footer' ? { ...p, top: 710 } : p));
      const objects = d.objects
        .filter((o) => o.kind !== 'text' || o.bounds.top < 60)
        .map((o) => (o.field?.field === 'PageLabel' ? { ...o, bounds: { top: 720, left: 20, bottom: 740, right: 300 } } : o));
      store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { parts, objects } }] as never);
      for (const name of ['a', 'b', 'c']) store.create('T', { Name: name });
      const run = async (text: string) => {
        const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
        return runScript(store, { id: 1, name: 't', steps } as Script, { layout: 'T', foundSet: store.findIds('T'), documents: join(dir, 'Documents') });
      };
      const r = await run('Save Records as PDF [ With dialog: Off ; “out.pdf” ; Records being browsed ; Create folders: Off ]\nExit Script [ Text Result: Get ( PageNumber ) ]');
      assert.equal(r.error, 0);
      assert.equal(r.result, '0', 'not printing once the PDF is written');
      const shown = shownText(readFileSync(join(dir, 'Documents', 'out.pdf')));
      assert.deepEqual(shown.filter((t) => t.startsWith('Page ')), ['Page 1', 'Page 2', 'Page 3']);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Save Records as PDF works out calculated text (<<ƒ:formula>>) on each record', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Calc');
    try {
      store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }] }] as never);
      const d = store.designs().layouts[0];
      const text = { id: 9001, kind: 'text', type: 2, bounds: { top: 5, left: 300, bottom: 25, right: 500 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
        text: 'Hi <<ƒ:Upper ( Name ) & If ( Length ( Name ) > 1 ; "!" ; "" )>>' };
      const parts = d.parts.map((p) => (p.kind === 'body' ? { ...p, top: 0, height: 650 } : p)).filter((p) => p.kind === 'body');
      store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { parts, objects: [{ ...text }] } }] as never);
      for (const name of ['ab', 'c']) store.create('T', { Name: name });
      const steps = parseScriptText('Save Records as PDF [ With dialog: Off ; “out.pdf” ; Records being browsed ; Create folders: Off ]', store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const r = await runScript(store, { id: 1, name: 't', steps } as Script, { layout: 'T', foundSet: store.findIds('T'), documents: join(dir, 'Documents') });
      assert.equal(r.error, 0);
      assert.deepEqual(shownText(readFileSync(join(dir, 'Documents', 'out.pdf'))).filter((t) => t.startsWith('Hi')), ['Hi AB!', 'Hi C']);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Save Records as PDF shows the page count ({{PageCount}} and Get ( PageCount )) on every page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Count');
    try {
      store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }] }] as never);
      const d = store.designs().layouts[0];
      const text = { id: 9001, kind: 'text', type: 2, bounds: { top: 5, left: 300, bottom: 25, right: 500 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
        text: 'Page {{PageNumber}} of {{PageCount}} <<ƒ:Get ( PageCount )>>' };
      // One record a page.
      const parts = d.parts.map((p) => (p.kind === 'body' ? { ...p, top: 0, height: 650 } : p)).filter((p) => p.kind === 'body');
      store.applyDesign([{ op: 'updateLayout', layout: d.id, design: { parts, objects: [{ ...text }] } }] as never);
      for (const name of ['a', 'b', 'c']) store.create('T', { Name: name });
      const steps = parseScriptText('Save Records as PDF [ With dialog: Off ; “out.pdf” ; Records being browsed ; Create folders: Off ]\nExit Script [ Text Result: "[" & Get ( PageCount ) & "]" ]', store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const r = await runScript(store, { id: 1, name: 't', steps } as Script, { layout: 'T', foundSet: store.findIds('T'), documents: join(dir, 'Documents') });
      assert.equal(r.error, 0);
      assert.equal(r.result, '[]', 'empty once nothing is printing');
      assert.deepEqual(shownText(readFileSync(join(dir, 'Documents', 'out.pdf'))).filter((t) => t.startsWith('Page')), ['Page 1 of 3 3', 'Page 2 of 3 3', 'Page 3 of 3 3']);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/** A layout printed straight from a design: one body per record, field values from `rows`. */
function printLayout(parts: LayoutPart[], objects: LayoutObject[], rows: Record<string, string>[], items: (p: Record<string, LayoutPart>) => LayoutPart[], setup?: never, extra: Partial<LayoutDesign> = {}) {
  let row: Record<string, string> = {};
  const src: PrintSource = {
    field: (o) => ({ text: row[o.field!.field!] ?? '' }),
    merge: (t, page) => t.replace(/\{\{PageNumber\}\}/g, String(page)).replace(/<<(\w+)>>/g, (_, n: string) => row[n] ?? ''),
    hidden: () => false,
    conditions: () => [],
    image: () => undefined,
    portalCount: () => 0,
    portalRow: () => {},
  };
  const design = { id: 1, name: 'L', parts, objects, width: 400, ...extra } as LayoutDesign;
  const byKind = Object.fromEntries(parts.map((p) => [p.kind, p]));
  let r = -1;
  // Each body selects its own record (the printer may select one more than once).
  const list = items(byKind).map((part) => {
    if (part.kind !== 'body') return { part };
    const mine = rows[++r] ?? {};
    return { part, select: () => { row = mine; } };
  });
  return new LayoutPrinter(design, undefined, src, { setup }).print(list);
}
const part = (kind: string, top: number, height: number, options?: LayoutPart['options']) => ({ kind, top, height, style: {}, ...(options ? { options } : {}) }) as LayoutPart;
const obj = (id: number, kind: string, top: number, bottom: number, extra: Partial<LayoutObject> = {}) =>
  ({ id, kind, type: 0, bounds: { top, left: 10, bottom, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...extra }) as LayoutObject;
const texts = (page: { ops: { kind: string; text?: string; top?: number }[] }) => page.ops.filter((o) => o.kind === 'text').map((o) => o.text);

test('printing: objects hidden when printing stay off the page', () => {
  const pages = printLayout([part('body', 0, 50)], [obj(1, 'text', 5, 20, { text: 'shown' }), obj(2, 'text', 25, 40, { text: 'screen only', hideWhenPrinting: true })], [{}], (p) => [p.body]);
  assert.deepEqual(texts(pages[0]), ['shown']);
});

test('printing: Part Definition page breaks (before each, after every N) and page numbers that start again', () => {
  const parts = [part('header', 0, 20), part('sub-summary-leading', 20, 20, { pageBreakBefore: true, restartPageNumbers: true }), part('body', 40, 20, { pageBreakEvery: 2 })];
  const objects = [obj(1, 'text', 2, 18, { text: 'p{{PageNumber}}' }), obj(2, 'text', 22, 38, { text: 'group' }), obj(3, 'field', 42, 58, { field: { field: 'N', display: 'edit' } as never })];
  const rows = ['a', 'b', 'c', 'd', 'e'].map((N) => ({ N }));
  // Two groups: a b c, then d e. Bodies break after every second one, counted across the report as Preview does;
  // numbering starts again after each page holding a group's sub-summary.
  const pages = printLayout(parts, objects, rows, (p) => [p['sub-summary-leading'], p.body, p.body, p.body, p['sub-summary-leading'], p.body, p.body]);
  assert.deepEqual(pages.map(texts), [['p1', 'group', 'a', 'b'], ['p1', 'c'], ['p2', 'group', 'd'], ['p1', 'e']]);
});

test('printing: an empty sliding field closes up, the text below moves up and the part shrinks', () => {
  const objects = [
    obj(1, 'field', 0, 20, { field: { field: 'A', display: 'edit' } as never, sliding: { up: true, resizePart: true } }),
    obj(2, 'text', 30, 50, { text: 'below', sliding: { up: true, resizePart: true } }),
  ];
  const pages = printLayout([part('body', 0, 60)], objects, [{ A: '' }, { A: 'x' }], (p) => [p.body, p.body]);
  const below = pages[0].ops.filter((o) => o.kind === 'text' && o.text === 'below').map((o) => (o as { top: number }).top);
  // Page margin 36: the first record's text slid up by the empty field's 20 points; the part shrank to 40, so the second record starts at 76.
  assert.equal(below[0], 36 + 10);
  assert.ok(below[1] > 76 && below[1] < 76 + 30, `second record's text at ${below[1]}`);
});

test('printing: the file\'s page setup sets the paper and margins', () => {
  const setup = { orientation: 'landscape', width: 842, height: 595, margins: { top: 20, left: 30, bottom: 20, right: 30 } } as never;
  const pages = printLayout([part('body', 0, 50)], [obj(1, 'text', 5, 20, { text: 'x' })], [{}], (p) => [p.body], setup);
  assert.deepEqual([pages[0].width, pages[0].height], [842, 595]);
  const t = pages[0].ops.find((o) => o.kind === 'text') as { left: number; top: number };
  assert.deepEqual([t.left, t.top], [40, 25]);
});

test('printing: Layout Setup\'s fixed page margins replace the page setup\'s, and its scale is left out', () => {
  const setup = { orientation: 'landscape', width: 842, height: 595, margins: { top: 20, left: 30, bottom: 20, right: 30 }, scale: 0.5 } as never;
  const fixedMargins = { top: 8, left: 12, bottom: 8, right: 12 };
  const pages = printLayout([part('body', 0, 50)], [obj(1, 'text', 5, 20, { text: 'x' })], [{}], (p) => [p.body], setup, { fixedMargins });
  assert.deepEqual([pages[0].width, pages[0].height], [842, 595]);
  const t = pages[0].ops.find((o) => o.kind === 'text') as { left: number; top: number };
  assert.deepEqual([t.left, t.top], [22, 13]);
});

test('printing: Layout Setup\'s columns put records side by side, across or down, with grand summaries across the page', () => {
  // US Letter less half-inch margins is 540 wide: two columns of 270. The name field is in the first column; a note beyond it isn't printed.
  const parts = [part('leading-grand-summary', 0, 20), part('body', 20, 200)];
  const objects = [obj(1, 'text', 2, 18, { text: 'total' }), obj(2, 'field', 22, 40, { field: { field: 'N', display: 'edit' } as never }),
    { ...obj(3, 'text', 22, 40, { text: 'beyond' }), bounds: { top: 22, left: 280, bottom: 40, right: 380 } }];
  const rows = ['a', 'b', 'c', 'd', 'e'].map((N) => ({ N }));
  const order = (p: Record<string, LayoutPart>) => [p['leading-grand-summary'], p.body, p.body, p.body, p.body, p.body];
  const at = (pages: ReturnType<typeof printLayout>) => pages.map((pg) => pg.ops.filter((o) => o.kind === 'text').map((o) => {
    const t = o as { text: string; left: number; top: number };
    return `${t.text}@${t.left},${t.top}`;
  }));
  // Across: a b side by side, then c d; 720 tall pages hold the summary and three rows of 200.
  const across = printLayout(parts, objects, rows, order, undefined, { printColumns: { count: 2 } });
  assert.deepEqual(at(across), [['total@46,38', 'a@46,58', 'b@316,58', 'c@46,258', 'd@316,258', 'e@46,458']]);
  // Down: a b c down the first column, then d e in the second.
  const down = printLayout(parts, objects, rows, order, undefined, { printColumns: { count: 2, order: 'down' } });
  assert.deepEqual(at(down), [['total@46,38', 'a@46,58', 'b@46,258', 'c@46,458', 'd@316,58', 'e@316,258']]);
});

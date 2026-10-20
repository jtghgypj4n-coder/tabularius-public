import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfText } from '@tabularius/calc';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import type { Script } from '@tabularius/fmp12';
import { createPdfWriter, pdf, writePdf, wrap, type PdfPage } from '../src/pdf.ts';
import { LayoutPrinter, type PrintSource } from '../src/print.ts';
import type { LayoutDesign, LayoutObject, LayoutPart } from '@tabularius/fmp12';
import { runScript } from '../src/index.ts';

type ObjectBody = { dict: string; stream?: Buffer };

/** Content operators, skipping literal/hex strings, names, and comments. */
function contentTokens(data: Buffer): string[] {
  const s = data.toString('latin1');
  const tokens: string[] = [];
  const boundary = (ch: string) => /[\s()[\]<>/%]/.test(ch);
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (ch === '(') {
      let depth = 1; i++;
      while (i < s.length && depth) {
        if (s[i] === '\\') i += 2;
        else if (s[i] === '(') { depth++; i++; }
        else if (s[i] === ')') { depth--; i++; }
        else i++;
      }
      assert.equal(depth, 0, 'balanced PDF string');
      continue;
    }
    if (ch === '<' && s[i + 1] !== '<') {
      i = s.indexOf('>', i + 1);
      assert.ok(i >= 0, 'closed hex string');
      i++; continue;
    }
    if ('<>[]'.includes(ch)) { i += s[i + 1] === ch && (ch === '<' || ch === '>') ? 2 : 1; continue; }
    const start = i++;
    while (i < s.length && !boundary(s[i])) i++;
    tokens.push(s.slice(start, i));
  }
  return tokens;
}

/** Check classic PDF 1.4 structure using the xref offsets, never a library parser. */
function checkPdf(bytes: Buffer, expectedPages: number): { objects: Map<number, ObjectBody>; pages: ObjectBody[] } {
  const raw = bytes.toString('latin1');
  assert.match(raw.slice(0, 15), /^%PDF-1\.4\n%/);
  assert.match(raw.slice(-6), /%%EOF\n/);
  const tail = /startxref\n(\d+)\n%%EOF\n$/.exec(raw);
  assert.ok(tail, 'startxref and EOF');
  const at = Number(tail[1]);
  assert.equal(raw.slice(at, at + 5), 'xref\n');
  const xref = /^xref\n0 (\d+)\n0000000000 65535 f \n/.exec(raw.slice(at));
  assert.ok(xref, 'complete xref header');
  const count = Number(xref[1]);
  const entries = raw.slice(at + xref[0].length).split('\n', count - 1);
  const objects = new Map<number, ObjectBody>();
  for (let id = 1; id < count; id++) {
    const entry = entries[id - 1];
    assert.match(entry, /^\d{10} 00000 n $/, `xref entry ${id}`);
    const offset = Number(entry.slice(0, 10));
    const head = `${id} 0 obj\n`;
    assert.equal(raw.slice(offset, offset + head.length), head, `object ${id} offset`);
    const end = raw.indexOf('\nendobj\n', offset);
    assert.ok(end > offset, `object ${id} end`);
    const body = raw.slice(offset + head.length, end);
    const mark = body.indexOf('\nstream\n');
    if (mark < 0) { objects.set(id, { dict: body }); continue; }
    const dict = body.slice(0, mark);
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1]);
    assert.ok(Number.isSafeInteger(length));
    const start = offset + head.length + mark + '\nstream\n'.length;
    assert.equal(raw.slice(start + length, start + length + '\nendstream'.length), '\nendstream');
    objects.set(id, { dict, stream: bytes.subarray(start, start + length) });
  }
  const trailer = raw.slice(at + xref[0].length + entries.join('\n').length);
  assert.match(trailer, /\/Root 1 0 R \/Info 3 0 R/);
  assert.match(trailer, new RegExp(`/Size ${count}\\b`));
  assert.match(objects.get(1)!.dict, /\/Type \/Catalog \/Pages 2 0 R/);
  assert.match(objects.get(3)!.dict, /\/Producer \(Tabularius\) \/Title <FEFF/);
  const tree = objects.get(2)!.dict;
  assert.match(tree, new RegExp(`/Count ${expectedPages}\\b`));
  const kids = /\/Kids \[([^\]]*)\]/.exec(tree)?.[1].match(/\d+ 0 R/g) ?? [];
  assert.equal(kids.length, expectedPages);
  const pages = kids.map((ref) => {
    const obj = objects.get(Number(ref.split(' ')[0]));
    assert.ok(obj);
    assert.match(obj.dict, /\/Type \/Page \/Parent 2 0 R/);
    assert.match(obj.dict, /\/MediaBox \[0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?\]/);
    assert.match(obj.dict, /\/Resources << \/Font <</);
    const content = objects.get(Number(/\/Contents (\d+) 0 R/.exec(obj.dict)![1]));
    assert.ok(content?.stream);
    const resources = new Map([...obj.dict.matchAll(/\/([FU]\d+) (\d+) 0 R/g)].map((m) => [m[1], Number(m[2])]));
    for (const [, font] of resources) assert.match(objects.get(font)?.dict ?? '', /\/Type \/Font\b/);
    const tokens = contentTokens(content.stream);
    for (let i = 0; i < tokens.length; i++) if (tokens[i] === 'Tf') {
      const name = tokens[i - 2]?.slice(1);
      assert.ok(resources.has(name), `font ${name} in page resources`);
    }
    const operators = tokens.filter((token) => ['q', 'Q', 'BT', 'ET', 'BDC', 'EMC'].includes(token));
    for (const [open, close] of [['q', 'Q'], ['BT', 'ET'], ['BDC', 'EMC']]) {
      let depth = 0;
      for (const op of operators) if (op === open) depth++; else if (op === close) assert.ok(--depth >= 0, `${open}/${close} closes after opening`);
      assert.equal(depth, 0, `${open}/${close} balanced`);
    }
    return obj;
  });
  for (const obj of objects.values()) {
    assert.doesNotMatch(obj.dict, /\/(?:URI|GoToR|Launch|F|Filespec|EmbeddedFile)\b/, 'no external references');
    if (/\/Type \/Font\b/.test(obj.dict)) {
      if (/\/Subtype \/CIDFontType2\b/.test(obj.dict)) continue;
      const map = /\/ToUnicode (\d+) 0 R/.exec(obj.dict);
      assert.ok(map, 'every font has ToUnicode');
      assert.match(objects.get(Number(map[1]))?.stream?.toString('ascii') ?? '', /begincmap[\s\S]*endcmap/);
      assert.match(obj.dict, /\/BaseFont \/[A-Z]{6}\+[^\s/]+/, 'font must name a subset');
      const descendant = /\/DescendantFonts \[(\d+) 0 R\]/.exec(obj.dict);
      const font = descendant ? objects.get(Number(descendant[1]))?.dict ?? '' : obj.dict;
      if (descendant) assert.match(font, /\/Subtype \/CIDFontType2\b/);
      else assert.match(font, /\/Subtype \/TrueType\b/);
      const descriptor = /\/FontDescriptor (\d+) 0 R/.exec(font);
      assert.ok(descriptor, 'font must name an embedded descriptor');
      const file = /\/FontFile2 (\d+) 0 R/.exec(objects.get(Number(descriptor[1]))?.dict ?? '');
      assert.ok(file, 'descriptor must embed TrueType bytes');
      const program = objects.get(Number(file[1]))?.stream;
      assert.ok(program && program.readUInt32BE(0) === 0x00010000, 'embedded TrueType program');
      const tableCount = program.readUInt16BE(4);
      const tables = new Map(Array.from({ length: tableCount }, (_, i) => {
        const at = 12 + i * 16;
        return [program.subarray(at, at + 4).toString('ascii'), { at: program.readUInt32BE(at + 8), length: program.readUInt32BE(at + 12) }] as const;
      }));
      for (const table of tables.values()) assert.ok(table.at + table.length <= program.length, 'font table within program');
      const glyf = tables.get('glyf'), loca = tables.get('loca'), maxp = tables.get('maxp'), head = tables.get('head');
      assert.ok(glyf && loca && maxp && head, 'subset font tables');
      const glyphs = program.readUInt16BE(maxp.at + 4);
      const longLoca = program.readInt16BE(head.at + 50) === 1;
      assert.equal(loca.length, (glyphs + 1) * (longLoca ? 4 : 2));
      const location = (i: number) => longLoca ? program.readUInt32BE(loca.at + i * 4) : program.readUInt16BE(loca.at + i * 2) * 2;
      let retained = 0;
      for (let i = 0; i < glyphs; i++) {
        const from = location(i), to = location(i + 1);
        assert.ok(from <= to && to <= glyf.length, 'glyph data within subset');
        if (from < to) retained++;
      }
      assert.ok(retained > 0 && retained < 900, `${retained} glyph programs retained in subset`);
      let sum = 0;
      for (let at = 0; at < program.length; at += 4) sum = (sum + program.readUInt32BE(at)) >>> 0;
      assert.equal(sum, 0xB1B0AFBA, 'TrueType checksum adjustment');
    }
  }
  return { objects, pages };
}

test('strict font check verifies an embedded TrueType subset', () => {
  const styles = [
    'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  ] as const;
  const b = pdf([{ width: 612, height: 792, ops: styles.map((font, i) => ({ ...text(font, 20 + i * 45), style: { font } })) }]);
  const checked = checkPdf(b, 1);
  assert.equal([...checked.objects.values()].filter((o) => /\/Type \/Font\b/.test(o.dict)).length, styles.length);
});

function png(rgb: [number, number, number] = [255, 0, 0]): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(kind), data]);
    const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
    return Buffer.concat([n, payload, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    chunk('IDAT', deflateSync(Buffer.from([0, ...rgb]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const text = (value: string, top = 40) => ({ kind: 'text' as const, text: value, left: 36, top, width: 540, height: 32 });

test('PDF structure, extraction order, Unicode metadata, and image resources', () => {
  const image = png();
  const pages: PdfPage[] = [
    { width: 612, height: 792, ops: [text('Group A'), text('Portal row 1', 75), { kind: 'image', data: image, left: 36, top: 120, width: 50, height: 50 }] },
    { width: 612, height: 792, ops: [text('Subtotal A'), text('עברית e\u0301 😀', 75)] },
    { width: 612, height: 792, ops: [text('Group B'), text('Portal row 2', 75)] },
  ];
  const b = pdf(pages, 'Récapitulatif 😀');
  const checked = checkPdf(b, 3);
  assert.equal([...checked.objects.values()].filter((o) => /\/Subtype \/Image\b/.test(o.dict)).length, 1);
  assert.match(checked.pages[0].dict, /\/XObject << \/I0 \d+ 0 R >>/);
  assert.equal(pdfText(b), 'Group A\rPortal row 1\rSubtotal A\rעברית e\u0301 😀\rGroup B\rPortal row 2');
});

test('long unbroken text clips at visible lines without emitting a megabyte operand', () => {
  const huge = 'a'.repeat(1_048_576);
  assert.ok(wrap('abcdef', 10, 12).length > 1);
  const b = pdf([{ width: 612, height: 792, ops: [{ ...text(huge), height: 20 }] }]);
  checkPdf(b, 1);
  const short = pdf([{ width: 612, height: 792, ops: [{ ...text('a'.repeat(40)), height: 20 }] }]);
  assert.ok(b.length - short.length < 10_000, `clipped text added ${b.length - short.length} bytes`);
});

test('streaming writer keeps each emitted chunk bounded over 501 pages and an empty job', () => {
  const chunks: Buffer[] = [];
  let largest = 0;
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  let sampled = 0;
  const writer = createPdfWriter((b) => {
    largest = Math.max(largest, b.length); chunks.push(b);
    if (++sampled % 64 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
  }, 'Long report');
  const part = { kind: 'body', top: 0, height: 700, style: {} } as LayoutPart;
  const object = { id: 1, kind: 'text', type: 2, text: 'Page {{PageNumber}}', bounds: { top: 5, left: 10, bottom: 30, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} } as LayoutObject;
  const graphic = { id: 2, kind: 'graphic', type: 0, imageId: 1, bounds: { top: 100, left: 10, bottom: 120, right: 30 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} } as LayoutObject;
  const design = { id: 1, name: 'Long report', width: 400, parts: [part], objects: [object, graphic] } as LayoutDesign;
  let currentPage = 1;
  const source: PrintSource = {
    field: () => ({ text: '' }), merge: (s, page) => s.replace('{{PageNumber}}', String(page)),
    hidden: () => false, conditions: () => [],
    image: () => { const n = currentPage === 501 ? 1 : currentPage; return png([n & 255, n >> 8, 0]); },
    portalCount: () => 0, portalRow: () => {}, page: (n) => { currentPage = n; },
  };
  const printer = new LayoutPrinter(design, undefined, source);
  assert.equal(printer.printTo(Array.from({ length: 501 }, () => ({ part })), (page) => writer.addPage(page)), 501);
  writer.finish();
  assert.equal(printer.pages.length, 0, 'completed pages are not retained');
  const b = Buffer.concat(chunks);
  const checked = checkPdf(b, 501);
  assert.equal([...checked.objects.values()].filter((o) => /\/Subtype \/Image\b/.test(o.dict)).length, 500);
  assert.match(checked.pages[0].dict, /\/XObject << \/I0 \d+ 0 R >>/);
  assert.match(checked.pages[500].dict, /\/XObject << \/I0 \d+ 0 R >>/);
  assert.ok(largest < 128 * 1024, `largest emitted chunk ${largest}`);
  assert.ok(peak - before < 64 * 1024 * 1024, `serializer heap growth ${peak - before}`);
  assert.match(pdfText(b) ?? '', /^Page 1\rPage 2\r/);
  assert.match(pdfText(b) ?? '', /Page 501$/);
  const empty: Buffer[] = [];
  writePdf([], (part) => empty.push(part));
  checkPdf(Buffer.concat(empty), 1);
});

test('layout printing keeps Page Setup sheet size and margins for a wide report', () => {
  const part = { kind: 'body', top: 0, height: 80, style: {} } as LayoutPart;
  const object = { id: 1, kind: 'text', type: 2, text: 'Margin check', bounds: { top: 10, left: 10, bottom: 30, right: 190 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} } as LayoutObject;
  const design = { id: 1, name: 'Report', width: 900, parts: [part], objects: [object] } as LayoutDesign;
  const source: PrintSource = {
    field: () => ({ text: '' }), merge: (s) => s, hidden: () => false, conditions: () => [],
    image: () => undefined, portalCount: () => 0, portalRow: () => {},
  };
  const pages = new LayoutPrinter(design, undefined, source, {
    setup: { orientation: 'portrait', width: 612, height: 792, margins: { top: 42, right: 47, bottom: 52, left: 37 } },
  }).print([{ part }]);
  assert.deepEqual([pages[0].width, pages[0].height], [612, 792]);
  const placed = pages[0].ops.find((op) => op.kind === 'text');
  assert.ok(placed && placed.kind === 'text');
  assert.deepEqual([placed.left, placed.top], [47, 52]);
  const b = pdf(pages);
  const checked = checkPdf(b, 1);
  assert.match(checked.pages[0].dict, /\/MediaBox \[0 0 612 792\]/);
});

test('generated list prints sub-summary breaks, portal rows, and container images in order', () => {
  const group = { kind: 'sub-summary-leading', top: 0, height: 40, style: {}, options: { pageBreakBefore: true } } as LayoutPart;
  const body = { kind: 'body', top: 40, height: 650, style: {} } as LayoutPart;
  const bounds = (top: number, bottom: number, left = 10, right = 300) => ({ top, bottom, left, right });
  const anchors = { left: true, top: true, right: false, bottom: false };
  const portalChild = { id: 4, kind: 'field', type: 0, bounds: bounds(107, 127), anchors, style: {}, field: { field: 'PortalLine', display: 'edit' } } as LayoutObject;
  const objects = [
    { id: 1, kind: 'text', type: 2, text: 'Group <<Group>>', bounds: bounds(5, 28), anchors, style: {} },
    { id: 2, kind: 'text', type: 2, text: 'Record <<Name>>', bounds: bounds(50, 80), anchors, style: {} },
    { id: 3, kind: 'portal', type: 0, bounds: bounds(100, 170), anchors, style: {}, portal: { rows: 2, initialRow: 1 }, children: [portalChild] },
    { id: 5, kind: 'field', type: 0, bounds: bounds(200, 260, 10, 100), anchors, style: {}, field: { field: 'Photo', display: 'edit' } },
  ] as LayoutObject[];
  const design = { id: 1, name: 'List', width: 400, parts: [group, body], objects } as LayoutDesign;
  let record = { group: '', name: '' };
  let portalRow: number | undefined;
  const image = png();
  const source: PrintSource = {
    field: (o) => o.field?.field === 'Photo' ? { text: 'photo.png', file: image }
      : { text: o.field?.field === 'PortalLine' ? `Portal ${record.name}.${portalRow}` : '' },
    merge: (s) => s.replace('<<Group>>', record.group).replace('<<Name>>', record.name),
    hidden: () => false, conditions: () => [], image: () => undefined,
    portalCount: () => 2, portalRow: (_o, row) => { portalRow = row; },
  };
  const select = (groupName: string, name: string) => () => { record = { group: groupName, name }; };
  const pages = new LayoutPrinter(design, undefined, source).print([
    { part: group, select: select('A', 'A1') },
    { part: body, select: select('A', 'A1') },
    { part: body, select: select('A', 'A2') },
    { part: group, select: select('B', 'עברית e\u0301 😀') },
    { part: body, select: select('B', 'עברית e\u0301 😀') },
  ]);
  assert.ok(pages.length >= 3);
  const b = pdf(pages);
  const checked = checkPdf(b, pages.length);
  assert.equal([...checked.objects.values()].filter((o) => /\/Subtype \/Image\b/.test(o.dict)).length, 1);
  const extracted = pdfText(b) ?? '';
  assert.ok(extracted.indexOf('Group A') < extracted.indexOf('Record A1'));
  assert.ok(extracted.indexOf('Record A1') < extracted.indexOf('Record A2'));
  assert.ok(extracted.indexOf('Record A2') < extracted.indexOf('Group B'));
  assert.ok(extracted.includes('Portal A1.1') && extracted.includes('Portal A1.2'));
  assert.ok(extracted.includes('Record עברית e\u0301 😀'));
});

test('canceled streaming PDF leaves the destination unchanged and removes staging', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pdf-conformance-'));
  createStore(join(dir, 'data.sqlite'));
  const store = new Store(join(dir, 'data.sqlite'), 'Generated');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }] }]);
  const id = store.create('T', { Name: 'Record' }).recordId;
  const documents = join(dir, 'Documents');
  mkdirSync(documents);
  const original = pdf([{ width: 612, height: 792, ops: [text('Original')] }]);
  writeFileSync(join(documents, 'existing.pdf'), original);
  for (const name of ['new.pdf', 'existing.pdf']) {
    const stop = new AbortController();
    const steps = parseScriptText(`Save Records as PDF [ With dialog: Off ; "${name}" ; Records being browsed ]`, store.schema)
      .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
    const result = await runScript(store, { id: 1, name: 'Print', steps } as Script, {
      layout: 'T', foundSet: [id], documents, stop: stop.signal,
      debug: () => { setImmediate(() => stop.abort()); },
    });
    assert.equal(result.halted, true);
    assert.deepEqual(readdirSync(documents), ['existing.pdf'], 'no new output or staging files');
    assert.deepEqual(readFileSync(join(documents, 'existing.pdf')), original);
  }
});

test('Save Records as PDF writes an atomically replaced, structurally checked file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pdf-conformance-'));
  const bins = join(dir, 'bin');
  const marker = join(dir, 'child-invoked');
  mkdirSync(bins);
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    const stub = join(bins, command);
    writeFileSync(stub, '#!/bin/sh\nprintf invoked > "$PDF_STUB_MARKER"\nexit 99\n');
    chmodSync(stub, 0o755);
  }
  const oldPath = process.env.PATH;
  process.env.PATH = bins;
  process.env.PDF_STUB_MARKER = marker;
  try {
    createStore(join(dir, 'data.sqlite'));
    const store = new Store(join(dir, 'data.sqlite'), 'Generated');
    try {
      store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }, { name: 'Memo' }] }] as never);
      const layout = store.designs().layouts[0];
      const body = layout.parts.find((p) => p.kind === 'body')!;
      store.applyDesign([{ op: 'updateLayout', layout: layout.id, design: {
        parts: [{ ...body, top: 0, height: 700 }],
        objects: [
          { id: 9001, kind: 'text', type: 2, text: 'Record <<Name>>', bounds: { top: 20, left: 20, bottom: 45, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} },
          { id: 9002, kind: 'field', type: 0, field: { field: 'Memo', display: 'edit' }, bounds: { top: 70, left: 20, bottom: 105, right: 300 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} },
        ],
      } }] as never);
      for (const name of ['A', 'B', 'C']) store.create('T', { Name: name, Memo: name === 'A' ? 'x'.repeat(1_048_576) : '' });
      const steps = parseScriptText('Save Records as PDF [ With dialog: Off ; “out.pdf” ; Records being browsed ; Create folders: Off ]', store.schema)
        .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const result = await runScript(store, { id: 1, name: 'Print', steps } as Script, {
        layout: 'T', foundSet: store.findIds('T'), documents: join(dir, 'Documents'),
      });
      assert.equal(result.error, 0);
      const bytes = readFileSync(join(dir, 'Documents', 'out.pdf'));
      checkPdf(bytes, 3);
      assert.ok(bytes.length < 150_000, `clipped field produced ${bytes.length} bytes`);
      assert.match(pdfText(bytes) ?? '', /^Record A\r/);
      assert.match(pdfText(bytes) ?? '', /Record B\rRecord C$/);
      const emptySteps = parseScriptText('Save Records as PDF [ With dialog: Off ; “empty.pdf” ; Records being browsed ; Create folders: Off ]', store.schema)
        .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      const empty = await runScript(store, { id: 2, name: 'Empty', steps: emptySteps } as Script, {
        layout: 'T', foundSet: [], documents: join(dir, 'Documents'),
      });
      assert.equal(empty.error, 0);
      const emptyBytes = readFileSync(join(dir, 'Documents', 'empty.pdf'));
      checkPdf(emptyBytes, 1);
      assert.doesNotMatch(pdfText(emptyBytes) ?? '', /Record /);
    } finally { store.close(); }
    assert.equal(existsSync(marker), false, 'no forbidden child process ran');
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    delete process.env.PDF_STUB_MARKER;
    rmSync(dir, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { num, text } from '../../calc/src/index.ts';
import { pdfText, pdfPageCount, readPdfImport } from '../../calc/src/pdf-text.ts';
import { dynapdfCall } from '../src/dynapdf.ts';
import { appendPdf, pdf } from '../src/pdf.ts';

/** How the PDF writer spells a text string: UTF-16BE hex with a byte order mark. */
const utf16 = (s: string) => `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()}>`;

test('PDF metadata preserves string titles and document fields with the Tabularius producer', () => {
  for (const metadata of ['Legacy title', { Title: 'Document title', Author: 'Author', Producer: 'Override' }]) {
    const output = pdf([], metadata).toString('latin1');
    assert.match(output, /\/Producer \(Tabularius\)/);
    assert.equal((output.match(/\/Producer /g) ?? []).length, 1);
    if (typeof metadata === 'string') assert.match(output, new RegExp(`/Title ${utf16('Legacy title')}`));
    else {
      assert.match(output, new RegExp(`/Title ${utf16('Document title')}`));
      assert.match(output, new RegExp(`/Author ${utf16('Author')}`));
      assert.ok(!output.includes('Override') && !output.includes(utf16('Override')));
    }
  }
});

// Every input starts with stage 1 output; changes below rebuild offsets instead of masking malformed xrefs.
function source(): Buffer {
  const s = {};
  dynapdfCall('DynaPDF.Initialize', [], s);
  const h = dynapdfCall('DynaPDF.New', [], s)!;
  const call = (f: string, ...a: Parameters<typeof dynapdfCall>[1]) => dynapdfCall(`DynaPDF.${f}`, [h, ...a], s)!;
  call('SetPageWidth', num(300)); call('SetPageHeight', num(400)); call('AppendPage');
  call('WriteFTextEx', num(10), num(40), num(260), num(40), text('left'), text('Inherited'));
  const v = call('Save');
  assert.ok(v.type === 'container' && v.data);
  return Buffer.from(v.data);
}
function bodies(b: Buffer): string[] {
  const s = b.toString('latin1');
  const xref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)![1]);
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n /gm)].map(m => Number(m[1]));
  return offsets.map((at, i) => s.slice(at, offsets[i + 1] ?? xref).replace(/^\d+ 0 obj\s*/, '').replace(/\s*endobj\s*$/, ''));
}
function rebuild(objects: string[], trailer = ''): Buffer {
  let s = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const at = s.length;
  s += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  s += offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  s += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
function stream(data: string, dict = ''): string { return `<< /Length ${data.length} ${dict} >>\nstream\n${data}\nendstream`; }
const image = '\x00\xff999 0 R endobj\x80';
function inherited(): Buffer {
  const objects = bodies(source());
  const page = objects.findIndex(o => /\/Type \/Page\b/.test(o));
  const resources = /\/Resources (<<.*>>)(?= \/Contents)/.exec(objects[page])![1];
  const content = /\/Contents (\d+ 0 R)/.exec(objects[page])![1];
  const imageId = objects.push(stream(image, '/Type /XObject /Subtype /Image /Width 6 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8'));
  const resourceId = objects.push(resources.replace(/>>$/, `/XObject << /Shared ${imageId} 0 R >> >>`));
  const extraId = objects.push(stream('BT /F1 12 Tf 10 10 Td (Array tail) Tj ET'));
  const secondId = objects.length + 1;
  objects.push(`<< /Type /Page /Parent 2 0 R /Contents ${content} >>`);
  objects[1] = `<< /Type /Pages /Count 2 /Kids [${page + 1} 0 R ${secondId} 0 R] /MediaBox [0 0 300 400] /Rotate 90 /Resources ${resourceId} 0 R >>`;
  objects[page] = `<< /Type /Page /Parent 2 0 R /Contents [${content} ${extraId} 0 R] >>`;
  return rebuild(objects);
}

test('copying imports preserves inherited attributes, stream arrays and shared font/image objects', () => {
  const imported = readPdfImport(inherited()); assert.ok(imported);
  const result = pdf(imported.map(p => ({ width: p.width, height: p.height, ops: [], imported: p })));
  assert.equal(pdfPageCount(result), 2);
  assert.equal(pdfText(result), 'Inherited\rArray tail\rInherited');
  const out = bodies(result);
  const pages = out.filter(o => /\/Type\s*\/Page\b/.test(o));
  for (const p of pages) {
    assert.match(p, /\/MediaBox\s*\[0 0 300 400\]/); assert.match(p, /\/Rotate\s*90/);
    assert.match(p, /\/Resources/);
  }
  assert.match(pages[0], /\/Contents\s*\[/);
  assert.equal(out.filter(o => /\/Subtype\s*\/Image/.test(o)).length, 1);
  assert.equal(out.filter(o => /\/Type\s*\/Font\b/.test(o)).length, 1);
  assert.ok(result.includes(Buffer.from(image, 'latin1')), 'stream bytes are not reference-rewritten');
});

test('appendPdf can copy imported pages without inheriting the destination tree attributes', () => {
  const imported = readPdfImport(inherited()); assert.ok(imported);
  const initial = source();
  const result = Buffer.concat([initial, appendPdf(initial, imported.map(p => ({ width: p.width, height: p.height, ops: [], imported: p })))]);
  assert.equal(pdfPageCount(result), 3);
  assert.equal(pdfText(result), 'Inherited\rInherited\rArray tail\rInherited');
  assert.ok(result.includes(Buffer.from(image, 'latin1')));
});

test('strict imports refuse encrypted, malformed, dangling, external and unsupported document objects', () => {
  const original = bodies(source());
  const page = original.findIndex(o => /\/Type \/Page\b/.test(o));
  const changed = (index: number, change: (v: string) => string) => { const a = [...original]; a[index] = change(a[index]); return rebuild(a); };
  const cases = [
    rebuild(original, '/Encrypt << /Filter /Standard >>'),
    changed(page, p => p.replace(/\/Contents \d+ 0 R/, '/Contents 99999 0 R')),
    changed(1, p => p.replace(/\/Kids \[[^\]]*\]/, '/Kids [2 0 R]')),
    changed(page, p => p.replace(/\/MediaBox \[[^\]]*\]/, '/MediaBox [0 0 0 0]')),
    changed(page, p => p.replace(' /Contents', ' /AA << /O << /S /URI /URI (http://127.0.0.1:1/) >> >> /Contents')),
    changed(0, p => p.replace(' /Pages', ' /AcroForm << >> /Pages')),
    changed(original.length - 2, p => p.replace('/Length ', '/F (external.pdf) /Length ')),
    source().subarray(0, source().length - 10),
    Buffer.from(source().toString('latin1').replace(/startxref\n\d+/, 'startxref\n1'), 'latin1'),
  ];
  for (const input of cases) assert.equal(readPdfImport(input), undefined);
});

test('strict import caps cover byte size, object count, nesting and decompression', () => {
  assert.equal(readPdfImport(Buffer.alloc(16 * 1024 * 1024 + 1)), undefined);
  const original = bodies(source());
  assert.equal(readPdfImport(rebuild([...original, ...Array.from({ length: 10001 }, () => 'null')])), undefined);
  const deep = [...original]; deep.push('['.repeat(70) + '0' + ']'.repeat(70));
  assert.equal(readPdfImport(rebuild(deep)), undefined);
  const bomb = [...original];
  bomb[bomb.length - 2] = stream(deflateSync(Buffer.alloc(8 * 1024 * 1024 + 1)).toString('latin1'), '/Filter /FlateDecode');
  assert.equal(readPdfImport(rebuild(bomb)), undefined);
});

test('malformed inherited attributes are refused instead of falling back or being serialized', () => {
  const good = bodies(inherited());
  const page = good.findIndex(o => /\/Type \/Page\b/.test(o));
  for (const addition of ['/Resources 0', '/Resources [1 2]', '/CropBox [0 0 -1 40]', '/MediaBox [0 0 1e2 400]', '/Rotate 91']) {
    const changed = [...good]; changed[page] = changed[page].replace(' /Contents', ` ${addition} /Contents`);
    assert.equal(readPdfImport(rebuild(changed)), undefined, addition);
  }
});

test('AppendPage after importing retains the prior page size and crop box', () => {
  const objects = bodies(inherited());
  objects[1] = objects[1].replace('/Rotate 90', '/Rotate 90 /CropBox [5 10 290 380]');
  const s = {};
  dynapdfCall('DynaPDF.Initialize', [], s);
  const h = dynapdfCall('DynaPDF.New', [], s)!;
  const call = (f: string, ...a: Parameters<typeof dynapdfCall>[1]) => dynapdfCall(`DynaPDF.${f}`, [h, ...a], s)!;
  call('OpenPDFFromContainer', { type: 'container', value: 'generated.pdf', data: rebuild(objects) });
  call('ImportPDFPage', num(1)); call('AppendPage');
  const v = call('Save'); assert.ok(v.type === 'container' && v.data);
  const pages = bodies(Buffer.from(v.data)).filter(o => /\/Type\s*\/Page\b/.test(o));
  assert.equal(pages.length, 2);
  assert.match(pages[1], /\/MediaBox\s*\[0 0 300 400\]/);
  assert.match(pages[1], /\/CropBox\s*\[5 10 290 380\]/);
});

test('repeated selections share resources while documents with colliding object ids remain independent', () => {
  const a = readPdfImport(inherited())!, b = readPdfImport(source())!;
  assert.ok(a && b);
  const result = pdf([a[0], b[0], a[0]].map(p => ({ width: p.width, height: p.height, ops: [], imported: p })));
  assert.equal(pdfText(result), 'Inherited\rArray tail\rInherited\rInherited\rArray tail');
  const objects = bodies(result);
  assert.equal(objects.filter(o => /\/Subtype\s*\/Image/.test(o)).length, 1);
  assert.equal(objects.filter(o => /\/Type\s*\/Font\b/.test(o)).length, 2);
});

test('classic incremental output is importable and malformed stream lengths are refused', () => {
  const initial = source();
  const appended = Buffer.concat([initial, appendPdf(initial, [{ width: 100, height: 200, ops: [] }])]);
  assert.equal(readPdfImport(appended)?.length, 2);
  const objects = bodies(initial);
  objects[objects.length - 2] = objects[objects.length - 2].replace(/\/Length \d+/, '/Length 99999');
  assert.equal(readPdfImport(rebuild(objects)), undefined);
});

test('accumulated source object caps reject replacement atomically and release frees the handle', () => {
  const originals = bodies(source());
  const input = rebuild([...originals, ...Array.from({ length: 5100 }, () => 'null')]);
  const s = {};
  dynapdfCall('DynaPDF.Initialize', [], s);
  const h = dynapdfCall('DynaPDF.New', [], s)!;
  const call = (f: string, ...a: Parameters<typeof dynapdfCall>[1]) => dynapdfCall(`DynaPDF.${f}`, [h, ...a], s)!;
  const container = { type: 'container' as const, value: 'generated.pdf', data: input };
  assert.equal(call('OpenPDFFromContainer', container).type, 'number');
  assert.equal(call('ImportPDFPage', num(1)).value, 'OK');
  const before = call('Save'); assert.ok(before.type === 'container' && before.data);
  assert.match(String(call('OpenPDFFromContainer', container).value), /^\[MBS\] ERROR:/);
  assert.equal(call('GetImportPageCount').value, 1);
  const after = call('Save'); assert.ok(after.type === 'container' && after.data);
  assert.deepEqual(after.data, before.data);
  assert.equal(call('Release').value, 'OK');
  assert.equal(call('ImportPDFPage', num(1)).value, '?');
});

test('import owns its bytes, supports indirect stream lengths, and refuses encrypted containers through the API', () => {
  const objects = bodies(source());
  const streamIndex = objects.length - 2;
  const length = /\/Length (\d+)/.exec(objects[streamIndex])![1];
  const lengthId = objects.push(length);
  objects[streamIndex] = objects[streamIndex].replace(/\/Length \d+/, `/Length ${lengthId} 0 R`);
  const data = rebuild(objects);
  const imported = readPdfImport(data); assert.ok(imported);
  data.fill(0);
  assert.equal(pdfText(pdf(imported.map(p => ({ width: p.width, height: p.height, ops: [], imported: p })))), 'Inherited');
  const s = {};
  dynapdfCall('DynaPDF.Initialize', [], s);
  const h = dynapdfCall('DynaPDF.New', [], s)!;
  const result = dynapdfCall('DynaPDF.OpenPDFFromContainer', [h, { type: 'container', value: 'generated.pdf', data: rebuild(objects, '/Encrypt << /Filter /Standard >>') }], s)!;
  assert.equal(result.value, '[MBS] ERROR: DynaPDF.OpenPDFFromContainer is not available in Tabularius');
});

test('copied PDF numbers remain decimal and retain small page dimensions', () => {
  const objects = bodies(source());
  const page = objects.findIndex(o => /\/Type \/Page\b/.test(o));
  objects[page] = objects[page].replace('/MediaBox [0 0 300 400]', '/MediaBox [0 0 0.0000001 400]');
  const imported = readPdfImport(rebuild(objects)); assert.ok(imported);
  const result = pdf(imported.map(p => ({ width: p.width, height: p.height, ops: [], imported: p })));
  assert.equal(readPdfImport(result)?.[0].width, 0.0000001);
});

test('output amplification is capped before an import commits any pages or closes the current page', () => {
  const objects = bodies(source());
  const firstPage = objects.findIndex(o => /\/Type \/Page\b/.test(o));
  const page = objects[firstPage];
  const resources = /\/Resources (<<.*>>)(?= \/Contents)/.exec(page)![1];
  const resourceId = objects.push(resources.replace(/>>$/, `/Private (${ 'x'.repeat(60000) }) >>`));
  objects[firstPage] = page.replace(/\/Resources <<.*>>(?= \/Contents)/, '');
  const ids = [firstPage + 1];
  for (let i = 1; i < 160; i++) ids.push(objects.push(objects[firstPage]));
  objects[1] = `<< /Type /Pages /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] /Count 160 /Resources ${resourceId} 0 R >>`;
  const s = {};
  dynapdfCall('DynaPDF.Initialize', [], s);
  const h = dynapdfCall('DynaPDF.New', [], s)!;
  const call = (f: string, ...a: Parameters<typeof dynapdfCall>[1]) => dynapdfCall(`DynaPDF.${f}`, [h, ...a], s)!;
  assert.equal(call('OpenPDFFromContainer', { type: 'container', value: 'generated.pdf', data: rebuild(objects) }).type, 'number');
  call('AppendPage');
  assert.match(String(call('ImportPDFFile', num(2)).value), /^\[MBS\] ERROR: .* is not available in Tabularius$/);
  assert.equal(call('GetPageCount').value, 1);
  assert.equal(call('Rectangle', num(0), num(0), num(1), num(1), text('fill')).value, 'OK');
});

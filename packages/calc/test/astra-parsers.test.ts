import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import { knownJavaScript } from '../src/bejs.ts';
import { evaluateText } from '../src/index.ts';
import { parseXmlDocument } from '../src/xpath.ts';
import { canonicalXml, tidyXml } from '../src/xmltools.ts';
import { applyXslt } from '../src/xslt.ts';
import { zip, unzip } from '../src/zip.ts';

const quote = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const program = (vars: Record<string, unknown>, body: string) =>
  Object.entries(vars).map(([k, v]) => `var ${k} = ${typeof v === 'string' ? quote(v) : JSON.stringify(v)} ;`).join('\r') + '\r\r' + body;

test('AR-calc-extensions-01', () => {
  const sentinel = 'tabulariusJsonSentinel';
  try {
    for (const path of [`__proto__.${sentinel}`, `constructor.prototype.${sentinel}`, `a.__proto__.${sentinel}`]) {
      const js = program({ json: {}, keyOrIndexOrPath: path, newValue: 7 }, 'var r = modify(json, keyOrIndexOrPath, newValue);');
      const result = evaluateText(`BE_EvaluateJavaScript ( ${quote(js)} )`);
      assert.equal(Object.hasOwn(Object.prototype, sentinel), false);
      let value = JSON.parse(result);
      for (const key of path.split('.')) { assert.ok(Object.hasOwn(value, key)); value = value[key]; }
      assert.equal(value, 7);
    }
  } finally { Reflect.deleteProperty(Object.prototype, sentinel); }
});

test('AR-calc-extensions-01 / 2', () => {
  const source = JSON.parse('{"__proto__":{"tabulariusJsonSentinel":7},"constructor":8}');
  const result = knownJavaScript(program({ target: {}, source }, 'Object.assign(target, source)'))!;
  assert.deepEqual(JSON.parse(result), source);
  assert.equal(evaluateText('BE_JSONPath ( "{}" ; "$.__proto__" )'), '?');
  assert.equal(evaluateText('BE_JSONPath ( "{}" ; "$.constructor" )'), '?');
  assert.equal(Object.hasOwn(Object.prototype, 'tabulariusJsonSentinel'), false);
});

test('AR-calc-extensions-01 / 3', () => {
  const json = JSON.parse('{"__proto__":{"x":1},"constructor":2,"prototype":3}');
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const cases: [Record<string, unknown>, string, string][] = [
    [{ json, whiteSpace: '' }, 'JSON.stringify(json, null , whiteSpace)', JSON.stringify(json, null, '  ')],
    [{ json }, 'var keys = Object.keys(json); outArray.push(value)', '{"x":1}\r2\r3'],
    [{ json }, 'var keys = Object.keys(json); keys.join(', '__proto__\rconstructor\rprototype'],
    [{ json, keyOrIndex: '__proto__' }, 'json.splice(keyOrIndex,1) delete json[keyOrIndex]', '{"constructor":2,"prototype":3}'],
    [{ target: {}, source: json }, 'Object.assign(target, source)', JSON.stringify(json)],
    [{ json, keyOrIndexOrPath: '__proto__.x', newValue: 9 }, 'var r = modify(json, keyOrIndexOrPath, newValue);', '{"__proto__":{"x":9},"constructor":2,"prototype":3}'],
  ];
  for (const [vars, body, expected] of cases) {
    assert.equal(knownJavaScript(program(vars, body)), expected);
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  }
  Object.defineProperty(Object.prototype, 'tabulariusJsonList', { value: [1, 2], configurable: true });
  try {
    assert.equal(evaluateText('BE_JSON_ArraySize ( "{}" ; "tabulariusJsonList" )'), '0');
    assert.equal(evaluateText('BE_JSONPath ( "{}" ; "$.tabulariusJsonList" )'), '?');
  } finally { Reflect.deleteProperty(Object.prototype, 'tabulariusJsonList'); }
});

test('AR-calc-extensions-11', () => {
  const module = new URL('../src/pdf-text.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pdfPageCount, pdfProblem, pdfPageRange, pdfMerge, pdfText } from ${JSON.stringify(module)};
    import { evaluate, evaluateText } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
    const make = n => Buffer.from('%PDF-1.7\\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n2 0 obj << /Type /Pages /Kids [' + Array.from({length:n}, (_,i) => (i+3)+' 0 R').join(' ') + '] /Count '+n+' >> endobj\\n' + Array.from({length:n}, (_,i) => (i+3)+' 0 obj << /Type /Page /Parent 2 0 R >> endobj\\n').join('') + 'trailer << /Root 1 0 R >>\\n%%EOF');
    const bytes = make(5001);
    assert.equal(pdfProblem(bytes), 'limit');
    for (const read of [pdfPageCount, pdfText, b => pdfPageRange(b,1), b => pdfPageRange(b,1,1), b => pdfMerge([b])]) {
      assert.throws(() => read(bytes), e => e.name === 'PdfLimitError');
    }
    const exact = make(5000);
    assert.equal(pdfPageCount(exact), 5000);
    assert.equal(pdfPageCount(pdfPageRange(exact,1)), 5000);
    assert.throws(() => pdfMerge([exact, make(1)]), e => e.name === 'PdfLimitError');
    let writes = 0;
    const ctx = { variable: () => ({ type:'container', value:'large.pdf', data:bytes }), files: { read: () => bytes, size: () => bytes.length, write: () => { writes++; return true; } } };
    for (const expression of ['GetTextFromPDF ($pdf)', 'BE_PDFPageCount ($pdf)', 'BE_PDFGetPages ($pdf; "out.pdf"; 1)', 'BE_PDFGetPages ("in.pdf"; "out.pdf"; 1; 1)']) {
      for (const run of [evaluate, evaluateText]) assert.throws(() => run(expression, ctx), e => e.name === 'PdfLimitError');
    }
    assert.equal(writes, 0);
    const deep = Buffer.from('%PDF-1.7\\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n' + Array.from({length:66}, (_,i) => (i+2)+' 0 obj << /Type /Pages /Kids ['+(i+3)+' 0 R] >> endobj\\n').join('') + '68 0 obj << /Type /Page >> endobj\\ntrailer << /Root 1 0 R >>');
    assert.equal(pdfProblem(deep), 'limit');
    for (const read of [pdfPageCount, pdfText, b => pdfPageRange(b,1), b => pdfMerge([b])]) assert.throws(() => read(deep), e => e.name === 'PdfLimitError');
  `], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

for (const [i, xml] of ['<r>\u0001</r>', '<r><!--a--b--></r>', '<r xmlns:a="urn:x" xmlns:b="urn:x" a:k="1" b:k="2"/>'].entries()) {
  test(`AR-calc-extensions-12 / ${i + 1}`, () => {
    assert.throws(() => parseXmlDocument(xml));
    assert.throws(() => canonicalXml(xml));
    assert.throws(() => tidyXml(xml));
    assert.throws(() => applyXslt(xml, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"><xsl:template match="/"><r/></xsl:template></xsl:stylesheet>'));
    assert.match(evaluateText(`BE_XMLParse ( ${quote(xml)} )`), /XML/);
    assert.equal(evaluateText(`BE_XPath ( ${quote(xml)} ; "count(/*)" )`), '?');
    assert.match(evaluateText(`MBS ( "XML.Parse" ; ${quote(xml)} )`), /ERROR/);
  });
}

test('AR-calc-extensions-12 / 4', () => {
  for (const value of ['\u0000', '\u000b', '\ud800', '\udfff', '\ufffe', '\uffff']) {
    for (const xml of [`<r>${value}</r>`, `<r a="${value}"/>`, `<r><![CDATA[${value}]]></r>`, `<r><!--${value}--></r>`, `<?p ${value}?><r/>`]) {
      assert.throws(() => parseXmlDocument(xml));
    }
  }
  assert.throws(() => parseXmlDocument('<r><!--a---></r>'));
  for (const xml of ['<r>\t\n\r\u0020\ud7ff\ue000\ufffd😀</r>', '<r><!--a-b--></r>', '<r xmlns:a="urn:a" xmlns:b="urn:b" a:k="1" b:k="2" k="3"/>', '<r xmlns="urn:a" xmlns:a="urn:a" a:k="1" k="2"/>']) {
    assert.doesNotThrow(() => parseXmlDocument(xml));
  }
});

test('AR-calc-extensions-13', () => {
  const xml = '<?before x?><r><?inside y?></r><?after z?>';
  const expected = '<?before x?>\n<r><?inside y?></r>\n<?after z?>';
  for (const comments of [false, true]) assert.equal(canonicalXml(xml, comments), expected);
  assert.equal(evaluateText(`BE_XMLCanonical ( ${quote(xml)} )`), expected);
  for (const flags of [0, 2]) assert.equal(evaluateText(`MBS ( "XML.Canonical" ; ${quote(xml)} ; ${flags} )`), expected);
  const mixed = '<?xml version="1.0"?><?a?><!--pre--><?b a&b?><r><!--inner--><?c x\r\ny?></r><?d?><!--post-->';
  assert.equal(canonicalXml(mixed, true), '<?a?>\n<!--pre-->\n<?b a&b?>\n<r><!--inner--><?c x\ny?></r>\n<?d?>\n<!--post-->');
  assert.equal(canonicalXml(mixed, false), '<?a?>\n<?b a&b?>\n<r><?c x\ny?></r>\n<?d?>');
  for (const value of ['\u00a0x', '\u2028x', 'x  ', 'x&y<z']) {
    const expected = `<r><?p ${value}?></r>`;
    assert.equal(canonicalXml(expected), expected);
    assert.equal(canonicalXml(canonicalXml(expected)), expected);
  }
});

test('AR-calc-extensions-14', () => {
  const bytes = Buffer.from(zip([{ name: 'a', data: Buffer.from('hello') }]));
  const central = bytes.readUInt32LE(bytes.length - 6);
  bytes.writeUInt32LE(123, 14);
  bytes.writeUInt32LE(123, central + 16);
  assert.throws(() => unzip(bytes), /damaged|checksum|CRC/i);
});

test('AR-calc-extensions-14 / 2', () => {
  for (const offset of [6, 8, 14, 18, 22, 30]) {
    const bytes = Buffer.from(zip([{ name: 'a', data: Buffer.from('hello') }]));
    bytes[offset] ^= 1;
    assert.throws(() => unzip(bytes), /damaged|incorrect/);
  }
  const original = Buffer.from(zip([{ name: 'a', data: Buffer.from('hello') }]));
  const central = original.readUInt32LE(original.length - 6);
  for (const signed of [false, true]) {
    const local = Buffer.from(original.subarray(0, central));
    const tail = Buffer.from(original.subarray(central));
    const descriptor = Buffer.alloc(signed ? 16 : 12);
    const offset = signed ? 4 : 0;
    if (signed) descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(crc32(Buffer.from('hello')), offset);
    descriptor.writeUInt32LE(local.readUInt32LE(18), offset + 4);
    descriptor.writeUInt32LE(5, offset + 8);
    local.writeUInt16LE(local.readUInt16LE(6) | 8, 6);
    local.fill(0, 14, 26);
    tail.writeUInt16LE(tail.readUInt16LE(8) | 8, 8);
    tail.writeUInt32LE(central + descriptor.length, tail.length - 6);
    const bytes = Buffer.concat([local, descriptor, tail]);
    assert.equal(Buffer.from(unzip(bytes)[0].data).toString(), 'hello');
    bytes[central + offset] ^= 1;
    assert.throws(() => unzip(bytes), /descriptor/);
  }
});

test('AR-calc-extensions-14 / 3', () => {
  const bytes = Buffer.from(zip([{ name: 'a', data: Buffer.from('hello') }, { name: 'b', data: Buffer.from('world') }]));
  const central = bytes.readUInt32LE(bytes.length - 6);
  const second = central + 47;
  const local = bytes.readUInt32LE(second + 42);
  bytes.writeUInt32LE(123, local + 14);
  bytes.writeUInt32LE(123, second + 16);
  let writes = 0;
  const ctx = { files: { read: () => bytes, size: () => bytes.length, write: () => { writes++; return true; } } };
  for (const name of ['BE_Unzip', 'BE_Unzip_Deprecated']) {
    assert.equal(evaluateText(`${name} ( "in.zip" ; "out" )`, ctx), '?');
    assert.match(evaluateText('BE_JSON_Error_Description', ctx), /checksum/);
  }
  assert.equal(writes, 0);
});

test('AR-calc-extensions-15', () => {
  assert.equal(evaluateText('MBS ( "Text.Length" ; "abc" )'), '3');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.doesNotMatch(readme, /Plug-in functions are not available/);
  assert.match(readme, /MBS/);
  assert.match(readme, /BaseElements/);
});

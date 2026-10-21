import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const prelude = `
import assert from 'node:assert/strict';
import { pdfText } from './packages/calc/src/pdf-text.ts';
import { evaluateText, NameTable } from './packages/calc/src/index.ts';
import { runJq } from './packages/calc/src/jq.ts';
const limit = /resource limit|too large|too many|invalid CID/i;
`;
function child(code: string): void {
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', prelude + code], {
    cwd: new URL('../../../', import.meta.url), timeout: 12_000, encoding: 'utf8', maxBuffer: 64_000,
  });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.status, 0, r.stderr);
}

test('AR-calc-extensions-02', () => child(`
function pdf(first, extra = [], fontCount = 1) {
  const cmap = '1 beginbfchar <0041> <0041> endbfchar';
  const content = Array.from({length: fontCount}, (_,i) => 'BT /F'+i+' 12 Tf <0041> Tj ET').join(' ');
  const fonts = Array.from({length: fontCount}, (_,i) => '/F'+i+' '+(6+i)+' 0 R').join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << '+fonts+' >> >> /Contents 5 0 R >>',
    '<< /Length '+cmap.length+' >>\\nstream\\n'+cmap+'\\nendstream',
    '<< /Length ' + content.length + ' >>\\nstream\\n' + content + '\\nendstream',
  ];
  for (let i = 0; i < fontCount; i++) objects.push('<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 4 0 R /DescendantFonts [<< /DW 1000 /W [' + (extra.length ? extra.join(' ') : first + ' ' + first + ' 500') + '] >>] >>');
  let out = '%PDF-1.4\\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i++) { offsets.push(out.length); out += (i + 1) + ' 0 obj\\n' + objects[i] + '\\nendobj\\n'; }
  const at = out.length;
  out += 'xref\\n0 ' + (objects.length + 1) + '\\n0000000000 65535 f \\n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \\n').join('');
  out += 'trailer\\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + at + '\\n%%EOF';
  return Buffer.from(out);
}
assert.equal(pdfText(pdf(65)), 'A');
// Non-numeric or truncated /W entries stop width parsing but preserve extraction.
for (const widths of ['(bad) 65 500', '65 (bad) 500', '65 65 (bad)', '65', '65 65', '65 [500 (bad)]', '65 65 500 (bad)', '(bad) 9007199254740992 0']) {
  assert.equal(pdfText(pdf(0, [widths])), 'A', widths);
}
for (const first of [2 ** 53, -1, 0.5, 65536, '9'.repeat(400)]) assert.throws(() => pdfText(pdf(first)), limit);
for (const last of [2 ** 53, -1, 0.5, 65536, '9'.repeat(400)]) assert.throws(() => pdfText(pdf(0, ['65 ' + last + ' (bad)'])), limit);
for (const widths of [['65 64 500'], ['65535 [500 500]'], Array(40).fill('0 65535 500')]) assert.throws(() => pdfText(pdf(0, widths)), limit);
assert.throws(() => pdfText(pdf(0, ['0 65535 500'], 40)), limit);
const data = pdf(2 ** 53);
const ctx = { names: new NameTable({fields: ['PDF']}), field: () => ({ type: 'container', value: 'sample.pdf', data }) };
assert.throws(() => evaluateText('GetTextFromPDF ( PDF )', ctx), limit);
assert.throws(() => evaluateText('IsValid ( GetTextFromPDF ( PDF ) )', ctx), limit);
assert.equal(pdfText(pdf(65)), 'A');
`));

test('AR-calc-extensions-03', () => child(`
const xml = '<r>' + '<n>1</n>'.repeat(75000) + '</r>';
const ctx = { names: new NameTable({ fields: ['Source'] }), field: () => ({ type: 'text', value: xml }) };
const start = performance.now();
const value = evaluateText('BE_XPath ( Source ; "/r/n < /r/n" )', ctx);
assert.ok(performance.now() - start < 4000);
assert.ok(value === 'false' || value === '?', value);
if (value === '?') assert.match(evaluateText('BE_JSON_Error_Description ()', ctx), limit);
`));

test('AR-calc-extensions-04', () => child(`
const xml = '<r><s>' + 'x'.repeat(8100) + '</s>' + '<n/>'.repeat(1000) + '</r>';
const style = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/><xsl:template match="/"><xsl:for-each select="r/n"><xsl:value-of select="/r/s"/></xsl:for-each></xsl:template></xsl:stylesheet>';
const ctx = { names: new NameTable({ fields: ['Source', 'Style'] }), field: ref => ({ type: 'text', value: ref.field === 'Source' ? xml : style }) };
assert.throws(() => evaluateText('BE_XSLT_ApplyInMemory ( Source ; Style )', ctx), limit);
assert.throws(() => evaluateText('IsValid ( BE_XSLT_ApplyInMemory ( Source ; Style ) )', ctx), limit);
`));

test('AR-calc-extensions-05 intermediate', () => child(`
assert.throws(() => runJq('null', 'reduce range(24) as $i ("a"; . + .) | length'), limit);
`));

test('AR-calc-extensions-05 output', () => child(`
const ctx = { names: new NameTable({ fields: ['Source'] }), field: () => ({ type: 'text', value: JSON.stringify('x'.repeat(8100)) }) };
assert.throws(() => evaluateText('BE_JSON_jq ( Source ; ". as $s | range(1000) | $s" ; "r" )', ctx), limit);
`));

test('AR-calc-extensions-03 axes and compilation', () => child(`
const { parseXmlDocument, evaluateXPath, compileXPath, compilePattern } = await import('./packages/calc/src/xpath.ts');
const doc = parseXmlDocument('<r>' + '<n/>'.repeat(4000) + '</r>');
for (const path of ['/r/n[../n = ../n]', '/r/n/following-sibling::n', '/r/n/preceding::n', '/r/n/preceding-sibling::n']) {
  assert.throws(() => evaluateXPath(doc, path), limit);
}
for (const expression of ['('.repeat(200) + '1' + ')'.repeat(200), '-'.repeat(1000) + '1', '1+'.repeat(15000) + '1']) {
  assert.throws(() => compileXPath(expression, new Map()), limit);
  assert.throws(() => compilePattern(expression, new Map()), limit);
}
assert.deepEqual(evaluateXPath(parseXmlDocument('<r/>'), '1+1'), { type: 'number', value: 2 });
`));

test('AR-calc-extensions-03 values', () => child(`
const { parseXmlDocument, evaluateXPath, xpathValues } = await import('./packages/calc/src/xpath.ts');
for (const [left, right] of [['', ''], ['bad', '1'], ['1', 'bad'], ['bad', 'bad'], ['-2 0 9 bad', '0 4 bad'], ['1', '1']]) {
  const a = left ? left.split(' ') : [], b = right ? right.split(' ') : [];
  const doc = parseXmlDocument('<r>' + a.map(x => '<a>'+x+'</a>').join('') + b.map(x => '<b>'+x+'</b>').join('') + '</r>');
  for (const op of ['<','<=','>','>=']) {
    const expected = a.some(x => b.some(y => op === '<' ? Number(x) < Number(y) : op === '<=' ? Number(x) <= Number(y) : op === '>' ? Number(x) > Number(y) : Number(x) >= Number(y)));
    assert.deepEqual(evaluateXPath(doc, '/r/a ' + op + ' /r/b'), { type: 'boolean', value: expected });
  }
}
const doc = parseXmlDocument('<r>' + 'x'.repeat(50000) + '</r>');
assert.throws(() => evaluateXPath(doc, 'concat(' + Array(200).fill('/r').join(',') + ')'), limit);
const shared = parseXmlDocument('<r>' + 'x'.repeat(8100) + '</r>').children[0];
assert.throws(() => xpathValues({type: 'nodeset', nodes: Array(1000).fill(shared)}), limit);
`));

test('AR-calc-extensions-04 trees and serialization', () => child(`
const { applyXslt } = await import('./packages/calc/src/xslt.ts');
const style = (body, method = 'text') => '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="'+method+'"/><xsl:template match="/">'+body+'</xsl:template></xsl:stylesheet>';
const xml = '<r><s>' + 'x'.repeat(8100) + '</s>' + '<n/>'.repeat(1000) + '</r>';
assert.throws(() => applyXslt(xml, style('<xsl:variable name="temp"><xsl:for-each select="r/n"><xsl:value-of select="/r/s"/></xsl:for-each></xsl:variable>ok')), limit);
assert.throws(() => applyXslt('<r>' + '<n/>'.repeat(1000) + '</r>', style('<xsl:for-each select="r/n"><xsl:for-each select="/r/n"><a/></xsl:for-each></xsl:for-each>')), limit);
for (const method of ['xml', 'html']) {
  const source = '<r><s>' + '&amp;'.repeat(810) + '</s>' + '<n/>'.repeat(2000) + '</r>';
  assert.throws(() => applyXslt(source, style('<out><xsl:for-each select="r/n"><xsl:value-of select="/r/s"/></xsl:for-each></out>', method)), limit);
}
assert.equal(applyXslt('<r/>', style('ok')), 'ok');
`));

test('AR-calc-extensions-04 rules', () => child(`
const { applyXslt } = await import('./packages/calc/src/xslt.ts');
const style = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">' + Array.from({length: 5000}, (_,i) => '<xsl:template match="u'+i+'"/>').join('') + '</xsl:stylesheet>';
assert.throws(() => applyXslt('<r>' + '<n/>'.repeat(5000) + '</r>', style), limit);
`));

test('AR-calc-extensions-05 allocations', () => child(`
for (const filter of [
  'reduce range(24) as $i ("a"; . + .) | length',
  'try (reduce range(24) as $i ("a"; . + .)) catch "caught"',
  'try last(range(1e12)) catch "caught"',
  '[range(2000000)] | length',
  'map(range(2000000)) | length',
  'reduce range(24) as $i ([0]; . + .) | length',
  '.[3000000] = 1 | length',
  '[[range(2000)], range(2000)] | transpose | length',
]) assert.throws(() => runJq('[1]', filter), limit);
for (const [input, filter] of [
  ['&'.repeat(1700000), '@html | null'],
  ["'".repeat(2100000), '@sh | null'],
  ['x'.repeat(6100000), '@base64 | null'],
  [Array(1000).fill('x'.repeat(8100)), 'join("") | length'],
]) assert.throws(() => runJq(JSON.stringify(input), filter), limit);
assert.equal(runJq('null', 'try error("ordinary") catch .', {raw: true}), 'ordinary');
assert.equal(runJq('[1,2]', 'map(.+1)', {compact: true}), '[2,3]');
assert.equal(runJq(JSON.stringify('x'.repeat(2000000)), 'length'), '2000000');
`));

test('AR-calc-extensions-05 serialization', () => child(`
const input = JSON.stringify('x'.repeat(8100));
for (const options of [{raw:true}, {raw:true,join:true}, {compact:true}, {}]) {
  assert.throws(() => runJq(input, '. as $s | range(1000) | $s', options), limit);
}
assert.equal(runJq('"abc"', '. as $s | range(3) | $s', {raw:true}), 'abc\\nabc\\nabc');
assert.equal(runJq('"abc"', '. as $s | range(3) | $s', {raw:true,join:true}), 'abcabcabc');
assert.equal(runJq('"\\\\ud800"', '.', {compact:true}), '"\\\\ud800"');
`));

test('AR-calc-extensions-03 MBS output', () => child(`
const { MBS_XML } = await import('./packages/calc/src/mbs-xml.ts');
const scope = {};
const xml = '<r>'.repeat(100) + 'x'.repeat(81000) + '</r>'.repeat(100);
assert.throws(() => MBS_XML['xml.query']([xml, '//r', '', '2'], scope), limit);
assert.throws(() => MBS_XML['xml.query']([xml, '//r', '', '32'], scope), limit);
assert.equal(MBS_XML['xml.query'](['<r>ok</r>', '/r', '', '2'], scope), 'ok');
`));

test('AR-calc-extensions-04 shared work', () => child(`
const { applyXslt, XsltError } = await import('./packages/calc/src/xslt.ts');
const { withWorkBudget, workBudget } = await import('./packages/calc/src/work-budget.ts');
const style = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/><xsl:template match="/"><xsl:value-of select="1+1"/></xsl:template></xsl:stylesheet>';
assert.throws(() => withWorkBudget(() => { workBudget().work(3999999); applyXslt('<r/>', style); }), e => e instanceof XsltError && limit.test(e.message));
assert.equal(workBudget(), undefined);
assert.equal(applyXslt('<r/>', style), '2');
`));

test('jq retained reduce snapshots remain bounded', () => child(`
for (const filter of [
  '[foreach range(5000) as $i ([]; . + [$i])] | length',
  '[foreach range(5000) as $i ({}; .[($i|tostring)] = $i)] | length',
]) assert.throws(() => runJq('null', filter), limit);
// Repeated references to the same shallow copy do not allocate new snapshots.
assert.equal(runJq('null', '([range(1000)] + []) as $a | [range(5000) | $a] | length'), '5000');
`));

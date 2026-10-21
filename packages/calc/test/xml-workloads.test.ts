import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, NameTable, type CalcContext } from '../src/index.ts';
import { parseXmlDocument, evaluateXPath, xpathXml } from '../src/xpath.ts';
import { applyXslt } from '../src/xslt.ts';
import { MBS_XML } from '../src/mbs-xml.ts';

// About 4.3 MB, comfortably within the XML parser's existing 8 MB limit.
const count = 100_000;
const xml = '<r>' + '<row><name>ordinary name</name><v>12</v></row>'.repeat(count) + '</r>';
const ctx: CalcContext = { names: new NameTable({ fields: ['Source'] }), field: () => ({ type: 'text', value: xml }) };

test('XPath accepts ordinary selections, sums, predicates and comparisons over 100,000 rows', () => {
  assert.equal(evaluateText('BE_XPathAll ( Source ; "//row/name" )', ctx), Array(count).fill('ordinary name').join('\r'));
  for (const [path, expected] of [['sum(//v)', '1200000'], ['count(//row[v>10])', '100000'], ['//row/v < 5', 'false']]) {
    assert.equal(evaluateText(`BE_XPath ( Source ; "${path}" )`, ctx), expected);
  }
  assert.equal(MBS_XML['xml.query']([xml, 'count(//row)', '', '2'], {}), '100000');
});

test('XSLT for-each and apply-templates accept a 100,000-row source', () => {
  for (const method of ['text', 'xml']) {
    const value = method === 'text' ? '<xsl:value-of select="name"/>' : '<name><xsl:value-of select="name"/></name>';
    for (const templates of [
      '<xsl:template match="/"><out><xsl:for-each select="//row">' + value + '</xsl:for-each></out></xsl:template>',
      '<xsl:template match="/"><out><xsl:apply-templates select="//row"/></out></xsl:template><xsl:template match="row">' + value + '</xsl:template>',
    ]) {
      const style = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="' + method + '" omit-xml-declaration="yes"/>' + templates + '</xsl:stylesheet>';
      const context: CalcContext = {
        names: new NameTable({ fields: ['Source', 'Style'] }),
        field: ref => ({ type: 'text', value: ref.field === 'Source' ? xml : style }),
      };
      const expected = method === 'text' ? 'ordinary name'.repeat(count) : '<out>' + '<name>ordinary name</name>'.repeat(count) + '</out>\n';
      assert.equal(method === 'text' ? applyXslt(xml, style) : evaluateText('BE_XSLT_ApplyInMemory ( Source ; Style )', context), expected);
    }
  }
});

test('XPath serializes every supported XML depth including document and leaf nodes', () => {
  for (const depth of [129, 255, 256]) {
    const source = '<r a="x">'.repeat(depth) + 'text&amp;more' + '</r>'.repeat(depth);
    const doc = parseXmlDocument(source);
    assert.equal(xpathXml(evaluateXPath(doc, '/r')), source);
    assert.equal(xpathXml(evaluateXPath(doc, '/')), '<?xml version="1.0"?>\n' + source + '\n');
    const context: CalcContext = { names: new NameTable({ fields: ['Source'] }), field: () => ({ type: 'text', value: source }) };
    assert.equal(evaluateText('BE_XPath ( Source ; "/r" ; "" ; 0 )', context), source);
  }
  assert.throws(() => parseXmlDocument('<r>'.repeat(257) + '</r>'.repeat(257)), /nested too deeply/);
});

// MBS ( "XML.…" ) against the examples on MBS's own function pages (mbsplugins.eu). MBS's pages show formatted XML
// as HTML, which shows libxml2's two-space indent as one space; the expectations here use two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';
import { MBS_XML } from '../src/mbs-xml.ts';
import { MbsError } from '../src/mbs-text.ts';

const D = '<?xml version="1.0" encoding="UTF-8"?>\n';
const session = () => {
  const scope = {};
  return (name: string, ...args: (string | number)[]) => MBS_XML[name.toLowerCase()](args.map(String), scope);
};

test('MBS XML: GetPathValue reads nodes and attributes by path', () => {
  const x = session();
  assert.equal(x('XML.GetPathValue', '<test>Hello</test>', 'test', 0), 'Hello');
  assert.equal(x('XML.GetPathValue', '<test id="123">Hello</test>', 'test#id'), '123');
  assert.equal(x('XML.GetPathValue', '<outer><inner>Hello</inner></outer>', 'outer.inner'), 'Hello');
  assert.equal(x('XML.GetPathValue', '<outer><middle><inner>Hello</inner></middle></outer>', 'outer.middle', 32 + 4), `${D}<middle>\n  <inner>Hello</inner>\n</middle>`);
  const people = '<people><personid>123</personid><personid>456</personid><personid>789</personid></people>';
  assert.equal(x('XML.GetPathValue', people, 'people.personid[2]', 0), '789');
  assert.equal(x('XML.GetPathValue', people, 'people\rpersonid[1]', 0), '456');
  const inv = '<rsm:CrossIndustryInvoice xmlns:rsm="urn:r" xmlns:ram="urn:a"><rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext></rsm:CrossIndustryInvoice>';
  assert.equal(x('XML.GetPathValue', inv, 'rsm:CrossIndustryInvoice.rsm:ExchangedDocumentContext.ram:GuidelineSpecifiedDocumentContextParameter.ram:ID', 3), 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic');
  assert.equal(x('XML.GetPathValue', inv, 'CrossIndustryInvoice.ExchangedDocumentContext.GuidelineSpecifiedDocumentContextParameter.ID', 8), 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic');
  assert.equal(x('XML.GetPathValue', '<a><b.c>dot</b.c></a>', 'a.b\\.c'), 'dot');
  assert.throws(() => x('XML.GetPathValue', people, 'people.personid[3]'), MbsError);
  assert.equal(x('XML.GetPathValue', people, 'people.personid[3]', 2), '');
  assert.throws(() => x('XML.GetPathValue', '<hello></Hello>', 'hello'), /Failed to parse XML/);
});

test('MBS XML: SetPathValue, SetPathXML, SetPathCData and DeletePath', () => {
  const x = session();
  assert.equal(x('XML.SetPathValue', '<person/>', 'person.firstName', 0, 'Joe'), `${D}<person><firstName>Joe</firstName></person>`);
  assert.equal(x('XML.SetPathValue', '<person/>', 'person#id', 0, '123'), `${D}<person id="123"/>`);
  assert.equal(x('XML.SetPathValue', '<foo/>', 'foo.bar', 0, 'test & test \r < > '), `${D}<foo><bar>test &amp; test &#13; &lt; &gt; </bar></foo>`);
  assert.equal(x('XML.SetPathValue', '<person><firstName>Joe1</firstName><firstName>Joe2</firstName></person>', 'person.firstName[]', 0, 'Joe3'),
    `${D}<person><firstName>Joe1</firstName><firstName>Joe2</firstName><firstName>Joe3</firstName></person>`);
  assert.equal(x('XML.SetPathValue', '<person></person>', 'person.name', 4, ''), `${D}<person>\n  <name></name>\n</person>`);
  assert.equal(x('XML.SetPathXML', '<export><person></person></export>', 'export\rperson\rname', 0, '<name>Test</name>'), `${D}<export><person><name>Test</name></person></export>`);
  assert.equal(x('XML.SetPathXML', '<export><person><name>First</name></person></export>', 'export\rperson\rname[1]', 0, '<name>Test</name>'),
    `${D}<export><person><name>First</name><name>Test</name></person></export>`);
  assert.equal(x('XML.SetPathXML', '<r:export xmlns:r="http://mbsplugins.eu/testNamespace"><r:person></r:person></r:export>', 'r:export\rr:person\rr:name', 0, '<name>Test</name>'),
    `${D}<r:export xmlns:r="http://mbsplugins.eu/testNamespace"><r:person><name>Test</name></r:person></r:export>`);
  assert.equal(x('XML.SetPathCData', '<export><person></person></export>', 'export\rperson\rname', 0, '<b>John Miller</b>'),
    `${D}<export><person><name><![CDATA[<b>John Miller</b>]]></name></person></export>`);
  assert.equal(x('XML.DeletePath', '<test><node>Hello</node></test>', 'test.node', 0), `${D}<test/>`);
  assert.equal(x('XML.DeletePath', '<test><node id="123">Hello</node></test>', 'test.node#id', 0), `${D}<test><node>Hello</node></test>`);
  assert.throws(() => x('XML.SetPathValue', '<a/>', 'b.c', 0, '1'), /root element is <a>/);
});

test('MBS XML: a reference changes in place, unless flag 32 asks for the XML', () => {
  const x = session();
  const ref = x('XML.Parse', '<person/>');
  assert.equal(x('XML.SetPathValue', ref, 'person.name', 0, 'Ann'), 'OK');
  assert.equal(x('XML.SetPathValue', ref, 'person.age', 32, '7'), `${D}<person><name>Ann</name><age>7</age></person>`);
  assert.equal(x('XML.Compact', ref, 0), `${D}<person><name>Ann</name></person>`);
  assert.equal(x('XML.Query', ref, 'count(/person/*)'), '1');
  assert.equal(x('XML.List'), String(ref));
  const items = String(x('XML.ItemRefs', '<people><person><firstname>Peter</firstname></person><person><firstname>Michael</firstname></person></people>', 0)).split('\r');
  assert.equal(x('XML.Format', items[1]), `${D}<person>\n  <firstname>Michael</firstname>\n</person>`);
  assert.equal(x('XML.Release', items.join('\r')), 'OK');
  assert.equal(x('XML.ReleaseAll'), 'OK');
  assert.equal(x('XML.List'), '');
});

test('MBS XML: Format, Compact and empty tags', () => {
  const x = session();
  assert.equal(x('XML.SetSaveNoEmptyTags', 1) + String(x('XML.Format', '<c><a></a></c>')), `OK${D}<c>\n  <a></a>\n</c>`);
  assert.equal(x('XML.GetSaveNoEmptyTags'), 1);
  assert.equal(x('XML.SetSaveNoEmptyTags', 0) + String(x('XML.Format', '<c><a></a></c>')), `OK${D}<c>\n  <a/>\n</c>`);
  assert.equal(x('XML.Format', '<a>\r  <b>x</b>\r  <c><d/></c>\r</a>', 64), '<a>\n  <b>x</b>\n  <c>\n    <d/>\n  </c>\n</a>');
  assert.equal(x('XML.Format', '<p>Some <b>bold</b> text</p>', 64), '<p>Some <b>bold</b> text</p>');
  assert.equal(x('XML.Format', '<cfdi:Invoice xmlns:cfdi="urn:c" invoiceTotal="450.24"> </cfdi:Invoice>', 8 + 64), '<Invoice invoiceTotal="450.24"> </Invoice>');
  assert.equal(x('XML.Compact', '<a>Test</a>', 1 + 64), '<a>Test</a>');
  assert.equal(x('XML.Compact', '<a>\n  <b> x </b>\n</a>', 64), '<a><b> x </b></a>');
  assert.throws(() => x('XML.Format', '<hello></Hello>', 0), /Failed to parse XML/);
});

test('MBS XML: Query with XPath', () => {
  const x = session();
  assert.equal(x('XML.Query', '<hello>Hello World</hello>', '/hello/text()'), 'Hello World');
  const order = '<OrderRequestHeader orderID="1629" orderDate="2013-07-26T12:20:27" type="new"><Money>123.00</Money></OrderRequestHeader>';
  assert.equal(x('XML.Query', order, '/OrderRequestHeader/@orderID'), `${D}orderID="1629"`);
  assert.equal(x('XML.Query', order, 'string(/OrderRequestHeader/@orderID)'), '1629');
  assert.equal(x('XML.Query', '<cfdi:Invoice xmlns:cfdi="urn:c" invoiceTotal="450.24"> </cfdi:Invoice>', '/Invoice/@invoiceTotal', '', 8 + 2), '450.24');
  assert.equal(x('XML.Query', '<a><b Guid="123">Entry1</b><b Guid="456">Entry2</b></a>', '/a/b/@Guid', '', 2), '123\r456');
  const hello = '<test><hello>Hello World1</hello><hello>Hello World2</hello><hello>Hello World3</hello></test>';
  assert.equal(x('XML.Query', hello, '//test/hello', '', 32), '<hello>Hello World1</hello>\n<hello>Hello World2</hello>\n<hello>Hello World3</hello>');
  assert.equal(x('XML.Query', hello, '//test/hello'), `${D}<result>\n  <hello>Hello World1</hello>\n  <hello>Hello World2</hello>\n  <hello>Hello World3</hello>\n</result>`);
  assert.equal(x('XML.Query', hello, '//test/hello', '', 16), `${D}<hello>Hello World1</hello>`);
  assert.equal(x('XML.Query', '<i:a xmlns:i="urn:inv"><i:email>a@x</i:email></i:a>', '//inv:email', 'inv=urn:inv', 2), 'a@x');
  assert.throws(() => x('XML.Query', hello, '//['), MbsError);
});

test('MBS XML: SubTree, ExtractText, NodeNames, NodeCount and attributes', () => {
  const x = session();
  const person = '<People><Person><FirstName>Markus</FirstName><LastName>Müller</LastName><City>New York</City></Person></People>';
  assert.equal(x('XML.SubTree', person, 'Person'), `${D}<Person>\n  <FirstName>Markus</FirstName>\n  <LastName>Müller</LastName>\n  <City>New York</City>\n</Person>`);
  const abc = '<a><b>123</b><b>456</b><b>789</b></a>';
  assert.deepEqual([0, 1, 2, 3].map((i) => x('XML.ExtractText', String(x('XML.SubTree', abc, 'b', 0, i)) || '<x/>')), ['123', '456', '789', '']);
  assert.equal(x('XML.ExtractText', '<Person><FirstName>Markus</FirstName><LastName>Müller</LastName><City>New York</City></Person>'), 'Markus\rMüller\rNew York');
  assert.equal(x('XML.NodeNames', '<Person><FirstName>Markus</FirstName><LastName>Müller</LastName><City>New York</City></Person>'), 'FirstName\rLastName\rCity');
  assert.equal(x('XML.NodeNames', '<a><b><c/></b><b/><d></d></a>', 1, 16), 'b');
  assert.equal(x('XML.NodeCount', '<Items><ID>1</ID><ID>3</ID><ID>5</ID></Items>', 'ID'), 3);
  assert.equal(x('XML.ListAttributes', '<img width="123" height="456" alt="test"></img>'), 'width\rheight\ralt');
  assert.equal(x('XML.GetAttribute', '<a href="http://mbsplugins.de">mbsplugins.de</a>', 'href'), 'http://mbsplugins.de');
  assert.equal(x('XML.HasAttribute', '<a href="http://mbsplugins.de">mbsplugins.de</a>', 'href'), 1);
  assert.equal(x('XML.HasAttribute', '<a/>', 'href'), 0);
});

test('MBS XML: Canonical and stylesheets with parameters', () => {
  const x = session();
  const doc = '<?xml version="1.0"?><!--c--><r b="2" a="1"><e/></r>';
  assert.equal(x('XML.Canonical', doc), '<r a="1" b="2"><e></e></r>');
  assert.equal(x('XML.Canonical', doc, 2), '<!--c-->\n<r a="1" b="2"><e></e></r>');
  assert.throws(() => x('XML.Canonical', doc, 0, 1), /Exclusive/);
  const style = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/><xsl:param name="id" select="0"/><xsl:param name="name"/>'
    + '<xsl:template match="/"><xsl:value-of select="concat($id, \':\', $name, \':\', count(//i))"/></xsl:template></xsl:stylesheet>';
  assert.equal(x('XML.ApplyStylesheet', '<r><i/><i/></r>', style), '0::2');
  assert.equal(x('XML.ApplyStylesheet', '<r><i/><i/></r>', style, "id=123\rname='Bob'"), '123:Bob:2');
  assert.equal(x('XML.ApplyStylesheet2', '<r><i/></r>', style, 'id', "'123'", 'name', "'Bob'"), '123:Bob:1');
});

test('MBS XML through MBS ( … ): references per calculation context, other functions not available', () => {
  const c: CalcContext = {};
  assert.equal(evaluateText('MBS ( "XML.GetPathValue" ; "<test>Hello</test>" ; "test" ; 0 )', c), 'Hello');
  assert.equal(evaluateText('Let ( r = MBS ( "XML.Parse" ; "<a><b>1</b></a>" ) ; MBS ( "XML.GetPathValue" ; r ; "a.b" ) )', c), '1');
  assert.match(evaluateText('MBS ( "XML.Colorize" ; "<a/>" )', c), /^\[MBS\] ERROR: XML.Colorize is not available/);
  assert.match(evaluateText('MBS ( "XML.Format" ; "<a>" )', c), /^\[MBS\] ERROR: Failed to parse XML/);
  assert.equal(evaluateText('MBS ( "IsError" )', c), '1');
});

test('MBS XML: a change that fails leaves the reference as it was, in document order', () => {
  const x = session();
  const ref = x('XML.Parse', '<a><z/></a>');
  assert.throws(() => x('XML.SetPathXML', ref, 'a.b.c.d', 0, '<d>'), /Failed to parse XML/);
  assert.throws(() => x('XML.SetPathCData', ref, 'a.b#x', 0, 'v'), /no CDATA/);
  assert.equal(x('XML.Compact', ref, 64), '<a><z/></a>');
  assert.equal(x('XML.SetPathValue', ref, 'a.b', 0, '1'), 'OK');
  assert.equal(x('XML.Query', ref, 'name((//*)[1])'), 'a');
  assert.equal(x('XML.Query', ref, 'name((//*)[3])'), 'b');
});

test('MBS XML: deep and wide documents stay quick and bounded', () => {
  const x = session();
  // These inputs exercise deep traversal and wide XPath work. Keep a firm
  // upper bound, with room for CPU scheduling pauses on shared CI runners.
  const quick = (f: () => unknown, ms = 8000) => {
    const t0 = Date.now();
    try {
      f();
    } catch (e) {
      assert.ok(e instanceof MbsError || e instanceof RangeError, String(e));
    }
    assert.ok(Date.now() - t0 < ms, `took ${Date.now() - t0} ms`);
  };
  const deep = '<a>'.repeat(1500) + '<b>x</b>'.repeat(50000) + '</a>'.repeat(1500);
  quick(() => x('XML.ExtractText', deep));
  quick(() => x('XML.NodeNames', deep, 1));
  quick(() => x('XML.Compact', deep, 0));
  // libxml2 indents at most 60 spaces, so a deep document doesn't grow without end.
  const formatted = String(x('XML.Format', '<a>'.repeat(40) + '<b/>' + '</a>'.repeat(40), 64));
  assert.equal(Math.max(...formatted.split('\n').map((l) => l.length - l.trimStart().length)), 60);
  assert.equal(x('XML.Query', '<a>' + '<b>x</b>'.repeat(200000) + '</a>', 'count(//b)'), '200000');
  assert.throws(() => x('XML.SetPathValue', '<a/>', 'a' + '.b'.repeat(600), 0, 'v'), /more than 512 steps/);
});

test('MBS XML: formatting keeps text, instructions and namespaces whole', () => {
  const x = session();
  assert.equal(x('XML.Query', '<r><p>line1\nline2</p><p><![CDATA[a\nb]]></p><!--c\nd--></r>', '/r/node()'),
    `${D}<result>\n  <p>line1\nline2</p>\n  <p><![CDATA[a\nb]]></p>\n  <!--c\nd-->\n</result>`);
  assert.equal(x('XML.Format', '<p>x <b>1</b> <i>2</i></p>', 64), '<p>x <b>1</b> <i>2</i></p>');
  assert.equal(x('XML.Compact', '<p>x <b>1</b> <i>2</i></p>', 64), '<p>x <b>1</b> <i>2</i></p>');
  assert.equal(x('XML.Format', '<?xml-stylesheet href="a.xsl" type="text/xsl"?><a><?pi x?></a>', 64), '<?xml-stylesheet href="a.xsl" type="text/xsl"?>\n<a>\n  <?pi x?>\n</a>');
  const inv = '<rsm:Inv xmlns:rsm="urn:r" xmlns="urn:d"><rsm:Line><Item>1</Item></rsm:Line></rsm:Inv>';
  const sub = String(x('XML.SubTree', inv, 'rsm:Line', 4));
  assert.equal(sub, `${D}<rsm:Line xmlns:rsm="urn:r" xmlns="urn:d"><Item>1</Item></rsm:Line>`);
  assert.equal(x('XML.Query', sub, 'count(//r:Line/d:Item)', 'r=urn:r d=urn:d'), '1');
  const [item] = String(x('XML.ItemRefs', inv, 0)).split('\r');
  assert.equal(x('XML.Compact', item, 64), '<rsm:Line xmlns:rsm="urn:r" xmlns="urn:d"><Item>1</Item></rsm:Line>');
});

test('MBS XML: what would make the output not XML is refused or written as a reference', () => {
  const x = session();
  assert.throws(() => x('XML.Format', '<r xmlns:a="u1" xmlns:b="u2" a:x="1" b:x="2"/>', 72), /attribute "x" twice/);
  assert.throws(() => x('XML.SetPathValue', '<a/>', 'a#x="1" y', 0, 'v'), /not an attribute name/);
  assert.equal(x('XML.SetPathValue', '<a/>', 'a.b', 0, 'x\u0001y'), `${D}<a><b>x&#1;y</b></a>`);
  const style = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:p="urn:p"><xsl:output method="text"/><xsl:param name="p:id" select="1"/>'
    + '<xsl:template match="/"><xsl:value-of select="$p:id"/></xsl:template></xsl:stylesheet>';
  assert.equal(x('XML.ApplyStylesheet2', '<r/>', style, 'p:id', '2'), '2');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateXPath, formatNumber, parseXmlDocument, xpathText, xpathValues, xpathXml, XPathError } from '../src/xpath.ts';

const BOOKS = `<?xml version="1.0" encoding="UTF-8"?>
<!-- catalogue -->
<library xml:lang="en-GB">
  <book id="b1" year="1990" price="10.5"><title>Alpha</title><author>Ann</author><author>Bob</author></book>
  <book id="b2" year="2005" price="20"><title>Beta</title><author>Cy</author><!--note--></book>
  <book id="b3" year="2020" price="7.25" xml:lang="fr"><title>Gamma &amp; Delta</title><?pi skipped?></book>
  <magazine id="m1"><title><![CDATA[<Weekly>]]></title></magazine>
</library>`;
const doc = parseXmlDocument(BOOKS);
const x = (expr: string, ns?: string) => xpathText(evaluateXPath(doc, expr, ns));
const all = (expr: string, ns?: string) => xpathValues(evaluateXPath(doc, expr, ns));
const count = (expr: string) => x(`count(${expr})`);

test('location paths and abbreviations', () => {
  assert.equal(x('/library/book/title'), 'Alpha');
  assert.equal(all('//title'), 'Alpha\rBeta\rGamma & Delta\r<Weekly>');
  assert.equal(x('//book[2]/@id'), 'b2');
  assert.equal(x('//book[@id="b3"]/title'), 'Gamma & Delta');
  assert.equal(x('/library/*[last()]/@id'), 'm1');
  assert.equal(x('//author/..//title'), 'Alpha');
  assert.equal(x('//book[title="Beta"]/./author'), 'Cy');
  assert.equal(count('/'), '1');
  assert.equal(count('/*'), '1');
  assert.equal(count('//book/@*'), '10');
  assert.equal(count('//node()'), '26');
  assert.equal(count('/library/text()'), '5');
  assert.equal(all('//comment()'), ' catalogue \rnote');
  assert.equal(count('//processing-instruction()'), '0');
  assert.equal(count("//processing-instruction('pi')"), '0');
  assert.equal(count('//book//text()'), '6');
});

test('axes', () => {
  assert.equal(all('//book[2]/child::*'), 'Beta\rCy');
  assert.equal(count('/library/descendant::author'), '3');
  assert.equal(count('//book[1]/descendant-or-self::*'), '4');
  assert.equal(x('//title[.="Beta"]/self::title'), 'Beta');
  assert.equal(x('//title[.="Beta"]/parent::book/@id'), 'b2');
  assert.equal(all('//author[.="Cy"]/ancestor::*/@id'), 'b2');
  assert.equal(x('name(//author[.="Cy"]/ancestor::*[2])'), 'library');
  assert.equal(x('name(//author[.="Cy"]/ancestor-or-self::*[1])'), 'author');
  assert.equal(all('//book[1]/following-sibling::*/@id'), 'b2\rb3\rm1');
  assert.equal(x('//book[3]/preceding-sibling::*[1]/@id'), 'b2');
  assert.equal(x('//book[3]/preceding-sibling::book[last()]/@id'), 'b1');
  assert.equal(all('//book[2]/following::title'), 'Gamma & Delta\r<Weekly>');
  assert.equal(all('//book[2]/preceding::author'), 'Ann\rBob');
  assert.equal(x('//book[2]/preceding::author[1]'), 'Bob');
  assert.equal(x('//book[2]/following::*[1]/@id'), 'b3');
  assert.equal(all('//book[1]/attribute::year | //book[2]/@year'), '1990\r2005');
  // An attribute is followed by its element's content and preceded by what precedes its element.
  assert.equal(x('//book[2]/@id/following::*[1]'), 'Beta');
  assert.equal(x('//book[2]/@id/preceding::*[1]'), 'Bob');
  assert.equal(count('//book[1]/@id/following-sibling::node()'), '0');
  assert.equal(x('//book[1]/@id/parent::*/title'), 'Alpha');
  assert.equal(all('//book[1]/namespace::*'), 'http://www.w3.org/XML/1998/namespace');
  assert.equal(x('name(/library/namespace::xml)'), 'xml');
});

test('predicates: position, reverse axes, filter expressions', () => {
  assert.equal(x('//book[position() = 2]/@id'), 'b2');
  assert.equal(x('//book[last() - 1]/@id'), 'b2');
  assert.equal(all('//author[1]'), 'Ann\rCy');
  assert.equal(x('(//author)[2]'), 'Bob');
  assert.equal(x('(//author)[last()]'), 'Cy');
  assert.equal(x('//author[.="Cy"]/ancestor::*[1]/@id'), 'b2');
  assert.equal(x('//author[.="Cy"]/ancestor::*[last()]/@id'), '');
  assert.equal(x('name(//author[.="Cy"]/ancestor::*[last()])'), 'library');
  assert.equal(all('//book[@year > 2000][2]/@id'), 'b3');
  assert.equal(all('//book[2 > position()]/@id'), 'b1');
  assert.equal(all('(//book | //magazine)[@id != "b2"][position() > 1]/@id'), 'b3\rm1');
  assert.equal(all('//book[author][count(author) = 1]/@id'), 'b2');
  assert.equal(all('//book[not(author)]/@id'), 'b3');
  assert.equal(x('(//book)[2]/title'), 'Beta');
  assert.equal(x('(//book/title)[1]/../@id'), 'b1');
});

test('operators and grammar', () => {
  assert.equal(x('1 + 2 * 3'), '7');
  assert.equal(x('(1 + 2) * 3'), '9');
  assert.equal(x('7 mod 3'), '1');
  assert.equal(x('-7 mod 3'), '-1');
  assert.equal(x('7 div 2'), '3.5');
  assert.equal(x('--3'), '3');
  assert.equal(x('- 2 - -3'), '1');
  assert.equal(x('1 div 0'), 'Infinity');
  assert.equal(x('-1 div 0'), '-Infinity');
  assert.equal(x('0 div 0'), 'NaN');
  assert.equal(x('1 = 1 and 2 = 3 or 4 = 4'), 'true');
  assert.equal(x('1 = 1 and (2 = 3 or 4 = 5)'), 'false');
  assert.equal(x('1 < 2 = true()'), 'true');
  assert.equal(x('3 > 2 > 1'), 'false');
  assert.equal(x('.5 + 1.'), '1.5');
  assert.equal(x('1e3'), '1000');
  // After an operand "*", "div" and friends are operators; elsewhere they are names.
  assert.equal(x('count(//book) * 2'), '6');
  assert.equal(x('//book[1]/@price*2'), '21');
  assert.equal(count('//div | //mod | //and'), '0');
  assert.equal(x('sum(//book/@year) div count(//book)'), '2005');
  assert.equal(x('//book [ 1 ] / title'), 'Alpha');
  assert.equal(x('child :: library / child::book[1]/title'), 'Alpha');
  assert.equal(x('"lit"'), 'lit');
  assert.equal(x("'say \"hi\"'"), 'say "hi"');
  for (const bad of ['', '/library/', '1 +', '//book[', 'foo()', 'count()', 'concat("a")', '$var', 'bogus::x', '1 2', '"open', './[1]', '1 | 2', '"a"/b', '//#']) {
    assert.throws(() => x(bad), XPathError, bad);
  }
});

test('comparisons with node-sets', () => {
  assert.equal(x('//author = "Bob"'), 'true');
  assert.equal(x('//author != "Bob"'), 'true');
  assert.equal(x('//title = "Nope"'), 'false');
  assert.equal(x('not(//title != "Alpha")'), 'false');
  assert.equal(x('//nothing = "x"'), 'false');
  assert.equal(x('//nothing != "x"'), 'false');
  assert.equal(x('//book/@year = 2005'), 'true');
  assert.equal(x('//book/@year > 2019'), 'true');
  assert.equal(x('//book/@year > 2020'), 'false');
  assert.equal(x('2021 > //book/@year'), 'true');
  assert.equal(x('//book/@year < "2000"'), 'true');
  assert.equal(x('//book/@price = //book/@price'), 'true');
  assert.equal(x('//book/@id = //magazine/@id'), 'false');
  assert.equal(x('//book/@id != //magazine/@id'), 'true');
  assert.equal(x('//book/@year >= //book/@price'), 'true');
  assert.equal(x('//book[1]/@year < //book[1]/@price'), 'false');
  assert.equal(x('//book = true()'), 'true');
  assert.equal(x('//nothing = false()'), 'true');
  assert.equal(x('true() > //nothing'), 'true');
  assert.equal(x('"1" = 1.0'), 'true');
  assert.equal(x('"abc" = "abc "'), 'false');
  assert.equal(x('true() = "x"'), 'true');
  assert.equal(x('0 = false()'), 'true');
  assert.equal(x('"a" < "b"'), 'false');
});

test('string functions', () => {
  assert.equal(x('string(//book[2]/@price)'), '20');
  assert.equal(x('string()'), x('string(/)'));
  assert.equal(x('concat("a", 1, true(), //author)'), 'a1trueAnn');
  assert.equal(x('starts-with("tabularius", "tab")'), 'true');
  assert.equal(x('contains(//book[3]/title, "&")'), 'true');
  assert.equal(x('substring-before("1999/04/01", "/")'), '1999');
  assert.equal(x('substring-after("1999/04/01", "/")'), '04/01');
  assert.equal(x('substring-after("abc", "")'), 'abc');
  assert.equal(x('substring-before("abc", "z")'), '');
  assert.equal(x('substring("12345", 2, 3)'), '234');
  assert.equal(x('substring("12345", 2)'), '2345');
  assert.equal(x('substring("12345", 1.5, 2.6)'), '234');
  assert.equal(x('substring("12345", 0, 3)'), '12');
  assert.equal(x('substring("12345", 0 div 0, 3)'), '');
  assert.equal(x('substring("12345", 1, 0 div 0)'), '');
  assert.equal(x('substring("12345", -42, 1 div 0)'), '12345');
  assert.equal(x('substring("12345", -1 div 0, 1 div 0)'), '');
  assert.equal(x('substring("a😀b", 2, 1)'), '😀');
  assert.equal(x('string-length("a😀b")'), '3');
  assert.equal(x('string-length(//book[1]/title)'), '5');
  assert.equal(x('//book[1]/title[string-length() = 5]'), 'Alpha');
  assert.equal(x('normalize-space("  a \t b\n  c ")'), 'a b c');
  assert.equal(x('//title[normalize-space() = "Beta"]'), 'Beta');
  assert.equal(x('translate("bar", "abc", "ABC")'), 'BAr');
  assert.equal(x('translate("--aaa--", "abc-", "ABC")'), 'AAA');
  assert.equal(x('translate("aba", "aa", "xy")'), 'xbx');
});

test('node functions and lang', () => {
  assert.equal(x('count(//author)'), '3');
  assert.equal(x('local-name(/*)'), 'library');
  assert.equal(x('name(//@xml:lang)'), 'xml:lang');
  assert.equal(x('local-name(//@xml:lang)'), 'lang');
  assert.equal(x('namespace-uri(//@xml:lang)'), 'http://www.w3.org/XML/1998/namespace');
  assert.equal(x('name(//nothing)'), '');
  assert.equal(x('name()'), '');
  assert.equal(x('//book[1]/title[name() = "title"]'), 'Alpha');
  assert.equal(x('local-name(//comment())'), '');
  assert.equal(all('//book[lang("en")]/@id'), 'b1\rb2');
  assert.equal(all('//book[lang("FR")]/@id'), 'b3');
  assert.equal(x('//title[lang("en-gb")]'), 'Alpha');
  assert.equal(count('//*[lang("de")]'), '0');
  assert.equal(count('id("b1")'), '0');
  assert.throws(() => x('count("x")'), XPathError);
  assert.throws(() => x('name("x")'), XPathError);
  const ids = parseXmlDocument('<r><a xml:id="one">1</a><b xml:id="two">2</b><c>one two</c></r>');
  assert.equal(xpathValues(evaluateXPath(ids, 'id("two one")')), '1\r2');
  assert.equal(xpathValues(evaluateXPath(ids, 'id(//c)')), '1\r2');
});

test('boolean and number functions', () => {
  assert.equal(x('boolean(//book)'), 'true');
  assert.equal(x('boolean(//nothing)'), 'false');
  assert.equal(x('boolean("")'), 'false');
  assert.equal(x('boolean(0 div 0)'), 'false');
  assert.equal(x('boolean(-0.1)'), 'true');
  assert.equal(x('not(true())'), 'false');
  assert.equal(x('false()'), 'false');
  assert.equal(x('number("  12.5 ")'), '12.5');
  assert.equal(x('number("-.5")'), '-0.5');
  assert.equal(x('number("1e2")'), '100');
  assert.equal(x('number("+1")'), 'NaN');
  assert.equal(x('number("12px")'), 'NaN');
  assert.equal(x('number("")'), 'NaN');
  assert.equal(x('number(true())'), '1');
  assert.equal(x('//book[1]/@year[number() = 1990]'), '1990');
  assert.equal(x('sum(//book/@price)'), '37.75');
  assert.equal(x('sum(//title)'), 'NaN');
  assert.equal(x('sum(//nothing)'), '0');
  assert.equal(x('floor(2.7)'), '2');
  assert.equal(x('floor(-2.5)'), '-3');
  assert.equal(x('ceiling(2.1)'), '3');
  assert.equal(x('ceiling(-0.5)'), '0');
  assert.equal(x('round(2.5)'), '3');
  assert.equal(x('round(-2.5)'), '-2');
  assert.equal(x('round(0 div 0)'), 'NaN');
  assert.equal(x('1 div round(-0.4)'), '-Infinity');
  assert.equal(x('position() + last()'), '2');
});

test('number formatting', () => {
  assert.equal(formatNumber(42), '42');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(1 / 3), '0.333333333333333');
  assert.equal(formatNumber(2 / 3), '0.666666666666667');
  assert.equal(formatNumber(123.456), '123.456');
  assert.equal(formatNumber(-12.5), '-12.5');
  assert.equal(formatNumber(0.00012), '0.00012');
  assert.equal(formatNumber(1000000000), '1000000000');
  // libxml2 only prints values strictly inside int range as integers.
  assert.equal(formatNumber(2147483647), '2.147483647e+09');
  assert.equal(formatNumber(2147483646), '2147483646');
  assert.equal(formatNumber(1e10), '1e+10');
  assert.equal(formatNumber(1.5e10), '1.5e+10');
  assert.equal(formatNumber(0.000001), '1e-06');
  assert.equal(formatNumber(1e100), '1e+100');
  assert.equal(formatNumber(NaN), 'NaN');
  assert.equal(formatNumber(Infinity), 'Infinity');
  assert.equal(formatNumber(-Infinity), '-Infinity');
  assert.equal(x('1 div 3'), '0.333333333333333');
  assert.equal(x('2 = 2'), 'true');
  assert.deepEqual(evaluateXPath(doc, 'count(//book)'), { type: 'number', value: 3 });
  assert.deepEqual(evaluateXPath(doc, 'string(1)'), { type: 'string', value: '1' });
});

test('namespaces', () => {
  const atom = parseXmlDocument(
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:m="urn:media"><title>T</title><entry m:rank="1"><title>E1</title><m:thumb url="a.png"/></entry><plain xmlns="">P</plain></feed>',
  );
  const ax = (e: string, ns?: string) => xpathText(evaluateXPath(atom, e, ns));
  // An unprefixed name test only matches elements in no namespace.
  assert.equal(ax('count(/feed)'), '0');
  assert.equal(ax('/a:feed/a:title', 'a=http://www.w3.org/2005/Atom'), 'T');
  assert.equal(ax('//a:entry/a:title', 'xmlns:a="http://www.w3.org/2005/Atom"'), 'E1');
  assert.equal(ax("//a:entry/@x:rank", "a='http://www.w3.org/2005/Atom' x=urn:media"), '1');
  assert.equal(ax('//media:thumb/@url', 'media=urn:media'), 'a.png');
  assert.equal(ax('count(//a:*)', 'a=http://www.w3.org/2005/Atom'), '4');
  assert.equal(ax('//plain'), 'P');
  assert.equal(ax('namespace-uri(/*)'), 'http://www.w3.org/2005/Atom');
  assert.equal(ax('name(//*[local-name() = "thumb"])'), 'm:thumb');
  assert.equal(ax('local-name(//*[local-name() = "thumb"])'), 'thumb');
  assert.equal(ax('namespace-uri(//*[local-name() = "plain"])'), '');
  assert.equal(ax('count(/*/namespace::*)'), '3');
  assert.equal(ax('count(//*[local-name() = "plain"]/namespace::*)'), '2');
  assert.throws(() => ax('/a:feed'), XPathError);
  assert.throws(() => ax('//q:*', 'a=urn:x'), /Undefined namespace prefix "q"/);
  // The document's own prefixes don't count: only the registered list does.
  assert.throws(() => ax('//m:thumb'), XPathError);
  // An unbound prefix in the document is kept as part of the name, as libxml2 does.
  const loose = parseXmlDocument('<r><p:a>1</p:a></r>');
  assert.equal(xpathText(evaluateXPath(loose, 'local-name(/r/*)')), 'p:a');
});

test('SOAP envelope', () => {
  const soap = parseXmlDocument(`<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Body>
    <GetQuoteResponse xmlns="urn:stocks">
      <Quote symbol="ACME"><Price>12.30</Price><Change>-0.45</Change></Quote>
      <Quote symbol="INIT"><Price>101</Price><Change xsi:nil="true"/></Quote>
    </GetQuoteResponse>
  </soap:Body>
</soap:Envelope>`);
  const ns = 's=http://schemas.xmlsoap.org/soap/envelope/ q=urn:stocks i=http://www.w3.org/2001/XMLSchema-instance';
  const sx = (e: string) => xpathText(evaluateXPath(soap, e, ns));
  assert.equal(sx('/s:Envelope/s:Body/q:GetQuoteResponse/q:Quote[1]/q:Price'), '12.30');
  assert.equal(sx('sum(//q:Price)'), '113.3');
  assert.equal(sx('//q:Quote[q:Change < 0]/@symbol'), 'ACME');
  assert.equal(sx('//q:Quote[q:Change/@i:nil = "true"]/@symbol'), 'INIT');
  assert.equal(sx('count(//q:Quote[q:Price > 50])'), '1');
  assert.equal(xpathValues(evaluateXPath(soap, '//q:Quote/@symbol', ns)), 'ACME\rINIT');
  assert.equal(
    xpathXml(evaluateXPath(soap, '//q:Quote[2]', ns)),
    '<Quote symbol="INIT"><Price>101</Price><Change xsi:nil="true"/></Quote>',
  );
});

test('RSS feed', () => {
  const rss = parseXmlDocument(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE rss [ <!ELEMENT rss ANY> ]>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>News &#8212; Today</title>
    <item><title>One</title><link>http://x/1?a=1&amp;b=2</link><dc:creator>Ann</dc:creator><category>a</category><category>b</category></item>
    <item><title>Two</title><link>http://x/2</link><dc:creator>Bob</dc:creator></item>
    <item><title>Three</title><description><![CDATA[<p>Hi & bye</p>]]></description></item>
  </channel>
</rss>`);
  const r = (e: string) => evaluateXPath(rss, e, 'dc=http://purl.org/dc/elements/1.1/');
  assert.equal(xpathText(r('/rss/channel/title')), 'News — Today');
  assert.equal(xpathValues(r('//item/title')), 'One\rTwo\rThree');
  assert.equal(xpathValues(r('//item[dc:creator]/link')), 'http://x/1?a=1&b=2\rhttp://x/2');
  assert.equal(xpathText(r('//item[not(dc:creator)]/description')), '<p>Hi & bye</p>');
  assert.equal(xpathText(r('count(//item[category = "b"])')), '1');
  assert.equal(xpathText(r('//item[last()]/title')), 'Three');
  assert.equal(xpathText(r('string(/rss/@version)')), '2.0');
  assert.equal(xpathText(r('/rss/@version * 2')), '4');
  assert.equal(xpathXml(r('//item[1]/link')), '<link>http://x/1?a=1&amp;b=2</link>');
  assert.equal(xpathXml(r('//item[3]/description')), '<description><![CDATA[<p>Hi & bye</p>]]></description>');
});

test('xpathValues and xpathXml', () => {
  assert.equal(all('//book/@id'), 'b1\rb2\rb3');
  assert.equal(all('//nothing'), '');
  assert.equal(all('count(//book)'), '3');
  assert.equal(all('1 = 1'), 'true');
  // Union results come back in document order, whatever order they were written in.
  assert.equal(all('//magazine/@id | //book[1]/@id'), 'b1\rm1');
  const xml = (e: string) => xpathXml(evaluateXPath(doc, e));
  assert.equal(xml('//book[1]'), '<book id="b1" year="1990" price="10.5"><title>Alpha</title><author>Ann</author><author>Bob</author></book>');
  assert.equal(xml('//book[2]'), '<book id="b2" year="2005" price="20"><title>Beta</title><author>Cy</author><!--note--></book>');
  assert.equal(xml('//book[3]/title'), '<title>Gamma &amp; Delta</title>');
  assert.equal(xml('//book[3]/title/text()'), 'Gamma &amp; Delta');
  assert.equal(xml('//book[3]/@xml:lang'), ' xml:lang="fr"');
  assert.equal(xml('//nothing'), '');
  assert.equal(xml('count(//book)'), '3');
  assert.equal(xml('//comment()'), '<!-- catalogue -->');
  const small = parseXmlDocument(`<a x='say "hi" &lt;&gt;' y="1&#10;2"><b/><c></c>t&gt;</a>`);
  assert.equal(xpathXml(evaluateXPath(small, '/a')), '<a x="say &quot;hi&quot; &lt;&gt;" y="1&#10;2"><b/><c/>t&gt;</a>');
  assert.equal(xpathXml(evaluateXPath(small, '/')), '<?xml version="1.0"?>\n<a x="say &quot;hi&quot; &lt;&gt;" y="1&#10;2"><b/><c/>t&gt;</a>\n');
  const ns = parseXmlDocument('<r xmlns="urn:r"><s:k xmlns:s="urn:s" s:v="1"/></r>');
  assert.equal(xpathXml(evaluateXPath(ns, '/*')), '<r xmlns="urn:r"><s:k xmlns:s="urn:s" s:v="1"/></r>');
  assert.equal(xpathXml(evaluateXPath(ns, '//s:k', 's=urn:s')), '<s:k xmlns:s="urn:s" s:v="1"/>');
});

test('XML parsing', () => {
  const ws = parseXmlDocument('<a>\n  <b> x </b>\r\n</a>');
  // Whitespace-only text is kept, and line ends are normalised.
  assert.equal(xpathText(evaluateXPath(ws, 'count(/a/text())')), '2');
  assert.equal(xpathText(evaluateXPath(ws, 'string(/a)')), '\n   x \n');
  const ents = parseXmlDocument('<a t="a\tb">&lt;&#65;&#x42;&apos;&quot;&gt;&amp;</a>');
  assert.equal(xpathText(evaluateXPath(ents, '/a')), `<AB'">&`);
  assert.equal(xpathText(evaluateXPath(ents, '/a/@t')), 'a b');
  assert.equal(xpathText(evaluateXPath(parseXmlDocument('﻿<a/>'), 'name(/*)')), 'a');
  for (const bad of [
    '',
    'text',
    '<a>',
    '<a></b>',
    '<a><b></a></b>',
    '<a x=1/>',
    '<a x="1" x="2"/>',
    '<a x="<"/>',
    '<a>&nbsp;</a>',
    '<a>&#0;</a>',
    '<a>a & b</a>',
    '<a/><b/>',
    '<a/>junk',
    '<a><!-- open</a>',
    '<a><![CDATA[x</a>',
    '<a b="1"c="2"/>',
    '<1a/>',
  ]) {
    assert.throws(() => parseXmlDocument(bad), XPathError, bad);
  }
});

test('documents nested past the depth limit are an XML error, not a stack overflow', () => {
  assert.ok(parseXmlDocument(`${'<a>'.repeat(256)}x${'</a>'.repeat(256)}`));
  for (const depth of [257, 5000, 50_000]) {
    assert.throws(() => parseXmlDocument('<a>'.repeat(depth)), (e) => e instanceof XPathError && /XML is nested too deeply/.test(e.message));
  }
});

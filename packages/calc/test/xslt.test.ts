import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyXslt, XsltError } from '../src/xslt.ts';

// Expected outputs were checked against libxslt 1.1.43 (xsltproc's engine) unless a comment says otherwise.

const XSL = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
const sheet = (body: string, attrs = ''): string => `<xsl:stylesheet version="1.0" ${XSL} ${attrs}>${body}</xsl:stylesheet>`;

const CATALOG = `<?xml version="1.0"?>
<catalog>
  <book id="b1" lang="en"><title>Zebra</title><author>Ann</author><price>10.5</price><cat>fiction</cat></book>
  <book id="b2" lang="fr"><title>apple</title><author>Bob</author><price>20</price><cat>science</cat></book>
  <book id="b3" lang="en"><title>Mango</title><author>Ann</author><price>7.25</price><cat>fiction</cat></book>
  <book id="b4" lang="de"><title>banana</title><author>Cy</author><price>100</price><cat>history</cat></book>
  <!-- end -->
</catalog>`;
const run = (xsl: string, xml = CATALOG): string => applyXslt(xml, xsl);

test('identity transform keeps elements, attributes, namespaces, comments and processing instructions', () => {
  const xml = `<?xml version="1.0"?>\n<?keep me?>\n<doc xmlns:x="urn:x"><x:p a="1">h&#233;llo <b>w</b></x:p><e/><!-- c --></doc>`;
  const identity = sheet('<xsl:template match="@*|node()"><xsl:copy><xsl:apply-templates select="@*|node()"/></xsl:copy></xsl:template>');
  assert.equal(run(identity, xml), '<?xml version="1.0"?>\n<?keep me?><doc xmlns:x="urn:x"><x:p a="1">héllo <b>w</b></x:p><e/><!-- c --></doc>\n');
  const copyAll = sheet(
    '<xsl:output cdata-section-elements="p:a" xmlns:p="urn:p"/><xsl:template match="/"><xsl:copy-of select="node()"/><xsl:apply-templates select="//processing-instruction()"/></xsl:template>' +
      `<xsl:template match="processing-instruction('target')"><xsl:value-of select="name()"/>=<xsl:value-of select="."/></xsl:template>`,
  );
  const xml2 = '<?xml version="1.0"?>\n<!DOCTYPE r>\n<!-- lead -->\n<r xmlns:p="urn:p"><p:a xml:lang="en" p:x="1"><![CDATA[<cdata>]]></p:a><?target data here?><b xmlns="urn:b"><c/></b></r>';
  assert.equal(run(copyAll, xml2), '<?xml version="1.0"?>\n<!-- lead -->\n<r xmlns:p="urn:p"><p:a xml:lang="en" p:x="1"><![CDATA[<cdata>]]></p:a><?target data here?><b xmlns="urn:b"><c/></b></r>target=data here\n');
});

test('built-in templates copy text through', () => {
  assert.equal(run(sheet('')), '<?xml version="1.0"?>\n\n  ZebraAnn10.5fiction\n  appleBob20science\n  MangoAnn7.25fiction\n  bananaCy100history\n  \n\n');
  const modes = sheet(
    '<xsl:output method="text"/><xsl:strip-space elements="*"/>' +
      '<xsl:template match="/"><xsl:apply-templates mode="toc"/>/<xsl:apply-templates select="catalog/book[1]"/></xsl:template>' +
      '<xsl:template match="title" mode="toc"><xsl:value-of select="."/>.</xsl:template><xsl:template match="text()" mode="toc"/>' +
      '<xsl:template match="book"><xsl:value-of select="name(..)"/>:<xsl:apply-templates select="@*"/>:<xsl:apply-templates select="following-sibling::book[1]/title"/></xsl:template>' +
      `<xsl:template match="book/title"><xsl:value-of select="translate(., 'abc', 'ABC')"/></xsl:template>`,
  );
  assert.equal(run(modes), 'Zebra.apple.Mango.banana./catalog:b1en:Apple');
});

test('template conflict resolution: priorities, predicates, attributes and comments', () => {
  const xsl = sheet(`<xsl:output method="text"/>
<xsl:template match="/"><xsl:apply-templates select="//book | //book/@lang | //comment()"/></xsl:template>
<xsl:template match="*">[any <xsl:value-of select="name()"/>]</xsl:template>
<xsl:template match="book">[book <xsl:value-of select="@id"/>]</xsl:template>
<xsl:template match="book[@lang='en']">[en <xsl:value-of select="@id"/>]</xsl:template>
<xsl:template match="catalog/book[cat='history']" priority="-1">[low <xsl:value-of select="@id"/>]</xsl:template>
<xsl:template match="book[4]" priority="2">[fourth]</xsl:template>
<xsl:template match="@*">[attr <xsl:value-of select="."/>]</xsl:template>
<xsl:template match="@lang[.='fr']">[french]</xsl:template>
<xsl:template match="comment()">[comment<xsl:value-of select="."/>]</xsl:template>`);
  assert.equal(run(xsl), '[en b1][attr en][book b2][french][en b3][attr en][fourth][attr de][comment end ]');
});

test('grouping with keys (Muenchian method) and indented output', () => {
  const xsl = sheet(`<xsl:output indent="yes"/>
<xsl:key name="by-cat" match="book" use="cat"/>
<xsl:template match="/">
  <groups>
    <xsl:for-each select="//book[generate-id() = generate-id(key('by-cat', cat)[1])]">
      <xsl:sort select="cat"/>
      <group name="{cat}" count="{count(key('by-cat', cat))}">
        <xsl:for-each select="key('by-cat', cat)"><xsl:sort select="title" order="descending"/><t><xsl:value-of select="title"/></t></xsl:for-each>
      </group>
    </xsl:for-each>
  </groups>
</xsl:template>`);
  assert.equal(
    run(xsl),
    '<?xml version="1.0"?>\n<groups>\n  <group name="fiction" count="2">\n    <t>Zebra</t>\n    <t>Mango</t>\n  </group>\n' +
      '  <group name="history" count="1">\n    <t>banana</t>\n  </group>\n  <group name="science" count="1">\n    <t>apple</t>\n  </group>\n</groups>\n',
  );
});

test('sorting: text, number, order, several keys and NaN', () => {
  const xsl = sheet(`<xsl:output method="text"/>
<xsl:template match="/catalog">
  <xsl:for-each select="book"><xsl:sort select="price" data-type="number" order="descending"/><xsl:value-of select="concat(@id, ':', price, ' ')"/></xsl:for-each>
  <xsl:text>|</xsl:text>
  <xsl:for-each select="book"><xsl:sort select="title"/><xsl:value-of select="title"/>,</xsl:for-each>
  <xsl:text>|</xsl:text>
  <xsl:apply-templates select="book"><xsl:sort select="author"/><xsl:sort select="price" data-type="number"/></xsl:apply-templates>
</xsl:template>
<xsl:template match="book"><xsl:value-of select="position()"/>=<xsl:value-of select="@id"/><xsl:if test="position() != last()">;</xsl:if></xsl:template>`);
  assert.equal(run(xsl), 'b4:100 b2:20 b1:10.5 b3:7.25 |Mango,Zebra,apple,banana,|1=b3;2=b1;3=b2;4=b4');
  const more = sheet(`<xsl:output method="text"/><xsl:template match="/"><xsl:for-each select="//title"><xsl:sort select="." order="descending"/><xsl:value-of select="."/>,</xsl:for-each>|<xsl:for-each select="//book"><xsl:sort select="string-length(title)" data-type="number"/><xsl:sort select="@id" order="descending"/><xsl:value-of select="@id"/>,</xsl:for-each>|<xsl:for-each select="//book"><xsl:sort select="@missing" data-type="number"/><xsl:value-of select="@id"/></xsl:for-each></xsl:template>`);
  assert.equal(run(more), 'banana,apple,Zebra,Mango,|b3,b2,b1,b4,|b1b2b3b4');
  // case-order (not checked against libxslt, which ignores it): case-insensitive, then by case.
  const cases = sheet('<xsl:output method="text"/><xsl:template match="/"><xsl:for-each select="//w"><xsl:sort select="." case-order="lower-first"/><xsl:value-of select="."/>,</xsl:for-each></xsl:template>');
  assert.equal(run(cases, '<r><w>b</w><w>A</w><w>a</w><w>B</w></r>'), 'a,A,b,B,');
});

test('xsl:number: levels, count/from, formats and grouping', () => {
  const xml = '<doc><ch><title>A</title><sec><title>A1</title></sec><sec><title>A2</title><sec><title>A2a</title></sec></sec></ch><ch><title>B</title><sec><title>B1</title></sec></ch></doc>';
  const xsl = sheet(`<xsl:output method="text"/>
<xsl:template match="title">
<xsl:number level="multiple" count="ch|sec" format="1.1 "/>
<xsl:number level="any" count="title" format="(a) "/>
<xsl:number level="any" count="sec" from="ch" format="i "/>
<xsl:number count="ch|sec" format="I "/>
<xsl:number level="multiple" count="ch|sec" format="A-01 "/>
<xsl:value-of select="."/><xsl:text>&#10;</xsl:text>
</xsl:template>
<xsl:template match="/"><xsl:apply-templates select="//title"/><xsl:number value="1234567" grouping-separator="," grouping-size="3"/>;<xsl:number value="3.5" format="01"/>;<xsl:number value="28" format="a"/>;<xsl:number value="1999" format="I"/></xsl:template>`);
  assert.equal(
    run(xsl, xml),
    '1 (a) 0 I A A\n1.1 (b) i I A-01 A1\n1.2 (c) ii II A-02 A2\n1.2.1 (d) iii I A-02-01 A2a\n2 (e) 0 II B B\n2.1 (f) i I B-01 B1\n1,234,567;04;ab;MCMXCIX',
  );
  const plain = sheet('<xsl:output method="text"/><xsl:template match="book"><xsl:number/>.</xsl:template><xsl:template match="text()"/>');
  assert.equal(run(plain), '1.2.3.4.');
});

test('variables, params, result tree fragments, attribute sets and functions', () => {
  const xsl = sheet(`
<xsl:variable name="total" select="sum(//price)"/>
<xsl:variable name="doubled" select="$half * 4"/>
<xsl:variable name="half" select="$total div 2"/>
<xsl:param name="label">Total</xsl:param>
<xsl:variable name="rtf"><a>1</a><a>2</a></xsl:variable>
<xsl:attribute-set name="base"><xsl:attribute name="kind">book</xsl:attribute><xsl:attribute name="v">1</xsl:attribute></xsl:attribute-set>
<xsl:attribute-set name="more" use-attribute-sets="base"><xsl:attribute name="v">2</xsl:attribute></xsl:attribute-set>
<xsl:template match="/">
  <report label="{$label}" total="{$total}" doubled="{$doubled}" rtf="{$rtf}" braces="{{x}}">
    <xsl:call-template name="row"><xsl:with-param name="n" select="3"/></xsl:call-template>
    <xsl:call-template name="row"/>
    <xsl:apply-templates select="//book[price &gt; 10]" mode="m"><xsl:with-param name="pfx" select="'#'"/></xsl:apply-templates>
    <xsl:copy-of select="$rtf"/>
    <xsl:variable name="local" select="'L'"/>
    <xsl:for-each select="//book[1]"><v local="{$local}" cur="{current()/@id}" pos="{position()}"/></xsl:for-each>
    <xsl:choose><xsl:when test="$total &lt; 10">small</xsl:when><xsl:when test="$total &lt; 1000">medium</xsl:when><xsl:otherwise>large</xsl:otherwise></xsl:choose>
    <fmt><xsl:value-of select="format-number(1234567.891, '#,##0.00')"/>;<xsl:value-of select="format-number(0.256, '0.0%')"/>;<xsl:value-of select="format-number(-5, '000')"/>;<xsl:value-of select="format-number(3.14159, '#.###')"/>;<xsl:value-of select="format-number(-2.5, '#;(#)')"/>;<xsl:value-of select="format-number(0, '#.##')"/></fmt>
    <sys><xsl:value-of select="system-property('xsl:version')"/>;<xsl:value-of select="function-available('key')"/>;<xsl:value-of select="function-available('nope')"/>;<xsl:value-of select="element-available('xsl:if')"/>;<xsl:value-of select="element-available('xsl:foo')"/>;<xsl:value-of select="count(document('')/*/xsl:template)"/></sys>
  </report>
</xsl:template>
<xsl:template name="row"><xsl:param name="n" select="1"/><row n="{$n}" xsl:use-attribute-sets="more"/></xsl:template>
<xsl:template match="book" mode="m"><xsl:param name="pfx"/><m><xsl:value-of select="concat($pfx, @id)"/></m></xsl:template>`);
  assert.equal(
    run(xsl),
    '<?xml version="1.0"?>\n<report label="Total" total="137.75" doubled="275.5" rtf="12" braces="{x}"><row v="2" kind="book" n="3"/><row v="2" kind="book" n="1"/>' +
      '<m>#b1</m><m>#b2</m><m>#b4</m><a>1</a><a>2</a><v local="L" cur="b1" pos="1"/>medium' +
      '<fmt>1,234,567.89;25.6%;-005;3.142;(3);0</fmt><sys>1.0;true;false;true;false;3</sys></report>\n',
  );
  const recurse = sheet(`<xsl:output method="text"/>
<xsl:template match="/"><xsl:call-template name="fact"><xsl:with-param name="n" select="10"/></xsl:call-template>,<xsl:call-template name="join"><xsl:with-param name="items" select="//title"/></xsl:call-template></xsl:template>
<xsl:template name="fact"><xsl:param name="n"/><xsl:param name="acc" select="1"/><xsl:choose><xsl:when test="$n &lt;= 1"><xsl:value-of select="$acc"/></xsl:when><xsl:otherwise><xsl:call-template name="fact"><xsl:with-param name="n" select="$n - 1"/><xsl:with-param name="acc" select="$acc * $n"/></xsl:call-template></xsl:otherwise></xsl:choose></xsl:template>
<xsl:template name="join"><xsl:param name="items"/><xsl:for-each select="$items"><xsl:if test="position() > 1">+</xsl:if><xsl:value-of select="."/></xsl:for-each></xsl:template>`);
  assert.equal(run(recurse), '3628800,Zebra+apple+Mango+banana');
});

test('creating nodes: copy, element, attribute, comment, processing-instruction, text, fallback', () => {
  const xsl = `<xsl:stylesheet version="1.1" ${XSL}>
<xsl:template match="/">
<misc>
<xsl:text>  keep  </xsl:text>
<xsl:copy-of select="//book[1]"/>
<xsl:for-each select="//book[2]"><xsl:copy><xsl:attribute name="new">n</xsl:attribute><xsl:copy-of select="@id"/></xsl:copy></xsl:for-each>
<xsl:element name="{name(//book[1]/*[2])}"><xsl:value-of select="//book[last()]/title"/></xsl:element>
<xsl:comment>c<xsl:value-of select="1+1"/></xsl:comment>
<xsl:processing-instruction name="go">now</xsl:processing-instruction>
<xsl:if test="not(//nothing)"><none/></xsl:if>
<x a="&lt;&quot;&amp;" t="a&#9;b&#10;c">&lt;&amp;&gt;"'</x>
<id-equal><xsl:value-of select="generate-id(//book[1]) = generate-id(/catalog/book[1])"/>,<xsl:value-of select="generate-id(//book[1]) = generate-id(//book[2])"/></id-equal>
<xsl:message>hello</xsl:message>
<ext><xsl:fooble><xsl:fallback>fell back</xsl:fallback></xsl:fooble></ext>
</misc>
</xsl:template>
</xsl:stylesheet>`;
  assert.equal(
    run(xsl),
    '<?xml version="1.0"?>\n<misc>  keep  <book id="b1" lang="en"><title>Zebra</title><author>Ann</author><price>10.5</price><cat>fiction</cat></book>' +
      '<book new="n" id="b2"/><author>banana</author><!--c2--><?go now?><none/><x a="&lt;&quot;&amp;" t="a&#9;b&#10;c">&lt;&amp;&gt;"\'</x>' +
      '<id-equal>true,false</id-equal><ext>fell back</ext></misc>\n',
  );
});

test('namespaces: exclude-result-prefixes, the XSLT namespace, xsl:element/attribute namespaces', () => {
  const xml = '<r xmlns="urn:default" xmlns:a="urn:a"><a:item a:k="1" plain="p"><sub/></a:item><other xmlns="">x</other></r>';
  const xsl = sheet(
    `<xsl:template match="/d:r"><out xmlns:lre="urn:lre" lre:at="v"><xsl:apply-templates/><e xsl:exclude-result-prefixes="lre"/><xsl:element name="a:made"><xsl:attribute name="a:x">1</xsl:attribute></xsl:element><xsl:element name="n" namespace="urn:n"/></out></xsl:template>
<xsl:template match="a:item"><xsl:copy><xsl:copy-of select="@*"/><name><xsl:value-of select="name()"/>|<xsl:value-of select="local-name()"/>|<xsl:value-of select="namespace-uri()"/></name><xsl:apply-templates/></xsl:copy></xsl:template>
<xsl:template match="d:sub"><found/></xsl:template>
<xsl:template match="other"><xsl:copy-of select="."/></xsl:template>`,
    'xmlns:d="urn:default" xmlns:a="urn:a" xmlns:keep="urn:keep" xmlns:drop="urn:drop" exclude-result-prefixes="d drop"',
  );
  assert.equal(
    run(xsl, xml),
    '<?xml version="1.0"?>\n<out xmlns:lre="urn:lre" xmlns:a="urn:a" xmlns:keep="urn:keep" lre:at="v"><a:item a:k="1" plain="p"><name>a:item|item|urn:a</name><found/></a:item>' +
      '<other xmlns="">x</other><e/><a:made a:x="1"/><n xmlns="urn:n"/></out>\n',
  );
  const generated = sheet('<xsl:template match="/"><r xmlns="urn:d"><xsl:element name="k" namespace="urn:k"><xsl:attribute name="y:at" namespace="urn:y">1</xsl:attribute><xsl:attribute name="z" namespace="urn:z">2</xsl:attribute></xsl:element><xsl:element name="m"/><n xmlns=""/></r></xsl:template>');
  assert.equal(run(generated), '<?xml version="1.0"?>\n<r xmlns="urn:d"><k xmlns="urn:k" xmlns:y="urn:y" xmlns:ns_1="urn:z" y:at="1" ns_1:z="2"/><m/><n xmlns=""/></r>\n');
});

test('strip-space and preserve-space', () => {
  const xml = '<r>\n  <a> <b> </b> </a>\n  <pre> <b> </b> </pre>\n</r>';
  const xsl = sheet('<xsl:strip-space elements="*"/><xsl:preserve-space elements="pre"/><xsl:template match="/"><xsl:copy-of select="."/>|<xsl:value-of select="count(//text())"/></xsl:template>');
  assert.equal(run(xsl, xml), '<?xml version="1.0"?>\n<r><a><b/></a><pre> <b/> </pre></r>|2\n');
});

test('output method xml: declaration, encoding label, standalone, doctype, indent, omit-xml-declaration', () => {
  const xsl = sheet(`<xsl:output method="xml" encoding="ISO-8859-1" doctype-system="cat.dtd" doctype-public="-//X//DTD Cat//EN" indent="yes" standalone="yes"/>
<xsl:template match="/"><cat><xsl:comment> generated </xsl:comment><xsl:processing-instruction name="pi">x="1"</xsl:processing-instruction><xsl:apply-templates select="//book[1]"/></cat></xsl:template>
<xsl:template match="book"><item><xsl:copy-of select="@*|title"/><mixed>t<b/></mixed></item></xsl:template>`);
  assert.equal(
    run(xsl),
    '<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>\n<!DOCTYPE cat PUBLIC "-//X//DTD Cat//EN" "cat.dtd">\n<cat>\n  <!-- generated -->\n  <?pi x="1"?>\n' +
      '  <item id="b1" lang="en">\n    <title>Zebra</title>\n    <mixed>t<b/></mixed>\n  </item>\n</cat>\n',
  );
  assert.equal(run(sheet('<xsl:output omit-xml-declaration="yes"/><xsl:template match="/"><r><xsl:value-of select="count(//book)"/></r></xsl:template>')), '<r>4</r>\n');
  const indent = sheet('<xsl:output indent="yes" omit-xml-declaration="yes"/><xsl:template match="/"><xsl:comment>top</xsl:comment><list><xsl:for-each select="//book[position() &lt; 2]"><item id="{@id}"><name><xsl:value-of select="title"/></name><empty/><deep><x><y/></x></deep></item></xsl:for-each></list></xsl:template>');
  assert.equal(run(indent), '<!--top-->\n<list>\n  <item id="b1">\n    <name>Zebra</name>\n    <empty/>\n    <deep>\n      <x>\n        <y/>\n      </x>\n    </deep>\n  </item>\n</list>\n');
});

test('output method html: no declaration, void elements, boolean attributes, the Content-Type meta, formatting', () => {
  const xsl = sheet('<xsl:output method="html"/><xsl:template match="/"><html><head><title>Books</title></head><body><h1>List</h1><table><xsl:for-each select="//book[position() &lt; 3]"><tr><td><xsl:value-of select="title"/></td><td><input type="checkbox" checked="checked" name="b{position()}"/></td></tr></xsl:for-each></table><p>Line<br/>two &amp; <b>bold</b></p><hr/></body></html></xsl:template>');
  assert.equal(
    run(xsl),
    '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n<title>Books</title>\n</head>\n<body>\n<h1>List</h1>\n<table>\n' +
      '<tr>\n<td>Zebra</td>\n<td><input type="checkbox" checked name="b1"></td>\n</tr>\n<tr>\n<td>apple</td>\n<td><input type="checkbox" checked name="b2"></td>\n</tr>\n' +
      '</table>\n<p>Line<br>two &amp; <b>bold</b></p>\n<hr>\n</body>\n</html>\n',
  );
  const doctype = sheet(`<xsl:output method="html" doctype-public="-//W3C//DTD HTML 4.01//EN" doctype-system="http://www.w3.org/TR/html4/strict.dtd"/><xsl:template match="/"><html><head><meta http-equiv="Content-Type" content="text/html"/><style>a > b {}</style></head><body><ul><xsl:for-each select="//book[1]"><li class="x&quot;y"><a href="p?id={@id}&amp;x=1"><xsl:value-of select="title"/></a></li></xsl:for-each></ul><div/><select><option selected="selected">1</option><option>2</option></select><pre>a
b</pre></body></html></xsl:template>`);
  assert.equal(
    run(doctype),
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">\n<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n' +
      '<style>a > b {}</style>\n</head>\n<body>\n<ul><li class=\'x"y\'><a href="p?id=b1&amp;x=1">Zebra</a></li></ul>\n<div></div>\n' +
      '<select><option selected>1</option>\n<option>2</option></select><pre>a\nb</pre>\n</body>\n</html>\n',
  );
  // With no xsl:output, an <html> root element picks the html method.
  assert.equal(run(sheet('<xsl:template match="/"><HTML><body><img src="a.png"/><p/></body></HTML></xsl:template>')), '<HTML><body>\n<img src="a.png"><p></p>\n</body></HTML>\n');
  // A literal result element as the stylesheet.
  const simplified = `<html xsl:version="1.0" ${XSL}><body><xsl:for-each select="//book"><p><xsl:value-of select="title"/></p></xsl:for-each></body></html>`;
  assert.equal(run(simplified), '<html><body>\n<p>Zebra</p>\n<p>apple</p>\n<p>Mango</p>\n<p>banana</p>\n</body></html>\n');
});

test('output method text', () => {
  const xsl = sheet('<xsl:output method="text" encoding="UTF-8"/><xsl:strip-space elements="*"/><xsl:template match="book"><xsl:value-of select="title"/> &lt;<xsl:value-of select="author"/>&gt;<xsl:text>&#10;</xsl:text></xsl:template>');
  assert.equal(run(xsl), 'Zebra <Ann>\napple <Bob>\nMango <Ann>\nbanana <Cy>\n');
});

test('xsl:message, and errors with clear messages', () => {
  const messages: string[] = [];
  applyXslt('<a/>', sheet('<xsl:template match="/"><xsl:message>note <xsl:value-of select="name(*)"/></xsl:message></xsl:template>'), { onMessage: (m) => messages.push(m) });
  assert.deepEqual(messages, ['note a']);
  assert.equal(applyXslt('<a/>', sheet('<xsl:template match="/"/>')), '');
  const throws = (xml: string, xsl: string, re: RegExp) => assert.throws(() => applyXslt(xml, xsl), (e: unknown) => e instanceof XsltError && re.test((e as Error).message));
  throws(CATALOG, sheet('<xsl:template match="/"><xsl:message terminate="yes">Stop <xsl:value-of select="count(//book)"/></xsl:message></xsl:template>'), /terminated.*Stop 4/);
  throws('<a>', sheet(''), /Bad source XML/);
  throws('<a/>', '<xsl:stylesheet', /Bad stylesheet/);
  throws('<a/>', '<root/>', /root element/);
  throws('<a/>', sheet('<xsl:include href="x.xsl"/>'), /xsl:include is not supported/);
  throws('<a/>', sheet('<xsl:import href="x.xsl"/>'), /xsl:import is not supported/);
  throws('<a/>', sheet('<xsl:template match="/"><xsl:value-of select="1 +"/></xsl:template>'), /XPath.*select="1 \+"/);
  throws('<a/>', sheet('<xsl:template match="/"><xsl:value-of select="$nope"/></xsl:template>'), /Undefined variable \$nope/);
  throws('<a/>', sheet('<xsl:template match="/"><xsl:call-template name="missing"/></xsl:template>'), /No template named "missing"/);
  throws('<a/>', sheet('<xsl:template match="a/following::b"/>'), /Invalid XSLT pattern/);
  throws('<a/>', sheet('<xsl:template match="/"><xsl:bogus/></xsl:template>'), /Unknown XSLT instruction xsl:bogus/);
  throws('<a/>', sheet('<xsl:template match="/"><xsl:value-of select="key(\'k\', 1)"/></xsl:template>'), /No xsl:key named "k"/);
  throws('<a/>', sheet('<xsl:template match="/"><xsl:call-template name="loop"/></xsl:template><xsl:template name="loop"><xsl:call-template name="loop"/></xsl:template>'), /recursion too deep/);
});

// Import and Export Records with "Specify XML and XSL Options" (help.claris.com "XML format"): an XSLT style sheet
// turns other XML into FMPXMLRESULT before an import, and turns an FMPXMLRESULT or FMPDSORESULT export into other XML,
// HTML or text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptText, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { importFileRows, runScript } from '../src/index.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-xslt-'));
  createStore(join(dir, 'Target.sqlite'));
  const store = new Store(join(dir, 'Target.sqlite'), 'Target');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [
    { name: 'Full Name', type: 'text' }, { name: 'City', type: 'text' }, { name: '2nd', type: 'text' },
  ] }] as never);
  const run = async (step: string, foundSet?: number[]) => {
    const steps = parseScriptText(step, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
    return runScript(store, { id: 1, name: 'Run', steps } as Script, { layout: 'People', documents: dir, foundSet });
  };
  const rows = (ids: number[] | undefined) => (ids ?? []).map((id) => store.get('People', id).fieldData);
  const add = (data: Record<string, string>) => store.create('People', data, { performAutoEnter: false }).recordId;
  return { dir, store, run, rows, add, close: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

const IMPORT = (xslt: string) => `Import Records [ With dialog: Off ; Table: People ; Source: “people.xml” ; XSLT: “${xslt}” ; Add ; Fields: People::Full Name, People::City ]`;

// Other XML in, FMPXMLRESULT out.
const TO_FM = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml"/>
  <xsl:template match="/people">
    <FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult"><METADATA><FIELD NAME="Full Name"/><FIELD NAME="City"/></METADATA><RESULTSET>
      <xsl:for-each select="person"><ROW><COL><DATA><xsl:value-of select="@first"/><xsl:text> </xsl:text><xsl:value-of select="@last"/></DATA></COL><COL><DATA><xsl:value-of select="city"/></DATA></COL></ROW></xsl:for-each>
    </RESULTSET></FMPXMLRESULT>
  </xsl:template>
</xsl:stylesheet>`;
const PEOPLE = '<people><person first="Ada" last="Lovelace"><city>London</city></person><person first="Grace" last="Hopper"><city>New York &amp; Arlington</city></person></people>';

test('Import Records applies an XSLT style sheet to other XML before it reads FMPXMLRESULT', async () => {
  const s = setup();
  try {
    writeFileSync(join(s.dir, 'people.xml'), PEOPLE);
    writeFileSync(join(s.dir, 'to-fm.xsl'), TO_FM);
    const r = await s.run(IMPORT('to-fm.xsl'));
    assert.equal(r.error, 0);
    assert.deepEqual(s.rows(r.foundSet).map((x) => [x['Full Name'], x.City]), [['Ada Lovelace', 'London'], ['Grace Hopper', 'New York & Arlington']]);
  } finally { s.close(); }
});

test('Import Records without a style sheet still takes only FMPXMLRESULT, and with one the result must be FMPXMLRESULT (954)', async () => {
  const s = setup();
  try {
    writeFileSync(join(s.dir, 'people.xml'), PEOPLE);
    writeFileSync(join(s.dir, 'copy.xsl'), '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><other/></xsl:template></xsl:stylesheet>');
    assert.equal((await s.run(IMPORT('copy.xsl').replace('XSLT: “copy.xsl” ; ', ''))).error, 3);
    assert.equal((await s.run(IMPORT('copy.xsl'))).error, 954);
    assert.equal(s.store.findIds('People').length, 0);
  } finally { s.close(); }
});

test('Import Records reports a bad document (718), a bad or failing style sheet (718, 719) and a missing one (100)', async () => {
  const s = setup();
  try {
    writeFileSync(join(s.dir, 'people.xml'), PEOPLE);
    writeFileSync(join(s.dir, 'to-fm.xsl'), TO_FM);
    writeFileSync(join(s.dir, 'broken.xsl'), '<xsl:stylesheet');
    writeFileSync(join(s.dir, 'stop.xsl'), '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><xsl:message terminate="yes">no</xsl:message></xsl:template></xsl:stylesheet>');
    assert.equal((await s.run(IMPORT('broken.xsl'))).error, 718);
    assert.equal((await s.run(IMPORT('stop.xsl'))).error, 719);
    assert.equal((await s.run(IMPORT('absent.xsl'))).error, 100);
    writeFileSync(join(s.dir, 'people.xml'), '<people><person>');
    assert.equal((await s.run(IMPORT('to-fm.xsl'))).error, 718);
    assert.equal(s.store.findIds('People').length, 0);
  } finally { s.close(); }
});

test('importFileRows applies a style sheet given as text and refuses an Excel source', () => {
  const rows = importFileRows('people.xml', new TextEncoder().encode(PEOPLE), undefined, TO_FM);
  assert.deepEqual(rows, [['Ada Lovelace', 'London'], ['Grace Hopper', 'New York & Arlington']]);
  assert.throws(() => importFileRows('people.xlsx', new Uint8Array(), undefined, TO_FM), /Excel/);
});

const EXPORT = (more: string) => `Export Records [ With dialog: Off ; “out.xml” ; ${more} ; Fields: People::Full Name, People::City, People::2nd ]`;
const EXPORT_DSO = `Export Records [ With dialog: Off ; “out.xml” ; Grammar: FMPDSORESULT ; Fields: People::Full Name, People::City ]`;

test('Export Records writes FMPDSORESULT: a ROW per record with an element per field, named as Claris says', async () => {
  const s = setup();
  try {
    const a = s.add({ 'Full Name': 'Ada & <Co>', City: 'London' });
    const b = s.add({ 'Full Name': 'Grace', City: '' });
    const r = await s.run(EXPORT_DSO, [a, b]);
    assert.equal(r.error, 0);
    const xml = readFileSync(join(s.dir, 'out.xml'), 'utf8');
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><FMPDSORESULT xmlns="http:\/\/www.filemaker.com\/fmpdsoresult"><ERRORCODE>0<\/ERRORCODE><DATABASE>Target<\/DATABASE><LAYOUT>/);
    assert.ok(xml.includes(`<ROW MODID="0" RECORDID="${a}"><Full_Name>Ada &amp; &lt;Co&gt;</Full_Name><City>London</City></ROW>`));
    assert.ok(xml.includes(`<ROW MODID="0" RECORDID="${b}"><Full_Name>Grace</Full_Name><City></City></ROW>`));
    assert.ok(xml.endsWith('</FMPDSORESULT>'));
  } finally { s.close(); }
});

test('Export Records refuses a field that cannot be an FMPDSORESULT element name', async () => {
  const s = setup();
  try {
    const a = s.add({ 'Full Name': 'Ada' });
    const r = await s.run(EXPORT('Grammar: FMPDSORESULT'), [a]);
    assert.equal(r.error, 954);
  } finally { s.close(); }
});

test('Export Records applies an XSLT style sheet to the grammar: to text, HTML or other XML, whatever the file is called', async () => {
  const s = setup();
  try {
    const a = s.add({ 'Full Name': 'Ada', City: 'London' });
    const b = s.add({ 'Full Name': 'Grace', City: 'New York' });
    writeFileSync(join(s.dir, 'dso-text.xsl'), `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:d="http://www.filemaker.com/fmpdsoresult">
      <xsl:output method="text"/>
      <xsl:template match="/"><xsl:for-each select="d:FMPDSORESULT/d:ROW"><xsl:value-of select="d:Full_Name"/>|<xsl:value-of select="d:City"/><xsl:text>&#10;</xsl:text></xsl:for-each></xsl:template>
    </xsl:stylesheet>`);
    const text = await s.run(`Export Records [ With dialog: Off ; “people.txt” ; Grammar: FMPDSORESULT ; XSLT: “dso-text.xsl” ; Fields: People::Full Name, People::City ]`, [a, b]);
    assert.equal(text.error, 0);
    assert.equal(readFileSync(join(s.dir, 'people.txt'), 'utf8'), 'Ada|London\nGrace|New York\n');

    // Default grammar is FMPXMLRESULT.
    writeFileSync(join(s.dir, 'fm-html.xsl'), `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="http://www.filemaker.com/fmpxmlresult">
      <xsl:output method="xml" indent="no"/>
      <xsl:template match="/f:FMPXMLRESULT"><names count="{f:DATABASE/@RECORDS}"><xsl:for-each select="f:RESULTSET/f:ROW"><n><xsl:value-of select="f:COL[1]/f:DATA"/></n></xsl:for-each></names></xsl:template>
    </xsl:stylesheet>`);
    const xml = await s.run(`Export Records [ With dialog: Off ; “names.xml” ; XSLT: “fm-html.xsl” ; Fields: People::Full Name ]`, [a, b]);
    assert.equal(xml.error, 0);
    assert.match(readFileSync(join(s.dir, 'names.xml'), 'utf8'), /<names [^>]*count="2"><n>Ada<\/n><n>Grace<\/n><\/names>/);
  } finally { s.close(); }
});

test('Export Records reports a failing style sheet (719) and writes nothing', async () => {
  const s = setup();
  try {
    const a = s.add({ 'Full Name': 'Ada' });
    writeFileSync(join(s.dir, 'stop.xsl'), '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><xsl:message terminate="yes">no</xsl:message></xsl:template></xsl:stylesheet>');
    const r = await s.run(`Export Records [ With dialog: Off ; “out.xml” ; XSLT: “stop.xsl” ; Fields: People::Full Name ]`, [a]);
    assert.equal(r.error, 719);
    assert.equal((await s.run(`Export Records [ With dialog: Off ; “out.xml” ; XSLT: “absent.xsl” ; Fields: People::Full Name ]`, [a])).error, 100);
    assert.throws(() => readFileSync(join(s.dir, 'out.xml')), /ENOENT/);
  } finally { s.close(); }
});

test('The XML options round-trip through script text', () => {
  const s = setup();
  try {
    const text = 'Export Records [ With dialog: Off ; “out.txt” ; Grammar: FMPDSORESULT ; XSLT: “t.xsl” ; Fields: People::City ]';
    const steps = parseScriptText(text, s.store.schema);
    assert.equal(steps[0].params?.xmlGrammar, 'FMPDSORESULT');
    assert.equal(steps[0].params?.xslt, 't.xsl');
    const again = scriptText([{ stepId: steps[0].stepId!, name: 'Export Records', enabled: true, params: steps[0].params }]);
    assert.match(again, /Grammar: FMPDSORESULT/);
    assert.match(again, /XSLT: “t\.xsl”/);
    assert.throws(() => parseScriptText('Export Records [ Grammar: FMPREPORT ]', s.store.schema), /Grammar/);
  } finally { s.close(); }
});

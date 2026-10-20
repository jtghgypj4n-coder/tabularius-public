import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, totpCode, type DesignOp, type Store } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

// Custom Web Publishing XML (/fmi/xml), reads only: the three grammars, the query commands, the operators, paging and
// sorting, the extended privilege, and the refusal of everything that would write or run a script.

let dir: string;
let server: Server;
let base: string;
let store: Store;
const ann = 'Basic ' + btoa('Ann:pw');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-cwp-xml-'));
  createStore(join(dir, 'X' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, listFilesPublicly: true });
  server = s.server;
  base = s.url;
  store = s.host.get('X')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [
      { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }, { name: 'Joined', type: 'date' },
      { name: 'Tags', options: { repetitions: 3 } }, { name: 'Secret' }, { name: 'Unplaced' },
    ] },
    { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }] },
    { op: 'createValueList', name: 'Cities', values: ['Oslo', 'Bergen'] },
    { op: 'createScript', name: 'Touch', text: 'Exit Script [ ]' },
    { op: 'createLayout', name: 'Plain', occurrence: 'Contacts' },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const listId = store.schema.valueLists.find((v) => v.name === 'Cities')!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let top = 0;
  let id = 100;
  const field = (table: string, name: string, extra: object = {}) => ({
    id: ++id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: top += 24, left: 20, bottom: top + 20, right: 300 },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display: 'edit', repetitions: 1, ...extra },
  }) as unknown as LayoutObject;
  const objects = [
    field('Contacts', 'Id'), field('Contacts', 'Name'), field('Contacts', 'City', { display: 'dropdown', valueListId: listId }),
    field('Contacts', 'Joined'), field('Contacts', 'Tags', { repetitions: 3 }), field('Contacts', 'Secret'), {
      id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 300, left: 20, bottom: 400, right: 300 },
      portal: { tableOccurrenceId: occ('Calls').id, tableOccurrence: 'Calls', rows: 4, initialRow: 1 }, children: [field('Calls', 'Note')],
    } as unknown as LayoutObject,
  ];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  const people: [number, string, string, string, string[]][] = [
    [1, 'Ada & <Co>', 'Oslo', '2024-03-05', ['red', 'blue']], [2, 'Bo', 'Bergen', '2023-01-02', []],
    [3, 'Cy', 'Oslo', '2022-07-09', ['x']], [4, 'Di', 'Trondheim', '2021-11-30', []],
  ];
  for (const [n, name, city, joined, tags] of people) {
    store.create('Contacts', { Id: n, Name: name, City: city, Joined: joined, Secret: 'hush', Unplaced: 'u', Tags: tags[0] ?? '', ...(tags[1] ? { 'Tags(2)': tags[1] } : {}) } as never);
  }
  store.create('Calls', { ContactId: 1, Note: 'hello' });
  store.create('Calls', { ContactId: 1, Note: 'again' });
  const full = store.privilegeSets().find((p) => p.name === '[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmxml'] });
  store.setPassword('Ann', 'pw', full.name);
  store.savePrivilegeSet({ name: 'No XML', extendedPrivileges: ['fmrest'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly', records: { view: true, edit: false, create: false, delete: false } } as never);
  store.setPassword('Bo', 'pw', 'No XML');
  store.savePrivilegeSet({
    name: 'Reader', extendedPrivileges: ['fmxml'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false }, tables: { Contacts: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' } } },
  } as never);
  store.setPassword('Cy', 'pw', 'Reader');
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function xml(grammar: string, query: string, headers: Record<string, string> = { authorization: ann }, init: RequestInit = {}) {
  const res = await fetch(`${base}/fmi/xml/${grammar}.xml?${query}`, { headers, ...init });
  return { res, text: await res.text() };
}
const fm = (query: string, who?: string) => xml('fmresultset', query, who ? { authorization: who } : undefined);
const code = (t: string) => /<error code="(\d+)"/.exec(t)?.[1] ?? /<ERRORCODE>(\d+)</.exec(t)?.[1];
const names = (t: string) => [...t.matchAll(/<field name="Name"><data>([^<]*)<\/data>/g)].map((m) => m[1].replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'));
const FIND = '-db=X&-lay=Contacts';

test('fmresultset -findall: metadata for the layout\'s fields only, then the records with their repetitions and portal rows', async () => {
  const { res, text } = await fm(`${FIND}&-findall`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /^text\/xml/);
  assert.match(text, /^<\?xml version="1.0" encoding="UTF-8" standalone="no"\?>\n<fmresultset xmlns="http:\/\/www\.filemaker\.com\/xml\/fmresultset" version="1\.0"><error code="0"\/>/);
  assert.match(text, /<datasource database="X" date-format="MM\/dd\/yyyy" layout="Contacts" table="Contacts" time-format="HH:mm:ss" timestamp-format="MM\/dd\/yyyy HH:mm:ss" total-count="4"\/>/);
  assert.match(text, /<field-definition [^>]*max-repeat="3" name="Tags"[^>]*\/>/);
  assert.match(text, /<field-definition [^>]*name="Joined"[^>]*result="date"/);
  assert.doesNotMatch(text, /name="Unplaced"/);
  assert.match(text, /<relatedset-definition table="Calls"><field-definition [^>]*name="Calls::Note"/);
  assert.match(text, /<resultset count="4" fetch-size="4">/);
  assert.deepEqual(names(text), ['Ada & <Co>', 'Bo', 'Cy', 'Di']);
  assert.match(text, /<field name="Name"><data>Ada &amp; &lt;Co&gt;<\/data><\/field>/);
  assert.match(text, /<field name="Tags"><data>red<\/data><data>blue<\/data><data><\/data><\/field>/);
  assert.match(text, /<field name="Joined"><data>03\/05\/2024<\/data><\/field>/);
  assert.match(text, /<relatedset count="2" table="Calls"><record [^>]*><field name="Calls::Note"><data>hello<\/data><\/field><\/record>/);
  assert.match(text, /<record mod-id="\d+" record-id="\d+">/);
});

test('FMPXMLRESULT: the same records as ROW/COL/DATA, with the portal as columns of its own', async () => {
  const { text } = await xml('FMPXMLRESULT', `${FIND}&-find&City=Oslo&City.op=eq&-sortfield.1=Name&-sortorder.1=descend`);
  assert.match(text, /^<\?xml[^>]*\?>\n<FMPXMLRESULT xmlns="http:\/\/www\.filemaker\.com\/fmpxmlresult"><ERRORCODE>0<\/ERRORCODE>/);
  assert.match(text, /<DATABASE DATEFORMAT="MM\/dd\/yyyy" LAYOUT="Contacts" NAME="X" RECORDS="4" TIMEFORMAT="HH:mm:ss"\/>/);
  assert.match(text, /<FIELD EMPTYOK="YES" MAXREPEAT="3" NAME="Tags" TYPE="TEXT"\/>/);
  assert.match(text, /<FIELD [^>]*NAME="Calls::Note" TYPE="TEXT"\/>/);
  assert.match(text, /<RESULTSET FOUND="2">/);
  const rows = [...text.matchAll(/<ROW [^>]*>(.*?)<\/ROW>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^<COL><DATA>3<\/DATA><\/COL><COL><DATA>Cy<\/DATA>/);
  assert.match(rows[1], /<COL><DATA>hello<\/DATA><DATA>again<\/DATA><\/COL>$/);
});

test('-find with no operator begins with, and the operators eq cn ew gt gte lt lte neq mean what the guide says', async () => {
  const f = async (q: string) => names((await fm(`${FIND}&-find&${q}`)).text);
  assert.deepEqual(await f('Name=B'), ['Bo']);
  assert.deepEqual(await f('Name=bo&Name.op=eq'), ['Bo']);
  assert.deepEqual(await f('Name=o&Name.op=eq'), []);
  assert.deepEqual(await f('Name=y&Name.op=cn'), ['Cy']);
  assert.deepEqual(await f('Name=i&Name.op=ew'), ['Di']);
  assert.deepEqual(await f('Id=2&Id.op=gt'), ['Cy', 'Di']);
  assert.deepEqual(await f('Id=2&Id.op=gte'), ['Bo', 'Cy', 'Di']);
  assert.deepEqual(await f('Id=2&Id.op=lt'), ['Ada & <Co>']);
  assert.deepEqual(await f('Id=2&Id.op=lte'), ['Ada & <Co>', 'Bo']);
  assert.deepEqual(await f('City=Oslo&City.op=neq'), ['Bo', 'Di']);
  assert.equal(code((await fm(`${FIND}&-find&Name=zzz`)).text), '401');
});

test('-lop=and needs every field to match and -lop=or either; neq can\'t be an or', async () => {
  const f = async (q: string) => (await fm(`${FIND}&-find&${q}`)).text;
  assert.deepEqual(names(await f('City=Oslo&Name=C')), ['Cy']);
  assert.deepEqual(names(await f('City=Oslo&Name=C&-lop=or')), ['Ada & <Co>', 'Cy']);
  assert.deepEqual(names(await f('City=Oslo&Name=Di&-lop=or')), ['Ada & <Co>', 'Cy', 'Di']);
  assert.equal(code(await f('City=Oslo&City.op=neq&Name=Bo&Name.op=neq')), '0');
  assert.deepEqual(names(await f('City=Oslo&City.op=neq&Name=Bo&Name.op=neq')), ['Di']);
  assert.equal(code(await f('City=Oslo&City.op=neq&-lop=or')), '960');
  assert.equal(code(await f('Name=B&Name.op=near')), '960');
  assert.equal(code(await f('Name=B&-lop=xor')), '960');
});

test('-findquery: commas and, semicolons or, and ! omits', async () => {
  const q = async (query: string, extra: string) => (await fm(`${FIND}&-findquery&-query=${encodeURIComponent(query)}&${extra}`)).text;
  const ex = '-q1=City&-q1.value=Oslo&-q2=Name&-q2.value=C&-q3=Id&-q3.value=4';
  assert.deepEqual(names(await q('(q1,q2)', ex)), ['Cy']);
  assert.deepEqual(names(await q('(q1);(q3)', ex)), ['Ada & <Co>', 'Cy', 'Di']);
  assert.deepEqual(names(await q('(q1);!(q2)', ex)), ['Ada & <Co>']);
  assert.equal(code(await q('(q1', ex)), '960');
  assert.equal(code(await q('(q9)', ex)), '958');
  assert.equal(code((await fm(`${FIND}&-findquery`)).text), '958');
});

test('-skip, -max and the sort fields page through a sorted found set', async () => {
  const page = async (q: string) => (await fm(`${FIND}&-findall&-sortfield.1=Name&-sortorder.1=descend&${q}`)).text;
  const t = await page('-skip=1&-max=2');
  assert.deepEqual(names(t), ['Cy', 'Bo']);
  assert.match(t, /<resultset count="4" fetch-size="2">/);
  assert.deepEqual(names(await page('-max=all')), ['Di', 'Cy', 'Bo', 'Ada & <Co>']);
  assert.deepEqual(names(await page('-skip=3')), ['Ada & <Co>']);
  assert.equal(code(await page('-max=-1')), '960');
  assert.equal(code(await page('-skip=x')), '960');
  const two = (await fm(`${FIND}&-findall&-sortfield.1=City&-sortfield.2=Name&-sortorder.2=descend`)).text;
  assert.deepEqual(names(two), ['Bo', 'Cy', 'Ada & <Co>', 'Di']);
});

test('-findany returns one record; -find -recid returns that record; -view with fmresultset is the metadata alone', async () => {
  const any = await fm(`${FIND}&-findany`);
  assert.match(any.text, /<resultset count="1" fetch-size="1">/);
  assert.match(any.text, /<datasource [^>]*total-count="4"/);
  const id = store.find('Contacts', { query: [{ Name: 'Bo' }] }).records[0].recordId;
  assert.deepEqual(names((await fm(`${FIND}&-find&-recid=${id}`)).text), ['Bo']);
  assert.equal(code((await fm(`${FIND}&-find&-recid=99999`)).text), '101');
  const view = (await fm(`${FIND}&-view`)).text;
  assert.match(view, /<metadata><field-definition/);
  assert.match(view, /<resultset count="0" fetch-size="0"><\/resultset>/);
});

test('-dbnames, -layoutnames and -scriptnames are lists of names in both result grammars', async () => {
  const dbs = (await fm('-dbnames', '')).text;
  assert.match(dbs, /<field-definition [^>]*name="DATABASE_NAME"/);
  assert.match(dbs, /<record mod-id="0" record-id="0"><field name="DATABASE_NAME"><data>X<\/data><\/field><\/record>/);
  const layouts = (await xml('FMPXMLRESULT', '-db=X&-layoutnames')).text;
  assert.match(layouts, /<FIELD [^>]*NAME="LAYOUT_NAME"/);
  assert.match(layouts, /<ROW [^>]*><COL><DATA>Contacts<\/DATA><\/COL><\/ROW>/);
  assert.match(layouts, /<COL><DATA>Plain<\/DATA><\/COL>/);
  const scripts = (await fm('-db=X&-scriptnames')).text;
  assert.match(scripts, /<data>Touch<\/data>/);
  assert.equal(code((await fm('-layoutnames')).text), '955');
});

test('FMPXMLLAYOUT -view: the layout\'s fields in order, how they are shown, and the value lists they use', async () => {
  const { text } = await xml('FMPXMLLAYOUT', `${FIND}&-view`);
  assert.match(text, /^<\?xml[^>]*\?>\n<FMPXMLLAYOUT xmlns="http:\/\/www\.filemaker\.com\/fmpxmllayout"><ERRORCODE>0<\/ERRORCODE>/);
  assert.match(text, /<LAYOUT DATABASE="X" NAME="Contacts"><FIELD NAME="Id"><STYLE TYPE="EDITTEXT" VALUELIST=""\/><\/FIELD><FIELD NAME="Name">/);
  assert.match(text, /<FIELD NAME="City"><STYLE TYPE="POPUPLIST" VALUELIST="Cities"\/><\/FIELD>/);
  assert.doesNotMatch(text, /Unplaced/);
  assert.match(text, /<VALUELISTS><VALUELIST NAME="Cities"><VALUE>Oslo<\/VALUE><VALUE>Bergen<\/VALUE><\/VALUELIST><\/VALUELISTS>/);
  assert.equal(code((await xml('FMPXMLLAYOUT', `${FIND}&-findall`)).text), '954');
  assert.equal(code((await xml('FMPXMLLAYOUT', '-dbnames')).text), '954');
});

test('-lay.response writes the records with another layout over the same table', async () => {
  const t = (await fm(`${FIND}&-find&Name=Bo&-lay.response=Plain`)).text;
  assert.match(t, /<datasource database="X" [^>]*layout="Plain"/);
  assert.equal(code((await fm(`${FIND}&-findall&-lay.response=Calls`)).text), '960');
  assert.equal(code((await fm(`${FIND}&-findall&-lay.response=Missing`)).text), '105');
});

test('every write command, and every script parameter, is refused', async () => {
  const before = store.find('Contacts', { limit: 1000 }).records.map((r) => r.fieldData.Name);
  for (const cmd of ['-new', '-edit&-recid=1', '-delete&-recid=1', '-dup&-recid=1']) {
    assert.equal(code((await fm(`${FIND}&${cmd}&Name=Zed`)).text), '3', cmd);
  }
  for (const p of ['-script=Touch', '-script.param=1', '-script.prefind=Touch', '-script.presort=Touch']) {
    assert.equal(code((await fm(`${FIND}&-findall&${p}`)).text), '960', p);
  }
  const post = await fetch(`${base}/fmi/xml/fmresultset.xml`, { method: 'POST', headers: { authorization: ann, 'content-type': 'application/x-www-form-urlencoded' }, body: `${FIND}&-new&Name=Zed` });
  assert.equal(code(await post.text()), '3');
  assert.equal((await fetch(`${base}/fmi/xml/fmresultset.xml?${FIND}&-findall`, { method: 'PUT', headers: { authorization: ann } })).status, 200);
  assert.deepEqual(store.find('Contacts', { limit: 1000 }).records.map((r) => r.fieldData.Name), before);
});

test('a POST form reads like the address, and a body of another type is refused', async () => {
  const post = (body: string, type = 'application/x-www-form-urlencoded') => fetch(`${base}/fmi/xml/fmresultset.xml`, { method: 'POST', headers: { authorization: ann, 'content-type': type }, body }).then((r) => r.text());
  assert.deepEqual(names(await post(`${FIND}&-find&Name=Bo`)), ['Bo']);
  assert.equal(code(await post('{}', 'application/json')), '960');
});

test('command and grammar errors are answered in the grammar asked for', async () => {
  assert.equal(code((await fm(`${FIND}`)).text), '4');
  assert.equal(code((await fm(`${FIND}&-findall&-find&Name=a`)).text), '957');
  assert.equal(code((await fm('-findall&-lay=Contacts')).text), '955');
  assert.equal(code((await fm('-findall&-db=X')).text), '105');
  assert.equal(code((await fm('-findall&-db=X&-lay=Missing')).text), '105');
  assert.equal(code((await fm(`${FIND}&-find&Nope=1`)).text), '102');
  assert.equal(code((await fm('-findall&-db=Missing&-lay=Contacts')).text), '802');
  const old = await xml('FMPDSORESULT', `${FIND}&-findall`);
  assert.equal(code(old.text), '954');
  const fmp = (await xml('FMPXMLRESULT', `${FIND}&-find&Name=zzz`)).text;
  assert.match(fmp, /<FMPXMLRESULT [^>]*><ERRORCODE>401<\/ERRORCODE>/);
  assert.match(fmp, /<RESULTSET FOUND="0"><\/RESULTSET>/);
  assert.equal(code((await xml('fmresultset', `${FIND}&-findall`, { authorization: ann }, { method: 'DELETE' })).text), '3');
});

test('sign-in is Basic on every request: none or a wrong password is a 401 with a challenge', async () => {
  const none = await xml('fmresultset', `${FIND}&-findall`, {});
  assert.equal(none.res.status, 401);
  assert.match(none.res.headers.get('www-authenticate')!, /^Basic realm="tabularius XML"/);
  assert.equal(code(none.text), '212');
  const wrong = await fm(`${FIND}&-findall`, 'Basic ' + btoa('Ann:nope'));
  assert.equal(wrong.res.status, 401);
});

test('HTTP Basic enforces TOTP and owed password changes; accounts without TOTP still work', async () => {
  store.setPassword('TwoFactorXML', 'pw', '[Full Access]');
  const { secret } = store.enrollTotp('TwoFactorXML');
  store.confirmTotp('TwoFactorXML', totpCode(secret));
  const query = `${FIND}&-findall`;
  const auth = 'Basic ' + btoa('TwoFactorXML:pw');
  const denied = await xml('fmresultset', query, { authorization: auth });
  assert.equal(denied.res.status, 401);
  assert.equal(code(denied.text), '1211');
  const accepted = await xml('fmresultset', query, { authorization: auth, 'x-tabularius-otp': totpCode(secret) });
  assert.equal(accepted.res.status, 200);
  assert.equal((await fm(query)).res.status, 200);
  store.setMustChangePassword('Ann', true);
  const forced = await fm(query);
  assert.equal(forced.res.status, 200, 'XML reports command errors in its response document');
  assert.equal(code(forced.text), '212');
});

test('an account needs the fmxml extended privilege', async () => {
  const r = await fm(`${FIND}&-findall`, 'Basic ' + btoa('Bo:pw'));
  assert.equal(r.res.status, 200);
  assert.equal(code(r.text), '9');
  assert.doesNotMatch(r.text, /Ada/);
});

test('field and layout privileges apply: a hidden field is not described or shown', async () => {
  const r = await fm(`${FIND}&-findall`, 'Basic ' + btoa('Cy:pw'));
  assert.equal(code(r.text), '0');
  assert.doesNotMatch(r.text, /Secret|hush/);
  assert.match(r.text, /name="Name"/);
  // Cy sees no scripts.
  assert.doesNotMatch((await fm('-db=X&-scriptnames', 'Basic ' + btoa('Cy:pw'))).text, /Touch/);
});

test('a server that does not list its files lists none, and refuses an unknown file as a hosted one refuses a stranger', async () => {
  const quiet = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const ask = (q: string, headers: Record<string, string> = {}) => fetch(`${quiet.url}/fmi/xml/fmresultset.xml?${q}`, { headers }).then(async (r) => ({ status: r.status, text: await r.text() }));
    assert.equal(code((await ask('-dbnames')).text), '3');
    const unknown = await ask('-db=Nope&-lay=L&-findall', { authorization: ann });
    assert.equal(unknown.status, 401);
    assert.equal(code(unknown.text), '212');
    assert.equal((await ask('-db=X&-lay=Contacts&-findall')).status, 401);
  } finally {
    await new Promise<void>((r) => quiet.server.close(() => r()));
  }
});

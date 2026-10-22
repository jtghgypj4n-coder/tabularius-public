// FMSaveAsXML ("Save a Copy as XML") skeleton serializer. The synthetic test is
// CI-runnable; the Flicks test round-trips a real .fmp12 schema and is gated on
// the fixture. Structure is checked against the shapes sampled from a public
// FMSaveAsXML export (nbourre/yada) — see research/export/save-as-xml.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { saveAsXml, uuidsFromSaveAsXml, parseXml, type XmlElement } from '../src/index.ts';
import { FmpDatabase, type Schema } from '../../fmp12/src/index.ts';

const all = (e: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] => {
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
};
const kids = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== 'string');
const root = (xml: string) => kids(parseXml(xml))[0];
const ids = (es: XmlElement[]) => es.map((e) => Number(e.attrs.id)).sort((a, b) => a - b);

test('Save as XML: envelope, catalog order, fields and metadata (synthetic)', () => {
  const schema = {
    tables: [
      {
        id: 129,
        name: 'taches',
        fields: [
          { id: 2, name: 'id', kind: 'normal', type: 'number', hasCalculation: false },
          { id: 4, name: 'titre', kind: 'calculation', type: 'text', hasCalculation: true, calculation: 'Left ( id ; 3 )', calculationContextId: 1065089 },
        ],
      },
      { id: 131, name: 'employes', fields: [{ id: 1, name: 'nom', kind: 'normal', type: 'text', hasCalculation: false }] },
    ],
    tableOccurrences: [
      { id: 1065089, name: 'T__TACHES', baseTableId: 129, graph: { left: 11, top: 2148, width: 167, height: 100 } },
      { id: 1065090, name: 'EMP', baseTableId: 131 },
      { id: 2000, name: 'EXT', baseTableId: 5, dataSourceId: 2 }, // external — must be skipped
    ],
    customFunctions: [
      { id: 1, name: 'Double', parameters: ['n'], formula: 'n * 2' },
      // A JavaScript function: its signature is created, but no calculation body.
      { id: 2, name: 'Slug', parameters: ['s'], formula: 'return s.toLowerCase()', language: 'javascript' },
    ],
    valueLists: [
      { id: 1, name: 'Statut', values: ['En cours', 'Terminé', 'En attente'] },
      { id: 2, name: 'Employés', field: { occurrenceId: 1065090, fieldId: 1 } },
      { id: 3, name: 'Remote', external: { dataSourceId: 2, valueListId: 9 } }, // external — must be skipped
    ],
    relationships: [
      {
        id: 50,
        leftTableOccurrenceId: 1065089,
        rightTableOccurrenceId: 1065090,
        predicates: [{ leftFieldId: 2, operator: '=', rightFieldId: 1 }],
        sorted: false,
        leftCreate: true,
        rightDelete: true,
      },
    ],
    privilegeSets: [
      { id: 1, name: '[Full Access]', comment: 'access to everything' },
      { id: 7, name: 'Sales', comment: '' },
    ],
    extendedPrivileges: [
      { id: 1, name: 'fmapp' },
      { id: 2, name: 'fmxdbc' },
    ],
    accounts: [
      { id: 1, name: 'Admin', privilegeSetId: 1 },
      // A password verifier on the account must NEVER reach the output.
      { id: 2, name: 'clerk', privilegeSetId: 7, passwordVerifier: '01deadbeefSECRETVERIFIER' },
    ],
  } as unknown as Schema;

  const xml = saveAsXml(schema, { fileName: 'demo.fmp12', source: '19.6.3' });
  const r = root(xml);

  // Envelope.
  assert.equal(r.name, 'FMSaveAsXML');
  assert.equal(r.attrs.version, '2.2.0.0');
  assert.equal(r.attrs.File, 'demo.fmp12');
  assert.equal(r.attrs.Source, '19.6.3');
  assert.equal(r.attrs.locale, 'English');
  assert.match(r.attrs.UUID!, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);

  // Structure ▸ AddAction, catalogs in canonical order.
  const add = all(r, 'AddAction')[0];
  const order = kids(add).map((c) => c.name);
  assert.deepEqual(order, [
    'BaseDirectoryCatalog', 'BaseTableCatalog', 'TableOccurrenceCatalog',
    'CustomFunctionsCatalog', 'FieldsForTables', 'ValueListCatalog', 'RelationshipCatalog',
    'CalcsForCustomFunctions',
    'PrivilegeSetsCatalog', 'ExtendedPrivilegesCatalog', 'AccountsCatalog',
  ]);
  assert.equal(add.attrs.membercount, '11');

  // Base tables.
  assert.deepEqual(ids(all(r, 'BaseTable')), [129, 131]);

  // Table occurrences: the external one is skipped; the local ones reference their base table.
  const occ = all(r, 'TableOccurrence');
  assert.deepEqual(ids(occ), [1065089, 1065090]);
  assert.equal(occ[0].attrs.type, 'Local');
  const srcRef = all(occ[0], 'BaseTableReference')[0];
  assert.equal(srcRef.attrs.id, '129');

  // Custom functions: both signatures created; only the calculation one gets a calc body.
  const fns = all(r, 'CustomFunction');
  assert.deepEqual(ids(fns), [1, 2]);
  assert.equal(all(fns.find((f) => f.attrs.id === '1')!, 'Parameter')[0].attrs.name, 'n');
  const fnCalcs = all(r, 'CustomFunctionCalc');
  assert.deepEqual(fnCalcs.map((c) => all(c, 'CustomFunctionReference')[0].attrs.id), ['1']); // JS fn (id 2) has no calc
  assert.equal(all(fnCalcs[0], 'Text')[0].children.join(''), 'n * 2');
  assert.equal(all(fnCalcs[0], 'ChunkList').length, 0);
  assert.doesNotMatch(xml, /toLowerCase/); // the JavaScript body is never emitted as a FileMaker calc

  // Value lists: custom (CR-joined), from-field (resolves the occurrence+field), external skipped.
  const vls = all(r, 'ValueList');
  assert.deepEqual(ids(vls), [1, 2]);
  const statut = vls.find((v) => v.attrs.id === '1')!;
  assert.equal(all(statut, 'Source')[0].attrs.value, 'Custom');
  assert.equal(all(statut, 'Text')[0].children.join(''), 'En cours\rTerminé\rEn attente');
  const empl = vls.find((v) => v.attrs.id === '2')!;
  assert.equal(all(empl, 'Source')[0].attrs.value, 'FromField');
  const pf = all(empl, 'PrimaryField')[0];
  assert.equal(all(pf, 'FieldReference')[0].attrs.id, '1');
  assert.equal(all(all(pf, 'FieldReference')[0], 'TableOccurrenceReference')[0].attrs.id, '1065090');

  // Relationship: the two occurrences, the per-side cascade flags, and the predicate.
  const rels = all(r, 'Relationship');
  assert.deepEqual(ids(rels), [50]);
  const lt = all(rels[0], 'LeftTable')[0];
  const rt = all(rels[0], 'RightTable')[0];
  assert.equal(lt.attrs.cascadeCreate, 'True'); // leftCreate
  assert.equal(lt.attrs.cascadeDelete, 'False');
  assert.equal(rt.attrs.cascadeDelete, 'True'); // rightDelete
  assert.equal(all(lt, 'TableOccurrenceReference')[0].attrs.id, '1065089');
  const pred = all(rels[0], 'JoinPredicate')[0];
  assert.equal(pred.attrs.type, 'Equal');
  assert.equal(all(all(pred, 'LeftField')[0], 'FieldReference')[0].attrs.id, '2');
  assert.equal(all(all(pred, 'RightField')[0], 'FieldReference')[0].attrs.id, '1');

  // Fields: one FieldCatalog per table in the AddAction pass; ids and types per table.
  const cats = all(add, 'FieldCatalog'); // AddAction's FieldsForTables only (ModifyAction has its own)
  assert.equal(cats.length, 2);
  const taches = cats.find((c) => all(c, 'BaseTableReference')[0].attrs.id === '129')!;
  const fields = all(taches, 'Field');
  assert.deepEqual(ids(fields), [2, 4]);
  const f2 = fields.find((f) => f.attrs.id === '2')!;
  const f4 = fields.find((f) => f.attrs.id === '4')!;
  assert.equal(f2.attrs.datatype, 'Number');
  assert.equal(f2.attrs.fieldtype, 'Normal');
  assert.equal(f4.attrs.datatype, 'Text');
  assert.equal(f4.attrs.fieldtype, 'Calculated');

  // Every created object carries a UUID.
  for (const e of [...all(r, 'BaseTable'), ...occ, ...fields]) {
    assert.equal(all(e, 'UUID').length >= 1, true, `UUID on ${e.name} ${e.attrs.id}`);
  }

  // ModifyAction pass: the calculation field's formula is attached by reference,
  // as <Text> only (no <ChunkList>), with its context occurrence.
  assert.equal(all(r, 'Structure')[0].attrs.membercount, '2');
  const modify = all(r, 'ModifyAction');
  assert.equal(modify.length, 1);
  const fref = all(modify[0], 'FieldReference');
  assert.equal(fref.length, 1); // only the calculation field
  assert.equal(fref[0].attrs.id, '4');
  const calc = all(fref[0], 'Calculation')[0];
  assert.equal(all(calc, 'TableOccurrenceReference')[0].attrs.id, '1065089');
  assert.equal(all(calc, 'Text')[0].children.join(''), 'Left ( id ; 3 )');
  assert.equal(all(calc, 'ChunkList').length, 0);

  // Security catalogs: privilege-set stubs, extended privileges, accounts.
  assert.deepEqual(ids(all(r, 'PrivilegeSet')), [1, 7]);
  assert.deepEqual(ids(all(r, 'ExtendedPrivilege')), [1, 2]);
  const accs = all(r, 'Account');
  assert.deepEqual(ids(accs), [1, 2]);
  const clerk = accs.find((a) => a.attrs.id === '2')!;
  assert.equal(all(clerk, 'INSECURE_TEXT')[0].children.join(''), 'clerk');
  assert.equal(all(clerk, 'PrivilegeSetReference')[0].attrs.name, 'Sales'); // reference resolves
  // SECRETS RULE: no credential material anywhere — the account's verifier never
  // appears, and no Account carries a password block or token.
  assert.doesNotMatch(xml, /SECRETVERIFIER|deadbeef/);
  assert.doesNotMatch(xml, /<Context>|<Data>|verifier|PBKDF/i);
  for (const a of accs) assert.equal(all(a, 'INSECURE_PASSWORD').length, 0);

  // Metadata tail: encryption, minimum version, empty login — no password verifier.
  const meta = all(r, 'Metadata')[0];
  assert.ok(all(meta, 'Encryption').length === 1);
  assert.ok(all(meta, 'Minimum').length === 1);
  assert.ok(all(meta, 'INSECURE_TEXT').length >= 1);
  assert.doesNotMatch(xml, /verifier|PBKDF|<Password/i);

  // Deterministic: same schema in, same bytes out.
  assert.equal(saveAsXml(schema, { fileName: 'demo.fmp12', source: '19.6.3' }), xml);
});

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const flicks = join(fixtures, 'Flicks.fmp12');
const skip = existsSync(flicks) ? false : 'fixtures missing: run npm run fixtures';

test('Save as XML: Flicks schema round-trips its tables, occurrences and fields', { skip }, () => {
  const db = FmpDatabase.open(flicks);
  const schema = db.schema;
  const r = root(saveAsXml(schema, { fileName: 'Flicks.fmp12' }));

  // Every base table and field is emitted, matching the schema.
  assert.deepEqual(ids(all(r, 'BaseTable')), schema.tables.map((t) => t.id).sort((a, b) => a - b));
  for (const t of schema.tables) {
    const cat = all(r, 'FieldCatalog').find((c) => all(c, 'BaseTableReference')[0].attrs.id === String(t.id))!;
    assert.deepEqual(ids(all(cat, 'Field')), t.fields.map((f) => f.id).sort((a, b) => a - b), `fields of table ${t.id}`);
  }

  // Local occurrences are emitted; external-source ones are omitted for now.
  const localOcc = schema.tableOccurrences.filter((o) => o.baseTableId !== undefined && o.dataSourceId === undefined);
  assert.deepEqual(ids(all(r, 'TableOccurrence')), localOcc.map((o) => o.id).sort((a, b) => a - b));
});

// UUIDs carried as a <UUID> child of an element with an id (definitions, not
// references), in document order.
const definitionUuids = (r: XmlElement) => {
  const out: string[] = [];
  const walk = (e: XmlElement) => {
    for (const c of kids(e)) {
      if (c.attrs.id !== undefined) {
        const u = kids(c).find((k) => k.name === 'UUID');
        if (u) out.push(String(u.children[0]));
      }
      walk(c);
    }
  };
  walk(r);
  return out;
};
const referenceUuids = (r: XmlElement) => {
  const out: string[] = [];
  const walk = (e: XmlElement) => {
    for (const c of kids(e)) {
      if (c.attrs.UUID !== undefined && c.name !== 'FMSaveAsXML') out.push(c.attrs.UUID);
      walk(c);
    }
  };
  walk(r);
  return out;
};

test('Save as XML: a file\'s own UUIDs are read and written back in place of stand-ins', { skip }, () => {
  const schema = FmpDatabase.open(flicks).schema;
  const standIn = saveAsXml(schema, { fileName: 'Flicks.fmp12' });
  // Play FileMaker: the same file, with UUIDs that aren't ours.
  let n = 0;
  const theirs = standIn
    .replace(/<UUID>[^<]*<\/UUID>/g, () => `<UUID>${(++n).toString(16).toUpperCase().padStart(8, '0')}-AAAA-4BBB-8CCC-000000000000</UUID>`)
    .replace(/ UUID="[^"]*"/, ' UUID="F1F1F1F1-0000-4000-8000-000000000000"');
  const map = uuidsFromSaveAsXml(theirs);
  assert.equal(map.get('file'), 'F1F1F1F1-0000-4000-8000-000000000000');
  assert.ok(map.has(`basetable:${schema.tables[0].id}`));
  assert.ok(map.has(`field:${schema.tables[0].id}:${schema.tables[0].fields[0].id}`));

  const real = root(saveAsXml(schema, { fileName: 'Flicks.fmp12', uuids: map }));
  const defs = definitionUuids(real);
  assert.ok(defs.length > 50, `found ${defs.length} definitions`);
  // Every object now carries the file's UUID, in the same place.
  assert.deepEqual(defs, definitionUuids(root(theirs)));
  // And every reference names one of those objects: none points at a stand-in.
  const known = new Set(defs);
  const dangling = referenceUuids(real).filter((u) => !known.has(u));
  const danglingBefore = referenceUuids(root(standIn)).filter((u) => !new Set(definitionUuids(root(standIn))).has(u));
  assert.equal(dangling.length, danglingBefore.length, 'references resolve as well as they did with stand-in GUIDs');
  // The option doesn't leak into the next call.
  assert.equal(saveAsXml(schema, { fileName: 'Flicks.fmp12' }), standIn);
});

test('Save as XML: reading UUIDs from FileMaker\'s UTF-16 output, fields by their table', () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-16"?><FMSaveAsXML version="2.2.0.0" UUID="F1F1F1F1-0000-4000-8000-000000000001"><Structure><AddAction>' +
    '<BaseTableCatalog><UUID>C0000001-0000-4000-8000-000000000000</UUID><BaseTable id="129" name="T"><UUID>B0000129-0000-4000-8000-000000000000</UUID></BaseTable></BaseTableCatalog>' +
    '<FieldsForTables><FieldCatalog><UUID>FC000001-0000-4000-8000-000000000000</UUID><BaseTableReference id="129" name="T" UUID="B0000129-0000-4000-8000-000000000000"></BaseTableReference>' +
    '<ObjectList><Field id="3" name="a"><UUID>F0000129-0003-4000-8000-000000000000</UUID></Field></ObjectList></FieldCatalog>' +
    '<FieldCatalog><BaseTableReference id="130" name="U" UUID="B0000130-0000-4000-8000-000000000000"></BaseTableReference>' +
    '<ObjectList><Field id="3" name="b"><UUID>F0000130-0003-4000-8000-000000000000</UUID></Field></ObjectList></FieldCatalog></FieldsForTables>' +
    '<ScriptCatalog><Script id="7" name="Go"><UUID>50000007-0000-4000-8000-000000000000</UUID></Script></ScriptCatalog>' +
    '</AddAction><ModifyAction><FieldsForTables><FieldCatalog><BaseTableReference id="129" UUID="B0000129-0000-4000-8000-000000000000"></BaseTableReference>' +
    '<ObjectList><Field><FieldReference id="3" UUID="F0000129-0003-4000-8000-000000000000"></FieldReference></Field></ObjectList></FieldCatalog></FieldsForTables></ModifyAction>' +
    '</Structure></FMSaveAsXML>';
  const bom = Buffer.from([0xff, 0xfe]);
  const map = uuidsFromSaveAsXml(new Uint8Array(Buffer.concat([bom, Buffer.from(xml, 'utf16le')])));
  assert.deepEqual(Object.fromEntries(map), {
    file: 'F1F1F1F1-0000-4000-8000-000000000001',
    'basetable:129': 'B0000129-0000-4000-8000-000000000000',
    'field:129:3': 'F0000129-0003-4000-8000-000000000000',
    'field:130:3': 'F0000130-0003-4000-8000-000000000000',
    'script:7': '50000007-0000-4000-8000-000000000000',
  });
  assert.deepEqual(uuidsFromSaveAsXml(xml), map);
});

test('Save as XML: a UUID that is not a UUID is not read, and not written back into the XML', () => {
  const evil = '"><script>alert(1)</script>';
  const xml =
    `<FMSaveAsXML UUID="${evil.replace(/"/g, '&quot;')}"><Structure><AddAction><BaseTableCatalog>` +
    `<BaseTable id="129" name="T"><UUID>${evil.replace(/</g, '&lt;')}</UUID></BaseTable>` +
    '<BaseTable id="130" name="U"><UUID>B0000130-0000-4000-8000-000000000000</UUID></BaseTable></BaseTableCatalog></AddAction></Structure></FMSaveAsXML>';
  const map = uuidsFromSaveAsXml(xml);
  assert.deepEqual(Object.fromEntries(map), { 'basetable:130': 'B0000130-0000-4000-8000-000000000000' });
  // A map handed to saveAsXml directly is held to the same shape.
  const schema = { tables: [{ id: 129, name: 'T', fields: [] }], tableOccurrences: [], relationships: [], scripts: [], customFunctions: [], valueLists: [], layouts: [], accounts: [], privilegeSets: [], extendedPrivileges: [] } as never;
  const out = saveAsXml(schema, { uuids: new Map([['file', evil], ['basetable:129', evil]]) });
  assert.ok(!out.includes('<script>'), 'nothing of the text reaches the XML');
  assert.ok(!out.includes('alert(1)'));
});

test('the XML reader refuses hostile depth and out-of-range character references instead of crashing', () => {
  assert.equal(parseXml(`${'<a>'.repeat(512)}${'</a>'.repeat(512)}`).children.length, 1);
  for (const depth of [513, 50_000]) {
    assert.throws(() => uuidsFromSaveAsXml('<a>'.repeat(depth)), /nested more than 512 deep/);
  }
  const doc = parseXml('<B e="&#x110000;">&#1114112;&#x10FFFF;</B>');
  const b = doc.children[0] as XmlElement;
  assert.equal(b.attrs.e, '&#x110000;');
  assert.deepEqual(b.children, ['&#1114112;\u{10FFFF}']);
});

test('Save as XML: an account that is switched off is exported switched off', () => {
  const schema = {
    tables: [],
    tableOccurrences: [],
    customFunctions: [],
    valueLists: [],
    relationships: [],
    extendedPrivileges: [],
    privilegeSets: [{ id: 1, name: 'Full Access' }],
    accounts: [
      { id: 1, name: 'Admin', privilegeSetId: 1 },
      { id: 2, name: 'tool_admin', privilegeSetId: 1, inactive: true },
    ],
  } as unknown as Schema;
  const accounts = all(root(saveAsXml(schema, { fileName: 'demo.fmp12', source: '19.6.3' })), 'Account');
  assert.deepEqual(accounts.map((a) => [a.attrs.id, a.attrs.enable]), [['1', 'True'], ['2', 'False']]);
});

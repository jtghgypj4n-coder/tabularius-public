import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designReport, parseXml, type XmlElement } from '../src/index.ts';
import { FmpDatabase, readLayoutDesigns } from '../../fmp12/src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Flicks.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

const all = (e: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] => {
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
};
const catalog = (root: XmlElement, name: string) => all(root, name)[0];
const kids = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== 'string');

// Flicks ships with the report FileMaker 26 wrote for it: ours must list the same design.
test('Design Report: Flicks matches the report FileMaker wrote', { skip }, () => {
  const db = FmpDatabase.open(join(fixtures, 'Flicks.fmp12'));
  const xml = designReport(db.schema, readLayoutDesigns(db.file, db.schema), { fileName: 'Flicks.fmp12', now: new Date(2026, 9, 12, 5, 30) });
  const ours = parseXml(xml);
  const theirs = parseXml(new TextDecoder('utf-16le').decode(readFileSync(join(fixtures, 'Flicks_ddr.xml'))).replace(/^﻿/, ''));
  assert.equal(kids(ours)[0].name, 'FMPReport');
  assert.equal(kids(ours)[0].attrs.creationDate, '10/12/2026');

  const ids = (root: XmlElement, cat: string, item: string) => all(catalog(root, cat), item).map((x) => `${x.attrs.id}:${x.attrs.name}`).sort();
  for (const [cat, item] of [['BaseTableCatalog', 'BaseTable'], ['LayoutCatalog', 'Layout'], ['ValueListCatalog', 'ValueList'], ['ScriptCatalog', 'Script'],
    ['AccountCatalog', 'Account'], ['PrivilegesCatalog', 'PrivilegeSet'], ['ExtendedPrivilegeCatalog', 'ExtendedPrivilege']]) {
    // Layouts and scripts also appear inside steps and buttons: compare the catalog's own entries.
    const own = (root: XmlElement) => (item === 'Layout' ? kids(catalog(root, cat)).filter((x) => x.name === 'Layout').map((x) => `${x.attrs.id}:${x.attrs.name}`).sort() : ids(root, cat, item));
    if (item === 'Script') {
      // A few scripts were renamed after the report was made.
      const a = own(ours);
      const b = own(theirs);
      assert.equal(a.length, b.length, cat);
      assert.ok(b.filter((x) => a.includes(x)).length >= b.length - 4, cat);
    } else assert.deepEqual(own(ours), own(theirs), cat);
  }

  // Every field, with its id, data type and kind.
  const fields = (root: XmlElement) => all(catalog(root, 'BaseTableCatalog'), 'BaseTable').flatMap((t) =>
    kids(all(t, 'FieldCatalog')[0]).map((f) => `${t.attrs.name}::${f.attrs.id}:${f.attrs.name}:${f.attrs.dataType}:${f.attrs.fieldType}`)).sort();
  assert.deepEqual(fields(ours), fields(theirs));

  // Every field option FileMaker's report states: storage and indexing, auto-enter, validation.
  const options = (root: XmlElement) => all(catalog(root, 'BaseTableCatalog'), 'BaseTable').flatMap((t) => kids(all(t, 'FieldCatalog')[0]).map((f) => {
    const attrs = (name: string) => JSON.stringify(Object.entries(kids(f).find((x) => x.name === name)?.attrs ?? {}).sort());
    const checks = (v?: XmlElement) => (v ? kids(v).filter((x) => x.attrs.value !== undefined).map((x) => `${x.name}=${x.attrs.value}`).sort().join(',') : '');
    return `${t.attrs.name}::${f.attrs.name} storage ${attrs('Storage')} auto ${attrs('AutoEnter')} validation ${attrs('Validation')} ${checks(kids(f).find((x) => x.name === 'Validation'))}`;
  })).sort();
  assert.deepEqual(options(ours), options(theirs));

  // Layouts left out of the layout menu.
  const inMenu = (root: XmlElement) => kids(catalog(root, 'LayoutCatalog')).filter((x) => x.name === 'Layout').map((x) => `${x.attrs.name}:${x.attrs.includeInMenu}`).sort();
  assert.deepEqual(inMenu(ours), inMenu(theirs));

  // Table occurrences and relationships, with their predicates.
  const graph = catalog(theirs, 'RelationshipGraph');
  const tos = (g: XmlElement) => all(all(g, 'TableList')[0], 'Table').map((t) => `${t.attrs.name}:${t.attrs.baseTable}`).sort();
  assert.deepEqual(tos(catalog(ours, 'RelationshipGraph')), tos(graph));
  const rels = (g: XmlElement) => all(g, 'Relationship').map((r) => `${all(r, 'LeftTable')[0].attrs.name}->${all(r, 'RightTable')[0].attrs.name}:${all(r, 'RightTable')[0].attrs.cascadeCreate}:` +
    all(r, 'JoinPredicate').map((p) => `${p.attrs.type}(${all(p, 'Field').map((f) => f.attrs.name).join(',')})`).join(',')).sort();
  assert.deepEqual(rels(catalog(ours, 'RelationshipGraph')), rels(graph));

  // Layout objects, by type, in order (one layout gained a field after the report).
  const objects = (root: XmlElement) => new Map(kids(catalog(root, 'LayoutCatalog')).map((l) => [l.attrs.name, kids(l).filter((o) => o.name === 'Object').map((o) => o.attrs.type).join(',')]));
  const [a, b] = [objects(ours), objects(theirs)];
  for (const [name, types] of b) {
    if (name === 'WV Framework - Sample Data') assert.ok(a.get(name)!.startsWith(types.replace(/,Field$/, '')), name);
    else assert.equal(a.get(name), types, name);
  }

  // External data sources: the ODBC entry by its DSN (with no login), the file reference by its path.
  const sources = (root: XmlElement) => kids(catalog(root, 'ExternalDataSourcesCatalog')).map((d) => `${d.name}:${d.attrs.id}:${d.attrs.name}:${d.attrs.DSN ?? d.attrs.pathList}`);
  assert.deepEqual(sources(ours), sources(theirs));
  assert.deepEqual(kids(kids(catalog(ours, 'ExternalDataSourcesCatalog'))[0]), []);

  // Manage Containers' base directories; no field stores externally (FileMaker writes <Remote> for one that does).
  const dirs = (root: XmlElement) => all(catalog(root, 'BaseDirectoryCatalog'), 'BaseDirectory').map((d) => `${d.attrs.id}:${d.children.join('')}`);
  assert.deepEqual(dirs(ours), dirs(theirs));
  assert.deepEqual(dirs(ours), ['0:Files/FOCUS/']);
  assert.equal(all(catalog(ours, 'BaseTableCatalog'), 'Remote').length, all(catalog(theirs, 'BaseTableCatalog'), 'Remote').length);

  // Credentials never appear: not the ODBC source's login, not account password verifiers.
  assert.ok(!xml.includes('room101'));
  assert.ok(!/verifier|password=/i.test(xml));
});

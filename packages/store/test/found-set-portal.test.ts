import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// A portal on the layout's own occurrence (People layout, portal on People) lists the found set, as in FileMaker:
// the records found, in the found set's order, paged like any portal. Read on its own, a record shows itself.

function people(rows = 10, names: string[][] = [['Cy', 'red'], ['Ada', 'blue'], ['Bo', 'red'], ['Di', 'blue']]): { s: Store; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-foundset-'));
  const path = join(dir, 'People.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'People');
  s.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Team' }] }] as never);
  const design = s.design('People')!;
  const to = s.schema.tableOccurrences.find((t) => t.name === 'People')!;
  const fid = s.schema.tables.find((x) => x.name === 'People')!.fields.find((f) => f.name === 'Name')!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = { id: 901, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 22, left: 22, bottom: 40, right: 200 },
    field: { tableOccurrenceId: to.id, fieldId: fid, tableOccurrence: 'People', field: 'Name', display: 'edit', repetitions: 1 } };
  const portal = { id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 20, left: 20, bottom: 300, right: 210 },
    portal: { tableOccurrenceId: to.id, tableOccurrence: 'People', rows, initialRow: 1, scrolling: true }, children: [cell] };
  s.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: [...design.objects, portal] } }] as never);
  for (const [name, team] of names) s.create('People', { Name: name, Team: team });
  return { s, done: () => { s.close(); rmSync(dir, { recursive: true }); } };
}

test('a find fills a found-set portal with the records found, in the found set\'s sort', () => {
  const { s, done } = people();
  try {
    const all = s.find('People', { sort: [{ fieldName: 'Name', sortOrder: 'ascend' }], limit: 2 });
    assert.equal(all.records.length, 2);
    for (const rec of all.records) assert.deepEqual(rec.portalData!.People.map((r) => r['People::Name']), ['Ada', 'Bo', 'Cy', 'Di']);
    const red = s.find('People', { query: [{ Team: 'red' }], sort: [{ fieldName: 'Name', sortOrder: 'descend' }] });
    assert.deepEqual(red.records[0].portalData!.People.map((r) => r['People::Name']), ['Cy', 'Bo']);
    // Portal paging applies, and the count is the found set's.
    const paged = s.find('People', { sort: [{ fieldName: 'Name', sortOrder: 'ascend' }], portals: { People: { offset: 2, limit: 2 } } });
    assert.deepEqual(paged.records[0].portalData!.People.map((r) => r['People::Name']), ['Bo', 'Cy']);
    assert.equal(s.portalCounts('People', paged.records[0].recordId, undefined, paged.records[0]).People, 4);
  } finally {
    done();
  }
});

test('a record read on its own shows itself; foundSetRows lists a found set the caller names', () => {
  const { s, done } = people();
  try {
    const ids = s.findIds('People', { sort: [{ fieldName: 'Name', sortOrder: 'ascend' }] });
    const one = s.get('People', ids[2]);
    assert.deepEqual(one.portalData!.People.map((r) => r['People::Name']), ['Cy']);
    assert.equal(s.portalCounts('People', ids[2]).People, 1);
    const rows = s.foundSetRows('People', 'People', [ids[3], ids[0]], {});
    assert.equal(rows.count, 2);
    assert.deepEqual(rows.rows.map((r) => [r.recordId, r['People::Name']]), [[String(ids[3]), 'Di'], [String(ids[0]), 'Ada']]);
    assert.deepEqual(s.foundSetRows('People', 'People', ids, { offset: 4, limit: 10 }).rows.map((r) => r['People::Name']), ['Di']);
  } finally {
    done();
  }
});

test('unless asked for more, a found-set portal reads the rows it shows and a few more, once for a page of records', () => {
  const names = Array.from({ length: 30 }, (_, i) => [`P${String(i).padStart(2, '0')}`, i % 2 ? 'red' : 'blue']);
  const { s, done } = people(2, names);
  try {
    const page = s.find('People', { sort: [{ fieldName: 'Name', sortOrder: 'ascend' }], limit: 3 });
    // Portal Setup shows 2 rows: 2 + 5 are read, not the Data API's usual 50.
    for (const rec of page.records) assert.deepEqual(rec.portalData!.People.map((r) => r['People::Name']), ['P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06']);
    assert.equal(s.portalCounts('People', page.records[0].recordId, undefined, page.records[0]).People, 30);
    // Records of one page don't share row objects.
    assert.notEqual(page.records[0].portalData!.People[0], page.records[1].portalData!.People[0]);
    const more = s.find('People', { sort: [{ fieldName: 'Name', sortOrder: 'ascend' }], limit: 1, portals: { People: { limit: 50 } } });
    assert.equal(more.records[0].portalData!.People.length, 30);
  } finally {
    done();
  }
});

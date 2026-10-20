import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// A multi-file solution where one file holds only table occurrences into another
// hosted file, and a portal reaches two hops along a relationship chain that
// lives entirely in that other file. The second hop is joined in one query
// (calc.joinHop), which must run against the file the tables live in, not the
// host file. Before #384 that query hit the host file and threw "no such table".
// The writer builds the whole thing here with no sample files, so CI covers it.
test('a two-hop portal whose relationship chain lives in another hosted file resolves', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mf-'));
  try {
    // File B holds the tables, the records, and (through File A's graph) every
    // end of the Parent -> Mid -> Child chain. Match fields are text, so the
    // join's multikey pre-check runs against File B's tables.
    createStore(join(dir, 'ChildFile.sqlite'));
    const b = new Store(join(dir, 'ChildFile.sqlite'), 'ChildFile');
    b.applyDesign([
      { op: 'createTable', name: 'Parent', fields: [{ name: 'Key', type: 'text' }] },
      { op: 'createTable', name: 'Mid', fields: [{ name: 'PKey', type: 'text' }, { name: 'MKey', type: 'text' }] },
      { op: 'createTable', name: 'Child', fields: [{ name: 'FK', type: 'text' }, { name: 'Note', type: 'text' }] },
    ]);
    const tbl = (n: string) => b.schema.tables.find((t) => t.name === n)!;
    const fld = (t: string, f: string) => tbl(t).fields.find((x) => x.name === f)!.id;
    b.create('Parent', { Key: 'A' });
    b.create('Mid', { PKey: 'A', MKey: 'M1' });
    b.create('Mid', { PKey: 'A', MKey: 'M2' });
    b.create('Child', { FK: 'M1', Note: 'first' });
    b.create('Child', { FK: 'M2', Note: 'second' });
    b.create('Child', { FK: 'M9', Note: 'unrelated' });

    // File A holds only occurrences into File B and the relationships between
    // them. The design layer can't read the other file, so each external table
    // and match field comes in by id.
    createStore(join(dir, 'MainFile.sqlite'));
    const a = new Store(join(dir, 'MainFile.sqlite'), 'MainFile');
    a.resolveFile = (n) => (n.toLowerCase() === 'childfile' ? b : undefined);
    a.applyDesign([
      { op: 'createDataSource', name: 'ChildFile', paths: ['file:ChildFile'] },
      { op: 'createOccurrence', name: 'Parent_ext', file: 'ChildFile', externalTable: tbl('Parent').id },
      { op: 'createOccurrence', name: 'Mid_ext', file: 'ChildFile', externalTable: tbl('Mid').id },
      { op: 'createOccurrence', name: 'Child_ext', file: 'ChildFile', externalTable: tbl('Child').id },
      { op: 'createRelationship', left: 'Parent_ext', right: 'Mid_ext', predicates: [{ left: fld('Parent', 'Key'), right: fld('Mid', 'PKey') }] },
      { op: 'createRelationship', left: 'Mid_ext', right: 'Child_ext', predicates: [{ left: fld('Mid', 'MKey'), right: fld('Child', 'FK') }] },
    ]);
    const occ = (n: string) => a.schema.tableOccurrences.find((t) => t.name === n)!.id;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const portal = {
      id: 900, kind: 'portal', type: 9, anchors, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: occ('Child_ext'), tableOccurrence: 'Child_ext', rows: 10, initialRow: 1 },
      children: [{ id: 901, kind: 'field', type: 1, anchors, bounds: { top: 202, left: 22, bottom: 222, right: 160 }, style: {}, field: { tableOccurrenceId: occ('Child_ext'), fieldId: fld('Child', 'Note'), tableOccurrence: 'Child_ext', field: 'Note', display: 'edit', repetitions: 1 } }],
    };
    a.applyDesign([{ op: 'createLayout', name: 'Parents', occurrence: occ('Parent_ext'), design: { objects: [portal] } } as never]);

    // The layout and its portal are two hops into File B. Reading the portal
    // joins Mid -> Child in one query (the path #384 fixed).
    const found = a.find('Parents', { limit: 1 });
    assert.equal(found.records.length, 1);
    const pid = found.records[0].recordId;
    const rows = a.get('Parents', pid).portalData!.Child_ext;
    assert.deepEqual(rows.map((r) => r['Child_ext::Note']).sort(), ['first', 'second']);
    assert.deepEqual(a.portalCounts('Parents', pid), { Child_ext: 2 });

    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

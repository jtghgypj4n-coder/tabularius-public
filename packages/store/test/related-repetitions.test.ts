import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

// A repeating field seen through a portal row gives every repetition ("TO::Field", "TO::Field(2)", ...), as the Data
// API does, so a layout that shows more than the first repetition of a related field has something to show.

test('a portal row gives each repetition of a repeating field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-related-reps-'));
  const path = join(dir, 'People.openhbam.sqlite');
  createStore(path);
  const s = new Store(path, 'People');
  try {
    s.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Tags', options: { repetitions: 3 } }] }] as never);
    const design = s.design('People')!;
    const to = s.schema.tableOccurrences.find((t) => t.name === 'People')!;
    const fid = s.schema.tables.find((x) => x.name === 'People')!.fields.find((f) => f.name === 'Tags')!.id;
    const anchors = { left: true, top: true, right: false, bottom: false };
    const cell = { id: 901, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 22, left: 22, bottom: 40, right: 200 },
      field: { tableOccurrenceId: to.id, fieldId: fid, tableOccurrence: 'People', field: 'Tags', display: 'edit', repetitions: 3 } };
    const portal = { id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 20, left: 20, bottom: 300, right: 210 },
      portal: { tableOccurrenceId: to.id, tableOccurrence: 'People', rows: 5, initialRow: 1, scrolling: true }, children: [cell] };
    s.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: [...design.objects, portal] } }] as never);
    const id = s.create('People', { Name: 'Ada', Tags: 'red', 'Tags(2)': 'blue' }).recordId;
    const row = s.get('People', id).portalData!.People[0];
    assert.equal(row['People::Tags'], 'red');
    assert.equal(row['People::Tags(2)'], 'blue');
    assert.equal(row['People::Tags(3)'], '', 'a repetition with nothing in it is empty');
    assert.equal(row['People::Name'], 'Ada');

    // Typing in a repetition of a portal row writes that repetition and leaves the others.
    s.updatePortals('People', id, { People: [{ recordId: row.recordId, 'People::Tags(2)': 'green' }] } as never, [], {});
    const after = s.get('People', id).portalData!.People[0];
    assert.deepEqual([after['People::Tags'], after['People::Tags(2)'], after['People::Tags(3)']], ['red', 'green', '']);

    // A repeating field holding an empty list (hand-edited or imported data) shows empty, not "[]".
    const raw = new DatabaseSync(path);
    raw.exec(`UPDATE "People" SET "Tags" = '[]'`);
    raw.close();
    const blank = s.get('People', id).portalData!.People[0];
    assert.deepEqual([blank['People::Tags'], blank['People::Tags(2)']], ['', '']);
  } finally {
    s.close();
    rmSync(dir, { recursive: true });
  }
});

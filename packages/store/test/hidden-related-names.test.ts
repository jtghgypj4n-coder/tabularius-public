// A related field the account can't see is left out of a record read by name
// too, not only by value, whether or not a related record is found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../src/index.ts';
import type { LayoutObject } from '@tabularius/fmp12';

test('hidden related fields are left out of a record read; visible ones stay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-hidden-related-'));
  const path = join(dir, 'Shapes.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shapes');
    store.applyDesign([
      { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }] },
      { op: 'createTable', name: 'Calls', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Note' }, { name: 'Topic' }] },
      { op: 'createRelationship', left: 'Contacts', right: 'Calls', predicates: [{ left: 'Id', right: 'ContactId' }] },
    ] as DesignOp[]);
    const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
    const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
    const anchors = { left: true, top: true, right: false, bottom: false };
    let top = 0;
    const field = (table: string, name: string): LayoutObject => ({
      id: 100 + top, kind: 'field', type: 1, anchors, style: {}, bounds: { top: top += 24, left: 20, bottom: top + 20, right: 300 },
      field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display: 'edit', repetitions: 1 },
    } as LayoutObject);
    store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects: [field('Contacts', 'Id'), field('Calls', 'Note'), field('Calls', 'Topic')], tableView: [] } }] as DesignOp[]);
    store.create('Contacts', { Id: 1 });
    store.create('Contacts', { Id: 2 });
    store.create('Calls', { ContactId: 1, Note: 'private', Topic: 'billing' });
    store.savePrivilegeSet({
      name: 'Clerk', records: { view: true, edit: false, create: false, delete: false },
      tables: { Calls: { view: true, edit: false, create: false, delete: false, fields: { Note: 'none' } } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
    } as never);
    store.setPassword('Clerk', 'pw', 'Clerk');
    const read = (privileges?: ReturnType<Store['privileges']>) =>
      store.find('Contacts', { privileges, sort: [{ fieldName: 'Id', sortOrder: 'ascend' }] } as never).records.map((r) => r.fieldData);
    const full = read();
    assert.equal(full[0]['Calls::Note'], 'private');
    assert.ok('Calls::Note' in full[1], 'full access still lists the field when no call is found');
    const clerk = read(store.privileges('Clerk'));
    for (const r of clerk) assert.ok(!('Calls::Note' in r), `the hidden field is not named: ${JSON.stringify(r)}`);
    assert.equal(clerk[0]['Calls::Topic'], 'billing');
    assert.equal(clerk[1]['Calls::Topic'], '', 'a visible field with no related record is still listed, empty');
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('records carry the styles of unstored calculations, and only of fields they show', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-styled-'));
  const path = join(dir, 'Styled.sqlite');
  createStore(path);
  const store = new Store(path, 'Styled');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Tasks', fields: [{ name: 'Title' }, { name: 'Due', type: 'number' }] },
      { op: 'createField', table: 'Tasks', name: 'Badge', kind: 'calculation', calculation: 'Title & If ( Due > 0 ; " " & TextStyleAdd ( TextColor ( "late" ; RGB ( 204 ; 0 ; 0 ) ) ; Bold ) )', options: { unstored: true } },
      { op: 'createField', table: 'Tasks', name: 'Lines', kind: 'calculation', calculation: 'Title & ¶ & TextStyleAdd ( "next" ; Italic )', options: { unstored: true } },
      { op: 'createField', table: 'Tasks', name: 'Plain', kind: 'calculation', calculation: 'Upper ( Title )', options: { unstored: true } },
    ]);
    const late = store.create('Tasks', { Title: 'Ship', Due: '3' }).recordId;
    const fine = store.create('Tasks', { Title: 'Plan', Due: '0' }).recordId;

    const a = store.get('Tasks', late);
    assert.equal(a.fieldData.Badge, 'Ship late');
    assert.deepEqual(a.styles, { Badge: [{ start: 5, end: 9, style: 256, color: '#CC0000' }], Lines: [{ start: 5, end: 9, style: 512 }] });
    assert.deepEqual(Object.keys(store.get('Tasks', fine).styles ?? {}), ['Lines'], 'no entry for a field with nothing styled');
    assert.equal(store.get('Tasks', late, 'us', undefined, undefined, { fields: ['Title'] }).styles, undefined, 'fields left out leave their styles out too');
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('text fields keep the formatting given with their value, through typing, and drop it on other writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-styled-'));
  const path = join(dir, 'Kept.sqlite');
  createStore(path);
  const store = new Store(path, 'Kept');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Body' }, { name: 'Count', type: 'number' }, { name: 'Tags', options: { repetitions: 2 } }] },
      { op: 'createField', table: 'Notes', name: 'Css', kind: 'calculation', calculation: 'GetAsCSS ( Body )', options: { unstored: true } },
    ]);
    const id = store.create('Notes', { Body: 'Hello world' }).recordId;
    const { modId } = store.get('Notes', id);
    const bold = [{ start: 0, end: 5, style: 256 }];
    const after = store.update('Notes', id, { Body: 'Hello world' }, modId, { styles: { Body: bold }, dataEntry: true }).modId;
    assert.equal(after, modId + 1, 'formatting is a change to the record');
    let r = store.get('Notes', id);
    assert.deepEqual(r.styles?.Body, bold);
    assert.equal(r.fieldData.Css, '<span style = "font-weight: bold;">Hello</span> world', 'calculations see the formatting');

    // Typing keeps it around the change.
    store.update('Notes', id, { Body: 'Well, Hello world' }, undefined, { dataEntry: true });
    assert.deepEqual(store.get('Notes', id).styles?.Body, [{ start: 6, end: 11, style: 256 }]);
    // A script's or import's write replaces the value and its formatting.
    store.update('Notes', id, { Body: 'Set by a script' });
    assert.equal(store.get('Notes', id).styles, undefined);

    // Text changed behind the store's back (another program) leaves stale formatting out.
    store.update('Notes', id, { Body: 'abc' }, undefined, { styles: { Body: [{ start: 0, end: 3, color: '#FF0000' }] } });
    store.sql.prepare('UPDATE "Notes" SET "Body" = ? WHERE _fm_record_id = ?').run('xyz', id);
    r = store.get('Notes', id);
    assert.equal(r.fieldData.Body, 'xyz');
    assert.equal(r.styles, undefined);

    // Only text fields (or their repetitions) written in the same update.
    assert.throws(() => store.update('Notes', id, { Count: '1' }, undefined, { styles: { Count: bold } }), /can't keep formatting/);
    assert.throws(() => store.update('Notes', id, { 'Tags(3)': 'a' }, undefined, { styles: { 'Tags(3)': bold } }), /missing/);
    assert.throws(() => store.update('Notes', id, { Tags: 'a' }, undefined, { styles: { 'Tags(2)': bold } }), /needs its value/);
    assert.throws(() => store.update('Notes', id, { Count: '1' }, undefined, { styles: { Body: bold } }), /needs its value/);
    assert.throws(() => store.update('Notes', id, { Body: 'x' }, undefined, { styles: { Nope: bold } }), /missing/);
    // An empty list takes the formatting off.
    store.update('Notes', id, { Body: 'abc' }, undefined, { styles: { Body: [{ start: 0, end: 3, style: 512 }] } });
    store.update('Notes', id, { Body: 'abc' }, undefined, { styles: { Body: [] } });
    assert.equal(store.get('Notes', id).styles, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('formatting of a field the account can\'t see is left out with it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-styled-'));
  const path = join(dir, 'Hidden.sqlite');
  createStore(path);
  const store = new Store(path, 'Hidden');
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Secret' }] }]);
    const id = store.create('People', { Name: 'Ada', Secret: 'xyz' }).recordId;
    store.update('People', id, { Name: 'Ada', Secret: 'xyz' }, undefined, { styles: { Name: [{ start: 0, end: 3, style: 256 }], Secret: [{ start: 0, end: 3, style: 256 }] } });
    store.savePrivilegeSet({
      name: 'Limited', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'],
      tables: { People: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none' } } },
    });
    const r = store.get('People', id, 'us', undefined, store.privilegesForSet('Limited'));
    assert.equal(r.fieldData.Secret, undefined);
    assert.deepEqual(Object.keys(r.styles ?? {}), ['Name']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

// Found by review: formatting went to a related field of the same name, stored calculations didn't see it, and a
// deleted record's formatting came back on a new record given its id.
test('formatting stays on its own record and field, and stored calculations see it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-styled-'));
  const path = join(dir, 'Rel.sqlite');
  createStore(path);
  const store = new Store(path, 'Rel');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Companies', fields: [{ name: 'Id', type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 } } } }, { name: 'Name' }, { name: 'Css', kind: 'calculation', calculation: 'GetAsCSS ( Name )' }] },
      { op: 'createTable', name: 'People', fields: [{ name: 'CompanyId', type: 'number' }, { name: 'Name' }] },
      { op: 'createOccurrence', name: 'People of company', table: 'People' },
      { op: 'createRelationship', left: 'Companies', right: 'People of company', predicates: [{ left: 'Id', right: 'CompanyId' }] },
    ] as never);
    const co = store.create('Companies', { Name: 'Acme' }).recordId;
    const person = store.create('People', { CompanyId: String(store.get('Companies', co).fieldData.Id), Name: 'Wile' }).recordId;
    store.update('Companies', co, { Name: 'Acme', 'People of company::Name': 'Wile' }, undefined, { dataEntry: true, styles: { Name: [{ start: 0, end: 2, style: 256 }] } });
    assert.deepEqual(store.get('Companies', co).styles?.Name, [{ start: 0, end: 2, style: 256 }]);
    assert.equal(store.get('People', person).styles, undefined, 'the related record\'s Name is left plain');
    assert.equal(store.get('Companies', co).fieldData.Css, '<span style = "font-weight: bold;">Ac</span>me', 'a stored GetAsCSS sees the new formatting');

    const a = store.create('People', { Name: 'Hi' }).recordId;
    store.update('People', a, { Name: 'Hi' }, undefined, { styles: { Name: [{ start: 0, end: 2, style: 256 }] } });
    store.delete('People', a);
    const b = store.create('People', { Name: 'Hi' }).recordId;
    assert.equal(b, a, 'the id is given again');
    assert.equal(store.get('People', b).styles, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

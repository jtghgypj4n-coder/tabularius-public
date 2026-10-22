// Names reach the SQL export in comments and in container file paths. A line break in a name must not end a comment
// and start a statement (or a psql command), and two tables must not write a container file to one path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, exportSql, Store } from '../src/index.ts';

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), 'tabularius-export-names-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const open = (name: string) => {
  createStore(join(dir, `${name}.sqlite`));
  return new Store(join(dir, `${name}.sqlite`), name);
};
const run = (store: Store, dialect: 'sqlite' | 'postgres') => {
  let script = '';
  const files = new Map<string, Uint8Array>();
  const report = exportSql(store, { write: (s) => { script += s; }, file: (p, d) => { files.set(p, d); } }, { dialect });
  return { script, files, report };
};

test('a line break in a table or field name cannot end a comment in the script', () => {
  const store = open('breaks');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Base', type: 'number' }, { name: 'Code', type: 'text', options: { autoEnter: { serial: { next: '1', increment: 1 } } } }] },
    { op: 'createField', table: 'T', name: 'x\nDROP TABLE victim; --', type: 'number', kind: 'calculation', calculation: 'Base*2' },
    { op: 'createField', table: 'T', name: 'y\r\\! touch /tmp/pwned', type: 'number', kind: 'calculation', calculation: 'Base*3' },
  ] as never);
  store.create('T', { Base: '1' });
  for (const dialect of ['sqlite', 'postgres'] as const) {
    const { script } = run(store, dialect);
    // Outside quoted names and values (where a line break is only part of the text), no line starts with a statement
    // or a psql command: a name in a comment did not end the comment.
    const bare = script.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '""');
    const lines = bare.split(/\r\n?|\n/);
    assert.ok(!lines.some((l) => /^\s*DROP\b/i.test(l) || l.startsWith('\\')), `${dialect}: a name started a line`);
    if (dialect === 'sqlite') {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE victim(a); INSERT INTO victim VALUES (1);');
      db.exec(script);
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'victim'").all().length, 1, 'the script dropped a table');
    }
  }
  store.close();
});

test('a comment still names the table and field, with a line break written as the mark', () => {
  const store = open('marks');
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Base', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'Twice', type: 'number', kind: 'calculation', calculation: 'Base*2' },
  ] as never);
  const { script } = run(store, 'sqlite');
  assert.match(script, /^-- "T"\."Twice" is a calculation, exported as the value stored in the file: Base\*2$/m);
  store.close();
});

test('two tables whose names come to the same folder name keep their container files apart', () => {
  const store = open('folders');
  store.applyDesign([
    { op: 'createTable', name: 'Клиенты', fields: [{ name: 'Photo', type: 'container' }] },
    { op: 'createTable', name: 'Заказы', fields: [{ name: 'Photo', type: 'container' }] },
    { op: 'createTable', name: 'A B', fields: [{ name: 'Photo', type: 'container' }] },
    { op: 'createTable', name: 'A_B', fields: [{ name: 'Photo', type: 'container' }] },
  ] as never);
  for (const [i, table] of ['Клиенты', 'Заказы', 'A B', 'A_B'].entries()) {
    const id = store.create(table, {}).recordId;
    store.setContainer(table, id, 'Photo', 1, { filename: 'photo.png', mime: 'image/png', data: new Uint8Array([i + 1]) });
  }
  const { files, report, script } = run(store, 'sqlite');
  assert.equal(report.containerFiles, 4);
  assert.equal(files.size, 4, `files written: ${[...files.keys()].join(', ')}`);
  assert.deepEqual([...files.values()].map((d) => d[0]).sort(), [1, 2, 3, 4]);
  // Each row points at its own file.
  for (const path of files.keys()) assert.ok(script.includes(`'${path}'`), path);
  store.close();
});

test('a table named with dots keeps its container files inside its own folder under the files folder', () => {
  const store = open('dots');
  const names = ['..', '.', '.git', '...'];
  store.applyDesign(names.map((name) => ({ op: 'createTable', name, fields: [{ name: 'Photo', type: 'container' }] })) as never);
  for (const [i, table] of names.entries()) {
    const id = store.create(table, {}).recordId;
    store.setContainer(table, id, 'Photo', 1, { filename: 'photo.png', mime: 'image/png', data: new Uint8Array([i + 1]) });
  }
  const { files } = run(store, 'sqlite');
  assert.equal(files.size, names.length, `files written: ${[...files.keys()].join(', ')}`);
  for (const path of files.keys()) {
    const parts = path.split('/');
    assert.equal(parts.length, 3, path);
    assert.equal(parts[0], 'files', path);
    assert.ok(!parts.some((p) => /^\.+$/.test(p)), `a folder of dots: ${path}`);
  }
  store.close();
});

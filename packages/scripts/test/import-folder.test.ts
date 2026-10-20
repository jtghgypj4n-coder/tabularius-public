// Import Records from a folder of files in the documents folder (help.claris.com "Importing files from a folder").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptText, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-folder-'));
  const outside = mkdtempSync(join(tmpdir(), 'tabularius-import-outside-'));
  createStore(join(dir, 'Target.sqlite'));
  const store = new Store(join(dir, 'Target.sqlite'), 'Target');
  store.applyDesign([{ op: 'createTable', name: 'Files', fields: [
    { name: 'Content', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Path', type: 'text' }, { name: 'Image', type: 'container' }, { name: 'Thumb', type: 'text' },
  ] }] as never);
  const run = async (step: string) => {
    const steps = parseScriptText(step, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
    return runScript(store, { id: 1, name: 'Import', steps } as Script, { layout: 'Files', documents: dir });
  };
  const rows = (r: { foundSet?: number[] }) => (r.foundSet ?? []).map((id) => store.get('Files', id).fieldData);
  return { dir, outside, store, run, rows, close: () => { store.close(); rmSync(dir, { recursive: true }); rmSync(outside, { recursive: true }); } };
}

const TEXT = 'Import Records [ With dialog: Off ; Table: Files ; Folder: “reports” ; File type: Text files ; Include enclosed folders: On ; Add ; Fields: Files::Content, Files::Name, Files::Path ]';

test('Import Records from a folder reads text files with their name and path, enclosed folders only when asked', async () => {
  const s = setup();
  try {
    mkdirSync(join(s.dir, 'reports/2025/q1'), { recursive: true });
    writeFileSync(join(s.dir, 'reports/b.txt'), 'second');
    writeFileSync(join(s.dir, 'reports/a.csv'), '﻿first');
    writeFileSync(join(s.dir, 'reports/2025/c.log'), 'third');
    writeFileSync(join(s.dir, 'reports/2025/q1/d.xml'), '<d/>');
    writeFileSync(join(s.dir, 'reports/skip.docx'), 'not text');
    writeFileSync(join(s.dir, 'reports/.hidden.txt'), 'hidden');
    writeFileSync(join(s.dir, 'outside.txt'), 'not in the folder');

    const all = await s.run(TEXT);
    assert.equal(all.error, 0);
    assert.deepEqual(s.rows(all).map((r) => [r.Content, r.Name, r.Path]), [
      ['third', 'c.log', 'reports/2025/c.log'],
      ['<d/>', 'd.xml', 'reports/2025/q1/d.xml'],
      ['first', 'a.csv', 'reports/a.csv'],
      ['second', 'b.txt', 'reports/b.txt'],
    ]);

    const top = await s.run(TEXT.replace('Include enclosed folders: On', 'Include enclosed folders: Off'));
    assert.deepEqual(s.rows(top).map((r) => r.Name), ['a.csv', 'b.txt']);
    // The step reads back as it was written.
    const steps = parseScriptText(TEXT, s.store.schema);
    assert.equal(scriptText([{ stepId: steps[0].stepId!, name: 'Import Records', enabled: true, params: steps[0].params }]), TEXT);
  } finally { s.close(); }
});

test('Import Records from a folder puts pictures into a container field, leaving the thumbnail empty', async () => {
  const s = setup();
  try {
    mkdirSync(join(s.dir, 'pics'));
    writeFileSync(join(s.dir, 'pics/one.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(s.dir, 'pics/two.pdf'), '%PDF-1.4');
    writeFileSync(join(s.dir, 'pics/note.txt'), 'not a picture');
    const r = await s.run('Import Records [ With dialog: Off ; Table: Files ; Folder: “pics” ; File type: Picture and movie files ; Include enclosed folders: Off ; Add ; Fields: Files::Image, Files::Name, Files::Path, Files::Thumb ]');
    assert.equal(r.error, 0);
    const rows = s.rows(r);
    assert.deepEqual(rows.map((x) => [x.Name, x.Path, x.Thumb]), [['one.png', 'pics/one.png', ''], ['two.pdf', 'pics/two.pdf', '']]);
    const id = r.foundSet![0];
    const container = s.store.container(s.store.containerId('Files', id, 'Image', 1)!)!;
    assert.equal(container.filename, 'one.png');
    assert.deepEqual([...container.data], [0x89, 0x50, 0x4e, 0x47]);
  } finally { s.close(); }
});

test('Import Records from a folder stays inside the documents folder', async () => {
  const s = setup();
  try {
    mkdirSync(join(s.dir, 'reports/real'), { recursive: true });
    writeFileSync(join(s.dir, 'reports/ok.txt'), 'ok');
    writeFileSync(join(s.dir, 'reports/real/inner.txt'), 'inner');
    writeFileSync(join(s.outside, 'secret.txt'), 'secret');
    mkdirSync(join(s.outside, 'dir'));
    writeFileSync(join(s.outside, 'dir/deep.txt'), 'deep');
    symlinkSync(join(s.outside, 'secret.txt'), join(s.dir, 'reports/escape.txt'));
    symlinkSync(join(s.outside, 'dir'), join(s.dir, 'reports/escape-dir'));
    symlinkSync(join(s.dir, 'reports/ok.txt'), join(s.dir, 'reports/alias.txt'));
    symlinkSync(join(s.dir, 'reports/real'), join(s.dir, 'reports/alias-dir'));
    const r = await s.run(TEXT);
    assert.equal(r.error, 0);
    assert.deepEqual(s.rows(r).map((x) => x.Name), ['alias.txt', 'ok.txt', 'inner.txt']);
    // A path that leaves the folder, or names no folder, imports nothing.
    for (const bad of ['“../x”', '“reports/ok.txt”', '“missing”']) {
      const gone = await s.run(TEXT.replace('“reports”', bad));
      assert.equal(gone.error, 100, bad);
    }
    assert.equal(s.store.findIds('Files').length, 3);
  } finally { s.close(); }
});

test('Import Records from a folder stops at 100 levels', async () => {
  const s = setup();
  try {
    let path = join(s.dir, 'deep');
    for (let level = 1; level <= 101; level++) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, `level${level}.txt`), String(level));
      path = join(path, 'd');
    }
    const r = await s.run(TEXT.replace('“reports”', '“deep”'));
    assert.equal(r.error, 0);
    const names = s.rows(r).map((x) => x.Name);
    assert.equal(names.length, 100);
    assert.ok(names.includes('level100.txt') && !names.includes('level101.txt'));
  } finally { s.close(); }
});

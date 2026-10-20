// Export Records then Import Records gives the same text back, whatever the format: returns inside a field
// travel as vertical tabs in every text format, and a tab-separated field that starts with a quote is not mistaken
// for the start of a quoted value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, StepParams } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const NOTES = ['first\nsecond', '"', '"quoted" start', 'tab\there', 'plain', 'a,b', 'ends with a quote"', ''];

for (const [format, file] of [['COMS', 'out.csv'], ['MRGE', 'out.mer'], ['TABS', 'out.tab']] as const) {
  test(`Export then Import Records keeps multi-line and quoted text (${format})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-roundtrip-'));
    createStore(join(dir, 'R.sqlite'));
    const store = new Store(join(dir, 'R.sqlite'), 'R');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Code' }, { name: 'Note' }] }]);
      const ids = NOTES.map((note, i) => store.create('Rows', { Code: `r${i}`, Note: note }).recordId);
      const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Rows' }, field: { id: 0, name } });
      const exported = await runScript(store, { id: 1, name: 'Export', steps: [
        { stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [file], exportFormat: format, exportFields: [ref('Code'), ref('Note')] } as StepParams },
      ] } as Script, { layout: 'Rows', foundSet: ids, documents: dir });
      assert.equal(exported.error, 0);
      const imported = await runScript(store, { id: 2, name: 'Import', steps: [
        { stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: [file], importFormat: format, importAction: 'add', fieldMapping: [{ field: ref('Code'), import: true }, { field: ref('Note'), import: true }] } as StepParams },
      ] } as Script, { layout: 'Rows', documents: dir });
      assert.equal(imported.error, 0);
      assert.equal(imported.foundSet?.length, NOTES.length);
      const back = imported.foundSet!.map((id) => store.get('Rows', id).fieldData);
      // A tab inside a tab-separated value becomes a space; everything else comes back as written.
      const expected = NOTES.map((n) => (format === 'TABS' ? n.replace(/\t/g, ' ') : n));
      assert.deepEqual(back.map((d) => d.Note), expected);
      assert.deepEqual(back.map((d) => d.Code), NOTES.map((_, i) => `r${i}`));
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('A tab-separated file from another program may quote its values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tab-quotes-'));
  createStore(join(dir, 'R.sqlite'));
  const store = new Store(join(dir, 'R.sqlite'), 'R');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Code' }, { name: 'Note' }] }]);
    writeFileSync(join(dir, 'in.tab'), 'a\t"one\ttwo"\r\nb\t"say ""hi"""\r\n');
    const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Rows' }, field: { id: 0, name } });
    const r = await runScript(store, { id: 2, name: 'Import', steps: [
      { stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: ['in.tab'], importFormat: 'TABS', importAction: 'add', fieldMapping: [{ field: ref('Code'), import: true }, { field: ref('Note'), import: true }] } as StepParams },
    ] } as Script, { layout: 'Rows', documents: dir });
    assert.equal(r.error, 0);
    assert.deepEqual(r.foundSet!.map((id) => store.get('Rows', id).fieldData.Note), ['one\ttwo', 'say "hi"']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

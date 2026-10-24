// Export Records then Import Records gives the same text back, whatever the format: returns inside a field
// travel as vertical tabs in every text format, and a tab-separated field that starts with a quote is not mistaken
// for the start of a quoted value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      // A tab is written as the visible text \u0009 in every text format (the escape is display-only; import keeps it as text); everything else comes back as written.
      const expected = NOTES.map((n) => n.replace(/\t/g, '\\u0009'));
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

// Export Records writes a control character as visible \uXXXX text, as the web client's export does, and still
// puts an apostrophe before anything a spreadsheet would take for a formula.
for (const [format, file] of [['COMS', 'g.csv'], ['MRGE', 'g.mer'], ['TABS', 'g.tab']] as const) {
  test(`Export Records escapes control characters and neutralises every formula start (${format})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-guard-'));
    createStore(join(dir, 'R.sqlite'));
    const store = new Store(join(dir, 'R.sqlite'), 'R');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Rows', fields: [{ name: 'Note' }, { name: 'Phone', options: { repetitions: 2 } }] }]);
      const starts = ['=1+1', '+1', '-1', '@SUM(A1)', ' =1', '\u00a0=1', '\t=1', '\r=1', '\u0001@x', '\u007f+1', '\u0085-1'];
      const ids = [...starts, 'a\tb\u0007c', 'plain'].map((note) => store.create('Rows', { Note: note }).recordId);
      const rep = store.create('Rows', { Note: 'rep', Phone: 'p\t1', 'Phone(2)': 'p2' }).recordId;
      const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Rows' }, field: { id: 0, name } });
      const r = await runScript(store, { id: 1, name: 'Export', steps: [
        { stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [file], exportFormat: format, exportFields: [ref('Note'), ref('Phone')] } as StepParams },
      ] } as Script, { layout: 'Rows', foundSet: [...ids, rep], documents: dir });
      assert.equal(r.error, 0);
      const text = readFileSync(join(dir, file), 'utf8');
      // No control character other than the record's line break, the delimiter and the group separator is left in the file.
      assert.equal(/[\u0000-\u0008\u000c\u000e-\u001c\u001e\u001f\u007f-\u009f]/.test(text), false);
      const lines = text.split('\r\n').filter(Boolean);
      const fields = lines.map((l) => (format === 'TABS' ? l.split('\t')[0]! : l.split('","')[0]!.replace(/^"/, '')));
      const body = format === 'MRGE' ? fields.slice(1) : fields;
      // Every formula start is guarded (the first column is what a spreadsheet reads as a formula).
      for (const f of body.slice(0, starts.length)) assert.equal(f.startsWith("'") || f.startsWith('"\''), true, f);
      assert.match(text, /a\\u0009b\\u0007c/);
      assert.match(text, /p\\u00091\u001dp2/);
      assert.equal(text.includes('\t'), format === 'TABS' ? true : false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

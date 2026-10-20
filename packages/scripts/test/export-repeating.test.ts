// Export Records gives a repeating field every repetition, as FileMaker does. Claris (comma-separated, tab-separated
// and merge formats): "Values in repeating fields are separated by the group separator character." FileMaker XML
// has a DATA element for each (MAXREPEAT says how many the field has). One repetition named in the field order
// exports only that one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, StepParams } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const GS = '\u001d';

test('Export Records writes all of a repeating field\'s repetitions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-reps-'));
  createStore(join(dir, 'E.sqlite'));
  const store = new Store(join(dir, 'E.sqlite'), 'E');
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Phone', options: { repetitions: 3 } }] }]);
    const a = store.create('People', { Name: 'Ada', Phone: 'p1', 'Phone(2)': 'p2' }).recordId;
    const b = store.create('People', { Name: 'Grace' }).recordId;
    const ref = (name: string, repetition?: number) => ({ tableOccurrence: { id: 0, name: 'People' }, field: { id: 0, name }, ...(repetition ? { repetition } : {}) });
    const run = (file: string, params: Partial<StepParams> = {}) => runScript(store, { id: 1, name: 'Export', steps: [
      { stepId: 36, name: 'Export Records', enabled: true, params: { filePaths: [file], exportFields: [ref('Name'), ref('Phone')], ...params } as StepParams },
    ] } as Script, { layout: 'People', foundSet: [a, b], documents: dir });
    const lines = (file: string) => readFileSync(join(dir, file), 'utf8').split('\r\n').filter(Boolean);

    assert.equal((await run('out.csv')).error, 0);
    assert.deepEqual(lines('out.csv'), [`"Ada","p1${GS}p2"`, '"Grace",""']);
    assert.equal((await run('out.tab', { exportFormat: 'TABS' })).error, 0);
    assert.deepEqual(lines('out.tab'), [`Ada\tp1${GS}p2`, 'Grace\t']);
    assert.equal((await run('out.mer', { exportFormat: 'MRGE' })).error, 0);
    assert.deepEqual(lines('out.mer'), ['"Name","Phone"', `"Ada","p1${GS}p2"`, '"Grace",""']);

    assert.equal((await run('out.xml')).error, 0);
    const xml = readFileSync(join(dir, 'out.xml'), 'utf8');
    assert.match(xml, /<FIELD EMPTYOK="YES" MAXREPEAT="3" NAME="Phone" TYPE="TEXT"\/>/);
    assert.match(xml, /<COL><DATA>Ada<\/DATA><\/COL><COL><DATA>p1<\/DATA><DATA>p2<\/DATA><\/COL>/);

    // One repetition named: only that one.
    assert.equal((await run('two.csv', { exportFields: [ref('Name'), ref('Phone', 2)] })).error, 0);
    assert.deepEqual(lines('two.csv'), ['"Ada","p2"', '"Grace",""']);

    // The layout's fields when none are named: the whole field.
    assert.equal((await run('all.csv', { exportFields: undefined })).error, 0);
    assert.deepEqual(lines('all.csv'), [`"Ada","p1${GS}p2"`, '"Grace",""']);

    // What it writes, Import Records reads back into the repetitions.
    const c = store.create('People', {}).recordId;
    const back = await runScript(store, { id: 2, name: 'Import', steps: [
      { stepId: 35, name: 'Import Records', enabled: true, params: { filePaths: ['out.mer'], importAction: 'replace', fieldMapping: [{ field: ref('Name'), import: true }, { field: ref('Phone'), import: true }] } as StepParams },
    ] } as Script, { layout: 'People', foundSet: [c], documents: dir });
    assert.equal(back.error, 0);
    const d = store.get('People', c).fieldData;
    assert.deepEqual([d.Name, d.Phone, d['Phone(2)']], ['Ada', 'p1', 'p2']);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

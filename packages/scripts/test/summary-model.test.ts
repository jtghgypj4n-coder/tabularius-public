import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

test('GetSummary uses the current sorted break and changes with the found set', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-getsummary-model-'));
  const path = join(dir, 'Report.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Report');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'R', fields: [{ name: 'Group' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'R', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
  ]);
  const ids = [
    store.create('R', { Group: 'B', Amount: 7 }).recordId,
    store.create('R', { Group: 'A', Amount: 2 }).recordId,
    store.create('R', { Group: 'A', Amount: 3 }).recordId,
  ].map(Number);
  const source = 'Exit Script [ Text Result: GetSummary ( R::Total ; R::Group ) & "|" & GetSummary ( R::Total ; R::Total ) ]';
  const run = async (foundSet: number[], sorted = false) => {
    const text = `${sorted ? 'Sort Records [ Restore ; With dialog: Off ; R::Group ]\n' : ''}${source}`;
    const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
    const script = { id: 9999, name: 'Read subtotal', steps } as Script;
    return String((await runScript(store, script, { layout: 'R', foundSet, recordId: foundSet[0] })).result);
  };
  assert.equal(await run(ids), '|12', 'without a sort, GetSummary has no break result');
  const sorted = store.sortIds('R', ids, [{ fieldName: 'Group', sortOrder: 'ascend' }]);
  assert.equal(await run(sorted, true), '5|12');
  assert.equal(await run(sorted.slice(0, 1), true), '2|2', 'one-record found set');
  assert.equal(await run(sorted.filter((id) => id !== ids[1]), true), '3|10', 'omitting a record changes both totals');
  store.update('R', ids[2], { Amount: 11 });
  assert.equal(await run(sorted, true), '13|20', 'an edit changes the next report');
});

test('Preview and PDF use the sorted sub-summary totals from a synthetic report', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-report-pdf-'));
  const path = join(dir, 'Report.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Report');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'R', fields: [{ name: 'Group' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'R', name: 'Total', kind: 'summary', summary: { type: 'total', field: 'Amount' } },
  ]);
  const d = store.design('R')!;
  const sample = d.objects.find((o) => o.field)!;
  const object = (id: number, field: string, top: number) => ({
    ...sample, id, bounds: { top, bottom: top + 15, left: 10, right: 180 }, field: { ...sample.field!, field },
  });
  store.applyDesign([{ op: 'updateLayout', layout: d.id, design: {
    parts: [
      { kind: 'body', kindId: 4, top: 0, height: 20, style: {} },
      { kind: 'sub-summary-trailing', kindId: 5, top: 20, height: 20, style: {}, breakField: { field: 'Group', tableOccurrence: 'R' } },
    ],
    objects: [object(1001, 'Group', 2), object(1002, 'Total', 22)],
  } }] as never);
  const ids = [
    store.create('R', { Group: 'B', Amount: 7 }).recordId,
    store.create('R', { Group: 'A', Amount: 2 }).recordId,
    store.create('R', { Group: 'A', Amount: 3 }).recordId,
  ].map(Number);
  const script = (source: string): Script => ({
    id: 9999, name: 'Report', steps: parseScriptText(source, store.schema)
      .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params })),
  });
  const sort = 'Sort Records [ Restore ; With dialog: Off ; R::Group ]\n';
  const preview = await runScript(store, script(`${sort}Enter Preview Mode`), { layout: 'R', foundSet: ids });
  assert.equal(preview.preview, true);
  assert.deepEqual(preview.foundSet?.map((id) => store.get('R', id).fieldData.Group), ['A', 'A', 'B']);
  const documents = join(dir, 'Documents');
  mkdirSync(documents);
  const result = await runScript(store, script(`${sort}Save Records as PDF [ With dialog: Off ; "out.pdf" ; Records being browsed ; Create folders: Off ]`), { layout: 'R', foundSet: ids, documents });
  assert.equal(result.error, 0);
  const pdf = readFileSync(join(documents, 'out.pdf')).toString('latin1');
  const shown = [...pdf.matchAll(/\(([^()]*)\) Tj/g)].map((m) => m[1]);
  assert.deepEqual(shown.filter((s) => ['A', 'B', '5', '7'].includes(s)), ['A', 'A', '5', 'B', '7']);
});

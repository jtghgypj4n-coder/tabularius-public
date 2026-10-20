import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { importFmp12, parseScriptText, Store } from '@tabularius/store';
import { clientWindow, runScript, startingPoints, testScripts } from '../src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'DEMO_drawers.fmp12')) && existsSync(join(fixtures, 'Flicks.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let drawers: Store;
let flicks: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(join(fixtures, 'DEMO_drawers.fmp12'), join(dir, 'Drawers.sqlite'));
  importFmp12(join(fixtures, 'Flicks.fmp12'), join(dir, 'Flicks.sqlite'));
  drawers = new Store(join(dir, 'Drawers.sqlite'));
  flicks = new Store(join(dir, 'Flicks.sqlite'));
});
after(() => {
  drawers?.close();
  flicks?.close();
  if (dir) rmSync(dir, { recursive: true });
});

function script(store: Store, text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}

/** Every record of every table, to compare before and after. */
function snapshot(store: Store): string {
  return JSON.stringify(store.schema.tables.map((t) => {
    try {
      return store.sql.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}" ORDER BY _fm_record_id`).all();
    } catch {
      return null;
    }
  }));
}

test('smoke: every script of two sample files runs offline to its end, and leaves the data as it was', { skip }, async () => {
  for (const store of [drawers, flicks]) {
    const before = snapshot(store);
    const results = await testScripts(store, { timeoutMs: 20_000 });
    assert.ok(results.length > 10, `${store.name}: ${results.length} scripts`);
    const bad = results.filter((r) => r.outcome === 'stalled' || r.outcome === 'crashed');
    assert.deepEqual(bad, [], `${store.name}: ${JSON.stringify(bad)}`);
    assert.equal(snapshot(store), before, `${store.name}: a script's changes were kept`);
  }
});

test('a trial undoes record changes', { skip }, async () => {
  const before = snapshot(drawers);
  const t = drawers.trial();
  const r = await runScript(drawers, script(drawers, `
    New Record/Request
    Set Field [ RECORD::field_text_01 ; "trial" ]
    Commit Records/Requests [ With dialog: Off ]
  `), { layout: 'RECORD' });
  assert.equal(r.error, 0);
  assert.notEqual(snapshot(drawers), before);
  t.undo();
  assert.equal(snapshot(drawers), before);
});

test('Copy, Cut and Paste use the run\'s own clipboard', { skip }, async () => {
  const t = drawers.trial();
  try {
    const r = await runScript(drawers, script(drawers, `
      Set Field [ RECORD::field_text_01 ; "abc" ]
      Cut [ RECORD::field_text_01 ]
      Set Variable [ $after ; Value: RECORD::field_text_01 ]
      Paste [ Select ; No style ; RECORD::field_text_02 ]
      Set Variable [ $pasted ; Value: RECORD::field_text_02 ]
      Set Field [ RECORD::field_text_01 ; "xyz" ]
      Copy [ RECORD::field_text_01 ]
      Paste [ RECORD::field_text_02 ]
      Exit Script [ Result: $after & "|" & $pasted & "|" & RECORD::field_text_01 & "|" & RECORD::field_text_02 ]
    `), { layout: 'RECORD', foundSet: drawers.findIds('RECORD') });
    assert.equal(r.error, 0);
    // Without Select, Paste into a field the cursor isn't in goes in at the end.
    assert.equal(r.result, '|abc|xyz|abcxyz');
  } finally {
    t.undo();
  }
});

test('Save a Copy as writes a hostable copy; a clone has no records', { skip }, async () => {
  const docs = join(dir, 'Documents');
  // A person's recent records hold record data, so a clone leaves them out.
  drawers.setUserPref('Admin', 'recent', '[{"layout":"RECORD","recordId":"1","title":"secret"}]');
  // With the word indexes built, emptying the copy fires their delete triggers.
  for (const t of drawers.schema.tables) drawers.words.ensure(t);
  const r = await runScript(drawers, script(drawers, `
    Save a Copy as [ “copy.fmp12” ; copy of current file ]
    Save a Copy as [ “file:empty.fmp12” ; clone (no records) ]
    Set Error Capture [ On ]
    Save a Copy as [ “copy.fmp12” ; copy of current file ]
    Exit Script [ Result: Get ( LastError ) ]
  `), { layout: 'RECORD', documents: docs });
  // The same name again: the file is there already.
  assert.equal(r.result, '300');
  const copy = new Store(join(docs, 'copy.openhbam.sqlite'));
  const clone = new Store(join(docs, 'empty.openhbam.sqlite'));
  try {
    assert.equal(copy.findIds('RECORD').length, drawers.findIds('RECORD').length);
    assert.ok(drawers.findIds('RECORD').length > 0);
    assert.equal(clone.findIds('RECORD').length, 0);
    assert.deepEqual(clone.userPrefs('Admin'), {});
    assert.deepEqual(clone.schema.layouts.map((l) => l.name), drawers.schema.layouts.map((l) => l.name));
  } finally {
    copy.close();
    clone.close();
  }
});

test('New Window opens on the layout it names', { skip }, async () => {
  const other = drawers.layouts().find((l) => l.name !== 'RECORD' && l.table)!.name;
  const s = script(drawers, `New Window [ "Second" ; Using layout: “${other}” ]\nExit Script [ Result: Get ( WindowName ) & "|" & Get ( LayoutName ) ]`);
  assert.equal(s.steps[0].params?.layout?.name, other);
  const r = await runScript(drawers, s, { layout: 'RECORD' });
  assert.equal(r.result, `Second|${other}`);
});

test('test runs leave out skipped scripts, by name or prefix', { skip }, async () => {
  const names = drawers.schema.scripts.filter((s) => s.steps?.length).map((s) => s.name);
  const first = names[0];
  const results = await testScripts(drawers, { skip: [first.toUpperCase(), `${names[1].slice(0, 3)}*`] });
  const ran = results.map((r) => r.script);
  assert.ok(!ran.includes(first));
  assert.ok(!ran.some((n) => n.toLowerCase().startsWith(names[1].slice(0, 3).toLowerCase())));
  assert.ok(ran.length > 0);
});

test('a script starts with the parameter its button passes', { skip: !existsSync(join(fixtures, 'Charts.fmp12')) && 'fixtures missing' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    importFmp12(join(fixtures, 'Charts.fmp12'), join(d, 'Charts.sqlite'));
    const charts = new Store(join(d, 'Charts.sqlite'));
    try {
      const id = charts.schema.scripts.find((s) => s.name === 'Show House')!.id;
      assert.deepEqual(startingPoints(charts).get(id), { layout: 'Found Set Summarized • Congress', parameter: '"State"' });
    } finally {
      charts.close();
    }
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('a find request whose fields were set to nothing has no criteria (error 400)', { skip }, async () => {
  const r = await runScript(drawers, script(drawers, `
    Set Error Capture [ On ]
    Enter Find Mode [ Pause: Off ]
    Set Field [ RECORD::field_text_01 ; $notSet ]
    Perform Find
    Exit Script [ Result: Get ( LastError ) ]
  `), { layout: 'RECORD' });
  assert.equal(r.result, '400');
});

test('Sort Records by Field, Dial Phone, Exit Application', { skip }, async () => {
  const s = script(drawers, `
    Sort Records by Field [ Select ; RECORD::field_text_01 ; Descending ]
    Go to Record/Request/Page [ First ]
    Set Variable [ $first ; Value: RECORD::field_text_01 ]
    Dial Phone [ "+1 (555) 010-0199" ]
    Exit Script [ Result: $first ]
  `);
  const ids = drawers.findIds('RECORD');
  const r = await runScript(drawers, s, { layout: 'RECORD', foundSet: ids });
  assert.equal(r.error, 0);
  const values = drawers.query('SELECT field_text_01 AS v FROM RECORD').map((x) => String(x.v ?? ''));
  assert.equal(r.result, values.sort((a, b) => b.localeCompare(a, 'en', { sensitivity: 'base' }))[0]);
  assert.deepEqual(r.actions.map((a) => a.url), ['tel:+15550100199']);
  const halted = await runScript(drawers, script(drawers, 'Exit Application\nSet Variable [ $x ; Value: 1 ]'), { layout: 'RECORD' });
  assert.equal(halted.halted, true);
});

test("Get ( Device ) and the window's size are the person's, as their browser says", { skip }, async () => {
  const s = script(drawers, 'Exit Script [ Result: Get ( Device ) & "|" & Get ( WindowWidth ) & "|" & Get ( ScreenHeight ) & "|" & Get ( SystemPlatform ) & "|" & Get ( WindowOrientation ) ]');
  const window = clientWindow(JSON.stringify({ device: 4, width: 390, height: 664, contentWidth: 390, contentHeight: 600, screenWidth: 390, screenHeight: 844, scale: 3, orientation: 0 }));
  assert.equal((await runScript(drawers, s, { layout: 'RECORD', window })).result, '4|390|844|4|0');
  // Without a browser (a schedule, the Data API) the server's own answers stand.
  assert.equal((await runScript(drawers, s, { layout: 'RECORD' })).result.split('|')[0], '0');
  // What a browser sends is checked.
  assert.equal(clientWindow('{"device":9.5,"width":-1}')?.device, 0);
  assert.equal(clientWindow('{"device":2,"width":-1}')?.width, 0);
  assert.equal(clientWindow('not json'), undefined);
  assert.equal(clientWindow('x'.repeat(500)), undefined);
});

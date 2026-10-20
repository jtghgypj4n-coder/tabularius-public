import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type Script } from '@tabularius/fmp12';
import { importFmp12, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const LAYOUT = 'WV Framework - Modules';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-af-'));
  importFmp12(fixture, join(dir, 'Flicks.sqlite'));
  store = new Store(join(dir, 'Flicks.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}
const run = (text: string) => runScript(store, script(text), { layout: LAYOUT, foundSet: store.findIds(LAYOUT) });

test('Go to Next and Previous Field follow the tab order and wrap round; Get ( ActiveField… ) say where the cursor is', { skip }, async () => {
  const r = await run(`
    Set Variable [ $none ; Value: Get ( ActiveFieldName ) ]
    Go to Next Field
    Set Variable [ $first ; Value: Get ( ActiveFieldTableName ) & "::" & Get ( ActiveFieldName ) ]
    Loop
      Go to Next Field
      Set Variable [ $n ; Value: $n + 1 ]
      Exit Loop If [ Get ( ActiveFieldTableName ) & "::" & Get ( ActiveFieldName ) = $first or $n > 50 ]
    End Loop
    Go to Previous Field
    Set Variable [ $last ; Value: Get ( ActiveFieldName ) ]
    Exit Script [ Result: $none & "|" & $first & "|" & $n & "|" & $last ]
  `);
  // Modules' layout has nine fields Tab can enter, left to right and top to bottom: name first, version last.
  assert.equal(r.result, '|LIBRARY_CODE::name|9|version');
});

test('Go to Field puts the cursor in a field; Set Field without a field sets it; a commit leaves it', { skip }, async () => {
  const t = store.trial();
  try {
    const r = await run(`
      Go to Field [ LIBRARY_CODE::code ]
      Set Variable [ $active ; Value: Get ( ActiveFieldName ) & "/" & Get ( ActiveRepetitionNumber ) ]
      Set Field [ "typed into the active field" ]
      Set Variable [ $contents ; Value: Get ( ActiveFieldContents ) ]
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Result: $active & "|" & $contents & "|" & Get ( ActiveFieldName ) & "|" & LIBRARY_CODE::code ]
    `);
    assert.equal(r.result, 'code/1|typed into the active field||typed into the active field');
    const missing = await run('Set Error Capture [ On ]\nGo to Field [ LIBRARY_CODE::id ]\nExit Script [ Result: Get ( LastError ) ]');
    assert.equal(missing.result, '102');
  } finally {
    t.undo();
  }
});

test('Go to Related Record in a new window leaves the first window as it was; with no related records nothing opens', { skip }, async () => {
  const one = [store.findIds(LAYOUT)[0]];
  const total = store.findIds(LAYOUT).length;
  const r = await runScript(store, script(`
    Set Error Capture [ On ]
    Set Variable [ $first ; Value: Get ( WindowName ) ]
    Go to Related Record [ From table: “GENRE” ; Using layout: <Current Layout> ; New window: "Nothing" ]
    Set Variable [ $none ; Value: Get ( LastError ) & "/" & Get ( WindowName ) & "/" & Get ( FoundCount ) ]
    Go to Related Record [ From table: “LIBRARY_CODE__all” ; Using layout: “WV Framework - Modules” ; New window: "Related " & Get ( FoundCount ) ]
    Set Variable [ $related ; Value: Get ( WindowName ) & "/" & Get ( FoundCount ) ]
    Close Window [ Current Window ]
    Exit Script [ Result: $none & "|" & $related & "|" & ( Get ( WindowName ) = $first ) & "/" & Get ( FoundCount ) ]
  `), { layout: LAYOUT, foundSet: one });
  assert.equal(r.result, `101/Flicks/1|Related 1/${total}|1/1`);
});

test('Select Window and Close Window take the window name as read from files (slot 128)', { skip }, async () => {
  assert.equal(stepLine('Select Window', { slots: { 128: '"Second"' } }), 'Select Window [ Name: "Second" ]');
  assert.equal(parseScriptText('Select Window [ Name: "Second" ]', store.schema)[0].params?.calculation, '"Second"');
  const s = script('New Window [ "Second" ]\nSelect Window [ Name: "Flicks" ]\nSet Variable [ $back ; Value: Get ( WindowName ) ]\nExit Script [ Result: $back ]');
  // As the reader decodes it: the name in slot 128.
  const select = s.steps[1];
  select.params = { slots: { 128: select.params!.calculation! } };
  const r = await runScript(store, s, { layout: LAYOUT });
  assert.equal(r.result, 'Flicks');
});

test('Sort Records by Field without a field sorts by the active field', { skip }, async () => {
  const r = await run(`
    Go to Field [ LIBRARY_CODE::name ]
    Sort Records by Field [ Ascending ]
    Exit Script [ Result: Get ( SortState ) ]`);
  assert.equal(r.error, 0);
  assert.equal(r.result, '1');
  const names = r.foundSet!.map((id) => String(store.get(LAYOUT, id).fieldData.name));
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  const none = await run('Set Error Capture [ On ]\nSort Records by Field [ Ascending ]\nExit Script [ Result: Get ( LastError ) ]');
  assert.equal(none.result, '102');
});

test('Perform Find/Replace: Replace All in the active field or every field; Find Next goes to the next match', { skip }, async () => {
  const t = store.trial();
  try {
    const ids = store.findIds(LAYOUT);
    store.update(LAYOUT, ids[0], { name: 'Alpha cat', version: 'cat scan; Cat' });
    store.update(LAYOUT, ids[1], { name: 'concatenate', version: 'no' });
    const names = () => ids.slice(0, 2).map((id) => String(store.get(LAYOUT, id).fieldData.name));
    const notes = () => ids.slice(0, 2).map((id) => String(store.get(LAYOUT, id).fieldData.version));
    // A field active: only that field.
    let r = await run('Go to Field [ LIBRARY_CODE::name ]\nPerform Find/Replace [ With dialog: Off ; "cat" ; "dog" ; Replace All ; Whole words ]');
    assert.equal(r.error, 0);
    assert.deepEqual(names(), ['Alpha dog', 'concatenate']);
    assert.deepEqual(notes(), ['cat scan; Cat', 'no']);
    // No field active: every field on the layout, case-insensitive unless Match case.
    r = await run('Perform Find/Replace [ With dialog: Off ; "cat" ; "cow" ; Replace All ; Match case ]');
    assert.deepEqual(names(), ['Alpha dog', 'concowenate']);
    assert.deepEqual(notes(), ['cow scan; Cat', 'no']);
    r = await run('Perform Find/Replace [ With dialog: Off ; "COW" ; "x" ; Replace All ; Across: Current record ; Within: All fields ]');
    assert.deepEqual(notes(), ['x scan; Cat', 'no']);
    assert.deepEqual(names(), ['Alpha dog', 'concowenate'], 'only the current record');
    // Find Next: the next record with a match, the cursor in that field.
    r = await run('Perform Find/Replace [ With dialog: Off ; "concow" ; Find Next ]\nExit Script [ Result: Get ( RecordNumber ) & "/" & Get ( ActiveFieldName ) ]');
    assert.equal(r.result, '2/name');
    const missing = await run('Set Error Capture [ On ]\nPerform Find/Replace [ With dialog: Off ; "nothing like this" ; "y" ; Replace All ]\nExit Script [ Result: Get ( LastError ) ]');
    assert.equal(missing.result, '0');
    // Replace with no match selected changes nothing.
    const replace = await run('Set Error Capture [ On ]\nPerform Find/Replace [ With dialog: Off ; "a" ; "b" ; Replace ]\nExit Script [ Result: Get ( LastError ) ]');
    assert.equal(replace.result, '0');
    assert.deepEqual(names(), ['Alpha dog', 'concowenate']);
  } finally {
    t.undo();
  }
});

test('Perform Find/Replace: Find Next selects each match in turn, within a field too; Replace and Replace & Find change the selected match', { skip }, async () => {
  const t = store.trial();
  try {
    const ids = store.findIds(LAYOUT);
    store.update(LAYOUT, ids[0], { name: 'cat and Cat' });
    store.update(LAYOUT, ids[1], { name: 'a cat' });
    const names = () => ids.slice(0, 2).map((id) => String(store.get(LAYOUT, id).fieldData.name));
    const where = 'Get ( RecordNumber ) & ":" & Get ( ActiveFieldName ) & ":" & Get ( ActiveSelectionStart ) & ":" & Get ( ActiveSelectionSize )';
    const find = 'Perform Find/Replace [ With dialog: Off ; "cat" ; Find Next ; Within: Current field ]';
    const r = await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Set Selection [ Start Position: 1 ; End Position: 0 ]
      ${find}
      Set Variable [ $a ; Value: ${where} ]
      ${find}
      Set Variable [ $b ; Value: ${where} ]
      ${find}
      Exit Script [ Result: $a & "," & $b & "," & ${where} ]
    `);
    assert.equal(r.error, 0, JSON.stringify(r.trace?.filter((x) => x.error)));
    // The first two in record 1's field, then record 2's: the selection is each match.
    assert.equal(r.result, '1:name:1:3,1:name:9:3,2:name:3:3');

    // Replace changes the selected match only; Replace & Find changes it and selects the next.
    const rep = await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Set Selection [ Start Position: 1 ; End Position: 3 ]
      Perform Find/Replace [ With dialog: Off ; "cat" ; "dog" ; Replace ; Within: Current field ]
      Set Variable [ $a ; Value: ${where} ]
      Perform Find/Replace [ With dialog: Off ; "cat" ; "cow" ; Replace & Find ; Within: Current field ]
      Exit Script [ Result: $a & "," & ${where} ]
    `);
    assert.equal(rep.error, 0, JSON.stringify(rep.trace?.filter((x) => x.error)));
    // After Replace the selection is the new text; nothing matched there, so Replace & Find only found the next.
    assert.equal(rep.result, '1:name:1:3,1:name:9:3');
    assert.deepEqual(names(), ['dog and Cat', 'a cat']);
    const rf = await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Set Selection [ Start Position: 9 ; End Position: 11 ]
      Perform Find/Replace [ With dialog: Off ; "cat" ; "cow" ; Replace & Find ; Within: Current field ]
      Exit Script [ Result: ${where} ]
    `);
    assert.equal(rf.result, '2:name:3:3', 'replaced, then on to the next record\'s match');
    assert.deepEqual(names(), ['dog and cow', 'a cat']);
    // Match case: a selection that differs in case isn't a match.
    await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Set Selection [ Start Position: 9 ; End Position: 11 ]
      Perform Find/Replace [ With dialog: Off ; "COW" ; "x" ; Replace ; Match case ; Within: Current field ]
    `);
    assert.deepEqual(names(), ['dog and cow', 'a cat']);

    // Across the current record: back round to an earlier match in it, never on to the next record.
    const here = await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Set Selection [ Start Position: 9 ; End Position: 11 ]
      Perform Find/Replace [ With dialog: Off ; "o" ; Find Next ; Across: Current record ; Within: Current field ]
      Set Variable [ $a ; Value: ${where} ]
      Perform Find/Replace [ With dialog: Off ; "cat" ; Find Next ; Across: Current record ; Within: Current field ]
      Exit Script [ Result: $a & "," & ${where} ]
    `);
    assert.equal(here.result, '1:name:2:1,1:name:2:1', 'the "o" of dog; no cat in this record, so the cursor stays');
    // Whole words: "cat" isn't found inside "concatenate".
    store.update(LAYOUT, ids[1], { name: 'concatenate cat' });
    const whole = await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Perform Find/Replace [ With dialog: Off ; "cat" ; Find Next ; Whole words ; Within: Current field ]
      Exit Script [ Result: ${where} ]
    `);
    assert.equal(whole.result, '2:name:13:3');
    // No match anywhere: the cursor, the selection and the unsaved edit stay, and Revert Record still undoes it.
    const none = await run(`
      Go to Field [ LIBRARY_CODE::name ]
      Set Field [ "unsaved" ]
      Set Selection [ Start Position: 1 ; End Position: 2 ]
      Perform Find/Replace [ With dialog: Off ; "qqqqxx" ; Find Next ; Within: Current field ]
      Set Variable [ $a ; Value: ${where} ]
      Revert Record/Request [ With dialog: Off ]
      Exit Script [ Result: $a ]
    `);
    assert.equal(none.error, 0, JSON.stringify(none.trace?.filter((x) => x.error)));
    assert.equal(none.result, '1:name:1:2');
    assert.deepEqual(names(), ['dog and cow', 'concatenate cat']);
  } finally {
    t.undo();
  }
});

test('the person\'s window follows the cursor: Go to Field, Set Selection and Select All say where it is; a commit takes it out', { skip }, async () => {
  const t = store.trial();
  try {
    const none = await run('Set Variable [ $x ; Value: 1 ]');
    assert.equal(none.active, undefined, 'a script that never moves the cursor leaves the window\'s own');
    const set = await run(`
      Set Selection [ LIBRARY_CODE::code ; Start Position: 2 ; End Position: 4 ]
      Exit Script [ Result: Get ( ActiveFieldName ) & "|" & Get ( ActiveSelectionStart ) & "|" & Get ( ActiveSelectionSize ) ]
    `);
    assert.equal(set.result, 'code|2|3');
    assert.deepEqual(set.active && { ...set.active, objectId: typeof set.active.objectId }, { objectId: 'number', selection: [1, 4] });
    // An end before the start: the insertion point at the start.
    assert.deepEqual((await run('Go to Field [ LIBRARY_CODE::code ]\nSet Selection [ Start Position: 3 ; End Position: 1 ]')).active?.selection, [2, 2]);
    assert.equal((await run('Go to Field [ LIBRARY_CODE::code ]\nSelect All')).active?.selection, 'all');
    assert.equal((await run('Go to Field [ LIBRARY_CODE::code ]\nCommit Records/Requests [ With dialog: Off ]')).active, null);
  } finally {
    t.undo();
  }
});

test('Go to Object onto a field puts the cursor there for the client, and drops a selection made in another field', { skip }, async () => {
  // Name the code field's object, as a designer would in the Inspector (a design change: not on a trial).
  const l = store.designs().layouts.find((x) => x.name === LAYOUT)!;
  const named = (os: typeof l.objects): typeof l.objects => os.map((o) => ({ ...o, ...(o.kind === 'field' && o.field?.field === 'code' ? { name: 'codeBox' } : {}), ...(o.children ? { children: named(o.children) } : {}) }));
  store.applyDesign([{ op: 'updateLayout', layout: l.id, design: { objects: named(l.objects) } }]);
  const t = store.trial();
  try {
    const r = await run(`
      Set Selection [ LIBRARY_CODE::name ; Start Position: 2 ; End Position: 4 ]
      Go to Object [ "codeBox" ]
      Exit Script [ Result: Get ( ActiveFieldName ) & "|" & Get ( ActiveSelectionSize ) ]
    `);
    assert.equal(r.error, 0, JSON.stringify(r.trace?.filter((x) => x.error)));
    assert.equal(r.result, 'code|0');
    assert.ok(r.active && typeof r.active.objectId === 'number', JSON.stringify(r.active));
    assert.equal(r.active?.selection, undefined);
  } finally {
    t.undo();
  }
});

test('screen steps reach the person\'s window: View As, Set Zoom Level, Show/Hide Toolbars and Menubar (with Lock), Close Popover, Beep, Scroll Window', { skip }, async () => {
  // The Modules layout allows form view only: View As [ View as List ] there switches to nothing (view-change.test.ts).
  const r = await run(`
    View As [ View as List ]
    View As [ View as Form ]
    Set Zoom Level [ Lock ; 150% ]
    Set Zoom Level [ 50 + 25 ]
    Set Zoom Level [ Zoom In ]
    Show/Hide Toolbars [ Hide ]
    Show/Hide Toolbars [ Lock ; Show ]
    Show/Hide Menubar [ Lock ; Hide ]
    Close Popover
    Beep
    Scroll Window [ End ]
    Scroll Window [ To Selection ]
  `);
  assert.deepEqual(r.actions.map(({ script: _, ...a }) => a), [
    { step: 'View As', view: 'form' },
    { step: 'Set Zoom Level', zoom: 150, lock: true },
    { step: 'Set Zoom Level', zoom: 75 },
    { step: 'Set Zoom Level', zoom: 'in' },
    { step: 'Show/Hide Toolbars', showHide: 'hide' },
    { step: 'Show/Hide Toolbars', showHide: 'show', lock: true },
    { step: 'Show/Hide Menubar', showHide: 'hide', lock: true },
    { step: 'Close Popover' },
    { step: 'Beep' },
    { step: 'Scroll Window', scroll: 'end' },
    { step: 'Scroll Window', scroll: 'to selection' },
  ]);
});

test('View As, Set Zoom Level, Set Selection and Scroll Window read back from their script text', { skip }, () => {
  for (const line of ['View As [ View as Table ]', 'View As [ Cycle ]', 'Set Zoom Level [ Lock ; 25% ]', 'Set Zoom Level [ Zoom Out ]', 'Set Zoom Level [ Lock ; $zoom ]',
    'Set Selection [ LIBRARY_CODE::code ; Start Position: 1 ; End Position: Length ( LIBRARY_CODE::code ) ]', 'Set Selection [ Start Position: $at ]',
    'Scroll Window [ Home ]', 'Scroll Window [ End ]', 'Scroll Window [ Page Up ]', 'Scroll Window [ Page Down ]', 'Scroll Window [ To Selection ]']) {
    const [s] = parseScriptText(line, store.schema);
    assert.equal(stepLine(scriptStepName(s.stepId!), s.params), line);
  }
});

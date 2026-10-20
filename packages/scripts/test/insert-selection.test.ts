// Insert Text, Insert Calculated Result, Paste, Cut, Copy and Clear with and without "Select entire contents"
// (Claris: without it, "replaces only the selected portion of the active field, or inserts data at the insertion
// point. The default insertion point is at the end of the field's data", and for a variable "inserts data at the end").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-insert-selection-'));
  createStore(join(dir, 'T.sqlite'));
  store = new Store(join(dir, 'T.sqlite'), 'T');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Body' }, { name: 'Other' }] }]);
  store.create('Notes', { Body: 'abcdef', Other: 'xyz' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const parse = (text: string) => parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema);
const run = async (text: string, opts: RunOptions = {}) => {
  const t = store.trial();
  try {
    const r = await runScript(store, { id: 9999, name: 'test', steps: parse(text).map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })) } as Script,
      { layout: 'Notes', foundSet: store.findIds('Notes'), ...opts });
    assert.equal(r.error, 0, JSON.stringify(r.trace?.filter((x) => x.error)));
    return r.result;
  } finally {
    t.undo();
  }
};

test('Insert Text without Select replaces the selection or goes in at the insertion point; with Select it replaces the field', async () => {
  // Characters 2 to 4 selected in the active field: replaced.
  assert.equal(await run('Set Selection [ Notes::Body ; Start Position: 2 ; End Position: 4 ]\nInsert Text [ Notes::Body ; "X" ]\nExit Script [ Result: Notes::Body ]'), 'aXef');
  // An insertion point (nothing selected): in at it.
  assert.equal(await run('Set Selection [ Notes::Body ; Start Position: 3 ; End Position: 2 ]\nInsert Text [ Notes::Body ; "X" ]\nExit Script [ Result: Notes::Body ]'), 'abXcdef');
  // A field the cursor isn't in: at the end.
  assert.equal(await run('Go to Field [ Notes::Body ]\nInsert Text [ Notes::Other ; "!" ]\nExit Script [ Result: Notes::Other ]'), 'xyz!');
  assert.equal(await run('Insert Text [ Select ; Notes::Body ; "new" ]\nExit Script [ Result: Notes::Body ]'), 'new');
  // The active field with no target.
  assert.equal(await run('Set Selection [ Notes::Body ; Start Position: 1 ; End Position: 3 ]\nInsert Calculated Result [ Notes::Body ; 1 + 1 ]\nExit Script [ Result: Notes::Body ]'), '2def');
});

test('Insert Text into a variable without Select adds to the end; with Select it replaces', async () => {
  assert.equal(await run('Set Variable [ $v ; Value: "ab" ]\nInsert Text [ $v ; "cd" ]\nInsert Calculated Result [ $v ; "e" ]\nExit Script [ Result: $v ]'), 'abcde');
  assert.equal(await run('Set Variable [ $v ; Value: "ab" ]\nInsert Text [ Select ; $v ; "cd" ]\nExit Script [ Result: $v ]'), 'cd');
});

test('Cut, Copy and Clear without Select take only the selected text; with Select, or with nothing selected, the whole field', async () => {
  assert.equal(await run(`
    Set Selection [ Notes::Body ; Start Position: 2 ; End Position: 3 ]
    Cut [ Notes::Body ]
    Set Variable [ $after ; Value: Notes::Body ]
    Paste [ Notes::Body ]
    Exit Script [ Result: $after & "|" & Notes::Body ]`), 'adef|abcdef');
  assert.equal(await run(`
    Set Selection [ Notes::Body ; Start Position: 4 ; End Position: 6 ]
    Copy [ Notes::Body ]
    Paste [ Select ; Notes::Other ]
    Clear [ Notes::Body ]
    Exit Script [ Result: Notes::Other & "|" & Notes::Body ]`), 'def|abc');
  assert.equal(await run('Go to Field [ Notes::Body ]\nCopy [ Notes::Body ]\nClear [ Select ; Notes::Body ]\nPaste [ Select ; Notes::Other ]\nExit Script [ Result: Notes::Other & "|" & Notes::Body ]'), 'abcdef|');
});

test('script text keeps Select; a step that says nothing (a converted file) reads as Select, which is how it runs', () => {
  for (const line of ['Insert Text [ Select ; Notes::Body ; “x” ]', 'Insert Text [ Notes::Body ; “x” ]', 'Insert Calculated Result [ Select ; Notes::Body ; 1 ]',
    'Insert Calculated Result [ Notes::Body ; 1 ]', 'Paste [ Select ; Notes::Body ]', 'Paste [ Notes::Body ]', 'Cut [ Notes::Body ]', 'Copy [ Select ; Notes::Body ]', 'Clear [ Notes::Body ]']) {
    const [s] = parse(line);
    assert.equal(stepLine(scriptStepName(s.stepId!), s.params), line);
  }
  assert.equal(stepLine('Paste', undefined), 'Paste [ Select ]');
  assert.equal(stepLine('Insert Text', { field: parse('Insert Text [ Notes::Body ; "x" ]')[0].params!.field, text: 'x' }), 'Insert Text [ Select ; Notes::Body ; “x” ]');
});

test('FileMaker clipboard XML carries Select entire contents both ways', async () => {
  const { stepXml } = await import('../../store/src/snippet-xml.ts');
  const { kid, parseXml, stepSpec } = await import('../../store/src/snippet.ts');
  for (const line of ['Insert Text [ Notes::Body ; “x” ]', 'Insert Text [ Select ; Notes::Body ; “x” ]', 'Paste [ Notes::Body ]', 'Cut [ Select ; Notes::Body ]', 'Insert Calculated Result [ Notes::Body ; 1 ]']) {
    const [s] = parse(line);
    const xml = stepXml(store.schema, { stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params } as never, []);
    assert.match(xml, new RegExp(`<SelectAll state="${s.params?.selectEntireContents ? 'True' : 'False'}"`), line);
    const back = stepSpec(kid(parseXml(xml), 'Step')!, { schema: store.schema, notes: [], scripts: new Map() });
    assert.equal(back.params?.selectEntireContents, s.params?.selectEntireContents, line);
  }
});

test("Paste with nothing copied in the run pastes the person's own clipboard, asked for once; what the run copied doesn't ask", async () => {
  let asked = 0;
  const clipboard = async () => { asked++; return 'one\r\ntwo'; };
  assert.equal(await run('Paste [ Select ; Notes::Other ]\nPaste [ Notes::Body ]\nExit Script [ Result: Notes::Other & "|" & Notes::Body ]', { clipboard }),
    'one\rtwo|abcdefone\rtwo');
  assert.equal(asked, 1);
  assert.equal(await run('Copy [ Select ; Notes::Body ]\nPaste [ Select ; Notes::Other ]\nExit Script [ Result: Notes::Other ]', { clipboard }), 'abcdef');
  assert.equal(asked, 1);
  // Nothing on it, or the person won't give it: Paste leaves the field as it was.
  for (const answer of [undefined, '']) {
    assert.equal(await run('Paste [ Select ; Notes::Other ]\nExit Script [ Result: Notes::Other & "|" & Get ( LastError ) ]', { clipboard: async () => answer }), 'xyz|0');
  }
  // With no one to ask (a server run), Paste pastes only what the run copied.
  assert.equal(await run('Paste [ Select ; Notes::Other ]\nExit Script [ Result: Notes::Other ]'), 'xyz');
});

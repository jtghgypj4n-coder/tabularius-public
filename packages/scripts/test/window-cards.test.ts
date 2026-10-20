// Card windows (New Window [ Style: Card ]) and Close Window across runs: the web client sends the window a button
// was pressed in and the windows open behind it; the result says which window the script ended in and which it closed.
// The Beezwax samples' OnFirstWindowOpen opens "Configure AI" as a card, and its Cancel button closes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FmpFile, fileSource, readSchema, scriptText } from '@tabularius/fmp12';
import { createStore, designSnippet, snippetChanges, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'BeezwaxUnifiedSearchActions.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('the Beezwax Configure AI window is read as a card', { skip }, () => {
  const s = readSchema(new FmpFile(fileSource(fixture)));
  const sc = s.scripts.find((x) => x.name === 'configure ai account')!;
  const nw = sc.steps.filter((st) => st.name === 'New Window');
  assert.ok(nw.length >= 1);
  assert.ok(nw.every((st) => st.params?.windowStyle === 'card'));
  assert.match(scriptText(sc.steps), /New Window \[ Style: Card ; /);
  // Document windows in other samples stay documents.
  for (const other of ['Flicks.fmp12', 'FMburgh.fmp12']) {
    const path = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', other);
    if (!existsSync(path)) continue;
    for (const x of readSchema(new FmpFile(fileSource(path))).scripts) {
      for (const st of x.steps) if (st.name === 'New Window') assert.notEqual(st.params?.windowStyle, 'card', `${other}: ${x.name}`);
    }
  }
});

function withStore(fn: (store: Store) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-cards-'));
    createStore(join(dir, 'Search.sqlite'));
    const store = new Store(join(dir, 'Search.sqlite'), 'Search');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Main', fields: [{ name: 'Name', type: 'text' }] },
        { op: 'createTable', name: 'Configure AI', fields: [{ name: 'Key', type: 'text' }] },
        // A replica of "configure ai account": open shows the card, close (its Cancel) closes it.
        { op: 'createScript', name: 'configure ai account', text: [
          'If [ Get ( ScriptParameter ) = "close" ]',
          '  If [ Get ( WindowStyle ) = 3 ]',
          '    Close Window [ Current Window ]',
          '  End If',
          '  Exit Script [ Text Result: "closed" ]',
          'End If',
          'If [ Get ( WindowStyle ) ≠ 3 ]',
          '  New Window [ Style: Card ; "Configure AI" ; Using layout: “Configure AI” ]',
          'End If',
          'Exit Script [ Text Result: Get ( WindowStyle ) & "|" & Get ( LayoutName ) ]',
        ].join('\n') },
        { op: 'createScript', name: 'open and cancel', text: [
          'New Window [ Style: Card ; "Card" ; Using layout: “Configure AI” ]',
          'Close Window [ Current Window ]',
          'Exit Script [ Text Result: Get ( WindowStyle ) & "|" & Get ( LayoutName ) & "|" & Get ( WindowName ) ]',
        ].join('\n') },
        { op: 'createScript', name: 'plain', text: 'Exit Script [ Text Result: Get ( WindowStyle ) ]' },
      ] as never);
      await fn(store);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const main = { id: 'MAIN-1', name: 'Search', style: 'document' as const, layout: 'Main' };

test('a copied card-opening step preserves its style when executed', withStore(async (store) => {
  const xml = '<fmxmlsnippet type="FMObjectList"><Step id="122" name="New Window"><Name><Calculation><![CDATA["Copied card"]]></Calculation></Name><NewWndStyles Style="Card"/></Step><Step id="103" name="Exit Script"><Calculation><![CDATA[Get ( WindowStyle )]]></Calculation></Step></fmxmlsnippet>';
  store.applyDesign(snippetChanges(xml, store.schema).changes);
  const result = await runScript(store, 'Pasted Steps', { layout: 'Main', startWindow: main, openWindows: [main] });
  assert.equal(result.result, '3');
  assert.equal(result.window?.style, 'card');
}));

test('New Window as a card then Close Window in the same run returns to the window and layout before it', withStore(async (store) => {
  const r = await runScript(store, 'open and cancel', { layout: 'Main', startWindow: main, openWindows: [main] });
  assert.equal(r.result, '0|Main|Search');
  assert.equal(r.layout, 'Main');
  assert.deepEqual(r.window, { id: 'MAIN-1', name: 'Search', style: 'document' });
  assert.equal(r.closed?.length, 1);
  assert.notEqual(r.closed![0], 'MAIN-1');
}));

test('the Beezwax card: the first run opens it, the Cancel run closes it and shows the window behind as the person left it', withStore(async (store) => {
  const open = await runScript(store, 'configure ai account', { layout: 'Main', parameter: 'open', startWindow: main, openWindows: [main] });
  assert.equal(open.result, '3|Configure AI');
  assert.equal(open.layout, 'Configure AI');
  const card = open.window!;
  assert.equal(card.style, 'card');
  assert.equal(card.name, 'Configure AI');
  assert.equal(card.dimParent, true);
  assert.equal(card.closeButton, true);
  assert.notEqual(card.id, 'MAIN-1');
  assert.equal(open.closed, undefined);

  // Cancel, pressed in the card: the client sends the card as the start window, the main window behind it.
  const inCard = { id: card.id, name: card.name, style: card.style, layout: 'Configure AI' };
  const cancel = await runScript(store, 'configure ai account', { layout: 'Configure AI', parameter: 'close', startWindow: inCard, openWindows: [main, inCard] });
  assert.equal(cancel.result, 'closed');
  assert.deepEqual(cancel.closed, [card.id]);
  assert.deepEqual(cancel.window, { id: 'MAIN-1', name: 'Search', style: 'document', untouched: true });
  assert.equal(cancel.layout, 'Main');
}));

test('Get ( WindowStyle ) is 0 in a document window, and with no window sent', withStore(async (store) => {
  assert.equal((await runScript(store, 'plain')).result, '0');
  const r = await runScript(store, 'plain', { startWindow: { id: 'C', name: 'C', style: 'card' } });
  assert.equal(r.result, '3');
  assert.equal(r.window?.style, 'card');
  assert.equal((await runScript(store, 'plain')).window, undefined);
}));

test('a window behind on a layout that is gone still closes the card in front of it', withStore(async (store) => {
  const behind = { id: 'B', name: 'Old', layout: 'No Such Layout' };
  const card = { id: 'C', name: 'Card', style: 'card' as const, layout: 'Configure AI' };
  const r = await runScript(store, 'configure ai account', { layout: 'Configure AI', parameter: 'close', startWindow: card, openWindows: [behind, card] });
  assert.equal(r.result, 'closed');
  assert.deepEqual(r.closed, ['C']);
  assert.equal(r.window?.id, 'B');
}));

test('copied Select Window and Close Window act on their named target', withStore(async (store) => {
  const name = 'Target';
  store.applyDesign([{ op: 'createScript', name: 'select target', steps: [
    { name: 'Select Window', params: { slots: { 128: `"${name}"` } } },
    { name: 'Exit Script', params: { calculation: 'Get ( WindowName )' } },
  ] }, { op: 'createScript', name: 'close target', steps: [
    { name: 'Close Window', params: { slots: { 128: `"${name}"` } } },
    { name: 'Exit Script', params: { calculation: 'Get ( WindowName )' } },
  ] }] as never);
  for (const scriptName of ['select target', 'close target']) {
    const script = store.schema.scripts.find((s) => s.name === scriptName)!;
    const xml = designSnippet(store.schema, { scripts: [script.id] }).xml;
    store.applyDesign(snippetChanges(xml, store.schema).changes);
  }
  const copiedSelect = store.schema.scripts.find((s) => s.name === 'select target 2')!;
  const copiedClose = store.schema.scripts.find((s) => s.name === 'close target 2')!;
  const first = { id: 'FIRST', name: 'First', style: 'document' as const, layout: 'Main' };
  const target = { id: 'TARGET', name, style: 'document' as const, layout: 'Configure AI' };
  const selected = await runScript(store, copiedSelect.name, { layout: 'Main', startWindow: first, openWindows: [first, target] });
  assert.equal(selected.result, name);
  assert.equal(selected.window?.id, 'TARGET');
  const closed = await runScript(store, copiedClose.name, { layout: 'Main', startWindow: first, openWindows: [first, target] });
  assert.deepEqual(closed.closed, ['TARGET']);
  assert.equal(closed.window?.id, 'FIRST');
}));

test('a copied named window step still returns 112 when its target is missing', withStore(async (store) => {
  store.applyDesign([{ op: 'createScript', name: 'select missing', text: 'Select Window [ Name: "Absent" ]' }] as never);
  const original = store.schema.scripts.find((s) => s.name === 'select missing')!;
  const xml = designSnippet(store.schema, { scripts: [original.id] }).xml;
  store.applyDesign(snippetChanges(xml, store.schema).changes);
  const copied = store.schema.scripts.find((s) => s.name === 'select missing 2')!;
  const r = await runScript(store, copied.name, { startWindow: main, openWindows: [main] });
  assert.equal(r.error, 112);
}));

// Review of #504: a window of the person's behind a card knows nothing of their found set or record on the server, and
// used to start from every record at record 1, so a step after the card's Close Window changed the wrong record.
test('a step after Close Window never works on a record of the window behind it that the server cannot know', withStore(async (store) => {
  store.applyDesign([{ op: 'createScript', name: 'cancel then set', text: [
    'Close Window [ Current Window ]',
    'Go to Layout [ “Main” ]', 'Set Field [ Main::Name ; "Cancelled" ]',
  ].join('\n') }] as never);
  const first = store.create('Main', { Name: 'First' });
  const second = store.create('Main', { Name: 'Second' });
  const card = { id: 'C', name: 'Card', style: 'card' as const, layout: 'Configure AI' };
  const r = await runScript(store, 'cancel then set', { layout: 'Configure AI', startWindow: card, openWindows: [main, card], foundSet: [] });
  assert.equal(r.error, 101);
  for (const id of [first, second]) assert.notEqual(store.get('Main', Number((id as any).recordId ?? id))?.fieldData.Name, 'Cancelled');
}));

test('Select Window restores the supplied background found set and record before Next and the error dialog', withStore(async (store) => {
  store.applyDesign([{ op: 'createScript', name: 'Select B', text: [
    'Set Error Capture [ Off ]', 'Freeze Window', 'Select Window [ Name: "B" ]',
    'Go to Record/Request/Page [ Next ]', 'Go to Layout [ Layout Name: "Nowhere" ]',
  ].join('\n') }]);
  const first = Number(store.create('Main', { Name: 'First' }).recordId);
  const second = Number(store.create('Main', { Name: 'Second' }).recordId);
  let dialogs = 0;
  const r = await runScript(store, 'Select B', {
    layout: 'Main', startWindow: main, foundSet: [first, second], recordId: first,
    openWindows: [main, { id: 'B', name: 'B', layout: 'Main', foundSet: [second, first], recordId: second }],
    dialog: async (request) => {
      dialogs++;
      assert.match(request.message ?? '', /error 105/);
      assert.equal(request.state.window?.id, 'B');
      assert.equal(request.state.recordId, first, 'Next follows B\'s order and position, independently of A');
      assert.deepEqual(request.state.foundSet, [second, first]);
      assert.deepEqual(request.actions.filter((a) => a.step === 'Freeze Window').map((a) => a.windowId), [main.id]);
      return { button: 1 };
    },
  });
  assert.equal(dialogs, 1);
  assert.equal(r.window?.id, 'B');
  assert.equal(r.recordId, first);
}));

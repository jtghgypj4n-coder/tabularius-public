import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import type { Script } from '@tabularius/fmp12';
import { runScript, ScriptSession } from '../src/index.ts';

/** How the PDF writer spells a text string: UTF-16BE hex with a byte order mark. */
const utf16 = (s: string) => `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()}>`;

let dir: string;
let docs: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-dynapdf-'));
  docs = join(dir, 'Documents');
  mkdirSync(docs);
  createStore(join(dir, 'test.sqlite'));
  store = new Store(join(dir, 'test.sqlite'));
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  store.create('Items', { Name: 'one' });
});

after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9998, name: 'DynaPDF test', steps } as Script;
}

const run = async (text: string, session = new ScriptSession()) => runScript(store, script(text), { layout: 'Items', documents: docs, session });

test('MBS DynaPDF creates, saves, and reads a generated PDF with page metrics and text', async () => {
  const r = await run(`
    Set Variable [ $a ; Value: MBS ( "DynaPDF.Initialize" ; "unused" ) ]
    Set Variable [ $pdf ; Value: MBS ( "DynaPDF.New" ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetPageWidth" ; $pdf ; 300 ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetPageHeight" ; $pdf ; 400 ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetPageCoords" ; $pdf ; "TopDown" ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; 0 ; 12 ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetDocInfo" ; $pdf ; "Title" ; "Generated title" ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.AppendPage" ; $pdf ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetTextRect" ; $pdf ; 20 ; 30 ; 240 ; 90 ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.WriteFText" ; $pdf ; "left" ; "Hello DynaPDF" ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.EndPage" ; $pdf ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.AppendPage" ; $pdf ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.WriteFTextEx" ; $pdf ; 20 ; 30 ; 240 ; 90 ; "center" ; "Ex text" ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.EndPage" ; $pdf ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetSaveNewImageFormat" ; $pdf ; 0 ) ]
    Set Variable [ $pdfData ; Value: MBS ( "DynaPDF.Save" ; $pdf ; "generated.pdf" ) ]
    Exit Script [ Text Result: MBS ( "DynaPDF.GetPageCount" ; $pdf ) & "/" & MBS ( "DynaPDF.GetPageWidth" ; $pdf ) & "/" & MBS ( "DynaPDF.GetPageHeight" ; $pdf ) & "/" & GetTextFromPDF ( $pdfData ) ]
  `);
  assert.equal(r.result, '2/300/400/Hello DynaPDF\rEx text');
  assert.ok(existsSync(join(docs, 'generated.pdf')));
  assert.match(readFileSync(join(docs, 'generated.pdf'), 'latin1'), new RegExp(`/Title ${utf16('Generated title')}`));
});

test('MBS DynaPDF handles are per session, released references fail, and RenderPage stays unavailable', async () => {
  const session = new ScriptSession();
  const a = await run('Set Variable [ $r ; Value: MBS ( "DynaPDF.Initialize" ) ]\nExit Script [ Text Result: MBS ( "DynaPDF.New" ) ]', session);
  assert.notEqual(a.result, '?');
  assert.equal((await run(`Exit Script [ Text Result: MBS ( "DynaPDF.IsInitialized" ) ]`, session)).result, '1');
  assert.equal((await run(`Exit Script [ Text Result: MBS ( "DynaPDF.IsInitialized" ) ]`)).result, '0');
  const released = await run(`Set Variable [ $r ; Value: MBS ( "DynaPDF.Release" ; ${a.result} ) ]\nExit Script [ Text Result: MBS ( "DynaPDF.GetPageCount" ; ${a.result} ) ]`, session);
  assert.equal(released.result, '?');
  assert.equal((await run(`Exit Script [ Text Result: MBS ( "DynaPDF.RenderPage" ; "${a.result}" ; 1 ) ]`, session)).result,
    '[MBS] ERROR: DynaPDF.RenderPage is not available in Tabularius');
});

test('MBS DynaPDF refuses unsupported formatted text markup and invalid references', async () => {
  const r = await run(`
    Set Variable [ $a ; Value: MBS ( "DynaPDF.Initialize" ) ]
    Set Variable [ $pdf ; Value: MBS ( "DynaPDF.New" ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.AppendPage" ; $pdf ) ]
    Set Variable [ $a ; Value: MBS ( "DynaPDF.SetTextRect" ; $pdf ; 0 ; 0 ; 100 ; 100 ) ]
    Exit Script [ Text Result: MBS ( "DynaPDF.WriteFText" ; $pdf ; "left" ; "\\\\FC[255]unsupported" ) ]
  `);
  assert.match(r.result, /^\[MBS\] ERROR:/);
  const misuse = await run('Exit Script [ Text Result: MBS ( "DynaPDF.GetPageCount" ; "bogus" ) ]');
  assert.equal(misuse.result, '?');
});

test('MBS DynaPDF uses point dimensions and normalized DeviceRGB fill values', async () => {
  const r = await run(`
    Set Variable [ $r ; Value: MBS ( "DynaPDF.Initialize" ) ]
    Set Variable [ $pdf ; Value: MBS ( "DynaPDF.New" ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.SetPageWidth" ; $pdf ; 300 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.SetPageHeight" ; $pdf ; 400 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.AppendPage" ; $pdf ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.SetFillColor" ; $pdf ; 1 ; 0 ; 0 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.Rectangle" ; $pdf ; 10 ; 20 ; 40 ; 30 ; "fill" ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.SetTextRect" ; $pdf ; 10 ; 60 ; 200 ; 30 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.WriteFText" ; $pdf ; "left" ; "Red text" ) ]
    Set Variable [ $data ; Value: MBS ( "DynaPDF.Save" ; $pdf ; "color.pdf" ) ]
    Exit Script [ Text Result: MBS ( "DynaPDF.GetPageWidth" ; $pdf ) & "/" & MBS ( "DynaPDF.GetPageHeight" ; $pdf ) & "/" & GetTextFromPDF ( $data ) ]
  `);
  assert.equal(r.result, '300/400/Red text');
  const b = readFileSync(join(docs, 'color.pdf'), 'latin1');
  assert.match(b, /\/MediaBox \[0 0 300 400\]/);
  // The page content is one stream among several (main's writer puts a text map first), and it is not compressed.
  const content = b;
  assert.match(content, /1 0 0 rg/);
});

test('MBS DynaPDF caps live handles and pages', async () => {
  const make = Array.from({ length: 33 }, () => 'Set Variable [ $r ; Value: MBS ( "DynaPDF.New" ) ]').join('\n');
  const handles = await run(`Set Variable [ $r ; Value: MBS ( "DynaPDF.Initialize" ) ]\n${make}\nExit Script [ Text Result: $r ]`);
  assert.equal(handles.result, '[MBS] ERROR: DynaPDF handle limit reached');

  const pages = Array.from({ length: 501 }, () => 'Set Variable [ $r ; Value: MBS ( "DynaPDF.AppendPage" ; $pdf ) ]').join('\n');
  const pageLimit = await run(`Set Variable [ $r ; Value: MBS ( "DynaPDF.Initialize" ) ]\nSet Variable [ $pdf ; Value: MBS ( "DynaPDF.New" ) ]\n${pages}\nExit Script [ Text Result: $r ]`);
  assert.equal(pageLimit.result, '[MBS] ERROR: DynaPDF page limit reached');
});

test('MBS DynaPDF import, edit and close run through script calculations using only generated containers', async () => {
  const r = await run(`
    Set Variable [ $r ; Value: MBS ( "DynaPDF.Initialize" ) ]
    Set Variable [ $source ; Value: MBS ( "DynaPDF.New" ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.AppendPage" ; $source ; 1 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.WriteFTextEx" ; $source ; 10 ; 20 ; 200 ; 30 ; "left" ; "Source" ) ]
    Set Variable [ $input ; Value: MBS ( "DynaPDF.Save" ; $source ) ]
    Set Variable [ $dest ; Value: MBS ( "DynaPDF.New" ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.SetImportFlags" ; $dest ; "ImportAll¶ImportAsPage" ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.OpenPDFFromContainer" ; $dest ; $input ; 0 ; "" ) ]
    Set Variable [ $count ; Value: MBS ( "DynaPDF.GetImportPageCount" ; $dest ) ]
    Set Variable [ $last ; Value: MBS ( "DynaPDF.ImportPDFFile" ; $dest ; 1 ; 1 ; 1 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.EditPage" ; $dest ; 1 ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.WriteFTextEx" ; $dest ; 10 ; 100 ; 200 ; 30 ; "left" ; "Overlay" ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.EndPage" ; $dest ) ]
    Set Variable [ $r ; Value: MBS ( "DynaPDF.CloseImportFile" ; $dest ) ]
    Set Variable [ $saved ; Value: MBS ( "DynaPDF.Save" ; $dest ) ]
    Set Variable [ $missing ; Value: MBS ( "DynaPDF.GetImportPageCount" ; $dest ) ]
    Exit Script [ Text Result: $count & "/" & $last & "/" & GetTextFromPDF ( $saved ) & "/" & Let ( [ missing = MBS ( "DynaPDF.GetImportPageCount" ; $dest ) ] ; MBS ( "IsError" ) ) ]
  `);
  assert.equal(r.result, '1/1/Source\rOverlay/1');
});

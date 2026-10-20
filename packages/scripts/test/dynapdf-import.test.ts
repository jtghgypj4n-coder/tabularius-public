import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asText, evaluate, num, text, type Value } from '../../calc/src/index.ts';
import { pdfText, pdfPageCount } from '../../calc/src/pdf-text.ts';
import { dynapdfCall } from '../src/dynapdf.ts';

function api(session: object = {}) {
  const call = (name: string, ...args: Value[]) => dynapdfCall(`DynaPDF.${name}`, args, session) ?? text(`[MBS] ERROR: DynaPDF.${name} is not available in Tabularius`);
  call('Initialize');
  const handle = call('New');
  return { handle, call: (name: string, ...args: Value[]) => call(name, handle, ...args) };
}
function generated(labels = ['First', 'Second']): Value {
  const p = api();
  p.call('SetPageWidth', num(300)); p.call('SetPageHeight', num(400));
  p.call('SetPageCoords', text('TopDown'));
  for (const label of labels) {
    p.call('AppendPage');
    p.call('WriteFTextEx', num(10), num(20), num(250), num(30), text('left'), text(label));
    p.call('EndPage');
  }
  return p.call('Save');
}
function bytes(v: Value): Uint8Array { assert.equal(v.type, 'container'); if (v.type !== 'container' || !v.data) throw new Error('missing bytes'); return v.data; }
const missing = (v: Value) => assert.match(asText(v), /^\[MBS\] ERROR: .* is not available in Tabularius$/);

test('MBS dispatch keeps the own-function guard and tracks DynaPDF provider errors', () => {
  const session = {};
  const calls: string[] = [];
  const ctx = {
    pluginSession: session,
    mbsCall: (name: string, args: Value[]) => {
      calls.push(name);
      return dynapdfCall(name, args, session);
    },
  };
  const calc = (formula: string) => asText(evaluate(formula, ctx));
  assert.equal(calc('MBS ( "constructor" )'), '[MBS] ERROR: constructor is not available in Tabularius');
  assert.deepEqual(calls, []);
  assert.equal(calc('MBS ( "IsError" )'), '1');
  assert.equal(calc('MBS ( "DynaPDF.Initialize" )'), 'OK');
  assert.equal(calc('MBS ( "IsError" )'), '0');
  assert.equal(calc('MBS ( "DynaPDF.RenderPage" )'), '[MBS] ERROR: DynaPDF.RenderPage is not available in Tabularius');
  assert.equal(calc('MBS ( "IsError" )'), '1');
  const handle = calc('MBS ( "DynaPDF.New" )');
  assert.equal(calc(`MBS ( "DynaPDF.Unknown" ; ${handle} )`), '[MBS] ERROR: DynaPDF.Unknown is not available in Tabularius');
  assert.equal(calc('MBS ( "IsError" )'), '1');
  assert.equal(asText(evaluate('MBS ( "DynaPDF.Initialize" )')), '[MBS] ERROR: DynaPDF.Initialize is not available in Tabularius');
});

test('import lifecycle counts source pages separately, appends selected pages, replaces and closes the source', () => {
  const p = api();
  assert.equal(p.call('OpenPDFFromContainer', generated()).type, 'number');
  assert.equal(asText(p.call('GetImportPageCount')), '2');
  assert.equal(asText(p.call('GetPageCount')), '0');
  assert.equal(asText(p.call('ImportPDFPage', num(2))), 'OK');
  assert.equal(asText(p.call('OpenPDFFromContainer', generated(['Third']))), '0');
  assert.equal(asText(p.call('ImportPDFFile', num(2))), '2');
  assert.equal(asText(p.call('CloseImportFile')), 'OK');
  missing(p.call('GetImportPageCount'));
  assert.equal(pdfText(bytes(p.call('Save'))), 'Second\rThird');
  assert.equal(asText(p.call('Release')), 'OK');
  assert.equal(asText(p.call('GetPageCount')), '?');
});

test('default import flags accept names and unsigned numeric flags; unsupported options never report success', () => {
  const p = api();
  for (const flags of [text('ImportAll ImportAsPage'), text('ImportAsPage\rImportAll'), num(2415919102)]) {
    assert.equal(asText(p.call('SetImportFlags', flags)), 'OK');
  }
  for (const flags of [text('PrepareForPDFA'), text('ImportAll'), num(0), text('unknown')]) missing(p.call('SetImportFlags', flags));
  p.call('OpenPDFFromContainer', generated());
  missing(p.call('ImportPDFPage')); // Public page does not specify the omitted index's default.
  missing(p.call('ImportPDFPage', num(1), num(2)));
  assert.equal(asText(p.call('ImportPDFFile')), '2');
  missing(p.call('ImportPDFFile', num(1))); // overlapping import is a follow-up
  assert.equal(asText(p.call('GetPageCount')), '2');
});

test('EditPage appends missing pages and adds text to an imported page without replacing its contents', () => {
  const p = api();
  p.call('OpenPDFFromContainer', generated()); p.call('ImportPDFFile');
  assert.equal(asText(p.call('EditPage', num(1))), 'OK');
  assert.equal(asText(p.call('GetPageHeight')), '400');
  assert.equal(asText(p.call('WriteFTextEx', num(10), num(90), num(250), num(30), text('left'), text('Added'))), 'OK');
  p.call('EndPage');
  assert.equal(asText(p.call('EditPage', num(4))), 'OK');
  p.call('EndPage');
  const saved = bytes(p.call('Save'));
  assert.equal(pdfPageCount(saved), 4);
  assert.equal(pdfText(saved), 'First\rAdded\rSecond');
});

test('failed open, import and edit preserve the source, pages and current drawing state', () => {
  const p = api(); p.call('OpenPDFFromContainer', generated());
  missing(p.call('OpenPDFFromContainer', text('http://127.0.0.1:1/no.pdf')));
  missing(p.call('OpenPDFFromContainer', { type: 'container', value: 'bad.pdf', data: Buffer.from('%PDF-1.4\n') }));
  assert.equal(asText(p.call('GetImportPageCount')), '2');
  p.call('AppendPage');
  missing(p.call('ImportPDFPage', num(9)));
  missing(p.call('EditPage', num(501)));
  assert.equal(asText(p.call('Rectangle', num(0), num(0), num(1), num(1), text('fill'))), 'OK');
  assert.equal(asText(p.call('GetPageCount')), '1');
});

test('page caps reject whole imports and EditPage expansion before modifying the document', () => {
  const p = api(); p.call('OpenPDFFromContainer', generated());
  for (let i = 0; i < 499; i++) p.call('AppendPage');
  missing(p.call('ImportPDFFile', num(500)));
  assert.equal(asText(p.call('GetPageCount')), '499');
  assert.equal(asText(p.call('ImportPDFPage', num(1))), 'OK');
  assert.equal(asText(p.call('GetPageCount')), '500');
});

test('drawing object cap rejection does not poison subsequent smaller operations', () => {
  const p = api(); p.call('AppendPage'); p.call('SetPageCoords', text('TopDown'));
  for (let i = 0; i < 9999; i++) p.call('Rectangle', num(0), num(0), num(1), num(1), text('fill'));
  assert.match(asText(p.call('WriteFTextEx', num(0), num(0), num(200), num(100), text('left'), text('A\rB'))), /^\[MBS\] ERROR:/);
  assert.equal(asText(p.call('Rectangle', num(0), num(0), num(1), num(1), text('fill'))), 'OK');
});

test('generated PDF truncations and deterministic mutations return errors or bounded results', { timeout: 15000 }, () => {
  const original = Buffer.from(bytes(generated()));
  const start = performance.now();
  const cases: Buffer[] = [];
  for (let at = 0; at < original.length; at += Math.ceil(original.length / 24)) cases.push(original.subarray(0, at));
  for (let i = 0; i < 40; i++) { const b = Buffer.from(original); b[(i * 7919) % b.length] ^= 0xff; cases.push(b); }
  for (const b of cases) {
    const p = api();
    const opened = p.call('OpenPDFFromContainer', { type: 'container', value: 'generated.pdf', data: b });
    if (opened.type === 'number') {
      const count = Number(asText(p.call('GetImportPageCount')));
      assert.ok(count > 0 && count <= 500);
      const result = p.call('ImportPDFFile');
      if (result.type === 'number') {
        const saved = bytes(p.call('Save'));
        assert.ok(saved.length <= 16 * 1024 * 1024);
        assert.equal(pdfPageCount(saved), count);
      } else missing(result);
    } else missing(opened);
    p.call('CloseImportFile');
  }
  assert.ok(performance.now() - start < 10000, 'bounded well above ordinary sub-second execution');
});


test('import sources belong to their script session and closing one does not affect another', () => {
  const a = api(), b = api();
  a.call('OpenPDFFromContainer', generated());
  b.call('OpenPDFFromContainer', generated(['Other']));
  a.call('CloseImportFile');
  missing(a.call('GetImportPageCount'));
  assert.equal(asText(b.call('GetImportPageCount')), '1');
  assert.equal(asText(b.call('ImportPDFPage', num(1))), 'OK');
  assert.equal(pdfText(bytes(b.call('Save'))), 'Other');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../../calc/src/index.ts';
import { dataHtml } from '../src/layout.ts';
import { FORMULA_LIMIT, modernDesign, pageSizeNote, modernPage, pageFormula, pageSource, starterPage } from '../src/page-source.ts';

test('modern layouts: a page goes into the address formula and comes back exactly, whatever it holds', () => {
  const html = '<style>b { color: #f00 }</style><b title="say \\"hi\\"">50% ¶ \\ done</b>\n<script>FileMaker.PerformScript("Go", "1")</script>';
  const formula = pageFormula(html);
  assert.equal(pageSource(formula), html);
  // FileMaker works the formula out to a base64 data address (a # would cut a raw one short in FileMaker Pro's web viewer).
  const url = evaluateText(formula);
  assert.match(url, /^data:text\/html;base64,[A-Za-z0-9+/=]+$/);
  assert.equal(dataHtml(url)!.replace(/\r/g, '\n'), html);
});

test('modern layouts: an address built from fields is not a page to edit', () => {
  assert.equal(pageSource('"https://maps.example.com/?q=" & Customers::City'), undefined);
  assert.equal(pageSource('"data:text/html;base64," & Base64EncodeRFC ( 4648 ; App::HTML )'), undefined);
  assert.equal(pageSource('"data:text/html;base64," & Base64EncodeRFC ( 4648 ; "a" ) & "b" & Base64EncodeRFC ( 4648 ; "c" )'), undefined);
  assert.equal(pageSource(undefined), undefined);
});

test('modern layouts: a new one is one web viewer filling the window, scripts allowed, its starter page small enough for FileMaker Pro', () => {
  const d = modernDesign('Sales <Q4>', 'Invoices');
  assert.equal(d.objects.length, 1);
  const [o] = d.objects;
  assert.equal(o.kind, 'web-viewer');
  assert.deepEqual(o.anchors, { left: true, top: true, right: true, bottom: true });
  assert.deepEqual(o.bounds, { top: 0, left: 0, bottom: d.parts[0].height, right: d.width });
  assert.equal(o.webOptions?.jsBridge, true);
  assert.equal(o.webOptions?.encodeUrl, false);
  const page = modernPage(d.objects);
  assert.equal(page?.html, starterPage('Sales <Q4>', 'Invoices'));
  assert.ok(page!.html.includes('<h1>Sales Q4</h1>'));
  assert.ok(page!.html.includes('const LAYOUT = "Invoices";'));
  assert.ok(o.webUrl!.length < FORMULA_LIMIT);
});

test('modern layouts: the editor warns from nine tenths of the formula limit, and says it shows only in Tabularius beyond it', () => {
  assert.equal(pageSizeNote(1000).level, 'ok');
  assert.equal(pageSizeNote(FORMULA_LIMIT * 0.9 - 1).level, 'ok');
  const near = pageSizeNote(FORMULA_LIMIT * 0.9);
  assert.equal(near.level, 'near');
  assert.match(near.text, /close to the limit/);
  assert.equal(pageSizeNote(FORMULA_LIMIT).level, 'near');
  const over = pageSizeNote(FORMULA_LIMIT + 1);
  assert.equal(over.level, 'over');
  assert.match(over.text, /only in Tabularius/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NameTable, evaluateText, type CalcContext, type Value } from '@tabularius/calc';
import { appendPdf, pdf, type PdfPage } from '../src/pdf.ts';

// What Save Records as PDF writes (wrapped lines, WinAnsi text, pages appended later) reads back with GetTextFromPDF.
const page = (text: string): PdfPage => ({ width: 612, height: 792, ops: [
  { kind: 'text', text, left: 72, top: 72, width: 300, height: 100, style: { size: 12 } },
  { kind: 'text', text: 'Total: €12', left: 72, top: 200, width: 300, height: 20 },
] });

test('GetTextFromPDF reads the PDFs Tabularius writes, appended pages included', () => {
  const first = pdf([page('Invoice 42 for Café Ada, a long line that wraps across the box width here')]);
  const both = Buffer.concat([first, appendPdf(first, [page('Second page')])]);
  const fields: Record<string, Value> = { One: { type: 'container', value: 'a.pdf', data: first }, Both: { type: 'container', value: 'b.pdf', data: both } };
  const ctx: CalcContext = { names: new NameTable({ fields: Object.keys(fields) }), field: (ref) => fields[ref.field] };
  assert.equal(evaluateText('GetTextFromPDF ( One )', ctx), 'Invoice 42 for Café Ada, a long line that wraps across\rthe box width here\rTotal: €12');
  assert.equal(evaluateText('GetTextFromPDF ( Both )', ctx), 'Invoice 42 for Café Ada, a long line that wraps across\rthe box width here\rTotal: €12\rSecond page\rTotal: €12');
});

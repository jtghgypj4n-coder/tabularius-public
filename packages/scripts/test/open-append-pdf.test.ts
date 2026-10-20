// Open PDF and Append PDF (help.claris.com open-pdf and append-pdf): open an existing PDF, add the pages of others, save it with Close PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, scriptText, type Script } from '@tabularius/fmp12';
import { pdfPageCount, pdfText } from '@tabularius/calc';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';
import { pdf, appendPdf, type PdfPage } from '../src/pdf.ts';

const page = (text: string): PdfPage => ({ width: 612, height: 792, ops: [{ kind: 'text', text, left: 72, top: 72, width: 300, height: 100, style: { size: 12 } }] });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-open-pdf-'));
  createStore(join(dir, 'Target.sqlite'));
  const store = new Store(join(dir, 'Target.sqlite'), 'Target');
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Name', type: 'text' }] }] as never);
  const run = (...lines: string[]) => {
    const steps = parseScriptText(lines.join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
    return runScript(store, { id: 1, name: 'Merge', steps } as Script, { layout: 'Docs', documents: dir });
  };
  const write = (name: string, bytes: Uint8Array) => writeFileSync(join(dir, name), bytes);
  const read = (name: string) => readFileSync(join(dir, name));
  return { dir, store, run, write, read, close: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

test('Open PDF, Append PDF and Close PDF combine files, in order, and leave the originals as they were', async () => {
  const s = setup();
  try {
    const a = pdf([page('Cover'), page('Summary')]);
    s.write('a.pdf', a);
    s.write('b.pdf', Buffer.concat([pdf([page('Appendix one')]), appendPdf(pdf([page('Appendix one')]), [page('Appendix two')])]));
    const r = await s.run('Open PDF [ From: File ; “a.pdf” ]', 'Append PDF [ From: File ; “b.pdf” ]', 'Append PDF [ From: File ; “a.pdf” ]', 'Close PDF [ Save to: File ; “out.pdf” ]');
    assert.equal(r.error, 0);
    const out = s.read('out.pdf');
    assert.equal(pdfPageCount(out), 6);
    assert.equal(pdfText(out), 'Cover\rSummary\rAppendix one\rAppendix two\rCover\rSummary');
    assert.deepEqual(s.read('a.pdf'), a);
  } finally { s.close(); }
});

test('Open PDF then Close PDF writes the file as it was', async () => {
  const s = setup();
  try {
    const a = pdf([page('Only')]);
    s.write('a.pdf', a);
    assert.equal((await s.run('Open PDF [ From: File ; “a.pdf” ]', 'Close PDF [ Save to: File ; “copy.pdf” ]')).error, 0);
    assert.deepEqual(s.read('copy.pdf'), a);
  } finally { s.close(); }
});

test('Append PDF onto Create PDF with nothing made yet gives just the source, and a PDF can come from a variable', async () => {
  const s = setup();
  try {
    s.write('a.pdf', pdf([page('One')]));
    s.write('b.pdf', pdf([page('Two')]));
    const r = await s.run(
      'Open PDF [ From: File ; “b.pdf” ]', 'Close PDF [ Save to: Target ; Target: $held ; Filename: "Held" ]',
      'Create PDF', 'Append PDF [ From: File ; “a.pdf” ]', 'Append PDF [ From: Source ; Source: $held ]', 'Close PDF [ Save to: File ; “out.pdf” ]');
    assert.equal(r.error, 0);
    assert.equal(pdfText(s.read('out.pdf')), 'One\rTwo');
  } finally { s.close(); }
});

test('A source file that is not in the documents folder is error 830', async () => {
  const s = setup();
  try {
    assert.equal((await s.run('Open PDF [ From: File ; “missing.pdf” ]')).error, 830);
    assert.equal((await s.run('Open PDF [ From: File ; “../outside.pdf” ]')).error, 830);
  } finally { s.close(); }
});

test('Claris error codes: 829 nothing open, 833 already open, 830 not a PDF, 831 and 832 encrypted', async () => {
  const s = setup();
  try {
    s.write('a.pdf', pdf([page('One')]));
    s.write('junk.pdf', Buffer.from('not a pdf at all'));
    s.write('locked.pdf', Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 2 0 R >>\n%%EOF\n'));
    assert.equal((await s.run('Append PDF [ From: File ; “a.pdf” ]')).error, 829);
    assert.equal((await s.run('Open PDF [ From: File ; “a.pdf” ]', 'Open PDF [ From: File ; “a.pdf” ]')).error, 833);
    assert.equal((await s.run('Cancel PDF')).error, 5);
    assert.equal((await s.run('Open PDF [ From: File ; “junk.pdf” ]')).error, 830);
    assert.equal((await s.run('Open PDF [ From: File ; “locked.pdf” ]')).error, 831);
    assert.equal((await s.run('Open PDF [ From: File ; “locked.pdf” ; Password: "secret" ]')).error, 832);
    // Each run starts without a PDF open, and a failed Open leaves none.
    assert.equal((await s.run('Close PDF [ Save to: File ; “x.pdf” ]')).error, 5);
  } finally { s.close(); }
});

test('Cancel PDF drops an opened PDF; the options round-trip through script text', async () => {
  const s = setup();
  try {
    s.write('a.pdf', pdf([page('One')]));
    assert.equal((await s.run('Open PDF [ From: File ; “a.pdf” ]', 'Cancel PDF', 'Create PDF', 'Cancel PDF')).error, 0);
    const text = ['Open PDF [ From: File ; “a.pdf” ; Password: "x" ]', 'Append PDF [ From: Source ; Source: $held ]', 'Append PDF [ From: Source ; Source: Docs::Name ]'];
    const steps = parseScriptText(text.join('\n'), s.store.schema);
    assert.equal(scriptText(steps.map((x) => ({ stepId: x.stepId!, name: scriptStepName(x.stepId!), enabled: true, params: x.params }))), text.join('\n'));
  } finally { s.close(); }
});

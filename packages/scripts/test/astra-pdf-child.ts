import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { PdfLimitError } from '@tabularius/calc';
import type { Script } from '@tabularius/fmp12';
import { runScript, type ScriptAi } from '../src/index.ts';

const make = (n: number) => Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
  '2 0 obj << /Type /Pages /Kids [' + Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(' ') + `] /Count ${n} >> endobj\n` +
  Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`).join('') +
  'trailer << /Root 1 0 R >>\n%%EOF');
const dir = mkdtempSync(join(tmpdir(), 'tabularius-pdf-limit-'));
createStore(join(dir, 'Target.sqlite'));
const store = new Store(join(dir, 'Target.sqlite'), 'Target');
try {
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Name', type: 'text' }] }]);
  const run = (...lines: string[]) => {
    const steps = parseScriptText(lines.join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
    return runScript(store, { id: 1, name: 'Pages', steps } as Script, { layout: 'Docs', documents: dir });
  };
  const original = make(1);
  writeFileSync(join(dir, 'out.pdf'), original);
  writeFileSync(join(dir, 'one.pdf'), original);
  writeFileSync(join(dir, 'large.pdf'), make(5001));
  writeFileSync(join(dir, 'exact.pdf'), make(5000));
  for (const lines of [
    ['Open PDF [ From: File ; “large.pdf” ]'],
    ['Open PDF [ From: File ; “one.pdf” ]', 'Append PDF [ From: File ; “large.pdf” ]'],
    ['Open PDF [ From: File ; “exact.pdf” ]', 'Append PDF [ From: File ; “one.pdf” ]'],
    ['Set Variable [ $r ; Value: BE_PDFGetPages ( "large.pdf" ; "out.pdf" ; 1 ) ]'],
  ]) {
    await assert.rejects(run(...lines, 'Close PDF [ Save to: File ; “out.pdf” ]'), PdfLimitError);
    assert.deepEqual(readFileSync(join(dir, 'out.pdf')), original);
  }
  let calls = 0;
  const ai: ScriptAi = {
    refusal: () => undefined,
    generate: async () => { calls++; return ''; },
    embed: async () => { calls++; return [[1]]; },
    rag: {
      add: () => { calls++; return 'doc'; }, search: () => [], remove: () => 0,
      spaces: () => [], info: () => undefined,
    },
  };
  const ragScript = {
    id: 2, name: 'Read', steps: [
      { stepId: 227, name: 'Configure RAG Account', enabled: true, params: { ai: { ragAccountName: '"rag"' } } },
      { stepId: 219, name: 'Perform RAG Action', enabled: true, params: { filePaths: ['large.pdf'], ai: {
        ragAccountName: '"rag"', spaceId: '"pages"', ragAction: 'add data', dataSource: 'from file',
      } } },
    ],
  } as Script;
  await assert.rejects(runScript(store, ragScript, { layout: 'Docs', documents: dir, ai }), PdfLimitError);
  assert.equal(calls, 0);
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}

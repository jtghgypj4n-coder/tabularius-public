import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { SCRIPT_STEP_NAMES, scriptStepId } from '../../fmp12/src/script-steps.ts';
import { ERROR_3_STEPS } from '../src/unavailable-steps.ts';
import { runScript } from '../src/index.ts';
import { checkOrWrite, indexText, pageText, stepPages } from '../../../scripts/script-step-pages.ts';

const pages = stepPages();

test('one generated page covers each registered step and all outputs are current', () => {
  assert.equal(pages.length, SCRIPT_STEP_NAMES.length);
  assert.deepEqual(pages.map((p) => p.name), SCRIPT_STEP_NAMES);
  assert.deepEqual(pages.map((p) => p.id), SCRIPT_STEP_NAMES.map((n) => scriptStepId(n)));
  assert.deepEqual(checkOrWrite(true).stale, []);
  const index = indexText();
  for (const p of pages) {
    assert.equal(index.split(`](${p.slug}.md)`).length, 2, `${p.name} occurs once in index`);
    const text = pageText(p);
    for (const heading of ['## What the engine does', '## Options', '## Privileges', '## Error codes', '## Offline script example'])
      assert.ok(text.includes(heading), `${p.name}: ${heading}`);
    assert.match(text, /\*\*Expected end state:\*\*/);
    assert.doesNotMatch(p.example, /\b(?:Send Mail|Insert from URL|Install Plug-In File|Perform RAG Action)\b/);
  }
});

test('support classifications agree with the engine availability list', () => {
  for (const p of pages) if (ERROR_3_STEPS.has(p.name)) {
    assert.equal(p.status, 'error 3', p.name);
    assert.ok(p.codes.includes(3), p.name);
    assert.match(pageText(p), /## Replacement/);
  }
  for (const name of ['Print Setup', 'Open Help'])
    assert.equal(pages.find((p) => p.name === name)?.status, 'does nothing');
  // Refresh Portal clears the read cache and asks the client to refresh, so it is partly supported.
  for (const name of ['Refresh Portal', 'Import Records', 'Save Records as PDF', 'Send Mail'])
    assert.equal(pages.find((p) => p.name === name)?.status, 'partly');
});

test('Refresh Portal is documented as a handler with a missing-target error', () => {
  const page = pages.find((p) => p.id === 180)!;
  // Main classes Refresh Portal as partly supported (it clears the read cache and asks the client to refresh); the page still documents the handler.
  assert.equal(page.status, 'partly');
  assert.ok(page.codes.includes(116));
  assert.doesNotMatch(pageText(page), /does nothing|without an action/);
});

test('every inert client-flow and dictionary step is documented as doing nothing', () => {
  for (const id of [32, 105, 109, 113, 114, 118, 129, 172, 183, 209]) {
    const page = pages.find((p) => p.id === id)!;
    assert.equal(page.status, 'does nothing', page.name);
    assert.match(pageText(page), /The engine accepts this step but does not perform its named action\./);
    assert.doesNotMatch(pageText(page), /The engine has a handler/);
  }
});

test('Close File documents the unnamed-file no-op without classifying every Close File as inert', () => {
  for (const path of ['scripts/script-steps-support-source.md', 'docs/script-steps-support.md']) {
    const text = readFileSync(join(import.meta.dirname, '../../..', path), 'utf8');
    const section = text.split('## Does nothing\n')[1].split('\n## ')[0];
    assert.match(section, /Close File with no file named leaves the current file open while its script runs\./);
  }
  assert.equal(pages.find((p) => p.id === 34)?.status, 'works');
});

test('selected examples run on a synthetic offline solution and reach their stated end state', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-step-pages-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const wanted: Record<string, string> = { 'Set Variable': '5', 'Exit Script': 'done', 'Set Error Capture': 'done',
    'Allow User Abort': 'done', 'If': 'after', 'Loop': '2', '# (comment)': 'done',
    'New Record/Request': '1', 'Set Field': 'Mira', 'Commit Records/Requests': 'Mira',
    'Delete Record/Request': '0', 'Show All Records': '0', 'Go to Layout': 'Examples' };
  for (const [name, result] of Object.entries(wanted)) {
    const path = join(dir, `${scriptStepId(name)}.sqlite`);
    createStore(path);
    const store = new Store(path, 'Examples');
    store.applyDesign([{ op: 'createTable', name: 'Examples', fields: [{ name: 'Name', type: 'text' }] }]);
    const p = pages.find((entry) => entry.name === name)!;
    const steps = parseScriptText(p.example, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
    const run = await runScript(store, { id: 91, name: 'reference-example', steps } as never, { layout: 'Examples' });
    assert.equal(run.error, 0, name);
    assert.equal(run.result, result, name);
    assert.equal(store.findIds('Examples').length, ['New Record/Request', 'Set Field', 'Commit Records/Requests'].includes(name) ? 1 : 0, `${name} record count`);
    store.close();
  }
});

test('the support page is emitted from the same source as the step pages', () => {
  const generated = readFileSync(join(import.meta.dirname, '../../../docs/script-steps-support.md'), 'utf8');
  const source = readFileSync(join(import.meta.dirname, '../../../scripts/script-steps-support-source.md'), 'utf8');
  assert.equal(generated, `<!-- Generated by scripts/script-step-pages.ts from scripts/script-steps-support-source.md. -->\n${source}`);
});

test('all examples parse and no-op examples succeed offline without record changes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-step-examples-'));
  const path = join(dir, 'Examples.sqlite');
  createStore(path);
  const store = new Store(path, 'Examples');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  store.applyDesign([{ op: 'createTable', name: 'Examples', fields: [{ name: 'Name', type: 'text' }] }]);
  for (const p of pages) {
    const steps = parseScriptText(p.example, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
    assert.ok(steps.length, `${p.name} parses`);
    if (p.status !== 'does nothing' || p.name === '# (comment)') continue;
    const run = await runScript(store, { id: p.id, name: 'reference-example', steps } as never, { layout: 'Examples' });
    assert.equal(run.error, 0, `${p.name} outcome`);
    assert.equal(store.findIds('Examples').length, 0, `${p.name} leaves records unchanged`);
  }
});

test('bare offline examples match their recorded error and record count', async (t) => {
  const outcomes = JSON.parse(readFileSync(join(import.meta.dirname, '../../../scripts/script-step-bare-outcomes.json'), 'utf8')) as
    { id: number; error: number; count: number }[];
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-step-bare-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  for (const outcome of outcomes) {
    const p = pages.find((entry) => entry.id === outcome.id)!;
    const path = join(dir, `${p.id}.sqlite`);
    const documents = join(dir, `${p.id}-documents`);
    mkdirSync(documents);
    createStore(path);
    const store = new Store(path, 'Examples');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Examples', fields: [{ name: 'Name', type: 'text' }] }]);
      store.create('Examples', { Name: 'Mira' });
      const steps = parseScriptText(p.example, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
      const run = await runScript(store, { id: p.id, name: 'bare-example', steps } as never,
        { layout: 'Examples', maxSteps: 10, timeoutMs: 3000, documents });
      assert.equal(run.error, outcome.error, `${p.name} error`);
      const ids = store.findIds('Examples');
      assert.equal(ids.length, outcome.count, `${p.name} record count`);
      for (const id of ids) assert.equal(store.get('Examples', id).fieldData.Name, 'Mira', `${p.name} record value`);
    } finally { store.close(); }
  }
});

test('generated local links resolve and pages contain no machine paths', () => {
  const dir = join(import.meta.dirname, '../../../docs/reference/script-steps');
  for (const p of pages) {
    const text = pageText(p);
    assert.doesNotMatch(text, /\/Users\/|fixtures\//, p.name);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^(https?:|mailto:)/.test(link)) continue;
      assert.ok(existsSync(resolve(dir, link)), `${p.name}: ${link}`);
    }
  }
});

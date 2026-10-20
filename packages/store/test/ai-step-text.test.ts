// The AI script steps read back from the text Tabularius writes for them, so a step edited or written in the script
// editor keeps its account, model, fields and options (before, the labels were kept as formulas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-text-'));
  createStore(join(dir, 'A.sqlite'));
  store = new Store(join(dir, 'A.sqlite'), 'A');
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Body' }, { name: 'Vec', type: 'container' }, { name: 'Key' }] }]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const parse = (line: string) => parseScriptText(line, store.schema)[0];

test('each AI step reads back from its own text, options included', () => {
  for (const line of [
    'Configure AI Account [ Account Name: "acct" ; Endpoint: "https://llm.example/v1" ; API key: Docs::Key ]',
    'Insert Embedding [ Account Name: "acct" ; Model: "embed" ; Input: Docs::Body ; Target: Docs::Vec ]',
    'Insert Embedding [ Account Name: "acct" ; Model: "embed" ; Input: "hello" ; Target: $vector ]',
    'Insert Embedding in Found Set [ Account Name: "acct" ; Model: "embed" ; Source Field: Docs::Body ; Target Field: Docs::Vec ]',
    'Insert Embedding in Found Set [ Account Name: "acct" ; Model: "embed" ; Source Field: Docs::Body ; Target Field: Docs::Vec ; Replace target contents ; Continue on error ; Show summary ; Parameters: JSONSetElement ( "{}" ; "MaxRecPerCall" ; 5 ; JSONNumber ) ]',
    'Perform Semantic Find [ Query by: Natural language ; Account Name: "acct" ; Embedding Model: "embed" ; Text: $q ; Record set: Current found set ; Target: Docs::Vec ; Return count: 5 ; Cosine similarity condition: greater than or equal to ; Cosine similarity value: .8 ]',
    'Perform Semantic Find [ Query by: Vector data ; Vector: $v ; Record set: All records ; Target: Docs::Vec ; Cosine similarity condition: greater than ; Cosine similarity value: .75 ]',
    'Generate Response from Model [ Account Name: "acct" ; Model: "chat" ; User Prompt: $ask ; Instructions: "Be brief" ; Messages: $$chat ; Save Message History To: $$chat ; Message History Count: 10 ; Response: $answer ]',
    'Perform RAG Action [ RAG Account Name: "rag" ; Space ID: "docs" ; Action: Add data ; RAG Data: From container ; Tokens per text chunk: 512 ; Input: Docs::Vec ]',
    'Configure Prompt Template [ Template Name: "sql" ; Template Type: SQL query ; SQL Prompt: "Write SQL" ]',
  ]) {
    const s = parse(line);
    const name = scriptStepName(s.stepId!);
    assert.equal(s.params?.slots, undefined, `${line}: every option is read`);
    assert.equal(stepLine(name, s.params), line);
  }
});

test('Insert Embedding in Found Set: Replace target contents is off unless written; Parameters and fields are kept apart', () => {
  const off = parse('Insert Embedding in Found Set [ Account Name: "acct" ; Model: "embed" ; Source Field: Docs::Body ; Target Field: Docs::Vec ; Parameters: "{}" ]');
  assert.equal(off.params?.ai?.replaceTarget, false);
  assert.equal(off.params?.ai?.sourceField?.field.name, 'Body');
  assert.equal(off.params?.field?.field.name, 'Vec');
  assert.equal(off.params?.ai?.parameters, '"{}"');
  // A step read from a file, where the option isn't decoded yet, replaces as before, and says so.
  assert.match(stepLine('Insert Embedding in Found Set', { ai: { accountName: '"a"' } }), /Replace target contents/);
});

test("a key written into the script, shown as \"…\", isn't read back as the key", () => {
  assert.throws(() => parse('Configure AI Account [ Account Name: "acct" ; API key: "…" ]'), /API key "…"/);
  // A key from a field or variable is shown, and reads back.
  assert.equal(parse('Configure AI Account [ Account Name: "acct" ; API key: $$key ]').params?.ai?.apiKey, '$$key');
  // An option that isn't one of the step's is refused, saying which are.
  assert.throws(() => parse('Perform Semantic Find [ Query by: Telepathy ]'), /natural language, vector data, image/);
});

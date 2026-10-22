// Script text that names an option the reader doesn't know must fail with a message, not turn into a step that
// quietly does something else (a Next that became a calculation spun a loop until the runaway guard; a sort with
// an unreadable order sorted nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '../src/index.ts';
import { stepLine } from '../../fmp12/src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-text-'));
createStore(join(dir, 'T.sqlite'));
const store = new Store(join(dir, 'T.sqlite'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
store.applyDesign([{ op: 'createTable', name: 'P', fields: [{ name: 'Name' }, { name: 'X', type: 'number' }] }]);

const parse = (text: string) => parseScriptText(text, store.schema);

test('a step rejects options it cannot carry through script text', () => {
  for (const line of [
    'Write to Data File [ Select ]',
    'Reset Account Password [ With dialog: Off ]',
    'Set Selection [ $ ]',
    'Set Error Capture [ Unknown option: 1 ]',
    'Set Error Logging [ Unknown option: 1 ]',
    'Adjust Window [ Unknown option: 1 ]',
    'Show/Hide Toolbars [ Unknown option: 1 ]',
  ]) assert.throws(() => parse(line), /Line 1: .*(option|target|takes only)/i, line);
});

test('explicit dialog choices survive printing even on fallback steps', async () => {
  const { stepLine } = await import('../../fmp12/src/index.ts');
  for (const line of ['Print PDF [ With dialog: On ]', 'Commit Records/Requests [ With dialog: On ]']) {
    const step = parse(line)[0];
    const printed = stepLine(line.slice(0, line.indexOf(' [ ')), step.params);
    assert.match(printed, /With dialog: On/);
    assert.deepEqual(parse(printed)[0], step);
  }
});

test('find pause, empty Restore and open PDF options survive script text', async () => {
  const { stepLine } = await import('../../fmp12/src/index.ts');
  for (const line of [
    'Enter Find Mode [ Pause: Off ]',
    'Enter Find Mode [ Pause: Off ; Restore ]',
    'Perform Find [ Restore ]',
    'Save Records as PDF [ With dialog: Off ; Currently open PDF ; Current record ; Create folders: Off ]',
  ]) {
    const step = parse(line)[0];
    const printed = stepLine(line.slice(0, line.indexOf(' [ ')), step.params);
    assert.deepEqual(parse(printed)[0], step, line);
  }
  assert.throws(() => parse('Enter Find Mode [ Pause: On ]'), /Enter Find Mode supports only Pause: Off/);
});

test('a literal API key can be authored while its display stays masked', async () => {
  const { stepLine } = await import('../../fmp12/src/index.ts');
  const step = parse('Configure AI Account [ Account Name: "a" ; API key: "k" ]')[0];
  assert.equal(step.params?.ai?.apiKey, '"k"');
  assert.match(stepLine('Configure AI Account', step.params), /API key: "…"/);
});

test('an empty Insert Text parameter prints a stable authored form', async () => {
  const { stepLine } = await import('../../fmp12/src/index.ts');
  const printed = stepLine('Insert Text', {});
  const parsed = parse(printed)[0];
  assert.equal(parsed.params?.text, '');
  assert.equal(stepLine('Insert Text', parsed.params), printed);
});

test('existing Select spellings on Data API and Sort Records by Field print back', async () => {
  const { stepLine, scriptStepName } = await import('../../fmp12/src/index.ts');
  for (const line of [
    'Execute FileMaker Data API [ Select ; Target: $result ; "{}" ]',
    'Sort Records by Field [ Select ; P::Name ; Descending ]',
  ]) {
    const step = parse(line)[0];
    const printed = stepLine(scriptStepName(step.stepId!), step.params);
    assert.match(printed, /\[ Select ;/);
    assert.deepEqual(parse(printed)[0], step);
  }
  assert.match(stepLine('Execute FileMaker Data API', { variable: '$result', calculation: '"{}"' }), /\[ Select ;/);
});

test('legacy text with no Select keeps replacement semantics; explicit Off survives printing', async () => {
  const { stepLine, scriptStepName } = await import('../../fmp12/src/index.ts');
  for (const name of ['Execute FileMaker Data API', 'Insert from URL']) {
    const legacy = `${name} [ ${name === 'Insert from URL' ? '$result' : 'Target: $result'} ; "{}" ]`;
    const step = parse(legacy)[0];
    assert.deepEqual(step.params, { variable: '$result', calculation: '"{}"' }, name);
    const printed = stepLine(scriptStepName(step.stepId!), step.params);
    assert.match(printed, /\[ Select ;/, name);
    assert.deepEqual(parse(printed)[0].params, { ...step.params, selectEntireContents: true }, name);
    const off = parse(`${name} [ Select: Off ; ${name === 'Insert from URL' ? '$result' : 'Target: $result'} ; "{}" ]`)[0];
    assert.equal(off.params?.selectEntireContents, false, name);
    assert.match(stepLine(name, off.params), /Select: Off/);
    assert.deepEqual(parse(stepLine(name, off.params))[0].params, off.params);
  }
});

test('Claris Select steps accept the option and preserve it through printing', async () => {
  const { stepLine } = await import('../../fmp12/src/index.ts');
  for (const line of [
    'Insert from URL [ Select ; $result ; "https://example.com" ]',
    'Check Selection [ Select ; P::Name ]',
  ]) {
    const step = parse(line)[0];
    assert.equal(step.params?.selectEntireContents, true, line);
    assert.deepEqual(parse(stepLine(line.slice(0, line.indexOf(' [ ')), step.params))[0].params, step.params);
  }
});

test('bare Select is a calculation outside an option position', () => {
  assert.equal(parse('If [ Select ]')[0].params?.calculation, 'Select');
  assert.equal(parse('Set Field [ P::Name ; Select ]')[0].params?.calculation, 'Select');
  assert.deepEqual(parse('Execute FileMaker Data API [ Target: $r ; Select ]')[0].params,
    { variable: '$r', calculation: 'Select' });
});

test('"Exit after last" written bare, as FileMaker and the lint messages write it, turns the option on', () => {
  assert.deepEqual(parse('Go to Record/Request/Page [ Next ; Exit after last ]')[0].params, { location: 'next', exitAfterLast: true });
  assert.deepEqual(parse('Go to Record/Request/Page [ Next ; Exit after last: On ]')[0].params, { location: 'next', exitAfterLast: true });
  assert.deepEqual(parse('Go to Record/Request/Page [ Previous ; Exit after last: Off ]')[0].params, { location: 'previous', exitAfterLast: false });
  assert.deepEqual(parse('Go to Portal Row [ Next ; Exit after last ]')[0].params, { location: 'next', exitAfterLast: true });
});

test('a misspelt record location is an error, a calculation is still a calculation', () => {
  assert.throws(() => parse('Go to Record/Request/Page [ Nxt ]'), /Line 1: "Nxt" should be First, Last, Previous, Next/);
  assert.deepEqual(parse('Go to Record/Request/Page [ $n ]')[0].params, { location: 'calculation', calculation: '$n' });
  assert.deepEqual(parse('Go to Record/Request/Page [ 3 ; With dialog: Off ]')[0].params, { location: 'calculation', calculation: '3', noDialog: true });
});

test('Sort Records with an order the reader does not know is an error instead of a sort of nothing', () => {
  assert.throws(() => parse('Sort Records [ Specified Sort Order: P::Name ; ascending ; With dialog: Off ]'), /Sort Records reads "Restore; Table::Field/);
  assert.deepEqual(parse('Sort Records [ With dialog: Off ]')[0].params, { noDialog: true });
  assert.deepEqual(parse('Sort Records')[0].params, undefined);
  const sorted = parse('Sort Records [ Restore; P::Name; descending; With dialog: Off ]')[0].params;
  assert.equal(sorted?.restore, true);
  assert.equal(sorted?.sort?.[0].order, 'descending');
});

test('Select on Data API and Insert from URL is Select, Select: On or Select: Off at the front, and nowhere else', async () => {
  const { stepLine, scriptStepName } = await import('../../fmp12/src/index.ts');
  for (const [line, selected] of [
    ['Execute FileMaker Data API [ Select: On ; Target: $r ; "{}" ]', true],
    ['Execute FileMaker Data API [ Select: Off ; Target: $r ; "{}" ]', false],
    ['Insert from URL [ Select: On ; $r ; "https://example.com" ]', true],
    ['Insert from URL [ Select: Off ; $r ; "https://example.com" ]', false],
  ] as const) {
    const step = parse(line)[0];
    assert.equal(step.params?.selectEntireContents, selected, line);
    assert.equal(step.params?.calculation?.includes('Select'), false, `${line}: Select is not part of the calculation`);
    const printed = stepLine(scriptStepName(step.stepId!), step.params);
    assert.deepEqual(parse(printed)[0], step, printed);
  }
  assert.throws(() => parse('Execute FileMaker Data API [ Target: $r ; Select: Off ]'), /Select must come first/);
});

test('Check Selection refuses parts it does not read; Insert Calculated Result without Select prints so it reads back', async () => {
  const { stepLine, scriptStepName } = await import('../../fmp12/src/index.ts');
  assert.throws(() => parse('Check Selection [ P::Name ; Bogus: 1 ]'), /Check Selection takes only/);
  const step = parse('Insert Calculated Result [ ; ]')[0];
  assert.equal(step.params?.selectEntireContents, false);
  const printed = stepLine(scriptStepName(step.stepId!), step.params);
  assert.equal(parse(printed)[0].params?.selectEntireContents, false, printed);
});

test('Sort Records by Field keeps an explicit Ascending when no field is named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sort-order-'));
  const path = join(dir, 'a.sqlite');
  createStore(path);
  const store = new Store(path, 'a');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Sort', text: 'Sort Records by Field [ Ascending ]' }]);
    const step = store.schema.scripts.find((s) => s.name === 'Sort')!.steps[0];
    assert.equal(step.params?.sortOrder, 'ascending');
    assert.equal(stepLine(step.name, step.params), 'Sort Records by Field [ Ascending ]');
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('Write to Data File writes UTF-16 or UTF-8 only, so Write as: Bytes is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-write-bytes-'));
  const path = join(dir, 'a.sqlite');
  createStore(path);
  const store = new Store(path, 'a');
  try {
    assert.throws(() => store.applyDesign([{ op: 'createScript', name: 'Write', text: 'Write to Data File [ File ID: $file ; Data source: $data ; Write as: Bytes ]' }]), /writes UTF-16 or UTF-8/);
    store.applyDesign([{ op: 'createScript', name: 'Write 8', text: 'Write to Data File [ File ID: $file ; Data source: $data ; Write as: UTF-8 ]' }]);
    assert.equal(store.schema.scripts.find((s) => s.name === 'Write 8')!.steps[0].params?.encoding, 'utf-8');
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('Generate Response from Model reads Prompt as the user prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-model-prompt-'));
  const path = join(dir, 'a.sqlite');
  createStore(path);
  const store = new Store(path, 'a');
  try {
    store.applyDesign([{ op: 'createScript', name: 'Ask', text: 'Generate Response from Model [ Account Name: "a" ; Model: "m" ; Prompt: "Hello" ; Response: $answer ]' }]);
    const step = store.schema.scripts.find((s) => s.name === 'Ask')!.steps[0];
    assert.equal(step.params?.ai?.input, '"Hello"');
    assert.match(stepLine(step.name, step.params), /User Prompt: "Hello"/);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('Generate Response from Model refuses a line that gives both Prompt and User Prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-model-prompt-both-'));
  const path = join(dir, 'a.sqlite');
  createStore(path);
  const store = new Store(path, 'a');
  try {
    assert.throws(() => store.applyDesign([{ op: 'createScript', name: 'Ask', text: 'Generate Response from Model [ Account Name: "a" ; Model: "m" ; Prompt: "one" ; User Prompt: "two" ; Response: $answer ]' }]), /both Prompt and User Prompt/);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

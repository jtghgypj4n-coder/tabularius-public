// Script test cases: saved with the file by script id, run offline on a trial (changes thrown away), compared
// with what they expect; a run can be recorded as a case; AI steps get the case's answers, not a model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore, Store } from '@tabularius/store';
import { compareScriptDraft, dryRunScript, recordScriptTest, runScriptTests } from '../src/index.ts';

let dir: string;
let store: Store;
let total: number;
let ask: number;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-script-tests-'));
  createStore(join(dir, 'T.sqlite'));
  store = new Store(join(dir, 'T.sqlite'), 'T');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'id', type: 'number' }, { name: 'Amount', type: 'number' }, { name: 'Status', type: 'text' }, { name: 'gRate', type: 'number', options: { global: true } }] },
  ]);
  for (const [i, a] of [10, 20, 30].entries()) store.create('Orders', { id: String(i + 1), Amount: String(a), Status: 'open' });
  store.applyDesign([
    { op: 'createScript', name: 'Total', text: [
      'Set Variable [ $sum ; Value: 0 ]',
      'Go to Record/Request/Page [ First ]',
      'Loop',
      '  Set Variable [ $sum ; Value: $sum + Orders::Amount * Orders::gRate ]',
      '  Set Field [ Orders::Status ; "counted" ]',
      '  Go to Record/Request/Page [ Next ; Exit after last: On ]',
      'End Loop',
      'Set Variable [ $$last ; Value: $sum & Get ( ScriptParameter ) ]',
      'Exit Script [ Text Result: $sum ]',
    ].join('\n') },
    { op: 'createScript', name: 'Ask', text: [
      'Configure AI Account [ Account Name: "a" ; API key: "k" ]',
    ].join('\n') },
  ]);
  total = store.schema.scripts.find((s) => s.name === 'Total')!.id;
  ask = store.schema.scripts.find((s) => s.name === 'Ask')!.id;
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

test('a case is kept with the file, by script id, and checked when saved', () => {
  const saved = store.saveScriptTest({ script: total, name: 'sums the found set', given: { globals: { 'Orders::gRate': '2' } }, expect: { result: '120' } });
  assert.ok(saved.id);
  assert.deepEqual(store.scriptTests(total).map((t) => t.name), ['sums the found set']);
  assert.throws(() => store.saveScriptTest({ script: 424242, name: 'x', expect: { result: '1' } }), /script of this file/);
  assert.throws(() => store.saveScriptTest({ script: total, name: 'x', expect: {} }), /expected result/);
  // Saving with the same id replaces it.
  store.saveScriptTest({ ...saved, name: 'sums the found set at rate 2' });
  assert.equal(store.scriptTests(total).length, 1);
  assert.ok(store.deleteScriptTest(saved.id));
  assert.equal(store.scriptTests().length, 0);
});

test('cases pass or fail on result, found count, variables and fields, and leave the data as it was', async () => {
  const pass = store.saveScriptTest({
    script: total, name: 'rate 2, open orders over 15',
    given: { find: [{ Amount: '>15' }], globals: { 'Orders::gRate': '2', $$last: 'x' }, parameter: 'p' },
    expect: { result: '100', error: 0, foundCount: 2, variables: { $$last: '100p' }, fields: { 'Orders::Status': 'counted' } },
  });
  const fail = store.saveScriptTest({ script: total, name: 'wrong on purpose', given: { globals: { 'Orders::gRate': '1' } }, expect: { result: '61', foundCount: 3 } });
  const [a, b] = await runScriptTests(store, [pass, fail]);
  assert.equal(a.passed, true, JSON.stringify(a));
  assert.equal(b.passed, false);
  assert.deepEqual(b.failures, [{ what: 'result', expected: '61', actual: '60' }]);
  // Each case ran on a trial: nothing it changed is kept.
  assert.deepEqual(store.query('SELECT DISTINCT Status FROM Orders').map((r) => (r as { Status: string }).Status), ['open']);
  store.deleteScriptTest(pass.id);
  store.deleteScriptTest(fail.id);
});

test('a run can be recorded as a case\'s expectations', async () => {
  const ended = await recordScriptTest(store, total, { globals: { 'Orders::gRate': '3', $$last: '' } });
  assert.equal(ended.result, '180');
  assert.equal(ended.foundCount, 3);
  assert.deepEqual(ended.variables, { $$last: '180' });
});

test('AI steps get the case\'s answers, never a model', async () => {
  store.applyDesign([{ op: 'updateScript', script: ask, steps: [
    { stepId: 212, name: 'Configure AI Account', enabled: true, params: { ai: { accountName: '"a"', apiKey: '"k"' } } },
    { stepId: 220, name: 'Generate Response from Model', enabled: true, params: { ai: { accountName: '"a"', model: '"m"', input: '"hi"' }, variable: '$r' } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: '$r' } },
  ] as never }]);
  const t = store.saveScriptTest({ script: ask, name: 'answers', given: { ai: ['Hello there'] }, expect: { result: 'Hello there', error: 0 } });
  const none = store.saveScriptTest({ script: ask, name: 'no answers given', expect: { error: 3 } });
  const [a, b] = await runScriptTests(store, [t, none]);
  assert.equal(a.passed, true, JSON.stringify(a));
  assert.equal(b.passed, true, JSON.stringify(b));
  assert.match(b.message ?? '', /run offline/);
});

test('a case whose layout is gone fails on its own; the other cases still run', async () => {
  const stale = { id: 'stale', script: total, name: 'stale layout', given: { layout: 'No such layout' }, expect: { error: 0 } };
  const fine = { id: 'fine', script: total, name: 'fine', given: { globals: { 'Orders::gRate': '1' } }, expect: { result: '60' } };
  const [a, b] = await runScriptTests(store, [stale, fine]);
  assert.equal(a.passed, false);
  assert.match(a.message ?? '', /found set/);
  assert.equal(b.passed, true, JSON.stringify(b));
});

test('draft comparison compares complete long field values', async () => {
  const { compareScriptDraft } = await import('../src/index.ts');
  const original = `${'a'.repeat(2000)}X`;
  const changed = `${'a'.repeat(2000)}Y`;
  store.applyDesign([{ op: 'createTable', name: 'LongValues', fields: [{ name: 'Value', type: 'text' }] }]);
  store.create('LongValues', { Value: '' });
  store.applyDesign([
    { op: 'createScript', name: 'Long value', text: `Set Field [ LongValues::Value ; "${original}" ]` },
  ]);
  const script = store.schema.scripts.find((s) => s.name === 'Long value')!;
  const comparison = await compareScriptDraft(store, script.id, `Set Field [ LongValues::Value ; "${changed}" ]`, [{ name: 'long tail', given: { layout: 'LongValues' } }], []);
  assert.equal(comparison.cases[0].same, false);
  assert.equal(comparison.equal, false);
  assert.equal(comparison.cases[0].differences.some((d) => d.what === 'records changed'), true);
});

test('dry run keeps identical table and record ids separate by file', async () => {
  const path = join(dir, 'Other.sqlite');
  createStore(path);
  const other = new Store(path, 'Other');
  try {
    other.applyDesign([
      { op: 'createTable', name: 'Settings', fields: [{ name: 'Value', type: 'text' }] },
      { op: 'createScript', name: 'Erase', text: 'Delete Record/Request [ With dialog: Off ]' },
    ]);
    other.create('Settings', { Value: 'old' });
    store.applyDesign([
      { op: 'createTable', name: 'Settings', fields: [{ name: 'Value', type: 'text' }] },
      { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
      { op: 'createScript', name: 'Across files', text: 'New Record/Request\nSet Field [ Settings::Value ; "new" ]\nPerform Script [ Specified: By name ; "Other::Erase" ]' },
      { op: 'createScript', name: 'Only here', text: 'New Record/Request\nSet Field [ Settings::Value ; "new" ]' },
    ]);
    store.resolveFile = (name) => name === 'Other' ? other : undefined;
    const script = store.schema.scripts.find((s) => s.name === 'Across files')!;
    const result = await dryRunScript(store, script.id, { layout: 'Settings' }, { others: [other] });
    assert.deepEqual(result.changes.records.map(({ file, table, recordId, kind }) => ({ file, table, recordId, kind })), [
      { file: store.name, table: 'Settings', recordId: 1, kind: 'create' },
      { file: other.name, table: 'Settings', recordId: 1, kind: 'delete' },
    ]);
    const only = store.schema.scripts.find((s) => s.name === 'Only here')!;
    const single = await dryRunScript(store, only.id, { layout: 'Settings' });
    assert.equal('file' in single.changes.records[0], false);
  } finally {
    store.resolveFile = () => undefined;
    other.close();
  }
});

test('draft comparison distinguishes identical changes in different files', async () => {
  const open = (name: string) => {
    const path = join(dir, `${name}.sqlite`);
    createStore(path);
    return new Store(path, name);
  };
  const left = open('Left');
  const right = open('Right');
  try {
    for (const file of [left, right]) {
      file.applyDesign([
        { op: 'createTable', name: 'Settings', fields: [{ name: 'Value', type: 'text' }] },
        { op: 'createScript', name: 'Touch', text: 'Set Field [ Settings::Value ; "new" ]' },
      ]);
      file.create('Settings', { Value: 'old' });
    }
    store.applyDesign([
      { op: 'createTable', name: 'MainCase', fields: [{ name: 'Value', type: 'text' }] },
      { op: 'createDataSource', name: 'Left', paths: ['file:Left'] },
      { op: 'createDataSource', name: 'Right', paths: ['file:Right'] },
      { op: 'createScript', name: 'Which file', text: 'Perform Script [ Specified: By name ; "Left::Touch" ]' },
    ]);
    store.resolveFile = (name) => name === 'Left' ? left : name === 'Right' ? right : undefined;
    const script = store.schema.scripts.find((s) => s.name === 'Which file')!;
    const compared = await compareScriptDraft(store, script.id, 'Perform Script [ Specified: By name ; "Right::Touch" ]',
      [{ name: 'same change, another file', given: { layout: 'MainCase' } }], [], { others: [left, right] });
    assert.equal(compared.cases[0].same, false);
    assert.equal(compared.cases[0].differences.some((d) => d.what === 'records changed'), true, JSON.stringify(compared.cases[0]));
  } finally {
    store.resolveFile = () => undefined;
    left.close();
    right.close();
  }
});

test('a resource-limited script test fails with an explanation while intentional Halt Script can pass', async () => {
  const childPath = join(import.meta.dirname, 'script-tests-termination-child.mjs');
  const marker = join(dir, 'unexpected-command');
  const bin = join(dir, 'stub-bin');
  mkdirSync(bin, { recursive: true });
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, command), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$TABULARIUS_TEST_CHILD_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  const child = spawnSync(process.execPath, [childPath], {
    encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, PATH: bin, TABULARIUS_TEST_CHILD_MARKER: marker },
  });
  assert.equal(existsSync(marker), false, 'the child ran an external command');
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const { limited, canceled } = JSON.parse(child.stdout);
  assert.equal(limited.passed, false, JSON.stringify(limited));
  assert.match(limited.message ?? '', /step limit/i);
  assert.equal(canceled.passed, false, JSON.stringify(canceled));
  assert.match(canceled.message ?? '', /canceled|cancelled/i);

  store.applyDesign([{ op: 'createScript', name: 'Intentional halt', text: 'Halt Script' }]);
  const haltScript = store.schema.scripts.find((s) => s.name === 'Intentional halt')!;
  const halted = await runScriptTests(store, [{ id: 'halt', script: haltScript.id, name: 'intentional halt', given: {}, expect: { error: 0 } }]);
  assert.equal(halted[0].passed, true, JSON.stringify(halted[0]));
});

test('a case is kept small: long text, long lists and odd find requests are refused', () => {
  const kept = store.scriptTests().length;
  const big = 'x'.repeat(20_001);
  assert.throws(() => store.saveScriptTest({ script: total, name: 'n', given: { parameter: big }, expect: { error: 0 } }), /longer than/);
  assert.throws(() => store.saveScriptTest({ script: total, name: 'n', given: { ai: Array(51).fill('a') }, expect: { error: 0 } }), /at most 50/);
  assert.throws(() => store.saveScriptTest({ script: total, name: 'n', given: { find: [{ Amount: { deep: [1] } }] }, expect: { error: 0 } }), /find requests/);
  assert.throws(() => store.saveScriptTest({ script: total, name: 'n', expect: { variables: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`$$v${i}`, '1'])) } }), /at most 50/);
  assert.equal(store.scriptTests().length, kept);
});

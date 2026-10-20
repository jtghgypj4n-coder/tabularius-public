import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { importFmp12, Store } from '@tabularius/store';
import { ERROR, runScript, ScriptEngine, ScriptError } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  store = new Store(join(dir, 'Charts.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const count = (where: string) => Number(store.query(`SELECT count(*) AS n FROM Congress WHERE ${where}`)[0].n);

// A script built by hand, as the reader would decode it.
const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const If = (c: string) => step(68, 'If', { calculation: c });
const Else = step(69, 'Else');
const EndIf = step(70, 'End If');
const Loop = step(71, 'Loop');
const ExitLoopIf = (c: string) => step(72, 'Exit Loop If', { calculation: c });
const EndLoop = step(73, 'End Loop');
const SetVar = (variable: string, value: string) => step(141, 'Set Variable', { variable, value });
const ExitScript = (c: string) => step(103, 'Exit Script', { calculation: c });
const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'Congress' }, field: { id: 0, name } });

test('Perform Find and Sort Records restore their stored requests', { skip }, async () => {
  const senate = await runScript(store, 'Show Senate', { layout: 'Congress' });
  assert.equal(senate.error, 0);
  assert.equal(senate.foundCount, count(`Chamber = 'Senate'`));

  const house = await runScript(store, 'Show House', { layout: 'Congress', parameter: 'Rank', trace: true });
  assert.equal(house.foundCount, count(`Chamber = 'House'`));
  assert.ok(house.trace!.some((t) => t.line.startsWith('Sort Records') && t.line.includes('Liberal_Rank')));
});

test('control flow, variables, parameter and result', { skip }, async () => {
  const r = await runScript(store, script(
    SetVar('$i', '0'),
    SetVar('$sum', '0'),
    Loop,
    SetVar('$i', '$i + 1'),
    ExitLoopIf('$i > 10'),
    If('Mod ( $i ; 2 ) = 0'),
    SetVar('$sum', '$sum + $i'),
    Else,
    SetVar('$odd', 'List ( $odd ; $i )'),
    EndIf,
    EndLoop,
    ExitScript('$sum & "/" & ValueCount ( $odd ) & "/" & Get ( ScriptParameter )'),
  ), { parameter: 'p' });
  assert.equal(r.result, '30/5/p');
  assert.equal(r.error, 0);
});

test('an OnPanelSwitch script reads the panel showing and the one clicked', { skip }, async () => {
  const r = await runScript(store, script(ExitScript('Get ( TriggerCurrentPanel ) & "|" & Get ( TriggerTargetPanel )')),
    { trigger: { currentPanel: '1;Summary', targetPanel: '2;Details' } });
  assert.equal(r.result, '1;Summary|2;Details');
  const none = await runScript(store, script(ExitScript('Get ( TriggerTargetPanel )')));
  assert.equal(none.result, '');
});

test('a script started in Find mode stays there unless it leaves', { skip }, async () => {
  const r = await runScript(store, script(ExitScript('Get ( WindowMode )')), { layout: 'Congress', mode: 'find' });
  assert.equal(r.result, '1');
  assert.equal(r.mode, 'find');
  const browse = await runScript(store, script(step(55, 'Enter Browse Mode'), ExitScript('Get ( WindowMode )')), { layout: 'Congress', mode: 'find' });
  assert.equal(browse.mode, 'browse');
});

test('a formula too deep for the stack fails its step with 1200, and the script goes on', { skip }, async () => {
  const deep = '('.repeat(200_000) + '1' + ')'.repeat(200_000);
  const r = await runScript(store, script(
    step(86, 'Set Error Capture', { on: true }),
    SetVar('$x', deep),
    ExitScript('Get ( LastError ) & "/" & IsEmpty ( $x )'),
  ));
  assert.equal(r.result, '1200/1');
});

test('the time limit stops a script inside one long step', { skip }, async () => {
  const slow = 'While ( [ i = 0 ; s = "" ] ; i < 49000 ; [ i = i + 1 ; s = Substitute ( s & $y ; "a" ; "b" ) ] ; Length ( s ) )';
  const started = Date.now();
  const r = await runScript(store, script(SetVar('$y', '"aaaaaaaaaa"'), SetVar('$x', slow), ExitScript('"finished"')), { timeoutMs: 50 });
  assert.notEqual(r.result, 'finished');
  assert.ok(r.actions.some((a) => a.step === 'Halt Script' && /during a step/.test(String(a.reason))), JSON.stringify(r.actions));
  assert.ok(Date.now() - started < 5000);
});

test('Set Field, New Record and Commit write to the store; errors set LastError', { skip }, async () => {
  const before = count('1');
  const r = await runScript(store, script(
    step(7, 'New Record/Request'),
    step(76, 'Set Field', { field: field('Name'), calculation: '"Script Test"' }),
    step(76, 'Set Field', { field: field('State'), calculation: 'Upper ( "zz" )' }),
    step(75, 'Commit Records/Requests'),
    step(86, 'Set Error Capture', { on: true }),
    step(6, 'Go to Layout', { layout: { id: 0, name: 'No such layout' }, layoutDestination: 'named' }),
    SetVar('$err', 'Get ( LastError )'),
    ExitScript('$err & "/" & Get ( FoundCount )'),
  ), { layout: 'Congress' });
  assert.equal(r.result, `105/${before + 1}`);
  assert.equal(count(`Name = 'Script Test' AND State = 'ZZ'`), 1);
});

test('summary fields and GetSummary follow the sorted found set', { skip }, async () => {
  const party = field('Party');
  const r = await runScript(store, script(
    step(6, 'Go to Layout', { layout: { id: 0, name: 'Congress' }, layoutDestination: 'named' }),
    step(39, 'Sort Records', { sort: [{ field: party, order: 'ascending' }], noDialog: true }),
    step(16, 'Go to Record/Request/Page', { location: 'last' }),
    ExitScript('Congress::party count & "/" & GetSummary ( Congress::party count ; Congress::Party ) & "/" & Congress::Party & "/" & GetSummary ( Congress::party count ; Congress::party count )'),
  ), { layout: 'Congress' });
  const [total, group, last, again] = r.result.split('/');
  // Count counts records where Party is not empty.
  const parties = count(`Party IS NOT NULL AND Party <> ''`);
  assert.equal(Number(total), parties);
  assert.equal(Number(again), parties);
  assert.equal(Number(group), count(`Party = '${last}'`));
  assert.ok(Number(group) < Number(total));
});

test('dialogs are returned as client actions; unknown scripts fail with 104', { skip }, async () => {
  const r = await runScript(store, script(
    step(87, 'Show Custom Dialog', { title: '"Hello"', message: '"World"', buttons: ['"OK"', '"Cancel"'] }),
    ExitScript('Get ( LastMessageChoice )'),
  ));
  assert.deepEqual(r.actions, [{ step: 'Show Custom Dialog', script: 'test', title: 'Hello', message: 'World', buttons: ['OK', 'Cancel'] }]);
  assert.equal(r.result, '1');
  await assert.rejects(runScript(store, 'Nope'), (e: ScriptError) => e.code === ERROR.scriptMissing);
});

test('Pause/Resume Script asks the pause option; Cancel halts, a duration is skipped; Preview mode is Browse mode with WindowMode 2', { skip }, async () => {
  const states: unknown[] = [];
  const steps = [step(41, 'Enter Preview Mode'), step(62, 'Pause/Resume Script'), step(62, 'Pause/Resume Script', { calculation: '1' }), ExitScript('Get ( WindowMode )')];
  const go = await runScript(store, script(...steps), { layout: 'Congress', pause: async (r) => (states.push(r.state), true) });
  assert.equal(go.result, '2');
  assert.equal(go.preview, true);
  assert.equal(go.mode, 'browse');
  assert.equal(states.length, 1);
  assert.equal((states[0] as { layout: string; preview: boolean }).layout, 'Congress');
  assert.equal((states[0] as { preview: boolean }).preview, true);
  const stop = await runScript(store, script(...steps), { layout: 'Congress', pause: async () => false });
  assert.equal(stop.halted, true);
  assert.equal(stop.result, '');
  // Without someone to answer (the Data API, schedules) the pause is skipped, as on FileMaker Server.
  assert.equal((await runScript(store, script(...steps), { layout: 'Congress' })).result, '2');
  const browse = await runScript(store, script(step(55, 'Enter Browse Mode'), ExitScript('Get ( WindowMode )')), { layout: 'Congress', preview: true });
  assert.equal(browse.result, '0');
  assert.equal(browse.preview, undefined);
});

test('Install Menu Set tells the client which menu set to show', { skip }, async () => {
  const r = await runScript(store, script(step(142, 'Install Menu Set', { menuSet: { id: 3, name: 'Editor' }, fileDefault: true })));
  assert.deepEqual(r.actions, [{ step: 'Install Menu Set', script: 'test', menuSetId: 3, fileDefault: true }]);
});

test('step limit stops runaway loops', { skip }, async () => {
  const r = await new ScriptEngine({ maxSteps: 500 }).run(store, script(Loop, SetVar('$x', '$x + 1'), EndLoop));
  assert.equal(r.halted, true);
});

test('scripts stay offline unless network access is turned on; Send Mail never sends', { skip }, async () => {
  let calls = 0;
  const fakeFetch = (async () => { calls++; return new Response('pong'); }) as typeof fetch;
  const insert = step(160, 'Insert from URL', { variable: '$r', calculation: '"https://example.com/send"' });
  const probe = script(
    step(86, 'Set Error Capture', { on: true }),
    insert,
    SetVar('$e1', 'Get ( LastError )'),
    step(63, 'Send Mail', { slots: { 128: '"someone@example.com"' } }),
    ExitScript('$e1 & "/" & Get ( LastError ) & "/" & $r'),
  );
  // Off by default, even when a fetch function is around.
  const off = await runScript(store, probe);
  assert.equal(off.result, '3/3/');
  assert.equal(calls, 0);
  // On only when asked.
  const on = await runScript(store, probe, { [TEST_ONLY_CUSTOM_FETCH]: true, network: fakeFetch });
  assert.equal(on.result, '0/3/pong');
  assert.equal(calls, 1);
});

test('SERVER_STEPS and SCREEN_STEPS match the engine', async () => {
  const { readFileSync } = await import('node:fs');
  const { SERVER_STEPS, SCREEN_STEPS } = await import('../src/engine.ts');
  const src = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');
  // quickStep runs the steps that never wait; step() runs the rest.
  const body = src.slice(src.indexOf('private quickStep('), src.indexOf('return unsupported();\n  }', src.indexOf('private async step(')));
  const cases = new Set([...body.matchAll(/case (\d+):/g)].map((m) => Number(m[1])));
  assert.deepEqual([...cases].sort((a, b) => a - b), [...SERVER_STEPS].sort((a, b) => a - b), 'update SERVER_STEPS in engine.ts to match step()');
  // The last group of step(): the screen steps (some the person's window does, the rest nothing here).
  const screen = body.slice(body.indexOf('// Steps that only affect a screen'));
  const skipped = new Set([...screen.matchAll(/case (\d+):/g)].map((m) => Number(m[1])));
  assert.deepEqual([...skipped].sort((a, b) => a - b), [...SCREEN_STEPS].sort((a, b) => a - b), 'update SCREEN_STEPS in engine.ts');
});

test('Import Records reads comma- and tab-separated files from the documents folder only', { skip }, async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'people.csv'), '﻿"Import, Test",ZZ,ignored\r\n"Quote ""Q""",YY,x\r\n');
  writeFileSync(join(docs, 'people.tab'), 'Tab Test\tXX\n');
  const congress = store.schema.tables.find((t) => t.name === 'Congress')!;
  const ref = (name: string) => ({ tableOccurrence: { id: 0, name: 'Congress' }, field: { id: congress.fields.find((f) => f.name === name)!.id, name } });
  const mapping = [{ field: ref('Name'), import: true }, { field: ref('State'), import: true }, { field: ref('Party'), import: false }];
  const importStep = (filePaths: string[], importFormat?: string) =>
    step(35, 'Import Records', { noDialog: true, tableOccurrence: { id: 0, name: 'Congress' }, filePaths, importFormat, fieldMapping: mapping });
  const probe = (...steps: ScriptStep[]) => script(step(86, 'Set Error Capture', { on: true }), ...steps,
    ExitScript('Get ( LastError ) & "/" & Get ( FoundCount ) & "/" & Congress::Name & "/" & Congress::State & "/" & Congress::Party'));

  // A Mac path from the developer's computer: only its file name is looked up, in the documents folder.
  const path = 'filemac:/Macintosh HD/Users/someone/stage/people.csv';
  assert.match((await runScript(store, probe(importStep([path], 'COMS')), { layout: 'Congress' })).result, /^100\//);
  const r = await runScript(store, probe(importStep([path], 'COMS')), { layout: 'Congress', documents: docs });
  assert.equal(r.result, '0/2/Import, Test/ZZ/');
  assert.equal(count(`Name = 'Quote "Q"' AND State = 'YY' AND Party IS NULL`), 1);
  // A variable holding the path; tab-separated by its extension.
  const t = await runScript(store, probe(SetVar('$path', '"file:people.tab"'), importStep(['$path'])), { layout: 'Congress', documents: docs });
  assert.equal(t.result, '0/1/Tab Test/XX/');
  // Nothing outside the folder: a path's folders are ignored, and dot names are refused.
  for (const p of ['/etc/passwd', 'file:../Charts.sqlite', '..']) {
    assert.match((await runScript(store, probe(importStep([p], 'COMS')), { layout: 'Congress', documents: docs })).result, /^100\//);
  }
});

test('Import Records from a hosted FileMaker file: the found set it shows, mapped field by field', { skip }, async () => {
  const congress = store.schema.tables.find((t) => t.name === 'Congress')!;
  const to = store.schema.tableOccurrences.find((t) => t.name === 'Congress')!;
  const id = (name: string) => congress.fields.find((f) => f.name === name)!.id;
  const ref = (name: string) => ({ tableOccurrence: { id: to.id, name: 'Congress' }, field: { id: id(name), name } });
  const senators = store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Chamber = 'Senate' ORDER BY _fm_record_id`).map((r) => Number(r.id));
  const before = count('1');
  // Name -> Name, Chamber -> Party, State not imported.
  const r = await runScript(store, script(
    step(35, 'Import Records', {
      noDialog: true, importFormat: 'FMPR', filePaths: ['file:Charts.fmp12'], tableOccurrence: { id: to.id, name: 'Congress' },
      importSource: { tableOccurrenceId: to.id, fieldIds: [id('Name'), id('Chamber'), id('State')] },
      fieldMapping: [{ field: ref('Name'), import: true }, { field: ref('Party'), import: true }, { field: ref('State'), import: false }],
    }),
    ExitScript('Get ( LastError ) & "/" & Get ( FoundCount ) & "/" & Congress::Party & "/" & IsEmpty ( Congress::State )'),
  ), { layout: 'Congress', foundSet: senators });
  assert.equal(r.result, `0/${senators.length}/Senate/1`);
  assert.equal(count('1'), before + senators.length);
  assert.equal(count(`Party = 'Senate' AND State IS NULL`), senators.length);
  // A file that isn't hosted.
  const missing = await runScript(store, script(
    step(86, 'Set Error Capture', { on: true }),
    step(35, 'Import Records', { importFormat: 'FMPR', filePaths: ['file:Elsewhere.fmp12'], importSource: { tableOccurrenceId: to.id, fieldIds: [] } }),
    ExitScript('Get ( LastError )'),
  ), { layout: 'Congress' });
  assert.equal(missing.result, '100');
});

// Runs last: it empties Congress.
test('Truncate Table names a base table, not a table occurrence', { skip }, async () => {
  const congress = store.schema.tables.find((t) => t.name === 'Congress')!;
  const other = store.schema.tableOccurrences.find((t) => t.id === congress.id); // the TO that happens to share the table's id
  const otherRows = other && other.baseTableId !== congress.id ? store.query(`SELECT count(*) AS n FROM ${JSON.stringify(store.schema.tables.find((t) => t.id === other.baseTableId)!.name)}`)[0].n : undefined;
  const r = await runScript(store, script(step(182, 'Truncate Table', { noDialog: true, table: { id: congress.id, name: 'Congress' } }), ExitScript('Get ( LastError )')), { layout: 'Congress' });
  assert.equal(r.result, '0');
  assert.equal(count('1'), 0);
  if (otherRows !== undefined) {
    const t = store.schema.tables.find((x) => x.id === other!.baseTableId)!;
    assert.equal(store.query(`SELECT count(*) AS n FROM ${JSON.stringify(t.name)}`)[0].n, otherRows);
  }
});

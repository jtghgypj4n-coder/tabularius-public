// The per-file plug-in readiness panel: what each plug-in function a file calls will do here (run, give "?", give an MBS
// error text, go to the Outbox), how many scripts, calculations and layout objects use it, and what to use instead.
// The words are checked against what the engine really answers, so the panel cannot promise what the calculation breaks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import type { Host } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { pluginReadiness, pluginReadinessCsv, readinessWords, type PluginReadiness, type Readiness } from '../src/plugin-readiness.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;
let store: Store;
let empty: Store;
let recordId: number;

const BASE_ELEMENTS = 'com.openhbam.baseelements';

/** Where each function is used, so the counts below can be read against it. */
const SCRIPTS: Record<string, string> = {
  'Check version': 'Set Variable [ $v ; Value: BE_Version ]\nSet Variable [ $j ; Value: BE_JSONPath ( "{\\"p\\":1}" ; "$.p" ) ]',
  'Run a command': 'Set Variable [ $r ; Value: BE_ExecuteSystemCommand ( "ls" ) ]\nSet Variable [ $m ; Value: MBS ( "Text.AddLineNumbers" ; "a" ) ]',
  'Mail it': 'Set Variable [ $s ; Value: BE_SMTPSend ( "a@example.com" ; "b@example.com" ; "Hi" ; "Body" ) ]\nSet Variable [ $v ; Value: EmailVersion ( ) ]',
  'Dynamic MBS': 'Set Variable [ $x ; Value: MBS ( $name ; "a" ) ]\nSet Variable [ $t ; Value: MBS ( "Text.Trim" ; " a " ) ]',
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-readiness-'));
  createStore(join(dir, 'Plugs' + STORE_EXT));
  createStore(join(dir, 'Plain' + STORE_EXT));
  createStore(join(dir, 'Counts' + STORE_EXT));
  // A plug-in written for Tabularius whose function has the name of one of BaseElements': turned on for a file it supplies the call.
  mkdirSync(join(dir, 'plugins', 'extra'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'extra', 'plugin.json'), JSON.stringify({ id: 'org.example.extra', name: 'Extra', version: '1.0.0', api: '^1.0', publisher: 'Me', main: 'main.js', functions: [{ name: 'BE_ExtraThing', min: 0, max: 0 }] }));
  writeFileSync(join(dir, 'plugins', 'extra', 'main.js'), 'const functions = { BE_ExtraThing: () => "from the extra plug-in" };');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  store = host.get('Plugs')!;
  empty = host.get('Plain')!;

  store.applyDesign([{ op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'Version', type: 'text' }] }] as DesignOp[]);
  const fieldId = store.schema.tables.find((t) => t.name === 'Contacts')!.fields.find((f) => f.name === 'Name')!.id;
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Contacts')!;
  store.applyDesign([
    { op: 'createField', table: 'Contacts', name: 'Engine', kind: 'calculation', type: 'text', calculation: 'BE_Version' },
    ...Object.entries(SCRIPTS).map(([name, text]) => ({ op: 'createScript', name, text })),
    { op: 'createField', table: 'Contacts', name: 'Cmd', kind: 'calculation', type: 'text', calculation: 'BE_ExecuteSystemCommand ( "ls" )' },
  ] as DesignOp[]);
  const anchors = { left: true, top: true, right: false, bottom: false };
  const objects = [{
    id: 101, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 20, left: 20, bottom: 40, right: 300 },
    field: { tableOccurrenceId: occurrence.id, fieldId, tableOccurrence: 'Contacts', field: 'Name', display: 'edit', repetitions: 1 },
    hide: { formula: 'BE_ExecuteSystemCommand ( "ls" ) = "x"' }, tooltip: 'BE_Version',
  } as unknown as LayoutObject];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  store.create('Contacts', { Name: 'SECRET-PERSON-NAME' });
  recordId = Number((store.find('Contacts', { limit: 1 }).records[0] as { recordId: number | string }).recordId);
});
after(async () => {
  await stopJavaScript();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const find = (r: PluginReadiness, call: string) => {
  const f = r.functions.find((x) => x.call.toLowerCase() === call.toLowerCase());
  assert.ok(f, `${call} is listed: ${r.functions.map((x) => x.call).join(', ')}`);
  return f!;
};

test('each kind of plug-in call is told apart, with the places that use it counted by kind', () => {
  const r = pluginReadiness(store, host.plugins);
  assert.equal(find(r, 'BE_Version').behaviour, 'runs');
  assert.equal(find(r, 'BE_JSONPath').behaviour, 'runs');
  assert.equal(find(r, 'MBS ( "Text.Trim" )').behaviour, 'runs');
  assert.equal(find(r, 'BE_ExecuteSystemCommand').behaviour, 'refused');
  assert.equal(find(r, 'BE_SMTPSend').behaviour, 'outbox');
  assert.equal(find(r, 'EmailVersion').behaviour, 'unavailable');
  assert.equal(find(r, 'MBS ( "Text.AddLineNumbers" )').behaviour, 'mbs-error');
  assert.equal(find(r, 'MBS ( "?" )').behaviour, 'cannot-tell');
  // Counted by the kind of place: one script, one field calculation and one layout object each use the shell command.
  const shell = find(r, 'BE_ExecuteSystemCommand');
  assert.deepEqual([shell.scripts, shell.calculations, shell.layouts, shell.other], [1, 1, 1, 0]);
  const version = find(r, 'BE_Version');
  assert.deepEqual([version.scripts, version.calculations, version.layouts], [1, 1, 1]);
  assert.equal(find(r, 'BE_SMTPSend').scripts, 1);
  // Every one has words, a replacement and a guide to read.
  for (const f of r.functions) {
    assert.ok(f.what.length > 20 && f.instead.length > 10, f.call);
    assert.match(f.guide, /^\/docs\/moving-a-solution#plug-ins-are-not-loaded$/);
  }
  assert.match(find(r, 'BE_ExecuteSystemCommand').instead, /No native step runs a shell command/);
  assert.match(find(r, 'BE_SMTPSend').instead, /Send Mail/);
  // Worst first: what is refused, then what gives ?, then the ones that run last.
  assert.equal(r.functions[0]!.behaviour, 'refused');
  assert.equal(r.functions.at(-1)!.behaviour, 'runs');
});

test('the count and the checklist line say how many functions will not run, and are not confused by the ones that do', () => {
  const r = pluginReadiness(store, host.plugins);
  // Not running: the shell command, the SMTP send (Outbox only in test mode), EmailVersion, the unavailable MBS name.
  assert.equal(r.willNotRun, 4);
  assert.equal(r.running, 3);
  assert.equal(r.cannotTell, 1);
  assert.equal(r.line, '4 plug-in functions will not run, 1 plug-in call could not be checked');
  assert.equal(r.summary, '');
  assert.equal(r.database, 'Plugs');
  assert.deepEqual(r.guides.map((g) => g.href), ['/docs/moving-a-solution#plug-ins-are-not-loaded', '/docs/plugin-compatibility']);
});

test('what the panel says matches what the calculation really answers', () => {
  const answer = (formula: string) => store.evaluate('Contacts', formula, recordId).value;
  const r = pluginReadiness(store, host.plugins);
  for (const [formula, call] of [
    ['BE_Version', 'BE_Version'],
    ['BE_JSONPath ( "{\\"p\\":1}" ; "$.p" )', 'BE_JSONPath'],
    ['MBS ( "Text.Trim" ; " a " )', 'MBS ( "Text.Trim" )'],
    ['BE_ExecuteSystemCommand ( "ls" )', 'BE_ExecuteSystemCommand'],
    ['BE_SMTPSend ( "a@example.com" ; "b@example.com" ; "Hi" ; "Body" )', 'BE_SMTPSend'],
    ['EmailVersion ( )', 'EmailVersion'],
    ['MBS ( "Text.AddLineNumbers" ; "a" )', 'MBS ( "Text.AddLineNumbers" )'],
  ] as const) {
    const f = find(r, call);
    const got = String(answer(formula));
    if (f.behaviour === 'runs') assert.ok(got !== '?' && !got.startsWith('[MBS] ERROR'), `${formula} runs but gave ${got}`);
    else if (f.behaviour === 'mbs-error') assert.match(got, /^\[MBS\] ERROR: .* is not available in Tabularius$/, formula);
    else assert.equal(got, '?', `${formula}: ${f.behaviour}`);
  }
});

test('a name nothing knows is an error, not a question mark', () => {
  // Typed by hand (a converted file names plug-in calls it cannot decode as markers instead), so the panel says what really happens.
  assert.throws(() => store.evaluate('Contacts', 'EmailSend ( "" )', recordId), /The function "EmailSend" cannot be found/);
  store.applyDesign([{ op: 'createScript', name: 'Typed by hand', text: 'Set Variable [ $s ; Value: EmailSend ( "" ) ]' }] as DesignOp[]);
  const f = find(pluginReadiness(store, host.plugins), 'EmailSend');
  assert.equal(f.behaviour, 'unrecognised');
  assert.match(f.what, /cannot be found/);
  assert.equal(f.runs, false);
});

test('a built-in pack turned off for the file, and a plug-in turned on for it, change what is said', () => {
  host.plugins.setBuiltin('Plugs', BASE_ELEMENTS, false);
  try {
    const r = pluginReadiness(store, host.plugins);
    assert.equal(find(r, 'BE_Version').behaviour, 'off');
    assert.match(find(r, 'BE_Version').what, /turned off for this file/);
    assert.equal(find(r, 'MBS ( "Text.Trim" )').behaviour, 'runs', 'only the pack that was turned off');
    assert.equal(store.evaluate('Contacts', 'BE_Version', recordId).value, '?', 'and the engine agrees');
    assert.ok(r.willNotRun > 4);
  } finally {
    host.plugins.setBuiltin('Plugs', BASE_ELEMENTS, true);
  }
  store.applyDesign([{ op: 'createScript', name: 'Extra', text: 'Set Variable [ $e ; Value: BE_ExtraThing ( ) ]' }] as DesignOp[]);
  assert.equal(find(pluginReadiness(store, host.plugins), 'BE_ExtraThing').behaviour, 'unavailable', 'installed but not turned on for the file');
  host.plugins.enable('Plugs', 'org.example.extra');
  const f = find(pluginReadiness(store, host.plugins), 'BE_ExtraThing');
  assert.equal(f.behaviour, 'runs');
  assert.match(f.what, /through the Extra plug-in/);
  host.plugins.disable('Plugs', 'org.example.extra');
});

test('a file that calls no plug-in has an empty list and says so', () => {
  const r = pluginReadiness(empty, host.plugins);
  assert.deepEqual(r.functions, []);
  assert.equal(r.line, '');
  assert.equal(r.willNotRun, 0);
  assert.match(r.summary, /calls no plug-in functions that Tabularius knows, so there is nothing to move/);
  assert.equal(pluginReadinessCsv(r), 'plugIn,function,whatHappens,whatItDoes,scripts,calculations,layoutObjects,otherPlaces,useInstead\r\n');
});

test('the CSV has names and counts only: no record data, no script, layout or field names', () => {
  const csv = pluginReadinessCsv(pluginReadiness(store, host.plugins));
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'plugIn,function,whatHappens,whatItDoes,scripts,calculations,layoutObjects,otherPlaces,useInstead');
  assert.ok(lines.length > 8);
  assert.match(csv, /BaseElements,BE_ExecuteSystemCommand,refused,/);
  for (const secret of ['SECRET-PERSON-NAME', 'Check version', 'Run a command', 'Mail it', 'Contacts', 'Engine']) assert.ok(!csv.includes(secret), `${secret} is not in the CSV`);
  // Spreadsheet formulas in a function name are neutralised like every other export.
  const hostile = pluginReadinessCsv({ ...pluginReadiness(store, host.plugins), functions: [{ ...pluginReadiness(store, host.plugins).functions[0]!, call: '=HYPERLINK("http://example.com")' }] });
  assert.match(hostile, /'=HYPERLINK/);
});

test('the console route returns the list as JSON or as a CSV download, and names a missing file', async () => {
  const json = await fetch(`${base}/tabularius/admin/v1/plugin-readiness?database=plugs`);
  assert.equal(json.status, 200);
  const body = (await json.json()) as PluginReadiness;
  assert.equal(body.database, 'Plugs');
  assert.equal(body.line, pluginReadiness(store, host.plugins).line);
  assert.match(body.line, /^\d+ plug-in functions will not run, 1 plug-in call could not be checked$/);
  const csv = await fetch(`${base}/tabularius/admin/v1/plugin-readiness?database=Plugs&format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(csv.headers.get('content-disposition') ?? '', /^attachment; filename="plug-ins-Plugs\.csv"$/);
  assert.match(await csv.text(), /^plugIn,function,/);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/plugin-readiness?database=Nope`)).status, 400);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/plugin-readiness`)).status, 400);
  assert.equal((await fetch(`${base}/tabularius/admin/v1/plugin-readiness?database=Plugs`, { method: 'POST' })).status, 405);
});

test('only the admin sees it: no password, a wrong one, or an account of the file itself gets nothing', async () => {
  const locked = mkdtempSync(join(tmpdir(), 'tabularius-readiness-locked-'));
  createStore(join(locked, 'Plugs' + STORE_EXT));
  setAdminPassword(locked, 'admin secret');
  const s = await serve({ dir: locked, port: 0, watch: false, log: () => {} });
  try {
    const st = s.host.get('Plugs')!;
    st.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }, { op: 'createScript', name: 'S', text: 'Set Variable [ $v ; Value: BE_Version ]' }] as DesignOp[]);
    st.setPassword('Admin', 'pw', '[Full Access]');
    const url = `${s.url}/tabularius/admin/v1/plugin-readiness?database=Plugs`;
    for (const format of ['', '&format=csv']) {
      assert.equal((await fetch(url + format)).status, 401, 'no password');
      assert.equal((await fetch(url + format, { headers: { authorization: 'Basic ' + btoa('admin:wrong') } })).status, 401, 'wrong password');
    }
    // A Full Access account of the file is not the server's administrator, and its token opens none of the console.
    const login = await fetch(`${s.url}/fmi/data/vLatest/databases/Plugs/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}' });
    const token = ((await login.json()) as { response: { token: string } }).response.token;
    assert.equal((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status, 401, 'a hosted account is not the administrator');
    const ok = await fetch(url, { headers: { authorization: 'Basic ' + btoa('admin:admin secret') } });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as PluginReadiness).functions.length, 1);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(locked, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('a place is counted once however often it calls the function, and a computed MBS name is found beside literal ones', () => {
  const counts = host.get('Counts')!;
  counts.applyDesign([
    { op: 'createScript', name: 'Three steps', text: Array(3).fill('Set Variable [ $r ; Value: BE_ExecuteSystemCommand ( "ls" ) ]').join('\n') },
    { op: 'createScript', name: 'Twice in a step', text: 'Set Variable [ $a ; Value: MBS ( "Text.Trim" ; " a " ) & MBS ( "Text.Trim" ; " b " ) ]' },
    { op: 'createScript', name: 'Another', text: 'Set Variable [ $a ; Value: MBS ( "Text.Trim" ; " c " ) ]' },
    { op: 'createScript', name: 'Mixed', text: 'Set Variable [ $a ; Value: MBS ( "Text.Trim" ; " d " ) & MBS ( $fn ; "x" ) ]' },
    { op: 'createScript', name: 'Built name', text: 'Set Variable [ $a ; Value: MBS ( "JSON." & $fn ; "x" ) ]' },
  ] as DesignOp[]);
  const r = pluginReadiness(counts, host.plugins);
  assert.equal(find(r, 'BE_ExecuteSystemCommand').scripts, 1, 'three steps of one script');
  assert.equal(find(r, 'MBS ( "Text.Trim" )').scripts, 3, 'three scripts, one of them twice in a step');
  assert.equal(find(r, 'MBS ( "?" )').scripts, 2, 'the computed name beside a literal one, and a name that is only partly quoted');
  assert.equal(r.cannotTell, 1);
  assert.equal(r.functions.some((f) => f.behaviour === 'mbs-error'), false, 'a partly quoted name is not called an MBS error');
  assert.notEqual(r.summary, `All ${r.running} plug-in functions this file calls run here.`);
  assert.doesNotMatch(readinessText(), /IsError/);
});

/** Every sentence the panel can say. */
const readinessText = () => (['runs', 'outbox', 'refused', 'unavailable', 'unrecognised', 'mbs-error', 'cannot-tell', 'off'] as Readiness[]).map(readinessWords).join('\n');

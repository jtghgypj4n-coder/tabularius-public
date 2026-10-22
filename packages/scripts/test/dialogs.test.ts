// Steps that wait on a person (Show Custom Dialog's buttons and input fields,
// Re-Login's dialog, Pause/Resume Script) and Replace Field Contents' choices.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type DialogRequest, type RunOptions } from '../src/index.ts';
import { xlsx } from '../src/xlsx.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-dialogs-'));
  createStore(join(dir, 'D.sqlite'));
  store = new Store(join(dir, 'D.sqlite'), 'D');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [
    { name: 'Name', type: 'text' }, { name: 'Age', type: 'number' },
    { name: 'Code', type: 'text', options: { autoEnter: { serial: { next: 'P-007', increment: 1 } } } },
  ] }]);
  store.create('People', { Name: 'Ada', Age: '36' });
  store.create('People', { Name: 'Bob', Age: '20' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const steps = (text: string) => parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
  .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
const run = (text: string, opts: RunOptions = {}) =>
  runScript(store, { id: 9999, name: 'test', steps: steps(text) } as Script, { layout: 'People', foundSet: store.findIds('People'), ...opts });

const DIALOG = `Show Custom Dialog [ "Sign in" ; "Who are you, " & People::Name & "?" ; Button 1: "OK" ; Button 2: "Cancel" ; Input 1: $account ; Label 1: "Account" ; Input 2: People::Name ; Label 2: "Name" ; Input 3: $password ; Label 3: "Password" ]`;

test('Show Custom Dialog shows the evaluated dialog and stores the inputs for the first button', async () => {
  let asked: DialogRequest | undefined;
  const r = await run(`
    Set Variable [ $account ; Value: "guest" ]
    ${DIALOG}
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: Get ( LastMessageChoice ) & "/" & $account & "/" & $password ]`, {
    dialog: async (req) => {
      asked = req;
      return { button: 1, inputs: ['ada', 'Ada L', 's3cret'] };
    },
  });
  assert.equal(r.error, 0);
  assert.equal(asked?.title, 'Sign in');
  assert.equal(asked?.message, 'Who are you, Ada?');
  assert.deepEqual(asked?.buttons, ['OK', 'Cancel']);
  assert.deepEqual(asked?.inputs, [
    { label: 'Account', value: 'guest', password: false },
    { label: 'Name', value: 'Ada', password: false },
    { label: 'Password', value: '', password: true },
  ]);
  assert.equal(asked?.state.layout, 'People');
  assert.equal(r.result, '1/ada/s3cret');
  assert.equal(store.query('SELECT Name FROM People ORDER BY _fm_record_id')[0].Name, 'Ada L');
  store.update('People', store.findIds('People')[0], { Name: 'Ada' });
});

test('the second button stores nothing; closing the dialog counts as the last button', async () => {
  const script = `
    Set Variable [ $account ; Value: "guest" ]
    ${DIALOG}
    Exit Script [ Text Result: Get ( LastMessageChoice ) & "/" & $account ]`;
  const cancel = await run(script, { dialog: async () => ({ button: 2, inputs: ['x', 'y', 'z'] }) });
  assert.equal(cancel.result, '2/guest');
  const closed = await run(script, { dialog: async () => undefined });
  assert.equal(closed.result, '2/guest');
  assert.equal(store.query('SELECT Name FROM People ORDER BY _fm_record_id')[0].Name, 'Ada');
});

test('Commit options change which buttons store the inputs', async () => {
  const r = await run(`
    Show Custom Dialog [ "T" ; "M" ; Button 1: "Skip" ; Button 2: "Save" ; Input 1: $x ; Commit 1: Off ; Commit 2: On ]
    Exit Script [ Text Result: Get ( LastMessageChoice ) & "/" & $x ]`, { dialog: async () => ({ button: 2, inputs: ['kept'] }) });
  assert.equal(r.result, '2/kept');
});

test('with nobody to answer, no button is pressed: error 3, the choice is left as it was, the next step runs', async () => {
  const r = await run(`
    Set Variable [ $account ; Value: "guest" ]
    Set Error Capture [ On ]
    ${DIALOG}
    Set Variable [ $error ; Value: Get ( LastError ) ]
    Exit Script [ Text Result: $error & "/" & Get ( LastMessageChoice ) & "/" & $account ]`);
  assert.equal(r.result, '3/0/guest');
  assert.deepEqual(r.actions.filter((a) => a.step === 'Show Custom Dialog'), []);
  assert.equal(store.query('SELECT Name FROM People ORDER BY _fm_record_id')[0].Name, 'Ada');
  assert.deepEqual((r.warnings ?? []).filter((w) => w.startsWith('Show Custom Dialog')).length, 1);
});

test('a trial run (previewDialogs) records the dialog it would show and takes the first button', async () => {
  const r = await run(`
    ${DIALOG}
    Exit Script [ Text Result: Get ( LastMessageChoice ) & "/" & $account ]`, { previewDialogs: true });
  assert.equal(r.result, '1/');
  assert.equal(r.error, 0);
  assert.deepEqual(r.actions[0], { step: 'Show Custom Dialog', script: 'test', title: 'Sign in', message: 'Who are you, Ada?', buttons: ['OK', 'Cancel'] });
});

test('a headless Show Custom Dialog is error 3 at that step, and the trace says why', async () => {
  const r = await run(`
    Show Custom Dialog [ "Delete everything?" ; "This cannot be undone." ; Button 1: "Delete" ; Button 2: "Cancel" ]
    Exit Script [ Text Result: "reached" ]`, { trace: true });
  assert.equal(r.error, 3);
  assert.equal(r.result, 'reached');
  assert.match(r.trace?.[0].message ?? '', /not supported in scripts run without a person.*nothing was shown/);
});

test('Show Custom Dialog buttons and inputs survive the script text', () => {
  const [s] = steps(DIALOG.replace('Input 3', 'Commit 3: Off ; Password 1 ; Input 3'));
  assert.deepEqual(s.params?.buttons, ['"OK"', '"Cancel"']);
  assert.equal(s.params?.inputs?.length, 3);
  assert.equal(s.params?.inputs?.[0].password, true);
  assert.deepEqual(s.params?.commit, [true, false, false]);
  const line = stepLine('Show Custom Dialog', s.params);
  assert.deepEqual(steps(line)[0].params, s.params);
});

const column = (name: string) => store.query(`SELECT ${name} FROM People ORDER BY _fm_record_id`).map((r) => String(r[name]));

test('Replace Field Contents: the current contents, custom serial numbers, and the entry options\' serial numbers', async () => {
  await run('Go to Record/Request/Page [ Last ]\nReplace Field Contents [ With dialog: Off ; People::Age ; Current contents ]');
  assert.deepEqual(column('Age'), ['20', '20']);
  await run('Replace Field Contents [ With dialog: Off ; People::Name ; Replace with serial numbers: Custom values ; Initial value: "N9" ; Increment value: 2 ]');
  assert.deepEqual(column('Name'), ['N9', 'N11']);
  const before = column('Code');
  await run('Replace Field Contents [ With dialog: Off ; People::Code ; Replace with serial numbers: Entry Options ; Update serial number in Entry Options ]');
  const codes = column('Code');
  assert.notDeepEqual(codes, before);
  const next = Number(codes[1].slice(2));
  assert.deepEqual(codes, [`P-${String(next - 1).padStart(3, '0')}`, `P-${String(next).padStart(3, '0')}`]);
  const r = store.create('People', {});
  assert.equal(store.get('People', r.recordId).fieldData.Code, `P-${String(next + 1).padStart(3, '0')}`, 'the next new record follows the last replaced');
  store.delete('People', r.recordId);
  const [s] = steps('Replace Field Contents [ With dialog: Off ; People::Name ; Replace with serial numbers: Custom values ; Initial value: 1 ; Increment value: 1 ; Update serial number in Entry Options ]');
  assert.equal(stepLine('Replace Field Contents', s.params), 'Replace Field Contents [ With dialog: Off ; People::Name ; Replace with serial numbers: Custom values ; Initial value: 1 ; Increment value: 1 ; Update serial number in Entry Options ]');
  await run('Replace Field Contents [ With dialog: Off ; People::Name ; If ( Get ( RecordNumber ) = 1 ; "Ada" ; "Bob" ) ]');
  await run('Replace Field Contents [ With dialog: Off ; People::Age ; If ( Get ( RecordNumber ) = 1 ; 36 ; 20 ) ]');
});

test('Re-Login with a dialog signs in as the account typed; Cancel is error 1', async () => {
  store.setPassword('Clerk', 'pw', '[Full Access]');
  let asked: DialogRequest | undefined;
  const ok = await run('Re-Login [ With dialog: On ]\nExit Script [ Text Result: Get ( AccountName ) ]', {
    account: 'Admin',
    dialog: async (req) => ((asked = req), { button: 1, inputs: ['clerk', 'pw'] }),
  });
  assert.equal(ok.error, 0);
  assert.equal(ok.result, 'Clerk');
  assert.deepEqual(asked?.inputs.map((x) => [x.label, x.value, x.password]), [['Account Name', 'Admin', false], ['Password', '', true]]);
  const wrong = await run('Set Error Capture [ On ]\nRe-Login [ With dialog: On ]\nExit Script [ Text Result: Get ( LastError ) & "/" & Get ( AccountName ) ]', {
    account: 'Admin', dialog: async () => ({ button: 1, inputs: ['clerk', 'nope'] }),
  });
  assert.match(String(wrong.result), /^\d+\/Admin$/);
  assert.notEqual(wrong.result, '0/Admin');
  const canceled = await run('Set Error Capture [ On ]\nRe-Login [ With dialog: On ]\nExit Script [ Text Result: Get ( LastError ) ]', {
    dialog: async () => ({ button: 2 }),
  });
  assert.equal(canceled.result, '1');
});

test('Pause/Resume Script with a duration waits that long, within the time limit', async () => {
  assert.deepEqual(steps('Pause/Resume Script [ Duration (seconds): 0.25 ]')[0].params, { calculation: '0.25' });
  assert.equal(steps('Pause/Resume Script [ Indefinitely ]')[0].params?.calculation, undefined);
  let t = Date.now();
  const r = await run('Pause/Resume Script [ Duration (seconds): 0.2 ]\nExit Script [ Text Result: "on" ]');
  assert.equal(r.result, 'on');
  assert.ok(Date.now() - t >= 190, 'it waited');
  t = Date.now();
  const late = await run('Pause/Resume Script [ Duration (seconds): 30 ]\nExit Script [ Text Result: "on" ]', { timeoutMs: 200 });
  assert.ok(Date.now() - t < 5000, 'the time limit cut the pause short');
  assert.notEqual(late.result, 'on');
});

test('Sort Records with its dialog sorts by the order a person picks, starting from the stored one; Cancel is error 1', async () => {
  let shown: unknown;
  const script = 'Set Error Capture [ On ]\nSort Records [ Restore; People::Age; ascending ]\nSet Variable [ $e ; Value: Get ( LastError ) ]\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: $e & "/" & People::Name ]';
  const r = await run(script, { sortDialog: async (req) => ((shown = req.sort), [{ fieldName: 'Name', sortOrder: 'descend' }]) });
  assert.deepEqual(shown, [{ fieldName: 'Age', sortOrder: 'ascend' }]);
  assert.equal(r.result, '0/Bob');
  assert.deepEqual(r.sort, [{ fieldName: 'Name', sortOrder: 'descend' }]);
  const canceled = await run(script, { sortDialog: async () => undefined });
  assert.equal(canceled.result, '1/Ada');
  const off = await run('Sort Records [ Restore; People::Age; ascending ; With dialog: Off ]\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: People::Name ]', {
    sortDialog: async () => assert.fail('With dialog: Off never asks'),
  });
  assert.equal(off.result, 'Bob');
  // No order of its own and nobody to ask: "the most recently performed sort instructions" (Sort Records help); none yet, nothing changes.
  const none = await run('Set Error Capture [ On ]\nSort Records\nExit Script [ Text Result: Get ( LastError ) ]');
  assert.equal(none.result, '0');
  const again = await run('Sort Records [ Restore; People::Age; ascending ; With dialog: Off ]\nUnsort Records\nSort Records\nGo to Record/Request/Page [ First ]\nExit Script [ Text Result: Get ( LastError ) & "/" & People::Name ]');
  assert.equal(again.result, '0/Bob');
});

test('Perform Find/Replace survives the script text, options included', () => {
  for (const line of [
    'Perform Find/Replace [ With dialog: Off ; "[NAME]" ; People::Name ; Replace All ]',
    'Perform Find/Replace [ With dialog: Off ; People::Name ; Find Next ; Match case ; Whole words ; Across: Current record ; Within: Current field ]',
  ]) {
    const [s] = steps(line);
    assert.equal(stepLine('Perform Find/Replace', s.params), line);
  }
});

test('Get ( FileLocaleElements ) and Get ( SystemLocaleElements ) describe the locale as FileMaker\'s JSON', async () => {
  const file = JSON.parse(String((await run('Exit Script [ Text Result: Get ( FileLocaleElements ) ]')).result));
  const system = JSON.parse(String((await run('Exit Script [ Text Result: Get ( SystemLocaleElements ) ]')).result));
  const order = typeof store.dateOrder === 'string' ? store.dateOrder : store.dateOrder.order;
  assert.equal(file.APIVers, 1);
  assert.equal(file.Date.DateOrderName, order);
  assert.equal(file.Date.DMQ.Months.NameList[9], 'October');
  assert.equal(file.Misc.Active, true);
  assert.equal(system.Misc.Active, false);
});

test('Import Records reads Excel workbooks and FileMaker XML; Excel dates go into date fields', async () => {
  store.applyDesign([{ op: 'createTable', name: 'Visits', fields: [{ name: 'Who', type: 'text' }, { name: 'On', type: 'date' }, { name: 'Count', type: 'number' }] }]);
  const docs = join(dir, 'docs');
  mkdirSync(docs, { recursive: true });
  // 46307 is 2026-10-12 as an Excel serial number.
  writeFileSync(join(docs, 'visits.xlsx'), xlsx([['Ada & co', 46307, 3], ['', '', 4.5]]));
  writeFileSync(join(docs, 'visits.xml'), '<?xml version="1.0"?><FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult"><RESULTSET FOUND="1"><ROW MODID="0" RECORDID="1"><COL><DATA>Bob &lt;b&gt;</DATA></COL><COL><DATA>10/13/2026</DATA></COL><COL><DATA>7</DATA></COL></ROW></RESULTSET></FMPXMLRESULT>');
  const importFrom = (file: string) => runScript(store, { id: 9998, name: 'imp', steps: [
    { stepId: 35, name: 'Import Records', enabled: true, params: { noDialog: true, tableOccurrence: { id: 0, name: 'Visits' }, filePaths: [`file:${file}`] } },
  ] } as Script, { layout: 'Visits', foundSet: [], documents: docs });
  assert.equal((await importFrom('visits.xlsx')).error, 0);
  assert.equal((await importFrom('visits.xml')).error, 0);
  const rows = store.query('SELECT Who, "On", Count FROM Visits ORDER BY _fm_record_id').map((r) => [r.Who, r.On, r.Count].map((v) => (v === null ? '' : String(v))));
  assert.deepEqual(rows, [['Ada & co', '2026-10-12', '3'], ['', '', '4.5'], ['Bob <b>', '2026-10-13', '7']]);
});

test('with error capture off, a failing step shows its error; Continue carries on and Cancel halts the script', async () => {
  const asked: DialogRequest[] = [];
  const SCRIPT = `
    Go to Layout [ Layout Name: "Nowhere" ]
    Set Variable [ $error ; Value: Get ( LastError ) ]
    Exit Script [ Text Result: $error & " ran" ]`;
  const go = await run(SCRIPT, { dialog: async (r) => (asked.push(r), { button: 1 }) });
  assert.equal(go.result, '105 ran');
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].buttons, ['Continue', 'Cancel']);
  assert.match(asked[0].message, /Layout is missing \(error 105\)/);
  assert.match(asked[0].message, /"Go to Layout" in script "test"/);
  // Cancel, or closing the dialog, halts the script: nothing after the step runs.
  const stop = await run(SCRIPT, { dialog: async () => ({ button: 2 }) });
  assert.equal(stop.result, '');
  const closed = await run(SCRIPT, { dialog: async () => undefined });
  assert.equal(closed.result, '');
});

test('no error dialog with error capture on, with no one to answer, or for errors FileMaker shows none for', async () => {
  const asked: DialogRequest[] = [];
  const dialog = async (r: DialogRequest) => (asked.push(r), { button: 1 });
  assert.equal((await run('Set Error Capture [ On ]\nGo to Layout [ Layout Name: "Nowhere" ]\nExit Script [ Text Result: Get ( LastError ) ]', { dialog })).result, '105');
  // A run with nobody to ask (a schedule, the Data API) just carries on.
  assert.equal((await run('Go to Layout [ Layout Name: "Nowhere" ]\nExit Script [ Text Result: Get ( LastError ) ]')).result, '105');
  // Off the end of the found set, and a step this server can't run.
  assert.equal((await run('Go to Record/Request/Page [ Last ]\nGo to Record/Request/Page [ Next ]\nExit Script [ Text Result: Get ( LastError ) ]', { dialog })).result, '101');
  assert.equal((await run('Perform AppleScript [ "x" ]\nExit Script [ Text Result: Get ( LastError ) ]', { dialog })).result, '3');
  assert.equal(asked.length, 0);
});

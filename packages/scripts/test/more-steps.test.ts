// Script steps from the coverage matrix (research/scripts/step-coverage.md)
// that real solutions use: lookups, copying records, finds, the Data API step,
// accounts, error logging, JSONL and Excel output, and lists of record IDs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

let dir: string;
let docs: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-steps-'));
  docs = join(dir, 'docs');
  createStore(join(dir, 'S.sqlite'));
  store = new Store(join(dir, 'S.sqlite'), 'S');
  store.applyDesign([
    { op: 'createTable', name: 'Products', fields: [{ name: 'Code', type: 'text' }, { name: 'Price', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [
      { name: 'Code', type: 'text' }, { name: 'Note', type: 'text' }, { name: 'Price', type: 'number' },
    ] },
    { op: 'createRelationship', left: 'Lines', right: 'Products', predicates: [{ left: 'Code', right: 'Code' }] },
  ]);
  store.applyDesign([{ op: 'updateField', table: 'Lines', field: 'Price', options: { autoEnter: { lookup: { occurrence: 'Products', field: 'Price' } as never } } }]);
  store.create('Products', { Code: 'A', Price: '1' });
  store.create('Products', { Code: 'B', Price: '2' });
  store.create('Lines', { Code: 'A', Note: 'first' });
  store.create('Lines', { Code: 'B', Note: 'second' });
  store.create('Lines', { Code: 'A', Note: 'third' });
  store.setPassword('Admin', 'secret', '[Full Access]');
  store.savePrivilegeSet({ name: 'Clerks', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [] });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const steps = (text: string) => parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
  .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params }));
const run = (text: string, opts: RunOptions = {}) =>
  runScript(store, { id: 9999, name: 'test', steps: steps(text) } as Script, { layout: 'Lines', foundSet: store.findIds('Lines'), documents: docs, ...opts });
const prices = () => store.query('SELECT Price FROM Lines ORDER BY _fm_record_id').map((r) => Number(r.Price));

test('Relookup Field Contents copies looked-up values again for the found set', async () => {
  assert.deepEqual(prices(), [1, 2, 1]);
  const a = store.findIds('Products', { query: [{ Code: '==A' }] })[0];
  store.update('Products', a, { Price: '5' });
  assert.deepEqual(prices(), [1, 2, 1], 'a lookup copies once, it does not follow the source');
  const r = await run('Relookup Field Contents [ With dialog: Off ; Lines::Code ]');
  assert.equal(r.error, 0);
  assert.deepEqual(prices(), [5, 2, 5]);
  store.update('Products', a, { Price: '1' });
  await run('Relookup Field Contents [ With dialog: Off ; Lines::Code ]');
});

test('Copy Record/Request and Copy All Records/Requests put tab-separated text on the clipboard', async () => {
  const r = await run(`
    Go to Record/Request/Page [ 2 ]
    Copy Record/Request
    Paste [ $one ]
    Copy All Records/Requests
    Paste [ $all ]
    Exit Script [ Text Result: $one & "|" & Substitute ( $all ; [ Char ( 9 ) ; "," ] ; [ ¶ ; "/" ] ) ]`);
  assert.equal(r.error, 0, r.trace?.map((t) => t.message).join());
  assert.equal(r.result, 'B\tsecond\t2|A,first,1/B,second,2/A,third,1');
  // Each copy also reaches the person's own clipboard.
  assert.deepEqual(r.actions.filter((a) => 'clipboard' in a).map((a) => a.clipboard), ['B\tsecond\t2', 'A\tfirst\t1\rB\tsecond\t2\rA\tthird\t1']);
});

test('Find Matching Records replaces, constrains and extends the found set', async () => {
  const r = await run(`
    Find Matching Records [ Replace ; Lines::Code ]
    Set Variable [ $a ; Value: Get ( FoundCount ) ]
    Go to Record/Request/Page [ 2 ]
    Find Matching Records [ Constrain ; Lines::Note ]
    Set Variable [ $b ; Value: Get ( FoundCount ) & GetValue ( Lines::Note ; 1 ) ]
    Go to Record/Request/Page [ First ]
    Show All Records
    Go to Record/Request/Page [ 2 ]
    Find Matching Records [ Replace ; Lines::Code ]
    Go to Record/Request/Page [ First ]
    Find Matching Records [ Extend ; Lines::Note ]
    Exit Script [ Text Result: $a & "/" & $b & "/" & Get ( FoundCount ) ]`);
  assert.equal(r.result, '2/1third/1');
});

test('Modify Last Find goes back to Find mode with the last requests', async () => {
  const r = await run(`
    Enter Find Mode [ Pause: Off ]
    Set Field [ Lines::Note ; "sec" ]
    Perform Find
    Set Variable [ $a ; Value: Get ( FoundCount ) ]
    Show All Records
    Modify Last Find
    Set Variable [ $mode ; Value: Get ( WindowMode ) ]
    Perform Find
    Set Variable [ $b ; Value: Get ( FoundCount ) & Lines::Note ]
    Modify Last Find
    Set Field [ Lines::Note ; "thi" ]
    Perform Find
    Exit Script [ Text Result: $a & "/" & $mode & "/" & $b & "/" & Lines::Note ]`);
  assert.equal(r.result, '1/1/1second/third');
});

test('Execute FileMaker Data API reads, finds, writes and reports errors in the Data API\'s JSON', async () => {
  const r = await run(`
    Execute FileMaker Data API [ Select ; Target: $read ; JSONSetElement ( "{}" ; [ "layouts" ; "Lines" ; JSONString ] ; [ "limit" ; 2 ; JSONNumber ] ) ]
    Execute FileMaker Data API [ Select ; Target: $find ; "{\\"layouts\\":\\"Lines\\",\\"query\\":[{\\"Note\\":\\"third\\"}],\\"sort\\":[{\\"fieldName\\":\\"Note\\",\\"sortOrder\\":\\"descend\\"}]}" ]
    Execute FileMaker Data API [ Select ; Target: $none ; "{\\"layouts\\":\\"Lines\\",\\"query\\":[{\\"Note\\":\\"nothing\\"}]}" ]
    Set Variable [ $noneError ; Value: Get ( LastError ) ]
    Execute FileMaker Data API [ Select ; Target: $made ; "{\\"action\\":\\"create\\",\\"layouts\\":\\"Products\\",\\"fieldData\\":{\\"Code\\":\\"C\\",\\"Price\\":3}}" ]
    Execute FileMaker Data API [ Select ; Target: $bad ; "not json" ]
    Set Variable [ $badError ; Value: Get ( LastError ) ]
    Execute FileMaker Data API [ Select ; Target: $meta ; "{\\"action\\":\\"metaData\\"}" ]
    Exit Script [ Text Result: JSONSetElement ( "{}" ; [ "read" ; $read ; JSONObject ] ; [ "find" ; $find ; JSONObject ] ; [ "none" ; $none ; JSONObject ] ; [ "noneError" ; $noneError ; JSONNumber ] ; [ "made" ; $made ; JSONObject ] ; [ "badError" ; $badError ; JSONNumber ] ; [ "meta" ; $meta ; JSONObject ] ) ]`);
  const o = JSON.parse(r.result);
  assert.equal(o.read.messages[0].code, '0');
  assert.deepEqual({ ...o.read.response.dataInfo, database: undefined }, { database: undefined, layout: 'Lines', table: 'Lines', totalRecordCount: 3, foundCount: 3, returnedCount: 2 });
  assert.equal(o.read.response.data[0].fieldData.Note, 'first');
  assert.equal(typeof o.read.response.data[0].recordId, 'string');
  assert.equal(o.find.response.data.length, 1);
  assert.equal(o.find.response.data[0].fieldData.Note, 'third');
  assert.equal(o.none.messages[0].code, '401');
  assert.equal(o.noneError, 401);
  assert.ok(Number(o.made.response.recordId) > 0);
  assert.equal(store.findIds('Products', { query: [{ Code: '==C' }] }).length, 1);
  assert.equal(o.badError, 1708);
  assert.ok(o.meta.response.layouts.some((l: { name: string }) => l.name === 'Products'));
  store.delete('Products', store.findIds('Products', { query: [{ Code: '==C' }] })[0]);
});

test('Execute FileMaker Data API legacy text and Select replace; explicit Off appends', async () => {
  const r = await run(`
    Set Variable [ $append ; Value: "prefix" ]
    Set Variable [ $replace ; Value: "prefix" ]
    Set Variable [ $legacy ; Value: "prefix" ]
    Execute FileMaker Data API [ Select: Off ; Target: $append ; "{}" ]
    Execute FileMaker Data API [ Select ; Target: $replace ; "{}" ]
    Execute FileMaker Data API [ Target: $legacy ; "{}" ]
    Exit Script [ Result: $append & "|" & $replace & "|" & $legacy ]`);
  const [appended, replaced, legacy] = r.result.split('|');
  assert.ok(replaced.startsWith('{'));
  assert.equal(appended, `prefix${replaced}`);
  assert.equal(legacy, replaced);
});

test('Execute FileMaker Data API metaData: the full field description, and only what the script\'s account can see', async () => {
  const meta = (req: object, opts = {}) => run(`Execute FileMaker Data API [ Select ; Target: $m ; ${JSON.stringify(JSON.stringify(req))} ]\nExit Script [ Text Result: $m ]`, opts)
    .then((r) => JSON.parse(r.result));
  const full = await meta({ action: 'metaData', layouts: 'Lines' });
  const price = full.response.fieldMetaData.find((f: { name: string }) => f.name === 'Price');
  assert.deepEqual({ name: price.name, type: price.type, result: price.result, autoEnter: price.autoEnter, maxRepeat: price.maxRepeat, global: price.global },
    { name: 'Price', type: 'normal', result: 'number', autoEnter: true, maxRepeat: 1, global: false });
  assert.ok(full.response.fieldMetaData.some((f: { name: string }) => f.name === 'Note'));

  store.savePrivilegeSet({
    name: 'Narrow', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
    layoutAccess: { Products: { layout: 'none', records: 'none' } },
    tables: { Lines: { view: true, edit: true, create: true, delete: true, fields: { Note: 'none', Price: 'masked' } }, Products: { view: false, edit: false, create: false, delete: false } },
  });
  store.setPassword('Narrow', 'pw', 'Narrow');
  try {
    const opts = { account: 'Narrow', privileges: store.privileges('Narrow') };
    const lines = await meta({ action: 'metaData', layouts: 'Lines' }, opts);
    const names = lines.response.fieldMetaData.map((f: { name: string }) => f.name);
    assert.ok(!names.includes('Note'), 'a hidden field is not listed');
    assert.equal(lines.response.fieldMetaData.find((f: { name: string }) => f.name === 'Price').result, 'text', 'a masked field reads as its stand-in text');
    const hidden = await meta({ action: 'metaData', layouts: 'Products' }, opts);
    assert.equal(hidden.messages[0].code, '105', 'a layout the account can\'t see is missing');
    const layouts = await meta({ action: 'metaData' }, opts);
    assert.ok(!layouts.response.layouts.some((l: { name: string }) => l.name === 'Products'));
    assert.ok(layouts.response.layouts.some((l: { name: string }) => l.name === 'Lines'));
    const tables = await meta({ action: 'metaData', tables: '' }, opts);
    assert.ok(!tables.response.tables.some((t: { name: string }) => t.name === 'Products'));
    assert.ok(tables.response.tables.some((t: { name: string }) => t.name === 'Lines'));
  } finally {
    store.deleteAccount('Narrow');
    store.deletePrivilegeSet('Narrow');
  }
});

test('Add Account needs full access and a set other than Full Access; Change Password checks the old one', async () => {
  const add = (name: string, set: string) => `Add Account [ Account Name: "${name}" ; Password: "pw1" ; Privilege Set: "${set}" ]`;
  let r = await run(`Set Error Capture [ On ]\n${add('Clerk', 'Clerks')}\nSet Variable [ $a ; Value: Get ( LastError ) ]\n${add('Clerk', 'Clerks')}\nSet Variable [ $b ; Value: Get ( LastError ) ]\n${add('Boss', '[Full Access]')}\nExit Script [ Text Result: $a & "/" & $b & "/" & Get ( LastError ) ]`);
  assert.equal(r.result, '0/3/3');
  assert.equal(store.accounts().find((a) => a.name === 'Clerk')?.privilegeSet, 'Clerks');
  assert.ok(store.verify('Clerk', 'pw1'));
  assert.ok(!store.accounts().some((a) => a.name === 'Boss'));
  // Without full access: error 9.
  r = await run(`Set Error Capture [ On ]\n${add('Other', 'Clerks')}`, { account: 'Clerk', privileges: store.privileges('Clerk') });
  assert.equal(r.error, 9);
  r = await run('Change Password [ Old Password: "wrong" ; New Password: "pw2" ; With dialog: Off ]', { account: 'Clerk', privileges: store.privileges('Clerk') });
  assert.equal(r.error, 212);
  r = await run('Change Password [ Old Password: "pw1" ; New Password: "pw2" ; With dialog: Off ]', { account: 'Clerk', privileges: store.privileges('Clerk') });
  assert.equal(r.error, 0);
  assert.ok(store.verify('Clerk', 'pw2'));
  store.deleteAccount('Clerk');
});

test('Add Account supports inactive status and required password change while keeping defaults active', async () => {
  const r = await run(`
    Add Account [ Account Name: "Inactive" ; Password: "pw1" ; Privilege Set: "Clerks" ; Account Status: Inactive ]
    Add Account [ Account Name: "MustChange" ; Password: "pw1" ; Privilege Set: "Clerks" ; User must change password on next login ]
    Add Account [ Account Name: "Default" ; Password: "pw1" ; Privilege Set: "Clerks" ]`);
  assert.equal(r.error, 0);
  assert.equal(store.verify('Inactive', 'pw1'), false, 'inactive accounts cannot sign in');
  assert.equal(store.mustChangePassword('MustChange'), true);
  assert.equal(store.accounts().find((a) => a.name === 'MustChange')?.mustChange, true);
  assert.equal(store.accounts().find((a) => a.name === 'Default')?.inactive, undefined);
  assert.equal(store.mustChangePassword('Default'), false);
  const events = store.auditLog({ security: true, limit: 1000 });
  for (const [account, expected] of [
    ['Inactive', ['account-added', 'privilege-set-assigned', 'account-disabled']],
    ['MustChange', ['account-added', 'privilege-set-assigned']],
    ['Default', ['account-added', 'privilege-set-assigned']],
  ] as const) {
    const actual = events.filter((e) => e.target === account).map((e) => e.kind);
    assert.deepEqual(actual.slice(-expected.length), expected, `${account} keeps the expected security events`);
  }
  for (const account of ['Inactive', 'MustChange', 'Default']) store.deleteAccount(account);
});

test('Add Account rolls back password, privileges and events when any security write fails', async () => {
  const failures = [
    ['deactivation', `CREATE TRIGGER fail_add_deactivation BEFORE UPDATE OF inactive ON _fm_accounts WHEN NEW.name = 'FailInactive' BEGIN SELECT RAISE(ABORT, 'blocked'); END`],
    ['must-change', `CREATE TRIGGER fail_add_must_change BEFORE UPDATE OF must_change ON _fm_accounts WHEN NEW.name = 'FailMustChange' BEGIN SELECT RAISE(ABORT, 'blocked'); END`],
    ['audit', `CREATE TRIGGER fail_add_audit BEFORE INSERT ON _fm_audit WHEN NEW.kind = 'account-added' AND NEW.security = 1 BEGIN SELECT RAISE(ABORT, 'blocked'); END`],
  ] as const;
  for (const [kind, trigger] of failures) {
    const account = kind === 'deactivation' ? 'FailInactive' : kind === 'must-change' ? 'FailMustChange' : 'FailAudit';
    store.sql.exec(trigger);
    try {
      const options = kind === 'deactivation' ? ' ; Account Status: Inactive' : kind === 'must-change' ? ' ; User must change password on next login' : '';
      await assert.rejects(
        () => run(`Add Account [ Account Name: "${account}" ; Password: "pw1" ; Privilege Set: "Clerks"${options} ]`),
        // A step that carries a password fails with a generic message, so the database's own text never echoes it.
        /Credential step failed/,
        `${kind} failure should fail Add Account`,
      );
      assert.equal(store.accounts().some((a) => a.name === account), false, `${kind} failure must roll back the account`);
      assert.equal(store.verify(account, 'pw1'), false, `${kind} failure must not leave a usable password`);
      assert.equal(store.auditLog({ security: true, limit: 1000 }).some((e) => e.target === account), false, `${kind} failure must roll back security events`);
    } finally {
      store.sql.exec(`DROP TRIGGER IF EXISTS ${kind === 'deactivation' ? 'fail_add_deactivation' : kind === 'must-change' ? 'fail_add_must_change' : 'fail_add_audit'}`);
    }
  }
});

test('Set Error Logging appends a tab-separated line per step error to ScriptErrors.log', async () => {
  await run(`
    Set Error Logging [ On ; Custom debug info: "note " & Lines::Note ]
    Set Error Capture [ On ]
    Go to Record/Request/Page [ 99 ]
    Go to Record/Request/Page [ First ]
    Set Error Logging [ Off ]
    Go to Record/Request/Page [ 98 ]`, { account: 'Admin' });
  const lines = readFileSync(join(docs, 'ScriptErrors.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const cols = lines[0].split('\t');
  assert.equal(cols.length, 8);
  assert.match(cols[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/);
  assert.deepEqual(cols.slice(2), ['S', 'Admin', 'test [0]', 'Go to Record/Request/Page [3]', '101', 'note first']);
});

test('Save Records as JSONL writes one messages line per record; Save Records as Excel writes .xlsx', async () => {
  let r = await run('Save Records as JSONL [ Format for fine-tuning: Off ; Completion Field: Lines::Note ; "lines.jsonl" ]');
  assert.equal(r.error, 0, r.trace?.map((t) => t.message).join());
  const rows = readFileSync(join(docs, 'lines.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].messages.slice(1), [{ role: 'user', content: 'Code=A, Price=1' }, { role: 'assistant', content: 'first' }]);
  r = await run('Save Records as JSONL [ Format for fine-tuning: On ; User Prompt: "Price of " & Lines::Code ; Assistant Prompt: Lines::Price ; "tune.jsonl" ]');
  const tuned = JSON.parse(readFileSync(join(docs, 'tune.jsonl'), 'utf8').split('\n')[1]);
  assert.deepEqual(tuned.messages, [{ role: 'user', content: 'Price of B' }, { role: 'assistant', content: '2' }]);
  r = await run('Save Records as Excel [ With dialog: Off ; "lines.xlsx" ]');
  assert.equal(r.error, 0);
  assert.equal(readFileSync(join(docs, 'lines.xlsx')).subarray(0, 2).toString(), 'PK');
});

test('Go to List of Records shows the records with those IDs in that order', async () => {
  const [a, b, c] = store.findIds('Lines');
  let r = await run(`Go to List of Records [ List of record IDs: "${c} ${a}-${b} 999" ]\nExit Script [ Text Result: List ( Get ( FoundCount ) ; Lines::Note ) ]`);
  assert.equal(r.result, '3\rthird');
  assert.deepEqual(r.foundSet, [c, a, b]);
  r = await run(`Go to List of Records [ List of record IDs: "[{\\"recordId\\":\\"${b}\\"}]" ; Using layout: "Lines" ; New window ]`);
  assert.deepEqual(r.foundSet, [b]);
  r = await run('Set Error Capture [ On ]\nGo to List of Records [ List of record IDs: "999" ]');
  assert.equal(r.error, 401);
});

test('copying with no field active copies the record; Cut with none is an error', async () => {
  const r = await run(`
    Set Error Capture [ On ]
    Copy
    Paste [ $rec ]
    Cut
    Exit Script [ Text Result: $rec & "/" & Get ( LastError ) ]`);
  assert.equal(r.result, 'A\tfirst\t1/102');
  assert.equal(existsSync(join(docs, 'nothing')), false);
});

test('Get functions for script state: error capture, error location, modified fields, quick find, access', async () => {
  const r = await run(`
    Set Variable [ $a ; Value: Get ( ErrorCaptureState ) & Get ( AllowAbortState ) ]
    Set Error Capture [ On ]
    Allow User Abort [ Off ]
    Go to Record/Request/Page [ 99 ]
    Set Variable [ $loc ; Value: Get ( LastErrorLocation ) ]
    Go to Record/Request/Page [ First ]
    Set Field [ Lines::Note ; "changed" ]
    Set Field [ Lines::Code ; "A" ]
    Set Variable [ $mod ; Value: Get ( ModifiedFields ) & "|" & Get ( RecordOpenCount ) ]
    Revert Record/Request [ With dialog: Off ]
    Perform Quick Find [ "third" ]
    Exit Script [ Text Result: List ( $a ; Get ( ErrorCaptureState ) & Get ( AllowAbortState ) ; $loc ; $mod ; Get ( LastErrorLocation ) ; Get ( QuickFindText ) ; Get ( LayoutAccess ) & Get ( RecordAccess ) ; Get ( AccountType ) ; Get ( AccountPasswordDaysRemaining ) ; Get ( SessionIdentifier ) ) ]`, { account: 'Admin' });
  assert.deepEqual(r.result.split('\r'), ['01', '10', 'test\tGo to Record/Request/Page\t4', 'Note', 'Code|1', 'third', '22', 'FileMaker File', '-1']);
});

test('Get ( DocumentsPathListing ), Get ( FilePath ) and Get ( SystemStorageAvailable )', async () => {
  const r = await run(`
    Set Variable [ $path ; Value: Get ( DocumentsPath ) & "sub/x.jsonl" ]
    Save Records as JSONL [ Format for fine-tuning: Off ; Completion Field: Lines::Note ; "$path" ; Create folders: On ]
    Exit Script [ Text Result: List ( FilterValues ( Get ( DocumentsPathListing ) ; Get ( DocumentsPath ) & "sub/" & ¶ & Get ( DocumentsPath ) & "sub/x.jsonl" ) ; Right ( Get ( FilePath ) ; 7 ) ; Get ( SystemStorageAvailable ) > 0 ) ]`);
  assert.equal(r.result, '/Documents/sub/\r/Documents/sub/x.jsonl\r\rS.fmp12\r1');
});

test('Configure Persistent Data stores typed values per name and instance; GetPersistentData reads them', async () => {
  let r = await run(`
    Set Error Capture [ On ]
    Configure Persistent Data [ Name: AppVersion ; Value: "2.1.0" ]
    Configure Persistent Data [ Name: theme ; Instance ID: "a" ; Value: 42 ]
    Configure Persistent Data [ Name: theme ; Instance ID: "b" ; Value: Date ( 10 ; 12 ; 2026 ) ]
    Configure Persistent Data [ Name: theme ; Instance ID: "b" ; Delete Entry ]
    Set Variable [ $del ; Value: Get ( LastError ) ]
    Configure Persistent Data [ Name: theme ; Instance ID: "b" ; Delete Entry ]
    Exit Script [ Text Result: List ( GetPersistentData ( "AppVersion" ; "" ) ; GetPersistentData ( "theme" ; "a" ) + 1 ; GetPersistentData ( "theme" ; "b" ) ; ListPersistentDataIDs ( "theme" ) ; $del & "/" & Get ( LastError ) ) ]`);
  assert.equal(r.result, '2.1.0\r43\r?\ra\r0/10');
  // Field calculations read them too, and a script without full access can't write them.
  assert.equal(store.evaluate('Lines', 'GetPersistentData ( "AppVersion" ; "" )', store.findIds('Lines')[0]).value, '2.1.0');
  store.setPassword('Clerk2', 'pw', 'Clerks');
  r = await run('Configure Persistent Data [ Name: AppVersion ; Value: "3" ]', { account: 'Clerk2', privileges: store.privileges('Clerk2') });
  assert.equal(r.error, 9);
  store.deleteAccount('Clerk2');
});

test('Save a Copy as XML writes the design report, for full access only', async () => {
  const r = await run('Save a Copy as XML [ Destination: "design.xml" ]');
  assert.equal(r.error, 0);
  const xml = readFileSync(join(docs, 'design.xml'), 'utf8');
  assert.match(xml, /<FMPReport/);
  assert.match(xml, /Lines/);
});

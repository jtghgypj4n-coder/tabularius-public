// Perform SQL Query by Natural Language on Tabularius's own AI, with a stand-in model: the model sees only the tables
// and fields the account can see (never record data), its SQL runs with the account's privileges, a failing query
// goes back to it with the error, Get DDL never asks it, and the step is refused where the other AI steps are.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptText as renderScriptText, stepLine, type Script, type ScriptStep } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { asText } from '@tabularius/calc';
import { runScript, ScriptSession, setCaptureOnlyDefaults, type RunOptions, type ScriptAi } from '../src/index.ts';

// A file whose name starts with this is held: no mail, no network, and its data never goes to AI.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let store: Store;
let held: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-nl-'));
  const make = (name: string) => {
    createStore(join(dir, `${name}.sqlite`));
    const s = new Store(join(dir, `${name}.sqlite`), name);
    s.applyDesign([
      { op: 'createTable', name: 'Customers', fields: [{ name: 'id', type: 'number' }, { name: 'Name', type: 'text' }, { name: 'Secret', type: 'text' }] },
      { op: 'createTable', name: 'Payroll', fields: [{ name: 'Salary', type: 'number' }] },
    ]);
    s.create('Customers', { id: '1', Name: 'Ada', Secret: 'private 1' });
    s.create('Customers', { id: '2', Name: 'Bo', Secret: 'private 2' });
    s.create('Payroll', { Salary: '99000' });
    s.savePrivilegeSet({
      name: 'Limited', records: { view: true, edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: [],
      tables: {
        Customers: { view: 'id = 1', edit: false, create: false, delete: false, fields: { Secret: 'none' } },
        Payroll: { view: false, edit: false, create: false, delete: false },
      },
    });
    s.setPassword('reader', 'reader-password', 'Limited');
    return s;
  };
  store = make('Shop');
  held = make('Held_Sample');
});
after(() => {
  store?.close();
  held?.close();
  rmSync(dir, { recursive: true });
});

const parsed = (s: Store, text: string): ScriptStep[] =>
  parseScriptText(text, s.schema).map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: x.enabled !== false, params: x.params }));
const script = (steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const configure: ScriptStep = { stepId: 212, name: 'Configure AI Account', enabled: true, params: { ai: { accountName: '"acct"' } } };
const run = (s: Store, text: string, opts: RunOptions = {}) =>
  runScript(s, script([configure, ...parsed(s, `${text}\nExit Script [ Text Result: $r ]`)]), { layout: 'Customers', trace: true, session: new ScriptSession(), ...opts });
const why = (r: Awaited<ReturnType<typeof run>>) => r.trace?.find((t) => t.message)?.message ?? '';
const reader = () => ({ account: 'reader', privileges: store.privileges('reader') });

/** A stand-in model: each call gets the next answer, and what it was sent is kept. */
function fake(...answers: string[]) {
  const calls: { system?: string; messages: { role: string; content: string }[] }[] = [];
  const ai: ScriptAi = {
    refusal: () => undefined,
    generate: async (r) => {
      calls.push({ system: r.system, messages: r.messages });
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    },
  };
  return { ai, calls };
}

const step = (options: string) => `Perform SQL Query by Natural Language [ Account Name: "acct" ; Model: "m" ; Prompt: "Who are our customers?" ; ${options} ; Response Target: $r ]`;

test('Get DDL describes only what the account can see, and never asks the model', async () => {
  const { ai, calls } = fake('unused');
  const r = await run(store, step('Action: Get DDL'), { ai, ...reader() });
  assert.equal(r.error, 0, why(r));
  assert.match(r.result, /CREATE TABLE "Customers"/);
  assert.match(r.result, /"Name"/);
  assert.doesNotMatch(r.result, /Secret|Payroll|Salary/);
  assert.equal(calls.length, 0);
  // Full access sees everything.
  const full = await run(store, step('Action: Get DDL ; Data Tables: From list ; Tables: Customers'), { ai });
  assert.match(full.result, /"Secret"/);
  assert.doesNotMatch(full.result, /Payroll/);
});

test('Query runs the model\'s SQL with the account\'s privileges and answers from the result', async () => {
  const { ai, calls } = fake('```sql\nSELECT c.Name, x.Secret FROM "Customers" c, "Customers" x;\n```', 'Your customer is Ada.');
  const r = await run(store, step('Action: Query'), { ai, ...reader() });
  assert.equal(r.error, 0, why(r));
  assert.equal(r.result, 'Your customer is Ada.');
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0].system ?? '', /Secret|Payroll|private/);
  // The rows the model answered from are the account's: one record, the hidden field empty.
  assert.match(calls[1].system ?? '', /Result \(fields separated by tabs, one record per line\):\nAda\t$/);
  assert.doesNotMatch(JSON.stringify(calls), /private/);
});

test('Query for Data Only returns the rows; a failing query goes back to the model with its error', async () => {
  const { ai, calls } = fake('SELECT Nope FROM "Customers"', 'SELECT "Name" FROM "Customers" ORDER BY "Name"');
  const r = await run(store, step('Action: Query for Data Only'), { ai });
  assert.equal(r.error, 0, why(r));
  assert.equal(r.result, 'Ada\rBo');
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-1)!.content, /That query failed/);
});

test('the model\'s SQL can\'t list the names of tables and fields the account can\'t see', async () => {
  const fields = fake('SELECT TableName || \'.\' || FieldName FROM FileMaker_Fields');
  const r = await run(store, step('Action: Query for Data Only'), { ai: fields.ai, ...reader() });
  assert.equal(r.error, 0, why(r));
  assert.match(r.result, /Customers\.Name/);
  assert.doesNotMatch(r.result, /Secret|Payroll|Salary/);
  const raw = fake('SELECT sql FROM sqlite_master');
  const r2 = await run(store, step('Action: Query for Data Only'), { ai: raw.ai, ...reader() });
  assert.equal(r2.error, 1200);
  // By DDL from GetTableDDL describes only what the account sees, too.
  const ddl = await run(store, step('Action: Get DDL ; Data Tables: By DDL ; DDL: GetTableDDL ( "[\\"Payroll\\",\\"Customers\\"]" ; 0 )'), { ai: raw.ai, ...reader() });
  assert.match(ddl.result, /"Customers"/);
  assert.doesNotMatch(ddl.result, /Secret|Payroll/);
});

test('Get SQL returns the SQL the model wrote; Get First SQL Only runs nothing', async () => {
  const sql = fake('SELECT Nope FROM "Customers"', 'SELECT "Name" FROM "Customers"');
  const r = await run(store, step('Action: Get SQL'), { ai: sql.ai });
  assert.equal(r.result, 'SELECT Nope FROM "Customers"\rSELECT "Name" FROM "Customers"');
  const first = fake('SELECT Nope FROM "Customers"');
  const r2 = await run(store, step('Action: Get First SQL Only'), { ai: first.ai });
  assert.equal(r2.error, 0, why(r2));
  assert.equal(r2.result, 'SELECT Nope FROM "Customers"');
  assert.equal(first.calls.length, 1);
});

test('nothing relevant: the model\'s reason is the response and the step succeeds', async () => {
  const { ai } = fake('NO_SQL: These tables say nothing about the weather.');
  const r = await run(store, step('Action: Query'), { ai });
  assert.equal(r.error, 0, why(r));
  assert.equal(r.result, 'These tables say nothing about the weather.');
});

test('SQL that never runs stops with an error; SQL can\'t write', async () => {
  const { ai, calls } = fake('DELETE FROM "Customers"');
  const r = await run(store, step('Action: Query for Data Only'), { ai });
  // Not a SELECT: read as the model saying it has no query, so nothing runs.
  assert.equal(r.error, 0);
  assert.equal(calls.length, 1);
  assert.equal(asText(store.calc.executeSQL('SELECT count(*) FROM Customers', [])[0][0]), '2');
  const bad = fake('SELECT Nope FROM "Customers"');
  const r2 = await run(store, step('Action: Query for Data Only'), { ai: bad.ai });
  assert.equal(r2.error, 1200);
  assert.equal(bad.calls.length, 3);
});

test('refused offline, for a file with AI off, and for a capture-only file; Get DDL still works offline', async () => {
  const offline = await run(store, step('Action: Query'));
  assert.equal(offline.error, 3);
  assert.match(why(offline), /offline/);
  assert.equal((await run(store, step('Action: Get DDL'))).error, 0);
  const off: ScriptAi = { refusal: () => 'AI is turned off for this file', generate: async () => 'SELECT 1' };
  assert.equal((await run(store, step('Action: Query'), { ai: off })).error, 3);
  const { ai, calls } = fake('SELECT 1');
  const refused = await run(held, step('Action: Query'), { ai });
  assert.equal(refused.error, 3);
  assert.match(why(refused), /capture-only/);
  assert.equal(calls.length, 0);
});

test('script text parses and prints back', () => {
  const text = step('Action: Query for Data Only ; Data Tables: By name ; Table Names: "Customers" ; Stream: Off ; Prompt Template Name: "t"');
  const [s] = parsed(store, text);
  assert.equal(s.stepId, 214);
  assert.equal(s.params?.ai?.sqlAction, 'query for data only');
  assert.equal(s.params?.ai?.dataTables, 'by name');
  const name = 'Perform SQL Query by Natural Language';
  assert.equal(renderScriptText([{ ...s, name, line: stepLine(name, s.params) }]).trim(), text);
});

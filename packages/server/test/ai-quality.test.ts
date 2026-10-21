import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { recordForModel, redactSecrets } from '../src/ai-output.ts';

// What came out of asking the AI panel's tools realistic questions about real solutions: answers that fit in a
// model's context, startup scripts and triggers that count as callers, totals by related fields, and no secrets.

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-quality-'));
  copyFileSync(join(fixtures, 'Charts.fmp12'), join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let id = 0;
async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; value: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  });
  const text = (await r.json()).result.content[0].text as string;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { isError: text.startsWith('{') ? false : /^(Error|No |Not )/.test(text), text, value };
}

test('secrets in script text are hidden, other literals are not', () => {
  assert.equal(redactSecrets('Set Variable [ $Password ; Value: "hunter2" ]'), 'Set Variable [ $Password ; Value: "‹hidden from AI tools›" ]');
  assert.doesNotMatch(redactSecrets('Set Variable [ $key ; Value: "AKIA' + 'ABCDEFGHIJKLMNOP" ]'), /AKIA/);
  assert.doesNotMatch(redactSecrets('Insert from URL [ $r ; "https://bob:s3cret@example.com/x" ]'), /s3cret/);
  assert.doesNotMatch(redactSecrets('cURL options: "--user bob:s3cret"'), /s3cret/);
  assert.equal(redactSecrets('If [ $result = "pass" ]'), 'If [ $result = "pass" ]');
  assert.equal(redactSecrets('Show Custom Dialog [ "Hello" ]'), 'Show Custom Dialog [ "Hello" ]');
});

test('records for a model: chosen fields, long values cut, secrets hidden', () => {
  const r = recordForModel({ recordId: 1, modId: 0, fieldData: { Name: 'Ada', SmtpPassword: 'x', IdList: 'a'.repeat(5000), Empty: '' } });
  assert.equal(r.fieldData.Name, 'Ada');
  assert.match(String(r.fieldData.SmtpPassword), /hidden/);
  assert.ok(String(r.fieldData.IdList).length < 700);
  assert.match(String(r.fieldData.IdList), /4500 more characters cut/);
  assert.deepEqual(Object.keys(recordForModel(r, ['name']).fieldData), ['Name']);
});

test('MCP: describe_database is an outline; formulas on request', { skip }, async () => {
  const outline = (await call('describe_database', {})).value;
  const congress = outline.tables.find((t: { name: string }) => t.name === 'Congress');
  assert.ok(!congress.fields.some((f: { formula?: string }) => f.formula));
  assert.match(outline.note, /pass detail/);
  const detail = (await call('describe_database', { detail: ['Congress'] })).value;
  assert.ok(detail.tables.find((t: { name: string }) => t.name === 'Congress').fields.some((f: { formula?: string }) => f.formula));
});

test('MCP: Get ( TotalRecordCount ) counts the table even with no record', { skip }, async () => {
  const r = (await call('evaluate_calculation', { layout: 'Congress', formula: 'Get ( TotalRecordCount )' })).value;
  assert.equal(r.value, '540');
  const field = (await call('evaluate_calculation', { layout: 'Congress', formula: 'Name' })).value;
  assert.match(field.note, /pass recordId/);
});

test('MCP: totals by a related field, worked out record by record', { skip }, async () => {
  const layout = 'Related records • Pie';
  const portal = (await call('get_record', { layout, recordId: 1 })).value.portalData['NW SalespersonCustomers'];
  const field = Object.keys(portal[0]).find((k) => k.endsWith('::Salesperson'))!;
  const r = await call('summarize_records', { layout, groupBy: [field] });
  assert.ok(r.value?.groups?.length, r.text);
  assert.equal(r.value.groups.reduce((n: number, g: { count: number }) => n + g.count, 0), r.value.foundCount);
});

test('MCP: search_records says when a table name is not one of the file\'s', { skip }, async () => {
  assert.match((await call('search_records', { text: 'smith', tables: ['Nope'] })).text, /Not a table of Charts: Nope.*Its tables: .*Congress/);
});

test('MCP: triggers count as callers, and items explain how they are defined', { skip }, async () => {
  { const c = await call('change_design', { changes: [{ op: 'createScript', name: 'On load', text: 'Set Variable [ $$SmtpPassword ; Value: "hunter2" ]' }] }); assert.ok(!c.isError, c.text); }
  { const c = await call('edit_layout_objects', { layout: 'Congress', triggers: [{ event: 'OnRecordLoad', script: 'On load' }] }); assert.ok(!c.isError, c.text); }
  const used = (await call('where_used', { name: 'On load', kind: 'script' })).value[0];
  assert.ok(used.usages.some((u: { where: string }) => /Layout "Congress", trigger OnRecordLoad/.test(u.where)), JSON.stringify(used));
  const overview = (await call('explain_solution', {})).text;
  assert.match(overview, /Started by triggers, menus or File Options: [^\n]*On load \(OnRecordLoad on layout Congress\)/);
  assert.doesNotMatch((await call('get_script', { script: 'On load' })).text, /hunter2/);
  assert.doesNotMatch((await call('explain_solution', { item: 'On load' })).text, /hunter2/);
  assert.doesNotMatch((await call('get_design', { scripts: ['On load'] })).text, /hunter2/);

  const calc = (await call('explain_solution', { item: 'Congress::Liberal_Composite' })).text;
  assert.match(calc, /^# field Congress::Liberal_Composite\n/);
  const sections = (await call('get_design', { sections: ['fileOptions'] })).value;
  assert.ok('fileOptions' in sections);
});

test('MCP: totals per month of a date field, in date order', { skip }, async () => {
  const r = (await call('summarize_records', { layout: 'NW Line Items', groupBy: ['Order Date'], by: 'month' })).value;
  const months = r.groups.map((g: { values: Record<string, string> }) => g.values['Order Date by month']);
  assert.ok(months.length > 1 && months.every((m: string) => /^\d{4}-\d{2}$/.test(m)), JSON.stringify(months.slice(0, 5)));
  assert.deepEqual(months, [...months].sort());
  assert.equal(r.groups.reduce((n: number, g: { count: number }) => n + g.count, 0), r.foundCount);
});

test('MCP: tables named in SQL text and scripts a web viewer page calls count as uses', { skip }, async () => {
  const c = await call('change_design', { changes: [
    { op: 'createScript', name: 'Count by SQL', text: 'Set Variable [ $n ; Value: ExecuteSQL ( "SELECT COUNT(*) FROM Grades WHERE Score > 50" ; "" ; "" ) ]' },
    { op: 'createScript', name: 'From the page', text: 'Exit Script [ Result: 1 ]' },
  ] });
  assert.ok(!c.isError, c.text);
  const grades = (await call('where_used', { name: 'Grades', kind: 'tableOccurrence' })).value[0];
  assert.ok(grades.usages.some((u: { where: string }) => u.where === 'Script "Count by SQL", line 1'), JSON.stringify(grades));
  const w = await call('edit_layout_objects', { layout: 'Grades', add: [{ kind: 'web-viewer', bounds: { top: 2, left: 2, bottom: 100, right: 200 },
    webUrl: '"data:text/html,<button onclick=\\"FileMaker.PerformScript(\'From the page\', 1)\\">Go</button>"' }] });
  assert.ok(!w.isError, w.text);
  const page = (await call('where_used', { name: 'From the page', kind: 'script' })).value[0];
  assert.ok(page.usages.some((u: { where: string }) => /Layout "Grades", .*its page/.test(u.where)), JSON.stringify(page));
  assert.match((await call('explain_solution', { item: 'From the page' })).text, /Started by: the web viewer on layout Grades/);
});

test('MCP: where_used shows the text around a use far into a long formula; search scores rank hits', { skip }, async () => {
  const filler = Array.from({ length: 40 }, (_, i) => `$v${i} = ${i}`).join(' ; ');
  const c = await call('change_design', { changes: [{ op: 'createScript', name: 'Long one', text: `Set Variable [ $x ; Value: Let ( [ ${filler} ] ; Congress::Liberal_Composite ) ]` }] });
  assert.ok(!c.isError, c.text);
  const used = (await call('where_used', { name: 'Congress::Liberal_Composite' })).value[0];
  const u = used.usages.find((x: { where: string }) => x.where.startsWith('Script "Long one"'));
  assert.ok(u, JSON.stringify(used));
  assert.match(u.text, /^….*Liberal_Composite/);

  const hits = (await call('search_records', { text: 'smith' })).value.hits as { score: number }[];
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.score > 0 && h.score <= 100), JSON.stringify(hits.map((h) => h.score)));
  assert.deepEqual(hits.map((h) => h.score), [...hits.map((h) => h.score)].sort((a, b) => b - a));
});

test('MCP: change_design previews changes in words, and hands back an undo for added things', { skip }, async () => {
  const changes = [{ op: 'createTable', name: 'Visits', fields: [{ name: 'When', type: 'date' }] }, { op: 'renameTable', table: 'Grades', name: 'Marks' }];
  const p = (await call('change_design', { changes, preview: true })).value;
  assert.deepEqual(p.lines, ['Rename table Grades to Marks', 'New table Visits: When (date)', 'New layout Visits showing records from Visits']);
  assert.ok(!(await call('describe_database', {})).text.includes('Visits'));
  const added = (await call('change_design', { changes: [changes[0]] })).value;
  assert.deepEqual(added.undo.map((u: { op: string }) => u.op), ['deleteLayout', 'deleteTable']);
  const renamed = (await call('change_design', { changes: [changes[1]] })).value;
  assert.equal(renamed.undo, undefined);
  assert.ok(!(await call('change_design', { changes: added.undo })).isError);
  assert.ok(!(await call('change_design', { changes: [{ op: 'renameTable', table: 'Marks', name: 'Grades' }] })).isError);
});

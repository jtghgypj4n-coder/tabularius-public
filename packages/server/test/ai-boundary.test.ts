// The privilege boundary of every AI surface: the MCP tools and the panel's actions (summaries, charts, dashboards,
// data cleanup, automations, explaining values, building from plain English) run strictly as the signed-in account.
// An account that sees only Democrats without their ACLU scores, and only Nancy Davolio's sales rows, can't read,
// count, total, chart, fix or automate past that: not through a script's ExecuteSQL or Evaluate, not through
// relationships, not by asking for a field it can't see. Each limit is checked against [Full Access] doing the same
// call, so it is the account's limit and not the data's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { sessionFor } from '../src/mcp.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let host: Host;
let store: Store;

const NONE = { view: false, edit: false, create: false, delete: false } as const;
const limited = (edit: boolean): PrivilegeDefinition['tables'] => ({
  Congress: { view: 'Party = "D"', edit, create: false, delete: edit, fields: { ACLU: 'none' } },
  'NW Customers': { view: true, edit: false, create: false, delete: false },
  'NW SalespersonCustomers': { view: 'Salesperson = "Nancy Davolio"', edit: false, create: false, delete: false, fields: { 'Total Sales': 'none' } },
});
const sets: PrivilegeDefinition[] = [
  // Read-only: Democrats without ACLU, Nancy's sales rows without their totals.
  { name: 'Clerk', records: NONE, tables: limited(false), layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'] },
  // The same records, but may edit and delete them.
  { name: 'Editor', records: NONE, tables: limited(true), layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'] },
];

// What a script can reach: SQL over the whole table, a field the account can't see, related records through the graph.
const PEEK = [
  'Set Variable [ $r ; Value: ExecuteSQL ( "SELECT COUNT(*) FROM Congress WHERE Party = \'R\'" ; "" ; "" ) ]',
  'Set Variable [ $all ; Value: ExecuteSQL ( "SELECT COUNT(*) FROM Congress" ; "" ; "" ) ]',
  'Set Variable [ $aclu ; Value: ExecuteSQL ( "SELECT SUM(ACLU) FROM Congress" ; "" ; "" ) ]',
  'Set Variable [ $who ; Value: ExecuteSQL ( "SELECT DISTINCT Salesperson FROM \\"NW SalespersonCustomers\\" ORDER BY 1" ; "" ; "," ) ]',
  'Set Variable [ $ev ; Value: Evaluate ( "Congress::ACLU" ) ]',
  'Go to Layout [ "NW Customers" ]',
  'Enter Find Mode [ Pause: Off ]',
  'Set Field [ NW Customers::Customer ; "==Alfreds Futterkiste" ]',
  'Perform Find []',
  'Set Variable [ $rel ; Value: Count ( NW SalespersonCustomers::Salesperson ) & ":" & Substitute ( List ( NW SalespersonCustomers::Salesperson ) ; ¶ ; "," ) ]',
  'Set Variable [ $hidden ; Value: List ( NW SalespersonCustomers::Total Sales ) ]',
  'Exit Script [ Result: JSONSetElement ( "{}" ; [ "r" ; $r ; JSONString ] ; [ "all" ; $all ; JSONString ] ; [ "aclu" ; $aclu ; JSONString ] ; [ "who" ; $who ; JSONString ] ; [ "ev" ; $ev ; JSONString ] ; [ "rel" ; $rel ; JSONString ] ; [ "hidden" ; $hidden ; JSONString ] ) ]',
].join('\n');

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-boundary-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
  store = s.host.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Peek', text: PEEK }, { op: 'createScript', name: 'Stamp', text: 'Set Field [ Congress::District ; "touched" ]' },
    { op: 'createScript', name: 'Keep', text: 'Set Variable [ $$kept ; Value: Get ( ScriptParameter ) ]' },
    { op: 'createScript', name: 'Kept', text: 'Exit Script [ Result: $$kept ]' }] as never);
  for (const set of sets) {
    store.savePrivilegeSet(set);
    store.setPassword(set.name, 'pw', set.name);
  }
  store.setPassword('Admin', 'pw');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let n = 0;
/** An MCP tool call as `account` (password "pw"). */
async function mcp(account: string, name: string, args: Record<string, unknown>): Promise<{ error: boolean; text: string; data: any }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
      authorization: 'Basic ' + btoa(`${account}:pw`),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: { database: 'Charts', ...args } } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error) }] };
  const text = result.content[0].text as string;
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { error: !!result.isError, text, data };
}

const count = (where: string) => Number((store.query(`SELECT COUNT(*) AS n FROM Congress WHERE ${where}`)[0] as { n: number }).n);
const idWhere = (where: string) => Number((store.query(`SELECT _fm_record_id AS id FROM Congress WHERE ${where} LIMIT 1`)[0] as { id: number }).id);

test('scripts an AI runs: ExecuteSQL, Evaluate and relationships see only what the account sees', { skip }, async () => {
  const admin = await mcp('Admin', 'run_script', { script: 'Peek', layout: 'Congress' });
  const clerk = await mcp('Clerk', 'run_script', { script: 'Peek', layout: 'Congress' });
  assert.equal(admin.error, false, admin.text);
  assert.equal(clerk.error, false, clerk.text);
  const a = JSON.parse(admin.data.result);
  const c = JSON.parse(clerk.data.result);
  // SQL: [Full Access] counts every party and totals ACLU; the clerk counts Democrats only and gets no ACLU.
  assert.equal(Number(a.r), count(`Party = 'R'`));
  assert.ok(Number(a.r) > 0);
  assert.equal(Number(c.r), 0);
  assert.equal(Number(a.all), count('1'));
  assert.equal(Number(c.all), count(`Party = 'D'`));
  assert.ok(Number(a.aclu) > 0);
  assert.equal(c.aclu, '');
  assert.ok(a.who.split(',').length > 1, a.who);
  assert.equal(c.who, 'Nancy Davolio');
  // A field it can't see, through Evaluate.
  assert.equal(c.ev, '');
  // Related records: only Nancy's rows, and never their hidden totals.
  const [aCount, aList] = a.rel.split(':');
  const [cCount, cList] = c.rel.split(':');
  assert.ok(Number(aCount) > Number(cCount), `${a.rel} vs ${c.rel}`);
  assert.equal(Number(cCount), cList.split(',').filter(Boolean).length);
  assert.ok(cList.split(',').filter(Boolean).every((s: string) => s === 'Nancy Davolio'), c.rel);
  assert.ok(aList.split(',').some((s: string) => s !== 'Nancy Davolio'));
  assert.equal(c.hidden.replace(/\s/g, ''), '');
});

test('$$variables a script sets through MCP stay with that account', { skip }, async () => {
  assert.equal((await mcp('Admin', 'run_script', { script: 'Keep', layout: 'Congress', parameter: 'admin only' })).error, false);
  assert.equal((await mcp('Admin', 'run_script', { script: 'Kept', layout: 'Congress' })).data.result, 'admin only');
  const clerk = await mcp('Clerk', 'run_script', { script: 'Kept', layout: 'Congress' });
  assert.equal(clerk.error, false, clerk.text);
  assert.equal(clerk.data.result ?? '', '');
});

test('an account signed in through a directory, or with a scoped token, has a session of its own', () => {
  const fake = { onClose: [] } as unknown as Host;
  const admin = sessionFor(fake, 'Charts', { account: 'Admin', password: 'pw' });
  assert.equal(sessionFor(fake, 'Charts', { account: 'admin', password: 'other' }), admin);
  assert.notEqual(sessionFor(fake, 'Charts', { account: 'admin', database: 'Charts', via: 'Staff' }), admin);
  assert.notEqual(sessionFor(fake, 'Charts', { account: 'Admin', database: 'Charts', scope: { readOnly: true } as never }), admin);
  assert.notEqual(sessionFor(fake, 'Other', { account: 'Admin', password: 'pw' }), admin);
  assert.notEqual(sessionFor(fake, 'Charts', { admin: true }), admin);
});

test('free-form formulas, SQL, design and the debugger are closed to a limited account', { skip }, async () => {
  const calls: [string, Record<string, unknown>][] = [
    ['evaluate_calculation', { layout: 'Congress', formula: 'ExecuteSQL ( "SELECT COUNT(*) FROM Congress" ; "" ; "" )' }],
    ['evaluate_calculation', { layout: 'Congress', formula: 'Congress::ACLU', recordId: idWhere(`Party = 'D'`) }],
    ['sql_query', { sql: 'SELECT COUNT(*) FROM Congress' }],
    ['explain_value', { layout: 'Congress', field: 'Liberal_Rank', recordId: idWhere(`Party = 'D'`) }],
    ['check_record', { layout: 'Congress', recordId: idWhere(`Party = 'D'`) }],
    ['lint_formulas', {}],
    ['debug_script', { script: 'Peek', layout: 'Congress' }],
    ['change_design', { changes: [{ op: 'createScript', name: 'Mine', text: 'Exit Script [ Result: 1 ]' }] }],
    ['try_design_change', { changes: [{ op: 'createScript', name: 'Mine', text: 'Exit Script [ Result: 1 ]' }] }],
  ];
  for (const [name, args] of calls) {
    const r = await mcp('Clerk', name, args);
    assert.equal(r.error, true, `${name} should be refused: ${r.text.slice(0, 200)}`);
    assert.match(r.text, /privilege|Insufficient|denied/i, name);
    // [Full Access] can (so it's the account, not the call).
    const full = await mcp('Admin', name, name === 'change_design' ? { ...args, changes: [{ op: 'createScript', name: `Mine ${n}`, text: 'Exit Script [ Result: 1 ]' }] } : args);
    assert.equal(full.error, false, `${name} as Admin: ${full.text.slice(0, 200)}`);
  }
  assert.ok(!store.schema.scripts.some((s) => s.name === 'Mine'));
});

test('summaries, charts and dashboards count and total only the records and fields the account sees', { skip }, async () => {
  const byParty = await mcp('Clerk', 'summarize_records', { layout: 'Congress', groupBy: ['Party'] });
  assert.equal(byParty.error, false, byParty.text);
  assert.deepEqual(byParty.data.groups.map((g: any) => g.values.Party), ['D']);
  const all = await mcp('Admin', 'summarize_records', { layout: 'Congress', groupBy: ['Party'] });
  assert.ok(all.data.groups.length > 1);
  // A hidden field can't be totalled, grouped on or found on.
  for (const args of [
    { layout: 'Congress', measures: [{ fn: 'sum', field: 'ACLU' }] },
    { layout: 'Congress', groupBy: ['ACLU'] },
    { layout: 'Congress', query: [{ ACLU: '>0' }] },
    { layout: 'NW Customers', measures: [{ fn: 'sum', field: 'NW SalespersonCustomers::Total Sales' }] },
  ]) {
    const r = await mcp('Clerk', 'summarize_records', args);
    assert.equal(r.error, true, `${JSON.stringify(args)}: ${r.text.slice(0, 300)}`);
    assert.match(r.text, /is missing/);
  }
  // Related records in a grouping: Nancy's only.
  const related = await mcp('Clerk', 'summarize_records', { layout: 'NW SalespersonCustomers', groupBy: ['Salesperson'] });
  assert.equal(related.error, false, related.text);
  assert.equal(related.data.groups.length, 1, related.text.slice(0, 300));

  // A dashboard previewed as the clerk: the same limits, widget by widget.
  const d = await mcp('Clerk', 'save_dashboard', {
    preview: true,
    name: 'Mix', widgets: [
      { title: 'Members', kind: 'number', layout: 'Congress' },
      { title: 'By party', kind: 'chart', chart: 'pie', layout: 'Congress', groupBy: ['Party'] },
      { title: 'ACLU', kind: 'number', layout: 'Congress', measure: { fn: 'sum', field: 'ACLU' } },
    ],
  });
  assert.equal(d.error, false, d.text);
  const [members, parties, aclu] = d.data.data;
  assert.equal(members.value, count(`Party = 'D'`), JSON.stringify(members));
  assert.deepEqual(parties.categories, ['D']);
  assert.match(aclu.error, /ACLU" is missing/);
  assert.equal(aclu.value, undefined);
});

test('data cleanup scans only visible records and changes nothing past the account', { skip }, async () => {
  const scan = await mcp('Clerk', 'find_data_problems', { layout: 'Congress' });
  assert.equal(scan.error, false, scan.text);
  assert.equal(scan.data.scanned, count(`Party = 'D'`));
  // A read-only account can't apply a fix, even to a record it sees.
  const d = idWhere(`Party = 'D'`);
  const state = (store.query(`SELECT State FROM Congress WHERE _fm_record_id = ${d}`)[0] as { State: string }).State;
  const fix = await mcp('Clerk', 'fix_data_problems', { layout: 'Congress', fixes: [{ field: 'State', from: state, to: 'Zz' }] });
  assert.equal(fix.error, true, fix.text);
  assert.equal(count(`State = 'Zz'`), 0);
  // An editor's fix reaches only the records it sees: a value only Republicans hold is left alone.
  const onlyR = (store.query(`SELECT State FROM Congress GROUP BY State HAVING SUM(Party = 'D') = 0 AND COUNT(*) > 0 LIMIT 1`)[0] as { State: string }).State;
  const before = count(`State = '${onlyR}'`);
  const r = await mcp('Editor', 'fix_data_problems', { layout: 'Congress', fixes: [{ field: 'State', from: onlyR, to: 'Zz' }] });
  assert.ok(r.error || r.data.changes === 0, r.text);
  assert.equal(count(`State = '${onlyR}'`), before);
  // Merging a record it can't see into one it can (which would delete the hidden one) is refused, and nothing changes.
  const rep = idWhere(`Party = 'R'`);
  const merge = await mcp('Editor', 'fix_data_problems', { layout: 'Congress', merges: [{ keep: d, remove: [rep], fill: {} }] });
  assert.equal(merge.error, true, merge.text);
  assert.equal(count(`_fm_record_id = ${rep}`), 1);
  // Filling a hidden field through a merge is refused too.
  const d2 = idWhere(`Party = 'D' AND _fm_record_id <> ${d}`);
  const fill = await mcp('Editor', 'fix_data_problems', { layout: 'Congress', merges: [{ keep: d, remove: [d2], fill: { ACLU: 1 } }] });
  assert.equal(fill.error, true, fill.text);
  assert.equal(count(`_fm_record_id = ${d2}`), 1);
});

test('automations: only [Full Access] makes them, and each runs strictly as the account it names', { skip }, async () => {
  const spec = { name: 'Stamp members', layout: 'Congress', on: 'update', fields: ['Name'], script: 'Stamp', account: 'Editor' };
  for (const name of ['list_automations', 'try_automation', 'save_automation']) {
    const r = await mcp('Editor', name, spec);
    assert.equal(r.error, true, `${name}: ${r.text.slice(0, 200)}`);
  }
  // The dry run is as the Editor: on a record it can see.
  const tried = await mcp('Admin', 'try_automation', { ...spec, test: { Name: 'Tried' } });
  assert.equal(tried.error, false, tried.text);
  const tryId = tried.data.dryRun.recordId;
  assert.equal(store.select('SELECT Party FROM Congress WHERE _fm_record_id = ?', [tryId], 1).rows[0][0], 'D', JSON.stringify(tried.data.dryRun));
  const saved = await mcp('Admin', 'save_automation', spec);
  assert.equal(saved.error, false, saved.text);
  const id = saved.data.id ?? saved.data.automation?.id;
  try {
    // A change to a record the Editor can't see doesn't set it off; one to a record it sees does.
    const rep = idWhere(`Party = 'R'`);
    const dem = idWhere(`Party = 'D'`);
    store.update('Congress', rep, { Name: 'Renamed R' }, undefined, { account: 'Admin' });
    store.update('Congress', dem, { Name: 'Renamed D' }, undefined, { account: 'Admin' });
    await host.automations!.idle(store);
    const district = (rid: number) => store.select('SELECT District FROM Congress WHERE _fm_record_id = ?', [rid], 1).rows[0][0];
    assert.notEqual(district(rep), 'touched');
    assert.equal(district(dem), 'touched');
    const runs = await mcp('Admin', 'list_automations', {});
    const mine = (runs.data.automations ?? runs.data).find((x: any) => x.id === id);
    assert.ok(JSON.stringify(mine).includes("can't view this record"), JSON.stringify(mine).slice(0, 600));
  } finally {
    await mcp('Admin', 'delete_automation', { id });
  }
});

test('"Ask about this record" reads the record and its related records only as far as the account sees', { skip }, async () => {
  const full = await mcp('Admin', 'describe_record', { layout: 'Related records • Pie', recordId: 1 });
  assert.equal(full.error, false, full.text);
  assert.equal(full.data.fields.Customer, 'Alfreds Futterkiste');
  assert.equal(full.data.fields['Total Sales'], 4273);
  const sales = full.data.related.find((g: { occurrence: string }) => g.occurrence === 'NW SalespersonCustomers');
  assert.equal(sales.match, 'NW Customers::Customer = NW SalespersonCustomers::Customer');
  assert.equal(sales.count, 4);
  // Only Nancy's row, counted as one; and no total that sums line items the account can't view.
  const clerk = await mcp('Clerk', 'describe_record', { layout: 'Related records • Pie', recordId: 1 });
  assert.equal(clerk.error, false, clerk.text);
  assert.equal(clerk.data.fields.Customer, 'Alfreds Futterkiste');
  assert.ok(!('Total Sales' in clerk.data.fields) && !clerk.data.empty.includes('Total Sales'));
  const mine = clerk.data.related.find((g: { occurrence: string }) => g.occurrence === 'NW SalespersonCustomers');
  assert.equal(mine.count, 1);
  assert.deepEqual(mine.records.map((x: { fields: { Salesperson: string } }) => x.fields.Salesperson), ['Nancy Davolio']);
  assert.doesNotMatch(clerk.text, /Janet Leverling|Margaret Peacock|Michael Suyama/);
  // A field it has no access to isn't there at all, and a record it can't view is refused.
  const own = await mcp('Clerk', 'describe_record', { layout: 'Congress', recordId: idWhere(`Party = 'D'`) });
  assert.equal(own.error, false, own.text);
  assert.ok(!('ACLU' in own.data.fields) && !own.data.empty.includes('ACLU'));
  assert.ok('ACLU' in (await mcp('Admin', 'describe_record', { layout: 'Congress', recordId: idWhere(`Party = 'D'`) })).data.fields);
  const denied = await mcp('Clerk', 'describe_record', { layout: 'Congress', recordId: idWhere(`Party = 'R'`) });
  assert.equal(denied.error, true);
  assert.match(denied.text, /Record access is denied/);
});

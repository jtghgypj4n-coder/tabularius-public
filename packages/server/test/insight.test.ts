import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { Host } from '../src/host.ts';
import { checkScript, parseScriptText } from '../src/script-check.ts';
import { scriptText } from '../../fmp12/src/index.ts';
import { docsHtml, docsSection, documentSolution } from '../src/docs.ts';
import { checkCalculation, explainItem, layoutProfile, searchSolution, solutionOverview, whereUsed } from '../src/insight.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const files = ['Charts.fmp12', 'Flicks.fmp12'];
const skip = files.every((f) => existsSync(join(fixtures, f))) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let host: Host;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-insight-'));
  for (const f of files) copyFileSync(join(fixtures, f), join(dir, f));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('overview maps tables, relationships and scripts', { skip }, () => {
  const text = solutionOverview(host.get('Charts')!);
  assert.match(text, /\*\*Congress\*\*: 540 records; 18 data, 2 calculation, 9 summary/);
  assert.match(text, /NW Line Items::Salesperson = NW Salespeople::Salesperson/);
  assert.match(text, /Started by buttons: \[btn\] Go to next layout \(/);
  assert.match(text, /Not called by other scripts, buttons[^\n]*Show Senate/);
  // Flicks pushes data into a web viewer with JavaScript: flagged as reaching outside.
  assert.match(solutionOverview(host.get('Flicks')!), /Reach outside[^\n]*\[Perform JavaScript in Web Viewer\]/);
});

test('overview\'s Security section explains what each set can do, not just its name', { skip }, () => {
  const store = host.get('Charts')!;
  store.savePrivilegeSet({
    name: 'Overview Sales',
    records: { view: true, edit: false, create: false, delete: false },
    layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
  });
  store.setPassword('overview-seller', 'seller-pw-123', 'Overview Sales');
  const text = solutionOverview(store);
  assert.match(text, /## Security\n/);
  assert.match(text, /- Overview Sales \(overview-seller\): /);
  assert.ok(!/- Overview Sales \(overview-seller\): $/m.test(text), 'a real plain-English summary follows the account list, not nothing');
  assert.doesNotMatch(text, /Privilege sets: .*Accounts: /s, 'no longer just a bare name dump');
});

test('explain one script: callers, buttons, text', { skip }, () => {
  const text = explainItem(host.get('Flicks')!, 'WV__Demo_Build_Context');
  assert.match(text, /Called by: .*WV__Demo_Run_All/);
  assert.match(text, /Run by buttons on: WV Framework - Demo/);
  assert.match(text, /```\n[\s\S]*Perform Find|Set Field/);
  assert.throws(() => explainItem(host.get('Flicks')!, 'no such thing'), /Nothing named/);
});

test('where used: scripts, fields and their relationships', { skip }, () => {
  const flicks = host.get('Flicks')!;
  const [script] = whereUsed(flicks, 'WV__Demo_Build_Context');
  assert.equal(script.target.kind, 'script');
  assert.equal(script.usages.filter((u) => u.kind === 'script').length, 3);
  assert.ok(script.usages.some((u) => u.kind === 'layout' && /button: Perform Script/.test(u.text)));

  const [id] = whereUsed(flicks, 'MOVIE::ID');
  assert.ok(id.usages.some((u) => u.kind === 'relationship' && u.text.includes('MOVIE::ID = movie.TITLE~display::id_movie')));
  assert.ok(id.usages.some((u) => u.where === 'Field MOVIE::id_active (auto-enter)'));
  assert.ok(id.usages.some((u) => u.kind === 'script' && u.text.startsWith('Set Field [ MOVIE::ID')));
  // A field's own definition is not a use of it.
  assert.ok(!whereUsed(flicks, 'MOVIE::id_active')[0].usages.some((u) => u.where.startsWith('Field MOVIE::id_active (')));
});

test('search finds names, formulas and script lines', { skip }, () => {
  const r = searchSolution(host.get('Charts')!, 'salesperson customer');
  assert.ok(r.hits.some((h) => h.kind === 'table' && h.where === 'Table NW SalespersonCustomers'));
  assert.ok(r.hits.some((h) => h.kind === 'relationship'));
  assert.equal(searchSolution(host.get('Charts')!, '').count, 0);
});

test('layout profile: values, ranges, examples', { skip }, () => {
  const p = layoutProfile(host.get('Charts')!, 'Congress');
  assert.equal(p.records, 540);
  const party = p.fields.find((f) => f.name === 'Party')!;
  assert.deepEqual([...party.values!].sort(), ['D', 'I', 'ID', 'R']);
  const econ = p.fields.find((f) => f.name === 'Liberal_Economic')!;
  assert.equal(typeof econ.max, 'number');
  assert.ok(Number(econ.min) <= Number(econ.max));
});

test('layout profile: portal fields are profiled and searchable', { skip }, () => {
  const charts = host.get('Charts')!;
  const p = layoutProfile(charts, 'Related records • Pie');
  const sales = p.fields.find((f) => f.name === 'NW SalespersonCustomers::Salesperson')!;
  assert.ok(sales.values!.includes('Robert King'));
  assert.deepEqual(p.portals[0].occurrence, 'NW SalespersonCustomers');
  const found = charts.find('Related records • Pie', { query: [{ 'NW SalespersonCustomers::Salesperson': '==Robert King' }] });
  assert.ok(found.foundCount > 0 && found.foundCount < found.totalCount);
});

test('check calculation: typos, parameters, results', { skip }, () => {
  const charts = host.get('Charts')!;
  const good = checkCalculation(charts, 'Congress', 'Upper ( Name ) & " (" & Party & ")"', 2);
  assert.equal(good.ok, true);
  assert.deepEqual(good.fields.map((f) => f.name), ['Name', 'Party']);
  assert.equal(good.results!.length, 2);
  assert.match(good.results![0].value!, /^[^a-z]+ \([A-Z]+\)$/);

  assert.match(checkCalculation(charts, 'Congress', 'Upper ( Nme )').problems[0], /did you mean "Name"/);
  assert.match(checkCalculation(charts, 'Congress', 'Lefft ( Name ; 2 )').problems[0], /no function named "Lefft".*did you mean "Left"/);
  assert.match(checkCalculation(charts, 'Congress', 'Left ( Name )').problems[0], /at least 2 parameters/);
  assert.match(checkCalculation(charts, 'Congress', 'Congress::Stat').problems[0], /did you mean "State"/);
  assert.equal(checkCalculation(charts, 'Congress', 'Let ( [ x = 1 ; y = x + 2 ] ; y )').ok, true);
  const bad = checkCalculation(charts, 'Congress', 'If ( Party = "D" ; 1');
  assert.equal(bad.ok, false);
  assert.equal(bad.error!.code, 1203);
});

test('check script: every script in the samples checks clean', { skip }, () => {
  for (const name of ['Charts', 'Flicks']) {
    const store = host.get(name)!;
    for (const script of store.schema.scripts) {
      const r = checkScript(store, scriptText(script.steps));
      assert.deepEqual(r.problems, [], `${name}: ${script.name}`);
    }
  }
});

test('check script: a draft with mistakes', { skip }, () => {
  const draft = [
    '# Democrats',
    'Go to Layout [ "Congres" ]',
    'Go to Layout [ "Congress" ]',
    'Enter Find Mode [ Pause: Off ]',
    'Set Field [ Congress::Party ; "D" ]',
    'Perform Find [ ]',
    'If [ Get ( FoundCount ) = 0 ]',
    '  Exit Script [ Result: $reslt ]',
    'Else',
    '  Set Variable [ $count ; Value: Get ( FoundCount ) ]',
    '  Set Field [ Congress::Stat ; "x" ]',
    '  Loop',
    '    Exit Loop If [ Get ( RecordNumber ) = $count',
    '      // the last record',
    '    ]',
    '    Go to Record/Request/Page [ Nxt ]',
    '  End Loop',
    'Perform Script [ “Show Senat” ; Parameter: Lefft ( Congress::Name ; 1 ) ]',
    'Send Mail [ Send via E-mail Client ]',
    'Exit Script [ Result: $count ]',
  ].join('\n');
  assert.equal(parseScriptText(draft).length, 18);
  const r = checkScript(host.get('Charts')!, draft);
  assert.equal(r.ok, false);
  const msgs = r.problems.map((p) => `${p.line}: ${p.message}`);
  assert.deepEqual(msgs, [
    '2: There is no layout named "Congres" (did you mean "Congress"?)',
    '7: If on line 7 has no End If',
    '11: "Congress" has no field named "Stat" (did you mean "State"?)',
    '16: Go to Record/Request/Page goes to First, Last, Next, Previous, or With dialog: Off ; formula',
    '18: There is no script named "Show Senat" (did you mean "Show Senate"?)',
    '18: There is no function named "Lefft" (built-in or custom) (did you mean "Left"?)',
  ]);
  assert.deepEqual(r.warnings.map((w) => w.line), [8, 19]);
  assert.match(r.warnings[1].message, /Send Mail reaches outside/);
  assert.deepEqual(r.layouts, ['Congress']);
});

test('MCP: AI tools and prompts', { skip }, async () => {
  const rpc = async (body: unknown) => (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify(body),
  })).json();
  const call = async (name: string, args: unknown) =>
    (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;

  const overview = await call('explain_solution', { database: 'Charts' });
  assert.match(overview.content[0].text, /^# Charts/);
  const used = JSON.parse((await call('where_used', { database: 'Flicks', name: 'WV__Demo_Build_Context' })).content[0].text);
  assert.equal(used[0].count, 4);
  const layout = JSON.parse((await call('describe_layout', { database: 'Charts', layout: 'Congress' })).content[0].text);
  assert.ok(layout.fields.some((f: { name: string }) => f.name === 'State'));
  assert.match(layout.findSyntax, /requests are ORed/);
  const check = JSON.parse((await call('check_calculation', { database: 'Charts', layout: 'Congress', formula: 'Upper ( Nme )' })).content[0].text);
  assert.equal(check.ok, false);
  assert.ok((await call('where_used', { database: 'Charts', name: 'nothing here' })).isError);
  const why = JSON.parse((await call('explain_value', { database: 'Charts', layout: 'Congress', field: 'Liberal_StdDev', recordId: 1 })).content[0].text);
  assert.equal(why.formula, 'StDev ( Liberal_Economic;Liberal_Foreign;Liberal_Rank )');
  assert.equal(why.references.length, 3);
  assert.equal(why.matchesStored, true);
  assert.equal(why.steps.steps.length, 3);
  const checked = JSON.parse((await call('check_record', { database: 'Charts', layout: 'Congress', recordId: 1 })).content[0].text);
  assert.equal(checked.table, 'Congress');
  assert.ok(checked.checked >= 1, JSON.stringify(checked));
  assert.ok(Array.isArray(checked.problems));
  assert.ok((await call('check_record', { database: 'Charts', layout: 'Congress', recordId: 99_999_999 })).isError);
  const portal = JSON.parse((await call('explain_related', { database: 'Charts', layout: 'Related records • Pie', recordId: 1, portal: 'NW SalespersonCustomers' })).content[0].text);
  assert.equal(portal.kind, 'portal');
  assert.ok(portal.path.length >= 1);
  assert.ok(portal.path[0].match.every((m: { values: unknown[] }) => m.values.length));
  assert.equal(portal.rows.filter((r: { shown: boolean }) => r.shown).length, Math.min(portal.portal.shown, 25));
  assert.match(portal.verdict, /shows \d+ of \d+ related record/);
  const rel = await call('explain_related', { database: 'Charts', layout: 'Related records • Pie', recordId: 1, portal: 'Nope' });
  assert.ok(rel.isError);
  const stale = JSON.parse((await call('find_stale_calcs', { database: 'Charts', limit: 50 })).content[0].text);
  assert.equal(typeof stale.stale, 'number');
  assert.ok(Array.isArray(stale.fields) && Array.isArray(stale.skipped));
  assert.ok((await call('refresh_stale_calcs', { database: 'Charts', fields: [{ table: 'Nope', field: 'Nope' }] })).isError);
  assert.deepEqual(JSON.parse((await call('undo_stale_refresh', { database: 'Charts' })).content[0].text), { history: [] });
  const lint = JSON.parse((await call('lint_formulas', { database: 'Charts' })).content[0].text);
  assert.equal(typeof lint.fieldsWithWarnings, 'number');
  const script = JSON.parse((await call('check_script', { database: 'Charts', script: 'Go to Layout [ "Congress" ]\nIf [ 1 ]' })).content[0].text);
  assert.deepEqual(script.problems.map((p: { message: string }) => p.message), ['If on line 2 has no End If']);

  const prompts = (await rpc({ jsonrpc: '2.0', id: 2, method: 'prompts/list' })).result.prompts.map((p: { name: string }) => p.name);
  assert.deepEqual(prompts.sort(), ['after_converting', 'clean_up_data', 'draft_calculation', 'draft_script', 'explain_solution', 'find_in_plain_english', 'make_dashboard', 'review_security', 'suggest_rules', 'what_would_break', 'who_changed']);
  const prompt = (await rpc({
    jsonrpc: '2.0', id: 3, method: 'prompts/get',
    params: { name: 'find_in_plain_english', arguments: { database: 'Charts', request: 'Democrats from Ohio' } },
  })).result;
  assert.match(prompt.messages[0].content.text, /Democrats from Ohio[\s\S]*describe_layout/);
  const review = (await rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'review_security', arguments: { database: 'Charts' } } })).result;
  assert.match(review.messages[0].content.text, /"Charts"[\s\S]*get_security/);
  const who = (await rpc({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'who_changed', arguments: { database: 'Charts', question: 'who changed record 3?' } } })).result;
  assert.match(who.messages[0].content.text, /who changed record 3\?[\s\S]*audit_log[\s\S]*design_history/);
});

test('documentation: tables, layouts, scripts and what calls what, as Markdown and HTML', { skip }, async () => {
  const md = documentSolution(host.get('Charts')!);
  assert.match(md, /^# Charts\n/);
  assert.match(md, /### Congress\n\n<a id="table-congress"><\/a>\n\n540 records, 29 fields/);
  assert.match(md, /\| State \| Text \|/);
  assert.match(md, /- NW Line Items → NW Salespeople: `NW Line Items::Salesperson = NW Salespeople::Salesperson`/);
  // Script names with brackets stay links.
  assert.match(md, /Buttons run: \[\\\[btn\\\] Go to next layout\]\(#script-btn-go-to-next-layout\)/);
  assert.match(md, /### \[btn\] Go to next layout\n[\s\S]*?- Started by buttons on: \[/);
  assert.match(docsSection(md, 'Relationships'), /^## Relationships\n/);
  assert.doesNotMatch(docsSection(md, 'Relationships'), /## Layouts/);
  const html = docsHtml(md, 'Charts <docs>');
  assert.match(html, /<title>Charts &lt;docs&gt;<\/title>/);
  assert.match(html, /<h2 id="tables">Tables<\/h2>/);
  assert.match(html, /<a href="#script-btn-go-to-next-layout">\[btn\] Go to next layout<\/a>/);
  assert.match(html, /<table><thead><tr><th>Field<\/th>/);
  // On the design tokens, with dark mode, and wide tables reachable by keyboard.
  assert.match(html, /--brand:/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /<a class="skip" href="#doc">/);
  assert.match(html, /<div class="table-wrap" role="region" tabindex="0" aria-label="[^"]+"><table>/);
  assert.doesNotMatch(docsHtml('# x\n\n<script>alert(1)</script>\n', 'x'), /<script>/);

  // Over REST, for design access only, with an introduction put first; and as an MCP tool.
  const store = host.get('Charts')!;
  store.setPassword('Admin', 'pw');
  try {
    const login = await (await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } })).json();
    const r = await fetch(`${base}/tabularius/design/v1/databases/Charts/docs?format=html`, {
      method: 'POST', headers: { authorization: `Bearer ${login.response.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ introduction: 'It charts **Congress**.' }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type')!, /text\/html/);
    assert.match(r.headers.get('content-security-policy')!, /default-src 'none'/);
    assert.match(await r.text(), /<h2 id="introduction">Introduction<\/h2>\n<p>It charts <strong>Congress<\/strong>.<\/p>/);
    assert.equal((await fetch(`${base}/tabularius/design/v1/databases/Charts/docs`)).status, 401);
  } finally {
    store.setPassword('Admin', '');
  }
  const mcp = await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'document_solution', arguments: { database: 'Charts', section: 'scripts' } } }),
  })).json();
  assert.match(mcp.result.content[0].text, /^## Scripts\n/);
});

test('where used follows design changes', async () => {
  const { createStore, Store } = await import('../../store/src/index.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-used-'));
  createStore(join(dir, 'X.sqlite'));
  const s = new Store(join(dir, 'X.sqlite'), 'X');
  s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A', type: 'number' }] }, { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' }]);
  assert.equal(whereUsed(s, 'Twice', 'customFunction')[0].count, 0);
  s.applyDesign([{ op: 'createField', table: 'T', name: 'B', kind: 'calculation', type: 'number', calculation: 'Twice ( A )' }]);
  assert.deepEqual(whereUsed(s, 'Twice', 'customFunction')[0].usages.map((u) => u.where), ['Field T::B (calculation)']);
  s.close();
  rmSync(dir, { recursive: true });
});

test('a formula\'s live preview: the record you were on first, then the first few others; errors instead of results', { skip }, async () => {
  const store = host.get('Charts')!;
  store.setPassword('Admin', 'pw');
  try {
    const login = await (await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } })).json();
    const preview = async (body: Record<string, unknown>) => (await fetch(`${base}/tabularius/design/v1/databases/Charts/preview`, {
      method: 'POST', headers: { authorization: `Bearer ${login.response.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).json();
    const r = await preview({ formula: 'Upper ( Name ) & " (" & State & ")"', table: 'Congress', layout: 'Congress', recordId: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.layout, 'Congress');
    assert.equal(r.results[0].recordId, 7);
    assert.equal(r.results.length, 5);
    const row = store.query('SELECT Name, State FROM Congress WHERE _fm_record_id = 7')[0] as { Name: string; State: string };
    assert.equal(r.results[0].value, `${row.Name.toUpperCase()} (${row.State})`);
    const bad = await preview({ formula: 'Upper ( Nmae )', table: 'Congress' });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Nmae/);
    assert.deepEqual(bad.results, []);
  } finally {
    store.setPassword('Admin', '');
  }
});

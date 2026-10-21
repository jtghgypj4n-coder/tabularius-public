// Masking on the AI, reporting and query surfaces: an account that sees a field only as a stand-in (•• ••nner) gets the
// stand-in from record reads, is told the field is masked where the schema is listed, and never gets the value from
// search, summaries, finds, SQL, OData, explain tools, cleanup or the assistant. Writes of the stand-in (or of anything)
// to the field are refused. With personal data isolation on, the stand-in is then swapped for a <PERSON_n> stand-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { forgetClasses } from '../src/pii.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
/** Every real value of the masked fields: none may reach a masked account in full. */
let names: string[];
const ranks = new Set<string>();

const requests: string[] = [];
let script: ((body: Record<string, unknown>) => unknown)[] = [];

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      // The server writes each file's conversion-guide overview in the background as it starts hosting it, at no fixed
      // moment: answered here, so it never takes an answer a test scripted for its own question.
      if (/overview at the top of a conversion guide/.test(raw)) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(text('An overview.')));
        return;
      }
      requests.push(raw);
      const next = script.shift();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(next ? next(JSON.parse(raw)) : text('(no more answers)')));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mask-surfaces-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, sqlPort: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest', 'fmxdbc', 'fmodata'] });
  store.setPassword('Admin', 'pw', full.name);
  // Name (text) and Liberal_Rank (number) are masked, ACLU is hidden, the rest is open.
  store.savePrivilegeSet({
    name: 'Masked', records: { view: false, edit: false, create: false, delete: false },
    tables: { Congress: { view: true, edit: true, create: true, delete: false, fields: { Name: 'masked', Liberal_Rank: 'masked', ACLU: 'none' } } },
    layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: ['fmmcp', 'fmrest', 'fmxdbc', 'fmodata'],
  });
  store.setPassword('maria', 'pw', 'Masked');
  names = store.query('SELECT Name FROM Congress').map((r) => String(r.Name)).filter((n) => n.includes(' '));
  for (const r of store.query('SELECT Liberal_Rank AS r FROM Congress')) ranks.add(String(r.r));
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const text = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const use = (name: string, input: unknown, id = 'call1') => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
/** The real names found in some output (full names; the stand-in keeps only the last few letters). */
const leaked = (s: string) => names.filter((n) => s.includes(n));

async function tool(name: string, args: unknown, auth = 'maria:pw'): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Basic ' + btoa(auth) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const result = body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error ?? body) }] };
  const t: string = result.content?.[0]?.text ?? '';
  let data: any;
  try { data = JSON.parse(t); } catch { data = undefined; }
  return { isError: !!result.isError, data, text: t };
}
const bonner = () => Number(store.query(`SELECT _fm_record_id AS id FROM Congress WHERE Name = 'Jo Bonner'`)[0].id);

test('the schema lists a masked field as masked and read-only, not as missing; a hidden one stays hidden', { skip }, async () => {
  const d = await tool('describe_database', { database: 'Charts' });
  assert.equal(d.isError, false, d.text);
  const fields = d.data.tables.find((t: { name: string }) => t.name === 'Congress').fields as { name: string; masked?: boolean; readOnly?: boolean }[];
  const name = fields.find((f) => f.name === 'Name')!;
  assert.deepEqual([name.masked, name.readOnly], [true, true]);
  assert.ok(fields.find((f) => f.name === 'Liberal_Rank')!.masked, 'a masked number too');
  assert.equal(fields.find((f) => f.name === 'State')!.masked, undefined);
  assert.ok(!fields.some((f) => f.name === 'ACLU'), 'the hidden field is not listed');

  // describe_layout names it, with no counts, ranges or values from the data.
  const l = await tool('describe_layout', { database: 'Charts', layout: 'Congress' });
  const profile = l.data.fields.find((f: { name: string }) => f.name === 'Name');
  assert.deepEqual(profile, { name: 'Name', type: 'text', kind: 'data', masked: true });
  const rank = l.data.fields.find((f: { name: string }) => f.name === 'Liberal_Rank');
  assert.deepEqual(Object.keys(rank).sort(), ['kind', 'masked', 'name', 'type']);
  assert.ok(!l.data.fields.some((f: { name: string }) => f.name === 'ACLU'));
  assert.deepEqual(leaked(l.text), []);
});

test('record reads give the stand-in, never the value', { skip }, async () => {
  const id = bonner();
  const found = await tool('find_records', { database: 'Charts', layout: 'Congress', limit: 1000 });
  assert.equal(found.isError, false, found.text);
  const r1 = found.data.records.find((r: { recordId: number }) => r.recordId === id);
  assert.equal(r1.fieldData.Name, '•• ••nner');
  assert.deepEqual(leaked(found.text), [], 'no real name in 540 records');
  const got = await tool('get_record', { database: 'Charts', layout: 'Congress', recordId: id });
  assert.equal(got.data.fieldData.Name, '•• ••nner');
  assert.match(String(got.data.fieldData.Liberal_Rank), /^••/);
  // The administrator sees the value.
  assert.equal((await tool('get_record', { database: 'Charts', layout: 'Congress', recordId: id }, 'Admin:pw')).data.fieldData.Name, 'Jo Bonner');

  // describe_record shows it too, and says which fields are stand-ins.
  const ctx = await tool('describe_record', { database: 'Charts', layout: 'Congress', recordId: id });
  assert.equal(ctx.isError, false, ctx.text);
  assert.equal(ctx.data.fields.Name, '•• ••nner');
  assert.deepEqual(ctx.data.masked, ['Name', 'Liberal_Rank']);
  assert.deepEqual(leaked(ctx.text), []);
  assert.ok(!('ACLU' in ctx.data.fields));
});

test('search, finds, sorts, summaries and dashboards cannot reach a masked field', { skip }, async () => {
  const search = await tool('search_records', { database: 'Charts', text: 'Bonner' });
  assert.deepEqual(search.data.hits, [], 'a masked field is not searched');
  assert.ok((await tool('search_records', { database: 'Charts', text: 'Bonner' }, 'Admin:pw')).data.hits.length > 0, 'though it is there');
  for (const [what, args] of [
    ['find on', { query: [{ Name: 'Jo Bonner' }] }],
    ['find on the stand-in', { query: [{ Name: '==•• ••nner' }] }],
    ['wildcard find on', { query: [{ Name: 'Jo*' }] }],
    ['sort by', { sort: [{ fieldName: 'Name' }] }],
    ['find on a masked number', { query: [{ Liberal_Rank: '292' }] }],
  ] as const) {
    const r = await tool('find_records', { database: 'Charts', layout: 'Congress', ...args });
    assert.equal(r.isError, true, `${what} a masked field: ${r.text.slice(0, 200)}`);
    assert.deepEqual(leaked(r.text), []);
  }
  for (const args of [{ groupBy: ['Name'] }, { groupBy: ['Party'], measures: [{ field: 'Liberal_Rank', fn: 'sum' }] }, { measures: [{ field: 'Liberal_Rank', fn: 'max' }] }]) {
    const r = await tool('summarize_records', { database: 'Charts', layout: 'Congress', ...args });
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  assert.equal((await tool('summarize_records', { database: 'Charts', layout: 'Congress', groupBy: ['Party'] })).isError, false, 'the open fields still summarize');
  const board = await tool('save_dashboard', { database: 'Charts', name: 'x', preview: true, widgets: [
    { title: 't', kind: 'chart', chart: 'bar', layout: 'Congress', groupBy: ['Name'] }] });
  assert.match(board.data.data[0].error, /Field "Name" is missing/, 'the widget fails, with nothing worked out');
});

test('tools that read the whole file are not available to an account with a masked field', { skip }, async () => {
  const id = bonner();
  for (const [name, args] of [
    ['sql_query', { sql: "SELECT Name FROM Congress WHERE State = 'Alabama'" }],
    ['evaluate_calculation', { layout: 'Congress', formula: 'Congress::Name', recordId: id }],
    ['check_calculation', { layout: 'Congress', formula: 'Congress::Name' }],
    ['explain_value', { layout: 'Congress', field: 'Name', recordId: id }],
    ['check_record', { layout: 'Congress', recordId: id }],
    ['explain_related', { layout: 'Congress', recordId: id, field: 'Congress::Name' }],
    ['audit_log', { table: 'Congress' }],
    ['explain_record_history', { table: 'Congress', recordId: id }],
    ['find_stale_calcs', {}],
    ['suggest_rules', {}],
  ] as const) {
    const r = await tool(name, { database: 'Charts', ...args });
    assert.equal(r.isError, true, `${name}: ${r.text.slice(0, 200)}`);
    assert.deepEqual(leaked(r.text), [], name);
  }
});

test('a masked field cannot be written, whatever is sent: the stand-in echoed back, a new value, or a create', { skip }, async () => {
  const id = bonner();
  const echoed = await tool('update_record', { database: 'Charts', layout: 'Congress', recordId: id, fieldData: { Name: '•• ••nner', State: 'Alabama' } });
  assert.equal(echoed.isError, true);
  assert.match(JSON.parse(echoed.text).message, /Field "Name" cannot be modified/);
  for (const fieldData of [{ Name: 'Someone Else' }, { Liberal_Rank: 1 }, { 'Liberal_Rank': '••2' }]) {
    const r = await tool('update_record', { database: 'Charts', layout: 'Congress', recordId: id, fieldData });
    assert.equal(r.isError, true, JSON.stringify(fieldData));
    assert.match(r.text, /cannot be modified/);
  }
  const made = await tool('create_record', { database: 'Charts', layout: 'Congress', fieldData: { Name: 'New Person', Party: 'I' } });
  assert.equal(made.isError, true);
  assert.equal(store.query(`SELECT Name FROM Congress WHERE _fm_record_id = ${id}`)[0].Name, 'Jo Bonner', 'nothing changed');
  assert.equal(Number(store.query(`SELECT count(*) AS n FROM Congress WHERE Name = 'New Person'`)[0].n), 0);
  // A field that isn't masked is written as before, with the masked field left out.
  const ok = await tool('update_record', { database: 'Charts', layout: 'Congress', recordId: id, fieldData: { District: 1 } });
  assert.equal(ok.isError, false, ok.text);
});

test('data cleanup works from the fields an account can see, and moves related records only by keys it can read', { skip }, async () => {
  const scan = await tool('find_data_problems', { database: 'Charts', layout: 'Congress' });
  assert.equal(scan.isError, false, scan.text);
  assert.deepEqual(scan.data.compared, [], 'names are not compared');
  assert.deepEqual(leaked(scan.text), []);
  const fix = await tool('fix_data_problems', { database: 'Charts', layout: 'Congress', dryRun: true, fixes: [{ field: 'Name', from: 'Jo Bonner', to: 'x' }] });
  assert.equal(fix.isError, true, 'a fix names a field the account can read');
  const fill = await tool('fix_data_problems', { database: 'Charts', layout: 'Congress', dryRun: true, merges: [{ keep: 1, remove: [2], fill: { Name: 'x' } }] });
  assert.equal(fill.isError, true);
});

test('the assistant\'s model gets the stand-in, and a chart by a masked field is refused', { skip }, async () => {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('maria:pw') }, body: '{}' });
  const token = (await login.json()).response.token;
  let result = '';
  let chart = '';
  script = [
    () => use('find_records', { database: 'Charts', layout: 'Congress', query: [{ State: 'Alabama' }], limit: 3 }, 'c1'),
    (b) => {
      result = String((b.messages as { content: { content: string }[] }[]).at(-1)!.content[0].content);
      return use('show_chart', { layout: 'Congress', type: 'bar', groupBy: 'Name', title: 'By name' }, 'c2');
    },
    (b) => {
      chart = String((b.messages as { content: { content: string }[] }[]).at(-1)!.content[0].content);
      return text('Done.');
    },
  ];
  requests.length = 0;
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Who represents Alabama?' }] }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.match(result, /••/, 'the model got the stand-in');
  assert.deepEqual(leaked(result), []);
  assert.match(chart, /Field \\?"Name\\?" is missing|is missing/, 'a chart by a masked field is refused');
  for (const raw of requests) assert.deepEqual(leaked(raw), [], 'no real name in any request to the model');
});

test('OData and SQL leave a masked field out; SQL is refused', { skip }, async () => {
  const auth = { authorization: 'Basic ' + btoa('maria:pw') };
  const meta = await (await fetch(`${base}/fmi/odata/v4/Charts/$metadata`, { headers: auth })).text();
  assert.match(meta, /Name="Party"/);
  assert.doesNotMatch(meta, /<Property Name="Name"/);
  assert.doesNotMatch(meta, /<Property Name="Liberal_Rank"/);
  const rows = await fetch(`${base}/fmi/odata/v4/Charts/Congress?$top=1000`, { headers: auth });
  const t = await rows.text();
  assert.equal(rows.status, 200);
  assert.deepEqual(leaked(t), []);
  assert.doesNotMatch(t, /"Name"/);
  for (const q of ['$select=Name', '$filter=Name eq \'Jo Bonner\'', '$orderby=Name']) {
    assert.equal((await fetch(`${base}/fmi/odata/v4/Charts/Congress?${q}`, { headers: auth })).status, 400, q);
  }
  const sql = await fetch(`${base}/tabularius/sql/v1/databases/Charts`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT Name FROM Congress' }) });
  assert.equal(sql.status, 401);
  assert.deepEqual(leaked(await sql.text()), []);
});

test('with personal data isolation on, the stand-in becomes a <PERSON_n> stand-in on top, and nothing turns back into the field', { skip }, async () => {
  forgetClasses(store);
  store.setPiiIsolation(true, { account: 'test' });
  try {
    const id = bonner();
    const found = await tool('find_records', { database: 'Charts', layout: 'Congress', query: [{ State: 'Alabama' }], limit: 3 });
    assert.equal(found.isError, false, found.text);
    const name = found.data.records[0].fieldData.Name as string;
    assert.match(name, /^<PERSON_\d+>$/, 'the model sees a stand-in for the privilege stand-in');
    assert.ok(!found.text.includes('••nner') && !found.text.includes('Bonner'), 'neither the value nor the privilege stand-in is in the output');
    // Giving the token back writes nothing: the field can't be modified.
    const back = await tool('update_record', { database: 'Charts', layout: 'Congress', recordId: found.data.records[0].recordId, fieldData: { Name: name } });
    assert.equal(back.isError, true);
    assert.equal(store.query(`SELECT Name FROM Congress WHERE _fm_record_id = ${id}`)[0].Name, 'Jo Bonner');
    // Nor does the token find anything by the masked field.
    const byToken = await tool('find_records', { database: 'Charts', layout: 'Congress', query: [{ Name: `==${name}` }] });
    assert.equal(byToken.isError, true);
    // The explain and search tools stay refused or empty.
    assert.equal((await tool('describe_record', { database: 'Charts', layout: 'Congress', recordId: id })).isError, true, 'refused while isolation is on');
    assert.deepEqual(leaked((await tool('describe_layout', { database: 'Charts', layout: 'Congress' })).text), []);
  } finally {
    store.setPiiIsolation(false, { account: 'test' });
  }
});

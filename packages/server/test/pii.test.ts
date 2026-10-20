// Personal data isolation: with it on, personal data reaches AI models (MCP clients and the assistant's model) only as
// stand-ins like <PERSON_3>, people see the real values, tools whose results can't be checked are refused, and each
// exchange is in the security log as counts, never values.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { classOf, fieldClasses, forgetClasses, forgetVault, maskSample, PII_TOOLS, piiPreview, PiiMasker, unmaskStream, valueKind } from '../src/pii.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
let annId: number;

// Everything personal seeded into the file: none of it may reach a model while isolation is on.
const SECRETS = ['Ann Lee', 'ann.lee@example.com', '555-123-4567', '12 Elm Street', '123-45-6789', 'called about her divorce', 'Visited with her daughter Mia', '4111 1111 1111 1111'];

let script: ((body: Record<string, unknown>) => unknown)[] = [];
const requests: string[] = [];

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
      const sent = JSON.parse(raw);
      const system = sent.system.map((b: { text: string }) => b.text).join('\n');
      if (/overview at the top of a conversion guide/.test(system)) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(text('An overview.')));
        return;
      }
      requests.push(raw);
      const next = script.shift();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(next ? next(sent) : text('(no more answers)')));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-pii-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createTable', name: 'Clients', fields: [
      { name: 'ClientID', type: 'number' }, { name: 'Full Name', type: 'text' }, { name: 'Email', type: 'text' }, { name: 'Phone', type: 'text' },
      { name: 'Street', type: 'text' }, { name: 'Status', type: 'text' }, { name: 'Notes', type: 'text' }, { name: 'Score', type: 'number' },
      { name: 'DOB', type: 'date' }, { name: 'Misc', type: 'text' }, { name: 'Ref', type: 'text' }, { name: 'Photo', type: 'container' },
      { name: 'Display', type: 'text', kind: 'calculation', calculation: 'Full Name & " (" & Status & ")"' },
      // Names that say nothing personal, over values that are: judged by what they read and hold.
      { name: 'Code', type: 'text', kind: 'calculation', calculation: 'Substitute ( Full Name ; " " ; "_" )' },
      { name: 'Sort Key', type: 'text' }, { name: 'kf_ContactName', type: 'text' }, { name: 'HIV Status', type: 'text' },
      { name: 'kf_AccountID', type: 'number' }, { name: 'Invoice Code', type: 'text' },
    ] },
    { op: 'createTable', name: 'Visits', fields: [{ name: 'ClientID', type: 'number' }, { name: 'Comment', type: 'text' }] },
    { op: 'createRelationship', left: 'Clients', right: 'Visits', predicates: [{ left: 'ClientID', right: 'ClientID' }] },
  ] as never);
  const statuses = ['Active', 'Lapsed', 'Prospect'];
  annId = store.create('Clients', { ClientID: 1, 'Full Name': 'Ann Lee', Email: 'ann.lee@example.com', Phone: '555-123-4567', Street: '12 Elm Street',
    Status: 'Active', Notes: 'She called about her divorce; SSN 123-45-6789', Score: 7, DOB: '1980-02-03', Misc: 'card 4111 1111 1111 1111', Ref: 'r1',
    'Sort Key': 'Lee Ann', 'HIV Status': 'Negative', 'Invoice Code': 'INV-0001' }).recordId;
  for (let i = 2; i <= 30; i++) {
    store.create('Clients', { ClientID: i, 'Full Name': `Person ${i}`, Email: `p${i}@example.org`, Phone: `555-200-${String(1000 + i)}`, Street: `${i} Oak Road`,
      Status: statuses[i % 3], Notes: `note ${i}`, Score: i, Misc: `p${i}@example.org`, Ref: `r${i}`,
      'Sort Key': `Person ${i}`, 'HIV Status': i % 2 ? 'Negative' : 'Positive', 'Invoice Code': `INV-${String(i).padStart(4, '0')}` });
  }
  store.create('Visits', { ClientID: 1, Comment: 'Visited with her daughter Mia' });
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: true, create: true, delete: false }, tables: {},
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'] });
  store.setPassword('Clerk', 'pw', 'Clerk');
  store.setPiiIsolation(true, { account: 'test' });
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const text = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const use = (name: string, input: unknown, id = 'call1') => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const leaks = (s: string) => SECRETS.filter((x) => s.toLowerCase().includes(x.toLowerCase()));

async function tool(name: string, args: unknown, auth = 'Admin:pw'): Promise<{ isError: boolean; data: any; text: string }> {
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

test('pii: fields are worked out from names, types and values, failing closed, and marks win', { skip }, () => {
  forgetClasses(store);
  const c = (f: string) => fieldClasses(store).get('clients')!.get(f.toLowerCase())!;
  assert.deepEqual([c('Full Name').pii, c('Full Name').kind], [true, 'PERSON']);
  assert.equal(c('Email').kind, 'EMAIL');
  assert.equal(c('Phone').kind, 'PHONE');
  assert.equal(c('Street').kind, 'ADDRESS');
  assert.equal(c('DOB').kind, 'DATE');
  assert.equal(c('Photo').kind, 'FILE');
  assert.equal(c('Notes').pii, true);
  // A value looks like an email in most records: personal whatever its name.
  assert.equal(c('Misc').kind, 'EMAIL');
  // Free text nothing shows to be safe; a calculation repeating a name.
  assert.equal(c('Ref').pii, true);
  assert.equal(c('Display').pii, true);
  // Keys, numbers and a field of a few repeated values aren't.
  assert.equal(c('ClientID').pii, false);
  assert.equal(c('Score').pii, false);
  assert.equal(c('Status').pii, false, c('Status').why);
  // A calculation reading a name is personal whatever it's called; a text "key" holding names is judged by them.
  assert.equal(c('Code').pii, true, c('Code').why);
  assert.equal(c('Sort Key').pii, true, c('Sort Key').why);
  assert.equal(c('kf_ContactName').pii, true);
  assert.equal(c('HIV Status').pii, true);
  assert.equal(c('kf_AccountID').pii, false);
  assert.equal(c('Invoice Code').pii, false, c('Invoice Code').why);
  // Through an occurrence, and a field nothing knows (fails closed).
  assert.equal(classOf(store, 'Visits', 'Comment').pii, true);
  assert.equal(classOf(store, 'Nowhere', 'Status').pii, true);
  assert.equal(classOf(store, undefined, 'No such field').pii, true);
  // An administrator's mark wins, and goes in the security log.
  store.markPiiField('Clients', 'Ref', false, { account: 'test' });
  assert.deepEqual([c('Ref').pii, c('Ref').marked], [false, true]);
  assert.ok(store.securityEvents({ kind: 'pii-field-marked' }).some((e) => e.target === 'Clients::Ref'));
  store.markPiiField('Clients', 'Ref', null);
  assert.equal(c('Ref').pii, true);
  assert.throws(() => store.markPiiField('Clients', 'Nope', true), /No field/);
});

test('pii: patterns catch emails, phones, SSNs and card numbers in free text, and not dates, times or ids', { skip }, () => {
  assert.equal(valueKind('ann.lee@example.com'), 'EMAIL');
  assert.equal(valueKind('(555) 123-4567'), 'PHONE');
  assert.equal(valueKind('+44 20 7946 0958'), 'PHONE');
  assert.equal(valueKind('123-45-6789'), 'ID');
  assert.equal(valueKind('4111 1111 1111 1111'), 'CARD');
  assert.equal(valueKind('4111 1111 1111 1112'), undefined, 'fails the card check digit');
  for (const v of ['2026-10-13', '2026-10-13 12:30:00', '12:30', '192.168.1.20', 'INV-2026-0042', '42', '3.14']) assert.equal(valueKind(v), undefined, v);
  const m = new PiiMasker(store, 'pattern-test');
  const out = m.text('Mail ann@x.io or call 555-987-6543 on 2026-10-13; card 4111 1111 1111 1111.');
  assert.match(out, /^Mail <EMAIL_\d+> or call <PHONE_\d+> on 2026-10-13; card <CARD_\d+>\.$/);
  assert.equal(m.unmask(out), 'Mail ann@x.io or call 555-987-6543 on 2026-10-13; card 4111 1111 1111 1111.');
  assert.deepEqual(m.counts, { EMAIL: 1, PHONE: 1, CARD: 1 });
  // Import samples: the kind, never the value; short numbers and yes/no kept where the header says nothing personal.
  assert.match(maskSample(m, 'bob@y.io'), /^<EMAIL_\d+>$/);
  assert.equal(maskSample(m, '42.50'), '42.50');
  assert.match(maskSample(m, 'Bob Smith'), /^<TEXT_\d+>$/);
  assert.match(maskSample(m, '42', 'Age of patient'), /^<PERSON_\d+>$/);
});

test('pii: record values, portal rows and {field, value} pairs become stand-ins, the same each time, and turn back', { skip }, () => {
  const m = new PiiMasker(store, 'Admin');
  const rec = store.get('Clients', annId, 'iso');
  const out = m.json({ records: [{ ...rec, portalData: { Visits: [{ recordId: 1, 'Visits::Comment': 'Visited with her daughter Mia' }] } }],
    explain: { field: 'Clients::Email', value: 'ann.lee@example.com', before: 'old@example.com' }, other: { fieldData: { Status: 'Ann Lee called' } } }, 'Clients');
  const s = JSON.stringify(out);
  assert.deepEqual(leaks(s), [], s);
  const r = out.records[0] as { fieldData: Record<string, unknown> };
  assert.match(String(r.fieldData['Full Name']), /^<PERSON_\d+>$/);
  assert.equal(r.fieldData.Status, 'Active');
  assert.equal(r.fieldData.Score, 7);
  // A value already given a stand-in is swapped wherever it shows up in another field's value, whatever the case.
  assert.equal(out.other.fieldData.Status, `${r.fieldData['Full Name']} called`);
  assert.equal(m.text('ANN LEE and İzmir, then ann lee.'), `${r.fieldData['Full Name']} and İzmir, then ${r.fieldData['Full Name']}.`);
  assert.equal(new PiiMasker(store, 'Admin').json({ fieldData: { 'Full Name': 'Ann Lee' } }, 'Clients').fieldData['Full Name'], r.fieldData['Full Name']);
  assert.equal(m.unmask(`Hello ${r.fieldData['Full Name']}`), 'Hello Ann Lee');
  // Another account's stand-ins are its own: it can't turn back Admin's.
  assert.equal(new PiiMasker(store, 'Clerk').unmask(String(r.fieldData['Full Name'])), r.fieldData['Full Name']);
  // The stand-ins are kept in the file where no SQL can read them.
  assert.throws(() => store.query('SELECT value FROM _fm_pii_vault'), /internal table/);
});

test('pii: long text is checked in time, and long values are swapped only whole', { skip }, () => {
  const m = new PiiMasker(store, 'long-test');
  const started = performance.now();
  m.text('x'.repeat(150_000));
  m.text('a.'.repeat(70_000) + '@');
  assert.ok(performance.now() - started < 1500, `${performance.now() - started} ms`);
  assert.match(m.text('y'.repeat(300_000)), /can't check text this long/);
  const note = `Long note ${'about things '.repeat(30)}`;
  const t = m.token(note, 'TEXT');
  assert.equal(m.text(note), t);
  assert.equal(m.text(`Before ${note} after`), `Before ${note} after`);
  // A value that reads like a stand-in's name is never swapped inside a stand-in.
  m.token('Person_1', 'TEXT');
  assert.equal(m.text('<PERSON_1> and Person_1'), `<PERSON_1> and ${m.token('Person_1', 'TEXT')}`);
  // Two letters still count where they are a whole word.
  const al = m.token('Al', 'PERSON');
  assert.equal(m.text('Hi Al, also'), `Hi ${al}, also`);
});

test('pii: a stand-in cut across two streamed pieces is turned back whole', { skip }, () => {
  const m = new PiiMasker(store, 'Admin');
  const t = m.text('Ann Lee');
  const got: string[] = [];
  const s = unmaskStream(m, (x) => got.push(x));
  s.push(`Hi ${t.slice(0, 4)}`);
  s.push(`${t.slice(4)}, and 3 < 4.`);
  s.flush();
  assert.equal(got.join(''), 'Hi Ann Lee, and 3 < 4.');
});

test('pii: MCP find_records gives stand-ins, finds by them, and writes the real value', { skip }, async () => {
  const found = await tool('find_records', { database: 'Charts', layout: 'Clients', limit: 50 });
  assert.equal(found.isError, false, found.text);
  assert.deepEqual(leaks(found.text), [], found.text);
  const ann = found.data.records.find((r: any) => r.recordId === annId);
  assert.match(ann.fieldData['Full Name'], /^<PERSON_\d+>$/);
  assert.equal(ann.fieldData.Status, 'Active');
  // The model finds by a stand-in: it is turned back before the find runs.
  const again = await tool('find_records', { database: 'Charts', layout: 'Clients', query: [{ 'Full Name': `==${ann.fieldData['Full Name']}` }] });
  assert.equal(again.isError, false, again.text);
  assert.deepEqual(again.data.records.map((r: any) => r.recordId), [annId]);
  // A whole stand-in written to a personal field is the real value in the file.
  const upd = await tool('update_record', { database: 'Charts', layout: 'Clients', recordId: annId, fieldData: { Notes: ann.fieldData['Full Name'] } });
  assert.equal(upd.isError, false, upd.text);
  assert.equal(store.get('Clients', annId).fieldData.Notes, 'Ann Lee');
  // A stand-in can't be copied into a field that isn't personal, or glued to other text, and read back.
  for (const fieldData of [{ Status: ann.fieldData['Full Name'] }, { Notes: `${ann.fieldData['Full Name']}x` }, { Notes: `Spoke to ${ann.fieldData['Full Name']}` }]) {
    const bad = await tool('update_record', { database: 'Charts', layout: 'Clients', recordId: annId, fieldData });
    assert.equal(bad.isError, true, JSON.stringify(fieldData));
  }
  assert.equal(store.get('Clients', annId).fieldData.Status, 'Active');
  // A value typed into a field that isn't personal is still swapped when it is one the account was given.
  store.update('Clients', annId, { Status: 'Ann Lee' });
  const read = await tool('get_record', { database: 'Charts', layout: 'Clients', recordId: annId });
  assert.deepEqual(leaks(read.text), [], read.text);
  assert.equal(read.data.fieldData.Status, ann.fieldData['Full Name']);
  store.update('Clients', annId, { Status: 'Active', Notes: 'She called about her divorce; SSN 123-45-6789' });
  // A personal field can't be found letter by letter.
  for (const crit of ['A*', 'Ann Lee', '==Ann*', `${ann.fieldData['Full Name']}*`]) {
    const guess = await tool('find_records', { database: 'Charts', layout: 'Clients', query: [{ 'Full Name': crit }] });
    assert.equal(guess.isError, true, crit);
    assert.match(guess.text, /holds personal data/);
  }
  // A refused write doesn't quote the record.
  const refused = await tool('update_record', { database: 'Charts', layout: 'Clients', recordId: 999999, fieldData: { Score: 1 } });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /refused this change/);
  // Another account doesn't get Admin's stand-in turned back.
  const clerk = await tool('find_records', { database: 'Charts', layout: 'Clients', query: [{ 'Full Name': `==${ann.fieldData['Full Name']}` }] }, 'Clerk:pw');
  assert.ok(clerk.isError || clerk.data.records.length === 0, clerk.text);
});

test('pii: tools whose results can\'t be checked are refused, and the log has counts, never values', { skip }, async () => {
  for (const [name, args] of [
    ['sql_query', { database: 'Charts', sql: 'SELECT "Full Name" FROM Clients' }],
    ['evaluate_calculation', { database: 'Charts', layout: 'Clients', recordId: annId, formula: 'Clients::Email' }],
    ['search_records', { database: 'Charts', text: 'Ann' }],
    ['summarize_records', { database: 'Charts', layout: 'Clients', groupBy: ['Full Name'] }],
    ['explain_record_history', { database: 'Charts', layout: 'Clients', recordId: annId }],
  ] as const) {
    const r = await tool(name, args);
    assert.equal(r.isError, true, name);
    assert.match(r.text, /Personal data isolation is on for Charts/, name);
    assert.deepEqual(leaks(r.text), [], name);
  }
  // describe_layout runs without values from the data.
  const d = await tool('describe_layout', { database: 'Charts', layout: 'Clients' });
  assert.equal(d.isError, false, d.text);
  assert.deepEqual(leaks(d.text), [], d.text);
  const events = store.securityEvents({ kind: 'ai-data-masked', limit: 200 });
  assert.ok(events.some((e) => (e.changes as { blocked?: boolean })?.blocked), 'a refused tool is logged');
  const masked = events.find((e) => /find_records/.test(String((e.changes as { via?: string })?.via)));
  assert.ok(masked && (masked.changes as { masked: Record<string, number> }).masked.PERSON > 0, JSON.stringify(masked));
  assert.deepEqual(leaks(JSON.stringify(events)), []);
  // Design and security changes are refused: a new calculation or a renamed field could show a value under a safe name.
  for (const name of ['change_design', 'edit_layout_objects', 'change_security', 'create_database', 'list_automations']) assert.ok(!PII_TOOLS.has(name), name);
  const design = await tool('change_design', { database: 'Charts', changes: [{ op: 'createField', table: 'Clients', name: 'Tag2', type: 'text', kind: 'calculation', calculation: 'Full Name' }] });
  assert.equal(design.isError, true, design.text);
  assert.match(design.text, /Personal data isolation is on/);
});

test('pii: the assistant\'s model gets stand-ins, the person gets the real values, and data-revealing tools are left out', { skip }, async () => {
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}' });
  const token = (await login.json()).response.token;
  let tools: string[] = [];
  let seen = '';
  script = [
    (b) => {
      tools = (b.tools as { name: string }[]).map((t) => t.name);
      return use('find_records', { database: 'Charts', layout: 'Clients', query: [{ ClientID: 1 }] });
    },
    (b) => {
      const last = (b.messages as { content: { content: string }[] }[]).at(-1)!.content[0].content;
      seen = /<PERSON_\d+>/.exec(last)?.[0] ?? '';
      return text(`That is ${seen}, who lives at ${/<ADDRESS_\d+>/.exec(last)?.[0]}.`);
    },
  ];
  requests.length = 0;
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Who is ann.lee@example.com? Call 555-123-4567.' }], context: { layout: 'Clients', foundSet: { query: [{ 'Full Name': 'Ann Lee' }], foundCount: 1 } } }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  // The person reads the real values; the model never got them, in any request.
  assert.equal(body.reply, 'That is Ann Lee, who lives at 12 Elm Street.');
  assert.match(seen, /^<PERSON_\d+>$/);
  for (const raw of requests) assert.deepEqual(leaks(raw), [], raw.slice(0, 2000));
  // Pictures aren't sent.
  const pic = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Make a layout like this' }], image: { mediaType: 'image/png', data: 'iVBORw0KGgo=' } }),
  });
  assert.match(JSON.stringify(await pic.json()), /pictures can't be sent/);
  for (const never of ['sql_query', 'search_records', 'summarize_records', 'show_chart', 'propose_cleanup', 'propose_dashboard', 'explain_value']) assert.ok(!tools.includes(never), never);
  assert.ok(tools.includes('find_records') || tools.length > 0);
  assert.ok(store.securityEvents({ kind: 'ai-data-masked', limit: 200 }).some((e) => (e.changes as { via?: string })?.via === 'AI assistant'));
});

test('pii: the preview shows each field\'s treatment and records as a model gets them; off sends values as before', { skip }, async () => {
  const p = piiPreview(store, 'Clients');
  assert.equal(p.on, true);
  const fields = p.tables.find((t) => t.table === 'Clients')!.fields;
  assert.equal(fields.find((f) => f.field === 'Email')!.kind, 'EMAIL');
  assert.deepEqual(leaks(JSON.stringify(p.sample)), []);
  // The preview's stand-ins aren't kept.
  assert.equal(store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_pii_vault WHERE account = ?').get('\u0001preview')!.n, 0);
  store.setPiiIsolation(false, { account: 'test' });
  try {
    const found = await tool('find_records', { database: 'Charts', layout: 'Clients', query: [{ ClientID: 1 }] });
    assert.equal(found.data.records[0].fieldData['Full Name'], 'Ann Lee');
    const sql = await tool('sql_query', { database: 'Charts', sql: 'SELECT COUNT(*) AS n FROM Clients' });
    assert.equal(sql.isError, false, sql.text);
    // Turned off, the values kept for stand-ins go.
    forgetVault(store);
    assert.equal(store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_pii_vault').get()!.n, 0);
  } finally {
    store.setPiiIsolation(true, { account: 'test' });
  }
  assert.deepEqual(store.securityEvents({ category: 'AI access', limit: 500 }).filter((e) => /^pii-isolation/.test(e.kind)).map((e) => e.kind).slice(0, 3).sort(), ['pii-isolation-off', 'pii-isolation-on', 'pii-isolation-on']);
});

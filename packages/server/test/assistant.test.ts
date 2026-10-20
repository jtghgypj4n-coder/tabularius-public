// The web client's AI assistant, against a stand-in for the Messages API.
import { pageSource } from '../../web/src/page-source.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import type { PrivilegeDefinition, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;

// Answer streamed requests as server-sent events, in pieces, as the Messages API does.
let sse = false;
function toSse(a: { content: Record<string, unknown>[]; stop_reason: string }): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const halves = (t: string) => [t.slice(0, Math.ceil(t.length / 2)), t.slice(Math.ceil(t.length / 2))];
  let out = ev('message_start', { message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } } });
  a.content.forEach((b, index) => {
    if (b.type === 'text') {
      out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const t of halves(b.text as string)) out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: t } });
    } else {
      out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      for (const j of halves(JSON.stringify(b.input))) out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: j } });
    }
    out += ev('content_block_stop', { index });
  });
  return out + ev('message_delta', { delta: { stop_reason: a.stop_reason }, usage: { output_tokens: 5 } }) + ev('message_stop', {});
}

// What the stand-in model answers, in order, and what it was sent.
let script: ((body: ModelRequest) => unknown)[] = [];
const requests: ModelRequest[] = [];
interface ModelRequest {
  /** As text (the request sends it as a cached text block). */
  system: string;
  raw: Record<string, unknown>;
  tools: { name: string }[];
  messages: { role: string; content: string | { type: string; content?: string; is_error?: boolean }[] }[];
}

const clerk: PrivilegeDefinition = {
  name: 'Clerk',
  records: { view: false, edit: false, create: false, delete: false },
  tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { ACLU: 'none' } } },
  layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'],
};

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    // The server checks the key in the background by listing models: that answer is not one of the test's.
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      assert.equal(req.headers['x-api-key'], 'test-key');
      const sent = JSON.parse(raw);
      const body = { ...sent, raw: sent, system: Array.isArray(sent.system) ? sent.system.map((b: { text: string }) => b.text).join('\n') : sent.system } as ModelRequest;
      // The server writes each file's conversion-guide overview in the background as it starts hosting it, at no
      // fixed moment: answered here, so it never takes an answer a test scripted for its own question.
      if (/overview at the top of a conversion guide/.test(body.system ?? '')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(text('An overview.')));
        return;
      }
      requests.push(body);
      const next = script.shift();
      // A failed assertion in an answer comes back as the model's error, rather than leaving the request hanging.
      let answer: unknown;
      try {
        answer = next ? next(body) : text('(no more answers)');
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: (e as Error).message } }));
        return;
      }
      if (sse && sent.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' }).end(toSse(answer as { content: Record<string, unknown>[]; stop_reason: string }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  const addr = model.address() as { port: number };
  dir = mkdtempSync(join(tmpdir(), 'tabularius-assistant-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${addr.port}` } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.savePrivilegeSet(clerk);
  store.setPassword('Admin', 'pw');
  store.setPassword('Clerk', 'pw', 'Clerk');
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const text = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const use = (name: string, input: unknown, id = 'call1') => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const lastResult = (b: ModelRequest) => {
  const c = b.messages.at(-1)!.content as { type: string; content?: string; is_error?: boolean }[];
  return c[0];
};

const sessions = new Map<string, Promise<string>>();
async function login(account: string): Promise<string> {
  const existing = sessions.get(account);
  if (existing) return existing;
  const token = (async () => {
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
    });
    return (await r.json()).response.token;
  })();
  sessions.set(account, token);
  return token;
}

const ask = async (token: string, messages: unknown[], context: unknown = {}) => {
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages, context }),
  });
  return { status: r.status, body: await r.json() };
};

test('assistant: answers with tools, as the signed-in account', { skip }, async () => {
  const token = await login('Clerk');
  const info = await (await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(info, { available: true, model: 'claude-opus-5-5', price: { input: 4, output: 20 }, fastModel: 'claude-haiku-5-5', canDesign: false, canExplainScripts: false });

  let seen = '';
  script = [
    () => use('describe_layout', { database: 'SomethingElse', layout: 'Congress' }),
    (b) => {
      seen = lastResult(b).content!;
      return text('Only Democrats are visible to you.');
    },
  ];
  requests.length = 0;
  const r = await ask(token, [{ role: 'user', content: 'Which parties are there?' }], { layout: 'Congress', recordId: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reply, 'Only Democrats are visible to you.');
  assert.deepEqual(r.body.tools, ['describe_layout']);
  assert.deepEqual(r.body.proposals, []);
  // The tool ran in this file (whatever the model named) with Clerk's privileges.
  const profile = JSON.parse(seen);
  assert.deepEqual(profile.fields.find((f: { name: string }) => f.name === 'Party').values, ['D']);
  assert.ok(!profile.fields.some((f: { name: string }) => f.name === 'ACLU'));
  // Context reaches the model; write and script tools are never offered.
  assert.match(requests[0].system, /"Charts" as "Clerk" \(privilege set "Clerk"\), on layout "Congress", looking at record 3/);
  // The field the cursor is in, when the window sends one.
  script = [() => text('ok')];
  requests.length = 0;
  await ask(token, [{ role: 'user', content: 'Explain this field' }], { layout: 'Congress', recordId: 3, field: 'State', mode: 'browse' });
  assert.match(requests[0].system, /looking at record 3, with the cursor in the field "State" \("this field"\)/);
  const names = requests[0].tools.map((t) => t.name);
  for (const never of ['run_script', 'create_record', 'update_record', 'delete_record', 'change_design', 'propose_design_change', 'propose_restyle', 'propose_layout', 'propose_page', 'review_graph', 'get_design', 'audit_log', 'design_history', 'get_security', 'propose_automation', 'try_automation', 'explain_value', 'evaluate_calculation', 'sql_query', 'draft_connection', 'list_connections']) {
    assert.ok(!names.includes(never), never);
  }
  assert.ok(names.includes('check_calculation') && names.includes('find_records'));
});

test('assistant: charts are worked out from the data the account may see', { skip }, async () => {
  const token = await login('Clerk');
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'show_chart'));
      return use('show_chart', { layout: 'Congress', groupBy: 'Party', type: 'pie', title: 'Members by party' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /^Shown:/);
      return use('show_chart', { layout: 'Congress', groupBy: 'No Such Field', type: 'column', title: 'x' });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      return text('Here is the chart.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Chart members by party' }], { layout: 'Congress', mode: 'browse' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.charts.length, 1);
  const [chart] = r.body.charts;
  assert.equal(chart.type, 'pie');
  assert.equal(chart.title, 'Members by party');
  // Clerk sees only Democrats (its record access), so the chart has one slice, counted from the data.
  assert.deepEqual(chart.categories, ['D']);
  assert.equal(chart.series[0].name, 'Count');
  assert.ok(chart.series[0].values[0] > 0);
});

test('assistant: a dashboard built from a description is worked out as the account, and saved only by the person', { skip }, async () => {
  const token = await login('Clerk');
  const widgets = [
    { title: 'Members', kind: 'number', layout: 'Congress' },
    { title: 'By party', kind: 'chart', chart: 'pie', layout: 'Congress', groupBy: ['Party'] },
  ];
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'propose_dashboard'));
      assert.ok(!b.tools.some((t) => t.name === 'save_dashboard'), 'the assistant never saves by itself');
      return use('propose_dashboard', { name: 'Party mix', widgets: [{ ...widgets[1], groupBy: ['No Such Field'] }] });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /No Such Field/);
      return use('propose_dashboard', { name: 'Party mix', widgets });
    },
    (b) => {
      assert.match(lastResult(b).content!, /^Shown with a Save button; not saved yet/);
      return text('Here it is.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Make a dashboard of members by party' }], { mode: 'browse' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dashboards.length, 1);
  const [d] = r.body.dashboards;
  assert.equal(d.name, 'Party mix');
  // Clerk sees Democrats only.
  assert.deepEqual(d.data[1].categories, ['D']);
  assert.equal(d.data[0].value, d.data[1].series[0].values[0]);
  const list = await fetch(`${base}/tabularius/dashboards/v1/databases/Charts`, { headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual((await list.json()).dashboards, []);
});

test('assistant: data problems are found as the account and shown to tick, with nothing changed', { skip }, async () => {
  const token = await login('Clerk');
  const before = store.auditLog({}).length;
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'propose_cleanup'));
      assert.ok(!b.tools.some((t) => t.name === 'fix_data_problems'), 'the assistant never changes records');
      return use('propose_cleanup', { layout: 'Congress', checks: ['duplicates', 'phones'], summary: 'Duplicate members' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /^Shown to the person with checkboxes and an Apply button; nothing has changed\. Scanned \d+ records/);
      return text('Here is what I found.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Find duplicate members' }], { mode: 'browse' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [c] = r.body.cleanups;
  assert.equal(c.summary, 'Duplicate members');
  assert.equal(c.scan.layout, 'Congress');
  // Clerk sees Democrats only, so only their records were scanned.
  assert.equal(c.scan.scanned, store.find('Congress', { query: [{ Party: '==D' }], limit: 0 }).foundCount);
  assert.equal(store.auditLog({}).length, before);
});

test('assistant: a task of several steps comes back as a plan to run, checked as the account, with nothing run', { skip }, async () => {
  const token = await login('Clerk');
  const before = store.auditLog({}).length;
  script = [
    () => use('propose_plan', { summary: 'Retire the members', layout: 'Congress', steps: [{ kind: 'find', query: [{ Party: 'D' }] }, { kind: 'set', field: 'Colour', value: 'x' }] }),
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /Step 2: no field "Colour"/);
      return use('propose_plan', { summary: 'Retire the members', layout: 'congress', steps: [{ kind: 'find', query: [{ Party: 'D' }], why: 'Democrats' }, { kind: 'set', field: 'party', value: 'X' }] }, 'call2');
    },
    (b) => {
      const content = lastResult(b).content!;
      assert.match(content, /^Shown to the person with a Dry run button and a Run button for each step; nothing has run\. The plan, starting on Congress: 1\. Find records on Congress: Party D 2\. Set Party to "X"/);
      return text('Here is the plan.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Mark the Democrats as X' }], { mode: 'browse' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [p] = r.body.plans;
  assert.equal(p.plan.layout, 'Congress');
  assert.equal(p.plan.steps[1].field, 'Party');
  assert.equal(p.lines.length, 2);
  assert.equal(store.auditLog({}).length, before);
});

test('assistant: [Full Access] can ask who changed a record', { skip }, async () => {
  const token = await login('Admin');
  let seen = '';
  script = [
    () => use('audit_log', { table: 'Congress', limit: 5 }),
    (b) => {
      assert.equal(lastResult(b).is_error, undefined);
      seen = lastResult(b).content!;
      return text('Nobody has changed it here yet.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Who changed record 3?' }]);
  assert.equal(r.body.reply, 'Nobody has changed it here yet.');
  assert.ok(Array.isArray(JSON.parse(seen)) || typeof JSON.parse(seen) === 'object');
});

test('assistant: [Full Access] can have it draft a connection, and the keys are never its to see', { skip }, async () => {
  const token = await login('Admin');
  const KEY = 'AKIAIOSFODNN7EXAMPLE';
  let said = '';
  script = [
    (b) => {
      assert.match(b.system, /call draft_connection .*Never ask for, accept or make up an access key/s);
      assert.ok(b.tools.some((t) => t.name === 'draft_connection'));
      return use('draft_connection', { name: 'invoices-bucket', type: 's3', config: { bucket: 'acme-invoices', region: 'us-east-1' } });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, undefined, lastResult(b).content);
      said = lastResult(b).content!;
      // Offered a key in the same breath, the model puts it in a setting: refused, nothing made.
      return use('draft_connection', { name: 'leaky', type: 's3', config: { bucket: 'acme-invoices', prefix: KEY } }, 'call2');
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /looks like an AWS access key/);
      return text('Open Connections in the admin console, type the keys there and approve it.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Set up an S3 connection to our acme-invoices bucket' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tools, ['draft_connection', 'draft_connection']);
  assert.match(said, /"status":"draft"/);
  assert.equal(JSON.stringify(r.body).includes(KEY), false);
  const made = (await fetch(`${base}/tabularius/admin/v1/connections`, { headers: { 'x-tabularius-console': '1' } }).then((x) => x.json())).connections;
  assert.deepEqual(made.map((c: { name: string; status: string; createdBy: string }) => [c.name, c.status, c.createdBy]), [['invoices-bucket', 'draft', 'ai']]);
});

test('assistant: [Full Access] can review security in Manage Security, never seeing passwords', { skip }, async () => {
  const token = await login('Admin');
  let seen = '';
  script = [
    (b) => {
      assert.match(b.system, /in Manage Security\. .*In Manage Security they have the "Privilege sets" tab open, with privilege set "Clerk" selected/s);
      assert.match(b.system, /read accounts and privilege sets with get_security/);
      assert.ok(!b.tools.some((t) => t.name === 'show_records'), 'no found sets in Manage Security');
      return use('get_security', {});
    },
    (b) => {
      assert.equal(lastResult(b).is_error, undefined);
      seen = lastResult(b).content!;
      return text('Clerk can only view Congress.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Review security' }],
    { mode: 'security', security: { tab: 'Privilege sets', selection: [{ kind: 'privilege set', name: 'Clerk' }] } });
  assert.equal(r.body.reply, 'Clerk can only view Congress.');
  const got = JSON.parse(seen);
  assert.ok(got.accounts.some((a: { name: string }) => a.name === 'Clerk'));
  assert.ok(got.privilegeSets.some((p: { name: string }) => p.name === 'Clerk'));
  assert.ok(Array.isArray(got.importApproximations), 'says which imported sets only approximate FileMaker');
  assert.doesNotMatch(seen, /password_?hash|"secret"|"id":\s*"/i);
});

test('assistant: design changes come back as proposals for [Full Access]', { skip }, async () => {
  const token = await login('Admin');
  const change = { op: 'createField', table: 'Congress', name: 'Notes', type: 'text' };
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'propose_design_change'));
      // [Full Access] can also ask who changed what.
      assert.ok(b.tools.some((t) => t.name === 'audit_log') && b.tools.some((t) => t.name === 'design_history'));
      // A change that would not apply comes back as an error, and is never shown.
      return use('propose_design_change', { summary: 'Broken', changes: [{ op: 'createField', table: 'No Such Table', name: 'X', type: 'text' }] });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /would not apply/);
      return use('propose_design_change', { summary: 'Add a Notes field', changes: [change] });
    },
    (b) => {
      assert.match(lastResult(b).content!, /Nothing has changed yet/);
      return text('I proposed a Notes field.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Add a notes field' }]);
  assert.equal(r.body.reply, 'I proposed a Notes field.');
  assert.deepEqual(r.body.proposals, [{ summary: 'Add a Notes field', changes: [change], preview: ['New field Congress::Notes (text)'] }]);
  assert.ok(!store.schema.tables.find((t) => t.name === 'Congress')!.fields.some((f) => f.name === 'Notes'), 'nothing applied');

  // A proposal that writes scripts runs each once on a copy with all its changes applied, offline.
  const fix = [
    { op: 'createField', table: 'Congress', name: 'Notes', type: 'text' },
    { op: 'createScript', name: 'Note everyone', text: 'Go to Layout [ "Congress" ]\nShow All Records\nSet Field [ Congress::Notes ; "checked" ]' },
    { op: 'createScript', name: 'Mail them', text: 'Send Mail [ Send via E-mail Client ; With dialog: Off ; To: "a@example.com" ]' },
  ];
  let told = '';
  script = [
    () => use('propose_design_change', { summary: 'Note everyone', changes: fix }),
    (b) => {
      told = lastResult(b).content!;
      return text('Proposed.');
    },
  ];
  const p = await ask(token, [{ role: 'user', content: 'Fix it' }]);
  assert.ok(p.body.proposals?.length, told);
  const runs = p.body.proposals[0].dryRuns;
  assert.deepEqual(runs.map((d: { script: string }) => d.script), ['Note everyone', 'Mail them']);
  assert.equal(runs[0].run.outcome, 'ok', JSON.stringify(runs[0]));
  // Mail never leaves: the step fails in the sandbox, and the proposal says so.
  assert.equal(runs[1].run.outcome, 'error');
  assert.match(runs[1].run.message, /never sends email/);
  assert.match(told, /Dry runs on a copy of the file with the changes applied[^]*"Note everyone" ran 3 steps/);
  // The person's card shows each record the run changed, field by field; the model is told only how many.
  const changed = runs[0].run.changes.records as { kind: string; fields: { field: string; after: string }[] }[];
  assert.ok(changed.length && changed.every((r) => r.kind === 'update' && r.fields.some((f) => f.field === 'Notes' && f.after === 'checked')), JSON.stringify(changed).slice(0, 300));
  assert.match(told, /"Note everyone" ran 3 steps[^;]*; it changed \d+ records?/);
  assert.ok(!store.schema.scripts.some((x) => x.name === 'Note everyone'));
  assert.ok(!store.schema.tables.find((t) => t.name === 'Congress')!.fields.some((f) => f.name === 'Notes'), 'still nothing applied');
});

test('assistant: restyling a layout comes back as a before-and-after proposal', { skip }, async () => {
  const token = await login('Admin');
  const [target, like] = store.schema.layouts.filter((l) => store.design(l.id)?.objects.length).map((l) => l.name);
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'propose_restyle') && b.tools.some((t) => t.name === 'review_graph'));
      return use('propose_restyle', { layout: target, like: 'No such layout' });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      return use('propose_restyle', { layout: target, like, summary: `Make ${target} look like ${like}` });
    },
    (b) => {
      assert.match(lastResult(b).content!, /before-and-after and an Apply button. Nothing has changed yet/);
      return text('Proposed.');
    },
  ];
  const before = JSON.stringify(store.design(target));
  const r = await ask(token, [{ role: 'user', content: `Make ${target} look like ${like}` }], { mode: 'design' });
  const p = r.body.proposals[0];
  assert.equal(p.summary, `Make ${target} look like ${like}`);
  assert.equal(p.changes[0].op, 'updateLayout');
  assert.equal(p.layouts[0].name, target);
  assert.ok(p.layouts[0].before, 'drawn before and after');
  assert.equal(JSON.stringify(store.design(target)), before, 'nothing applied');
});

test('assistant: a new layout is drafted to match the file and comes back as a picture to check', { skip }, async () => {
  const token = await login('Admin');
  const to = store.schema.tableOccurrences.find((o) => !o.dataSourceId && store.schema.tables.find((t) => t.id === o.baseTableId)?.fields.some((f) => f.type === 'number' && f.kind === 'normal'))!;
  const table = store.schema.tables.find((t) => t.id === to.baseTableId)!;
  const number = table.fields.find((f) => f.type === 'number' && f.kind === 'normal')!;
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'propose_layout'));
      assert.match(b.system, /call propose_layout/);
      return use('propose_layout', { name: 'Drafted list', occurrence: to.name, fields: ['No such field'] });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /has no field "No such field"/);
      return use('propose_layout', { name: 'Drafted list', occurrence: to.name, totals: [number.name], summary: 'A list with a total' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /picture with an Apply button. Nothing has changed yet. How it matches the file: /);
      return text('Proposed.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Make a list layout with totals' }], { mode: 'design' });
  const p = r.body.proposals?.[0];
  assert.ok(p, JSON.stringify(r.body).slice(0, 1500));
  assert.equal(p.summary, 'A list with a total');
  assert.deepEqual(p.changes.map((c: { op: string }) => c.op), ['createField', 'createLayout']);
  assert.equal(p.layouts[0].name, 'Drafted list');
  assert.ok(p.layouts[0].design.parts.some((x: { kind: string }) => x.kind === 'trailing-grand-summary'));
  assert.ok(!store.schema.layouts.some((l) => l.name === 'Drafted list'), 'nothing applied');
});

test('assistant: a modern layout is a page it writes, kept in a web viewer filling the window, shown before anything changes', { skip }, async () => {
  const token = await login('Admin');
  const to = store.schema.tableOccurrences.find((o) => !o.dataSourceId)!;
  const page = '<!doctype html><html><body><h1>Sales</h1><script>if (window.tabularius) tabularius.records("Congress", { limit: 5 })</script></body></html>';
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'propose_page'));
      assert.match(b.system, /call propose_page/);
      return use('propose_page', { name: 'Sales home', occurrence: to.name, html: '<script src="https://cdn.example.com/x.js"></script>' });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /loads something from the network/);
      return use('propose_page', { layout: 'Congress', html: page });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /"Congress" is not a modern layout/);
      return use('propose_page', { name: 'Sales home', occurrence: to.name, html: page, summary: 'A sales home page' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /Apply button. Nothing has changed yet. A modern layout/);
      return text('Proposed.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Make an eye-catching sales dashboard' }], { mode: 'design' });
  const p = r.body.proposals?.[0];
  assert.ok(p, JSON.stringify(r.body).slice(0, 1500));
  assert.equal(p.summary, 'A sales home page');
  assert.equal(p.changes.length, 1);
  const [made] = p.changes;
  assert.equal(made.op, 'createLayout');
  const viewer = made.design.objects[0];
  assert.equal(viewer.kind, 'web-viewer');
  assert.equal(viewer.webOptions.jsBridge, true);
  assert.equal(pageSource(viewer.webUrl), page);
  assert.ok(!store.schema.layouts.some((l) => l.name === 'Sales home'), 'nothing applied');
});

test('assistant: the Data Viewer drafts expressions from the window\'s layout, checked like a formula box', { skip }, async () => {
  const token = await login('Admin');
  script = [
    (b) => {
      assert.match(b.system, /in the Data Viewer/);
      assert.match(b.system, /formula box of calculation "Data Viewer expression" open/);
      assert.ok(b.tools.some((t) => t.name === 'offer_draft') && !b.tools.some((t) => t.name === 'show_records'));
      // Unqualified names are fields of the layout's table: a misspelt one comes back to fix.
      return use('offer_draft', { text: 'Nmae', summary: 'x' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /"Nmae" is not a field of Congress/);
      return use('offer_draft', { text: 'Name & " (" & Party & ")"', summary: 'Name and party' });
    },
    () => text('Here it is.'),
  ];
  const r = await ask(token, [{ role: 'user', content: 'Draft an expression' }],
    { mode: 'viewer', layout: 'Congress', recordId: 3, draft: { kind: 'calculation', for: 'Data Viewer expression' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { samples, ...drafted } = r.body.drafts[0];
  assert.deepEqual(drafted, { kind: 'calculation', text: 'Name & " (" & Party & ")"', summary: 'Name and party' });
  // Evaluated on the window's record first, then the next records of its layout.
  assert.equal(samples.layout, 'Congress');
  assert.equal(samples.results[0].recordId, 3);
  assert.equal(samples.results.length, 5);
  const three = store.evaluate('Congress', 'Name & " (" & Party & ")"', 3).value;
  assert.equal(samples.results[0].value, three);
});

test('assistant: drafts for the open formula box or script editor are checked, and come back to put in it', { skip }, async () => {
  const token = await login('Admin');
  const congress = store.schema.tableOccurrences.find((t) => t.name === 'Congress')!.id;
  const calc = { kind: 'calculation', for: 'Congress::Label', contextTo: congress };
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'offer_draft'));
      assert.match(b.system, /formula box of calculation "Congress::Label" open/);
      // Unqualified names are the context table's fields: a misspelt one comes back to fix.
      return use('offer_draft', { text: 'Nmae & " (" & Party & ")"', summary: 'Name and party' });
    },
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      assert.match(lastResult(b).content!, /"Nmae" is not a field of Congress/);
      return use('offer_draft', { text: 'Name & " (" & Party & ")"', summary: 'Name and party' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /Nothing is saved yet/);
      // The results on sample records go back to the model too, to fix a formula that works out wrong.
      assert.match(lastResult(b).content!, /Evaluated on 5 records of layout "Congress"/);
      return text('Here it is.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Draft the formula' }], { mode: 'design', draft: calc });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { samples, ...calcDraft } = r.body.drafts[0];
  assert.deepEqual(calcDraft, { kind: 'calculation', text: 'Name & " (" & Party & ")"', summary: 'Name and party' });
  assert.equal(samples.layout, 'Congress');
  assert.ok(samples.results.every((x: { value?: string }) => / \(.+\)$/.test(x.value ?? '')), JSON.stringify(samples));
  assert.deepEqual(r.body.proposals, []);

  // Scripts are checked like check_script does.
  script = [
    () => use('offer_draft', { text: 'Go to Layout [ "No Such Layout" ]', summary: 'x' }),
    (b) => {
      assert.match(lastResult(b).content!, /Line 1 \(Go to Layout\): There is no layout named "No Such Layout"/);
      return use('offer_draft', { text: 'Go to Layout [ "Congress" ]\nShow All Records', summary: 'Show everyone' });
    },
    () => text('done'),
  ];
  const s = await ask(token, [{ role: 'user', content: 'Draft it' }], { mode: 'design', draft: { kind: 'script', for: 'Everyone' } });
  const { dryRun, ...drafted } = s.body.drafts[0];
  assert.deepEqual(drafted, { kind: 'script', text: 'Go to Layout [ "Congress" ]\nShow All Records', summary: 'Show everyone' });
  assert.equal(dryRun.outcome, 'ok', JSON.stringify(dryRun));
  assert.equal(dryRun.steps, 2);
  assert.ok(!store.schema.scripts.some((x) => x.name === 'Everyone'), 'the draft is not saved to the live file');

  // The dry run is on a copy: a script that deletes every record leaves the live file alone; an endless loop is caught.
  const before = store.select('SELECT count(*) FROM "Congress"').rows[0][0];
  let told = '';
  script = [
    () => use('offer_draft', { text: 'Go to Layout [ "Congress" ]\nShow All Records\nDelete All Records [ With dialog: Off ]', summary: 'Delete everyone' }),
    (b) => {
      told = lastResult(b).content!;
      return use('offer_draft', { text: 'Loop\nEnd Loop', summary: 'Forever' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /stopped after \d+ steps .*loop/);
      // The linter's findings go to the model, to fix before offering it again.
      assert.match(lastResult(b).content!, /The script linter found: line 1 \(error\)/);
      return text('done');
    },
  ];
  const d = await ask(token, [{ role: 'user', content: 'Draft it' }], { mode: 'design', draft: { kind: 'script', for: 'Everyone' } });
  assert.match(told, /dry run on a copy of the file \(offline; its changes thrown away\): ran 3 steps/);
  assert.equal(d.body.drafts[0].dryRun.outcome, 'ok');
  assert.equal(d.body.drafts[1].dryRun.outcome, 'stalled');
  // The person sees each record the run deleted on the copy, with its values; the model is told only how many.
  const deleted = d.body.drafts[0].dryRun.changes.records as { kind: string; fields: { field: string; before: string }[] }[];
  assert.ok(deleted.length > 0 && deleted.every((x) => x.kind === 'delete'), JSON.stringify(deleted).slice(0, 300));
  const someName = deleted[0].fields.find((x) => x.field === 'Name')!.before;
  assert.ok(someName);
  assert.match(told, /it deleted \d+ records/);
  assert.ok(!told.includes(someName), 'no record values go to the model');
  assert.ok(d.body.drafts[1].lint.some((i: { rule: string }) => i.rule === 'loop-no-exit'), JSON.stringify(d.body.drafts[1].lint));
  assert.equal(d.body.drafts[0].lint, undefined);

  // A custom error's message is worked out from the records (here a name), so the model isn't told it; the person is.
  let custom = '';
  script = [
    () => use('offer_draft', { text: 'Go to Layout [ "Congress" ]\nShow All Records\nOpen Transaction\nRevert Transaction [ Condition: 1 ; Error code: 5001 ; Error message: Congress::Name ]\nCommit Transaction', summary: 'Probe' }),
    (b) => {
      custom = lastResult(b).content!;
      return text('done');
    },
  ];
  const e = await ask(token, [{ role: 'user', content: 'Draft it' }], { mode: 'design', draft: { kind: 'script', for: 'Everyone' } });
  const quoted = e.body.drafts[0].dryRun.message as string;
  assert.equal(e.body.drafts[0].dryRun.error, 5001, JSON.stringify(e.body.drafts[0].dryRun));
  assert.ok(quoted);
  assert.match(custom, /ended with error 5001/);
  assert.ok(!custom.includes(quoted), custom);
  assert.equal(store.select('SELECT count(*) FROM "Congress"').rows[0][0], before);

  // Custom functions: the body sees its parameters, and fields only as Occurrence::Field.
  store.applyDesign([{ op: 'createCustomFunction', name: 'Initials', parameters: [], formula: '""' }]);
  script = [
    (b) => {
      assert.match(b.system, /custom function editor of custom function "Initials" open/);
      return use('offer_draft', { text: 'Left ( first ; 1 ) & Left ( lsat ; 1 )', parameters: ['first', 'last'], summary: 'x' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /"lsat"/);
      return use('offer_draft', { text: 'Left ( first ; 1 ) & Left ( last ; 1 ) // initials', parameters: ['first', 'last'], summary: 'Initials of a name' });
    },
    () => text('done'),
  ];
  const f = await ask(token, [{ role: 'user', content: 'Draft it' }], { mode: 'design', draft: { kind: 'function', for: 'Initials' } });
  assert.deepEqual(f.body.drafts, [{ kind: 'function', text: 'Left ( first ; 1 ) & Left ( last ; 1 ) // initials', parameters: ['first', 'last'], summary: 'Initials of a name' }]);

  // Only in design mode, for [Full Access], with a well-formed target.
  for (const [who, context] of [['Admin', { draft: calc }], ['Admin', { mode: 'design', draft: { kind: 'layout', for: 'x' } }], ['Admin', { mode: 'design', draft: { kind: 'function', for: 'No Such Function' } }], ['Clerk', { mode: 'design', draft: calc }]] as const) {
    script = [(b) => {
      assert.ok(!b.tools.some((t) => t.name === 'offer_draft'), JSON.stringify(context));
      return use('offer_draft', { text: '1', summary: 'x' });
    }, (b) => {
      assert.equal(lastResult(b).is_error, true);
      return text('ok');
    }];
    const x = await ask(await login(who), [{ role: 'user', content: 'Draft it' }], context);
    assert.deepEqual(x.body.drafts, []);
  }
});

test('assistant: prompts are cached across tool steps, and the answer says what it used', { skip }, async () => {
  const token = await login('Admin');
  const withUsage = (r: object, usage: object) => ({ ...r, usage });
  script = [
    () => withUsage(use('describe_layout', { layout: 'Congress' }), { input_tokens: 50, cache_creation_input_tokens: 4000, output_tokens: 30 }),
    () => withUsage(text('done'), { input_tokens: 70, cache_read_input_tokens: 4000, output_tokens: 20 }),
  ];
  requests.length = 0;
  const r = await ask(token, [{ role: 'user', content: 'What is on Congress?' }]);
  const { costUsd, ...tokens } = r.body.usage;
  assert.deepEqual(tokens, { inputTokens: 8120, cachedTokens: 4000, cacheWriteTokens: 4000, outputTokens: 50 });
  // A simple question goes to the fast model, at its list prices: input, cache writes at 1.25 times, cache reads at a tenth, output.
  assert.equal(r.body.model, 'claude-haiku-5-5');
  assert.ok(Math.abs(costUsd - (120 * 0.1 + 4000 * 0.125 + 4000 * 0.01 + 50 * 0.5) / 1e6) < 1e-12, String(costUsd));
  for (const req of requests) {
    const raw = req.raw as { system: { cache_control?: unknown }[]; tools: { cache_control?: unknown }[]; messages: { content: { cache_control?: unknown }[] }[] };
    assert.deepEqual(raw.system[0].cache_control, { type: 'ephemeral' });
    assert.deepEqual(raw.tools.at(-1)!.cache_control, { type: 'ephemeral' });
    assert.equal(raw.tools.filter((t) => t.cache_control).length, 1);
    assert.deepEqual(raw.messages.at(-1)!.content.at(-1)!.cache_control, { type: 'ephemeral' });
  }
  // Only the last message carries the marker; earlier ones go as they were.
  assert.equal(typeof (requests[1].raw as { messages: { content: unknown }[] }).messages[0].content, 'string');
});

test('assistant: a daily token limit stops it until tomorrow', { skip }, async () => {
  const limited = mkdtempSync(join(tmpdir(), 'tabularius-assistant-limit-'));
  copyFileSync(fixture, join(limited, 'Charts.fmp12'));
  const addr = model.address() as { port: number };
  const s = await serve({ dir: limited, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${addr.port}`, dailyTokens: 1000 } });
  try {
    const st = s.host.get('Charts')!;
    st.setPassword('Admin', 'pw');
    const r = await fetch(`${s.url}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}',
    });
    const token = (await r.json()).response.token;
    const post = async () => {
      const x = await fetch(`${s.url}/tabularius/assistant/v1/databases/Charts`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      return { status: x.status, body: await x.json() };
    };
    const whole = async () => (await fetch(`${s.url}/tabularius/assistant/v1/databases/Charts`, { headers: { authorization: `Bearer ${token}` } })).json();
    const info = async () => (await whole()).usageToday;
    // 600 billed: 100 input, 4,000 cached at a tenth (400), 100 output.
    script = [() => ({ ...text('one'), usage: { input_tokens: 100, cache_read_input_tokens: 4000, output_tokens: 100 } })];
    const first = (await post()).body;
    assert.equal(first.reply, 'one');
    assert.deepEqual(await info(), { tokens: 600, limit: 1000 });
    // The answer's cost, and the month's running total for whoever looks after the bill.
    assert.ok(first.usage.costUsd > 0, JSON.stringify(first.usage));
    const month = (await whole()).usageMonth;
    assert.equal(month.questions, 1);
    assert.equal(month.costUsd, first.usage.costUsd);
    // A long question stops between steps once over the limit.
    script = [
      () => ({ ...use('describe_layout', { layout: 'Congress' }), usage: { input_tokens: 500, output_tokens: 0 } }),
      () => text('never asked'),
    ];
    const stopped = await post();
    assert.match(stopped.body.reply, /today's limit/);
    assert.equal(script.length, 1, 'the second model call was not made');
    // Then no more questions today.
    const refused = await post();
    assert.equal(refused.status, 429);
    assert.match(refused.body.error.message, /today's limit of 1,000 tokens/);
    script = [];
  } finally {
    s.server.close();
  }
  // A restart keeps today's count, so the limit still holds.
  const again = await serve({ dir: limited, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${addr.port}`, dailyTokens: 1000 } });
  try {
    const r = await fetch(`${again.url}/fmi/data/vLatest/databases/Charts/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}',
    });
    const token = (await r.json()).response.token;
    const x = await fetch(`${again.url}/tabularius/assistant/v1/databases/Charts`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(x.status, 429);
  } finally {
    again.server.close();
    rmSync(limited, { recursive: true });
  }
});

test('assistant: a per-account daily limit stops one account, not the others', { skip }, async () => {
  const limited = mkdtempSync(join(tmpdir(), 'tabularius-assistant-account-'));
  copyFileSync(fixture, join(limited, 'Charts.fmp12'));
  const addr = model.address() as { port: number };
  const s = await serve({ dir: limited, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${addr.port}`, accountDailyTokens: 500 } });
  try {
    const st = s.host.get('Charts')!;
    st.savePrivilegeSet(clerk);
    st.setPassword('Admin', 'pw');
    st.setPassword('Clerk', 'pw', 'Clerk');
    const session = async (account: string) => {
      const r = await fetch(`${s.url}/fmi/data/vLatest/databases/Charts/sessions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
      });
      return (await r.json()).response.token as string;
    };
    const post = async (token: string) => {
      const x = await fetch(`${s.url}/tabularius/assistant/v1/databases/Charts`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      return { status: x.status, body: await x.json() };
    };
    const [admin, clerkToken] = [await session('Admin'), await session('Clerk')];
    script = [() => ({ ...text('one'), usage: { input_tokens: 400, output_tokens: 200 } })];
    assert.equal((await post(admin)).body.reply, 'one');
    const refused = await post(admin);
    assert.equal(refused.status, 429);
    assert.match(refused.body.error.message, /^Your account has used its daily limit of 500 tokens/);
    // Clerk has its own allowance, and sees its own usage.
    script = [() => ({ ...text('two'), usage: { input_tokens: 10, output_tokens: 10 } })];
    assert.equal((await post(clerkToken)).body.reply, 'two');
    const info = await (await fetch(`${s.url}/tabularius/assistant/v1/databases/Charts`, { headers: { authorization: `Bearer ${clerkToken}` } })).json();
    assert.deepEqual(info.accountUsageToday, { tokens: 20, limit: 500 });
    assert.equal(info.usageToday, undefined);
    assert.equal(info.usageMonth, undefined);
  } finally {
    s.server.close();
    rmSync(limited, { recursive: true });
  }
});

test('assistant: errors and access', { skip }, async () => {
  const token = await login('Clerk');
  // A tool the account may not use comes back as a tool error, and the model carries on.
  script = [
    () => use('sql_query', { sql: 'SELECT ACLU FROM Congress' }),
    (b) => {
      assert.equal(lastResult(b).is_error, true);
      return text('I can\'t read that.');
    },
  ];
  assert.equal((await ask(token, [{ role: 'user', content: 'ACLU scores?' }])).body.reply, 'I can\'t read that.');
  assert.equal((await ask(token, [])).status, 400);
  const anon = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, { method: 'POST', body: '{}' });
  assert.equal(anon.status, 401);
});

test('assistant: "show me" finds run as the account and come back as found sets', { skip }, async () => {
  const token = await login('Clerk');
  const ohio = Number(store.query(`SELECT count(*) AS n FROM Congress WHERE State = 'Ohio' AND Party = 'D'`)[0].n);
  script = [
    (b) => {
      assert.ok(b.tools.some((t) => t.name === 'show_records'));
      return use('show_records', { layout: 'Congress', query: [{ State: 'Ohio' }], summary: 'Members from Ohio' });
    },
    (b) => {
      assert.match(lastResult(b).content!, new RegExp(`Found ${ohio} records`));
      return use('show_records', { layout: 'Congress', query: [{ ACLU: '>50' }], summary: 'Hidden field' }, 'call2');
    },
    (b) => {
      // A field the account can't see is missing, as in a find.
      assert.equal(lastResult(b).is_error, true);
      return text('Here they are.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Show me members from Ohio' }], { layout: 'Congress' });
  assert.deepEqual(r.body.foundSets, [{ layout: 'Congress', query: [{ State: 'Ohio' }], foundCount: ohio, summary: 'Members from Ohio' }]);

  // The window's found set reaches the model; anything malformed is left out.
  script = [() => text('ok')];
  requests.length = 0;
  await ask(token, [{ role: 'user', content: 'Summarize these' }], {
    layout: 'Congress', foundSet: { query: [{ State: 'Ohio' }], sort: [{ fieldName: 'Name' }], foundCount: ohio },
  });
  assert.match(requests[0].system, new RegExp(`found set: ${ohio} records, found by find_records query \\[\\{"State":"Ohio"\\}\\], sorted by`));
  script = [() => text('ok')];
  requests.length = 0;
  await ask(token, [{ role: 'user', content: 'Summarize these' }], { foundSet: { query: [{ x: { nested: 1 } }], foundCount: 2, recordIds: [4, 'x', 9] } });
  assert.match(requests[0].system, /found set: 2 records, record ids 4, 9\./);
  assert.doesNotMatch(requests[0].system, /nested/);

  // In Find mode a request describes a find, answered with one found set.
  script = [() => text('ok')];
  requests.length = 0;
  await ask(token, [{ role: 'user', content: 'Find members from Ohio' }], { layout: 'Congress', mode: 'find' });
  assert.match(requests[0].system, /in Find mode.*They are in Find mode, so a request describes records to find: answer it with show_records/s);
  assert.ok(requests[0].tools.some((t) => t.name === 'show_records'));
  // The requests go into the find form to check, written with omit requests, dated from today.
  assert.match(requests[0].system, /filled into their Find mode form to check and change/);
  assert.match(requests[0].system, /an omit request \(\{"omit": true\}\) for "not"/);
  assert.match(requests[0].system, new RegExp(`Today is ${new Date().toISOString().slice(0, 10)}`));

  // An omit-only find ("members who aren't Republicans") is all records less the omitted ones, empty fields included.
  script = [
    () => use('show_records', { layout: 'Congress', query: [{ Party: 'R', omit: true }], summary: 'Members who are not Republicans' }),
    (b) => {
      assert.match(lastResult(b).content!, new RegExp(`${store.find('Congress', { limit: 0 }).foundCount - store.find('Congress', { query: [{ Party: '==R' }], limit: 0 }).foundCount} records`));
      return text('Members who are not Republicans.');
    },
  ];
  const omitOnly = await ask(token, [{ role: 'user', content: 'Show members who are not Republicans' }], { layout: 'Congress' });
  assert.equal(omitOnly.status, 200, JSON.stringify(omitOnly.body));
  assert.deepEqual(omitOnly.body.foundSets[0].query, [{ Party: 'R', omit: true }]);

  // Find with AI sends the design only: no tool that reads records, layouts described without values or counts, the
  // find's count kept from the model (the person sees it), and nothing of the window's found set or record.
  script = [
    (b) => {
      assert.deepEqual(b.tools.map((t) => t.name).sort(), ['describe_database', 'describe_layout', 'show_records']);
      // Only the request: earlier answers in the panel may hold record data.
      assert.equal(b.messages.length, 1);
      assert.match(JSON.stringify(b.messages[0]), /not Republicans/);
      // A tool not given here doesn't run, whatever the model asks for.
      return use('show_chart', { layout: 'Congress', groupBy: 'Party', title: 'x' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /There is no tool "show_chart" here/);
      assert.doesNotMatch(lastResult(b).content!, /\d/);
      return use('propose_cleanup', { layout: 'Congress' });
    },
    (b) => {
      assert.match(lastResult(b).content!, /There is no tool "propose_cleanup" here/);
      return use('describe_layout', { layout: 'Congress', sample: true });
    },
    (b) => {
      const layout = JSON.parse(lastResult(b).content!);
      assert.equal(layout.records, undefined);
      assert.ok(layout.fields.length);
      for (const f of layout.fields) for (const k of ['filled', 'distinct', 'min', 'max', 'common', 'examples']) assert.equal(f[k], undefined, `${f.name}.${k}`);
      return use('show_records', { layout: 'Congress', query: [{ Party: 'R', omit: true }], summary: 'Members who are not Republicans' });
    },
    (b) => {
      assert.doesNotMatch(lastResult(b).content!, /\d/);
      return text('Members who are not Republicans.');
    },
  ];
  requests.length = 0;
  const schemaOnly = await ask(token, [
    { role: 'user', content: 'Who are the members from Ohio?' }, { role: 'assistant', content: 'There are 18: Sherrod Brown, ...' },
    { role: 'user', content: 'Find members who are not Republicans' },
  ], {
    layout: 'Congress', mode: 'find', recordId: 7, foundSet: { query: [{ State: 'Ohio' }], foundCount: ohio, recordIds: [1, 2] },
    failure: { script: 'Mark paid', error: 102, message: 'Field is missing', recordId: 9, parameter: 'Ohio invoice for Sherrod' },
  });
  assert.equal(schemaOnly.status, 200, JSON.stringify(schemaOnly.body));
  assert.equal(schemaOnly.body.foundSets[0].foundCount, omitOnly.body.foundSets[0].foundCount);
  assert.doesNotMatch(requests[0].system, /found set: |record ids|looking at record|Ohio|Sherrod|Mark paid/);

  // Design mode has no window to show records in.
  script = [(b) => {
    assert.ok(!b.tools.some((t) => t.name === 'show_records'));
    return text('ok');
  }];
  requests.length = 0;
  assert.equal((await ask(token, [{ role: 'user', content: 'hi' }], {
    mode: 'design', design: { tab: 'Scripts', selection: [{ kind: 'script', name: 'Mark "overdue"' }, { kind: '<bad>', name: 'x' }] },
  })).body.reply, 'ok');
  assert.match(requests[0].system, /they have the "Scripts" tab open, with script "Mark \\"overdue\\"" selected\./);
  assert.doesNotMatch(requests[0].system, /bad/);

  // The Script Debugger: where the script is paused; no window to show records in.
  script = [(b) => {
    assert.ok(!b.tools.some((t) => t.name === 'show_records'));
    return text('ok');
  }];
  requests.length = 0;
  await ask(token, [{ role: 'user', content: 'Why error 401?' }], {
    mode: 'debug', debug: { script: 'Find Ohio', step: 3, line: 'Perform Find [ Restore ]', lastError: 401, stack: ['Start (step 2)', 'Find Ohio (step 3)'], variables: { $n: '0', '<x>': 'y' } },
  });
  assert.match(requests[0].system, /in the Script Debugger\. .*In the Script Debugger: script "Find Ohio" is paused at step 3 \("Perform Find \[ Restore \]"\); Get \( LastError \) is 401; call stack, outermost first: Start \(step 2\) > Find Ohio \(step 3\); variables: \{"\$n":"0"\}\./s);
});

test('assistant: streams its steps, then the answer', { skip }, async () => {
  const token = await login('Clerk');
  script = [
    () => use('describe_layout', { layout: 'Congress' }),
    () => use('summarize_records', { layout: 'Congress', groupBy: ['Party'] }, 'call2'),
    () => text('Done.'),
  ];
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'How many per party?' }] }),
  });
  assert.match(r.headers.get('content-type')!, /ndjson/);
  const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  // Each step line is followed by the tool call it describes: its name, what was asked for and the start of the result.
  assert.deepEqual(lines.filter((l) => l.step).map((l) => l.step), ['Looking at layout "Congress"', 'Adding up records on layout "Congress"']);
  assert.deepEqual(lines.filter((l) => l.tool).map((l) => [l.tool.id, l.tool.name, l.tool.label]), [
    ['call1', 'describe_layout', 'Looking at layout "Congress"'],
    ['call2', 'summarize_records', 'Adding up records on layout "Congress"'],
  ]);
  assert.deepEqual(lines[0], { step: 'Looking at layout "Congress"' });
  assert.deepEqual(lines[1].tool.args, { layout: 'Congress' });
  const final = lines.at(-1);
  assert.equal(final.done.reply, 'Done.');
  assert.deepEqual(final.done.tools, ['describe_layout', 'summarize_records']);

  // From a model that streams: the answer's text arrives in pieces as it is written, tool calls still work.
  sse = true;
  script = [
    () => use('describe_layout', { layout: 'Congress' }),
    () => ({ content: [{ type: 'text', text: 'Democrats only, for you.' }], stop_reason: 'end_turn' }),
  ];
  try {
    const st = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Which parties?' }] }),
    });
    const got = (await st.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(got.filter((l) => !l.tool).slice(0, 3), [{ step: 'Looking at layout "Congress"' }, { text: 'Democrats on' }, { text: 'ly, for you.' }]);
    assert.equal(got.filter((l) => l.tool).length, 1);
    const finished = got.at(-1);
    assert.equal(finished.done.reply, 'Democrats only, for you.');
    const { costUsd: _c, ...streamed } = finished.done.usage;
    assert.deepEqual(streamed, { inputTokens: 200, cachedTokens: 180, cacheWriteTokens: 0, outputTokens: 10 });
  } finally {
    sse = false;
  }

  // A failure after the stream starts comes as an error line.
  script = [() => ({ error: { message: 'model down' } })];
  const bad = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  });
  const last = JSON.parse((await bad.text()).trim().split('\n').at(-1)!);
  assert.match(last.error.message, /model down/);
});

test('assistant: a solution built from a description is previewed, applied, then undone', { skip }, async () => {
  const token = await login('Admin');
  const id = (name: string) => ({ name, type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 }, prohibitModification: true } } });
  const stamp = (name: string, value: string) => ({ name, type: 'timestamp', options: { autoEnter: { value } } });
  const crm = [
    { op: 'createTable', name: 'Companies', fields: [id('CompanyID'), { name: 'Name', type: 'text' }, { name: 'Status', type: 'text' }, stamp('Created', 'creationTimestamp')] },
    { op: 'createTable', name: 'Contacts', fields: [id('ContactID'), { name: 'CompanyID', type: 'number' }, { name: 'First Name', type: 'text' }, { name: 'Email', type: 'text' }] },
    { op: 'createTable', name: 'Notes', fields: [id('NoteID'), { name: 'ContactID', type: 'number' }, { name: 'Note', type: 'text' }, stamp('Created', 'creationTimestamp')] },
    { op: 'createRelationship', left: 'Companies', right: 'Contacts', predicates: [{ left: 'CompanyID', right: 'CompanyID' }], rightCreate: true, leftCreate: false },
    { op: 'createRelationship', left: 'Contacts', right: 'Notes', predicates: [{ left: 'ContactID', right: 'ContactID' }], rightCreate: true, leftCreate: false, rightDelete: true },
    { op: 'createValueList', name: 'Company Status', values: ['Lead', 'Customer', 'Former'] },
    { op: 'createLayout', name: 'Company List', occurrence: 'Companies', design: { view: 'list' } },
  ];
  script = [
    (b) => {
      assert.match(b.system, /build something new from a description/);
      return use('propose_design_change', { summary: 'A simple CRM', changes: crm });
    },
    (b) => {
      assert.match(lastResult(b).content!, /What they see:\n- New table Companies: CompanyID \(number, serial number\)/);
      return text('Here is a CRM with companies, contacts and notes.');
    },
  ];
  const before = JSON.stringify(store.schema);
  const r = await ask(token, [{ role: 'user', content: 'Make me a simple CRM with companies, contacts and notes' }]);
  const p = r.body.proposals[0];
  assert.deepEqual(p.preview, [
    'New table Companies: CompanyID (number, serial number), Name (text), Status (text), Created (timestamp, auto-enter creation timestamp)',
    'New table Contacts: ContactID (number, serial number), CompanyID (number), First Name (text), Email (text)',
    'New table Notes: NoteID (number, serial number), ContactID (number), Note (text), Created (timestamp, auto-enter creation timestamp)',
    'New relationship Companies::CompanyID = Contacts::CompanyID (create Contacts records from Companies)',
    'New relationship Contacts::ContactID = Notes::ContactID (create Notes records from Contacts; delete Notes records with their Contacts record)',
    'New value list Company Status: Lead, Customer, Former',
    'New layout Companies showing records from Companies',
    'New layout Contacts showing records from Contacts',
    'New layout Notes showing records from Notes',
    'New layout Company List showing records from Companies',
  ]);
  assert.equal(JSON.stringify(store.schema), before, 'nothing applied');

  // Applied the way the panel does: design mode's endpoint, which hands back the undo.
  const url = `${base}/tabularius/design/v1/databases/Charts`;
  const post = async (changes: unknown) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ changes }) })).json();
  const applied = await post(p.changes);
  assert.ok(Array.isArray(applied.undo), JSON.stringify(applied).slice(0, 300));
  assert.ok(store.schema.tables.some((t) => t.name === 'Contacts'));
  const list = store.design('Company List')!;
  assert.equal(list.view, 'list');
  assert.ok(list.objects.filter((o) => o.kind === 'field').every((o) => o.bounds.top === 74), 'one row of fields');
  const undone = await post(applied.undo);
  assert.ok(!undone.error, JSON.stringify(undone.error));
  for (const name of ['Companies', 'Contacts', 'Notes']) assert.ok(!store.schema.tables.some((t) => t.name === name), name);
  assert.ok(!store.schema.layouts.some((l) => ['Companies', 'Contacts', 'Notes', 'Company List'].includes(l.name)));
  assert.ok(!store.schema.valueLists.some((v) => v.name === 'Company Status'));
  assert.ok(!store.schema.relationships.some((x) => p.preview.some((l: string) => l.includes(`${x.leftTableOccurrence}::`))));
});

test('assistant: "Why?" on a script error runs it again on a copy and proposes the fix as changed steps', { skip }, async () => {
  store.applyDesign([{ op: 'createScript', name: 'Average it', text: 'Go to Layout [ "Congress" ]\nSet Variable [ $v ; Value: 50 ]\nSet Field [ Congress::Comp_C_Average ; $v ]' }] as never);
  const token = await login('Admin');
  const info = await (await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(info.canExplainScripts, true);
  let seen = '';
  script = [
    (b) => {
      assert.match(b.system, /The script "Average it" just stopped with error 201 \("Field \\"Comp_C_Average\\" is a summary field"\) in their window, run on layout "Congress", on record 3\. To explain it, call explain_script_failure/);
      assert.ok(b.tools.some((t) => t.name === 'explain_script_failure'));
      return use('explain_script_failure', { script: 'Average it', layout: 'Congress', recordId: 3 });
    },
    (b) => {
      seen = lastResult(b).content!;
      return use('propose_design_change', {
        summary: 'Set a number field, not the summary', changes: [{ op: 'updateScript', script: 'Average it', text: 'Go to Layout [ "Congress" ]\nSet Variable [ $v ; Value: 50 ]\nSet Field [ Congress::Liberal_Rank ; $v ]' }],
      }, 'call2');
    },
    () => text('Comp_C_Average is a summary field, so the script cannot set it; set Liberal_Rank instead.'),
  ];
  const r = await ask(token, [{ role: 'user', content: 'Why did the script "Average it" stop with error 201?' }],
    { layout: 'Congress', recordId: 3, mode: 'browse', failure: { script: 'Average it', error: 201, message: 'Field "Comp_C_Average" is a summary field', layout: 'Congress', recordId: 3 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = JSON.parse(seen);
  assert.equal(w.step.number, 3);
  assert.ok(w.hints.some((h: string) => /summary field/.test(h)));
  // The fix is shown as the steps it changes, with a dry run; nothing is applied.
  const [p] = r.body.proposals;
  assert.deepEqual(p.preview, ['Change script Average it (3 steps)', '  2. Set Variable [ $v ; Value: 50 ]', '- Set Field [ Congress::Comp_C_Average ; $v ]', '+ 3. Set Field [ Congress::Liberal_Rank ; $v ]']);
  assert.equal(p.dryRuns[0].run.outcome, 'ok');
  assert.match(store.schema.scripts.find((s) => s.name === 'Average it')!.steps[2].line!, /Comp_C_Average/);

  // A limited account isn't offered the tool, nor the Why? button.
  const clerk = await login('Clerk');
  const clerkInfo = await (await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, { headers: { authorization: `Bearer ${clerk}` } })).json();
  assert.equal(clerkInfo.canExplainScripts, false);
});

test('assistant: "Ask about this record" reads the record with its related records, and cites the fields', { skip }, async () => {
  const token = await login('Admin');
  let seen = '';
  script = [
    (b) => {
      assert.match(b.system, /looking at record 1/);
      assert.match(b.system, /call describe_record on the layout and record first[\s\S]*\[Occurrence::Field #recordId\]/);
      assert.ok(b.tools.some((t) => t.name === 'describe_record'));
      return use('describe_record', { layout: 'Related records • Pie', recordId: 1 });
    },
    (b) => {
      seen = lastResult(b).content!;
      return text('Alfreds Futterkiste [NW Customers::Customer] has 4 salespeople, among them Nancy Davolio [NW SalespersonCustomers::Salesperson #326].');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Summarize this record and its related records' }], { layout: 'Related records • Pie', recordId: 1, mode: 'browse' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = JSON.parse(seen);
  assert.equal(d.fields.Customer, 'Alfreds Futterkiste');
  assert.equal(d.related[0].count, 4);
  assert.match(r.body.reply, /\[NW SalespersonCustomers::Salesperson #326\]/);
});

test('assistant: a proposed layout comes with its design to draw, checked by Check layout', { skip }, async () => {
  const token = await login('Admin');
  const button = (id: number, b: number[], text: string) => ({ id, kind: 'button', type: 0, text, bounds: { left: b[0], top: b[1], right: b[2], bottom: b[3] }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, action: { stepId: 1, step: 'Perform Script' } });
  const change = { op: 'createLayout', name: 'Quick list', occurrence: 'Congress', design: { width: 600, parts: [{ kind: 'body', kindId: 2, top: 0, height: 200, style: {} }], objects: [button(1, [10, 10, 110, 40], 'Go'), button(2, [20, 15, 120, 45], 'Stop')] } };
  let told = '';
  script = [
    () => use('propose_design_change', { summary: 'A quick list', changes: [change] }),
    (b) => {
      told = lastResult(b).content!;
      return text('Proposed.');
    },
  ];
  const r = await ask(token, [{ role: 'user', content: 'Make me a quick list layout' }]);
  const [layout] = r.body.proposals[0].layouts;
  assert.equal(layout.name, 'Quick list');
  assert.equal(layout.before, undefined);
  assert.equal(layout.design.objects.length, 2);
  assert.ok(layout.issues.some((i: { rule: string }) => i.rule === 'overlap'));
  // The assistant hears what Check found, to tidy its own draft.
  assert.match(told, /Check layout found on the proposed layout: Quick list: "Stop" covers "Go"/);
  assert.ok(!store.layouts().some((l) => l.name === 'Quick list'), 'nothing applied');
});

test('assistant: a picture goes with the question to the main model, before its words; bad pictures are refused', { skip }, async () => {
  const token = await login('Admin');
  // A 1×1 PNG.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  script = [
    (b) => {
      assert.equal(b.raw.model, 'claude-opus-5-5', 'not the fast model');
      const last = b.messages.at(-1)!.content as { type: string; text?: string; source?: { media_type: string; data: string } }[];
      assert.deepEqual(last.map((x) => x.type), ['image', 'text']);
      assert.equal(last[0].source?.media_type, 'image/png');
      assert.equal(last[0].source?.data, png);
      assert.equal(last[1].text, 'Make a layout like this');
      assert.match(b.system, /picture of a layout[^]*arrangement/);
      return text('Here is a draft.');
    },
  ];
  const post = (image: unknown) => fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Make a layout like this' }], context: { mode: 'design' }, image }),
  });
  const r = await post({ mediaType: 'image/png', data: png });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).reply, 'Here is a draft.');
  for (const [bad, why] of [[{ mediaType: 'image/svg+xml', data: png }, /PNG, JPEG, GIF, WEBP/], [{ mediaType: 'image/png', data: 'not base64!' }, /base64/], [{ mediaType: 'image/png', data: 'AAAAA' }, /base64/]] as const) {
    const res = await post(bad);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error?.message ?? '', why);
  }
  // Pictures are for designing: an account that can't design can't send one.
  const clerk = await login('Clerk');
  const refused = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${clerk}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'What is this?' }], image: { mediaType: 'image/png', data: png } }),
  });
  assert.equal(refused.status, 401);
});

import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError, type PrivilegeDefinition, type Store } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import { DenialCollector, denialOperation } from '../src/denial-audit.ts';
import { narrowPrivileges } from '../src/token-scope.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };
const SECRET = 'hidden-record-value-f9098752';
const SUBMITTED = 'submitted-value-a05fb294';

async function setup(t: TestContext, changes: Partial<PrivilegeDefinition> = {}, secure = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-denial-http-'));
  createStore(join(dir, 'Scratch.openhbam.sqlite'));
  if (secure) setAdminPassword(dir, 'adminpw');
  const running = await serve({ dir, port: 0, log: () => {}, progressive: { every: 1000 } });
  t.after(async () => {
    await new Promise<void>((resolve) => running.server.close(() => resolve()));
    rmSync(dir, { recursive: true });
  });
  const store = running.host.get('Scratch')!;
  store.setAiPolicy(false); // the denial messages under test, not the AI policy's refusal
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }, { name: 'Secret' }] },
    { op: 'createLayout', name: 'Closed', occurrence: 'T' },
    { op: 'createScript', name: 'Blocked' },
  ]);
  const id = store.create('T', { A: 'record-label-sentinel', Secret: SECRET }).recordId;
  store.savePrivilegeSet({ name: 'Clerk', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'none', scripts: 'none',
    extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp'], ...changes });
  store.setPassword('clerk', 'pw', changes.name ?? 'Clerk');
  const basic = 'Basic ' + btoa('clerk:pw');
  const data = '/fmi/data/vLatest/databases/Scratch';
  const app = '/tabularius/app/v1/databases/Scratch';
  const request = async (path: string, method = 'GET', body?: unknown, token?: string, web = false) => {
    const r = await fetch(running.url + path, { method,
      headers: { authorization: token ? `Bearer ${token}` : basic, 'content-type': 'application/json', ...(web ? { 'x-tabularius-client': 'web' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const login = async () => {
    const r = await request(`${data}/sessions`, 'POST', {});
    assert.equal(r.status, 200);
    return r.body.response.token as string;
  };
  const tool = async (name: string, args: object, auth = basic) => {
    const r = await fetch(running.url + '/mcp', { method: 'POST', headers: {
      authorization: auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { database: 'Scratch', ...args } } }) });
    const body = await r.json();
    assert.ok(body.result, JSON.stringify(body));
    return body.result;
  };
  return { store, id, request, login, tool, data, app, url: running.url, host: running.host };
}

function noLeaks(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [SECRET, SUBMITTED, 'record-label-sentinel', 'exception-sentinel', 'Secret =', 'policyFingerprint', 'location', 'outcome', '_fm_record_id']) {
    assert.ok(!text.includes(secret), `unexpected disclosure: ${secret}`);
  }
}

test('Data API and MCP preserve messages; isolated writes suppress denials and reads retain them', async (t) => {
  const { store, id, request, login, tool, data } = await setup(t, { records: { ...OPEN, view: 'Secret = "allowed"', edit: false } });
  let token = await login();
  const r = await request(`${data}/layouts/T/records/${id}`, 'PATCH', { fieldData: { A: SUBMITTED } }, token);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body.messages, [{ code: '200', message: 'Record access is denied' }]);
  assert.deepEqual(r.body.response, {});
  assert.equal(r.body['tabularius:denial'].permission, 'view');
  assert.equal(r.body['tabularius:denial'].operation, 'edit');
  noLeaks(r.body);
  const unreadable = await request(`${data}/layouts/T/records/${id}`, 'GET', undefined, token);
  assert.equal(unreadable.body.messages[0].code, '200');
  assert.equal(unreadable.body['tabularius:denial'].permission, 'view');
  noLeaks(unreadable.body);
  for (const isolation of [false, true]) {
    store.setPiiIsolation(isolation);
    const result = await tool('update_record', { layout: 'T', recordId: id, fieldData: { A: SUBMITTED } });
    assert.equal(result.isError, true);
    if (isolation) {
      assert.match(result.content[0].text, /The details aren't sent/);
      assert.ok(!JSON.stringify(result).includes('denial'));
    } else {
      const error = JSON.parse(result.content[0].text);
      assert.equal(error.code, 200);
      assert.deepEqual(error.denial, r.body['tabularius:denial']);
      assert.equal(error.message, r.body.messages[0].message);
    }
    noLeaks(result);
    const read = await tool('get_record', { layout: 'T', recordId: id });
    assert.equal(JSON.parse(read.content[0].text).code, 200);
    assert.equal(JSON.parse(read.content[0].text).message, 'Record access is denied');
    assert.deepEqual(JSON.parse(read.content[0].text).denial, unreadable.body['tabularius:denial']);
    noLeaks(read);
  }
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, records: { ...OPEN, view: 'exception-sentinel (' } });
  assert.equal((await request(`${data}/layouts/T/records/${id}`, 'GET', undefined, token)).status, 401); // the changed set ended the session
  token = await login();
  const failedEvaluation = await request(`${data}/layouts/T/records/${id}`, 'GET', undefined, token);
  assert.deepEqual(failedEvaluation.body['tabularius:denial'], unreadable.body['tabularius:denial']);
  noLeaks(failedEvaluation.body);
  const beforeFiltering = store.securityEvents({ kind: 'privilege-denied' }).length;
  const filtered = await request(`${data}/layouts/T/records`, 'GET', undefined, token);
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, beforeFiltering);
  assert.ok(!JSON.stringify(filtered.body).includes('denial'));
  noLeaks(filtered.body);
});

test('web errors keep their code and message and carry the same projection as Data API and MCP', async (t) => {
  const { id, request, login, tool, data, app } = await setup(t, { records: { ...OPEN, view: false } });
  const token = await login();
  const web = await request(`${app}/layouts/T/records`, 'POST', { ids: [id] }, token);
  assert.equal(web.status, 400);
  assert.equal(web.body.error.code, 200);
  assert.equal(web.body.error.message, 'Record access is denied: no access to T records');
  const rest = await request(`${data}/layouts/T/records`, 'GET', undefined, token);
  assert.equal(rest.status, 500);
  assert.deepEqual(rest.body.messages, [{ code: '200', message: web.body.error.message }]);
  assert.deepEqual(web.body.error.denial, rest.body['tabularius:denial']);
  const mcp = await tool('find_records', { layout: 'T' });
  assert.equal(mcp.isError, true);
  assert.equal(JSON.parse(mcp.content[0].text).code, 200);
  assert.equal(JSON.parse(mcp.content[0].text).message, web.body.error.message);
  assert.deepEqual(JSON.parse(mcp.content[0].text).denial, web.body.error.denial);
  noLeaks(web.body);
});

test('edit, delete and create denials retain their code across Data API and MCP', async (t) => {
  const { id, request, login, tool, data } = await setup(t, { records: { view: true, edit: false, create: false, delete: false } });
  const token = await login();
  for (const [method, suffix, body, toolName, args, permission] of [
    ['PATCH', `/${id}`, { fieldData: { A: SUBMITTED } }, 'update_record', { recordId: id, fieldData: { A: SUBMITTED } }, 'edit'],
    ['DELETE', `/${id}`, undefined, 'delete_record', { recordId: id }, 'delete'],
    ['POST', '', { fieldData: { A: SUBMITTED } }, 'create_record', { fieldData: { A: SUBMITTED } }, 'create'],
  ] as const) {
    const rest = await request(`${data}/layouts/T/records${suffix}`, method, body, token);
    assert.equal(rest.status, 500);
    assert.equal(rest.body.messages[0].code, '200');
    assert.equal(rest.body['tabularius:denial'].permission, permission);
    const mcp = await tool(toolName, { layout: 'T', ...args });
    assert.equal(mcp.isError, true);
    assert.equal(JSON.parse(mcp.content[0].text).code, 200);
    assert.equal(JSON.parse(mcp.content[0].text).message, rest.body.messages[0].message);
    assert.deepEqual(JSON.parse(mcp.content[0].text).denial, rest.body['tabularius:denial']);
    noLeaks(mcp);
  }
});

test('concealed and nonexistent fields and layouts keep equivalent public error shapes on every surface', async (t) => {
  const { store, request, login, tool, data, app } = await setup(t, { records: { ...OPEN, fields: { Secret: 'none' } },
    layoutAccess: { Closed: { layout: 'none', records: 'none' } } });
  let token = await login();
  const normalized = (value: unknown) => JSON.stringify(value).replace(/Closed|Absent|Secret/g, 'object');
  for (const prefix of [data, app]) {
    const responses = [];
    for (const name of ['Closed', 'Absent']) responses.push(await request(`${prefix}/layouts/${name}`, 'GET', undefined, token));
    assert.deepEqual(normalized(responses[0]), normalized(responses[1]));
    assert.ok(!JSON.stringify(responses).includes('denial'));
  }
  const hidden = await request(`${data}/layouts/T/_find`, 'POST', { query: [{ Secret: SECRET }] }, token);
  const absent = await request(`${data}/layouts/T/_find`, 'POST', { query: [{ Absent: SECRET }] }, token);
  assert.equal(hidden.body.messages[0].code, '102');
  assert.equal(normalized(hidden), normalized(absent));
  assert.ok(!JSON.stringify(hidden).includes('denial'));
  for (const args of [
    [{ layout: 'Closed' }, { layout: 'Absent' }],
    [{ layout: 'T', query: [{ Secret: SECRET }] }, { layout: 'T', query: [{ Absent: SECRET }] }],
  ]) {
    const a = await tool('find_records', args[0]);
    const b = await tool('find_records', args[1]);
    assert.equal(normalized(a), normalized(b));
    assert.ok(!JSON.stringify(a).includes('denial'));
  }
  const hiddenLayout = await request(`${data}/layouts/Closed`, 'GET', undefined, token);
  const hiddenWeb = await request(`${app}/layouts/Closed`, 'GET', undefined, token);
  const hiddenMcp = await tool('find_records', { layout: 'Closed' });
  store.applyDesign([{ op: 'deleteLayout', layout: 'Closed' }, { op: 'deleteField', table: 'T', field: 'Secret' }]);
  token = await login(); // deleting the layout and field changed the set's authority, which ended the session
  assert.deepEqual(await request(`${data}/layouts/Closed`, 'GET', undefined, token), hiddenLayout);
  assert.deepEqual(await request(`${app}/layouts/Closed`, 'GET', undefined, token), hiddenWeb);
  assert.deepEqual(await tool('find_records', { layout: 'Closed' }), hiddenMcp);
  assert.deepEqual(await request(`${data}/layouts/T/_find`, 'POST', { query: [{ Secret: SECRET }] }, token), hidden);
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 0);
});

test('field writes, layout writes and script-start denials keep their existing protocol codes', async (t) => {
  const { store, id, request, login, tool, data, app } = await setup(t, { records: { ...OPEN, fields: { A: 'viewOnly' } } });
  let token = await login();
  const field = await request(`${data}/layouts/T/records/${id}`, 'PATCH', { fieldData: { A: SUBMITTED } }, token);
  assert.equal(field.status, 500);
  assert.deepEqual(field.body.messages, [{ code: '201', message: 'Field "A" cannot be modified' }]);
  assert.equal(field.body['tabularius:denial'].permission, 'field-write');
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, layoutAccess: { T: { layout: 'viewOnly', records: 'viewOnly' } } });
  token = await login(); // the changed authority ended the first session
  const layout = await request(`${data}/layouts/T/records/${id}`, 'PATCH', { fieldData: { A: SUBMITTED } }, token);
  assert.equal(layout.status, 500);
  assert.equal(layout.body.messages[0].code, '200');
  assert.equal(layout.body['tabularius:denial'].permission, 'layout-write');
  const script = await request(`${data}/layouts/T/script/Blocked`, 'GET', undefined, token);
  assert.equal(script.status, 200);
  assert.deepEqual(script.body.messages, [{ code: '0', message: 'OK' }]);
  assert.equal(script.body.response.scriptError, '9');
  assert.equal(script.body.response['tabularius:denial'].permission, 'script-start');
  const mcp = await tool('run_script', { layout: 'T', script: 'Blocked' });
  assert.equal(mcp.isError, true);
  assert.equal(JSON.parse(mcp.content[0].text).code, 9);
  assert.deepEqual(JSON.parse(mcp.content[0].text).denial, script.body.response['tabularius:denial']);
  assert.equal(JSON.parse(mcp.content[0].text).message, 'Insufficient privileges to run script "Blocked"');
  store.applyDesign([{ op: 'updateLayout', layout: 'T', design: { ...store.design('T')!, triggers: [
    { event: 'OnLayoutEnter', scriptId: store.schema.scripts.find((s) => s.name === 'Blocked')!.id },
  ] } }]);
  const web = await request(`${app}/layouts/T/button`, 'POST', { trigger: 'OnLayoutEnter' }, token);
  assert.equal(web.status, 400);
  assert.equal(web.body.error.code, 9);
  assert.equal(web.body.error.denial.permission, 'script-start');
  noLeaks(field.body);
  noLeaks(script.body);
});

test('missing extended privileges carry safe explanations and token limits are not blamed on saved sets', async (t) => {
  const { store, request, tool, data } = await setup(t, { extendedPrivileges: [] });
  for (const web of [false, true]) {
    const denied = await request(`${data}/sessions`, 'POST', {}, undefined, web);
    assert.equal(denied.status, 401);
    assert.equal(denied.body.messages[0].code, '9');
    assert.equal(denied.body['tabularius:denial'].permission, 'extended-privilege');
    assert.match(denied.body.messages[0].message, web ? /fmapp or fmwebdirect/ : /fmrest/);
    noLeaks(denied.body);
  }
  const mcp = await tool('describe_database', {});
  assert.equal(mcp.isError, true);
  assert.equal(JSON.parse(mcp.content[0].text).code, 9);
  assert.equal(JSON.parse(mcp.content[0].text).denial.permission, 'extended-privilege');
  assert.equal(JSON.parse(mcp.content[0].text).message, 'Insufficient privileges: the "Clerk" privilege set needs the fmmcp extended privilege (AI access) in Scratch');
  assert.match(mcp.content[0].text, /fmmcp/);
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp'] });
  const token = store.createApiToken('clerk', { readOnly: true });
  const rest = await request(`${data}/layouts/T/records`, 'POST', { fieldData: {} }, token);
  assert.equal(rest.status, 403);
  assert.equal(rest.body.messages[0].code, '9');
  assert.ok(!('tabularius:denial' in rest.body));
  const scoped = await tool('create_record', { layout: 'T', fieldData: {} }, `Bearer ${token}`);
  assert.equal(scoped.isError, true);
  assert.ok(!JSON.stringify(scoped).includes('denial'));
  const p = narrowPrivileges(store, store.privileges('clerk'), { readOnly: true });
  assert.equal(p.recordDenial('T', 'edit', 'edit'), undefined);
});

test('non-privilege refusals remain untagged and their details remain suppressed under isolation', async (t) => {
  const { store, id, request, login, tool, data } = await setup(t);
  store.applyDesign([{ op: 'createField', table: 'T', name: 'Calculated', kind: 'calculation', calculation: '1' }]);
  const token = await login();
  const error = await request(`${data}/layouts/T/records/${id}`, 'PATCH', { fieldData: { Calculated: SUBMITTED } }, token);
  assert.equal(error.status, 500);
  assert.equal(error.body.messages[0].code, '201');
  assert.ok(!('tabularius:denial' in error.body));
  store.setPiiIsolation(true);
  const mcp = await tool('update_record', { layout: 'T', recordId: id, fieldData: { Calculated: SUBMITTED } });
  assert.equal(mcp.isError, true);
  assert.match(mcp.content[0].text, /The details aren't sent/);
  assert.ok(!mcp.content[0].text.includes('Calculated'));
  assert.ok(!JSON.stringify(mcp).includes('denial'));
  noLeaks(mcp);
});

function scripts(store: Store) {
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, scripts: 'viewOnly', records: { ...OPEN, delete: false } });
  store.applyDesign([
    { op: 'createScript', name: 'Terminal', text: 'Set Error Capture [ On ]\nDelete Record/Request [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastErrorDetail ) ]' },
    { op: 'createScript', name: 'Handled', text: 'Delete Record/Request [ With dialog: Off ]\nSet Variable [ $detail ; Value: Get ( LastErrorDetail ) ]\nExit Script [ Text Result: $detail ]' },
    { op: 'createScript', name: 'Interactive', text: 'Set Error Capture [ On ]\nDelete Record/Request [ With dialog: Off ]\nPause/Resume Script [ Indefinitely ]\nSet Variable [ $done ; Value: 1 ]\nExit Script' },
  ]);
}

test('handled script errors are audited, never reported or logged as terminal failures; MCP repeats share one event', async (t) => {
  const { store, host, id, request, login, tool, data, app } = await setup(t);
  scripts(store);
  const token = await login();
  const warnings: string[] = [];
  const write = host.logs!.write.bind(host.logs!);
  t.mock.method(host.logs!, 'write', (...args: Parameters<typeof write>) => { if (args[0] === 'ScriptEvent') warnings.push(args[3]); write(...args); });
  const handled = await request(`${data}/layouts/T/script/Handled`, 'GET', undefined, token);
  assert.equal(handled.status, 200); assert.equal(handled.body.response.scriptError, '0');
  assert.ok(!('tabularius:denial' in handled.body.response)); assert.match(handled.body.response.scriptResult, /record-delete/);
  assert.equal(warnings.length, 0); assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 1);
  const terminal = await request(`${data}/layouts/T/script/Terminal`, 'GET', undefined, token);
  assert.equal(terminal.body.response.scriptError, '200'); assert.equal(terminal.body.response['tabularius:denial'].permission, 'delete');
  assert.equal(warnings.length, 1); assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 1);
  noLeaks(terminal.body);
  const result = await tool('run_script', { script: 'Terminal', layout: 'T' });
  const run = JSON.parse(result.content[0].text);
  assert.equal(run.error, 200); assert.equal(run.denial.permission, 'delete'); noLeaks(result);
  await tool('run_script', { script: 'Terminal', layout: 'T' });
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 2);
  const scriptId = store.schema.scripts.find((s) => s.name === 'Terminal')!.id;
  const web = await request(`${app}/layouts/T/button`, 'POST', { scriptId, ids: [id], recordId: id }, token);
  assert.equal(web.body.error, 200); assert.equal(web.body.denial.permission, 'delete'); noLeaks(web.body);
  assert.equal(store.get('T', id).fieldData.Secret, SECRET);
});

test('multi-phase Data API requests retain phase extensions and audit only their first refusal', async (t) => {
  const { store, request, login, data } = await setup(t);
  scripts(store); const token = await login();
  const r = await request(`${data}/layouts/T/records?script.prerequest=Terminal&script.presort=Terminal&script=Handled`, 'GET', undefined, token);
  assert.equal(r.status, 200);
  const { data: records, ...diagnostics } = r.body.response;
  assert.equal(records.length, 1); noLeaks(diagnostics);
  const out = r.body.response;
  assert.equal(out['scriptError.prerequest'], '200'); assert.equal(out['scriptError.presort'], '200'); assert.equal(out.scriptError, '0');
  assert.equal(out['tabularius:denial.prerequest'].permission, 'delete'); assert.equal(out['tabularius:denial.presort'].permission, 'delete');
  assert.ok(!out['tabularius:denial']);
  const events = store.securityEvents({ kind: 'privilege-denied' }); assert.equal(events.length, 1);
  assert.equal(events[0].changes?.phase, 'prerequest');
});

for (const timeout of [false, true]) test(`interactive web run flushes after ${timeout ? 'timeout abandonment' : 'resume'}, not at pause`, async (t) => {
  const { store, id, request, login, app } = await setup(t);
  scripts(store); const token = await login();
  // The pause's abandonment timer (10 minutes) is held back and fired by hand, so a slow machine cannot reach it before the check at the pause.
  let abandon: (() => void) | undefined;
  if (timeout) {
    const timer = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      if (ms !== 600_000) return timer(fn, ms, ...args);
      abandon = () => fn(...args);
      return timer(() => {}, 600_000).unref();
    });
  }
  const scriptId = store.schema.scripts.find((s) => s.name === 'Interactive')!.id;
  const r = await request(`${app}/layouts/T/button`, 'POST', { scriptId, ids: [id], recordId: id }, token);
  assert.equal(r.status, 200); assert.equal(r.body.waiting.step, 'Pause');
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 0);
  if (timeout) {
    assert.ok(abandon, 'the paused run has an abandonment timer');
    abandon();
    await new Promise((resolve) => setTimeout(resolve, 150));
  } else {
    const done = await request(`${app}/runs/${r.body.waiting.run}/file`, 'POST', {}, token);
    assert.equal(done.body.error, 0); assert.ok(!done.body.denial);
  }
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 1);
});

test('logger failure preserves the script envelope and terminal error', async (t) => {
  const { store, request, login, data } = await setup(t); scripts(store); const token = await login();
  const logger = store as unknown as { logSecurity: (...args: unknown[]) => void };
  const original = logger.logSecurity.bind(store);
  t.mock.method(logger, 'logSecurity', (...args: unknown[]) => { if (args[0] === 'privilege-denied') throw new Error('logger-exception-sentinel'); original(...args); });
  const r = await request(`${data}/layouts/T/script/Terminal`, 'GET', undefined, token);
  assert.equal(r.status, 200); assert.equal(r.body.response.scriptError, '200'); noLeaks(r.body);
  assert.equal(store.privilegeDeniedStats().failures, 1); assert.equal(store.privilegeDeniedStats().pending, 1);
  assert.equal(store.undoable, false);
});

test('security metadata and CSV are accessible only to administrators or Full Access audit tools', async (t) => {
  const { store, request, login, tool, data, url } = await setup(t, {}, true);
  scripts(store); const token = await login();
  await request(`${data}/layouts/T/script/Terminal`, 'GET', undefined, token);
  for (const path of ['/security-events', '/audit']) {
    const denied = await request(`/tabularius/admin/v1${path}?database=Scratch`, 'GET', undefined, token);
    assert.equal(denied.status, 401); assert.ok(!JSON.stringify(denied.body).includes('records.delete'));
  }
  const denied = await tool('audit_log', {}); assert.equal(denied.isError, true); assert.ok(!denied.content[0].text.includes('records.delete'));
  store.setPassword('full', 'pw', '[Full Access]');
  const allowed = await tool('audit_log', {}, 'Basic ' + btoa('full:pw'));
  assert.equal(allowed.isError, undefined); assert.match(allowed.content[0].text, /privilege-denied/);
  const signIn = await fetch(url + '/tabularius/admin/v1/sign-in', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ password: 'adminpw' }) });
  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.get('set-cookie')!.split(';')[0];
  const feed = await fetch(url + '/tabularius/admin/v1/security-events?database=Scratch&category=Privilege%20sets', { headers: { cookie, 'x-tabularius-admin': '1' } });
  const events = (await feed.json()).events;
  const event = events.find((e: { kind: string }) => e.kind === 'privilege-denied');
  assert.equal(event.category, 'Privilege sets'); assert.equal(event.severity, 'notice'); assert.match(event.description, /records.delete/);
  const csv = await fetch(url + '/tabularius/admin/v1/security-events?database=Scratch&kind=privilege-denied&format=csv', { headers: { cookie, 'x-tabularius-admin': '1' } });
  const text = await csv.text(); assert.match(text, /detail/); assert.match(text, /""policyFingerprint""/);
  for (const sentinel of [SECRET, SUBMITTED, 'exception-sentinel', 'record-label-sentinel']) assert.ok(!text.includes(sentinel));
});


test('hostile configuration names are escaped when the admin feed renders descriptions', () => {
  const source = readFileSync(join(import.meta.dirname, '../admin/index.html'), 'utf8');
  const expression = /^const esc = (.+);$/m.exec(source)![1];
  const escape = new Function(`return (${expression})`)() as (s: string) => string;
  const hostile = 'Edit refused for “<img src=x onerror="alert(1)">”: tables.<script>.delete';
  assert.equal(escape(hostile), 'Edit refused for “&lt;img src=x onerror=&quot;alert(1)&quot;&gt;”: tables.&lt;script&gt;.delete');
  assert.ok(source.includes('${esc(x.description)}'));
});


test('queued server scripts retain their operation collector even when the queue loses request context', async (t) => {
  const { store, host, request, login, tool, data } = await setup(t);
  scripts(store);
  store.applyDesign([{ op: 'createScript', name: 'Awaited handled', text: 'Perform Script on Server [ “Handled” ]\nExit Script [ Text Result: Get ( ScriptResult ) ]' }]);
  const options = host.scriptOptions.bind(host);
  t.mock.method(host, 'scriptOptions', () => ({ ...options(), serverQueue: {
    run: <T>(fn: (stop?: AbortSignal) => Promise<T>) => denialOperation.exit(fn),
  } }));
  const token = await login();
  const r = await request(`${data}/layouts/T/script/Awaited%20handled`, 'GET', undefined, token);
  assert.equal(r.body.response.scriptError, '0'); assert.match(r.body.response.scriptResult, /record-delete/);
  assert.ok(!r.body.response['tabularius:denial']);
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 1);
  const mcp = await tool('run_script', { script: 'Awaited handled', layout: 'T' });
  const run = JSON.parse(mcp.content[0].text); assert.equal(run.error, 0); assert.ok(!run.denial);
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 2);
});

test('Data API concealed and nonexistent create/update fields are equivalent, untagged and unlogged in both payload orders', async (t) => {
  const { store, id, request, login, data } = await setup(t, { records: { ...OPEN, edit: false, create: false, fields: { Secret: 'none', A: 'viewOnly' } } });
  const token = await login();
  const normalize = (value: unknown) => JSON.stringify(value).replace(/Secret|Absent/g, 'target');
  for (const isolation of [false, true]) {
    store.setPiiIsolation(isolation);
    for (const create of [false, true]) for (const first of [false, true]) {
      const responses = [];
      for (const target of ['Secret', 'Absent']) {
        const fields = first ? { [target]: SUBMITTED, A: SUBMITTED } : { A: SUBMITTED, [target]: SUBMITTED };
        responses.push(await request(`${data}/layouts/T/records${create ? '' : `/${id}`}`, create ? 'POST' : 'PATCH', { fieldData: fields }, token));
      }
      assert.equal(normalize(responses[0]), normalize(responses[1]));
      for (const response of responses) {
        assert.equal(response.body.messages[0].code, '201'); assert.ok(!response.body['tabularius:denial']); noLeaks(response);
      }
      assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 0);
    }
  }
});


test('collector suppression uses capture-time trial provenance while production flushes wait for an unrelated trial', async (t) => {
  const { store, id } = await setup(t, { records: { ...OPEN, edit: false } });
  const refuse = () => {
    try { store.update('T', id, { A: SUBMITTED }, undefined, { privileges: store.privileges('clerk') }); }
    catch (e) { assert.ok(e instanceof StoreError && e.denial); return e; }
    assert.fail('expected refusal');
  };
  const productionError = refuse();
  const trial = store.trial();
  const diagnosticError = refuse();
  const production = new DenialCollector('web', 'request'); production.error(productionError); production.flush();
  assert.equal(store.privilegeDeniedStats().pending, 1);
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 0);
  trial.undo();
  const diagnostic = new DenialCollector('mcp', 'update_record'); diagnostic.error(diagnosticError); diagnostic.flush();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 1);
  assert.equal(store.privilegeDeniedStats().drops, 0);
});

import { signInForm } from './oauth-form.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { StoreError } from '../../store/src/index.ts';
import { Profiler } from '../src/profiler.ts';
import { SCRATCH_MAX_BYTES, dropScratch, scratchCopy } from '../src/debug.ts';
import { RunProfile, ScriptDebugger, runScript, type DebugPoint } from '../../scripts/src/index.ts';
import { redactCredentialStep } from '../../scripts/src/redaction.ts';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-inactive-round2-'));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  const store = served.host.create('Local');
  store.setAiPolicy(false); // inactive accounts under test, not the AI policy
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'text' }, { name: 'Password', type: 'text' }, { name: 'Input Value', type: 'text' }] },
    { op: 'createScript', name: 'Write', text: 'New Record/Request\nSet Field [ T::Value ; "written" ]\nCommit Records/Requests [ With dialog: Off ]' },
    { op: 'updateScript', script: 'Write', includeInMenu: true },
  ]);
  store.setPassword('Admin', 'admin-secret', '[Full Access]');
  store.setPassword('Worker', 'worker-secret', '[Full Access]');
  store.setPassword('Other', 'other-secret', '[Full Access]');
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  const basic = (account: string) => 'Basic ' + Buffer.from(`${account}:${account.toLowerCase()}-secret`).toString('base64');
  const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(served.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const tool = async (name: string, args: object, account = 'Worker') => (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { authorization: basic(account), accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' })).json();
  const login = async (client = 'rest', account = 'Worker') => {
    const response = await post(`/fmi/data/vLatest/databases/Local/sessions${client === 'web' ? '?client=web' : ''}`, {}, { authorization: basic(account) });
    assert.equal(response.status, 200, await response.clone().text());
    return { authorization: `Bearer ${(await response.json()).response.token}` };
  };
  return { ...served, dir, store, basic, post, tool, login, async done() {
    await new Promise<void>((r) => served.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  } };
}

for (const path of ['MCP', 'Data API', 'web client', 'OData']) test(`${path} run retains its initiating account at every step boundary`, async () => {
  const f = await fixture();
  try {
    const options = f.host.scriptOptions();
    let boundary = false;
    f.host.scriptOptions = () => ({ ...options, debug: async (point: DebugPoint) => {
      if (point.index === 1) { boundary = true; f.store.setAccountActive('Worker', false); }
    } });
    let result: unknown;
    if (path === 'MCP') result = await f.tool('run_script', { database: 'Local', script: 'Write', trace: true });
    else if (path === 'Data API') {
      const auth = await f.login();
      result = await (await fetch(f.url + '/fmi/data/vLatest/databases/Local/layouts/T/script/Write', { headers: auth })).json();
    } else if (path === 'OData') {
      result = await (await f.post('/fmi/odata/v4/Local/Script.Write', {}, { authorization: f.basic('Worker') })).json();
    } else {
      const auth = await f.login('web');
      result = await (await f.post('/tabularius/app/v1/databases/Local/layouts/T/button', { scriptId: f.store.schema.scripts.find((s) => s.name === 'Write')!.id }, auth)).json();
    }
    assert.equal(boundary, true, JSON.stringify(result));
    assert.match(JSON.stringify(result), /212/, JSON.stringify(result));
    assert.deepEqual(f.store.select('SELECT Value FROM T').rows, [[null]], 'completed creation remains; the next write is denied');
  } finally { await f.done(); }
});

for (const disabled of ['Worker', 'Other', 'Team']) test(`Re-Login keeps both principals eligible when ${disabled} is disabled`, async () => {
  const f = await fixture();
  try {
    f.store.setExternalAccount('Team', '[Full Access]');
    f.store.applyDesign([{ op: 'createScript', name: 'Switch', text: 'Re-Login [ Account Name: "Other" ; Password: "other-secret" ; With dialog: Off ]\nNew Record/Request\nSet Field [ T::Value ; "written" ]' }]);
    let relogged = false;
    await assert.rejects(runScript(f.store, 'Switch', {
      account: 'Worker', executionAccount: 'Worker', executionVia: 'Team', privileges: f.store.privileges('Worker', 'Team'),
      debug: async (point) => {
        if (point.index === 1) {
          assert.equal(point.lastError, 0, 'Re-Login succeeded');
          relogged = true;
          f.store.setAccountActive(disabled, false);
        }
      },
    }), { code: 212 });
    assert.equal(relogged, true);
    assert.deepEqual(f.store.select('SELECT Value FROM T').rows, []);
  } finally { await f.done(); }
});

test('deleting a mapped initiating person after Re-Login cannot fall back to the active mapping', async () => {
  const f = await fixture();
  try {
    f.store.setExternalAccount('Team', '[Full Access]');
    f.store.applyDesign([{ op: 'createScript', name: 'Mapped switch', text: 'Re-Login [ Account Name: "Other" ; Password: "other-secret" ; With dialog: Off ]\nNew Record/Request' }]);
    await assert.rejects(runScript(f.store, 'Mapped switch', {
      account: 'Worker', executionAccount: 'Worker', executionVia: 'Team', privileges: f.store.privileges('Worker', 'Team'),
      debug: async (point) => { if (point.index === 1) { assert.equal(point.lastError, 0); f.store.deleteAccount('Worker'); } },
    }), { code: 212 });
    assert.equal(f.store.accountInactive('Team'), false);
    assert.deepEqual(f.store.select('SELECT Value FROM T').rows, []);
  } finally { await f.done(); }
});

test('scratch debugger boundaries recheck the live initiating identity', async () => {
  const f = await fixture();
  const copy = await scratchCopy(f.store, SCRATCH_MAX_BYTES);
  try {
    const d = new ScriptDebugger({ pauseAtStart: true });
    assert.equal((await d.start(copy.store, 'Write', {
      account: 'Worker', executionAccount: 'Worker', executionStore: f.store, privileges: copy.store.privileges('Worker'),
    })).paused?.index, 0);
    assert.equal((await d.resume('into')).paused?.index, 1);
    f.store.setAccountActive('Worker', false);
    assert.equal((await d.resume('into')).error?.code, 212);
    assert.deepEqual(copy.store.select('SELECT Value FROM T').rows, [[null]]);
    assert.deepEqual(f.store.select('SELECT Value FROM T').rows, []);
  } finally { dropScratch(copy); await f.done(); }
});

test('server subscripts retain the original file and the Re-Login identity in that file', async () => {
  const f = await fixture();
  try {
    const target = f.host.create('Target');
    target.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Value', type: 'text' }] },
      { op: 'createScript', name: 'Write', text: 'New Record/Request\nSet Field [ T::Value ; "written" ]' },
    ]);
    target.setPassword('Admin', 'admin-secret', '[Full Access]');
    target.setPassword('Worker', 'worker-secret', '[Full Access]');
    target.setPassword('Other', 'other-secret', '[Full Access]');
    // The declared source permits entry; revocation in the source file must still stop the child.
    f.store.applyDesign([
      { op: 'createDataSource', name: 'Target', paths: ['file:Target'] },
      { op: 'createScript', name: 'Switch server', text: 'Re-Login [ Account Name: "Other" ; Password: "other-secret" ; With dialog: Off ]\nPerform Script on Server [ Specified: By name ; "Target::Write" ; Wait for completion: On ]' },
    ]);
    const create = target.create.bind(target);
    target.create = (...args) => { const record = create(...args); f.store.setAccountActive('Other', false); return record; };
    await assert.rejects(runScript(f.store, 'Switch server', { account: 'Worker', executionAccount: 'Worker', privileges: f.store.privileges('Worker') }), { code: 212 });
    assert.deepEqual(target.select('SELECT Value FROM T').rows, [[null]], 'the destination account stays active, but the authenticated source identity was revoked');
    assert.equal(target.accountInactive('Other'), false);
  } finally { await f.done(); }
});

test('shared credential policy protects variables fields URL and cURL auth in every runtime diagnostic', async () => {
  const f = await fixture();
  try {
    const secrets = ['synthetic-password-7391', 'synthetic-key-7392', 'synthetic-later-7393', 'synthetic-field-7394', 'synthetic-url-7395', 'synthetic-curl-7396'];
    const lines = [
      'Set Error Capture [ On ]',
      `Set Variable [ $Password ; Value: "${secrets[0]}" ]`,
      `Set Variable [ $apiKey ; Value: "${secrets[1]}" ]`,
      `Set Variable [ $input ; Value: "${secrets[2]}" ]`,
      'Set Variable [ $later ; Value: $input ]',
      'New Record/Request',
      `Set Field [ T::Input Value ; "${secrets[3]}" ]`,
      'Set Field [ T::Password ; T::Input Value ]',
      'Add Account [ Account Name: "New" ; Password: $later ; Privilege Set: "Missing" ]',
      `Insert from URL [ $result ; "https://user:${secrets[4]}@example.test/" ]`,
      'Set Error Logging [ On ; Custom Debug Info: $Password ]',
      'Go to Layout [ Layout Name: "Missing" ]',
      'Exit Script [ Result: Get ( LastError ) ]',
    ];
    f.store.applyDesign([{ op: 'createScript', name: 'Sensitive', text: lines.join('\n') }]);
    // Structured cURL options use the production slot consumed by Insert from URL.
    const script = f.store.schema.scripts.find((s) => s.name === 'Sensitive')!;
    const curl = `--user user:${secrets[5]} -u user:${secrets[5]} --header "Authorization: Bearer ${secrets[5]}"`;
    script.steps.splice(10, 0, { stepId: 160, name: 'Insert from URL', enabled: true,
      line: `Insert from URL [ $result ; "https://example.test/" ; cURL options: ${curl} ]`,
      params: { variable: '$result', calculation: '"https://example.test/"', slots: { 129: JSON.stringify(curl) } } });
    const serverProfile = new Profiler();
    const runProfile = new RunProfile();
    const stops: unknown[] = [];
    const result = await runScript(f.store, script, {
      account: 'Admin', privileges: f.store.privileges('Admin'), layout: 'T', trace: true, network: false, documents: join(f.dir, 'Documents'),
      profile: { step(...args) { serverProfile.step(...args); runProfile.step(...args); }, run: serverProfile.run.bind(serverProfile) },
      debug: async (point) => { stops.push({ line: point.line, previousError: point.previousError, variables: point.variables(), pending: point.pending(), watch: point.evaluate('$input') }); },
    });
    assert.ok(result.trace!.some((s) => s.error), 'failures reached diagnostics');
    const log = readFileSync(join(f.dir, 'Documents', 'ScriptErrors.log'), 'utf8');
    assert.match(log, /\t105\t/, 'an ordinary failed step reached the error log');
    const auth = await f.login('rest', 'Admin');
    const listing = await (await fetch(f.url + '/tabularius/debug/v1/databases/Local/scripts', { headers: auth })).json();
    const output = JSON.stringify([result.trace, stops, serverProfile.report(), runProfile.report(), log, listing]);
    for (const secret of secrets) assert.ok(!output.includes(secret), `diagnostics exposed ${secret}`);
    assert.ok(stops.some((s) => JSON.stringify(s).includes('‹redacted›')));
    for (const line of [lines[1], lines[2], lines[9], script.steps[10].line!, `Set Field [ T::Password ; "${secrets[0]}" ]`]) {
      const p = new Profiler(); const r = new RunProfile();
      p.step('Local', 'Direct', 0, line, 1, 0); r.step('Local', 'Direct', 0, line, 1, 0);
      for (const secret of secrets) assert.ok(!JSON.stringify([p.report(), r.report(), redactCredentialStep(line)]).includes(secret));
    }
  } finally { await f.done(); }
});

test('both profilers retain stronger suppression when a step is reused by an execute-only run', () => {
  const secret = 'synthetic-opaque-literal-7691';
  const line = `Set Variable [ $ordinary ; Value: "${secret}" ]`;
  const safe = 'Set Variable [ ‹redacted› ]';
  const p = new Profiler(); const r = new RunProfile();
  for (const diagnostic of [line, safe, line]) {
    p.step('Local', 'Opaque', 0, diagnostic, 1, 0);
    r.step('Local', 'Opaque', 0, diagnostic, 1, 0);
  }
  assert.ok(!JSON.stringify([p.report(), r.report()]).includes(secret));
});

test('ordinary and unexpected step errors cannot quote known runtime credentials', async () => {
  const f = await fixture();
  try {
    const secret = 'synthetic-runtime-value-7591';
    f.store.applyDesign([{ op: 'createScript', name: 'Error values', text: `Set Variable [ $Password ; Value: "${secret}" ]\nNew Record/Request` }]);
    const original = f.store.create;
    for (const unexpected of [false, true]) {
      f.store.create = () => { throw unexpected ? new Error(secret) : new StoreError(999, secret); };
      if (unexpected) await assert.rejects(runScript(f.store, 'Error values', { account: 'Admin', privileges: f.store.privileges('Admin'), trace: true }), (e: Error) => !e.message.includes(secret));
      else {
        const result = await runScript(f.store, 'Error values', { account: 'Admin', privileges: f.store.privileges('Admin'), trace: true });
        assert.equal(result.error, 999);
        assert.ok(result.trace!.some((s) => s.error === 999));
        assert.ok(!JSON.stringify(result.trace).includes(secret));
      }
    }
    f.store.create = original;
    for (const line of [`Insert from URL "https://user:${secret}@example.test/"`, `Insert from URL --user user:${secret}`, `Insert from URL -u user:${secret}`, `Insert from URL Authorization: Bearer ${secret}`]) {
      assert.ok(!redactCredentialStep(line).includes(secret), 'malformed or unbracketed authentication inputs are also hidden');
    }
  } finally { await f.done(); }
});

test('execute-only MCP diagnostics suppress literals even when credential provenance is unavailable', async () => {
  const f = await fixture();
  try {
    f.store.savePrivilegeSet({ name: 'Execute', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'] });
    f.store.setPassword('Reader', 'reader-secret', 'Execute');
    const literal = 'synthetic-unknown-input-7491';
    f.store.applyDesign([{ op: 'createScript', name: 'Opaque', text: `Set Variable [ $innocent ; Value: "${literal}" ]\nGo to Layout [ Layout Name: "Missing" ]` }]);
    const source = await f.tool('get_script', { database: 'Local', script: 'Opaque' }, 'Reader');
    assert.equal(source.result.isError, true);
    const run = await f.tool('run_script', { database: 'Local', script: 'Opaque', trace: true }, 'Reader');
    assert.ok(!run.result.isError, JSON.stringify(run));
    const result = JSON.parse(run.result.content[0].text);
    assert.equal(result.error, 105);
    assert.ok(!JSON.stringify(run).includes(literal));
    assert.equal(result.trace, undefined, 'execute-only callers cannot receive a script trace');
    assert.match(result.traceRefusal, /debugging needs \[Full Access\]/);
  } finally { await f.done(); }
});

for (const grant of ['authorization_code', 'refresh_token']) test(`OAuth ${grant} refuses tokens after deactivation or account deletion`, async () => {
  const f = await fixture();
  try {
    const redirect = 'https://example.test/callback';
    const request = (path: string, fields: Record<string, string>) => fetch(f.url + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), redirect: 'manual' });
    const register = await f.post('/oauth/register', { client_name: 'Regression client', redirect_uris: [redirect] });
    assert.equal(register.status, 201);
    const { client_id } = await register.json();
    for (const change of ['inactive', 'missing']) {
      f.store.setAccountActive('Worker', true);
      const verifier = 'v'.repeat(43);
      const signIn = await signInForm(f.url, { client_id, redirect_uri: redirect, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', database: 'Local', account: 'Worker', password: 'worker-secret' });
      assert.equal(signIn.status, 302, await signIn.clone().text());
      const code = new URL(signIn.headers.get('location')!).searchParams.get('code')!;
      let fields = { grant_type: grant, client_id, code, code_verifier: verifier, redirect_uri: redirect } as Record<string, string>;
      if (grant === 'refresh_token') {
        const exchange = await request('/oauth/token', { ...fields, grant_type: 'authorization_code' });
        assert.equal(exchange.status, 200);
        fields = { grant_type: grant, client_id, refresh_token: (await exchange.json()).refresh_token };
      }
      if (change === 'inactive') f.store.setAccountActive('Worker', false);
      else f.store.deleteAccount('Worker');
      const before = f.store.apiTokens().length;
      const accessIds = f.store.apiTokens().map((t) => t.id);
      const refused = await request('/oauth/token', fields);
      const body = await refused.json();
      assert.equal(refused.status, 400, JSON.stringify(body));
      assert.equal(body.error, 'invalid_grant');
      assert.equal(body.access_token, undefined);
      assert.equal(body.refresh_token, undefined);
      assert.ok(f.store.apiTokens().length <= before, 'no access token was issued');
      if (grant === 'refresh_token' && change === 'inactive') assert.deepEqual(f.store.apiTokens().map((t) => t.id), accessIds, 'eligibility is checked before using the refresh credential or rotating access');
    }
  } finally { await f.done(); }
});

test('an account made inactive during the final step still halts the run', async () => {
  const f = await fixture();
  try {
    f.store.applyDesign([{ op: 'createScript', name: 'Last', text: 'Set Field [ T::Value ; "written" ]' }]);
    f.store.create('T', { Value: 'original' });
    let inStep = false;
    await assert.rejects(runScript(f.store, 'Last', {
      layout: 'T', account: 'Worker', executionAccount: 'Worker', privileges: f.store.privileges('Worker'),
      debug: async () => { inStep = true; },
      beforeFile: () => { if (inStep) { inStep = false; f.store.setAccountActive('Worker', false); } },
    }), { code: 212 });
    assert.equal(f.store.get('T', f.store.findIds('T')[0]).fieldData.Value, 'original');
  } finally { await f.done(); }
});

test('an isolation refusal comes before any account lookup in the refused file', async () => {
  const f = await fixture();
  try {
    f.store.setExternalAccount('Team', '[Full Access]');
    f.store.applyDesign([{ op: 'createScript', name: 'Refused', text: 'Set Variable [ $x ; 1 ]' }]);
    let looked = 0;
    let atRefusal = -1;
    let calls = 0;
    const accounts = f.store.accounts.bind(f.store);
    f.store.accounts = ((...a: Parameters<typeof accounts>) => { looked++; return accounts(...a); }) as typeof f.store.accounts;
    const r = await runScript(f.store, 'Refused', {
      account: 'Worker', executionAccount: 'Worker', executionVia: 'Team', privileges: f.store.privileges('Worker', 'Team'),
      debug: async () => { calls = 1; looked = 0; },
      beforeFile: () => { if (calls) { atRefusal = looked; throw new StoreError(3, 'Isolated'); } },
    });
    assert.equal(r.error, 3);
    assert.equal(atRefusal, 0);
  } finally { await f.done(); }
});

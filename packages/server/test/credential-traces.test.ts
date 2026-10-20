import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { Profiler } from '../src/profiler.ts';
import { explainScriptFailure } from '../src/script-failure.ts';
import { redactCredentialStep } from '../../scripts/src/redaction.ts';
import { RunProfile, ScriptDebugger, runScript } from '../../scripts/src/index.ts';

test('ExecuteSQL credential results stay redacted in Full Access traces, debugger variables and failure reports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-credential-traces-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Password' }, { name: 'Note' }] },
      { op: 'createField', table: 'T', name: 'Hint', kind: 'calculation', type: 'text', calculation: 'Note' },
    ]);
    const secret = 'Q7v9z2Lm4N8k6R1x';
    const row = store.create('T', { Password: secret, Note: 'ordinary' });
    const cases = [
      ['plain', 'ExecuteSQL ( "SELECT Password FROM T" ; "" ; "" )', '‹redacted›'],
      ['left', 'Left ( ExecuteSQL ( "SELECT Password FROM T" ; "" ; "" ) ; 8 )', '‹redacted›'],
      ['stitched', 'ExecuteSQL ( "SELECT Pass" & "word FROM T" ; "" ; "" )', '‹redacted›'],
      ['star', 'ExecuteSQL ( "SELECT * FROM T" ; "|" ; "" )', '‹redacted›'],
      ['ordinary', 'ExecuteSQL ( "SELECT Note FROM T" ; "" ; "" )', 'ordinary'],
      ['count', 'ExecuteSQL ( "SELECT COUNT(*) FROM T" ; "" ; "" )', '1'],
    ] as const;
    for (const [name, formula, expected] of cases) {
      store.applyDesign([{ op: 'createScript', name, text: `Set Variable [ $x ; Value: ${formula} ]\nSet Field [ T::Hint ; "ordinary" ]` }]);
      const debugger_ = new ScriptDebugger({ pauseAtStart: true });
      const opts = { account: 'Admin', privileges: store.privileges('Admin'), layout: 'T', recordId: Number(row.recordId), trace: true };
      await debugger_.start(store, name, opts);
      const paused = await debugger_.resume('into');
      assert.equal(paused.paused?.variables.locals.$x, expected, name);
      assert.equal(debugger_.evaluate('$x').value, expected, name);
      const done = await debugger_.resume('continue');
      assert.ok(!JSON.stringify(done.done?.trace).includes(secret), name);
      const failure = await explainScriptFailure(store, { script: name, layout: 'T', recordId: Number(row.recordId) }, { account: 'Admin' });
      assert.equal(failure.outcome, 'error', name);
      assert.equal(failure.variables?.locals.$x, expected, name);
      assert.ok(!JSON.stringify(failure).includes(secret), name);
    }
    // A credential name inside SQL text also protects a failed step's message.
    store.applyDesign([{ op: 'createScript', name: 'leftFailure', text:
      'Set Field [ T::Hint ; Left ( ExecuteSQL ( "SELECT Password FROM T" ; "" ; "" ) ; 8 ) ]' }]);
    const failed = new ScriptDebugger();
    const outcome = await failed.start(store, 'leftFailure', {
      account: 'Admin', privileges: store.privileges('Admin'), layout: 'T', recordId: Number(row.recordId), trace: true,
    });
    assert.equal(outcome.done?.trace?.[0]?.line, 'Set Field [ ‹redacted› ]');
    assert.equal(outcome.done?.trace?.[0]?.message, 'Credential step failed');
    const explained = await explainScriptFailure(store, { script: 'leftFailure', layout: 'T', recordId: Number(row.recordId) }, { account: 'Admin' });
    assert.equal(explained.step?.line, 'Set Field [ ‹redacted› ]');
    assert.equal(explained.message, 'Credential step failed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a 5,000-cell SELECT * cannot expose a later direct credential read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sql-credential-budget-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  try {
    const notes = Array.from({ length: 10 }, (_, i) => `Note${i}`);
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Password' }, ...notes.map((name) => ({ name })),
      { name: 'Hint', kind: 'calculation', type: 'text', calculation: 'Note0' }] }]);
    const secret = 'Q7v9z2Lm4N8k6R1x';
    const row = store.create('T', { Password: secret });
    for (let i = 0; i < 500; i++) store.create('T', Object.fromEntries(notes.map((name, j) => [name, `ordinary-${i}-${j}`])));
    store.applyDesign([{ op: 'createScript', name: 'BulkThenRead', text: [
      'Set Variable [ $bulk ; Value: ExecuteSQL ( "SELECT * FROM T" ; "|" ; "¶" ) ]',
      'Set Variable [ $x ; Value: T::Password ]',
      'Set Field [ T::Hint ; "ordinary" ]',
    ].join('\n') }]);
    const debugger_ = new ScriptDebugger({ pauseAtStart: true });
    await debugger_.start(store, 'BulkThenRead', { account: 'Admin', privileges: store.privileges('Admin'),
      layout: 'T', recordId: Number(row.recordId), trace: true });
    await debugger_.resume('into');
    const paused = await debugger_.resume('into');
    assert.equal(paused.paused?.variables.locals.$x, '‹redacted›');
    const done = await debugger_.resume('continue');
    assert.ok(done.done?.trace?.some((step) => step.line === 'Set Variable [ ‹redacted› ]'));
    assert.ok(!JSON.stringify(done).includes(secret));
    const failure = await explainScriptFailure(store, { script: 'BulkThenRead', layout: 'T', recordId: Number(row.recordId) }, { account: 'Admin' });
    assert.equal(failure.variables?.locals.$x, '‹redacted›');
    assert.ok(!JSON.stringify(failure).includes(secret));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('credential parameters are redacted in MCP traces profiles debugger and diagnostics on success and failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-credential-traces-'));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const store = served.host.create('Local');
    store.setAiPolicy(false); // credential redaction under test, not the AI policy's refusal
    store.setPassword('Admin', 'admin-secret', '[Full Access]');
    store.setPassword('TraceAdmin', 'trace-secret', '[Full Access]');
    store.savePrivilegeSet({ name: 'Execute', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp', 'fmrest'] });
    store.setPassword('Reader', 'reader-secret', 'Execute');
    const secret = 'synthetic-credential-4938';
    const lines = [
      `Add Account [ Account Name: "New" ; Password: "${secret}" ; Privilege Set: "Execute" ]`,
      `Change Password [ Old Password: "${secret}" ; New Password: "${secret}" ; With dialog: Off ]`,
      `Reset Account Password [ Account Name: "Admin" ; New Password: "${secret}" ]`,
      `Re-Login [ Account Name: "Admin" ; Password: "${secret}" ; With dialog: Off ]`,
      `Configure AI Account [ Account Name: "Service" ; API Key: "${secret}" ]`,
    ];
    const text = 'Set Error Capture [ On ]\n' + lines.join('\n') + '\nExit Script [ Result: Get ( LastError ) ]';
    store.applyDesign([{ op: 'createScript', name: 'Credentials', text }]);
    const profile = new Profiler();
    const runProfile = new RunProfile();
    const reader = store.privileges('Reader');
    const opts = { account: 'Reader', privileges: reader, trace: true, profile: {
      step(file: string, script: string, index: number, line: string, ms: number, error: number) {
        profile.step(file, script, index, line, ms, error);
        runProfile.step(file, script, index, line, ms, error);
      },
      run: profile.run.bind(profile), enter: runProfile.enter.bind(runProfile), leave: runProfile.leave.bind(runProfile),
    } };
    const debugger_ = new ScriptDebugger({ pauseAtStart: true });
    const states = [await debugger_.start(store, 'Credentials', opts)];
    while (debugger_.running) states.push(await debugger_.resume('into'));
    const trace = states.at(-1)!.done!.trace!;
    assert.ok(trace.some((line) => line.error === 9), 'failed account steps were traced');
    assert.ok(trace.some((line) => line.line.startsWith('Configure AI Account') && !line.error), 'successful credential steps were traced');
    const diagnostic = await explainScriptFailure(store, { script: 'Credentials' }, { account: 'Reader', privileges: reader });
    const response = await fetch(served.url + '/mcp', {
      method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('TraceAdmin:trace-secret').toString('base64'), 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { database: 'Local', script: 'Credentials', trace: true } } }),
    });
    const body = await response.json();
    assert.ok(!body.result.isError, JSON.stringify(body));
    const mcp = JSON.parse(body.result.content[0].text);
    assert.ok(mcp.trace.some((line: { line: string }) => line.line === redactCredentialStep(lines[0])));
    const login = await fetch(served.url + '/fmi/data/vLatest/databases/Local/sessions', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('TraceAdmin:trace-secret').toString('base64') }, body: '{}' });
    const token = (await login.json()).response.token;
    const listing = await (await fetch(served.url + '/tabularius/debug/v1/databases/Local/scripts', { headers: { authorization: `Bearer ${token}` } })).json();
    const all = JSON.stringify([states, profile.report(), runProfile.report(), diagnostic, mcp, listing]);
    assert.ok(!all.includes(secret), all);
    for (const line of lines) {
      assert.ok(all.includes(redactCredentialStep(line)), line);
      // Formula expressions, multiline and malformed parameters are hidden as well.
      assert.equal(redactCredentialStep(line.replace(`"${secret}"`, '$password & "suffix"')), redactCredentialStep(line));
    }
    assert.equal(redactCredentialStep(`Add Account Password: ${secret}`), 'Add Account [ ‹redacted› ]');
    assert.equal(redactCredentialStep(secret, 134), 'Add Account [ ‹redacted› ]');
    // An unexpected storage error may quote the credential; no raw error escapes through diagnostics.
    const original = store.setPassword;
    store.setPassword = () => { throw new Error(secret); };
    try {
      await assert.rejects(runScript(store, 'Credentials', { account: 'Admin', privileges: store.privileges('Admin'), trace: true }), (e: Error) => !e.message.includes(secret));
    } finally { store.setPassword = original; }
    store.applyDesign([{ op: 'createScript', name: 'Logged', text: `Set Error Logging [ On ; Custom Debug Info: "${secret}" ]\n${lines[0].replace('Privilege Set: "Execute"', 'Privilege Set: "Missing"')}` }]);
    await runScript(store, 'Logged', { account: 'Admin', privileges: store.privileges('Admin'), documents: join(dir, 'Documents') });
    assert.ok(!readFileSync(join(dir, 'Documents', 'ScriptErrors.log'), 'utf8').includes(secret));
  } finally {
    await new Promise<void>((r) => served.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

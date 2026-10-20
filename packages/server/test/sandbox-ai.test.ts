import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { offlineScriptOptions, runScript, runScriptTests, dryRunScript, testScripts, type RunOptions } from '../../scripts/src/index.ts';
import { body, calls, grep, nodes, parse, source, ts } from '../../scripts/test/sandbox-support.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../../scripts/src/test-only.ts';

let dir: string;
let host: Host;
let client: Client;
let mcp: ReturnType<typeof createMcpServer>;
const sent: string[] = [];
const fetchProbe: typeof fetch = async () => { sent.push('fetch'); return new Response('sent'); };
const networkText = 'Set Error Capture [ On ]\nInsert from URL [ $answer ; "https://allowed.example/" ]';
const mailText = 'Set Error Capture [ On ]\nSend Mail [ Send via SMTP Server ; With dialog: Off ; To: "recipient@example.test" ; Subject: "Probe" ; Message: "test" ]';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-ai-'));
  host = new Host(dir, () => {}, { background: false });
  const store = host.create('AI');
  store.setAiPolicy(false); // Exercise the offline boundary even when the administrator allows AI execution.
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Network', text: networkText },
    { op: 'createScript', name: 'Mail', text: mailText },
    { op: 'createScript', name: 'Connection', text: 'Set Error Capture [ On ]\nInsert from URL [ $answer ; "connection://approved/path" ]' },
    { op: 'createScript', name: 'CURL', text: [
      'Set Variable [ $h ; Value: MBS ( "CURL.New" ) ]',
      'Set Variable [ $r ; Value: MBS ( "CURL.SetOptionURL" ; $h ; "https://allowed.example/" ) ]',
      'Exit Script [ MBS ( "CURL." & "Perform" ; $h ) ]',
    ].join('\n') },
    { op: 'createScript', name: 'Model', steps: [
      { stepId: 212, name: 'Configure AI Account', enabled: true, params: { ai: { accountName: '"probe"' } } },
      { stepId: 220, name: 'Generate Response from Model', enabled: true, params: { ai: { accountName: '"probe"', model: '"m"', input: '"hello"' }, variable: '$answer' } },
    ] },
  ]);
  host.scriptNetwork = true;
  mcp = createMcpServer(host);
  client = new Client({ name: 'sandbox-regression', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcp.connect(st); await client.connect(ct);
});
after(async () => { await client?.close(); await mcp?.close(); await host?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function capabilities(): RunOptions {
  return { ...host.scriptOptions(), network: true, outbound: { allowHosts: ['allowed.example'], fetch: fetchProbe,
    record: () => { sent.push('outbox'); }, deliver: async () => { sent.push('delivery'); } },
    mail: async () => { sent.push('mail'); }, ai: { refusal: () => undefined, generate: async () => { sent.push('ai'); return 'sent'; } } };
}
async function tool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: { database: 'AI', ...args, network: true, outbound: true } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text);
}

test('named offline guard strips every outbound capability after caller options', () => {
  const options = { ...capabilities(), installPlugin: () => { sent.push('install'); return { id: 'probe', version: '1', signer: 'none' }; } };
  const guarded = offlineScriptOptions(options);
  assert.equal(guarded.network, false);
  for (const key of ['outbound', 'mail', 'ai', 'installPlugin'] as const) assert.equal(guarded[key], undefined, key);
  assert.equal(guarded.documents, options.documents);
  assert.equal(options.network, true, 'does not mutate the operator options');
});

test('run_script and both debug_script modes stay offline with every server capability enabled', async (t) => {
  const options = capabilities();
  t.mock.method(host, 'scriptOptions', () => options);
  t.mock.method(globalThis, 'fetch', fetchProbe);
  sent.length = 0;
  for (const script of ['Network', 'Mail', 'Connection', 'Model']) {
    const run = await tool('run_script', { script, trace: true });
    assert.equal(run.error, 3, JSON.stringify(run));
    for (const scratch of [false, true]) {
      const debug = await tool('debug_script', { script, scratch });
      assert.match(JSON.stringify(debug), /"error":3/);
    }
  }
  assert.match((await tool('run_script', { script: 'CURL' })).result, /network access is off/);
  for (const scratch of [false, true]) {
    assert.match((await tool('debug_script', { script: 'CURL', scratch })).result.result, /network access is off/);
  }
  assert.deepEqual(sent, []);
  // Positive control: the identical network step with ordinary operator options does use the transport.
  const direct = await runScript(host.get('AI')!, 'Network', { network: fetchProbe, [TEST_ONLY_CUSTOM_FETCH]: true });
  assert.equal(direct.error, 0);
  assert.deepEqual(sent, ['fetch']);
  assert.equal((await runScript(host.get('AI')!, 'Model', { ai: options.ai })).error, 0);
  assert.deepEqual(sent, ['fetch', 'ai']);
});

test('AI design trials, failure explanations and script test tooling stay offline', async (t) => {
  const options = capabilities();
  t.mock.method(host, 'scriptOptions', () => options);
  t.mock.method(globalThis, 'fetch', fetchProbe);
  sent.length = 0;
  const store = host.get('AI')!;
  for (const [script, text] of [['Network', networkText], ['Mail', mailText]]) {
    const trial = await tool('try_design_change', { changes: [{ op: 'updateScript', script, text }], scripts: [script] });
    assert.equal(trial.runs[0].run.error, 3, JSON.stringify(trial));
    const failure = await tool('explain_script_failure', { script });
    assert.equal(failure.error, 3, JSON.stringify(failure));
    const id = store.schema.scripts.find((s) => s.name === script)!.id;
    const outcomes = await runScriptTests(store, [{ id: script, script: id, name: script, given: {}, expect: { error: 3 } }]);
    assert.equal(outcomes[0].passed, true, JSON.stringify(outcomes));
    assert.equal((await dryRunScript(store, id, {})).ended.error, 3);
  }
  const smoke = await testScripts(store, { scripts: ['Network', 'Mail'] });
  assert.deepEqual(smoke.map((r) => r.error), [3, 3]);
  assert.deepEqual(sent, []);
});

test('source grep inventories AI execution entry points and checks the final options guard', (t) => {
  // Grep all MCP source files, so a new tool/file that starts scripts cannot silently bypass this inventory.
  const hits = grep('packages/server/src', /(?:\brunScript\(|\b\w+\.start\(|\bdryRunChanges\(|\bexplainScriptFailure\()/g)
    .filter((e) => /\/mcp[^/]*\.ts$/.test(e.file));
  t.diagnostic(JSON.stringify(hits));
  assert.deepEqual(hits, [
    { file: 'packages/server/src/mcp-design.ts', match: 'dryRunChanges(' },
    { file: 'packages/server/src/mcp.ts', match: 'runScript(' },
    { file: 'packages/server/src/mcp.ts', match: 'd.start(' },
    { file: 'packages/server/src/mcp.ts', match: 'explainScriptFailure(' },
  ]);
  for (const [file, count] of [['server/src/mcp.ts', 2], ['server/src/dry-run.ts', 1], ['server/src/script-failure.ts', 1]] as const) {
    const tree = parse(source(`packages/${file}`));
    const entries = calls(tree, /^(runScript|d\.start)$/);
    assert.equal(entries.length, count, file);
    for (const entry of entries) {
      const options = entry.arguments[2];
      assert.ok(ts.isCallExpression(options) && options.expression.getText() === 'offlineScriptOptions', `${file}: ${entry.expression.getText()} must guard the final options`);
    }
  }
  const cases = parse(source('packages/scripts/src/script-tests.ts'));
  const runners = calls(cases, /^runScript$/);
  assert.equal(runners.length, 2, 'setup and main script');
  const base = nodes(body(cases, 'runCase'), ts.isVariableDeclaration).find((n) => n.name.getText() === 'base')!;
  assert.equal(calls(base, /^offlineScriptOptions$/).length, 1);
  for (const runner of runners) assert.match(runner.arguments[2].getText(), /^\{\s*\.\.\.base/);
  const smoke = parse(source('packages/scripts/src/testrun.ts'));
  assert.equal(calls(smoke, /^runScript$/).length, 1);
  assert.equal(calls(calls(smoke, /^runScript$/)[0].arguments[2], /^offlineScriptOptions$/).length, 1);
});

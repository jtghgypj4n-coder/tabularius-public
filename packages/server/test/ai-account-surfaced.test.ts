import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { StepParams } from '@tabularius/fmp12';
import { runScript, ScriptSession } from '@tabularius/scripts';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { conversionReport } from '../src/conversion.ts';
import { conversionGuide } from '../src/conversion-guide.ts';
import { HISTORY, Schedules } from '../src/schedules.ts';

const accountWarning = "Configure AI Account: the endpoint, key and model in this step are not used; this server's own model answers.";
const loggingWarning = 'Set AI Call Logging does nothing here';
const title = "AI steps run on this server's model";
const step = (stepId: number, params?: StepParams) => ({ stepId, params });
const configure = step(212, { ai: { accountName: '"account"', model: '"ignored"' } });

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-account-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Synthetic');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return { host, store };
}

test('guide and report count two AI steps across scripts and explain the server configuration', (t) => {
  const { store } = setup(t);
  store.applyDesign([
    { op: 'createScript', name: 'Configure', steps: [configure] },
    { op: 'createScript', name: 'Embed', steps: [step(215)] },
  ]);
  const report = conversionReport(store);
  assert.deepEqual(report.aiSteps, { count: 2, where: ['Script "Configure", line 1', 'Script "Embed", line 1'] });
  assert.match(report.summary, /AI steps run on this server's model.*2 steps/);
  const guide = conversionGuide(store);
  const item = guide.differs.find((i) => i.title === title)!;
  assert.ok(item);
  assert.equal(item.severity, 'medium');
  assert.equal(item.count, 2);
  assert.deepEqual(item.where, report.aiSteps.where);
  assert.match(item.what, /endpoint, key and model.*not used/);
  assert.match(item.what, /server's own model answers/);
  assert.match(item.instead!, /--ai/);
  assert.match(item.instead!, /embedding model/);
  assert.match(item.instead!, /error 3/);
  assert.match(item.instead!, /admin console/);
  assert.match(guide.text, /AI steps run on this server's model.*medium; 2/);
});

test('all eleven AI step IDs count, disabled steps do not, and only the first five places are retained', (t) => {
  const { store } = setup(t);
  const ids = [212, 227, 217, 220, 221, 214, 215, 216, 218, 219, 226];
  store.applyDesign([{ op: 'createScript', name: 'All AI', steps: [...ids.map((id) => step(id)), { ...configure, enabled: false }] }]);
  const report = conversionReport(store);
  assert.equal(report.aiSteps.count, ids.length);
  assert.deepEqual(report.aiSteps.where, ids.slice(0, 5).map((_, i) => `Script "All AI", line ${i + 1}`));
  assert.deepEqual(conversionGuide(store).differs.find((i) => i.title === title)?.where, report.aiSteps.where);
  assert.deepEqual(conversionReport(store, [], (where) => where.endsWith('line 2')).aiSteps,
    { count: 1, where: ['Script "All AI", line 2'] });
});

test('each ignored account parameter warns without evaluating its formula', async (t) => {
  const { store } = setup(t);
  for (const field of ['endpoint', 'apiKey', 'model'] as const) {
    store.applyDesign([{ op: 'createScript', name: field, steps: [
      step(212, { ai: { accountName: '"account"', [field]: 'Let ( $$evaluated = 1 ; "unused" )' } }),
      step(103, { calculation: '$$evaluated' }),
    ] }]);
    const result = await runScript(store, field);
    assert.deepEqual(result.warnings, [accountWarning]);
    assert.equal(result.error, 0);
    assert.equal(result.result, '');
  }
});

test('warnings appear once per script per run, including loops and repeated subscript calls', async (t) => {
  const { store } = setup(t);
  const repeated = [configure, configure, step(217), step(217)];
  store.applyDesign([
    { op: 'createScript', name: 'Child', steps: repeated },
    { op: 'createScript', name: 'Parent', text: [
      'Set Variable [ $i ; Value: 0 ]', 'Loop', 'Perform Script [ "Child" ]',
      'Set Variable [ $i ; Value: $i + 1 ]', 'Exit Loop If [ $i = 3 ]', 'End Loop',
      'Configure AI Account [ Account Name: "account" ; Model: "ignored" ]', 'Set AI Call Logging [ On ]',
    ].join('\n') },
  ]);
  const session = new ScriptSession();
  for (let i = 0; i < 2; i++) {
    const result = await runScript(store, 'Parent', { session });
    assert.equal(result.error, 0);
    assert.deepEqual(result.warnings, [accountWarning, loggingWarning, accountWarning, loggingWarning]);
  }
});

test('no AI steps means no guide item or warning; an account name alone also needs no warning', async (t) => {
  const { store } = setup(t);
  store.applyDesign([{ op: 'createScript', name: 'Plain', steps: [step(103, { calculation: '"done"' })] }]);
  assert.deepEqual(conversionReport(store).aiSteps, { count: 0, where: [] });
  assert.doesNotMatch(conversionReport(store).summary, /AI steps/);
  assert.ok(!conversionGuide(store).differs.some((i) => i.title === title));
  assert.equal((await runScript(store, 'Plain')).warnings, undefined);
  store.applyDesign([{ op: 'createScript', name: 'Name only', steps: [step(212, { ai: { accountName: '"account"' } })] }]);
  const session = new ScriptSession();
  const result = await runScript(store, 'Name only', { session });
  assert.equal(result.warnings, undefined);
  assert.equal(result.error, 0);
  assert.ok(session.ai.accounts.has('account'));
});

test('scheduled run results retain warnings after restart and after editing the scheduled script', async (t) => {
  const { host, store } = setup(t);
  store.applyDesign([
    { op: 'createScript', name: 'AI', steps: [configure, step(217), configure, step(217)] },
    { op: 'createScript', name: 'Plain', steps: [step(103, { calculation: '"done"' })] },
  ]);
  const schedules = new Schedules(host);
  t.after(() => schedules.stop());
  const schedule = schedules.create({ name: 'Probe', database: store.name, script: 'AI', account: 'Admin', enabled: false });
  const run = await schedules.run(schedule.id);
  assert.equal(run.error, 0);
  assert.deepEqual(run.warnings, [accountWarning, loggingWarning]);
  schedules.stop();
  const restarted = new Schedules(host);
  t.after(() => restarted.stop());
  assert.deepEqual(restarted.runs(schedule.id)[0].warnings, run.warnings);
  restarted.update(schedule.id, { script: 'Plain', everyMinutes: 30, at: '12:00' });
  assert.equal((await restarted.run(schedule.id)).warnings, undefined);
  assert.deepEqual(restarted.runs(schedule.id)[1].warnings, run.warnings);
});

test('MCP run_script returns retained warnings without a trace and omits them for a plain script', async (t) => {
  const { host, store } = setup(t);
  // The policy cannot determine Set AI Call Logging's read set; this synthetic file explicitly permits it.
  store.setAiPolicy(false);
  store.applyDesign([
    { op: 'createScript', name: 'AI', steps: [configure, configure, step(217), step(217)] },
    { op: 'createScript', name: 'Plain', steps: [step(103, { calculation: '"done"' })] },
  ]);
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'ai-account-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  for (const script of ['AI', 'Plain']) {
    const response = await client.callTool({ name: 'run_script', arguments: { database: store.name, script, trace: false } });
    assert.ok(!response.isError, JSON.stringify(response));
    const content = response.content as { text: string }[];
    const result = JSON.parse(content[0].text);
    assert.equal(result.error, 0);
    assert.equal(result.trace, undefined);
    assert.deepEqual(result.warnings, script === 'AI' ? [accountWarning, loggingWarning] : undefined);
  }
});

test('persisted schedule warnings and run history stay bounded without changing the script result', async (t) => {
  const { host, store } = setup(t);
  const scripts = Array.from({ length: 51 }, (_, i) => `Child ${i}`);
  store.applyDesign([
    ...scripts.map((name) => ({ op: 'createScript' as const, name, steps: [configure, step(217)] })),
    { op: 'createScript', name: 'Many', text: [...scripts.map((name) => `Perform Script [ "${name}" ]`), 'Exit Script [ Text Result: "done" ]'].join('\n') },
    { op: 'createScript', name: 'Plain', steps: [step(103, { calculation: '"done"' })] },
  ]);
  const schedules = new Schedules(host);
  t.after(() => schedules.stop());
  const schedule = schedules.create({ name: 'Bounded', database: store.name, script: 'Many', account: 'Admin', enabled: false });
  const result = await schedules.run(schedule.id);
  assert.equal(result.error, 0);
  assert.equal(result.result, 'done');
  assert.equal(result.warnings?.length, 100);
  schedules.stop();
  const restarted = new Schedules(host);
  t.after(() => restarted.stop());
  assert.deepEqual(restarted.runs(schedule.id)[0].warnings, result.warnings);
  restarted.update(schedule.id, { script: 'Plain' });
  for (let i = 0; i < HISTORY; i++) assert.equal((await restarted.run(schedule.id)).error, 0);
  assert.equal(restarted.runs(schedule.id).length, HISTORY);
  assert.ok(restarted.runs(schedule.id).every((run) => run.warnings === undefined));
});

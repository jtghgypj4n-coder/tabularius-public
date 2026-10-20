import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { Assistant } from '../src/assistant.ts';
import { modernizeChange } from '../src/modernize.ts';
import { runScript } from '../../scripts/src/index.ts';

function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-policy-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Password' }, { name: 'Name' }] }]);
  const assistant = new Assistant(host, undefined as never, { apiKey: 'test', imageEmbed: { provider: 'test', model: 'test', key: 'test' }, embedUrl: 'http://127.0.0.1:1', embedModel: 'test', baseUrl: 'http://127.0.0.1:1' });
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, assistant };
}
for (const name of ['chat', 'fillField', 'mapImport', 'suggestScriptTests', 'speedIdeas', 'handoverMemo', 'scriptDocs'] as const) test(`assistant ${name} refuses secret sources before model dispatch`, async (t) => {
  const { store, assistant } = fixture(t);
  const invoke = assistant[name].bind(assistant) as (...args: unknown[]) => Promise<unknown>;
  await assert.rejects(() => invoke(store, 'Admin', [], {}, store.privileges('Admin')), /AI policy.*refused/i);
});
test('modernize refuses secret sources', (t) => {
  const { store } = fixture(t);
  assert.throws(() => modernizeChange(store), /AI policy.*refused/i);
});
for (const name of ['generate', 'embed', 'embedImage', 'rag', 'ragAdd', 'ragRemove', 'ragSpaces', 'ragInfo'] as const) test(`script AI ${name} refuses even when a caller omits the advisory refusal check`, async (t) => {
  const { assistant } = fixture(t);
  const ai = assistant.scriptAi()!;
  const invoke = () => name === 'generate' ? ai.generate({ file: 'Shop', account: 'Admin', model: '', messages: [{ role: 'user', content: 'private' }] })
    : name === 'embed' ? ai.embed!({ file: 'Shop', account: 'Admin', model: '', texts: ['private'] })
    : name === 'embedImage' ? ai.embedImage!({ file: 'Shop', account: 'Admin', model: '', images: [] })
    : name === 'ragAdd' ? Promise.resolve().then(() => ai.rag!.add({ file: 'Shop', space: 'docs', chunks: ['private'], vectors: [[1]] }))
    : name === 'ragRemove' ? Promise.resolve().then(() => ai.rag!.remove({ file: 'Shop', space: 'docs' }))
    : name === 'ragSpaces' ? Promise.resolve().then(() => ai.rag!.spaces({ file: 'Shop' }))
    : name === 'ragInfo' ? Promise.resolve().then(() => ai.rag!.info({ file: 'Shop', space: 'docs' }))
    : Promise.resolve().then(() => ai.rag!.search({ file: 'Shop', space: 'docs', vector: [1], top: 1, threshold: 0 }));
  await assert.rejects(invoke, /AI policy.*refused/i);
});

test('known model steps with literal inputs have a static read set', async (t) => {
  const { store, assistant } = fixture(t);
  store.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Password' },
    { op: 'createScript', name: 'Safe model', text: 'Configure AI Account [ Account Name: "local" ; API Key: "unused" ]\nGenerate Response from Model [ Account Name: "local" ; Model: "test" ; Prompt: "Hello" ; Response: $answer ]' }]);
  assert.equal(assistant.scriptAi()!.refusal('Shop', 'Admin'), undefined);
});

test('existing file remains unchanged at every assistant, script AI, agent and modernize gate', async (t) => {
  const { store, assistant } = fixture(t);
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  const { aiRefusal } = await import('../src/ai-access.ts');
  for (const via of ['AI assistant', 'AI documentation', 'AI digest', 'AI import matching', 'AI test cases', 'AI replace', 'AI speed-up', 'AI app sign-in', 'script']) {
    assert.equal(aiRefusal(store, { account: 'Admin', via }), undefined, via);
  }
  const before = modernizeChange(store);
  assert.equal(assistant.scriptAi()!.refusal('Shop', 'Admin'), undefined);
  store.setAiPolicy(false);
  assert.deepEqual(modernizeChange(store), before);
  assert.equal(assistant.scriptAi()!.refusal('Shop', 'Admin'), undefined);
});

test('an unsaved script with Evaluate cannot dispatch to a model', async (t) => {
  const { store, assistant } = fixture(t);
  store.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Password' }]);
  const ai = assistant.scriptAi()!;
  let sent = 0;
  ai.generate = async () => { sent++; return 'unexpected'; };
  const script = { id: 999, name: 'Unsaved', steps: [
    { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$value', value: 'Evaluate ( "1" )' } },
    { stepId: 212, name: 'Configure AI Account', enabled: true, params: { ai: { accountName: '"local"' } } },
    { stepId: 220, name: 'Generate Response from Model', enabled: true, params: { ai: { accountName: '"local"', input: '$value' }, variable: '$answer' } },
  ] };
  const result = await runScript(store, script, { ai, account: 'Admin', trace: true });
  assert.equal(sent, 0);
  assert.match(JSON.stringify(result), /AI policy.*Evaluate/i);
});

for (const entry of ['refusal', 'generate'] as const) test(`F5: script AI ${entry} logs an absent account as null on legacy files`, async (t) => {
  const { store, assistant } = fixture(t);
  store.setAiPolicy(false);
  store.setAiAllowed(false);
  const ai = assistant.scriptAi()!;
  if (entry === 'refusal') assert.match(ai.refusal('Shop') ?? '', /AI is turned off/);
  else await assert.rejects(() => ai.generate({ file: 'Shop', model: '', messages: [] }), /AI is turned off/);
  const entries = store.securityEvents({ kind: 'ai-access-refused' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].account, null);
});

for (const scenario of ['preview', 'design visibility', 'design calc', 'design secret rename']) test(`F1: web assistant refuses ${scenario} through its actual tool loop`, async (t) => {
  const { store, assistant } = fixture(t);
  const full = store.privileges('Admin').set;
  store.savePrivilegeSet({ ...full, aiVisible: { Items: true } });
  const proposed = { ...full, aiVisible: { Items: ['Password'] } };
  const name = scenario === 'preview' ? 'preview_privilege_set' : 'propose_design_change';
  const input = scenario === 'preview' ? { database: 'Shop', proposed }
    : { summary: 'a change', changes: scenario === 'design visibility' ? [{ op: 'savePrivilegeSet', set: proposed }]
      : scenario === 'design secret rename' ? [{ op: 'updateField', table: 'Items', field: 'Password', name: 'Hint' }]
      : [{ op: 'createField', table: 'Items', name: 'Encoded', kind: 'calculation', calculation: 'Base64Encode ( Password )' }] };
  let calls = 0;
  let result = '';
  t.mock.method(assistant as unknown as { call: (...args: any[]) => Promise<unknown> }, 'call', async (_system: unknown, _tools: unknown, messages: unknown[]) => {
    if (calls++ === 0) return { content: [{ type: 'tool_use', id: 'probe', name, input }], stop_reason: 'tool_use' };
    result = JSON.stringify(messages.at(-1));
    return { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' };
  });
  const answer = await assistant.chat(store, 'Admin', [{ role: 'user', content: 'Change security and design' }],
    { mode: scenario === 'preview' ? 'security' : 'design' }, store.privileges('Admin'));
  assert.match(result, /AI.visibility|AI policy.*secret/i);
  assert.match(result, /is_error.*true/);
  assert.deepEqual(answer.proposals, []);
  assert.deepEqual(store.privileges('Admin').set.aiVisible, { Items: true });
});

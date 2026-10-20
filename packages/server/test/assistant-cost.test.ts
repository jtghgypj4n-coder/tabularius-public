// What the assistant sends and spends: simple questions to the fast model with only the common tools loaded,
// the rest found by tool search; thinking and tool search passed back as they came; tokens and cost per
// question for the admin console, and the month's budget.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { Assistant } from '../src/assistant.ts';
import { MODEL_PRICES, priceOf } from '../src/ai-prices.ts';
import type { Host } from '../src/host.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let host: Host;
let store: Store;

type Answer = { content: Record<string, unknown>[]; stop_reason: string; usage?: Record<string, number> };
let script: (Answer | { sse: string })[] = [];
const requests: Record<string, unknown>[] = [];

const text = (t: string, usage = { input_tokens: 1000, output_tokens: 100 }): Answer => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage });
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      const next = script.shift() ?? text('(no more answers)');
      if ('sse' in next) res.writeHead(200, { 'content-type': 'text/event-stream' }).end(next.sse);
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(next));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-assistant-cost-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}`, monthlyBudgetUsd: 0.05 } });
  server = s.server;
  base = s.url;
  host = s.host;
  store = host.get('Charts')!;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'pw');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}',
  });
  return (await r.json()).response.token;
}
const ask = async (token: string, content: string, context: unknown = {}, accept?: string) => {
  const r = await fetch(`${base}/tabularius/assistant/v1/databases/Charts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(accept ? { accept } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content }], context }),
  });
  return { status: r.status, body: accept ? await r.text() : await r.json() };
};

type Tool = { name: string; type?: string; defer_loading?: boolean; cache_control?: unknown };

test('assistant: a simple question goes to the fast model with the common tools and an outline of the file; the JSON answer carries reply', { skip }, async () => {
  const token = await login();
  requests.length = 0;
  script = [text('Charts is a set of sample charts: Congress voting scores, grades, roller coasters and Northwind sales.')];
  const r = await ask(token, 'In one short sentence: what is this file about?');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Without accept: application/x-ndjson, the answer is one JSON object and its text is reply.
  assert.match(r.body.reply, /^Charts is a set of sample charts/);
  assert.equal(r.body.model, 'claude-haiku-5-5');
  assert.equal(typeof r.body.ms, 'number');
  assert.equal(requests.length, 1, 'answered in one model call, with no tool call first');

  const sent = requests[0] as { model: string; output_config?: unknown; tools: Tool[]; system: { text: string }[] };
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.deepEqual(sent.output_config, { effort: 'low' });
  const loaded = sent.tools.filter((t) => !t.defer_loading);
  const deferred = sent.tools.filter((t) => t.defer_loading);
  assert.ok(loaded.some((t) => t.type === 'tool_search_tool_bm25_20251119' && t.name === 'tool_search_tool_bm25'));
  for (const name of ['describe_layout', 'find_records', 'summarize_records', 'show_records']) assert.ok(loaded.some((t) => t.name === name), name);
  for (const name of ['audit_log', 'get_security', 'propose_design_change', 'conversion_guide']) assert.ok(deferred.some((t) => t.name === name), name);
  assert.ok(deferred.length > loaded.length, `${deferred.length} deferred, ${loaded.length} loaded`);
  // The cache marker sits on the last tool loaded up front: a deferred tool can't carry one.
  assert.deepEqual(sent.tools.filter((t) => t.cache_control).map((t) => t.name), [sent.tools.at(-1)!.name]);
  assert.ok(!sent.tools.at(-1)!.defer_loading);
  // What is loaded up front is a small part of what used to be sent.
  const size = (x: unknown) => JSON.stringify(x).length;
  assert.ok(size(loaded) * 3 < size(sent.tools), `${size(loaded)} of ${size(sent.tools)} characters`);
  const system = sent.system.map((b) => b.text).join('');
  assert.match(system, /Tables \(10\): .*Congress \(29 fields: Name, State, Party/);
  assert.match(system, /Layouts \(24\): US Population, Demo/);
  assert.match(system, /tool_search_tool_bm25/);
});

test('assistant: design work and questions that build or change something go to the main model', { skip }, async () => {
  const token = await login();
  for (const [question, context] of [
    ['Write a script that shows the senators', {}],
    ['What does this layout show?', { mode: 'design', layout: 'Congress' }],
    // Digest mode is the server's own: a client naming it can't send a big question to the fast model.
    ['Write a script that lists the senators', { mode: 'digest' }],
  ] as const) {
    requests.length = 0;
    script = [text('Sure.')];
    const r = await ask(token, question, context);
    assert.equal(r.body.model, 'claude-opus-5-5', question);
    const sent = requests[0] as { model: string; output_config?: unknown; tools: Tool[] };
    assert.equal(sent.model, 'claude-opus-5-5');
    assert.equal(sent.output_config, undefined);
    if ('mode' in context && context.mode === 'design') assert.ok(sent.tools.some((t) => t.name === 'check_change_impact' && !t.defer_loading), 'design tools load up front in design mode');
  }
  const one = new Assistant(host, undefined as never, { apiKey: 'x', fastModel: 'off' });
  assert.equal(one.route({}, [{ role: 'user', content: 'How many senators?' }]).model, 'claude-opus-5-5');
  const own = new Assistant(host, undefined as never, { apiKey: 'x', fastModel: 'claude-sonnet-5-5' });
  assert.deepEqual(own.route({}, [{ role: 'user', content: 'How many senators?' }]), { model: 'claude-sonnet-5-5', effort: 'low', fast: true });
});

test('assistant: streamed thinking and tool search go back to the model as they came, and a paused turn carries on', { skip }, async () => {
  const token = await login();
  requests.length = 0;
  const sse = ev('message_start', { message: { usage: { input_tokens: 500, output_tokens: 1 } } }) +
    ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }) +
    ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'The audit log ' } }) +
    ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'has this.' } }) +
    ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } }) +
    ev('content_block_stop', { index: 0 }) +
    ev('content_block_start', { index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_bm25' } }) +
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"who changed' } }) +
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: ' records"}' } }) +
    ev('content_block_stop', { index: 1 }) +
    ev('content_block_start', { index: 2, content_block: { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'tool_search_tool_search_result', tool_references: [{ type: 'tool_reference', tool_name: 'audit_log' }] } } }) +
    ev('content_block_stop', { index: 2 }) +
    ev('message_delta', { delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 20 } }) + ev('message_stop', {});
  script = [{ sse }, text('Nobody has changed records today.')];
  const r = await ask(token, 'Who changed records today?', {}, 'application/x-ndjson');
  const lines = r.body.trim().split('\n').map((l: string) => JSON.parse(l));
  assert.equal(lines.at(-1).done.reply, 'Nobody has changed records today.');
  assert.equal(requests.length, 2);
  const again = requests[1] as { messages: { role: string; content: Record<string, unknown>[] }[] };
  const paused = again.messages.at(-1)!;
  assert.equal(paused.role, 'assistant', 'the paused turn is sent back to carry on');
  assert.deepEqual(paused.content[0], { type: 'thinking', thinking: 'The audit log has this.', signature: 'sig-abc' });
  assert.deepEqual(paused.content[1], { type: 'server_tool_use', id: 'srvtoolu_1', name: 'tool_search_tool_bm25', input: { query: 'who changed records' } });
  assert.equal(paused.content[2].type, 'tool_search_tool_result');
});

test('assistant: each question\'s model, time, tokens and cost are kept for the admin console, and the month\'s budget stops questions', { skip }, async () => {
  const token = await login();
  const assistant = (await fetch(`${base}/tabularius/admin/v1/ai-usage`, { headers: { 'x-tabularius-console': '1' } }));
  assert.equal(assistant.status, 200);
  const report = await assistant.json() as { month: { costUsd: number; questions: number; budgetUsd: number; tokens: number }; recent: { model: string; ms: number; inputTokens: number; costUsd?: number; via: string; database: string }[]; models: { main: string; fast: string } };
  assert.deepEqual(report.models, { main: 'claude-opus-5-5', fast: 'claude-haiku-5-5' });
  assert.equal(report.month.budgetUsd, 0.05);
  assert.ok(report.month.questions >= 4, JSON.stringify(report.month));
  const first = report.recent.at(-1)!;
  assert.equal(first.model, 'claude-haiku-5-5');
  assert.equal(first.via, 'Assistant');
  assert.equal(first.database, 'Charts');
  assert.ok(first.ms >= 0);
  // 1,000 input and 100 output tokens on Claude Haiku 5.5 at $0.10 and $0.50 per million.
  assert.ok(Math.abs(first.costUsd! - (1000 * 0.1 + 100 * 0.5) / 1e6) < 1e-12, String(first.costUsd));
  assert.ok(!JSON.stringify(report).includes('what is this file about'), 'questions themselves are not kept');
  // The shared usage file, with whatever its write-ahead log still holds.
  const kept = ['', '-wal'].map((x) => join(dir, `.openhbam-ai-usage.sqlite${x}`)).filter((f) => existsSync(f)).map((f) => readFileSync(f, 'latin1')).join('');
  assert.match(kept, /claude-haiku-5-5/);
  assert.ok(!/what is this file about|Who changed records|senators/i.test(kept), 'nor written to disk');

  // A costly answer on the main model passes the month's $0.05 budget; the next question is turned away.
  script = [text('A long answer.', { input_tokens: 10_000, output_tokens: 3_000 })];
  assert.equal((await ask(token, 'Write a script that lists everyone')).status, 200);
  const over = await ask(token, 'How many senators?');
  assert.equal(over.status, 429);
  assert.match(over.body.messages?.[0]?.message ?? over.body.error?.message ?? JSON.stringify(over.body), /this month's budget of \$0\.05.*next month/);
});

test('assistant: prices follow the model id, and a budget needs priced models', { skip }, async () => {
  assert.equal(priceOf('claude-opus-5-5[1m]'), MODEL_PRICES['claude-opus-5-5']);
  assert.equal(priceOf('claude-haiku-4-5-20251001'), MODEL_PRICES['claude-haiku-4-5']);
  assert.equal(priceOf('claude-sonnet-4-5'), undefined);
  assert.throws(() => new Assistant(host, undefined as never, { apiKey: 'x', model: 'claude-sonnet-4-5', monthlyBudgetUsd: 100 }), /needs models with known prices, and claude-sonnet-4-5 has none/);
  assert.throws(() => new Assistant(host, undefined as never, { apiKey: 'x', fastModel: 'some-other-model', monthlyBudgetUsd: 100 }), /some-other-model has none/);
  assert.doesNotThrow(() => new Assistant(host, undefined as never, { apiKey: 'x', model: 'claude-sonnet-4-5' }), 'without a budget, any model');
});


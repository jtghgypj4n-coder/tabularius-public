// The AI tools' eval suite: each case asks the assistant something about a public sample file (Charts, Flicks), as a person
// would in the web client, and grades what comes back against the file's own data (the records a find should
// show, a formula's results, a script's found set). The model's answers come from recorded fixtures by
// default, so a run is free and quick and part of `npm test`; `--live` asks the real model, and `--record`
// saves its answers as the new fixtures. Nothing here sends mail or reaches outside: scripts run offline,
// on a throwaway copy of a public sample file.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costOf } from '../src/ai-prices.ts';
import { Assistant, DEFAULT_MODEL, type AssistantOptions, type ChatContext } from '../src/assistant.ts';
import { Host } from '../src/host.ts';
import type { Store } from '../../store/src/index.ts';
import { CASES, setUp, type EvalCase, type Check, type ChatOut } from './cases.ts';

// Not "fixtures": the repository ignores folders by that name (the downloaded sample files).
export const FIXTURES = join(import.meta.dirname, 'recordings');
export const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const sampleOf = (file: string) => join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', `${file}.fmp12`);

/** One model answer, as the Messages API gives it. */
export interface Turn {
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> })[];
  stop_reason: string;
}

export interface Fixture {
  case: string;
  /** "recorded" (from a live run) or a hand-written stand-in, until someone records it. */
  source: string;
  model?: string;
  recordedAt?: string;
  ask: string;
  turns: Turn[];
}

export interface CaseResult {
  id: string;
  area: EvalCase['area'];
  pass: boolean;
  checks: Check[];
  /** Tools the model called, in order. */
  tools: string[];
  /** Why the case couldn't be graded (no fixture, a stale one, the model failed). */
  error?: string;
  /** Live runs: tokens used. */
  tokens?: number;
  /** Live runs: what the tokens cost in dollars, at list prices (none for a model without a price). */
  costUsd?: number;
  /** How long the answer took. */
  ms?: number;
  fixtureSource?: string;
}

export interface EvalOptions {
  mode: 'replay' | 'live';
  /** Live: save each case's answers as its fixture. */
  record?: boolean;
  /** Live: the API key. */
  apiKey?: string;
  /** Live: where the Messages API is (tests point it at a stand-in). */
  apiUrl?: string;
  model?: string;
  /** Only these cases. */
  only?: string[];
  /** Options for the assistant (tests use them to show a costlier setup fails the budgets). */
  assistant?: Pick<AssistantOptions, 'fastModel' | 'toolSearch'>;
  /** Live: stop asking once the run has cost this many dollars at list prices; the cases left are skipped. */
  maxUsd?: number;
  /** Replay these instead of the files (tests use it to show a wrong answer fails). */
  fixtures?: Record<string, Fixture>;
  log?: (line: string) => void;
}

export interface SentRequest { model: string; inputTokens: number }

/** The tool calls the model made in a case, for graders that check what it asked for. */
export type Calls = { name: string; input: Record<string, unknown> }[];

export function readFixture(id: string): Fixture | undefined {
  const f = join(FIXTURES, `${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Fixture : undefined;
}

/**
 * A stand-in for the Messages API. Replaying, it answers with the fixture's turns in order, and calls a fixture
 * stale when it uses a tool the assistant no longer offers, or runs out of turns. Live, it passes each request to
 * the real API and keeps the answers.
 */
class ModelProxy {
  private server!: Server;
  url = '';
  turns: Turn[] = [];
  stale?: string;
  tokens = 0;
  /** Live: dollars at list prices; undefined once a call goes to a model without a price. */
  costUsd: number | undefined = 0;
  /** What each model call asked for: the model, and the input it sent, in tokens by a rough count (4 characters each). */
  sent: SentRequest[] = [];
  /** Each request's system prompt, tools and messages as sent, for checks on what the model was shown. */
  requests: string[] = [];
  private next = 0;
  private readonly opts: EvalOptions;
  constructor(opts: EvalOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => void this.answer(JSON.parse(raw) as { tools?: { name: string }[] } & Record<string, unknown>).then(
        (a) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(a)),
        (e: Error) => res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: e.message } }))));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }

  /** A new case: replay these turns, or start keeping new ones. */
  begin(turns: Turn[]): void {
    this.turns = turns;
    this.next = 0;
    this.stale = undefined;
    this.tokens = 0;
    this.costUsd = 0;
    this.sent = [];
    this.requests = [];
  }

  private async answer(body: { tools?: { name: string; defer_loading?: boolean }[] } & Record<string, unknown>): Promise<Turn> {
    // Deferred tools aren't read by the model until tool search finds them, so they don't count.
    const loaded = (body.tools ?? []).filter((t) => !t.defer_loading);
    this.requests.push(JSON.stringify({ system: body.system, tools: body.tools, messages: body.messages }));
    this.sent.push({ model: String(body.model), inputTokens: Math.round((JSON.stringify(body.system ?? '').length + JSON.stringify(loaded).length + JSON.stringify(body.messages ?? []).length) / 4) });
    if (this.opts.mode === 'live') {
      const res = await fetch(`${this.opts.apiUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.opts.apiKey!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ ...body, stream: false }),
      });
      const got = await res.json() as Turn & { error?: { message?: string }; usage?: Record<string, number> };
      if (!res.ok) throw new Error(got.error?.message ?? `HTTP ${res.status}`);
      const u = got.usage ?? {};
      this.tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
      const cost = costOf(String(body.model), { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 });
      this.costUsd = this.costUsd === undefined || cost === undefined ? undefined : this.costUsd + cost;
      const turn: Turn = { content: got.content, stop_reason: got.stop_reason };
      this.turns.push(turn);
      return turn;
    }
    const turn = this.turns[this.next++];
    if (!turn) {
      this.stale ??= `the fixture ran out after ${this.turns.length} answers: the assistant asked again`;
      return { content: [{ type: 'text', text: '(no more recorded answers)' }], stop_reason: 'end_turn' };
    }
    const offered = new Set((body.tools ?? []).map((t) => t.name));
    for (const b of turn.content) {
      if (b.type === 'tool_use' && !offered.has(b.name)) this.stale ??= `the fixture calls ${b.name}, which the assistant no longer offers here`;
    }
    return turn;
  }

  close(): void {
    this.server?.close();
  }
}

/** Every case's tool calls, read from the model's answers. */
const callsOf = (turns: Turn[]): Calls => turns.flatMap((t) => t.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input })));

export async function runEvals(opts: EvalOptions): Promise<CaseResult[]> {
  const log = opts.log ?? (() => {});
  if (opts.mode === 'live' && !opts.apiKey) throw new Error('A live run needs an Anthropic API key');
  if (!existsSync(SAMPLE)) throw new Error(`The sample file is missing (${SAMPLE}): run npm run fixtures`);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-evals-'));
  const cases = CASES.filter((x) => !opts.only?.length || opts.only.includes(x.id));
  copyFileSync(SAMPLE, join(dir, 'Charts.fmp12'));
  for (const file of new Set(cases.map((c) => c.file).filter((f): f is string => !!f && f !== 'Charts'))) {
    if (existsSync(sampleOf(file))) copyFileSync(sampleOf(file), join(dir, `${file}.fmp12`));
  }
  const proxy = new ModelProxy(opts);
  await proxy.start();
  const host = new Host(dir);
  const results: CaseResult[] = [];
  let spent = 0;
  try {
    setUp(host.get('Charts')!);
    const model = opts.model ?? DEFAULT_MODEL;
    const assistant = new Assistant(host, undefined as never, { apiKey: opts.mode === 'live' ? 'via-proxy' : 'replay', baseUrl: proxy.url, model, maxTurns: 12, ...opts.assistant });
    for (const c of cases) {
      const store = host.get(c.file ?? 'Charts');
      if (!store) {
        results.push({ id: c.id, area: c.area, pass: false, checks: [], tools: [], error: `the sample file ${c.file}.fmp12 is missing: run npm run fixtures` });
        continue;
      }
      if (opts.mode === 'live' && opts.maxUsd !== undefined && spent >= opts.maxUsd) {
        results.push({ id: c.id, area: c.area, pass: false, checks: [], tools: [], error: `skipped: the run has cost $${spent.toFixed(2)}, over its $${opts.maxUsd} cap` });
        log(`skip  ${c.id}: over the $${opts.maxUsd} cap`);
        continue;
      }
      const fixture = opts.mode === 'replay' ? opts.fixtures?.[c.id] ?? readFixture(c.id) : undefined;
      if (opts.mode === 'replay' && !fixture) {
        results.push({ id: c.id, area: c.area, pass: false, checks: [], tools: [], error: 'no fixture: record one with --live --record' });
        continue;
      }
      proxy.begin(fixture ? fixture.turns : []);
      let out: ChatOut | undefined;
      let error: string | undefined;
      const started = performance.now();
      let result: unknown;
      try {
        if (c.run) {
          // Not a chat question (a plan for a new solution, a handover memo): its text stands in for the reply.
          const r = await c.run(assistant, store);
          result = r.result;
          out = { reply: r.reply, proposals: [], foundSets: [], drafts: [], charts: [], dashboards: [], cleanups: [], automations: [], tools: [], model, ms: 0,
            usage: { inputTokens: proxy.tokens, outputTokens: 0 } } as unknown as ChatOut;
        } else {
          out = await assistant.chat(store, 'Admin', [{ role: 'user', content: c.ask }], c.context(store) as ChatContext, store.privileges('Admin'));
        }
      } catch (e) {
        error = `the assistant failed: ${(e as Error).message}`;
      }
      const calls = callsOf(proxy.turns);
      const ms = performance.now() - started;
      if (opts.mode === 'live') spent += proxy.costUsd ?? 0;
      const checks = out ? await c.grade({ store, out, calls, host, sent: proxy.sent, requests: proxy.requests, result, ...(opts.mode === 'live' ? { live: { ms, tokens: out.usage.inputTokens + out.usage.outputTokens } } : {}) }) : [];
      if (fixture && fixture.ask !== c.ask) error ??= 'stale fixture: it was recorded for a different question; record it again';
      error ??= proxy.stale ? `stale fixture: ${proxy.stale}` : undefined;
      const r: CaseResult = {
        id: c.id, area: c.area, checks, tools: calls.map((x) => x.name), pass: !error && checks.length > 0 && checks.every((x) => x.pass),
        ...(error ? { error } : {}), ms: Math.round(ms),
        ...(opts.mode === 'live' ? { tokens: proxy.tokens, ...(proxy.costUsd !== undefined ? { costUsd: proxy.costUsd } : {}) } : { fixtureSource: fixture!.source }),
      };
      results.push(r);
      log(`${r.pass ? 'pass' : 'FAIL'}  ${c.id}${r.error ? `: ${r.error}` : ''}${r.checks.filter((x) => !x.pass).map((x) => `\n      ✗ ${x.name}${x.detail ? `: ${x.detail}` : ''}`).join('')}`);
      if (opts.mode === 'live' && opts.record && out) {
        const saved: Fixture = { case: c.id, source: 'recorded', model, recordedAt: new Date().toISOString(), ask: c.ask, turns: proxy.turns };
        writeFileSync(join(FIXTURES, `${c.id}.json`), JSON.stringify(saved, null, 2) + '\n');
      }
    }
  } finally {
    proxy.close();
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

/** The results as a table, with a score per area. */
export function report(results: CaseResult[]): string {
  const lines = results.map((r) => `${r.pass ? 'pass' : 'FAIL'}  ${r.area.padEnd(8)} ${r.id.padEnd(28)} ${r.checks.filter((c) => c.pass).length}/${r.checks.length} checks` +
    `${r.tokens !== undefined ? `  ${r.tokens.toLocaleString('en-US')} tokens  ${((r.ms ?? 0) / 1000).toFixed(1)} s` : ''}${r.error ? `  (${r.error})` : ''}`);
  const areas = [...new Set(results.map((r) => r.area))].map((a) => {
    const of = results.filter((r) => r.area === a);
    return `${a} ${of.filter((r) => r.pass).length}/${of.length}`;
  });
  const passed = results.filter((r) => r.pass).length;
  return [...lines, '', `${passed}/${results.length} cases pass (${areas.join(', ')})`].join('\n');
}

/** One setup's results, for comparing models: a model for every call, or the server's routing. */
export interface ModelRun { label: string; results: CaseResult[] }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/**
 * Several models side by side: accuracy (cases passed, and checks passed), tokens, cost at list prices and how long
 * answers took, so a routing change is judged by numbers.
 */
export function compare(runs: ModelRun[]): string {
  const rows = runs.map(({ label, results }) => {
    const passed = results.filter((r) => r.pass).length;
    const checks = results.flatMap((r) => r.checks);
    const tokens = results.reduce((n, r) => n + (r.tokens ?? 0), 0);
    const priced = results.every((r) => r.costUsd !== undefined);
    const cost = results.reduce((n, r) => n + (r.costUsd ?? 0), 0);
    const ms = results.map((r) => r.ms ?? 0);
    return [label, `${passed}/${results.length} (${results.length ? Math.round((passed / results.length) * 100) : 0}%)`,
      `${checks.filter((c) => c.pass).length}/${checks.length}`, tokens.toLocaleString('en-US'),
      priced ? `$${cost.toFixed(4)}` : 'no price', `${(median(ms) / 1000).toFixed(1)} s`, `${(Math.max(0, ...ms) / 1000).toFixed(1)} s`];
  });
  const head = ['Model', 'Cases passed', 'Checks', 'Tokens', 'Cost', 'Median time', 'Slowest'];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
  // Cases one model passes and another fails, by name: where the difference is.
  const ids = runs[0]?.results.map((r) => r.id) ?? [];
  const split = ids.filter((id) => new Set(runs.map((run) => run.results.find((r) => r.id === id)?.pass)).size > 1)
    .map((id) => `  ${id}: passes with ${runs.filter((run) => run.results.find((r) => r.id === id)?.pass).map((run) => run.label).join(', ')}`);
  return [line(head), line(width.map((w) => '-'.repeat(w))), ...rows.map(line), ...(split.length ? ['', 'Where they differ:', ...split] : [])].join('\n');
}

export type { Store };

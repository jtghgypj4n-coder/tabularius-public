// The AI tools' eval suite, replaying its recorded answers: a change that makes the assistant worse at a find, a
// formula, a script, an impact check or suggested rules shows up here. The graders are tested too, on wrong answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { compare, readFixture, report, runEvals, SAMPLE, type CaseResult, type Fixture, type Turn } from '../evals/harness.ts';
import { CASES } from '../evals/cases.ts';

const skip = existsSync(SAMPLE) ? false : 'fixtures missing: run npm run fixtures';

test('evals: every case passes on its recorded answers', { skip }, async () => {
  const results = await runEvals({ mode: 'replay' });
  assert.equal(results.length, CASES.length);
  assert.ok(results.every((r) => r.pass), report(results));
  for (const area of ['cost', 'find', 'formula', 'script', 'impact', 'rules', 'record', 'build', 'handover']) assert.ok(results.some((r) => r.area === area), `no ${area} case`);
});

/** A case's fixture with one tool call's input changed. */
function changed(id: string, edit: (input: Record<string, unknown>) => void): Fixture {
  const f = structuredClone(readFixture(id)!);
  const call = f.turns.flatMap((t) => t.content).find((b) => b.type === 'tool_use' && b.name !== 'describe_layout') as Extract<Turn['content'][number], { type: 'tool_use' }>;
  edit(call.input);
  return f;
}

test('evals: wrong answers and stale fixtures fail', { skip }, async () => {
  const results = await runEvals({
    mode: 'replay',
    only: ['find-or-with-omit', 'formula-average', 'script-find-and-sort', 'impact-rename-field', 'rules-for-table'],
    fixtures: {
      // The omit request forgotten: district 1 members come back.
      'find-or-with-omit': changed('find-or-with-omit', (i) => (i.query as unknown[]).pop()),
      // Not rounded.
      'formula-average': changed('formula-average', (i) => (i.text = 'Average ( Liberal_Economic ; Liberal_Social ; Liberal_Foreign )')),
      // Not sorted.
      'script-find-and-sort': changed('script-find-and-sort', (i) => (i.text = String(i.text).replace(/\nSort Records.*$/, ''))),
      // Answers without naming the privilege set the rename leaves behind.
      'impact-rename-field': { ...readFixture('impact-rename-field')!, turns: [readFixture('impact-rename-field')!.turns[0], { content: [{ type: 'text', text: 'Only the script "Count Democrats" breaks.' }], stop_reason: 'end_turn' }] },
      // A tool the assistant doesn't offer: the fixture is out of date, not a pass.
      'rules-for-table': { ...readFixture('rules-for-table')!, turns: [{ content: [{ type: 'tool_use', id: 't1', name: 'drop_everything', input: {} }], stop_reason: 'tool_use' }, ...readFixture('rules-for-table')!.turns] },
    },
  });
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.ok(results.every((r) => !r.pass), report(results));
  assert.match(by['find-or-with-omit'].checks.find((c) => !c.pass)!.detail!, /extra/);
  assert.match(by['formula-average'].checks.find((c) => !c.pass)!.detail!, /wrong/);
  assert.equal(by['script-find-and-sort'].checks.find((c) => !c.pass)!.name, 'sorted by District, highest first');
  assert.equal(by['impact-rename-field'].checks.find((c) => !c.pass)!.name, 'names "Party Desk" as breaking');
  assert.match(by['rules-for-table'].error!, /stale fixture: the fixture calls drop_everything/);
});

test('evals: Find with AI, record checks, solution plans and handover memos are graded too', { skip }, async () => {
  const text = (id: string, edit: (t: string) => string): Fixture => {
    const f = structuredClone(readFixture(id)!);
    const last = f.turns.at(-1)!.content.find((b) => b.type === 'text') as { text: string };
    last.text = edit(last.text);
    return f;
  };
  const results = await runEvals({
    mode: 'replay',
    only: ['find-mode-design-only', 'check-record-stale', 'solution-crm', 'handover-memo'],
    fixtures: {
      // Only Ohio: the Michigan request forgotten.
      'find-mode-design-only': changed('find-mode-design-only', (i) => (i.query as unknown[]).pop()),
      // Says what's wrong without what it should show.
      'check-record-stale': text('check-record-stale', (t) => t.replace(/"Martha Roby \(Alabama\)"/, 'something else')),
      // A stage left out of the value list.
      'solution-crm': text('solution-crm', (t) => t.replace('"Qualified", ', '')),
      // Quotes a record.
      'handover-memo': text('handover-memo', (t) => t.replace('Display name is', 'For example Martha Roby. Display name is')),
    },
  });
  const failed = Object.fromEntries(results.map((r) => [r.id, r.checks.filter((c) => !c.pass).map((c) => c.name)]));
  assert.ok(results.every((r) => !r.pass), report(results));
  assert.deepEqual(failed['find-mode-design-only'], ['finds exactly the right records']);
  assert.deepEqual(failed['check-record-stale'], ['gives what it should show']);
  assert.deepEqual(failed['solution-crm'], ['a value list with the four stages']);
  assert.deepEqual(failed['handover-memo'], ['quotes no record data']);
});

test('evals: a live run stops asking once it is over its cost cap', { skip }, async () => {
  let calls = 0;
  const api = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: 'Congress members and their grades.' }], stop_reason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 0 } }));
    });
  });
  await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
  try {
    const results = await runEvals({ mode: 'live', apiKey: 'test', apiUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}`, only: ['file-overview', 'handover-memo'], model: 'claude-haiku-5-5', assistant: { fastModel: 'off' }, maxUsd: 0.05 });
    assert.equal(calls, 1);
    assert.match(results[1].error!, /^skipped: the run has cost \$0\.10, over its \$0\.05 cap/);
  } finally {
    api.close();
  }
});

test('evals: a question that sends every tool to the main model fails the overview\'s budget', { skip }, async () => {
  const [r] = await runEvals({ mode: 'replay', only: ['file-overview'], assistant: { fastModel: 'off', toolSearch: false } });
  assert.equal(r.pass, false);
  const failed = r.checks.filter((c) => !c.pass).map((c) => c.name);
  assert.deepEqual(failed, ['goes to the fast model', 'sends at most 6,000 tokens a call'], report([r]));
});

test('evals: a live run needs a key', async () => {
  await assert.rejects(runEvals({ mode: 'live' }), /needs an Anthropic API key/);
});

test('eval:ai compares models: accuracy, checks, tokens, cost at list prices, time, and where they differ', () => {
  const r = (id: string, pass: boolean, tokens: number, costUsd: number | undefined, ms: number): CaseResult =>
    ({ id, area: 'find', pass, checks: [{ name: 'a', pass: true }, { name: 'b', pass }], tools: [], tokens, ...(costUsd === undefined ? {} : { costUsd }), ms });
  const table = compare([
    { label: 'claude-haiku-5-5', results: [r('one', true, 1000, 0.0001, 900), r('two', false, 1200, 0.0002, 1100)] },
    { label: 'claude-opus-5-5', results: [r('one', true, 3000, 0.012, 4000), r('two', true, 3500, 0.014, 6000)] },
    { label: 'some-model', results: [r('one', true, 10, undefined, 100), r('two', true, 10, undefined, 100)] },
  ]);
  const lines = table.split('\n');
  assert.match(lines[0], /^Model\s+Cases passed\s+Checks\s+Tokens\s+Cost\s+Median time\s+Slowest$/);
  assert.match(lines[2], /^claude-haiku-5-5\s+1\/2 \(50%\)\s+3\/4\s+2,200\s+\$0\.0003\s+1\.0 s\s+1\.1 s$/);
  assert.match(lines[3], /^claude-opus-5-5\s+2\/2 \(100%\)\s+4\/4\s+6,500\s+\$0\.0260\s+5\.0 s\s+6\.0 s$/);
  assert.match(lines[4], /no price/);
  assert.match(table, /Where they differ:\n  two: passes with claude-opus-5-5, some-model/);
});

test('eval:ai live: each model answers every call, with its tokens, cost and time counted', { skip }, async () => {
  const fixture = readFixture('flicks-find-recent')!;
  const models: string[] = [];
  let next = 0;
  const api = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      models.push(body.model);
      const turn = fixture.turns[next++ % fixture.turns.length];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...turn, usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    });
  });
  await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
  try {
    const [res] = await runEvals({ mode: 'live', apiKey: 'test', apiUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}`, only: ['flicks-find-recent'], model: 'claude-haiku-5-5', assistant: { fastModel: 'off' } });
    assert.equal(res.pass, true, report([res]));
    assert.deepEqual([...new Set(models)], ['claude-haiku-5-5']);
    assert.equal(res.tokens, 3 * 1100);
    assert.ok(Math.abs(res.costUsd! - 3 * (1000 * 0.1 + 100 * 0.5) / 1e6) < 1e-12, String(res.costUsd));
    assert.ok(typeof res.ms === 'number');
  } finally {
    api.close();
  }
});

test('eval:ai: comparing models needs a live run, and no --model or --record', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', join(import.meta.dirname, '..', 'evals', 'run.ts'), ...args], { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '', HOME: '/nonexistent' } });
  const replay = run('--models', 'claude-haiku-5-5,routed');
  assert.equal(replay.status, 2);
  assert.match(replay.stderr, /--models needs --live/);
  const both = run('--live', '--models', 'a,b', '--record');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /leave out --model and --record/);
});

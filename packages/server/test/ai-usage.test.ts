// What the AI assistant has used is shared by every worker process: several processes adding at once add up
// exactly, one worker past the daily limit or the monthly budget stops the others too, and an older server's
// JSON file is read once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiUsage, MemoryUsage } from '../src/ai-usage.ts';
import { Assistant } from '../src/assistant.ts';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

const usageModule = join(import.meta.dirname, '..', 'src', 'ai-usage.ts');

/** A process that adds `times` calls of 10 tokens and $0.001 each, and one question per 40 calls. */
function worker(dir: string, n: number, times: number): Promise<void> {
  const code = `const { AiUsage } = await import(${JSON.stringify(usageModule)});
    const u = new AiUsage(${JSON.stringify(dir)});
    for (let i = 0; i < ${times}; i++) {
      u.add('Charts/clerk', 10, 0.001);
      if (i % 40 === 0) u.question({ at: new Date().toISOString(), database: 'Charts', account: 'Clerk', via: 'worker ${n}', model: 'claude-haiku-5-5', ms: 1, inputTokens: 5, cachedTokens: 0, outputTokens: 5, costUsd: 0.001, steps: 0 });
    }
    u.close();`;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${n} failed: ${err}`))));
  });
}

test('several worker processes adding at once add up exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    await Promise.all([1, 2, 3, 4, 5].map((n) => worker(dir, n, 200)));
    const u = new AiUsage(dir);
    assert.equal(u.today(), 5 * 200 * 10, 'the server total');
    assert.equal(u.today('Charts/clerk'), 5 * 200 * 10, 'the account total');
    const month = u.month();
    assert.equal(month.tokens, 10_000);
    assert.ok(Math.abs(month.costUsd - 1) < 1e-9, String(month.costUsd));
    assert.equal(month.questions, 5 * 5);
    assert.equal(u.recent().length, 25);
    assert.equal(new Set(u.recent().map((q) => q.via)).size, 5, 'every worker\'s questions are listed');
    u.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one worker reaching the daily limit or the month\'s budget stops the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    const host = { dir } as Host;
    const opts = { apiKey: 'x', dailyTokens: 1000, accountDailyTokens: 400, monthlyBudgetUsd: 1 };
    const a = new Assistant(host, undefined as never, opts);
    const b = new Assistant(host, undefined as never, opts);
    const over = (x: Assistant, who: string) => (x as unknown as { overLimit(who: string): string | undefined }).overLimit(who);
    const count = (x: Assistant, who: string, tokens: number, costUsd: number) =>
      (x as unknown as { count(u: object, who: string): void }).count({ inputTokens: tokens, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd }, who);
    count(a, 'Charts/clerk', 450, 0.1);
    assert.match(over(b, 'Charts/clerk')!, /your account has used its daily limit of 400 tokens/);
    assert.equal(over(b, 'Charts/admin'), undefined);
    count(a, 'Charts/admin', 600, 0.1);
    assert.match(over(b, 'Charts/someone')!, /today's limit of 1,000 tokens on this server/);
    assert.equal(b.usageToday().tokens, 1050);
    const c = new Assistant(host, undefined as never, { apiKey: 'x', monthlyBudgetUsd: 1 });
    count(c, 'Charts/x', 1, 0.85);
    assert.match(over(b, 'Charts/x')!, /today's limit/);
    const d = new Assistant(host, undefined as never, { apiKey: 'x', monthlyBudgetUsd: 1 });
    assert.match(over(d, 'Charts/x')!, /this month's budget of \$1\.00/, 'spent across three workers: $1.05');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AR-server-mcp-ai-08', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-usage-retry-'));
  try {
    const logged: string[] = [];
    const assistant = new Assistant({ dir } as Host, undefined as never, {
      apiKey: 'x', dailyTokens: 1000, accountDailyTokens: 1000, monthlyBudgetUsd: 0.5, log: (line) => logged.push(line),
    });
    const backing = new MemoryUsage();
    let fail = true;
    const injected = {
      today: (who?: string) => backing.today(who), month: () => backing.month(), recent: () => backing.recent(),
      question: (q: Parameters<MemoryUsage['question']>[0]) => backing.question(q),
      add: (who: string, tokens: number, cost: number) => {
        if (fail) { fail = false; throw new Error('temporary usage write failure'); }
        backing.add(who, tokens, cost);
      },
    };
    const internal = assistant as unknown as {
      used: typeof injected; count(u: object, who: string): void; overLimit(who: string): string | undefined;
    };
    internal.used = injected;
    const usage = { inputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 10, costUsd: 0.6 };
    internal.count(usage, 'Shop/Admin');
    assert.equal(assistant.usageToday().tokens, 110);
    assert.equal(assistant.usageMonth().tokens, 110);
    assert.equal(assistant.usageMonth().costUsd, 0.6);
    assert.match(internal.overLimit('Shop/Admin')!, /this month's budget of \$0\.50/);
    internal.count(usage, 'Shop/Admin');
    assert.equal(backing.today(), 110);
    usage.inputTokens += 50;
    usage.costUsd += 0.2;
    internal.count(usage, 'Shop/Admin');
    assert.equal(backing.today(), 160);
    assert.equal(backing.today('Shop/Admin'), 160);
    assert.equal(backing.month().tokens, 160);
    assert.ok(Math.abs(backing.month().costUsd - 0.8) < 1e-9);
    assert.ok(logged.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AR-server-mcp-ai-08 retains the original UTC day when replaying usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-usage-day-'));
  const previousDay = new Date(Date.now() - 86_400_000);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const expectedMonth = previousDay.toISOString().startsWith(currentMonth) ? 7 : 0;
  const memory = new MemoryUsage();
  const disk = new AiUsage(dir);
  try {
    for (const usage of [memory, disk]) {
      usage.add('Shop/Admin', 7, 0.1, previousDay);
      assert.equal(usage.today(), 0);
      assert.equal(usage.today('Shop/Admin'), 0);
      assert.equal(usage.month().tokens, expectedMonth);
    }
  } finally {
    disk.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an older server\'s JSON count is read once, by whichever worker opens first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(join(dir, '.openhbam-ai-usage.json'), JSON.stringify({
      day, tokens: 700, accounts: { 'Charts/clerk': 300 },
      month: { month: day.slice(0, 7), tokens: 900, costUsd: 0.4, questions: 3, unpriced: 0 },
      recent: [{ at: '2026-10-12T00:00:00Z', database: 'Charts', account: 'Clerk', via: 'Assistant', model: 'claude-haiku-5-5', ms: 5, inputTokens: 1, cachedTokens: 0, outputTokens: 1, steps: 0 }],
    }));
    const one = new AiUsage(dir);
    const two = new AiUsage(dir);
    assert.equal(two.today(), 700);
    assert.equal(two.today('Charts/clerk'), 300);
    assert.deepEqual(two.month(), { month: day.slice(0, 7), tokens: 900, costUsd: 0.4, questions: 3, unpriced: 0 });
    assert.equal(two.recent().length, 1, 'not twice');
    one.close();
    two.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing used, no file; once used, a file only the server\'s user can read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    const a = new Assistant({ dir } as Host, undefined as never, { apiKey: 'x', dailyTokens: 1000 });
    assert.equal(a.usageReport().today.tokens, 0);
    assert.equal(a.usageToday().tokens, 0);
    assert.ok(!existsSync(join(dir, '.openhbam-ai-usage.sqlite')), 'looking made no file');
    (a as unknown as { count(u: object, who: string): void }).count({ inputTokens: 5, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'Charts/clerk');
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.openhbam-ai-usage.sqlite')).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a usage file that can\'t be opened: answers go on, counted in the process, and the limits still hold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    // Something in the way where the file should be (as a folder the server can't write to would be).
    mkdirSync(join(dir, '.openhbam-ai-usage.sqlite'));
    const logged: string[] = [];
    const a = new Assistant({ dir } as Host, undefined as never, { apiKey: 'x', dailyTokens: 100, log: (m) => logged.push(m) });
    const over = (who: string) => (a as unknown as { overLimit(who: string): string | undefined }).overLimit(who);
    assert.equal(over('Charts/clerk'), undefined);
    (a as unknown as { count(u: object, who: string): void }).count({ inputTokens: 150, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, 'Charts/clerk');
    assert.match(over('Charts/clerk')!, /today's limit of 100 tokens/);
    assert.equal(a.usageReport().today.tokens, 150);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /counting in this process only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('after an upgrade, the older server\'s count shows before anyone asks: read in at startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(join(dir, '.openhbam-ai-usage.json'), JSON.stringify({ day, tokens: 25_098, accounts: {}, month: { month: day.slice(0, 7), tokens: 25_098, costUsd: 0.2, questions: 4 } }));
    // Reading alone, as the console does.
    assert.equal(new Assistant({ dir } as Host, undefined as never, { apiKey: 'x' }).usageReport().today.tokens, 25_098);
    for (const f of ['', '-wal', '-shm']) rmSync(join(dir, `.openhbam-ai-usage.sqlite${f}`), { force: true });
    // Serving with AI on reads it in at startup; with AI off, nothing is made.
    const off = await serve({ dir, port: 0, log: () => {} });
    off.server.close();
    assert.equal(new Assistant({ dir } as Host, undefined as never, undefined).usageReport().today.tokens, 0, 'AI off: the console reads nothing in');
    assert.ok(!existsSync(join(dir, '.openhbam-ai-usage.sqlite')), 'AI off: no file, at startup or from the console');
    const on = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'x', baseUrl: 'http://127.0.0.1:9' } });
    on.server.close();
    assert.ok(existsSync(join(dir, '.openhbam-ai-usage.sqlite')), 'read in at startup, not on the first question');
    const u = new AiUsage(dir);
    assert.equal(u.today(), 25_098);
    assert.equal(u.month().questions, 4);
    u.close();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a usage file that can\'t be opened at startup is tried again on next use, not given up on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-usage-'));
  try {
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(join(dir, '.openhbam-ai-usage.json'), JSON.stringify({ day, tokens: 500, accounts: {} }));
    const logged: string[] = [];
    const a = new Assistant({ dir } as Host, undefined as never, { apiKey: 'x', log: (m) => logged.push(m) });
    // Something in the way at startup (as another worker holding the file mid-setup would be): a link to nowhere.
    symlinkSync(join(dir, 'missing', 'usage.sqlite'), join(dir, '.openhbam-ai-usage.sqlite'));
    a.readOldUsage();
    assert.equal(logged.length, 1);
    assert.match(logged[0], /counting in this process only/);
    rmSync(join(dir, '.openhbam-ai-usage.sqlite'));
    assert.equal(a.usageReport().today.tokens, 500, 'the shared file, with the old count read in');
    assert.ok(existsSync(join(dir, '.openhbam-ai-usage.sqlite')));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

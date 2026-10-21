// The assistant's chat panel, in a real browser, against the real server with a stand-in for the model's API (scripted,
// streamed in pieces, never the provider, so nothing is spent): the answer streams in without moving what is above it,
// each tool call shows what it was asked (secrets hidden) and what came back, a loop runs to the step limit and Stop
// really stops one (the stand-in sees the connection close and gets no more calls), failures say what kind they are
// and what to do, a proposal that deletes things asks first, and a conversation does not outlive its sign-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let model: Server;

type Turn =
  | { text: string[]; delay?: number }
  | { tools: { name: string; input: unknown }[]; delay?: number }
  | { fail: { status: number; message: string } };

/** What the stand-in model answers next (in order), then `after` for every call. */
const turns: Turn[] = [];
let after_: (() => Turn) | undefined;
/** Calls the stand-in has answered, and those whose connection closed before it finished (the server stopped waiting). */
const seen = { calls: 0, closed: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function streamTurn(res: ServerResponse, turn: Turn): Promise<void> {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const write = (s: string) => { if (!res.destroyed && !res.writableEnded) res.write(s); };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  write(ev('message_start', { message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } } }));
  const delay = 'delay' in turn ? turn.delay ?? 0 : 0;
  if ('text' in turn) {
    write(ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
    for (const piece of turn.text) {
      await sleep(delay);
      write(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } }));
    }
    write(ev('content_block_stop', { index: 0 }));
    write(ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }));
  } else if ('tools' in turn) {
    await sleep(delay);
    turn.tools.forEach((t, index) => {
      const json = JSON.stringify(t.input);
      write(ev('content_block_start', { index, content_block: { type: 'tool_use', id: `call${seen.calls}_${index}`, name: t.name, input: {} } }));
      write(ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(0, Math.ceil(json.length / 2)) } }));
      write(ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(Math.ceil(json.length / 2)) } }));
      write(ev('content_block_stop', { index }));
    });
    write(ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }));
  }
  write(ev('message_stop', {}));
  res.end();
}

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const sent = JSON.parse(raw);
      const system = Array.isArray(sent.system) ? sent.system.map((b: { text: string }) => b.text).join('\n') : String(sent.system ?? '');
      // The server's own background writing (a conversion guide's overview) is not one of this test's questions.
      if (/overview at the top of a conversion guide/.test(system) || !sent.stream) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: 'An overview.' }], stop_reason: 'end_turn' }));
        return;
      }
      seen.calls++;
      res.on('close', () => { if (!res.writableEnded) seen.closed++; });
      const turn = turns.shift() ?? after_?.() ?? { text: ['Done.'] };
      if ('fail' in turn) {
        res.writeHead(turn.fail.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: turn.fail.message } }));
        return;
      }
      void streamTurn(res, turn);
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  const port = (model.address() as { port: number }).port;
  hosted = await host({ stores: ['Shop'], ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}` } });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Item' }, { name: 'Qty', type: 'number' }] },
    { op: 'createTable', name: 'Scratch', fields: [{ name: 'Note' }] },
  ] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.setPassword('Sam', 'sam-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
  model?.closeAllConnections();
  model?.close();
});

async function open(account = 'Ann', password = 'ann-secret-1'): Promise<Page & { errors: string[] }> {
  turns.length = 0;
  after_ = undefined;
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', account, password);
  await page.locator('.ai-button').first().click();
  return page;
}

async function ask(page: Page, question: string): Promise<void> {
  await page.locator('textarea.ai-input').fill(question);
  await page.keyboard.press('Enter');
}

const msgs = (page: Page) => page.locator('.ai-log .ai-msg');
const lines = (n: number, what = 'Line') => Array.from({ length: n }, (_, i) => `${what} ${i + 1} of the answer.`).join('\n\n');

test('an answer streams in without moving what is above it, follows only at the bottom, and its tool calls hide secrets', { skip }, async () => {
  const page = await open();
  try {
    // A long first answer, so the log scrolls.
    turns.push({ text: [lines(60)] });
    await ask(page, 'Say a lot');
    await page.locator('.ai-assistant', { hasText: 'Line 60 of the answer.' }).waitFor();

    // The second answer: two tool calls (one fine, one that fails, with a secret in its arguments), then words, slowly.
    const KEY = 'sk' + '-ant-api03-' + 'a1'.repeat(24);
    turns.push(
      { tools: [{ name: 'describe_layout', input: { layout: 'Orders' } }, { name: 'describe_layout', input: { layout: 'Nowhere', password: 'hunter2', note: `use ${KEY} here` } }], delay: 100 },
      { text: Array.from({ length: 12 }, (_, i) => `Piece ${i + 1}. `), delay: 150 },
    );
    await ask(page, 'Look at Orders');
    // Sending scrolls to the new question; then the person scrolls back up to the first answer, and reads it while the second streams.
    await page.locator('.ai-thinking .ai-tool').first().waitFor();
    const log = page.locator('.ai-log');
    await log.evaluate((el) => { el.scrollTop = 0; });
    await page.evaluate(() => {
      const el = document.querySelector('.ai-log')!;
      const samples: number[][] = [];
      (globalThis as unknown as { __samples: number[][] }).__samples = samples;
      const tick = () => samples.push([el.scrollTop, Math.round(el.querySelector('.ai-assistant')!.getBoundingClientRect().top - el.getBoundingClientRect().top)]);
      tick();
      (globalThis as unknown as { __timer: unknown }).__timer = globalThis.setInterval(tick, 50);
    });
    await page.locator('.ai-assistant', { hasText: 'Piece 12.' }).waitFor();
    const samples = await page.evaluate(() => {
      clearInterval((globalThis as unknown as { __timer: ReturnType<typeof setInterval> }).__timer);
      return (globalThis as unknown as { __samples: number[][] }).__samples;
    });
    assert.ok(samples.length > 5);
    assert.ok(samples.every(([top, at]) => top === samples[0][0] && at === samples[0][1]), `the log stayed put while it streamed: ${JSON.stringify([...new Map(samples.map((x) => [x.join(), x])).values()])}`);

    // The answer is whole, with its steps behind one line.
    const answer = msgs(page).last();
    await answer.locator('details.ai-did > summary', { hasText: '2 steps the assistant took' }).click();
    const tools = answer.locator('.ai-tool');
    assert.equal(await tools.count(), 2);
    assert.match(await tools.nth(0).innerText(), /^Done\s+Looking at layout "Orders"/);
    assert.match(await tools.nth(1).innerText(), /^Failed\s+Looking at layout "Nowhere"/);
    // Opened: what it asked for (secrets hidden) and what came back.
    await tools.nth(1).locator('summary').click();
    const asked = await tools.nth(1).locator('pre').first().innerText();
    assert.match(asked, /"layout": "Nowhere"/);
    assert.ok(!asked.includes('hunter2') && !asked.includes(KEY), asked);
    assert.match(asked, /"password": "‹hidden from AI tools›"/);
    await tools.nth(0).locator('summary').click();
    assert.match(await tools.nth(0).locator('pre').nth(1).innerText(), /Orders/);
    // Nowhere in the page, or in what the tab keeps, are the secret or the arguments.
    const html = await page.content();
    const kept = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    for (const secret of ['hunter2', KEY]) assert.ok(!html.includes(secret) && !kept.includes(secret));
    assert.ok(!kept.includes('"args"') && !kept.includes('"result"'), 'only the line about each call is kept');
    // Copy puts the call on the clipboard.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    // The counters: each answer's, and the conversation's, from what the server reported.
    const per = await page.locator('.ai-usage').allInnerTexts();
    assert.equal(per.length, 2);
    const total = (await page.locator('.ai-chat-total').innerText()).match(/This chat: 2 answers, ([\d,]+) tokens in(?: \(([\d,]+) cached\))?, ([\d,]+) out/)!;
    assert.ok(total, await page.locator('.ai-chat-total').innerText());
    const nums = (s: string) => s.match(/^([\d,]+) tokens in(?: \(([\d,]+) cached\))?, ([\d,]+) out/)!.slice(1).map((x) => Number((x ?? '0').replace(/,/g, '')));
    const sum = per.map(nums).reduce((a, b) => a.map((x, i) => x + b[i]));
    assert.deepEqual(total.slice(1).map((x) => Number((x ?? '0').replace(/,/g, ''))), sum);

    // The status region said what it was doing and then the answer once; nothing alerted.
    assert.match(await page.locator('[role=status].sr-only').innerText(), /^Answer: Piece 1\./);
    assert.equal(await page.locator('[role=alert].sr-only').innerText(), '');

    // At the bottom the log follows a streaming answer to the end.
    turns.push({ text: Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}.\n\n`), delay: 60 });
    await log.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await ask(page, 'And one more');
    await page.locator('.ai-assistant', { hasText: 'Paragraph 20.' }).waitFor();
    const gap = await log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    assert.ok(gap < 40, `followed to the bottom, ${gap}px short`);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a loop runs to the step limit and says so; Stop on another really stops it', { skip }, async () => {
  const page = await open();
  try {
    after_ = () => ({ tools: [{ name: 'describe_layout', input: { layout: 'Orders' } }] });
    seen.calls = seen.closed = 0;
    await ask(page, 'Keep looking');
    await page.locator('.ai-assistant', { hasText: 'took more steps than I allow' }).waitFor();
    const answer = msgs(page).last();
    await answer.locator('details.ai-did > summary', { hasText: '12 steps the assistant took' }).waitFor();
    assert.equal(seen.calls, 12, 'the server stopped at its limit');

    // Another loop, slower, stopped by the button.
    seen.calls = seen.closed = 0;
    after_ = () => ({ tools: [{ name: 'describe_layout', input: { layout: 'Orders' } }], delay: 250 });
    await ask(page, 'Keep looking, slowly');
    const stop = page.getByRole('button', { name: 'Stop' });
    await stop.waitFor();
    await page.locator('.ai-thinking .ai-tool').nth(2).waitFor();
    await stop.click();
    await page.getByRole('button', { name: 'Ask', exact: true }).waitFor();
    await msgs(page).last().getByText('Stopped.').waitFor();
    assert.equal(await page.locator('[role=status].sr-only').innerText(), 'Stopped.');
    // The server noticed: the call in flight was dropped, and nothing more was asked of the model.
    await until(async () => seen.closed, (n) => n >= 1, 10_000);
    const calls = seen.calls;
    await sleep(1500);
    assert.equal(seen.calls, calls, 'no more calls once stopped');
    // What it had done is kept as stopped steps; the question can be asked again; the box is usable.
    await msgs(page).last().locator('details.ai-did > summary').click();
    assert.ok((await msgs(page).last().locator('.ai-tool').count()) >= 3);
    assert.equal(await msgs(page).last().getByRole('button', { name: 'Try again' }).count(), 1);
    await page.locator('textarea.ai-input').fill('x');

    // Escape in the question box stops too.
    after_ = () => ({ tools: [{ name: 'describe_layout', input: { layout: 'Orders' } }], delay: 250 });
    await page.locator('textarea.ai-input').fill('Again, slowly');
    await page.keyboard.press('Enter');
    await page.locator('.ai-thinking .ai-tool').first().waitFor();
    await page.locator('textarea.ai-input').focus();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Ask', exact: true }).waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('failures say what kind they are and what to do, and are announced', { skip }, async () => {
  const page = await open();
  try {
    // The provider refuses (the stand-in answers 400): the model is the problem, asking again can work.
    turns.push({ fail: { status: 400, message: 'overloaded, try later' } });
    await ask(page, 'First question');
    const card = page.locator('.ai-error-provider');
    await card.getByText('The AI provider isn\'t answering').waitFor();
    assert.match(await card.innerText(), /overloaded, try later/);
    assert.match(await page.locator('[role=alert].sr-only').innerText(), /The AI provider isn't answering/);
    assert.equal(await page.locator('[role=status].sr-only').innerText(), '');
    // Try again asks the same question once more, and the failure goes.
    turns.push({ text: ['It works now.'] });
    await msgs(page).last().getByRole('button', { name: 'Try again' }).click();
    await page.locator('.ai-assistant', { hasText: 'It works now.' }).waitFor();
    assert.equal(await page.locator('.ai-error').count(), 0);
    assert.equal(await page.locator('.ai-user', { hasText: 'First question' }).count(), 1, 'one question, not two');
    // A good answer can be asked for again.
    turns.push({ text: ['A second try.'] });
    await msgs(page).last().getByRole('button', { name: 'Ask again' }).click();
    await page.locator('.ai-assistant', { hasText: 'A second try.' }).waitFor();
    assert.equal(await page.locator('.ai-assistant', { hasText: 'It works now.' }).count(), 0);

    // Refused before it starts: over budget, and blocked by policy. No retry is offered for either.
    const reply = (status: number, message: string) => page.route('**/tabularius/assistant/v1/databases/Shop', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: 3, message } }) }) : route.fallback());
    await reply(429, 'Today\'s limit of 100,000 tokens is used up; the AI assistant is available again tomorrow (UTC)');
    await ask(page, 'Over budget');
    await page.locator('.ai-error-budget').getByText('The assistant\'s budget is used up').waitFor();
    assert.match(await page.locator('[role=alert].sr-only').innerText(), /budget is used up/);
    assert.equal(await msgs(page).last().getByRole('button', { name: 'Try again' }).count(), 0);
    await page.unroute('**/tabularius/assistant/v1/databases/Shop');
    await reply(403, 'AI is turned off for this file');
    await ask(page, 'Not allowed');
    await page.locator('.ai-error-policy').getByText('Blocked by this file\'s AI policy').waitFor();
    assert.equal(await msgs(page).last().getByRole('button', { name: 'Try again' }).count(), 0);
    await page.unroute('**/tabularius/assistant/v1/databases/Shop');

    // The connection fails: it says so, and trying again works once it is back.
    await page.route('**/tabularius/assistant/v1/databases/Shop', (route) => (route.request().method() === 'POST' ? route.abort('connectionrefused') : route.fallback()));
    await ask(page, 'No connection');
    await page.locator('.ai-error-network').getByText('Can\'t reach the server').waitFor();
    await page.unroute('**/tabularius/assistant/v1/databases/Shop');
    turns.push({ text: ['Back again.'] });
    await msgs(page).last().getByRole('button', { name: 'Try again' }).click();
    await page.locator('.ai-assistant', { hasText: 'Back again.' }).waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a proposal that deletes things asks first, in a dialog only the person can answer', { skip }, async () => {
  const page = await open();
  try {
    await page.goto(`${hosted.url}/app/design.html`);
    await page.getByRole('button', { name: 'Ask AI' }).click();
    turns.length = 0;
    turns.push(
      { tools: [{ name: 'propose_design_change', input: { summary: 'Remove the scratch table', changes: [{ op: 'deleteTable', table: 'Scratch' }] } }] },
      { text: ['I\'ve proposed removing it.'] },
    );
    await ask(page, 'Get rid of the Scratch table');
    const card = page.locator('.ai-proposal', { hasText: 'Proposed: Remove the scratch table' });
    await card.waitFor();
    // Apply asks; Escape (or Cancel) leaves everything as it was.
    await card.getByRole('button', { name: 'Apply', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Apply these changes?' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Delete the table Scratch/);
    assert.equal(await dialog.getByRole('button', { name: 'Cancel' }).evaluate((el) => document.activeElement === el), true, 'the safe choice has the focus');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(hosted.store('Shop').schema.tables.some((t) => t.name === 'Scratch'), 'nothing was deleted');
    assert.equal(await card.getByRole('button', { name: 'Apply', exact: true }).isEnabled(), true);
    // Confirmed: it goes.
    await card.getByRole('button', { name: 'Apply', exact: true }).click();
    await dialog.getByRole('button', { name: 'Apply changes' }).click();
    await card.getByRole('button', { name: 'Applied' }).waitFor();
    assert.ok(!hosted.store('Shop').schema.tables.some((t) => t.name === 'Scratch'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a conversation survives a reload but not signing out, and the next account does not see it', { skip }, async () => {
  const page = await open();
  try {
    turns.push({ text: ['Orders has two fields.'] });
    await ask(page, 'What is in Orders?');
    await page.locator('.ai-assistant', { hasText: 'Orders has two fields.' }).waitFor();
    // A reload keeps it (the same sign-in).
    await page.reload();
    await page.locator('select.layout-menu').waitFor({ state: 'attached' });
    await page.locator('.ai-button').first().click();
    await page.locator('.ai-assistant', { hasText: 'Orders has two fields.' }).waitFor();
    // Signing out takes it away, and Sam does not get Ann's conversation.
    await page.getByRole('button', { name: 'Log Out' }).click();
    await page.locator('input[name="account"]').waitFor();
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('tabularius.assistant.'))), []);
    await page.locator('select[name="db"]').selectOption('Shop');
    await page.locator('input[name="account"]').fill('Sam');
    await page.locator('input[name="password"]').fill('sam-secret-1');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('select.layout-menu').waitFor({ state: 'attached' });
    await page.locator('.ai-button').first().click();
    await page.locator('.ai-hint').waitFor();
    assert.equal(await page.locator('.ai-assistant', { hasText: 'Orders has two fields.' }).count(), 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('a plan step that deletes records asks first; a step that only looks does not', { skip }, async () => {
  hosted.store('Shop').create('Orders', { Item: 'Pen', Qty: 1 });
  const page = await open();
  try {
    turns.push(
      { tools: [{ name: 'propose_plan', input: { summary: 'Remove the pens', layout: 'Orders', steps: [{ kind: 'find', why: 'The pens', query: [{ Item: 'Pen' }] }, { kind: 'delete', why: 'Remove them' }] } }] },
      { text: ['Here is the plan.'] },
    );
    await ask(page, 'Delete all the pens');
    const plan = page.locator('.agent-plan');
    await plan.waitFor();
    await plan.getByRole('button', { name: 'Dry run' }).click();
    await plan.getByText(/Dry run done on a copy/).waitFor();
    const runs = plan.getByRole('button', { name: 'Run', exact: true });
    // The find runs without a question.
    await runs.first().click();
    await plan.getByText('Step 1 done.').waitFor();
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    // The delete asks; Cancel leaves the record.
    await plan.getByRole('button', { name: 'Run', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Run step 2 for real?' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Delete records/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(hosted.store('Shop').query('SELECT count(*) AS n FROM "Orders"')[0].n, 1, 'nothing was deleted');
    // Confirmed, it runs.
    await plan.getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Run this step' }).click();
    await plan.getByText('All steps done.').waitFor();
    assert.equal(hosted.store('Shop').query('SELECT count(*) AS n FROM "Orders"')[0].n, 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

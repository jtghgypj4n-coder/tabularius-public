// Find and replace across every script, in Manage Database's Scripts tab, in a real browser, on a small database
// built here with no .fmp12: a search lists the lines that match (and says "Not found" when none do), Match case and
// Whole word narrow it, a result opens its script, and Replace all changes every script at once (after asking).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] },
    { op: 'createScript', name: 'Greet', text: 'Set Field [ Customers::City ; "Paris" ]\nSet Field [ Customers::Name ; "Parisian" ]' },
    { op: 'createScript', name: 'Move', text: 'Set Field [ Customers::City ; "Paris" ]' },
  ] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const text = (name: string) => hosted.store('Shop').schema.scripts.find((s) => s.name === name)?.steps.map((s) => s.line ?? s.name).join('\n') ?? '';

async function scripts(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Database…' }).click();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.locator('summary', { hasText: 'Find and replace' }).click();
  return page;
}

test('Find in scripts lists matching lines, narrows with Match case and Whole word, and a result opens its script', { skip }, async () => {
  const page = await scripts();
  try {
    const find = page.getByLabel('Find in scripts');
    await find.fill('Paris');
    await page.getByText('3 lines in 2 scripts').waitFor();
    await find.fill('nowhere');
    await page.getByText('Not found').waitFor();

    await find.fill('paris');
    await page.getByText('3 lines in 2 scripts').waitFor();
    await page.getByLabel('Match case').check();
    await page.getByText('Not found').waitFor();
    await page.getByLabel('Match case').uncheck();

    // Whole word: "Paris" is a word on two lines, not in "Parisian".
    await page.getByLabel('Whole word').check();
    await page.getByText('2 lines in 2 scripts').waitFor();

    await page.locator('.se-found button', { hasText: 'Move · line 1' }).click();
    await page.getByLabel('Steps of Move').waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Replace all asks first, then changes every script at once; Cancel changes nothing', { skip }, async () => {
  const page = await scripts();
  try {
    await page.getByLabel('Find in scripts').fill('Paris');
    await page.getByLabel('Replace with').fill('Rome');
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'Replace all' }).click();
    assert.match(text('Move'), /Paris/);

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Replace all' }).click();
    await until(async () => text('Move'), (t) => t.includes('Rome'));
    assert.doesNotMatch(text('Move'), /Paris/);
    assert.match(text('Greet'), /"Rome"/);
    assert.match(text('Greet'), /"Romeian"/);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

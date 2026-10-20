// Modernize interfaces: the board (cards in columns by a status, moved by menu or by dragging) and the calendar (a month
// of records by their date), in a real browser as the signed-in account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernizeChange } from '../../server/src/modernize.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const frameOf = (page: Awaited<ReturnType<typeof window>>) => page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const now = new Date();
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Work'] });
  const store = hosted.store('Work');
  store.applyDesign([{ op: 'createTable', name: 'Tasks', fields: [{ name: 'Title' }, { name: 'Status' }, { name: 'Due', type: 'date' }] }] as unknown as DesignOp[]);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  for (const [title, status, due] of [
    ['Write', 'To do', iso(now.getFullYear(), now.getMonth(), 10)], ['Review', 'Doing', iso(now.getFullYear(), now.getMonth(), 10)],
    ['Ship', 'Done', iso(now.getFullYear(), now.getMonth(), 20)], ['Plan', 'To do', iso(next.getFullYear(), next.getMonth(), 5)],
  ]) store.create('Tasks', { Title: title, Status: status, Due: due });
  store.applyDesign(modernizeChange(store, { styles: ['modern-board', 'modern-calendar', 'modern-list'] }).changes);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the board has a column for each status, and a card moves by its menu or by dragging', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Work', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Tasks - Modern board');
  const frame = frameOf(page);
  await until(() => frame.locator('.bcol').count(), (n) => n === 3);
  const inColumn = (value: string) => frame.locator(`ul.bcards[data-value="${value}"] strong`).allTextContents();
  assert.deepEqual((await inColumn('To do')).sort(), ['Plan', 'Write']);
  // The menu on a card (for keyboard use) moves it, and the change is saved.
  await frame.getByLabel('Move Write to').selectOption('Doing');
  await until(() => inColumn('Doing'), (t) => t.includes('Write') && t.length === 2);
  // Dragging a card to another column moves it too.
  await frame.locator('li', { hasText: 'Plan' }).dragTo(frame.locator('ul.bcards[data-value="Done"]'));
  await until(() => inColumn('Done'), (t) => t.includes('Plan'));
  // Both are saved: the table reads them back from the file.
  await frame.getByRole('button', { name: 'Table', exact: true }).click();
  await until(() => frame.locator('tbody tr', { hasText: 'Plan' }).innerText(), (t) => /Done/.test(t));
  assert.match(await frame.locator('tbody tr', { hasText: 'Write' }).innerText(), /Doing/);
  assert.deepEqual(page.errors, []);
});

test('the calendar shows the month\'s records on their days, pages by month, opens a record and adds one on a day', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Work', 'Ann', 'ann-secret-1');
  await goToLayout(page, 'Tasks - Modern calendar');
  const frame = frameOf(page);
  await until(() => frame.locator('#cal-month').textContent(), (t) => t === `${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
  await until(() => frame.locator('button.ev').count(), (n) => n === 3);
  // The 10th holds two records.
  assert.equal(await frame.locator('td', { has: frame.locator('.dn span', { hasText: /^10$/ }) }).locator('button.ev').count(), 2);
  await frame.locator('button.ev', { hasText: 'Ship' }).click();
  await until(() => frame.locator('input[data-field="Title"]').inputValue(), (v) => v === 'Ship');
  // The record's panel covers the right of the month until it is closed.
  await frame.locator('#back').click();
  // Next month has the other record.
  await frame.getByRole('button', { name: 'Next month' }).click();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  await until(() => frame.locator('#cal-month').textContent(), (t) => t === `${MONTHS[next.getMonth()]} ${next.getFullYear()}`);
  await until(() => frame.locator('button.ev').allTextContents(), (t) => t.length === 1 && t[0] === 'Plan');
  // A new record on a day gets that day's date.
  await frame.getByRole('button', { name: `New on ${MONTHS[next.getMonth()]} 12` }).click();
  await frame.locator('input[data-field="Title"]').fill('Party');
  await frame.locator('#save').click();
  await until(() => frame.locator('button.ev').allTextContents(), (t) => t.includes('Party'));
  assert.equal(await frame.locator('td', { has: frame.locator('.dn span', { hasText: /^12$/ }) }).locator('button.ev').count(), 1);
  assert.deepEqual(page.errors, []);
});

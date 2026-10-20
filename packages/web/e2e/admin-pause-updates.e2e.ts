// The admin console's Pause updates switch, in a real browser: while paused,
// the lists aren't refreshed (so a screen reader's place isn't lost); resuming
// refreshes at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Local'] });
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('Pause updates stops the admin console refreshing until it is resumed', { skip }, async () => {
  let polls = 0;
  page.on('request', (r) => { if (r.url().includes('/tabularius/admin/v1/status')) polls++; });
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#updated').textContent(), (t) => !!t?.startsWith('Updated'));
  const toggle = page.getByRole('button', { name: 'Pause updates' });
  await toggle.click();
  assert.equal(await page.locator('#pause-updates').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#updated').textContent(), 'Updates paused');
  const before = polls;
  // The status refresh runs every 5 seconds: none goes out while paused.
  await page.waitForTimeout(6000);
  assert.equal(polls, before);
  await page.getByRole('button', { name: 'Resume updates' }).click();
  await until(async () => polls, (n) => n > before);
  await until(() => page.locator('#updated').textContent(), (t) => !!t?.startsWith('Updated'));
  assert.equal(await page.locator('#pause-updates').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(page.errors, []);
});

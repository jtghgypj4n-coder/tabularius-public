// The admin console's conversion guide, in a real browser: "Write it again"
// keeps the keyboard's place on its button while the guide is rewritten, then
// moves it to the new guide.
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
  hosted = await host({ stores: ['Guide'] });
  hosted.store('Guide').applyDesign([{ op: 'createTable', name: 'Things', fields: [{ name: 'Name' }] }] as never);
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('"Write it again" keeps the focus on its button until the new guide is there', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await page.locator('[data-guide="Guide"]').click();
  const again = page.locator('[data-guide-again="Guide"]');
  await again.waitFor();
  // Hold the rewrite back, to look at the page while it runs.
  let release!: () => void;
  const held = new Promise<void>((ok) => (release = ok));
  await page.route('**/tabularius/admin/v1/conversion-guide/**', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });
  await again.focus();
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.activeElement?.textContent), (t) => t === 'Writing the guide again…');
  assert.equal(await page.locator('#guide').getAttribute('aria-busy'), 'true');
  release();
  await until(() => page.evaluate(() => document.activeElement?.id), (id) => id === 'guide');
  assert.equal(await page.locator('#guide').getAttribute('aria-busy'), null);
  await again.waitFor();
  assert.deepEqual(page.errors, []);
});

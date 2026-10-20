// The admin console tells a failure in its alert region instead of the browser's alert box: a failed request
// shows its message there, which stays until dismissed, and no browser dialog opens.
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
  hosted = await host({ stores: ['Shop'] });
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a failed action is said in the alert region, and can be dismissed', { skip }, async () => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#audit-db option').count(), (n) => n > 0);
  assert.equal(await page.locator('#said').isHidden(), true);
  // A session timeout the server refuses.
  await page.evaluate(() => (globalThis as unknown as { say(m: string): void }).say("Couldn't do it: no."));
  await page.locator('#said[role=alert]').waitFor();
  assert.match((await page.locator('#said-text').textContent()) ?? '', /Couldn't do it: no\./);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  assert.equal(await page.locator('#said').isHidden(), true);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(page.errors, []);
});

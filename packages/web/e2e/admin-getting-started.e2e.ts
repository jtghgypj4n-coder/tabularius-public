// The admin console's Getting started list, in a real browser: it shows what is left from the server's real state,
// its Back up now button does the step, and the step then reads as done.
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

test('Getting started lists what is left, and Back up now completes its step', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  const list = page.locator('#setup-list');
  await list.waitFor();
  const backup = list.locator('li', { hasText: 'Make a first backup' });
  await until(() => backup.count(), (n) => n === 1);
  assert.equal(await list.locator('li', { hasText: 'Set the admin password' }).getAttribute('class'), '');
  assert.match(await page.locator('#setup-count').textContent() ?? '', /of \d+ done/);
  await backup.getByRole('button', { name: 'Back up now' }).click();
  await until(() => backup.getAttribute('class'), (c) => c === 'done');
  assert.deepEqual(page.errors, []);
});

// The welcome page, in a real browser: a file with something big in it (container files stored inside) is hosted,
// then the page says so and waits for "Open", instead of rushing on to the web client; a lean file opens at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { FIXTURES, host, launch, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless('DEMO_drawers.fmp12', 'Standards.fmp12');
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({});
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a file that is mostly container files is hosted, then the page says so and waits to open it', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await page.locator('#welcome-modernize').check();
  await page.locator('#welcome-file').setInputFiles(join(FIXTURES, 'DEMO_drawers.fmp12'));
  const open = page.getByRole('button', { name: 'Open DEMO_drawers' });
  await open.waitFor({ timeout: 60_000 });
  const status = await page.locator('#welcome-status').innerText();
  assert.match(status, /DEMO_drawers is hosted\./);
  assert.match(status, /1 suggestion|\d+ suggestions/);
  assert.match(status, /Container files inside the file: RECORD::field_container_01/);
  assert.ok(page.url().includes('/admin/'), 'still here: not sent on yet');
  await open.click();
  // The box ticked on the welcome page still counts after reading the report.
  await page.waitForURL(/\/app\/\?db=DEMO_drawers&modernize=1/);
});

test('a lean file opens at once', { skip }, async () => {
  const lean = await window(browser);
  await lean.goto(hosted.url + '/admin/#welcome');
  await lean.locator('#welcome-file').setInputFiles(join(FIXTURES, 'Standards.fmp12'));
  await lean.waitForURL(/\/app\/\?db=Standards/, { timeout: 60_000 });
});

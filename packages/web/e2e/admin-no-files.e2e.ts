// The admin console with no files hosted: the access pages (View as, What can a set do, Test account, Compare, SSO,
// SCIM, Field access) say "No files are hosted." as the Audit, Events and Health pages do, instead of staying blank.
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
  hosted = await host({});
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const LOADERS: [loader: string, shows: string][] = [
  ['loadViewAsPickers', '#viewas-summary'],
  ['loadAccessPickers', '#access-summary'],
  ['loadTestAccountPickers', '#testaccount-summary'],
  ['loadComparePickers', '#compare-summary'],
  ['loadSsoMapping', '#sso-mappings'],
  ['loadScim', '#scim-status'],
  ['loadFieldAccessPickers', '#fieldaccess-summary'],
];

test('each access page says no files are hosted', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#viewas-db').count(), (n) => n === 1);
  for (const [loader, shows] of LOADERS) {
    await page.evaluate((name) => (globalThis as unknown as Record<string, () => Promise<void>>)[name](), loader);
    assert.match((await page.locator(shows).textContent()) ?? '', /No files are hosted\./, loader);
  }
  assert.deepEqual(page.errors, []);
});

// The admin console's Add a connection form, in a real browser: a REST connection offers well-known services, and
// choosing one fills in its settings (never a secret) and shows where the secrets come from; the connection is then
// a draft waiting for the secrets.
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

test('choosing a service fills in its settings and adds a draft that waits for the secrets', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#updated').textContent(), (t) => !!t?.startsWith('Updated'));
  await page.locator('#connections-section summary').click();
  // S3 has no well-known services, so there is no picker.
  assert.equal(await page.locator('#connection-service').isHidden(), true);
  await page.locator('#connection-type').selectOption('rest');
  await until(() => page.locator('#connection-service').isVisible(), (v) => v === true);
  await page.locator('#connection-service-pick').selectOption('google-drive');
  assert.match((await page.locator('#connection-service-help').textContent())!, /refresh token/);
  assert.equal(await page.locator('[name="config.baseUrl"]').inputValue(), 'https://www.googleapis.com/drive/v3');
  assert.equal(await page.locator('[name="config.scope"]').inputValue(), 'https://www.googleapis.com/auth/drive.file');
  // Choosing another service leaves nothing of the first one (its scope and test path) in the form.
  await page.locator('#connection-service-pick').selectOption('dropbox');
  assert.equal(await page.locator('[name="config.baseUrl"]').inputValue(), 'https://api.dropboxapi.com/2');
  assert.equal(await page.locator('[name="config.scope"]').inputValue(), '');
  assert.equal(await page.locator('[name="config.testPath"]').inputValue(), '');
  await page.locator('#connection-service-pick').selectOption('google-drive');
  assert.equal(await page.locator('[name="config.tokenUrl"]').inputValue(), 'https://oauth2.googleapis.com/token');
  assert.equal(await page.locator('[name="config.auth"]').inputValue(), 'oauth2-refresh');
  await page.locator('#add-connection [name="name"]').fill('drive');
  await page.locator('#add-connection button.primary').click();
  await until(() => page.locator('#connections').textContent(), (t) => !!t?.includes('Draft: waiting for you'));
  const text = (await page.locator('#connections').textContent())!;
  assert.match(text, /Refresh token/);
  assert.match(text, /Client secret/);
  assert.deepEqual(page.errors, []);
});

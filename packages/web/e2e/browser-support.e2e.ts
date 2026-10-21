import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { host, launch, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({});
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('self-check reports missing features, local storage, server round trip, clock estimate and privacy-safe session state', { skip }, async () => {
  const page = await window(browser);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: undefined });
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    sessionStorage.setItem('tabularius.session', JSON.stringify({ db: 'PRIVATE_FILE', token: 'SECRET_TOKEN' }));
  });
  try {
    await page.goto(hosted.url + '/app/self-check.html');
    await page.waitForFunction(() => document.querySelector('#results')?.textContent?.includes('Server round trip:'));
    const report = await page.locator('#results').innerText();
    for (const name of ['Modules', 'structuredClone', 'IndexedDB', 'WebAuthn', 'Service workers', 'Clipboard', 'ResizeObserver', 'Local storage', 'Session state', 'Server round trip']) assert.ok(report.includes(name), name);
    for (const name of ['IndexedDB', 'WebAuthn', 'Service workers', 'Clipboard', 'ResizeObserver']) assert.match(report, new RegExp(`${name}: unavailable`));
    assert.match(report, /Session state: available — present/);
    assert.match(report, /clock estimate -?\d+ ms/);
    assert.ok(!report.includes('SECRET_TOKEN'));
    assert.ok(!report.includes('PRIVATE_FILE'));
    await page.getByRole('button', { name: /Copy results/ }).click();
    assert.match(await page.getByRole('button').innerText(), /Clipboard unavailable/);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('copy results copies diagnostics without session tokens, file names or account names', { skip }, async () => {
  const page = await window(browser);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => sessionStorage.setItem('tabularius.session', JSON.stringify({ db: 'PRIVATE_FILE', token: 'SECRET_TOKEN', account: 'PRIVATE_ACCOUNT' })));
  try {
    await page.goto(hosted.url + '/app/self-check.html');
    await page.waitForFunction(() => document.querySelector('#results')?.textContent?.includes('Server round trip:'));
    await page.getByRole('button', { name: 'Copy results' }).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /Server round trip: available/);
    assert.ok(!copied.includes('SECRET_TOKEN'));
    assert.ok(!copied.includes('PRIVATE_FILE'));
    assert.ok(!copied.includes('PRIVATE_ACCOUNT'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('missing module support replaces the loading screen with a named feature and next step', { skip }, async () => {
  const page = await window(browser);
  // A browser without module support never runs the entry point: serve it empty so only the page's own fallback can replace "Loading…".
  await page.route('**/src/main.ts', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => { delete (HTMLScriptElement.prototype as unknown as { noModule?: boolean }).noModule; });
  try {
    await page.goto(hosted.url + '/app/');
    await page.locator('#app .fatal').getByText(/Modules is unavailable/).waitFor();
    assert.equal(await page.locator('#app .loading').count(), 0);
    assert.match(await page.locator('#app .fatal').innerText(), /JavaScript module support/);
  } finally {
    await page.close();
  }
});

test('missing structuredClone replaces the sign-in screen with a clear support message', { skip }, async () => {
  const page = await window(browser);
  await page.addInitScript(() => Object.defineProperty(window, 'structuredClone', { configurable: true, value: undefined }));
  try {
    await page.goto(hosted.url + '/app/');
    await page.getByRole('alert').getByText(/structuredClone is unavailable/).waitFor();
    assert.ok(await page.getByRole('link', { name: 'Run browser self-check' }).isVisible());
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('missing features that change what the page can do show a dismissible plain-language notice; a missing clipboard alone does not', { skip }, async () => {
  const quiet = await window(browser);
  await quiet.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  try {
    await quiet.goto(hosted.url + '/app/');
    await quiet.locator('input[name="account"]').waitFor();
    assert.equal(await quiet.getByRole('status', { name: 'Browser feature support' }).count(), 0);
  } finally {
    await quiet.close();
  }
  const page = await window(browser);
  await page.addInitScript(() => { delete (Navigator.prototype as unknown as { serviceWorker?: unknown }).serviceWorker; });
  try {
    await page.goto(hosted.url + '/app/');
    const notice = page.getByRole('status', { name: 'Browser feature support' });
    await notice.getByText(/Service workers is unavailable/).waitFor();
    assert.ok(await notice.getByText(/offline loading is unavailable/).isVisible());
    assert.equal(await notice.getByRole('link', { name: 'Run browser self-check' }).getAttribute('href'), 'self-check.html');
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    assert.equal(await page.getByRole('status', { name: 'Browser feature support' }).count(), 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

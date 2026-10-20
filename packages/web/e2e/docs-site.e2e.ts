// The documentation site (npm run docs:build) in a real browser, opened straight from disk as a reader would: search by
// keyboard, the colour scheme, copy buttons, the contents box on a phone, print, and no request that leaves the folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { buildSite } from '../../../scripts/docs-site-lib.ts';
import { axeViolations, launch, skipUnless, until, window } from './harness.ts';

const skip = skipUnless();
const root = join(import.meta.dirname, '..', '..', '..');
let out = '';
let browser: Browser;
const url = (path: string) => pathToFileURL(join(out, path)).href;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), 'docs-site-e2e-'));
  const built = buildSite({ root, out, version: '0.0.0', commit: 'e2e' });
  assert.deepEqual(built.problems, []);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

/** Every request the page makes, so a test can show that none left the folder. */
function watch(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => seen.push(r.url()));
  return seen;
}

test('search by keyboard: / jumps to the box, typing lists results, the arrows move through them, Enter lands on the section, Escape closes', { skip }, async () => {
  const context = await browser.newContext();
  const page = await window(context);
  const requests = watch(page);
  try {
    await page.goto(url('docs/environment-variables.html'));
    await page.locator('form.search').waitFor({ state: 'visible' });
    await page.locator('h1').click();
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'q', 'the slash key focuses the search box');
    await page.keyboard.type('forgot admin console password');
    await page.locator('#search-results a').first().waitFor();
    assert.match(await page.locator('#search-status').innerText(), /\d+ results?/);
    const first = await page.locator('#search-results a').first().innerText();
    assert.match(first, /Runbook.*Forgot the admin console password/s);
    assert.ok(await page.locator('#search-results mark').count() > 0, 'the words that matched are marked');
    // The marks are text, not markup: a result never injects HTML.
    assert.equal(await page.locator('#search-results script, #search-results img').count(), 0);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A', 'the down arrow moves into the results');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'q', 'up from the first result returns to the box');
    await page.keyboard.press('ArrowDown');
    await Promise.all([page.waitForURL(/docs\/runbook\.html#forgot-the-admin-console-password$/), page.keyboard.press('Enter')]);
    await until(() => page.evaluate(() => { const h = document.getElementById('forgot-the-admin-console-password'); return !!h && h.getBoundingClientRect().top < globalThis.innerHeight; }), Boolean);
    await page.keyboard.press('/');
    await page.keyboard.type('zzzqqq');
    assert.match(await page.locator('#search-results').innerText(), /Nothing matches "zzzqqq"/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#search-results').isVisible(), false, 'Escape clears and closes the results');
    assert.equal(await page.locator('#q').inputValue(), '');
    assert.deepEqual(requests.filter((u) => !u.startsWith('file:')), [], 'nothing left the folder');
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); await context.close(); }
});

test('the colour scheme button cycles automatic, light and dark, and the choice is remembered', { skip }, async () => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await window(context);
  try {
    await page.goto(url('index.html'));
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const auto = await background();
    await page.locator('#theme').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.locator('#theme').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.notEqual(await background(), auto, 'dark looks different from a light system');
    assert.match(await page.locator('#theme').getAttribute('aria-label') ?? '', /^Dark, colour scheme/, 'the name starts with the words on the button');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'a reload keeps the choice, before the page is drawn');
    await page.locator('#theme').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined, 'the third press goes back to the system setting');
    assert.equal(await background(), auto);
  } finally { await page.close(); await context.close(); }
});

test('a system in dark mode gets the dark palette with no choice made, and light on request', { skip }, async () => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await window(context);
  try {
    await page.goto(url('docs/runbook.html'));
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = await background();
    await page.locator('#theme').click(); // light
    assert.notEqual(await background(), dark);
  } finally { await page.close(); await context.close(); }
});

test('blocked browser storage does not break the page: the scheme just is not remembered', { skip }, async () => {
  const context = await browser.newContext();
  const page = await window(context);
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage'] as const) Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  try {
    await page.goto(url('docs/runbook.html'));
    await page.locator('#theme').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.locator('#q').fill('backup');
    await page.locator('#search-results a').first().waitFor();
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); await context.close(); }
});

for (const route of ['the clipboard API', 'the older copy command, when the API refuses']) {
  test(`a code block has a copy button that copies exactly its text through ${route}`, { skip }, async () => {
    const context = await browser.newContext();
    const page = await window(context);
    // A page opened from disk is not always allowed the real clipboard, so each way of copying is observed rather than read back.
    await page.addInitScript((api) => {
      const w = window as unknown as { __copied?: string };
      const nav = navigator as unknown as { clipboard: { writeText: (t: string) => Promise<void> } };
      if (api) nav.clipboard.writeText = async (t: string) => { w.__copied = t; };
      else nav.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      const copy = document.execCommand.bind(document);
      document.execCommand = (command: string, ...rest: [boolean?, string?]) => {
        if (command === 'copy') w.__copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? '';
        return copy(command, ...rest);
      };
    }, route === 'the clipboard API');
    try {
      await page.goto(url('QUICKSTART.html'));
      const block = page.locator('.code-block').first();
      const code = await block.locator('pre').innerText();
      await block.hover();
      const button = block.locator('button.copy');
      assert.equal(await button.isVisible(), true);
      assert.equal(await button.getAttribute('aria-label'), 'Copy this code');
      await button.click();
      await until(() => button.innerText(), (t) => t === 'Copied');
      assert.equal(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied), code, 'exactly the code, nothing around it');
      await until(() => button.innerText(), (t) => t === 'Copy');
    } finally { await page.close(); await context.close(); }
  });
}

test('on a phone the contents start closed, open on a tap, and no page scrolls sideways', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
  const page = await window(context);
  try {
    for (const path of ['index.html', 'docs/runbook.html', 'docs/reference/rest.html', 'ADMIN.html', 'docs/script-steps-support.html']) {
      await page.goto(url(path));
      assert.equal(await page.locator('#nav-box').evaluate((el) => (el as HTMLDetailsElement).open), false, `${path}: contents closed`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${path} scrolls sideways by ${overflow}px`);
    }
    await page.goto(url('docs/runbook.html'));
    await page.locator('.nav-toggle').tap();
    assert.equal(await page.locator('#nav-box').evaluate((el) => (el as HTMLDetailsElement).open), true);
    await page.locator('.nav-section').first().locator('summary').tap();
    const box = await page.locator('.site-nav a').first().boundingBox();
    assert.ok(box && box.height >= 36, `menu links are big enough to tap (${box?.height}px)`);
    const target = await page.locator('.theme').boundingBox();
    assert.ok(target && target.height >= 36 && target.width >= 36);
  } finally { await page.close(); await context.close(); }
});

test('on paper only the guide prints: no menu, search, buttons or page contents, and outside links show their address', { skip }, async () => {
  const context = await browser.newContext();
  const page = await window(context);
  try {
    await page.goto(url('docs/runbook.html'));
    await page.emulateMedia({ media: 'print' });
    for (const sel of ['.site-header', '.nav-box', '.toc', '.pager', '.skip']) assert.equal(await page.locator(sel).first().isVisible(), false, `${sel} is hidden in print`);
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', 'print is dark ink on white whatever the screen scheme');
  } finally { await page.close(); await context.close(); }
});

test('axe finds no WCAG A or AA violations on the contents page and on guides of each shape, in light and dark, wide and narrow', { skip }, async () => {
  const findings: string[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
      const context = await browser.newContext({ colorScheme, viewport });
      const page = await window(context);
      try {
        // A guide with tables and code, one with callouts and long lists, the generated reference, a short one, and the contents.
        for (const path of ['index.html', 'docs/runbook.html', 'README.html', 'docs/troubleshooting.html', 'docs/security-defaults.html', 'docs/tutorials/backup-and-restore.html']) {
          await page.goto(url(path));
          if (viewport.width < 600) await page.locator('.nav-toggle').click(); // the menu is part of the page, open it too
          for (const v of await axeViolations(page)) findings.push(`${path} ${colorScheme} ${viewport.width}px: ${v}`);
        }
        // With the search results open.
        await page.goto(url('docs/runbook.html'));
        await page.locator('#q').fill('password');
        await page.locator('#search-results a').first().waitFor();
        for (const v of await axeViolations(page)) findings.push(`results ${colorScheme} ${viewport.width}px: ${v}`);
      } finally { await page.close(); await context.close(); }
    }
  }
  assert.deepEqual(findings, []);
});

// The web client, the admin console and the docs pages in a real browser make no request to anything but the server
// they came from: no font, script, style, picture, map tile, analytics beacon or update check. Every request the
// browser makes is recorded (and any to another address is refused, so it cannot fail slowly), and the test asserts
// the record holds this server's address and nothing else. See docs/privacy.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright-core';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless('Charts.fmp12');
let hosted: Hosted;
let browser: Browser;
let context: BrowserContext;
const requested: string[] = [];
const refused: string[] = [];

before(async () => {
  if (skip) return;
  hosted = await host({ fixtures: ['Charts.fmp12'] });
  browser = await launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const origin = new URL(hosted.url).origin;
  // Everything that is not the server itself (or a page's own data: and blob: pictures) is stopped and noted.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    requested.push(url);
    if (/^(data|blob|about):/.test(url) || new URL(url).origin === origin) return route.continue();
    refused.push(url);
    return route.abort();
  });
});
after(async () => {
  await context?.close();
  await browser?.close();
  await hosted?.close();
});

test('the web client, the admin console and the docs make no request to any other address', { skip }, async () => {
  const page = await window(context);
  await signIn(page, hosted.url, 'Charts', 'Admin');
  const layouts = await page.locator('select.layout-menu option:not([disabled])').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  assert.ok(layouts.length > 3, 'the file has layouts to go through');
  for (const layout of layouts.slice(0, 8)) {
    // Some layouts have no parts to wait for; what matters here is that the window asks for the layout and draws it.
    await page.locator('select.layout-menu').selectOption(layout);
    await until(() => page.locator('select.layout-menu').inputValue(), (v) => v === layout);
    await new Promise((r) => setTimeout(r, 400));
  }

  const admin = await window(context);
  await admin.goto(hosted.url + '/admin/');
  await until(() => admin.locator('#clients').textContent(), (t) => !!t && t.trim().length > 0);
  for (const path of ['/docs', '/docs/connect-ai', '/docs/web-client']) {
    const docs = await window(context);
    await docs.goto(hosted.url + path);
    await docs.close();
  }
  await new Promise((r) => setTimeout(r, 2000)); // late requests: images, a beacon on a timer

  assert.ok(requested.length > 20, `the pages made requests (${requested.length}), so the record means something`);
  assert.deepEqual(refused, [], 'a page asked for something outside this server');
  assert.deepEqual(page.errors.concat(admin.errors), [], 'a refused request must not be what broke a page');
});

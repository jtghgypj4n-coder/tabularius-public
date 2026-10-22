// The admin console's web viewer hosts, in a real browser: a file allows none to begin with and the console says so,
// Change takes a list (a bad one is refused in words and changes nothing), and the file then shows the hosts.
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

test('Change lists the web hosts a file\'s web viewers may load; a bad host is refused in words', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  const note = page.locator('#web-hosts-note');
  await until(() => note.textContent(), (t) => /Web viewers show only their own content/.test(t ?? ''));
  assert.match(await page.locator('#web-hosts').innerText(), /Nothing \(their own content only\)/);

  const answerWith = (text: string) => page.once('dialog', (d) => void d.accept(text));
  answerWith('https://maps.example.com');
  await page.getByRole('button', { name: /Change the web hosts Local's web viewers may load/ }).click();
  await until(() => page.locator('#said-text').innerText(), (t) => /just a host name/.test(t));
  assert.deepEqual(hosted.store('Local').webViewerHosts, []);

  answerWith('maps.example.com, *.cdn.example.org');
  await page.getByRole('button', { name: /Change the web hosts Local's web viewers may load/ }).click();
  await until(() => page.locator('#web-hosts').innerText(), (t) => /https:\/\/maps\.example\.com/.test(t) && /https:\/\/\*\.cdn\.example\.org/.test(t));
  assert.deepEqual(hosted.store('Local').webViewerHosts, ['*.cdn.example.org', 'maps.example.com']);
  await until(() => note.isHidden(), (hidden) => hidden);
  assert.deepEqual(page.errors, []);
});

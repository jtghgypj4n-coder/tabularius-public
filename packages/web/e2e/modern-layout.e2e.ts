// Modern layouts in a real browser: a layout that is one web viewer filling the window, its page written in HTML,
// CSS and JavaScript. The starter page lists the layout's records through window.tabularius; Layout mode's page editor
// rewrites it, with a preview, as one step that Save keeps in the address formula.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { tourSteps } from '../src/design/page-api-tour.ts';
import { modernDesign, pageSource } from '../src/page-source.ts';
import { goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Modern'] });
  const store = hosted.store('Modern');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Customers')!.id;
  store.applyDesign([{ op: 'createLayout', name: 'Home', occurrence, design: modernDesign('Home', 'Customers') }] as DesignOp[]);
  store.create('Customers', { Name: 'Ada', City: 'London' });
  store.create('Customers', { Name: 'Grace', City: 'Arlington' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a modern layout fills the window with its page, which reads the records it lists', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Modern', 'Ann', PASSWORD);
  await goToLayout(page, 'Home');
  const frame = page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer');
  await until(() => frame.locator('#count').textContent(), (t) => t === '2');
  assert.deepEqual(await frame.locator('li').allTextContents(), ['Ada · London', 'Grace · Arlington']);
  assert.equal(await frame.locator('h1').textContent(), 'Home');
  assert.deepEqual(page.errors, []);
});

test("Layout mode's page editor rewrites the page, with a preview, and Save keeps it", { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Modern', 'Ann', PASSWORD);
  await goToLayout(page, 'Home');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Layout' }).click();
  await page.locator('.le-obj[data-id="1"]').waitFor();
  await page.getByRole('button', { name: 'Edit page…' }).click();
  const code = page.getByRole('textbox', { name: 'Page HTML, CSS and JavaScript' });
  await until(() => code.inputValue(), (v) => v.includes('<h1>Home</h1>'));
  await code.fill('<h1 id="t">Welcome #1</h1><script>tabularius.context().then(function (c) { document.getElementById("t").textContent += " on " + c.layout })</script>');
  // The preview follows the typing (no data calls there: the page gets them in Browse mode).
  await until(() => page.frameLocator('.le-page-preview iframe').locator('#t').textContent(), (t) => t === 'Welcome #1');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => pageSource(hosted.store('Modern').design('Home')!.objects[0].webUrl), (s) => !!s?.startsWith('<h1 id="t">Welcome #1</h1>'));
  await page.getByRole('button', { name: 'Exit Layout' }).click();
  await until(() => page.frameLocator('.fm[data-id="1"] iframe.fm-webviewer').locator('#t').textContent(), (t) => t === 'Welcome #1 on Home');
});

test("the page editor's API tour steps through the calls and adds a snippet to the page", { skip }, async () => {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Modern', 'Ann', PASSWORD);
  await goToLayout(page, 'Home');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Layout' }).click();
  await page.locator('.le-obj[data-id="1"]').waitFor();
  await page.getByRole('button', { name: 'Edit page…' }).click();
  const tour = page.getByRole('region', { name: 'Page API tour' });
  assert.equal(await tour.isVisible(), false);
  await page.getByRole('button', { name: 'Page API tour' }).click();
  await tour.waitFor({ state: 'visible' });
  // However many calls the tour has grown to cover.
  await tour.getByText(`1 of ${tourSteps('Home').length}`).waitFor();
  await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('heading', { name: 'Read records' }).waitFor();
  const code = page.getByRole('textbox', { name: 'Page HTML, CSS and JavaScript' });
  // (The page the earlier test saved calls Tabularius unguarded, which the editor's preview has no calls for.)
  await code.fill('<h1 id="t">Tour</h1><script>var x = 1;</script>');
  await until(() => page.frameLocator('.le-page-preview iframe').locator('#t').textContent(), (t) => t === 'Tour');
  page.errors.length = 0;
  await tour.getByRole('button', { name: 'Add to page' }).click();
  await until(() => code.inputValue(), (v) => v.includes('if (window.tabularius) {') && v.includes('tabularius.records("Home"') && v.indexOf('tabularius.records') < v.lastIndexOf('</script>'));
  assert.deepEqual(page.errors, []);
});

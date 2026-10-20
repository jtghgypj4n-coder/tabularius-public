// Manage > Themes > "Restyle every layout…" offers starter looks (Light, Dark, Plain, Warm): picking one fills in the
// colours, font and corners at once, and a preview of the file's layouts follows. Built here with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('a starter look fills in the restyle form, and the layouts can be previewed with it', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
    await page.getByRole('menuitem', { name: 'Layouts…' }).click();
    await page.getByLabel('New layout name').waitFor();
    await page.getByRole('tab', { name: 'Themes' }).click();
    assert.match(await page.locator('.d-main').innerText(), /Light, Dark, Plain or Warm/);
    await page.getByRole('button', { name: 'Restyle every layout…' }).click();

    const main = page.locator('.d-main');
    const start = main.getByLabel('Start from');
    assert.deepEqual(await start.locator('option').allInnerTexts(), ['Tabularius\'s look', 'Starter: Light', 'Starter: Dark', 'Starter: Plain', 'Starter: Warm']);
    await start.selectOption({ label: 'Starter: Dark' });
    assert.equal(await main.getByLabel('Accent', { exact: true }).inputValue(), '#4fc3d4');
    assert.equal(await main.getByLabel('Background', { exact: true }).inputValue(), '#14191c');
    assert.equal(await main.getByLabel('New theme name').inputValue(), 'Dark');

    await start.selectOption({ label: 'Starter: Plain' });
    assert.equal(await main.getByLabel('Accent', { exact: true }).inputValue(), '#1a1a1a');
    assert.equal(await main.getByLabel('Corner radius').inputValue(), '2');
    assert.match(await main.getByLabel('Font').inputValue(), /Helvetica/);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.locator('.d-restyle-results').getByText(/Customers|layout/i).first().waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

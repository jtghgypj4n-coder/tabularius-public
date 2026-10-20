// Landing pages per privilege set in a real browser: when the file opens, each account lands on its own set's modern
// layout, which greets it and lists the layouts it may open; a card goes to that layout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { modernDesign } from '../src/page-source.ts';
import { HOME_PREFIX, homePage, homeScript } from '../src/page-templates.ts';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const SETS = ['[Full Access]', 'Clerk'];

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Land'] });
  const store = hosted.store('Land');
  store.applyDesign([{ op: 'createTable', name: 'Orders', fields: [{ name: 'Item' }] }, { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] }] as DesignOp[]);
  store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'] } as never);
  const occurrence = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!.id;
  const sets = SETS.map((set) => ({ set, layout: `${HOME_PREFIX}${set}` }));
  store.applyDesign([
    ...sets.map((x) => ({ op: 'createLayout', name: x.layout, occurrence, design: modernDesign(x.layout, x.layout, homePage(x.layout, x.set)) })),
    { op: 'createScript', name: 'Go to my home page', text: homeScript(sets) },
    { op: 'setFileOptions', onFirstWindowOpen: 'Go to my home page' },
  ] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.setPassword('Cleo', 'cleo-secret-1', 'Clerk');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function land(account: string, password: string) {
  const page = await window(await browser.newContext());
  await page.goto(hosted.url + '/app/');
  await page.locator('select[name="db"]').selectOption('Land');
  await page.locator('input[name="account"]').fill(account);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('select.layout-menu').waitFor();
  return page;
}

test('each account lands on its privilege set\'s page, greeted by name, with a card for each layout it may open', { skip }, async () => {
  for (const [account, password, set] of [['Ann', 'ann-secret-1', '[Full Access]'], ['Cleo', 'cleo-secret-1', 'Clerk']] as const) {
    const page = await land(account, password);
    await until(() => page.locator('select.layout-menu').inputValue(), (v) => v === `${HOME_PREFIX}${set}`);
    const frame = page.frameLocator('iframe.fm-webviewer');
    await until(() => frame.locator('#hello').textContent(), (t) => t === `Welcome, ${account}`);
    assert.equal(await frame.locator('#set').textContent(), set);
    // The other landing page is left out; the table layouts are there.
    const cards = await until(() => frame.locator('#links button').allTextContents(), (c) => c.length > 0);
    assert.ok(cards.includes('Orders') && cards.includes('Customers'), cards.join(', '));
    assert.ok(!cards.some((c) => c.startsWith(HOME_PREFIX)), cards.join(', '));
    await frame.locator('#links button', { hasText: 'Customers' }).click();
    await until(() => page.locator('select.layout-menu').inputValue(), (v) => v === 'Customers');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
});

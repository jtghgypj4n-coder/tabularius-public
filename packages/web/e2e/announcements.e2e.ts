// Screen-reader announcements use the real Chromium accessibility tree, on a database built here without fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { axTreeSnapshot, answer, field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
let nameId = 0;
let itemId = 0;
const PORTAL = 900;
const PORTAL_ITEM = 901;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Secret' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
  ] as DesignOp[]);
  const design = store.design('Customers')!;
  nameId = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  const hiddenSecretId = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Secret')!.id;
  itemId = store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === 'Item')!.id;
  const orders = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const style = design.objects.find((o) => o.id === nameId)!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const item: LayoutObject = { id: PORTAL_ITEM, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 152, left: 162, bottom: 174, right: 400 }, field: { tableOccurrenceId: orders.id, fieldId: itemId, tableOccurrence: 'Orders', field: 'Item', display: 'edit', repetitions: 1 } } as LayoutObject;
  const portal: LayoutObject = { id: PORTAL, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 150, left: 160, bottom: 224, right: 420 }, portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 3, initialRow: 1, allowDelete: true }, children: [item] } as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts: design.parts.map((p) => p.kind === 'body' ? { ...p, height: 250 } : p), objects: [...design.objects.filter((o) => o.id !== hiddenSecretId), portal] } }] as DesignOp[]);
  for (const [Id, Name, Secret] of [[1, 'Ada', 'hidden-one'], [2, 'Grace', 'hidden-two'], [3, 'Alan', 'hidden-three']]) store.create('Customers', { Id, Name, Secret });
  store.create('Orders', { CustomerId: 1, Item: 'Tea' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  page.setDefaultTimeout(15_000);
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, nameId).inputValue(), (v) => v === 'Ada');
  return page;
}

async function expectAnnouncement(page: Page, message: string): Promise<void> {
  await until(() => page.locator('.tabularius-announcer').textContent(), (text) => text === message, 15_000);
  const tree = await until(() => axTreeSnapshot(page), (nodes) => nodes.some((n) => n.role === 'status' && n.name === message && n.state.includes('live=polite')), 15_000);
  assert.equal(tree.filter((n) => n.role === 'status' && n.name === message && n.state.includes('live=polite')).length, 1, message);
  const live = page.locator('.tabularius-announcer');
  assert.equal(await live.count(), 1);
  assert.equal(await live.getAttribute('aria-live'), 'polite');
}

async function command(page: Page, menu: string, item: string | RegExp): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).first().click();
}

test('navigation, found-set changes, sorting, save outcomes and modes are announced in the AX tree', { skip }, async () => {
  const page = await open();
  try {
    assert.equal((await axTreeSnapshot(page)).some((n) => n.role === 'textbox' && n.name === 'Secret'), false, 'the secret field is absent from the layout');
    await expectAnnouncement(page, 'Found 3 records.');
    await page.getByRole('button', { name: 'Next record' }).click();
    await expectAnnouncement(page, 'Record 2 of 3.');

    const modes = page.getByRole('group', { name: 'Mode' });
    await modes.getByRole('button', { name: 'Find', exact: true }).click();
    await expectAnnouncement(page, 'Find mode.');
    await modes.getByRole('button', { name: 'Browse', exact: true }).click();
    await expectAnnouncement(page, 'Browse mode.');
    await modes.getByRole('button', { name: 'Preview', exact: true }).click();
    await expectAnnouncement(page, 'Preview mode.');
    await modes.getByRole('button', { name: 'Browse', exact: true }).click();

    await modes.getByRole('button', { name: 'Find', exact: true }).click();
    await field(page, nameId).fill('Ada');
    await page.locator('button.tb', { hasText: 'Perform Find' }).first().click();
    await expectAnnouncement(page, 'Found 1 record.');
    await page.locator('button.tb', { hasText: 'Show All' }).first().click();
    await expectAnnouncement(page, 'Found 3 records.');
    await command(page, 'Records', 'Omit Record');
    await expectAnnouncement(page, 'Found 2 records.');

    await command(page, 'Records', /^Sort Records/);
    const sort = page.getByRole('dialog', { name: 'Sort records' });
    await sort.getByRole('listbox', { name: 'Fields' }).selectOption('Name');
    await sort.getByRole('button', { name: 'Add →' }).click();
    await sort.getByRole('button', { name: 'Sort', exact: true }).click();
    await expectAnnouncement(page, 'Sort applied.');

    await field(page, nameId).fill('private-field-value');
    await field(page, nameId).press('Tab');
    await expectAnnouncement(page, 'Changes saved.');
    let tree = await axTreeSnapshot(page);
    assert.equal(tree.some((n) => n.name.includes('private-field-value') || n.name.includes('hidden-one') || n.name.includes('hidden-two') || n.name.includes('hidden-three')), false, 'field values never appear in an announcement');

    await page.route('**/records/**', async (route) => {
      if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic save failure' }) });
      else await route.continue();
    });
    await field(page, nameId).fill('another-private-value');
    await field(page, nameId).press('Tab');
    await expectAnnouncement(page, 'Save failed.');
    tree = await axTreeSnapshot(page);
    assert.equal(tree.some((n) => n.name.includes('another-private-value')), false);
    assert.deepEqual(page.errors, []);

    await modes.getByRole('button', { name: 'Layout', exact: true }).click();
    await page.waitForURL('**/design.html#layoutmode=*');
    await expectAnnouncement(page, 'Layout mode.');
  } finally {
    await page.context().close();
  }
});

test('portal row creation and deletion are announced without portal values', { skip }, async () => {
  const page = await open();
  try {
    const item = page.getByRole('textbox', { name: 'Item, new row' });
    await item.fill('private-portal-value');
    await item.press('Tab');
    await expectAnnouncement(page, 'Portal row added.');
    assert.equal((await axTreeSnapshot(page)).some((n) => n.name.includes('private-portal-value')), false);

    await until(() => page.locator(`.fm[data-id="${PORTAL_ITEM}"] input`).count(), (n) => n >= 3);
    const addedRow = page.locator(`.fm[data-id="${PORTAL}"] .fm-portal-row`).nth(1);
    await field(addedRow, PORTAL_ITEM).click();
    await page.locator('button.tb', { hasText: 'Delete Record' }).first().click();
    await answer(page, 'Delete Related Record', 'Delete');
    await expectAnnouncement(page, 'Portal row deleted.');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('offline sync announces start and successful completion through the AX tree', { skip }, async () => {
  const page = await open();
  try {
    await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Offline Copy' }).hover();
    await page.getByRole('menuitemcheckbox', { name: 'Keep Offline Copy' }).click();
    await until(() => page.locator('.toast').allTextContents(), (texts) => texts.some((t) => t.includes('now keeps what you open')));
    await page.context().setOffline(true);
    await until(() => page.locator('.offline-banner').textContent(), (s) => /offline/.test(s ?? ''));
    await field(page, nameId).fill('Grace offline');
    await field(page, nameId).press('Tab');
    await until(() => page.locator('.offline-banner').textContent(), (text) => /1 change will be saved/.test(text ?? ''));
    await page.route('**/records/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.continue();
      } else await route.continue();
    });
    await page.context().setOffline(false);
    await expectAnnouncement(page, 'Syncing offline changes.');
    await expectAnnouncement(page, 'Offline changes saved.');
    await until(async () => hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData['Name'], (name) => name === 'Grace offline');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().setOffline(false);
    await page.context().close();
  }
});

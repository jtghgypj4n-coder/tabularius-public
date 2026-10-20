// The web client in a real browser, on a small database built here with no
// .fmp12 at all (so it runs without the downloaded samples and nothing about
// its shape is left to chance): customers with an Orders portal, and two
// accounts. It covers editing through a portal, adding a related record from
// the portal's empty last row, and record locking between two people.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Locator, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

// Layout object ids on the Customers layout: the generated form's fields, and the portal added below.
const NAME = 5;
const CITY = 7;
const PORTAL = 900;
const ITEM = 901;
const QTY = 902;
const PASSWORD = { Ann: 'ann-secret-1', Ben: 'ben-secret-1' };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }, { name: 'Qty', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
  ] as DesignOp[]);

  // The generated Customers form, with a four-row Orders portal under its fields.
  const design = store.design('Customers')!;
  const orders = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === name)!.id;
  const boxStyle = design.objects.find((o) => o.id === NAME)!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = (id: number, name: string, left: number, right: number): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style: boxStyle, bounds: { top: 182, left, bottom: 204, right },
    field: { tableOccurrenceId: orders.id, fieldId: fieldId(name), tableOccurrence: 'Orders', field: name, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const portal = {
    id: PORTAL, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 180, left: 160, bottom: 284, right: 520 },
    portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 4, initialRow: 1 },
    children: [cell(ITEM, 'Item', 162, 400), cell(QTY, 'Qty', 404, 516)],
  } as LayoutObject;
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 240 } : p.kind === 'footer' ? { ...p, top: 300 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts, objects: [...design.objects, portal] } }] as DesignOp[]);

  store.create('Customers', { Id: 1, Name: 'Ada', City: 'Leeds' });
  store.create('Customers', { Id: 2, Name: 'Grace', City: 'York' });
  store.create('Orders', { CustomerId: 1, Item: 'Tea', Qty: 2 });
  store.create('Orders', { CustomerId: 1, Item: 'Cake', Qty: 1 });
  store.create('Orders', { CustomerId: 2, Item: 'Jam', Qty: 5 });
  store.setPassword('Ann', PASSWORD.Ann, '[Full Access]');
  store.setPassword('Ben', PASSWORD.Ben, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The orders of customer `id`, as the file holds them, by item. */
function ordersOf(id: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of hosted.store('Shop').find('Orders', { limit: 100 }).records) {
    if (Number(r.fieldData['CustomerId']) === id) out[String(r.fieldData['Item'])] = Number(r.fieldData['Qty']);
  }
  return out;
}

/** The value of a Customers field, as the file holds it. */
function customer(id: number, name: string): string {
  const r = hosted.store('Shop').find('Customers', { query: [{ Id: `==${id}` }] }).records[0];
  return String(r.fieldData[name]);
}

/** A window signed in to Shop as `account`, on the first customer. */
async function open(account: 'Ann' | 'Ben'): Promise<Page & { errors: string[] }> {
  const context = await browser.newContext();
  const page = await window(context);
  await signIn(page, hosted.url, 'Shop', account, PASSWORD[account]);
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}

/**
 * Logs out and closes the window. Logging out releases the window's record locks; a window
 * just closed keeps them until they lapse (a minute), which would hold up the next test.
 */
async function close(page: Page): Promise<void> {
  // Straight to Log Out, even with a field still being typed in: the button must not lose the click to the commit.
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

/** The first portal row whose Item box holds `item` ('' for the empty row new orders are typed in). */
async function rowWhere(page: Page, item: string): Promise<Locator> {
  for (const row of await page.locator(`.fm[data-id="${PORTAL}"] .fm-portal-row`).all()) {
    if (await field(row, ITEM).inputValue().catch(() => undefined) === item) return row;
  }
  throw new Error(`no portal row with Item "${item}"`);
}

/** The portal's rows that show an order, as item → quantity. */
async function portalRows(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const row of await page.locator(`.fm[data-id="${PORTAL}"] .fm-portal-row`).all()) {
    const item = await field(row, ITEM).inputValue().catch(() => '');
    if (item) out[item] = await field(row, QTY).inputValue();
  }
  return out;
}

test('a portal lists the current record\'s related records, and follows the record', { skip }, async () => {
  const page = await open('Ann');
  await until(() => portalRows(page), (rows) => JSON.stringify(rows) === JSON.stringify({ Tea: '2', Cake: '1' }));
  await page.getByRole('button', { name: 'Next record' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
  await until(() => portalRows(page), (rows) => JSON.stringify(rows) === JSON.stringify({ Jam: '5' }));
  assert.deepEqual(page.errors, []);
  await close(page);
});

test('editing a portal row changes the related record', { skip }, async () => {
  const page = await open('Ann');
  await until(() => portalRows(page), (rows) => rows.Tea === '2');
  const qty = await rowWhere(page, 'Tea');
  await field(qty, QTY).fill('3');
  await field(qty, QTY).press('Tab');
  await until(async () => ordersOf(1).Tea, (q) => q === 3);
  assert.equal(ordersOf(1).Cake, 1);
  assert.deepEqual(page.errors, []);
  await close(page);
});

// FileMaker draws an empty last row in a portal whose relationship allows creating related
// records; typing in it adds one.
test('typing in the portal\'s empty last row adds a related record', { skip }, async () => {
  const page = await open('Ann');
  try {
    await until(() => portalRows(page), (rows) => Object.keys(rows).length === 2);
    const empty = field(await rowWhere(page, ''), ITEM);
    await empty.fill('Scones');
    await empty.press('Tab');
    await until(async () => ordersOf(1), (o) => 'Scones' in o);
    await until(() => portalRows(page), (r) => 'Scones' in r);
    assert.deepEqual(Object.keys(ordersOf(2)), ['Jam'], 'the new order belongs to the customer on screen only');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('record locking: while one person types in a record, another can\'t change it', { skip }, async () => {
  const ann = await open('Ann');
  const ben = await open('Ben');

  // Ann starts typing in Ada's Name and stays in the field: she holds the record.
  await field(ann, NAME).click();
  await field(ann, NAME).pressSequentially(' Lovelace');
  await until(() => ben.locator('.in-use').textContent(), (t) => /Being edited by Ann$/.test(t ?? ''));

  // Ben tries to change the City: he's told who has it, and his typing isn't kept.
  await field(ben, CITY).click();
  await field(ben, CITY).pressSequentially('X');
  await until(() => ben.locator('.toast').first().textContent(), (t) => /Ann/.test(t ?? '') && /Try again when they're done/.test(t ?? ''));
  await until(() => field(ben, CITY).inputValue(), (v) => v === 'Leeds');
  assert.equal(customer(1, 'City'), 'Leeds');

  // Ann leaves the record (clicks outside its fields): her change is saved and the record is free again.
  await ann.locator('.fm-part-header').click({ position: { x: 600, y: 5 } });
  await until(async () => customer(1, 'Name'), (v) => v === 'Ada Lovelace');
  await until(() => ben.locator('.in-use').count(), (n) => n === 0);
  await until(() => field(ben, NAME).inputValue(), (v) => v === 'Ada Lovelace');

  // Now Ben can edit it.
  await field(ben, CITY).fill('London');
  await field(ben, CITY).press('Tab');
  await until(async () => customer(1, 'City'), (v) => v === 'London');
  await until(() => field(ann, CITY).inputValue(), (v) => v === 'London');

  assert.deepEqual(ann.errors, []);
  assert.deepEqual(ben.errors, []);
  await close(ann);
  await close(ben);
});

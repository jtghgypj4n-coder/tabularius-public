// Portal Setup's options in a real browser, on a small database built here
// with no .fmp12: a portal's sort order and filter, its initial row, vertical
// scrolling, deleting a related record from a portal that allows it, and a
// pop-up menu of only the current record's related values.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Locator, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// Layout object ids on the Customers layout: the generated form's Name field, and the two portals added below.
const NAME = 5;
const SORTED = 900;
const SORTED_ITEM = 901;
const SORTED_QTY = 902;
const PAGED = 910;
const PAGED_ITEM = 911;
const FAVOURITE = 920;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Favourite' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }, { name: 'Qty', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] },
    { op: 'createValueList', name: 'Their items', field: { occurrence: 'Orders', field: 'Item', related: 'Customers' } },
  ] as DesignOp[]);

  const design = store.design('Customers')!;
  const orders = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === name)!.id;
  const ref = (name: string) => ({ tableOccurrenceId: orders.id, fieldId: fieldId(name), tableOccurrence: 'Orders', field: name });
  const style = design.objects.find((o) => o.id === NAME)!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = (id: number, name: string, top: number, left: number, right: number): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: { top, left, bottom: top + 22, right },
    field: { ...ref(name), display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const customers = store.schema.tableOccurrences.find((t) => t.name === 'Customers')!;
  const favourite = store.schema.tables.find((t) => t.name === 'Customers')!.fields.find((f) => f.name === 'Favourite')!.id;
  const list = store.schema.valueLists.find((v) => v.name === 'Their items')!.id;
  const objects: LayoutObject[] = [
    // The generated form's Id and Name (its Favourite is laid out again below, as a pop-up menu).
    ...design.objects.filter((o) => o.bounds.top < 140),
    // Three rows that scroll, by Item from Z to A, showing only orders with a quantity; rows can be deleted.
    { id: SORTED, kind: 'portal', type: 9, name: 'Sorted', anchors, style: {}, bounds: { top: 150, left: 160, bottom: 224, right: 520 },
      portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 3, initialRow: 1, scrolling: true, allowDelete: true,
        sort: [{ field: ref('Item'), descending: true }], filter: 'Orders::Qty > 0' },
      children: [cell(SORTED_ITEM, 'Item', 152, 162, 400), cell(SORTED_QTY, 'Qty', 152, 404, 516)] } as LayoutObject,
    // Two rows that don't scroll, from the second related record on, in creation order.
    { id: PAGED, kind: 'portal', type: 9, name: 'Paged', anchors, style: {}, bounds: { top: 250, left: 160, bottom: 300, right: 520 },
      portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 2, initialRow: 2 },
      children: [cell(PAGED_ITEM, 'Item', 252, 162, 400)] } as LayoutObject,
    // A pop-up menu of the items this customer ordered.
    { id: FAVOURITE, kind: 'field', type: 1, anchors, style, bounds: { top: 320, left: 160, bottom: 342, right: 400 },
      field: { tableOccurrenceId: customers.id, fieldId: favourite, tableOccurrence: 'Customers', field: 'Favourite', display: 'popup', repetitions: 1, valueListId: list, valueList: 'Their items' } } as LayoutObject,
  ];
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 320 } : p.kind === 'footer' ? { ...p, top: 380 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts, objects } }] as DesignOp[]);

  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.create('Customers', { Id: 2, Name: 'Grace' });
  store.create('Orders', { CustomerId: 2, Item: 'Plums', Qty: 1 });
  for (const [Item, Qty] of [['Tea', 2], ['Cake', 1], ['Jam', 0], ['Scones', 4], ['Bread', 3]] as const) store.create('Orders', { CustomerId: 1, Item, Qty });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Customer 1's orders as the file holds them, item → quantity. */
function orders(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of hosted.store('Shop').find('Orders', { limit: 100 }).records) {
    if (Number(r.fieldData['CustomerId']) === 1) out[String(r.fieldData['Item'])] = Number(r.fieldData['Qty']);
  }
  return out;
}

/** Puts an order back as it was, after a test changed it. */
function setOrder(item: string, data: Record<string, string | number>): void {
  const store = hosted.store('Shop');
  const r = store.find('Orders', { query: [{ Item: `==${item}` }] }).records[0];
  if (r) store.update('Orders', Number(r.recordId), data);
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const rowsOf = (page: Page, portal: number) => page.locator(`.fm[data-id="${portal}"] .fm-portal-row`);

/** The items a portal's rows show, top to bottom, leaving out the empty row new records are typed in. Read in one go, as the rows are redrawn. */
function items(page: Page, portal: number, item: number): Promise<string[]> {
  return rowsOf(page, portal).evaluateAll((rows, id) => rows
    .map((r) => (r.querySelector(`.fm[data-id="${id}"] input, .fm[data-id="${id}"] textarea`) as HTMLInputElement | null)?.value ?? '')
    .filter(Boolean), item);
}

/** The row of the sorted portal that shows `item`. */
async function rowWhere(page: Page, item: string): Promise<Locator> {
  const at = (await items(page, SORTED, SORTED_ITEM)).indexOf(item);
  if (at < 0) throw new Error(`no row with Item "${item}"`);
  return rowsOf(page, SORTED).nth(at);
}

const deleteRecord = (page: Page) => page.locator('button.tb', { hasText: 'Delete Record' }).first().click();

test('a portal shows its rows in its own sort order, and leaves out the ones its filter doesn\'t pass', { skip }, async () => {
  const page = await open();
  try {
    await until(() => items(page, SORTED, SORTED_ITEM), (v) => v.join() === 'Tea,Scones,Cake,Bread');
    // A row edited so it no longer passes the filter stays until the record is committed (the keypad's Enter), then goes.
    const bread = await rowWhere(page, 'Bread');
    await field(bread, SORTED_QTY).fill('0');
    await field(bread, SORTED_QTY).press('Tab');
    await until(async () => orders().Bread, (q) => q === 0);
    assert.deepEqual(await items(page, SORTED, SORTED_ITEM), ['Tea', 'Scones', 'Cake', 'Bread']);
    await field(page, NAME).press('NumpadEnter');
    await until(() => items(page, SORTED, SORTED_ITEM), (v) => v.join() === 'Tea,Scones,Cake');
    // A row renamed re-sorts on commit too.
    const tea = await rowWhere(page, 'Tea');
    await field(tea, SORTED_ITEM).fill('Apples');
    await field(tea, SORTED_ITEM).press('NumpadEnter');
    await until(() => items(page, SORTED, SORTED_ITEM), (v) => v.join() === 'Scones,Cake,Apples');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    setOrder('Bread', { Qty: 3 });
    setOrder('Apples', { Item: 'Tea' });
  }
});

test('a portal starts at its initial row, and only a portal set to scroll scrolls', { skip }, async () => {
  const page = await open();
  try {
    // Rows 2 and 3 of the related records, in creation order: the filter and sort are the other portal's.
    await until(() => items(page, PAGED, PAGED_ITEM), (v) => v.join() === 'Cake,Jam');
    const paged = page.locator(`.fm[data-id="${PAGED}"] .fm-portal-rows`);
    assert.equal(await paged.evaluate((e) => getComputedStyle(e).overflowY), 'hidden');
    // Four orders (and the empty row for a new one) in three rows' room: the rest is scrolled to.
    const sorted = page.locator(`.fm[data-id="${SORTED}"] .fm-portal-rows`);
    await until(() => items(page, SORTED, SORTED_ITEM), (v) => v.length === 4);
    const { scroll, client, overflow } = await sorted.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight, overflow: getComputedStyle(e).overflowY }));
    assert.ok(scroll > client, `the rows overflow the portal (${scroll} > ${client})`);
    assert.notEqual(overflow, 'hidden');
    await sorted.evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await until(() => sorted.evaluate((e) => e.scrollTop), (t) => t > 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Delete Record in a row of a portal that allows it deletes that one related record; elsewhere it asks about the whole record', { skip }, async () => {
  const page = await open();
  try {
    await until(() => items(page, SORTED, SORTED_ITEM), (v) => v.includes('Scones'));
    await field(await rowWhere(page, 'Scones'), SORTED_QTY).click();
    await deleteRecord(page);
    const asked = await answer(page, 'Delete Related Record', 'Delete');
    await until(async () => 'Scones' in orders(), (has) => !has);
    assert.match(asked, /ONE related record/);
    await until(() => items(page, SORTED, SORTED_ITEM), (v) => v.join() === 'Tea,Cake,Bread');
    assert.equal(hosted.store('Shop').find('Customers', { limit: 10 }).records.length, 2, 'the customer is still there');

    // The other portal doesn't allow deleting its rows: Delete Record there means the customer, and cancelling keeps it.
    await field(rowsOf(page, PAGED).first(), PAGED_ITEM).click();
    await deleteRecord(page);
    assert.match(await answer(page, 'Delete Record', 'Cancel'), /ENTIRE record/);
    assert.equal(hosted.store('Shop').find('Customers', { limit: 10 }).records.length, 2);
    assert.equal(Object.keys(orders()).length, 4);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a pop-up menu of related values lists only the items the record on screen has', { skip }, async () => {
  const page = await open();
  try {
    const menu = page.locator(`.fm[data-id="${FAVOURITE}"] select`);
    const choices = () => menu.locator('option').allTextContents().then((o) => o.filter(Boolean).sort());
    await until(choices, (o) => o.join() === 'Bread,Cake,Jam,Tea');
    await menu.selectOption('Cake');
    await until(async () => hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData['Favourite'], (v) => v === 'Cake');
    await page.getByRole('button', { name: 'Next record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    await until(choices, (o) => o.join() === 'Plums');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

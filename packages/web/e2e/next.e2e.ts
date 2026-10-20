// The alternative client (/next/) in a real browser, on a small database built here: sign in, the table as a
// collection, a search with a field filter, editing a value in the record panel (saved to the file), stepping
// to the next record, the command bar, and a new record; value lists as pickers and related rows that open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { pageSource } from '../src/page-source.ts';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Town', 'Shop', 'Gallery'] });
  const store = hosted.store('Town');
  store.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'id', type: 'number' }, { name: 'Name' }, { name: 'City' }, { name: 'Age', type: 'number' }] },
    { op: 'createTable', name: 'Places', fields: [{ name: 'Title' }] },
  ] as DesignOp[]);
  for (const [id, Name, City, Age] of [[1, 'Ada', 'Leeds', 36], [2, 'Alan', 'York', 41], [3, 'Grace', 'Leeds', 85], [4, 'Edsger', 'Paris', 72]] as const) {
    store.create('People', { id, Name, City, Age });
  }
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  shop();
  const gallery = hosted.store('Gallery');
  gallery.applyDesign([{ op: 'createTable', name: 'Parks', fields: [{ name: 'Name' }, { name: 'Photo', type: 'container' }, { name: 'Leaflet', type: 'container' }] }] as DesignOp[]);
  gallery.create('Parks', { Name: 'Roundhay' });
  // A modern layout: one web viewer showing a page that lists parks and adds one through window.tabularius.
  const html = '<h1>Parks</h1><ul id=list></ul><button id=add>Add Kew</button><script>' +
    "async function show() { const f = await tabularius.records('Parks', { limit: 10 }); document.getElementById('list').replaceChildren(...f.data.map((r) => Object.assign(document.createElement('li'), { textContent: r.fieldData.Name }))); }" +
    "show(); tabularius.on('refresh', show); document.getElementById('add').onclick = async () => { await tabularius.create('Parks', { Name: 'Kew' }); show(); };</script>";
  const parks = gallery.schema.tableOccurrences.find((t) => t.name === 'Parks')!.id;
  gallery.applyDesign([{ op: 'createLayout', name: 'Welcome', occurrence: parks, design: {
    width: 800, parts: [{ kind: 'body', kindId: 2, top: 0, height: 600, style: {} }],
    objects: [{ id: 1, kind: 'web-viewer', type: 13, external: 'WEBV', name: 'page', style: {}, bounds: { top: 0, left: 0, bottom: 600, right: 800 },
      anchors: { left: true, top: true, right: true, bottom: true }, webUrl: `"data:text/html;base64," & Base64EncodeRFC ( 4648 ; "${html}" )`,
      webOptions: { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge: true } }],
  } }] as DesignOp[]);
  gallery.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Customers with a City pop-up menu and a Tags checkbox set, and an Orders portal. */
function shop(): void {
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }, { name: 'Tags' }, { name: 'Favourite' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }, { name: 'Qty', type: 'number' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }], rightCreate: true },
    { op: 'createValueList', name: 'Cities', values: ['Leeds', 'York', 'Paris'] },
    { op: 'createValueList', name: 'Tags', values: ['VIP', '-', 'Wholesale'] },
    { op: 'createValueList', name: 'Their items', field: { occurrence: 'Orders', field: 'Item', related: 'Customers' } },
  ] as DesignOp[]);
  const design = store.design('Customers')!;
  const list = (name: string) => store.schema.valueLists.find((v) => v.name === name)!.id;
  const objects = design.objects.map((o) => o.field?.field === 'City' ? { ...o, field: { ...o.field, display: 'popup', valueListId: list('Cities') } }
    : o.field?.field === 'Tags' ? { ...o, field: { ...o.field, display: 'checkbox', valueListId: list('Tags') } }
    : o.field?.field === 'Favourite' ? { ...o, field: { ...o.field, display: 'popup', valueListId: list('Their items') } } : o);
  const orders = store.schema.tableOccurrences.find((t) => t.name === 'Orders')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Orders')!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const cell = (id: number, name: string, left: number, right: number): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 222, left, bottom: 244, right },
    field: { tableOccurrenceId: orders.id, fieldId: fieldId(name), tableOccurrence: 'Orders', field: name, display: 'edit', repetitions: 1 },
  } as LayoutObject);
  const portal = {
    id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 220, left: 160, bottom: 324, right: 520 },
    portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 4, initialRow: 1 },
    children: [cell(901, 'Item', 162, 400), cell(902, 'Qty', 404, 516)],
  } as LayoutObject;
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 280 } : p.kind === 'footer' ? { ...p, top: 340 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { parts, objects: [...objects, portal] } }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada', City: 'Leeds' });
  store.create('Orders', { CustomerId: 1, Item: 'Tea', Qty: 2 });
  store.create('Orders', { CustomerId: 1, Item: 'Cake', Qty: 1 });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
}

async function open(file = 'Town'): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await page.goto(hosted.url + '/next/');
  await page.locator('select[name="db"]').selectOption(file);
  await page.locator('input[name="account"]').fill('Ann');
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.rail-item').first().waitFor();
  if (file === 'Town') await page.locator('.rail-item', { hasText: 'People' }).click();
  await page.locator('.row:not(.head)').first().waitFor();
  return page;
}

const names = (page: Page) => page.locator('.row:not(.head) .lead-text').allTextContents();

test('the alternative client lists, searches, edits and adds records', { skip }, async () => {
  const page = await open();
  assert.deepEqual((await names(page)).sort(), ['Ada', 'Alan', 'Edsger', 'Grace']);
  assert.deepEqual(await page.locator('.rail-item').allTextContents(), ['People', 'Places']);
  // The table's key stays out of the list.
  assert.deepEqual(await page.locator('.row.head .cell').allTextContents(), ['Name', 'City', 'Age']);
  // The list is one stop for Tab: the row the keyboard is on, which Enter opens.
  assert.equal(await page.locator('.row:not(.head)[tabindex="0"]').count(), 1);
  await page.locator('.row:not(.head)').first().focus();
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('row')), true);

  // A filter typed as "field: value" becomes a chip; plain words search the text fields.
  await page.locator('input.search').fill('city: Leeds');
  await until(() => page.locator('.chip').allTextContents(), (c) => c.length === 1);
  await until(() => names(page), (n) => n.sort().join() === 'Ada,Grace');
  await page.locator('input.search').fill('gra');
  await until(() => names(page), (n) => n.join() === 'Grace');
  await page.locator('.chip-x').click();
  await until(() => names(page), (n) => n.join() === 'Grace');
  await page.locator('input.search').fill('');
  await until(() => names(page), (n) => n.length === 4);

  // Enter straight after typing finishes the search instead of opening a row from the list before it; the next
  // Enter opens the first row of the narrowed list.
  await page.locator('input.search').fill('city: Paris');
  await page.locator('input.search').press('Enter');
  await until(() => names(page), (n) => n.join() === 'Edsger');
  assert.equal(await page.locator('.sheet .record-title').count(), 0);
  await page.locator('input.search').press('Enter');
  await until(() => page.locator('.sheet .record-title').textContent(), (t) => t === 'Edsger');
  await page.keyboard.press('Escape');
  await page.locator('.chip-x').click();
  await until(() => names(page), (n) => n.length === 4);

  // Sorting by a column header.
  await page.locator('.row.head .cell', { hasText: 'Age' }).click();
  await until(() => names(page), (n) => n.join() === 'Ada,Alan,Edsger,Grace');

  // A record opens beside the list; a click on a value edits it, Enter saves it to the file.
  await page.locator('.row:not(.head)', { hasText: 'Alan' }).click();
  await page.locator('.sheet .record-title', { hasText: 'Alan' }).waitFor();
  assert.equal(await page.locator('.stepper-at').textContent(), '2 of 4');
  await page.locator('.sheet dd .value', { hasText: 'York' }).click();
  await page.locator('.sheet input.editor').fill('Manchester');
  await page.keyboard.press('Enter');
  await page.locator('.saved.ok').waitFor();
  const alan = hosted.store('Town').find('People', { limit: 10 }).records.find((r) => r.fieldData['Name'] === 'Alan');
  assert.equal(alan?.fieldData['City'], 'Manchester');
  await until(() => page.locator('.row:not(.head)', { hasText: 'Alan' }).textContent(), (t) => !!t?.includes('Manchester'));

  // J steps to the next record; Escape closes it.
  await page.locator('body').click({ position: { x: 600, y: 600 } });
  await page.keyboard.press('j');
  await page.locator('.sheet .record-title', { hasText: 'Edsger' }).waitFor();
  await page.keyboard.press('Escape');
  await until(() => page.locator('.sheet').isHidden(), (h) => h);

  // The command bar goes to another collection.
  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('plac');
  await page.keyboard.press('Enter');
  await page.locator('.stage-title h1', { hasText: 'Places' }).waitFor();

  // A new record opens with its title ready to type.
  await page.locator('button.new').click();
  await page.locator('.sheet input.editor').waitFor();
  await page.keyboard.type('Leeds Library');
  await page.keyboard.press('Enter');
  await page.locator('.saved.ok').waitFor();
  assert.deepEqual(hosted.store('Town').find('Places', { limit: 10 }).records.map((r) => r.fieldData['Title']), ['Leeds Library']);

  assert.deepEqual(page.errors, []);
});

test('value lists become pickers, and related rows open their record', { skip }, async () => {
  const page = await open('Shop');
  const customer = () => hosted.store('Shop').find('Customers', { limit: 1 }).records[0].fieldData;
  await page.locator('.row:not(.head)', { hasText: 'Ada' }).click();
  await page.locator('.sheet .record-title', { hasText: 'Ada' }).waitFor();

  // A pop-up menu: picking a city saves it.
  await page.locator('.sheet dd .value', { hasText: 'Leeds' }).click();
  assert.deepEqual(await page.locator('.sheet select.editor option').allTextContents(), ['—', 'Leeds', 'York', 'Paris']);
  await page.locator('.sheet select.editor').selectOption('York');
  await until(async () => customer()['City'], (v) => v === 'York');
  await page.locator('.sheet dd .value', { hasText: 'York' }).waitFor();

  // A checkbox set: toggles, saved together when done; the "-" divider isn't a choice.
  await page.locator('.sheet dt', { hasText: 'Tags' }).locator('xpath=following-sibling::dd[1]').locator('.value').click();
  assert.deepEqual(await page.locator('.sheet .choice').allTextContents(), ['VIP', 'Wholesale']);
  await page.locator('.sheet .choice', { hasText: 'VIP' }).click();
  await page.locator('.sheet .choice', { hasText: 'Wholesale' }).click();
  await page.locator('.sheet .choices-done').click();
  await until(async () => String(customer()['Tags']).split(/\r\n?|\n/).join(','), (v) => v === 'VIP,Wholesale');
  await page.locator('.sheet dd .value', { hasText: 'VIP, Wholesale' }).waitFor();

  // The Orders portal lists the related records; a row opens its order.
  assert.deepEqual((await page.locator('.sheet .related .mini-row .cell:first-child').allTextContents()).sort(), ['Cake', 'Tea']);

  // A value list of this customer's own order items: the menu offers only theirs.
  await page.locator('.sheet dt', { hasText: 'Favourite' }).locator('xpath=following-sibling::dd[1]').locator('.value').click();
  await page.locator('.sheet select.editor').waitFor();
  assert.deepEqual((await page.locator('.sheet select.editor option').allTextContents()).sort(), ['Cake', 'Tea', '—']);
  await page.locator('.sheet select.editor').selectOption('Tea');
  await until(async () => customer()['Favourite'], (v) => v === 'Tea');

  // Add makes a new order for this customer, typed in place; Escape drops an unsaved one.
  await page.getByRole('button', { name: 'Add to orders' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sheet .mini-new').count(), 0);
  await page.getByRole('button', { name: 'Add to orders' }).click();
  await page.keyboard.type('Jam');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await until(() => page.locator('.sheet .related .mini-row .cell:first-child').allTextContents(), (n) => n.sort().join() === 'Cake,Jam,Tea');
  const jam = hosted.store('Shop').find('Orders', { limit: 10 }).records.map((x) => x.fieldData).find((f) => f['Item'] === 'Jam');
  assert.equal(Number(jam?.['CustomerId']), 1);
  assert.equal(Number(jam?.['Qty']), 3);

  await page.locator('.sheet .related .mini-row', { hasText: 'Tea' }).click();
  await page.locator('.stage-title h1', { hasText: 'Orders' }).waitFor();
  await page.locator('.sheet .record-title', { hasText: 'Tea' }).waitFor();

  assert.deepEqual(page.errors, []);
});

test('the command bar asks the assistant, and the records an answer found show in the list', { skip }, async () => {
  const context = await browser.newContext();
  // A stand-in assistant: no model is called, nothing leaves the machine.
  const asked: unknown[] = [];
  await context.route('**/tabularius/assistant/v1/databases/**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, model: 'test', canDesign: false } });
    asked.push(route.request().postDataJSON());
    return route.fulfill({ json: {
      reply: 'Two people live in **Leeds**: Ada and Grace.',
      foundSets: [{ layout: 'People', query: [{ City: '==Leeds' }], foundCount: 2, summary: 'People in Leeds' }],
      proposals: [], drafts: [], charts: [], dashboards: [], cleanups: [], automations: [], tools: [],
    } });
  });
  const page = await window(context);
  await page.goto(hosted.url + '/next/');
  await page.locator('select[name="db"]').selectOption('Town');
  await page.locator('input[name="account"]').fill('Ann');
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.rail-item', { hasText: 'People' }).click();
  await page.locator('.row:not(.head)').first().waitFor();

  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('who lives in leeds?');
  // A question puts asking first, so Enter asks.
  assert.equal(await page.locator('.palette-item').first().textContent(), 'Ask: who lives in leeds?⇥');
  await page.keyboard.press('Enter');
  await page.locator('.sheet .ask-a strong', { hasText: 'Leeds' }).waitFor();
  assert.equal((asked[0] as { messages: { content: string }[] }).messages[0].content, 'who lives in leeds?');
  assert.equal((asked[0] as { context: { layout: string } }).context.layout, 'People');

  await page.locator('.ask-found').click();
  await until(() => names(page), (n) => n.sort().join() === 'Ada,Grace');
  assert.equal(await page.locator('.chip-ai .chip-value').textContent(), 'People in Leeds');
  await page.locator('.chip-ai .chip-x').click();
  await until(() => names(page), (n) => n.length === 4);

  // A follow-up goes with the conversation so far.
  await page.locator('.ask-input').fill('and in York?');
  await page.keyboard.press('Enter');
  await until(async () => asked.length, (n) => n === 2);
  assert.equal((asked[1] as { messages: unknown[] }).messages.length, 3);
  await page.keyboard.press('Escape');
  await until(() => page.locator('.sheet').isHidden(), (h) => h);
  assert.deepEqual(page.errors, []);
});

test('pictures and files go into container fields by picking or dropping them', { skip }, async () => {
  const page = await open('Gallery');
  await page.locator('.row:not(.head)').first().click();
  await page.locator('.sheet .record-title').waitFor();
  const stored = (field: string) => String(hosted.store('Gallery').find('Parks', { limit: 1 }).records[0].fieldData[field] ?? '');

  // The first container is the record's picture: an empty square that picks one.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByRole('button', { name: 'Add photo' }).waitFor();
  await page.locator('.pic-slot input[type=file]').setInputFiles({ name: 'roundhay.png', mimeType: 'image/png', buffer: png });
  await page.locator('.sheet img.record-pic').waitFor();
  await page.locator('.saved.ok').waitFor();
  assert.ok(stored('Photo'), 'the picture is in the file');
  assert.ok(await page.getByRole('button', { name: 'Change photo' }).isVisible());

  // Another container shows as a file: dropped on the field, then opened by name, then removed.
  const leaflet = page.locator('.file-value').first();
  assert.equal(await leaflet.locator('.file-add').textContent(), 'Add a file');
  await leaflet.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(['Open 7am to dusk'], 'leaflet.txt', { type: 'text/plain' }));
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await until(() => page.locator('.file-value .file-name').allTextContents(), (n) => n.join() === 'leaflet.txt');
  assert.ok(stored('Leaflet'), 'the dropped file is in the file');
  const href = await page.locator('.file-value .file-link').getAttribute('href');
  assert.equal(await page.evaluate(async (u) => (await fetch(u!)).text(), href), 'Open 7am to dusk');
  await page.locator('.file-value').first().hover();
  await page.locator('.file-value').getByRole('button', { name: 'Remove' }).click();
  await page.locator('.file-value .file-add').waitFor();
  assert.equal(stored('Leaflet'), '');

  assert.deepEqual(page.errors, []);
});

test('a narrowed list is kept by name under its collection, and opens again as it was', { skip }, async () => {
  const page = await open();
  assert.equal(await page.locator('.save-view').count(), 0);
  await page.locator('input.search').fill('city: Leeds');
  await until(() => names(page), (n) => n.sort().join() === 'Ada,Grace');

  // Save view names it in place, in the sidebar under People.
  await page.locator('.save-view').click();
  await page.locator('.rail-name').fill('Leeds folk');
  await page.keyboard.press('Enter');
  await until(() => page.locator('.rail-view').allTextContents(), (n) => n.join() === 'Leeds folk');
  assert.equal(await page.locator('.rail-view').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.save-view').count(), 0);
  // Esc after naming it still reaches the list (the sidebar is not left open as a drawer).
  assert.equal(await page.locator('.shell.rail-open, .rail-open').count(), 0);

  // The collection shows everything again; the view brings the chip back.
  await page.locator('.rail-item:not(.rail-view)', { hasText: 'People' }).click();
  await until(() => names(page), (n) => n.length === 4);
  await page.locator('.rail-view', { hasText: 'Leeds folk' }).click();
  await until(() => names(page), (n) => n.sort().join() === 'Ada,Grace');
  assert.deepEqual(await page.locator('.chip .chip-value').allTextContents(), ['Leeds']);

  // A change to it can be kept, and the view stays after a reload.
  await page.locator('.row.head .cell', { hasText: 'Age' }).click();
  await page.locator('.save-view', { hasText: 'Update “Leeds folk”' }).click();
  await until(() => page.locator('.save-view').count(), (n) => n === 0);
  await page.reload();
  await page.locator('.rail-view', { hasText: 'Leeds folk' }).click();
  await until(() => names(page), (n) => n.join() === 'Ada,Grace');

  // Deleted from the command bar.
  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('delete view');
  await page.keyboard.press('Enter');
  await until(() => page.locator('.rail-view').count(), (n) => n === 0);

  assert.deepEqual(page.errors, []);
});

test('rows picked together are changed or deleted at once', { skip }, async () => {
  const page = await open();
  const people = () => hosted.store('Town').find('People', { limit: 50 }).records.map((r) => r.fieldData);
  await page.locator('.row.head .cell', { hasText: 'Name' }).click();
  await until(() => names(page), (n) => n.join() === 'Ada,Alan,Edsger,Grace');

  // A click on a row's box picks it; Shift picks every row up to it.
  const box = (name: string) => page.locator('.row:not(.head)', { hasText: name }).locator('.pick');
  await page.locator('.row:not(.head)', { hasText: 'Ada' }).hover();
  await box('Ada').click();
  await box('Edsger').click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.tray .tray-count').textContent(), '3 selected');
  assert.equal(await page.locator('.sheet').isHidden(), true, 'picking does not open the record');

  // Set a field puts one value in every picked record.
  await page.locator('.tray').getByRole('button', { name: 'Set a field…' }).click();
  await page.locator('.tray-field').selectOption('City');
  await page.locator('.tray-value .editor').fill('Bath');
  await page.locator('.tray').getByRole('button', { name: 'Set', exact: true }).click();
  await until(async () => people().filter((p) => p['City'] === 'Bath').map((p) => p['Name']).sort().join(), (n) => n === 'Ada,Alan,Edsger');
  await until(() => page.locator('.tray').count(), (n) => n === 0);

  // X picks the row the keyboard is on (J and K move it); Delete asks first.
  for (let i = 0; i < 4; i++) await page.keyboard.press('j');
  await page.keyboard.press('x');
  assert.equal(await page.locator('.tray .tray-count').textContent(), '1 selected');
  await page.locator('.tray').getByRole('button', { name: 'Delete…' }).click();
  await page.locator('.tray').getByRole('button', { name: 'Keep them' }).click();
  assert.equal(people().length, 4);
  await page.keyboard.press('Escape');
  await until(() => page.locator('.tray').count(), (n) => n === 0);
  await page.keyboard.press('x');
  await page.locator('.tray').getByRole('button', { name: 'Delete…' }).click();
  await page.locator('.tray').getByRole('button', { name: 'Delete', exact: true }).click();
  await until(() => names(page), (n) => n.join() === 'Ada,Alan,Edsger');
  assert.deepEqual(people().map((p) => p['Name']).sort(), ['Ada', 'Alan', 'Edsger']);

  assert.deepEqual(page.errors, []);
});

test('a board groups records by a value-list field, and a card dragged to another column takes its value', { skip }, async () => {
  const page = await open('Shop');
  await page.locator('.shape-item', { hasText: 'Board' }).click();
  await page.locator('.board').waitFor();
  assert.deepEqual(await page.locator('.lane-head > span:first-child').allTextContents(), ['Leeds', 'York', 'Paris']);
  const lane = (name: string) => page.locator('.lane', { has: page.locator('.lane-head', { hasText: name }) });
  const city = () => String(hosted.store('Shop').find('Customers', { limit: 1 }).records[0].fieldData['City']);
  const from = await lane(city()).locator('.card').count();
  assert.equal(from, 1);
  await lane(city()).locator('.card').dragTo(lane('Paris'));
  await until(async () => city(), (v) => v === 'Paris');
  assert.equal(await lane('Paris').locator('.card').count(), 1);
  // From the keyboard, Shift and an arrow move it a column over.
  await lane('Paris').locator('.card').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await until(async () => city(), (v) => v === 'York');
  await until(() => page.evaluate(() => document.activeElement?.closest('.lane')?.querySelector('.lane-head span')?.textContent), (t) => t === 'York');
  await page.keyboard.press('Shift+ArrowRight');
  await until(async () => city(), (v) => v === 'Paris');

  // A card opens its record; List goes back.
  await lane('Paris').locator('.card').click();
  await page.locator('.sheet .record-title', { hasText: 'Ada' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.shape-item', { hasText: 'List' }).click();
  await page.locator('.row:not(.head)').first().waitFor();

  assert.deepEqual(page.errors, []);
});

test('a modern layout shows as a page, its data calls answered as the signed-in account', { skip }, async () => {
  const page = await open('Gallery');
  // Pages are listed apart from the collections; the page's own layout isn't a collection.
  await page.locator('.rail-pages .rail-item', { hasText: 'Welcome' }).click();
  await until(() => page.evaluate(() => location.hash), (h) => h === '#/~/Welcome');
  await until(() => page.locator('.stage-title h1').textContent(), (t) => t === 'Welcome');
  const frame = page.frameLocator('.page-frame iframe');
  await until(() => frame.locator('li').allTextContents(), (l) => l.join() === 'Roundhay');
  await frame.locator('#add').click();
  await until(() => frame.locator('li').allTextContents(), (l) => l.join() === 'Roundhay,Kew');
  assert.deepEqual(hosted.store('Gallery').find('Parks', {}).records.map((r) => r.fieldData['Name']), ['Roundhay', 'Kew']);
  // Back to the collection, which lists the park the page added.
  await page.locator('.rail-item[data-table="Parks"]').click();
  await until(() => page.locator('.row:not(.head)').count(), (n) => n === 2);
  // And to the page again from the command bar.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Welcome');
  await page.keyboard.press('Enter');
  await frame.locator('li').first().waitFor();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  assert.deepEqual(page.errors, []);
});

test('a page is edited beside a preview and saved to the layout; a new page starts from a starter', { skip }, async () => {
  const page = await open('Gallery');
  await page.locator('.rail-pages .rail-item', { hasText: 'Welcome' }).click();
  await page.frameLocator('.page-frame iframe').locator('#add').waitFor();
  await page.getByRole('button', { name: 'Edit page' }).click();
  const code = page.getByRole('textbox', { name: 'Page HTML, CSS and JavaScript' });
  await until(() => code.inputValue(), (v) => v.includes('<h1>Parks</h1>'));
  await code.fill('<h1 id=t>Hello #1</h1>');
  await until(() => page.frameLocator('.page-preview iframe').locator('#t').textContent(), (t) => t === 'Hello #1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.page-editor').waitFor({ state: 'detached' });
  await until(async () => pageSource(hosted.store('Gallery').design('Welcome')!.objects[0].webUrl), (h) => h === '<h1 id=t>Hello #1</h1>');
  await until(() => page.frameLocator('.page-frame iframe').locator('#t').textContent(), (t) => t === 'Hello #1');

  // New page, from the command bar.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('New page');
  await page.keyboard.press('Enter');
  await page.locator('.rail-pages .rail-item', { hasText: 'Parks page' }).waitFor();
  await until(() => page.evaluate(() => location.hash), (h) => h === '#/~/Parks%20page');
  await until(() => page.frameLocator('.page-frame iframe').locator('li').first().textContent(), (t) => !!t);
  // The preview has no data calls, so the first page (which calls tabularius without checking) says so there, and only there.
  assert.deepEqual([...new Set(page.errors)], ['tabularius is not defined']);
});

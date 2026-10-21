// The separation model in a real browser, on two small databases built here with no .fmp12: an interface file with no
// tables of its own and a data file. The interface file's layout is one design mode generated for a table occurrence
// from the data file; browsing it shows the data file's records, an edit and a new record land in the data file, and a
// pop-up menu offers the data file's own value list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// Object ids on the generated form: a title, then a label and a field for each of Name and City.
const NAME = 3;
const CITY = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Data', 'UI'] });
  const data = hosted.store('Data');
  data.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'City' }] },
    { op: 'createValueList', name: 'Cities', values: ['Oslo', 'Rome', 'Bergen'] },
  ] as DesignOp[]);
  data.create('Contacts', { Name: 'Ann', City: 'Oslo' });
  data.create('Contacts', { Name: 'Bo', City: 'Rome' });
  data.setPassword('Ann', PASSWORD, '[Full Access]');

  const ui = hosted.store('UI');
  const contacts = data.schema.tables.find((t) => t.name === 'Contacts')!;
  const cities = data.schema.valueLists.find((v) => v.name === 'Cities')!;
  ui.applyDesign([
    { op: 'createDataSource', name: 'Data', paths: ['file:Data'] },
    { op: 'createOccurrence', name: 'Contacts', file: 'Data', externalTable: contacts.id },
    { op: 'createValueList', name: 'Cities', external: { file: 'Data', valueList: cities.id } },
    { op: 'createLayout', name: 'Contacts', occurrence: 'Contacts' },
  ] as DesignOp[], { readOtherFile: () => true }); // built here by the file's owner, who designs both files
  // The City field becomes a pop-up menu of the data file's list.
  const listId = ui.schema.valueLists.find((v) => v.name === 'Cities')!.id;
  const design = ui.design('Contacts')!;
  const objects = design.objects.map((o) => o.id === CITY
    ? { ...o, field: { ...o.field!, display: 'popup', valueListId: listId, valueList: 'Cities' } } as LayoutObject
    : o);
  ui.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects } }] as DesignOp[]);
  ui.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const people = () => hosted.store('Data').find('Contacts', { limit: 100 }).records.map((r) => `${r.fieldData['Name']}/${r.fieldData['City']}`).sort();
const tool = (page: Page, label: string) => page.locator('button.tb', { hasText: label }).first();

test('the interface file shows the data file\'s records, and edits and new records go to the data file', { skip }, async () => {
  assert.equal(hosted.store('UI').schema.tables.length, 0, 'the interface file holds no table of its own');
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'UI', 'Ann', PASSWORD);
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Ann');

    // The pop-up menu lists the data file's value list, and the value picked is saved in the data file.
    const menu = page.locator(`.fm[data-id="${CITY}"] select`);
    assert.deepEqual(await menu.locator('option').allTextContents(), ['', 'Oslo', 'Rome', 'Bergen']);
    assert.equal(await menu.inputValue(), 'Oslo');
    await menu.selectOption('Bergen');
    await until(async () => people(), (p) => p.join() === 'Ann/Bergen,Bo/Rome');

    // A new record made in the interface file is a record of the data file.
    await tool(page, 'New Record').click();
    await field(page, NAME).fill('Cy');
    await field(page, NAME).press('Tab');
    await until(async () => people(), (p) => p.includes('Cy/'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

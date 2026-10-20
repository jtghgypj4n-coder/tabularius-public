// Field controls in a real browser, on a small database built here with no
// .fmp12: a pop-up menu, radio buttons with "Other…", a checkbox set and a
// drop-down list, each on its own value list, then Duplicate Record and
// Replace Field Contents. Each test checks what reaches the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// Layout object ids of the fields, as laid out below.
const ID = 1;
const STATUS = 2;
const SIZE = 3;
const TAGS = 4;
const COLOR = 5;
const NOTE = 6;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  store.applyDesign([
    { op: 'createTable', name: 'Jobs', fields: [{ name: 'Id', type: 'number' }, { name: 'Status' }, { name: 'Size' }, { name: 'Tags' }, { name: 'Color' }, { name: 'Note' }] },
    { op: 'createValueList', name: 'Statuses', values: ['Open', 'Waiting', 'Closed'] },
    { op: 'createValueList', name: 'Sizes', values: ['S', 'M', 'L'] },
    { op: 'createValueList', name: 'Tags', values: ['red', 'green', 'blue'] },
    { op: 'createValueList', name: 'Colors', values: ['Amber', 'Azure', 'Coral'] },
  ] as DesignOp[]);

  // The generated form's fields, one under another, each with the control and value list it is tried with.
  const design = store.design('Jobs')!;
  const occ = store.schema.tableOccurrences.find((t) => t.name === 'Jobs')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Jobs')!.fields.find((f) => f.name === name)!.id;
  const listId = (name: string) => store.schema.valueLists.find((v) => v.name === name)!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let top = 10;
  const box = (id: number, name: string, height: number, display = 'edit', list?: string, behavior?: object): LayoutObject => {
    const o = {
      id, kind: 'field', type: 1, anchors, style, bounds: { top, left: 20, bottom: top + height, right: 320 },
      field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Jobs', field: name, display, repetitions: 1,
        ...(list ? { valueListId: listId(list), valueList: list } : {}), ...(behavior ? { behavior } : {}) },
    } as LayoutObject;
    top += height + 12;
    return o;
  };
  const objects = [
    box(ID, 'Id', 22), box(STATUS, 'Status', 22, 'popup', 'Statuses'), box(SIZE, 'Size', 70, 'radio', 'Sizes', { otherValue: true }),
    box(TAGS, 'Tags', 70, 'checkbox', 'Tags'), box(COLOR, 'Color', 22, 'dropdown', 'Colors'), box(NOTE, 'Note', 22),
  ];
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: top + 20 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Jobs', design: { parts, objects } }] as DesignOp[]);

  store.create('Jobs', { Id: 1, Status: 'Open', Size: 'M', Tags: 'red', Color: 'Amber', Note: 'first' });
  store.create('Jobs', { Id: 2, Status: 'Closed', Size: 'S', Tags: '', Color: 'Coral', Note: 'second' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Record `id`'s fields as the file holds them. */
function job(id: number): Record<string, unknown> {
  return hosted.store('Desk').find('Jobs', { query: [{ Id: `==${id}` }] }).records[0]?.fieldData ?? {};
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ID}"]`).count(), (n) => n === 1);
  await goTo(page, 1);
  await until(() => field(page, ID).inputValue(), (v) => v === '1');
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

async function goTo(page: Page, n: number): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Record number' });
  await until(async () => {
    if (await box.inputValue() !== String(n)) {
      await box.fill(String(n));
      await box.press('Enter');
    }
    return box.inputValue();
  }, (v) => v === String(n));
}

const control = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`);

test('a pop-up menu lists its value list and saves the value picked', { skip }, async () => {
  const page = await open();
  try {
    const menu = control(page, STATUS).locator('select');
    assert.deepEqual(await menu.locator('option').allTextContents(), ['', 'Open', 'Waiting', 'Closed']);
    assert.equal(await menu.inputValue(), 'Open');
    await menu.selectOption('Waiting');
    await until(async () => job(1).Status, (v) => v === 'Waiting');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('radio buttons keep one value, and "Other…" takes one typed', { skip }, async () => {
  const page = await open();
  try {
    const radios = control(page, SIZE);
    assert.equal(await radios.getByRole('radio', { name: 'M' }).isChecked(), true);
    await radios.getByRole('radio', { name: 'L' }).check();
    await until(async () => job(1).Size, (v) => v === 'L');
    assert.equal(await radios.getByRole('radio', { name: 'M' }).isChecked(), false);

    await radios.getByRole('radio', { name: 'Other…' }).click();
    const other = page.getByRole('dialog', { name: 'Other' });
    await other.waitFor();
    await other.getByRole('textbox').fill('XL');
    await other.getByRole('button', { name: 'OK' }).click();
    await until(async () => job(1).Size, (v) => v === 'XL');
    await until(() => radios.getByRole('radio', { name: 'L' }).isChecked(), (c) => !c);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a checkbox set keeps each value ticked, one per line', { skip }, async () => {
  const page = await open();
  try {
    const boxes = control(page, TAGS);
    assert.equal(await boxes.getByRole('checkbox', { name: 'red' }).isChecked(), true);
    await boxes.getByRole('checkbox', { name: 'blue' }).check();
    await until(async () => job(1).Tags, (v) => v === 'red\rblue');
    await boxes.getByRole('checkbox', { name: 'red' }).uncheck();
    await until(async () => job(1).Tags, (v) => v === 'blue');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a drop-down list offers its values and saves what is typed', { skip }, async () => {
  const page = await open();
  try {
    const input = field(page, COLOR);
    const list = await input.getAttribute('list');
    assert.deepEqual(await page.locator(`datalist[id="${list}"] option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)), ['Amber', 'Azure', 'Coral']);
    await input.fill('Azure');
    await input.press('Tab');
    await until(async () => job(1).Color, (v) => v === 'Azure');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Duplicate Record (⌘D) copies the record, and Replace Field Contents (⌘=) changes the field in the found set', { skip }, async () => {
  const page = await open();
  try {
    await field(page, NOTE).click();
    await page.keyboard.press('ControlOrMeta+d');
    await until(() => found(page).locator('b').textContent(), (t) => t === '3');
    const copies = hosted.store('Desk').find('Jobs', { query: [{ Id: '==1' }] }).records;
    assert.equal(copies.length, 2, 'the copy has the same Id');
    assert.equal(copies[1].fieldData.Note, copies[0].fieldData.Note);

    await field(page, NOTE).click();
    await page.keyboard.press('ControlOrMeta+=');
    const dialog = page.getByRole('dialog', { name: 'Replace Field Contents' });
    await dialog.waitFor();
    await dialog.getByRole('textbox', { name: 'Replace with' }).fill('done');
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await until(async () => hosted.store('Desk').find('Jobs', { limit: 10 }).records.map((r) => r.fieldData.Note), (n) => n.length === 3 && n.every((x) => x === 'done'));
    await until(() => field(page, NOTE).inputValue(), (v) => v === 'done');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

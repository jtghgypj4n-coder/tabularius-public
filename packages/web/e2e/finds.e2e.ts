// Quick Find, Modify Last Find, Saved Finds and Undo of a deleted record, in a
// real browser, on a small database built here with no .fmp12.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
let NAME = 0;
let CITY = 0;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Town'] });
  const store = hosted.store('Town');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }] }] as DesignOp[]);
  const design = store.design('People')!;
  const idOf = (name: string) => design.objects.find((o) => o.kind === 'field' && o.field?.field === name)!.id;
  NAME = idOf('Name');
  CITY = idOf('City');
  // City is a tall box, which the web client draws as a multi-line text area.
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: { objects: design.objects.map((o) => (o.id === CITY ? { ...o, bounds: { ...o.bounds, bottom: o.bounds.top + 60 } } : o)) } }] as DesignOp[]);
  for (const [Id, Name, City] of [[1, 'Ada', 'Leeds'], [2, 'Alan', 'York'], [3, 'Grace', 'Leeds'], [4, 'York Smith', 'Paris']] as const) store.create('People', { Id, Name, City });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const names = () => hosted.store('Town').find('People', { limit: 100 }).records.map((r) => String(r.fieldData.Name)).sort();
const tool = (page: Page, label: string) => page.locator('button.tb', { hasText: label }).first();
const count = (page: Page) => found(page).locator('b').textContent();

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Town', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${NAME}"]`).count(), (n) => n === 1);
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

test('Quick Find searches every field on the layout; empty shows all records', { skip }, async () => {
  const page = await open();
  try {
    const quick = page.getByRole('searchbox', { name: 'Quick find' });
    await quick.fill('york');
    await quick.press('Enter');
    // Alan lives in York; York Smith has it in his name.
    await until(() => count(page), (t) => t === '2');
    await quick.fill('');
    await quick.press('Enter');
    await until(() => count(page), (t) => t === '4');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Return in a field in Find mode performs the find, in a one-line field and in a tall one', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    assert.equal(await field(page, CITY).evaluate((e) => e.tagName), 'TEXTAREA', 'City is a multi-line box');
    await field(page, NAME).fill('Grace');
    await field(page, NAME).press('Enter');
    await until(() => count(page), (t) => t === '1');
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, CITY).fill('Leeds');
    await field(page, CITY).press('Enter');
    await until(() => count(page), (t) => t === '2');
    // The Return was not typed into the box as a new line.
    assert.deepEqual(names(), ['Ada', 'Alan', 'Grace', 'York Smith']);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Modify Last Find (⌘R) comes back with the last find\'s request, and a saved find runs again', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, CITY).fill('Leeds');
    await tool(page, 'Perform Find').click();
    await until(() => count(page), (t) => t === '2');

    await page.keyboard.press('ControlOrMeta+r');
    await tool(page, 'Perform Find').waitFor();
    assert.equal(await field(page, CITY).inputValue(), 'Leeds');
    await field(page, NAME).fill('Grace');
    await tool(page, 'Perform Find').click();
    await until(() => count(page), (t) => t === '1');

    // Records > Saved Finds > Save Current Find, then Show All, then the saved find from Find mode.
    await page.locator('.menubar').getByRole('button', { name: 'Records', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Saved Finds' }).hover();
    await page.getByRole('menuitem', { name: 'Save Current Find…' }).click();
    await answer(page, 'Save Current Find', 'Save', 'Grace in Leeds');
    await until(() => page.locator('.toast').allTextContents(), (t) => t.some((x) => x.includes('Saved the find "Grace in Leeds"')));
    await tool(page, 'Show All').click();
    await until(() => count(page), (t) => t === '4');
    await tool(page, 'Find').click();
    await page.getByRole('combobox', { name: 'Saved Finds' }).selectOption({ label: 'Grace in Leeds' });
    await until(() => count(page), (t) => t === '1');
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('⌘Z outside a field runs the toast\'s Undo, so a deleted record comes back from the keyboard', { skip }, async () => {
  const page = await open();
  try {
    await until(() => field(page, NAME).inputValue(), (v) => v !== '');
    const name = await field(page, NAME).inputValue();
    await tool(page, 'Delete Record').click();
    await answer(page, 'Delete Record', 'Delete');
    await until(async () => names(), (n) => !n.includes(name));
    await page.locator('.toast[data-undo]').waitFor();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => names(), (n) => n.includes(name));
    await until(() => count(page), (t) => t === '4');
    assert.equal(await page.locator('.toast[data-undo]').count(), 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a deleted record comes back with Undo on the toast', { skip }, async () => {
  const page = await open();
  try {
    await until(() => field(page, NAME).inputValue(), (v) => v !== '');
    const name = await field(page, NAME).inputValue();
    await tool(page, 'Delete Record').click();
    await answer(page, 'Delete Record', 'Delete');
    await until(async () => names(), (n) => !n.includes(name));
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await until(async () => names(), (n) => n.includes(name));
    await until(() => count(page), (t) => t === '4');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a find that matches nothing asks: Modify Find keeps the request, Cancel keeps the found set from before', { skip }, async () => {
  const page = await open();
  try {
    const before = await count(page);
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, NAME).fill('Nobody');
    await tool(page, 'Perform Find').click();
    const alert = page.getByRole('dialog', { name: 'No records match this set of find requests' });
    await alert.waitFor();
    await alert.getByRole('button', { name: 'Modify Find' }).click();
    await alert.waitFor({ state: 'detached' });
    await tool(page, 'Perform Find').waitFor();
    assert.equal(await field(page, NAME).inputValue(), 'Nobody', 'the request is still there to change');

    await tool(page, 'Perform Find').click();
    await alert.waitFor();
    await alert.getByRole('button', { name: 'Cancel' }).click();
    await alert.waitFor({ state: 'detached' });
    await until(() => tool(page, 'Perform Find').count(), (n) => n === 0);
    await until(() => count(page), (t) => t === before);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Constrain and Extend that match nothing ask too: Modify Find keeps the request, Cancel keeps the found set', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, CITY).fill('Leeds');
    await tool(page, 'Perform Find').click();
    await until(() => count(page), (t) => t === '2');
    const alert = page.getByRole('dialog', { name: 'No records match this set of find requests' });

    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, NAME).fill('Nobody');
    await tool(page, 'Constrain').click();
    await alert.waitFor();
    await alert.getByRole('button', { name: 'Modify Find' }).click();
    await alert.waitFor({ state: 'detached' });
    await tool(page, 'Perform Find').waitFor();
    assert.equal(await field(page, NAME).inputValue(), 'Nobody', 'the request is still there to change');

    await tool(page, 'Perform Find').click();
    await alert.waitFor();
    await alert.getByRole('button', { name: 'Cancel' }).click();
    await alert.waitFor({ state: 'detached' });
    await until(() => count(page), (t) => t === '2');

    // Extend with nothing found now: the same alert (an extension of a found set that has records can't come up empty).
    await page.locator('.menubar').getByRole('button', { name: 'Records', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Omit Multiple…' }).click();
    await answer(page, 'Omit Multiple', 'Omit', '2');
    await until(() => count(page), (t) => t === '0');
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, NAME).fill('Nobody');
    await tool(page, 'Extend').click();
    await alert.waitFor();
    await alert.getByRole('button', { name: 'Cancel' }).click();
    await alert.waitFor({ state: 'detached' });
    await until(() => count(page), (t) => t === '0');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('Requests > Omit (⌘T) switches the request showing to Omit, and Go to Request asks for a number', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    const omit = page.getByRole('group', { name: 'Matching Records' }).getByRole('button', { name: 'Omit' });
    assert.equal(await omit.getAttribute('aria-pressed'), 'false');
    await field(page, CITY).fill('Leeds');
    await page.keyboard.press('ControlOrMeta+t');
    await until(() => omit.getAttribute('aria-pressed'), (v) => v === 'true');
    await page.keyboard.press('ControlOrMeta+t');
    await until(() => omit.getAttribute('aria-pressed'), (v) => v === 'false');
    // From the Requests menu too.
    await page.locator('.menubar').getByRole('button', { name: 'Requests', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Omit\b/ }).click();
    await until(() => omit.getAttribute('aria-pressed'), (v) => v === 'true');

    // Two more requests; Go to Request > Specify… shows the third.
    await tool(page, 'New Request').click();
    await tool(page, 'New Request').click();
    const box = page.getByRole('textbox', { name: 'Request number' });
    await until(() => box.inputValue(), (v) => v === '3');
    await page.locator('.menubar').getByRole('button', { name: 'Requests', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Go to Record/Request/Page' }).click();
    await page.getByRole('menuitem', { name: 'Specify…', exact: true }).click();
    await answer(page, 'Go to Request', 'Go', '1');
    await until(() => box.inputValue(), (v) => v === '1');
    assert.equal(await field(page, CITY).inputValue(), 'Leeds');
    assert.equal(await omit.getAttribute('aria-pressed'), 'true', 'request 1 is the omitted one');

    // The Perform Find that follows leaves the two Leeds records out.
    await tool(page, 'Perform Find').click();
    await until(() => count(page), (t) => t === '2');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('the questions the page asks answer to the keyboard: Enter confirms, Escape cancels', { skip }, async () => {
  const page = await open();
  try {
    const name = await field(page, NAME).inputValue();
    const dialog = page.getByRole('dialog', { name: 'Delete Record' });
    await tool(page, 'Delete Record').click();
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(names().includes(name), 'Escape kept the record');
    await tool(page, 'Delete Record').click();
    await dialog.waitFor();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await until(async () => names(), (n) => !n.includes(name));
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

// Layout mode in place, in a real browser, on a small database built here with
// no .fmp12: the browse window's Layout button opens this layout for editing,
// an object is selected, moved with the arrow keys and sized in the Inspector,
// the layout is saved, and Exit Layout comes back to the same record. Leaving
// with changes not saved asks first, and Undo steps back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// The generated form's Name field (its label, Id's label and box come first).
const NAME = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.create('Customers', { Id: 2, Name: 'Grace' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The Name field's bounds as the file holds them. */
function bounds(): { top: number; left: number; bottom: number; right: number } {
  return { ...hosted.store('Shop').design('Customers')!.objects.find((o) => o.id === NAME)!.bounds };
}

/** Signed in, in form view, on the second customer. */
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  await page.getByRole('button', { name: 'Next record' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
  return page;
}

async function close(page: Page): Promise<void> {
  // A test that failed in Layout mode is brought back to the browse window first.
  if (!(await page.getByRole('button', { name: 'Log out' }).isVisible())) {
    page.on('dialog', (d) => void d.accept());
    await page.goto(hosted.url + '/app/');
  }
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

const modes = (page: Page) => page.getByRole('group', { name: 'Mode' });
const object = (page: Page, id: number) => page.locator(`.le-obj[data-id="${id}"]`);
const inspector = (page: Page, label: string) => page.locator('label.d-field', { hasText: new RegExp(`^${label}`) }).locator('input').first();

async function enterLayout(page: Page): Promise<void> {
  await modes(page).getByRole('button', { name: 'Layout' }).click();
  await object(page, NAME).waitFor();
}

test('Layout mode edits this layout in place: move, size, save, and Exit Layout comes back to the same record', { skip }, async () => {
  const page = await open();
  const was = bounds();
  try {
    await enterLayout(page);
    assert.equal(await modes(page).getByRole('button', { name: 'Layout' }).getAttribute('aria-pressed'), 'true');

    await object(page, NAME).click();
    await until(() => object(page, NAME).getAttribute('class'), (c) => /\bselected\b/.test(c ?? ''));
    await until(() => inspector(page, 'Left').inputValue(), (v) => Number(v) === was.left);
    // Shift+arrow moves 10 points; an arrow on its own, 1.
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ArrowRight');
    await until(() => inspector(page, 'Top').inputValue(), (v) => Number(v) === was.top + 10);
    assert.equal(Number(await inspector(page, 'Left').inputValue()), was.left + 1);
    // The Inspector sizes it.
    await inspector(page, 'Width').fill('200');
    await inspector(page, 'Width').press('Enter');
    await until(() => object(page, NAME).evaluate((e) => e.getBoundingClientRect().width), (w) => w > 0);
    assert.deepEqual(bounds(), was, 'nothing is saved before Save');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => bounds(), (b) => b.top === was.top + 10 && b.left === was.left + 1 && b.right - b.left === 200);

    await page.getByRole('button', { name: 'Exit Layout' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    assert.equal(await modes(page).getByRole('button', { name: 'Browse' }).getAttribute('aria-pressed'), 'true');
    // The browse window draws the field where it now is: 200 points wide.
    const box = page.locator(`.fm[data-id="${NAME}"]`);
    await until(() => box.evaluate((e) => (e as HTMLElement).offsetWidth), (w) => Math.abs(w - 200) <= 2);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    hosted.store('Shop').applyDesign([{ op: 'updateLayout', layout: 'Customers', design: {
      objects: hosted.store('Shop').design('Customers')!.objects.map((o) => o.id === NAME ? { ...o, bounds: was } : o),
    } }] as DesignOp[]);
  }
});

test('Undo steps back, and leaving Layout mode with changes not saved asks first', { skip }, async () => {
  const page = await open();
  const was = bounds();
  try {
    await enterLayout(page);
    await object(page, NAME).click();
    await until(() => inspector(page, 'Top').inputValue(), (v) => Number(v) === was.top);
    await page.keyboard.press('Shift+ArrowDown');
    await until(() => inspector(page, 'Top').inputValue(), (v) => Number(v) === was.top + 10);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await until(() => inspector(page, 'Top').inputValue(), (v) => Number(v) === was.top);

    // Changed again, then Browse: cancelling the question stays in Layout mode; accepting leaves without saving.
    await object(page, NAME).click();
    await page.keyboard.press('Shift+ArrowDown');
    await until(() => inspector(page, 'Top').inputValue(), (v) => Number(v) === was.top + 10);
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); void d.dismiss(); });
    await modes(page).getByRole('button', { name: 'Browse' }).click();
    await until(async () => asked, (a) => /without saving/.test(a));
    assert.equal(await object(page, NAME).count(), 1, 'still in Layout mode');

    page.once('dialog', (d) => void d.accept());
    await modes(page).getByRole('button', { name: 'Browse' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    assert.deepEqual(bounds(), was, 'the change wasn\'t saved');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

// An object in the middle of the generated form's stack.
const MIDDLE = 3;
const order = () => hosted.store('Shop').design('Customers')!.objects.map((o) => o.id);

test('Cut removes the selected object and Undo brings it back; the stacking shortcuts bring it to the front and send it to the back', { skip }, async () => {
  const page = await open();
  const was = hosted.store('Shop').design('Customers')!.objects;
  try {
    await enterLayout(page);
    await object(page, NAME).click();
    await until(() => object(page, NAME).getAttribute('class'), (c) => /\bselected\b/.test(c ?? ''));
    await page.keyboard.press('ControlOrMeta+x');
    await object(page, NAME).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await object(page, NAME).waitFor();

    // An object in the middle of the stack: to the front puts it last, to the back first, one step forward moves it to second.
    await object(page, MIDDLE).click();
    await until(() => object(page, MIDDLE).getAttribute('class'), (c) => /\bselected\b/.test(c ?? ''));
    await page.keyboard.press('ControlOrMeta+Shift+BracketRight');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => order().at(-1), (id) => id === MIDDLE);
    await object(page, MIDDLE).click();
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => order()[0], (id) => id === MIDDLE);
    await object(page, MIDDLE).click();
    await page.keyboard.press('ControlOrMeta+BracketRight');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => order().indexOf(MIDDLE), (i) => i === 1);
    // Saving again and again never reads the earlier saves as someone else's.
    assert.equal(await page.locator('.toast', { hasText: 'saved this layout too' }).count(), 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    hosted.store('Shop').applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: was } }] as DesignOp[]);
  }
});

test('Right-click on an object opens a menu: Send to Back reorders it, Delete removes it, Undo brings it back', { skip }, async () => {
  const page = await open();
  const was = hosted.store('Shop').design('Customers')!.objects;
  try {
    await enterLayout(page);
    await object(page, MIDDLE).click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Layout object commands' });
    await menu.waitFor();
    assert.match((await object(page, MIDDLE).getAttribute('class')) ?? '', /\bselected\b/);
    await menu.getByRole('menuitem', { name: 'Send to Back' }).click();
    await menu.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => order()[0], (id) => id === MIDDLE);

    await object(page, NAME).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await object(page, NAME).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await object(page, NAME).waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    hosted.store('Shop').applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: was } }] as DesignOp[]);
  }
});

// Canvas keyboard paths in a real browser, using a temporary database built in memory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import type { Hosted } from './harness.ts';
import { host, launch, signIn, window } from './harness.ts';

let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'canvas-secret-1';

before(async () => {
  hosted = await host({ stores: ['Canvas'] });
  const store = hosted.store('Canvas');
  store.applyDesign([{ op: 'createTable', name: 'Objects', fields: [{ name: 'Name' }] }] as DesignOp[]);
  store.setPassword('Admin', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

function object(id: number, left: number, top: number, extra: Partial<LayoutObject> = {}): LayoutObject {
  return {
    id, kind: 'rectangle', type: 3, name: `Shape ${id}`, style: {},
    anchors: { left: true, top: true, right: false, bottom: false },
    bounds: { left, top, right: left + 40, bottom: top + 20 }, ...extra,
  };
}
const objects = () => [object(3, 30, 100), object(2, 100, 40), object(1, 30, 40)];
const box = (page: Page, id: number) => page.locator(`.le-overlay .le-obj[data-id="${id}"]`);
const overlay = (page: Page) => page.getByRole('application', { name: 'Design canvas' });
const selected = (page: Page) => page.locator('.le-overlay .le-obj.selected').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-id'))));
const geometry = (page: Page, id: number) => box(page, id).evaluate((e) => {
  const s = (e as HTMLElement).style;
  return [s.left, s.top, s.width, s.height].map(parseFloat);
});

async function open(items = objects(), tabOrder: number[] = []): Promise<Page & { errors: string[] }> {
  // Sign-in waits for a painted layout; switch to the empty design only once it is open.
  hosted.store('Canvas').applyDesign([{ op: 'updateLayout', layout: 'Objects', design: { objects: items.length ? items : objects(), tabOrder } }] as DesignOp[]);
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Canvas', 'Admin', PASSWORD);
  if (!items.length) hosted.store('Canvas').applyDesign([{ op: 'updateLayout', layout: 'Objects', design: { objects: [] } }] as DesignOp[]);
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Layout' }).click();
  await overlay(page).waitFor();
  await overlay(page).focus();
  return page;
}
async function close(page: Page & { errors: string[] }): Promise<void> {
  try { assert.deepEqual(page.errors, []); } finally { await page.context().close(); }
}

async function pressSelect(page: Page, key: string, id: number): Promise<void> {
  await page.keyboard.press(key);
  assert.deepEqual(await selected(page), [id]);
  assert.equal(await overlay(page).evaluate((e) => e === document.activeElement), true);
}

test('Tab follows reading order, Shift+Tab reverses it, and both ends release focus', async () => {
  const page = await open();
  try {
    assert.deepEqual(await selected(page), []);
    assert.equal(await overlay(page).evaluate((e) => getComputedStyle(e).outlineWidth), '2px');
    assert.equal(await page.locator('.le-canvas').evaluate((e) => (e as HTMLElement).inert), true);
    await pressSelect(page, 'Tab', 1);
    await pressSelect(page, 'Tab', 2);
    await pressSelect(page, 'Shift+Tab', 1);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await overlay(page).evaluate((e) => e === document.activeElement), false);
    await overlay(page).focus();
    await pressSelect(page, 'Tab', 2);
    await pressSelect(page, 'Tab', 3);
    await page.keyboard.press('Tab');
    assert.equal(await overlay(page).evaluate((e) => e === document.activeElement), false);
  } finally { await close(page); }
});

test('configured tab order precedes remaining objects in reading order', async () => {
  const page = await open(objects(), [3, 2]);
  try {
    await pressSelect(page, 'Tab', 3);
    await pressSelect(page, 'Tab', 2);
    await pressSelect(page, 'Tab', 1);
    await pressSelect(page, 'Shift+Tab', 2);
    await pressSelect(page, 'Shift+Tab', 3);
  } finally { await close(page); }
});

test('reverse traversal starts at the last object; an empty canvas releases Tab', async () => {
  const page = await open();
  try { await pressSelect(page, 'Shift+Tab', 3); } finally { await close(page); }
  const empty = await open([]);
  try {
    for (const key of ['Tab', 'Shift+Tab']) {
      await overlay(empty).focus();
      await empty.keyboard.press(key);
      assert.equal(await overlay(empty).evaluate((e) => e === document.activeElement), false);
      assert.deepEqual(await selected(empty), []);
    }
  } finally { await close(empty); }
});

test('Alt+Arrow resizes, Shift changes by ten, movement stays intact, and Undo/Redo restores geometry', async () => {
  const page = await open();
  try {
    await pressSelect(page, 'Tab', 1);
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    assert.deepEqual(await geometry(page, 1), [30, 40, 41, 30]);
    await page.keyboard.press('Alt+ArrowLeft');
    await page.keyboard.press('Alt+ArrowUp');
    assert.deepEqual(await geometry(page, 1), [30, 40, 40, 29]);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await geometry(page, 1), [30, 40, 40, 30]);
    await page.keyboard.press('Control+Shift+z');
    assert.deepEqual(await geometry(page, 1), [30, 40, 40, 29]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    assert.deepEqual(await geometry(page, 1), [31, 50, 40, 29]);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await page.keyboard.press('Alt+Shift+ArrowUp');
    }
    assert.deepEqual(await geometry(page, 1), [31, 50, 4, 4]);
  } finally { await close(page); }
});

test('selection and geometry are announced in a persistent polite live region', async () => {
  const page = await open([object(1, 30, 40, { name: 'Frame <one>' })]);
  try {
    const status = page.locator('.le-selection-status');
    assert.equal(await status.getAttribute('role'), 'status');
    assert.equal(await status.getAttribute('aria-live'), 'polite');
    assert.equal(await status.getAttribute('aria-atomic'), 'true');
    const original = await status.elementHandle();
    await pressSelect(page, 'Tab', 1);
    assert.equal(await status.textContent(), 'rectangle: Frame <one>. Position 30, 40; width 40, height 20 points.');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await status.textContent(), 'rectangle: Frame <one>. Position 31, 40; width 40, height 21 points.');
    assert.equal(await status.evaluate((e, old) => e === old, original), true);
    assert.equal(await status.locator('*').count(), 0, 'names stay plain text');
    await page.keyboard.press('Delete');
    assert.equal(await status.textContent(), 'No object selected.');
  } finally { await close(page); }
});

test('locked objects and children remain selectable but cannot move or resize', async () => {
  const tableOccurrenceId = hosted.store('Canvas').design('Objects')!.tableOccurrenceId;
  assert.notEqual(tableOccurrenceId, undefined);
  const portal = object(1, 30, 40, {
    kind: 'portal', type: 9, locked: true, children: [object(2, 32, 42)],
    portal: { tableOccurrenceId: tableOccurrenceId!, tableOccurrence: 'Objects', rows: 1, initialRow: 1 },
  });
  const page = await open([portal]);
  try {
    for (const id of [1, 2]) {
      await pressSelect(page, 'Tab', id);
      const was = await geometry(page, id);
      await page.keyboard.press('Alt+Shift+ArrowRight');
      await page.keyboard.press('ArrowDown');
      assert.deepEqual(await geometry(page, id), was);
      assert.match(await page.locator('.le-selection-status').textContent() ?? '', /Locked/);
    }
  } finally { await close(page); }
});

test('groups resize their children and traversal skips grouped children and hidden panels', async () => {
  const group = object(1, 30, 40, { kind: 'group', type: 8, children: [object(2, 30, 40)] });
  const tabs = object(3, 100, 40, { kind: 'tab-control', type: 11, children: [
    object(4, 100, 40, { kind: 'tab-panel', children: [object(5, 105, 45)] }),
    object(6, 100, 40, { kind: 'tab-panel', children: [object(7, 105, 45)] }),
  ] });
  const page = await open([tabs, group]);
  try {
    await pressSelect(page, 'Tab', 1);
    await page.keyboard.press('Alt+Shift+ArrowRight');
    assert.deepEqual(await geometry(page, 1), [30, 40, 50, 20]);
    await page.keyboard.press('Control+Shift+r'); // Ungroup exposes the scaled child.
    assert.deepEqual(await geometry(page, 2), [30, 40, 50, 20]);
    await page.keyboard.press('Control+z');
    await pressSelect(page, 'Tab', 1);
    await pressSelect(page, 'Tab', 3);
    await pressSelect(page, 'Tab', 5);
    await page.keyboard.press('Tab');
    assert.equal(await overlay(page).evaluate((e) => e === document.activeElement), false);
    assert.equal(await box(page, 7).count(), 0);
  } finally { await close(page); }
});

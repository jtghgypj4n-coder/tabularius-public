// Layout objects that show or style other objects, in a real browser, on a
// small database built here with no .fmp12: a tab control, a slide control, a
// popover and its button, conditional formatting and "Hide object when". Each
// test checks what the window shows, and for fields edited inside them, what
// reaches the file.
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
// Layout object ids, as laid out below.
const ID = 1;
const NAME = 2;
const QTY = 3;
const BIG = 4;
const TABS = 10;
const MAIN_TAB = 11;
const MORE_TAB = 12;
const NAME_ON_TAB = 13;
const NOTE = 14;
const SLIDES = 20;
const SLIDE_ONE = 21;
const SLIDE_TWO = 22;
const ONE = 23;
const TWO = 24;
const OPEN = 30;
const POPOVER = 31;
const SECRET = 32;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Desk'] });
  const store = hosted.store('Desk');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Qty', type: 'number' }, { name: 'Note' }, { name: 'Secret' }] },
  ] as DesignOp[]);

  const design = store.design('Items')!;
  const occ = store.schema.tableOccurrences.find((t) => t.name === 'Items')!;
  const fieldId = (name: string) => store.schema.tables.find((t) => t.name === 'Items')!.fields.find((f) => f.name === name)!.id;
  const style = design.objects.find((o) => o.kind === 'field')!.style;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const at = (top: number, height: number, left = 20, width = 300) => ({ top, left, bottom: top + height, right: left + width });
  const box = (id: number, name: string, top: number, extra: Partial<LayoutObject> = {}): LayoutObject => ({
    id, kind: 'field', type: 1, anchors, style, bounds: at(top, 22),
    field: { tableOccurrenceId: occ.id, fieldId: fieldId(name), tableOccurrence: 'Items', field: name, display: 'edit', repetitions: 1 },
    ...extra,
  } as LayoutObject);
  const text = (id: number, top: number, words: string, extra: Partial<LayoutObject> = {}): LayoutObject =>
    ({ id, kind: 'text', type: 2, anchors, style: {}, bounds: at(top, 20), text: words, ...extra } as LayoutObject);
  const panel = (id: number, kind: 'tab-panel' | 'slide-panel', bounds: LayoutObject['bounds'], label: string, children: LayoutObject[]): LayoutObject =>
    ({ id, kind, type: kind === 'tab-panel' ? 12 : 17, anchors, style: {}, bounds, text: label, children } as LayoutObject);

  const tabs = at(130, 100);
  const slides = at(240, 80);
  const objects: LayoutObject[] = [
    box(ID, 'Id', 10),
    box(NAME, 'Name', 40),
    // Qty turns red past 10, and a note says so: shown only then.
    box(QTY, 'Qty', 70, { conditions: [{ formula: 'Self > 10', rules: [{ part: 1, state: 1, css: { 'background-color': 'rgb(255, 0, 0)' } }] }] }),
    text(BIG, 100, 'Big order', { hide: { formula: 'Items::Qty <= 10', inFind: false } }),
    { id: TABS, kind: 'tab-control', type: 11, anchors, style: {}, bounds: tabs, target: MAIN_TAB, children: [
      panel(MAIN_TAB, 'tab-panel', tabs, 'Main', [box(NAME_ON_TAB, 'Name', 165)]),
      panel(MORE_TAB, 'tab-panel', tabs, 'More', [box(NOTE, 'Note', 165)]),
    ] } as LayoutObject,
    { id: SLIDES, kind: 'slide-control', type: 16, anchors, style: {}, bounds: slides, children: [
      panel(SLIDE_ONE, 'slide-panel', slides, '', [text(ONE, 260, 'First slide')]),
      panel(SLIDE_TWO, 'slide-panel', slides, '', [text(TWO, 260, 'Second slide')]),
    ] } as LayoutObject,
    { id: OPEN, kind: 'popover-button', type: 14, anchors, style: {}, bounds: at(330, 24, 20, 110), text: 'Details', target: POPOVER } as LayoutObject,
    { id: POPOVER, kind: 'popover', type: 15, anchors, style: {}, bounds: at(370, 60), text: 'Secret details', titleBar: true, children: [box(SECRET, 'Secret', 390)] } as LayoutObject,
  ];
  const parts = design.parts.map((p) => p.kind === 'body' ? { ...p, height: 460 } : p);
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { parts, objects } }] as DesignOp[]);

  store.create('Items', { Id: 1, Name: 'Tea', Qty: 3, Note: 'green', Secret: 'a' });
  store.create('Items', { Id: 2, Name: 'Cake', Qty: 12, Note: 'lemon', Secret: 'b' });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Record `id`'s fields as the file holds them. */
function item(id: number): Record<string, unknown> {
  return hosted.store('Desk').find('Items', { query: [{ Id: `==${id}` }] }).records[0]?.fieldData ?? {};
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Desk', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => page.locator(`.fm[data-id="${ID}"]`).count(), (n) => n === 1);
  await goTo(page, 1);
  return page;
}

async function close(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('select[name="db"]').waitFor();
  await page.context().close();
}

/** Goes to record `n` (the record whose Id is n: they were made in order). */
async function goTo(page: Page, n: number): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Record number' });
  await until(async () => {
    if (await box.inputValue() !== String(n)) {
      await box.fill(String(n));
      await box.press('Enter');
    }
    return field(page, ID).inputValue();
  }, (v) => v === String(n));
}

const object = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`);

test('a tab control is a tab list: roles, the selected tab, and arrow keys moving between tabs', { skip }, async () => {
  const page = await open();
  try {
    const control = object(page, TABS);
    const tabs = control.locator('[role=tab]');
    assert.equal(await control.locator('[role=tablist]').count(), 1);
    assert.equal(await tabs.count(), 2);
    assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
    assert.equal(await tabs.nth(1).getAttribute('tabindex'), '-1');
    const panel = control.locator('[role=tabpanel]:not([hidden])');
    assert.equal(await panel.getAttribute('aria-labelledby'), await tabs.nth(0).getAttribute('id'));
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await until(() => field(page, NOTE).isVisible(), (v) => v);
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
    assert.equal(await tabs.nth(1).evaluate((t) => document.activeElement === t), true, 'the focus follows');
    await page.keyboard.press('Home');
    await until(() => field(page, NAME_ON_TAB).isVisible(), (v) => v);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a tab control shows the panel whose tab is clicked, and keeps it in front from record to record', { skip }, async () => {
  const page = await open();
  try {
    const control = object(page, TABS);
    const tab = (name: string) => control.locator('.fm-tab', { hasText: name });
    assert.equal(await tab('Main').getAttribute('aria-selected'), 'true');
    assert.equal(await field(page, NAME_ON_TAB).isVisible(), true);
    assert.equal(await field(page, NOTE).isVisible(), false, 'the second panel starts behind');

    await tab('More').click();
    await until(() => field(page, NOTE).isVisible(), (v) => v);
    assert.equal(await field(page, NAME_ON_TAB).isVisible(), false);
    assert.equal(await tab('More').getAttribute('aria-selected'), 'true');
    assert.equal(await field(page, NOTE).inputValue(), 'green');

    // A field on the panel saves like any other.
    await field(page, NOTE).fill('sencha');
    await field(page, NOTE).press('Tab');
    await until(async () => item(1).Note, (v) => v === 'sencha');

    await goTo(page, 2);
    await until(() => field(page, NOTE).inputValue(), (v) => v === 'lemon');
    assert.equal(await field(page, NOTE).isVisible(), true, 'the panel picked stays in front on the next record');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a slide control shows one slide, and its dots move between them', { skip }, async () => {
  const page = await open();
  try {
    const control = object(page, SLIDES);
    const dot = (n: number) => control.getByRole('button', { name: `Slide ${n} of 2` });
    assert.equal(await object(page, ONE).isVisible(), true);
    assert.equal(await object(page, TWO).isVisible(), false);
    assert.equal(await dot(1).getAttribute('aria-pressed'), 'true');

    await dot(2).click();
    await until(() => object(page, TWO).isVisible(), (v) => v);
    assert.equal(await object(page, ONE).isVisible(), false);
    assert.equal(await dot(2).getAttribute('aria-pressed'), 'true');
    assert.equal(await dot(1).getAttribute('aria-pressed'), 'false');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('a popover opens from its button, saves the field edited in it, and closes on a click outside or Esc', { skip }, async () => {
  const page = await open();
  try {
    const popover = page.getByRole('dialog', { name: 'Secret details' });
    assert.equal(await popover.count(), 0);
    await object(page, OPEN).getByRole('button').click();
    await popover.waitFor();
    // The keyboard goes into it.
    await until(() => field(popover, SECRET).evaluate((e) => e === document.activeElement), (v) => v);
    assert.equal(await field(popover, SECRET).inputValue(), 'a');
    await field(popover, SECRET).fill('hidden');

    // Clicking elsewhere on the layout closes it, and what was typed is saved.
    await page.locator('.fm-part-body').first().click({ position: { x: 600, y: 20 } });
    await popover.waitFor({ state: 'detached' });
    await until(async () => item(1).Secret, (v) => v === 'hidden');

    // Its button opens it again; Esc closes it.
    await object(page, OPEN).getByRole('button').click();
    await popover.waitFor();
    await until(() => field(popover, SECRET).inputValue(), (v) => v === 'hidden');
    await page.keyboard.press('Escape');
    await popover.waitFor({ state: 'detached' });
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('conditional formatting and Hide object when follow the record, and a change to it', { skip }, async () => {
  const page = await open();
  try {
    const RED = 'rgb(255, 0, 0)';
    const fill = () => object(page, QTY).evaluate((e) => getComputedStyle(e).backgroundColor);
    // Record 1 has 3: the field's own fill, no note.
    await until(() => object(page, QTY).count(), (n) => n === 1);
    const own = await fill();
    assert.notEqual(own, RED);
    assert.equal(await object(page, BIG).count(), 0, 'hidden objects are not drawn');

    // Record 2 has 12: both.
    await goTo(page, 2);
    await until(fill, (c) => c === RED);
    await until(() => object(page, BIG).count(), (n) => n === 1);
    assert.equal(await object(page, BIG).textContent(), 'Big order');

    // Changing Qty to 5 takes them away as the cursor leaves it, though it goes on to another field,
    // and that field keeps the cursor.
    await field(page, QTY).fill('5');
    await field(page, NAME).click();
    await until(async () => item(2).Qty, (v) => Number(v) === 5);
    await until(fill, (c) => c === own);
    await until(() => object(page, BIG).count(), (n) => n === 0);
    const focused = () => page.evaluate(() => document.activeElement?.closest<HTMLElement>('.fm[data-id]')?.dataset.id);
    assert.equal(await focused(), String(NAME));
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

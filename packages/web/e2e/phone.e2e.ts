// The web client on a phone, in a real browser emulating one (touch, a narrow
// window, an iPhone's user agent), on a small database built here with no
// .fmp12: the records bar at the bottom, a sideways swipe to the next or
// previous record, pulling down to refresh, and hide conditions that read
// Get ( Device ) and Get ( WindowWidth ). The touches are sent the way a phone's
// are, so the browser's own scrolling and panning get their say.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { devices, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'ann-secret-1';
// The generated form's Name field, and two text objects added below.
const NAME = 5;
const PHONE_ONLY = 20;
const WIDE_ONLY = 21;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  const design = store.design('Customers')!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const text = (id: number, top: number, words: string, hide: string): LayoutObject => ({
    id, kind: 'text', type: 2, anchors, style: {}, bounds: { top, left: 20, bottom: top + 20, right: 300 }, text: words, hide: { formula: hide, inFind: false },
  } as LayoutObject);
  store.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [
    ...design.objects,
    text(PHONE_ONLY, 140, 'Phone only', 'Get ( Device ) ≠ 4'),
    text(WIDE_ONLY, 160, 'Wide only', 'Get ( WindowWidth ) < 500'),
  ] } }] as DesignOp[]);
  for (const [Id, Name] of [[1, 'Ada'], [2, 'Grace'], [3, 'Hedy']] as const) store.create('Customers', { Id, Name });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** A window signed in on the first customer, in a browser context with these options. */
async function open(options: BrowserContextOptions): Promise<Page & { errors: string[] }> {
  const context = await browser.newContext(options);
  const page = await context.newPage() as Page & { errors: string[] };
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await signIn(page, hosted.url, 'Shop', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}
const phone = () => open({ ...devices['iPhone 13'] });

async function close(page: Page): Promise<void> {
  await page.context().close();
}

const bar = (page: Page) => page.getByRole('navigation', { name: 'Records' });
const shown = (page: Page, id: number) => page.locator(`.fm[data-id="${id}"]`).count().then((n) => n > 0);

/** A one-finger drag on the window's content, by (dx, dy) pixels, quick enough to count as a swipe. */
async function drag(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await page.locator('.content').first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 300);
  // A spot on the layout itself, not in a field (fields keep their own touches).
  const [sx, sy] = [x + 140, y - 120];
  const cdp = await page.context().newCDPSession(page);
  const point = (px: number, py: number) => [{ x: px, y: py, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(sx, sy) });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(sx + (dx * i) / 5, sy + (dy * i) / 5) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Repeat a drag only when the app did not recognize a swipe; then wait for the record to load. */
async function swipeTo(page: Page, dx: number, name: string): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { swipeCount?: number };
    if (w.swipeCount !== undefined) return;
    w.swipeCount = 0;
    new MutationObserver(() => { if (document.querySelector('.content')?.hasAttribute('data-swipe')) w.swipeCount!++; })
      .observe(document.querySelector('.content')!, { attributes: true, attributeFilter: ['data-swipe'] });
  });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const before = await page.evaluate(() => (window as unknown as { swipeCount: number }).swipeCount);
    await drag(page, dx, 0);
    const recognized = await page.evaluate((n) => (window as unknown as { swipeCount: number }).swipeCount > n, before);
    if (!recognized) continue;
    await until(() => field(page, NAME).inputValue(), (v) => v === name);
    return;
  }
  throw new Error(`the browser did not recognize four swipe gestures toward ${name}`);
}

test('on a phone the records bar sits at the bottom, and Get ( Device ) and the window width are the phone\'s', { skip }, async () => {
  const page = await phone();
  try {
    await bar(page).waitFor();
    await until(() => bar(page).getByRole('button', { name: /of 3/ }).textContent(), (t) => t === '1 of 3');
    await bar(page).getByRole('button', { name: 'Next record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    await until(() => bar(page).getByRole('button', { name: /of 3/ }).textContent(), (t) => t === '2 of 3');
    await until(() => shown(page, PHONE_ONLY), (s) => s);
    assert.equal(await shown(page, WIDE_ONLY), false);
    // Nothing (the menu bar, say) makes the page wider than the phone, which would then pan sideways under a swipe.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }

  // On a desktop browser, the other way round, and no bar at the bottom.
  const desk = await open({ viewport: { width: 1280, height: 900 } });
  try {
    await until(() => shown(desk, WIDE_ONLY), (s) => s);
    assert.equal(await shown(desk, PHONE_ONLY), false);
    assert.equal(await bar(desk).isVisible(), false);
    assert.deepEqual(desk.errors, []);
  } finally {
    await close(desk);
  }
});

test('a sideways swipe goes to the next or previous record', { skip }, async () => {
  const page = await phone();
  try {
    await swipeTo(page, -160, 'Grace');
    await swipeTo(page, -160, 'Hedy');
    // Past the last record: nothing happens.
    await drag(page, -160, 0);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await field(page, NAME).inputValue(), 'Hedy');
    await swipeTo(page, 160, 'Grace');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('pulling down at the top of the window refreshes it', { skip }, async () => {
  const page = await phone();
  const store = hosted.store('Shop');
  const ada = Number(store.find('Customers', { query: [{ Id: '==1' }] }).records[0].recordId);
  // Whether the window showed its refreshing spinner, which only a pull far enough down does.
  await page.evaluate(() => {
    const w = window as unknown as { refreshed: number };
    w.refreshed = 0;
    new MutationObserver(() => { if (document.querySelector('.pull-refresh.busy')) w.refreshed++; })
      .observe(document.getElementById('content')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const refreshed = () => page.evaluate(() => (window as unknown as { refreshed: number }).refreshed);
  try {
    // Not far enough: nothing.
    await drag(page, 0, 40);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await refreshed(), 0);
    store.update('Customers', ada, { Name: 'Augusta' });
    await drag(page, 0, 110);
    await until(refreshed, (n) => n > 0);
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Augusta');
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
    store.update('Customers', ada, { Name: 'Ada' });
  }
});

test('on a phone the menu bar is one Menu button; its titles come down on a tap and a menu opens full width', { skip }, async () => {
  const page = await phone();
  try {
    const menubar = page.getByRole('navigation', { name: 'Menus' });
    const toggle = menubar.getByRole('button', { name: 'Menu', exact: true });
    // One 44-point row, not the desktop's two lines of titles.
    assert.ok((await menubar.boundingBox())!.height <= 56, 'a single row of chrome');
    assert.equal(await menubar.locator('.menu-title').first().isVisible(), false);
    await toggle.click();
    const titles = menubar.locator('.menu-title');
    assert.ok((await titles.count()) > 2);
    for (const box of await titles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) assert.ok(box.height >= 44 && box.width >= 44, 'tap targets of 44 points');
    await titles.filter({ hasText: /^Records$/ }).click();
    const list = menubar.getByRole('menu').first();
    await list.waitFor();
    const box = (await list.boundingBox())!;
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'the menu fits the phone');
    // Choosing a command folds the titles away again.
    await list.getByRole('menuitem').filter({ hasText: /New Record/ }).click();
    await until(() => menubar.locator('.menu-title').first().isVisible(), (v) => v === false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    // Browse, Find and the record controls stay in the bottom bar.
    await bar(page).getByRole('button', { name: 'Find' }).waitFor();
    assert.deepEqual(page.errors, []);
  } finally {
    await close(page);
  }
});

test('on a wide window the menu bar is the row of titles, with no Menu button', { skip }, async () => {
  const page = await open({ viewport: { width: 1200, height: 800 } });
  try {
    const menubar = page.getByRole('navigation', { name: 'Menus' });
    assert.equal(await menubar.getByRole('button', { name: 'Menu', exact: true }).isVisible(), false);
    assert.equal(await menubar.locator('.menu-title').first().isVisible(), true);
  } finally {
    await close(page);
  }
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { refreshFixture } from '../../server/test/refresh-fixture.ts';
import { findChromium, host, launch, signIn, until, window, field, type Hosted } from './harness.ts';

let hosted: Hosted;
let browser: Browser;
before(async () => {
  assert.ok(findChromium(), 'Chromium must execute these acceptance tests');
  hosted = await host({ stores: ['Refresh'] });
  refreshFixture(hosted.store('Refresh'));
  hosted.store('Refresh').setPassword('Admin', 'pw');
  browser = await launch();
});
after(async () => { await browser?.close(); await hosted?.close(); });

async function open() {
  const page = await window(browser);
  await page.addInitScript(() => {
    Object.assign(window, { fixtureEvents: [] });
    addEventListener('message', (e) => { if (e.data?.fixture) (window as unknown as { fixtureEvents: unknown[] }).fixtureEvents.push(e.data); });
  });
  await signIn(page, hosted.url, 'Refresh', 'Admin', 'pw');
  await until(() => field(page, 10).inputValue(), (v) => v === '1');
  return page;
}
async function click(page: Page, name: string) {
  const response = page.waitForResponse((r) => r.url().includes('/button') && r.request().method() === 'POST');
  await page.getByRole('button', { name, exact: true }).click();
  await response;
  await until(() => page.locator('.content').getAttribute('aria-busy'), (v) => v !== 'true');
}
async function quietLive(page: Page, file: string): Promise<void> {
  await page.addInitScript((endpoint) => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== 'string' || !input.endsWith(endpoint)) return original(input, init);
      // Keep the stream open: closing it makes the client reconnect and reload
      // the found set, which would race this test's explicit refresh.
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode(': cached display\n\n'));
        init?.signal?.addEventListener('abort', () => { try { controller.close(); } catch { /* already closed */ } }, { once: true });
      } });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    }) as typeof globalThis.fetch;
  }, `/tabularius/live/v1/databases/${file}/events`);
}
const viewer = (page: Page) => page.frameLocator('.fm[data-id="20"] iframe');
const events = (page: Page) => page.evaluate(() => (window as unknown as { fixtureEvents: { fixture: string; page?: string; value?: string }[] }).fixtureEvents);

test('targeted objects reevaluate unstored values and visibility, retaining sibling UI and viewer content', async () => {
  const page = await open();
  await until(() => viewer(page).locator('#page').textContent(), (v) => v === 'A');
  assert.equal(await page.locator('[data-id="12"]').count(), 0);
  await page.evaluate(() => { (document.querySelector('[data-id="11"]') as HTMLElement).dataset.untouched = 'yes'; });
  const before = (await events(page)).filter((e) => e.fixture === 'load').length;
  await click(page, 'Object');
  await until(() => field(page, 10).inputValue(), (v) => v === '2');
  assert.equal(await field(page, 11).inputValue(), '1');
  assert.equal(await page.locator('[data-id="10"]').evaluate((e) => getComputedStyle(e).color), 'rgb(160, 0, 0)');
  assert.equal(await page.locator('[data-id="11"]').getAttribute('data-untouched'), 'yes');
  await until(() => page.locator('[data-id="12"]').textContent(), (v) => v === 'Now visible');
  assert.equal((await events(page)).filter((e) => e.fixture === 'load').length, before);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('portal refresh recomputes membership/order; child refresh applies in every visible row and preserves repetitions', async () => {
  const page = await open();
  const rows = page.locator('[data-id="30"] .fm-portal-row[data-row]');
  assert.equal(await rows.count(), 1);
  await click(page, 'Portal');
  await until(() => rows.count(), (v) => v === 3);
  assert.deepEqual(await rows.locator('[data-id="31"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), ['3:row 3', '3:row 2', '3:row 1']);
  assert.deepEqual(await rows.first().locator('[data-id="32"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), ['one', 'two', 'three']);
  await click(page, 'Child');
  await until(() => rows.locator('[data-id="31"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), (v) => v.every((s) => s.startsWith('4:')));
  assert.equal(await field(page, 10).inputValue(), '1');
  assert.equal(await rows.count(), 3);
  await click(page, 'Shrink');
  await until(() => rows.locator('[data-id="31"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), (v) => v.every((s) => s.startsWith('1:')));
  assert.equal(await rows.count(), 3, 'object refresh preserves membership when the filter shrinks');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('scrolling after Refresh Object retains offscreen related values and clears requested deleted or denied rows', async () => {
  const fixture = await host({ stores: ['ScrollRefresh'] });
  let page: Awaited<ReturnType<typeof window>> | undefined;
  try {
    const store = fixture.store('ScrollRefresh');
    refreshFixture(store);
    const deleted = store.create('Rows', { Parent: 1, Name: 'row 4', Rank: 4 }).recordId;
    const visible = store.create('Rows', { Parent: 1, Name: 'row 5', Rank: 5 }).recordId;
    const denied = 3;
    store.setGlobalField('Items::gLimit', 5);
    store.savePrivilegeSet({ name: 'ScrollReader', records: { view: true, edit: false, create: false, delete: false },
      tables: { Rows: { view: 'Rank < 90', edit: false, create: false, delete: false } },
      layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: ['fmapp'] } as never);
    store.setPassword('ScrollReader', 'pw', 'ScrollReader');
    store.schema.scripts.find((s) => s.name === 'Shrink')!.fullAccess = true;
    page = await window(browser);
    // Keep the display stale until the explicit refresh, without a live-update reload racing the assertion.
    await quietLive(page, 'ScrollRefresh');
    await signIn(page, fixture.url, 'ScrollRefresh', 'ScrollReader', 'pw');
    const rows = page.locator('[data-id="30"] .fm-portal-row[data-row]');
    const scroller = page.locator('[data-id="30"] .fm-portal-rows');
    const values = () => rows.evaluateAll((els) => els.map((row) => ({
      id: Number((row as HTMLElement).dataset.row), value: (row.querySelector('[data-id="31"] input') as HTMLInputElement)?.value,
    })));
    await until(values, (shown) => shown.length === 5 && shown.every((row) => row.value === `5:row ${row.id}`));
    // The related portal already caches every row, but requests only the visible three.
    const rowValue = (id: number) => page!.locator(`[data-id="30"] .fm-portal-row[data-row="${id}"] [data-id="31"] input`);
    assert.equal(await rowValue(1).inputValue(), '5:row 1');
    store.delete('Rows', deleted);
    store.update('Rows', denied, { Rank: 99 });
    store.update('Rows', visible, { Name: 'fresh visible' });
    store.update('Rows', 1, { Name: 'changed offscreen' });
    const request = page.waitForRequest((r) => r.url().includes('/button') && r.method() === 'POST');
    await click(page, 'Shrink');
    const requested = (await request).postDataJSON().displayPortals['1'].rows as number[];
    assert.ok(requested.includes(visible));
    assert.ok(requested.includes(deleted));
    assert.ok(requested.includes(denied));
    assert.equal(requested.includes(1), false, 'the last cached row was offscreen when refresh began');
    await until(values, (shown) => shown.length === 5 && shown.find((row) => row.id === visible)?.value === '1:fresh visible'
      && shown.find((row) => row.id === deleted)?.value === '' && shown.find((row) => row.id === denied)?.value === '');
    await scroller.evaluate((e) => { e.scrollTop = e.scrollHeight; });
    assert.ok(await scroller.evaluate((e) => e.scrollTop > 0));
    await until(() => Promise.all([rowValue(1).inputValue(), rowValue(2).inputValue()]),
      (values) => values[0] === '5:row 1' && values[1] === '5:row 2');
    await click(page, 'Shrink');
    await until(values, (shown) => shown.length === 5 && shown.find((row) => row.id === 1)?.value === '1:changed offscreen'
      && shown.find((row) => row.id === visible)?.value === '1:fresh visible');
    assert.deepEqual(page.errors, []);
  } finally {
    await page?.close();
    await fixture.close();
  }
});

test('field repetition refresh updates only its selected cell, preserving sibling cells', async () => {
  const page = await open();
  const cells = page.locator('[data-id="13"] input');
  assert.deepEqual(await cells.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), ['one', 'two', 'three']);
  await click(page, 'Repetition');
  await until(() => cells.nth(1).inputValue(), (v) => v === 'new two');
  assert.deepEqual(await cells.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), ['one', 'new two', 'three']);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('viewer A to B to Back to Forward, Reload versus Reset, and JavaScript execute in order', async () => {
  const page = await open();
  await click(page, 'URL');
  await until(() => viewer(page).locator('#page').textContent(), (v) => v === 'B');
  await click(page, 'Back');
  await until(() => viewer(page).locator('#page').textContent(), (v) => v === 'A');
  await click(page, 'Forward');
  await until(() => viewer(page).locator('#page').textContent(), (v) => v === 'B');
  const count = (await events(page)).filter((e) => e.fixture === 'load' && e.page === 'B').length;
  await click(page, 'Reload');
  await until(async () => (await events(page)).filter((e) => e.fixture === 'load' && e.page === 'B').length, (v) => v > count);
  assert.equal(await viewer(page).locator('#page').textContent(), 'B');
  await click(page, 'Reset');
  await until(() => viewer(page).locator('#page').textContent(), (v) => v === 'A');
  await click(page, 'Back');
  assert.equal(await viewer(page).locator('#page').textContent(), 'A');
  await click(page, 'Ordered');
  await until(() => viewer(page).locator('#call').textContent(), (v) => v === 'after');
  const ordered = (await events(page)).filter((e) => e.fixture === 'call').map((e) => e.value);
  assert.deepEqual(ordered, ['before', 'after']);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('refresh checkpoints precede subsequent navigation and whole-window refresh resumes Freeze Window', async () => {
  const page = await open();
  await click(page, 'Freeze');
  await until(() => field(page, 10).inputValue(), (v) => v === '7');
  assert.equal(await field(page, 11).inputValue(), '7');
  await click(page, 'Navigate');
  await until(() => page.locator('select.layout-menu').inputValue(), (v) => v === 'Rows');
  assert.equal(await page.locator('[data-id="20"]').count(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});


test('viewer history includes supported hash navigation and commands still work across a dialog checkpoint', async () => {
  const page = await open();
  // Same-document commands must retain the frame even without the optional DOM move API.
  await page.evaluate(() => Object.defineProperty(Element.prototype, 'moveBefore', { configurable: true, value: undefined }));
  await viewer(page).locator('#page').evaluate((e) => { (e as HTMLElement).dataset.retained = 'yes'; });
  const loads = (await events(page)).filter((e) => e.fixture === 'load').length;
  const position = () => viewer(page).locator('#page').evaluate((e) => ({ hash: e.ownerDocument.defaultView!.location.hash, scroll: e.ownerDocument.defaultView!.scrollY }));
  await viewer(page).getByRole('link', { name: 'one', exact: true }).click();
  await until(position, (v) => v.hash === '#one' && v.scroll > 500);
  const atAnchor = await position();
  await click(page, 'Back');
  await until(position, (v) => v.hash === '' && v.scroll === 0);
  await click(page, 'Forward');
  await until(position, (v) => v.hash === '#one' && v.scroll === atAnchor.scroll);
  assert.equal(await viewer(page).locator('#page').getAttribute('data-retained'), 'yes');
  assert.equal((await events(page)).filter((e) => e.fixture === 'load').length, loads);
  await viewer(page).locator('#page').evaluate((e) => { e.ownerDocument.defaultView!.location.hash = ''; });
  await until(position, (v) => v.hash === '');
  await click(page, 'Back');
  await until(position, (v) => v.hash === '#one');
  await click(page, 'Forward');
  await until(position, (v) => v.hash === '');
  assert.equal(await viewer(page).locator('#page').getAttribute('data-retained'), 'yes');
  assert.equal((await events(page)).filter((e) => e.fixture === 'load').length, loads);
  const dialog = page.waitForSelector('dialog[open]');
  const finished = click(page, 'Dialog');
  await dialog;
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await finished;
  assert.equal(await viewer(page).locator('#page').textContent(), 'A');
  assert.deepEqual(page.errors, []);
  await page.close();
});


test('find, sort and omit followed immediately by refresh or a viewer command adopt checkpoint record identities', async () => {
  for (const command of ['FindRefresh', 'SortRefresh', 'OmitRefresh', 'FindViewer']) {
    const page = await open();
    await until(() => viewer(page).locator('#page').textContent(), (v) => v === 'A');
    await click(page, command);
    const record = command === 'SortRefresh' ? '1' : '2';
    await until(() => page.locator(`.fm-part[data-record="${record}"]`).count(), (v) => v > 0);
    assert.equal(await page.locator(`.fm-part[data-record="${record === '1' ? '2' : '1'}"]`).count(), 0, command);
    assert.equal(await page.locator('[data-id="40"] [data-id="41"] input').first().inputValue(), 'second');
    assert.ok((await page.locator('[data-id="20"] iframe').getAttribute('data-viewer-key'))?.includes(`"${record}"`));
    assert.equal(await page.locator('.toolbar .found b').textContent(), command === 'SortRefresh' ? '2' : '1');
    assert.equal(await page.locator('.toolbar input.record-number').inputValue(), command === 'SortRefresh' ? '2' : '1');
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});

test('Refresh Object updates the noncurrent found-set portal row and preserves sibling values', async () => {
  const page = await open();
  const rows = page.locator('[data-id="40"] .fm-portal-row[data-row]');
  await until(() => rows.count(), (v) => v === 2);
  const names = await rows.locator('[data-id="41"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  await click(page, 'FoundChild');
  await until(() => rows.locator('[data-id="42"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), (v) => v.length === 2 && v.every((s) => s === '8'));
  assert.deepEqual(await rows.locator('[data-id="41"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), names);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a saved cached portal row retries after an unrelated Refresh Object discards its delayed refetch', async () => {
  const fixture = await host({ stores: ['SavedRefresh'] });
  let page: Awaited<ReturnType<typeof window>> | undefined;
  let release = () => {};
  try {
    const store = fixture.store('SavedRefresh');
    refreshFixture(store);
    for (let i = 3; i <= 60; i++) store.create('Items', { Id: i, Name: `item ${i}` });
    const design = store.design('Items')!;
    const name = design.objects.find((o) => o.id === 40)!.children!.find((o) => o.id === 41)!;
    store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...design.objects,
      { ...name, id: 15, name: 'editableName', bounds: { left: 20, top: 410, right: 190, bottom: 438 } },
    ] } }]);
    store.setPassword('Admin', 'pw');
    page = await window(browser);
    await quietLive(page, 'SavedRefresh');
    await signIn(page, fixture.url, 'SavedRefresh', 'Admin', 'pw');
    const number = page.locator('.toolbar input.record-number');
    await number.fill('60');
    await number.press('Enter');
    await until(() => field(page!, 15).inputValue(), (v) => v === 'item 60');
    const scroller = page.locator('[data-id="40"] .fm-portal-rows');
    await scroller.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
      e.dispatchEvent(new Event('scroll'));
    });
    const row = page.locator('[data-id="40"] .fm-portal-row[data-row="60"] [data-id="41"] input');
    await until(() => row.inputValue(), (v) => v === 'item 60');
    const top = await until(() => scroller.evaluate((e) => e.scrollTop), (v) => v > 0);
    let markCaptured!: () => void;
    const captured = new Promise<void>((resolve) => { markCaptured = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let refetches = 0;
    let markRetryFinished!: () => void;
    const retryFinished = new Promise<void>((resolve) => { markRetryFinished = resolve; });
    await page.route('**/foundset', async (route) => {
      const body = route.request().postDataJSON();
      if (body.portal !== 'found' || body.offset !== 60 || body.limit !== 1) return route.continue();
      refetches++;
      const response = await route.fetch();
      if (refetches === 1) { markCaptured(); await gate; }
      await route.fulfill({ response });
      if (refetches === 2) markRetryFinished();
    });
    await field(page, 15).fill('saved name');
    await field(page, 15).blur();
    await captured;
    // The current record overlays its saved values before the cached-row refetch returns.
    await until(() => row.inputValue(), (v) => v === 'saved name');
    await click(page, 'Object');
    // The button response can arrive before Refresh Object is applied in the
    // browser. Hold the refetch until its visible value proves that it was.
    await until(() => field(page!, 10).inputValue(), (v) => v === '2');
    await page.locator('[data-id="12"]').waitFor();
    // The row can be temporarily absent while Refresh Object redraws it. Wait for
    // the intercepted retry and its portal repaint instead of marking that row.
    const beforeRetry = await scroller.elementHandle();
    assert.ok(beforeRetry);
    release();
    await retryFinished;
    assert.equal(refetches, 2, 'the rejected cached-row refresh is automatically requeued');
    await page.waitForFunction((old) => document.querySelector('[data-id="40"] .fm-portal-rows') !== old, beforeRetry);
    await page.locator('.content[aria-busy="true"]').waitFor({ state: 'detached' });
    // A portal repaint can replace the navigator between Playwright's fill
    // and Enter calls. Dispatch the same change on one live input atomically.
    const beforeNavigation = await number.evaluateHandle((input) => {
      (input as HTMLInputElement).value = '1';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input;
    });
    await page.waitForFunction((old) => {
      const current = document.querySelector('.toolbar input.record-number') as HTMLInputElement | null;
      return current !== old && current?.value === '1';
    }, beforeNavigation);
    await until(() => field(page!, 15).inputValue(), (v) => v === 'first');
    await until(() => row.count(), (v) => v === 1).catch(async (e) => {
      const state = await page!.evaluate(() => ({
        number: (document.querySelector('.toolbar input.record-number') as HTMLInputElement | null)?.value,
        scroll: document.querySelector('[data-id="40"] .fm-portal-rows')?.scrollTop,
        rows: [...document.querySelectorAll('[data-id="40"] .fm-portal-row[data-row]')].map((r) => (r as HTMLElement).dataset.row),
      }));
      throw new Error(`${(e as Error).message}; state=${JSON.stringify(state)}`);
    });
    assert.equal(await row.inputValue(), 'saved name', 'the noncurrent row uses the refreshed cache');
    await until(() => scroller.evaluate((e) => e.scrollTop), (v) => v === top);
    assert.deepEqual(page.errors, []);
  } finally { release(); await page?.close(); await fixture.close(); }
});

test('Next Record preserves a delayed groups response and displays sub-summaries without another action', async () => {
  const fixture = await host({ stores: ['GroupRefresh'] });
  let page: Awaited<ReturnType<typeof window>> | undefined;
  let release = () => {};
  try {
    const store = fixture.store('GroupRefresh');
    store.applyDesign([{ op: 'createTable', name: 'Reports', fields: [{ name: 'Category' }, { name: 'Amount', type: 'number' }] }]);
    const design = store.design('Reports')!;
    const category = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Category')!;
    store.applyDesign([{ op: 'updateLayout', layout: 'Reports', design: { view: 'list', width: 500,
      parts: [
        { kind: 'sub-summary-leading', kindId: 3, top: 0, height: 30, style: {}, breakField: category.field },
        { kind: 'body', kindId: 4, top: 30, height: 40, style: {} },
      ],
      objects: [
        { ...category, id: 10, bounds: { left: 20, top: 2, right: 200, bottom: 28 } },
        { ...category, id: 11, bounds: { left: 20, top: 35, right: 200, bottom: 63 } },
      ],
    } }]);
    for (const Category of ['A', 'A', 'B']) store.create('Reports', { Category, Amount: 1 });
    store.setPassword('Admin', 'pw');
    page = await window(browser);
    let captured = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route('**/groups', async (route) => {
      requests++;
      const response = await route.fetch();
      if (requests === 1) { captured = true; await gate; }
      await route.fulfill({ response });
    });
    await signIn(page, fixture.url, 'GroupRefresh', 'Admin', 'pw');
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption('Category');
    await until(async () => captured, (v) => v);
    assert.equal(await page.locator('.fm-break').count(), 0);
    await page.getByRole('button', { name: 'Next record', exact: true }).click();
    await until(() => page!.locator('.toolbar input.record-number').inputValue(), (v) => v === '2');
    release();
    await until(() => page!.locator('.fm-break').count(), (v) => v === 2);
    assert.deepEqual(await page.locator('.fm-break [data-id="10"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), ['A', 'B']);
    assert.equal(requests, 1, 'ordinary record navigation retains still-valid grouping work');
    assert.deepEqual(page.errors, []);
  } finally { release(); await page?.close(); await fixture.close(); }
});


test('found-set portal refresh retains scroll and paging beyond row 1000', async () => {
  const store = hosted.store('Refresh');
  const ids: number[] = [];
  let page: Awaited<ReturnType<typeof open>> | undefined;
  try {
    for (let i = 3; i <= 1100; i++) ids.push(store.create('Items', { Id: i, Name: String(i) }).recordId);
    page = await open();
    const scroller = page.locator('[data-id="40"] .fm-portal-rows');
    await scroller.evaluate((e) => { e.scrollTop = 1050 * 41.5; });
    const row = page.locator('[data-id="40"] .fm-portal-row[data-row="1051"] [data-id="41"] input');
    await until(() => row.inputValue(), (v) => v === '1051');
    const top = await scroller.evaluate((e) => e.scrollTop);
    store.update('Items', 1051, { Name: 'fresh beyond 1000' });
    await click(page, 'Found');
    await until(() => row.inputValue(), (v) => v === 'fresh beyond 1000');
    assert.equal(await scroller.evaluate((e) => e.scrollTop), top);
    await scroller.evaluate((e) => { e.scrollTop = 1090 * 41.5; });
    await until(() => page!.locator('[data-id="40"] .fm-portal-row[data-row="1091"] [data-id="41"] input').inputValue(), (v) => v === '1091');
    assert.deepEqual(page.errors, []);
  } finally { await page?.close(); for (const id of ids) store.delete('Items', id); }
});

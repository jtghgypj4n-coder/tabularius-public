// Opens every layout of every sample file in the web client and fails on what a
// person would hit: a script error, a failed request, or a layout that draws
// nothing. It prints one line per layout (objects drawn, time to draw) so a slow
// or empty layout shows up in the run's output. A second pass opens each layout
// again and switches it to List and Table view (where the layout allows them),
// enters Find mode, performs an empty find and comes back to Browse mode, with
// the same checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { Locator, Page } from 'playwright-core';
import { FIXTURES, host, launch, signIn, skipUnless, until, window } from './harness.ts';

const skip = skipUnless();
const PASSWORD = 'sweep-secret-1';
const FILES = skip ? [] : readdirSync(FIXTURES).filter((f) => f.endsWith('.fmp12')).sort();
// Layouts that draw nothing by design, or answers a sample file gives that aren't a problem: kept here with the reason.
const KNOWN: { file: string; layout?: string; problem: RegExp; why: string }[] = [];

interface Row { layout: string; objects: number; ms: number; problems: string[]; note?: string }

/** Waits for the layout's drawing to settle (the count of objects holds still), and returns it. */
async function settled(page: Page): Promise<number> {
  let objects = -1;
  let still = 0;
  for (let i = 0; i < 100 && still < 4; i++) {
    await page.waitForTimeout(100);
    const n = await page.locator('.fm').count();
    still = n === objects ? still + 1 : 0;
    objects = n;
  }
  return objects;
}

/**
 * Waits for the layout menu to stop changing: a file's start-up script (OnFirstWindowOpen) can still be moving the window
 * to another layout when the first one is drawn, and the layouts listed (or the one chosen) would be gone a moment later.
 */
async function startedUp(page: Page): Promise<void> {
  let value = '';
  let still = 0;
  for (let i = 0; i < 300 && still < 10; i++) {
    await page.waitForTimeout(100);
    const now = await page.locator('select.layout-menu').inputValue().catch(() => '');
    still = now === value ? still + 1 : 0;
    value = now;
  }
}

/** Closes the card windows a solution opens of its own at start (a settings card, say): they stay in the page under the layout, and the mode and view buttons act on the front window, so a person closes them first. */
async function closeCards(page: Page): Promise<number> {
  let closed = 0;
  for (; closed < 5 && (await page.locator('button.window-close').count()); closed++) {
    // Through the button's own click handler: the card can sit over the toolbar.
    await page.locator('button.window-close').first().evaluate((el) => (el as HTMLElement).click());
    await settled(page);
  }
  return closed;
}

/** What a person can do on a layout besides look at it: List and Table view, Find mode with an empty find, and back. Returns what it did. */
async function exercise(page: Page): Promise<string[]> {
  const did: string[] = [];
  // Through the button's own click handler: a solution can leave a card window open over the toolbar, which a person would close first.
  const press = (target: Locator) => target.first().evaluate((el) => (el as HTMLElement).click());
  const step = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      const state = await page.evaluate(() => `modes ${[...document.querySelectorAll('.segmented.modes button')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join(',')}; tools ${[...document.querySelectorAll('button.tb')].map((b) => b.textContent?.trim()).join(',')}; windows ${document.querySelectorAll('button.window-close').length}`).catch(() => '');
      throw new Error(`${what}: ${(e as Error).message.split('\n')[0]} (${state})`);
    }
  };
  if (await closeCards(page)) did.push('closed a card window');
  for (const view of ['List', 'Table']) {
    const button = page.getByRole('button', { name: `View as ${view}`, exact: true });
    if (!(await button.count()) || !(await button.first().isEnabled())) continue;
    await step(`View as ${view}`, () => press(button));
    await settled(page);
    did.push(view);
  }
  const form = page.getByRole('button', { name: 'View as Form', exact: true });
  if (did.length && (await form.count()) && (await form.first().isEnabled())) {
    await step('View as Form', () => press(form));
    await settled(page);
  }
  // A solution can hide the toolbar, and the mode buttons with it.
  const mode = (name: string) => page.locator('.segmented.modes').getByRole('button', { name, exact: true });
  if (await mode('Find').count()) {
    await step('Find mode', () => press(mode('Find')));
    const perform = page.locator('button.tb', { hasText: 'Perform Find' }).first();
    await step('waiting for Perform Find', () => perform.waitFor({ state: 'attached' }));
    await step('Perform Find', () => press(perform));
    await settled(page);
    did.push('Find');
    if (await mode('Browse').count()) await step('Browse mode', () => press(mode('Browse')));
    await step('leaving Find mode', () => page.locator('button.tb', { hasText: 'Perform Find' }).first().waitFor({ state: 'detached' }));
    await settled(page);
  }
  return did;
}

async function sweep(page: Page & { errors: string[] }, layouts: string[], views = false): Promise<Row[]> {
  const rows: Row[] = [];
  const failed: string[] = [];
  await closeCards(page);
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('console', (m) => { if (m.type() === 'error') failed.push(`console: ${m.text().slice(0, 160)}`); });
  for (const layout of layouts) {
    failed.length = 0;
    page.errors.length = 0;
    const t0 = Date.now();
    // A layout the menu doesn't offer from here (the menu follows the current layout) can't be opened by a person from here.
    const offered = await page.locator('select.layout-menu option:not([disabled])').evaluateAll((os, name) => os.some((o) => (o as HTMLOptionElement).value === name), layout);
    if (!offered) {
      rows.push({ layout, objects: 0, ms: 0, problems: [], note: 'not in the menu from the previous layout' });
      continue;
    }
    // Mark what is drawn now: the new layout is on screen once none of it is left. (Choosing the layout already shown draws it
    // again over the same elements, so there the answer to its menus is all there is to wait for.)
    const again = (await page.locator('select.layout-menu').inputValue()) === layout;
    if (!again) await page.locator('.fm').evaluateAll((els) => els.forEach((e) => ((e as HTMLElement).dataset.old = '1')));
    // Every layout load asks for the layout's menus: that answer says the new layout is the one on screen.
    const loaded = page.waitForResponse((r) => r.url().includes(`/layouts/${encodeURIComponent(layout)}/menus`), { timeout: 60_000 })
      .then(() => true, () => false);
    // Through the menu's own change event: a solution can hide the toolbar, and its menu with it. The layout is chosen only
    // if the menu still offers it at that moment (a script can move the window and the menu with it between the check and here).
    const chosen = await page.locator('select.layout-menu').evaluate((el, name) => {
      (el as HTMLSelectElement).value = name;
      if ((el as HTMLSelectElement).value !== name) return false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, layout);
    if (!chosen) {
      rows.push({ layout, objects: 0, ms: 0, problems: [], note: 'left the menu before it was chosen' });
      continue;
    }
    if (!(await loaded)) failed.push('the layout did not open');
    await page.locator('.fm[data-old]').first().waitFor({ state: 'detached' }).catch(() => failed.push('the old layout was still drawn after the layout response'));
    const drawn = Date.now() - t0;
    // A layout is drawn in steps: wait for the object count to hold still.
    const objects = await settled(page);
    const ms = drawn;
    let note: string | undefined;
    if (views) {
      try {
        const did = await exercise(page);
        note = did.length ? did.join(', ') : 'only Form view in Browse mode';
      } catch (e) {
        failed.push(`${(e as Error).message.split('\n')[0].slice(0, 160)}`);
      }
    }
    rows.push({ layout, objects, ms, ...(note ? { note } : {}), problems: [...page.errors.map((e) => `script error: ${e.slice(0, 160)}`), ...failed] });
  }
  return rows;
}

for (const file of FILES) {
  test(`every layout of ${file} opens without errors`, { skip, timeout: 600_000 }, async (t) => {
    const hosted = await host({ fixtures: [file] });
    const browser = await launch();
    try {
      const name = file.replace(/\.fmp12$/i, '');
      // A file is hosted once it has been converted, which takes a while for the big ones.
      const store = await until(async () => hosted.store(name), Boolean, 180_000);
      // Sign in as a full access account of the file, with a password set here (the file's own are the owner's).
      const account = store.accounts().find((a) => a.privilegeSet === '[Full Access]' && !a.external && !a.inactive)?.name;
      if (!account) {
        t.skip(`${name} has no full access account to sign in with`);
        return;
      }
      store.setPassword(account, PASSWORD, '[Full Access]');
      const page = await window(await browser.newContext());
      await signIn(page, hosted.url, name, account, PASSWORD);
      await startedUp(page);
      const layouts = await page.locator('select.layout-menu option:not([disabled])').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      const rows = [...await sweep(page, layouts), ...(await sweep(page, layouts, true)).map((r) => ({ ...r, layout: `${r.layout} (views and Find)` }))];
      const bad = rows.flatMap((r) => r.problems.map((p) => ({ layout: r.layout, p })))
        .filter(({ layout, p }) => !KNOWN.some((k) => k.file === file && (!k.layout || k.layout === layout) && k.problem.test(p)));
      console.log(`${name}: ${rows.length} layouts\n` + rows.map((r) => `  ${r.layout.padEnd(40)} ${String(r.objects).padStart(5)} objects ${String(r.ms).padStart(6)} ms${r.note ? '  (' + r.note + ')' : ''}${r.problems.length ? '  !! ' + r.problems.join('; ') : ''}`).join('\n'));
      assert.deepEqual(bad, [], `${name}: problems while opening layouts`);
    } finally {
      await browser.close();
      // The page's last requests (OnLastWindowClose and the like) are still on their way when the browser goes.
      await new Promise((r) => setTimeout(r, 500));
      await hosted.close();
    }
  });
}

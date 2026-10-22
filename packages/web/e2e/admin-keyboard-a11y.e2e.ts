// Admin tables and the passphrase dialog remain understandable and operable
// when the page is used with a keyboard alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { host, launch, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['People'] });
  hosted.store('People').applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }, { name: 'Email' }] },
    { op: 'createScript', name: 'Synthetic audit script', text: 'Exit Script [ Text Result: 1 ]' },
  ] as never);
  const schedule = await fetch(`${hosted.url}/tabularius/admin/v1/schedules`, {
    method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Synthetic accessibility schedule', database: 'People', script: 'Synthetic audit script', account: 'Admin', everyMinutes: 1440, at: '02:00', enabled: false }),
  });
  assert.equal(schedule.status, 201);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('every admin table has a name and scoped column headers', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await page.locator('#clients').waitFor();
  await page.getByRole('button', { name: /Run now: Synthetic accessibility schedule/ }).waitFor();
  const tables = await page.locator('main table').evaluateAll((items) => items.map((table) => ({
    name: table.querySelector('caption')?.textContent?.trim() || table.getAttribute('aria-label') || table.getAttribute('aria-labelledby'),
    headers: [...table.querySelectorAll('thead th')].map((th) => th.getAttribute('scope')),
    id: table.id,
  })));
  assert.ok(tables.length > 0, 'the synthetic admin page should render tables');
  assert.deepEqual(tables.filter((table) => !table.name).map((table) => table.id || '(unnamed table)'), []);
  assert.deepEqual(tables.flatMap((table) => table.headers.filter((scope) => scope !== 'col').map(() => table.id || '(header without scope)')), []);
  assert.match(await page.getByRole('button', { name: /Run now: Synthetic accessibility schedule/ }).getAttribute('aria-label') ?? '', /Run now/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('focusable controls follow visual order inside each admin section', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await page.locator('#clients').waitFor();
  const mismatches = await page.evaluate(() => {
    const selector = 'a[href], button:not([disabled]), input:not([disabled],[type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    const issues: string[] = [];
    for (const section of document.querySelectorAll<HTMLElement>('main section')) {
      section.hidden = false;
      const stops = [...section.querySelectorAll<HTMLElement>(selector)].filter((el) => {
        const style = getComputedStyle(el);
        return el.getClientRects().length > 0 && style.visibility !== 'hidden' && Number(el.getAttribute('tabindex') ?? 0) >= 0;
      });
      const visual = stops.slice().sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const rowA = a.closest('tr, .controls, .filters, #pick, form.add, form.controls, .actions, p');
        const rowB = b.closest('tr, .controls, .filters, #pick, form.add, form.controls, .actions, p');
        if (rowA && rowA === rowB && (rowA.tagName === 'TR' || Math.abs(ar.top - br.top) <= 18)) return Math.round(ar.left) - Math.round(br.left);
        return Math.round(ar.top) - Math.round(br.top) || Math.round(ar.left) - Math.round(br.left);
      });
      if (stops.some((el, index) => el !== visual[index])) {
        const describe = (el: HTMLElement) => `${el.tagName.toLowerCase()}#${el.id || ''}.${[...el.classList].join('.')} ${el.getAttribute('aria-label') || el.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 32)} @${Math.round(el.getBoundingClientRect().left)},${Math.round(el.getBoundingClientRect().top)}`;
        issues.push(`#${section.id}: tab ${stops.map(describe).join(' | ')}; visual ${visual.map(describe).join(' | ')}`);
      }
    }
    return issues;
  });
  assert.deepEqual(mismatches, []);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('buttons and links in every section respond to Enter without a pointer', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await page.locator('#clients').waitFor();
  const controls = await page.evaluate(() => {
    (window as any).__keyboardActivations = [];
    document.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      (window as any).__keyboardActivations.push((event.target as HTMLElement).closest('button,a')?.getAttribute('data-keyboard-check'));
    }, true);
    const found: string[] = [];
    for (const section of document.querySelectorAll<HTMLElement>('main section')) {
      section.hidden = false;
      for (const element of section.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')) {
        if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
        const key = `key-${found.length}`;
        element.dataset.keyboardCheck = key;
        found.push(key);
      }
    }
    return found;
  });
  assert.ok(controls.length > 0);
  const missed: string[] = [];
  for (const key of controls) {
    const control = page.locator(`[data-keyboard-check="${key}"]`);
    await control.focus();
    const before = await page.evaluate(() => (window as any).__keyboardActivations.length);
    await page.keyboard.press('Enter');
    const after = await page.evaluate(() => (window as any).__keyboardActivations.length);
    if (after !== before + 1) missed.push(key);
  }
  assert.deepEqual(missed, []);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the passphrase dialog takes focus, traps Tab, and Escape returns focus to its opener', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await page.locator('#clients').waitFor();
  await page.evaluate(() => {
    const opener = document.createElement('button');
    opener.id = 'a11y-passphrase-opener';
    opener.textContent = 'Open passphrase dialog';
    document.querySelector('main')!.prepend(opener);
    opener.focus();
    void (window as any).askPassphrase('Synthetic file', '', undefined);
  });
  const dialog = page.getByRole('dialog', { name: 'Synthetic file' });
  await dialog.waitFor();
  assert.equal(await dialog.locator(':focus').count(), 1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement) || document.activeElement === el), true,
    `Shift+Tab must stay in the modal dialog (focus: ${await page.evaluate(() => (document.activeElement as HTMLElement)?.outerHTML)})`);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement) || document.activeElement === el), true,
    'Tab must stay in the modal dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'a11y-passphrase-opener');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('copy actions announce one result without changing the focused button name', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await page.locator('#clients').waitFor();
  const outcomes = await page.evaluate(async () => {
    const button = document.createElement('button');
    button.textContent = 'Copy';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    document.body.append(button, status);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
    button.focus();
    await (window as any).copyToClipboard(button, 'synthetic value', status);
    const copied = { text: status.textContent, button: button.textContent, focus: document.activeElement === button };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    await (window as any).copyToClipboard(button, 'synthetic value', status);
    const failed = { text: status.textContent, button: button.textContent, focus: document.activeElement === button };
    button.remove();
    status.remove();
    return { copied, failed };
  });
  assert.deepEqual(outcomes, {
    copied: { text: 'Copied.', button: 'Copy', focus: true },
    failed: { text: 'Copy failed. Select and copy the text manually.', button: 'Copy', focus: true },
  });
  assert.deepEqual(page.errors, []);
  await page.close();
});

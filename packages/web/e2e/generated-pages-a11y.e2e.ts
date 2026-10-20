// axe-core (WCAG 2.0/2.1/2.2 A and AA) on the pages "Modernize interfaces" and the layout templates generate:
// the list, the record form, the list with the form beside it, the cards view, the board and the calendar, the dashboards and the landing
// page. Each is plain HTML a person gets without writing any, so it has to pass before they touch it. The list
// pages are drawn with made-up records (previewPage), in light and dark; the dashboards and the landing page as
// they open where no data is behind them. No .fmp12 and no server needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import { interfacePage, MODES, planInterface, previewPage, samplesOf, type Mode } from '../src/modernize.ts';
import { dashboardPage, FLAVOURS, homePage, planDashboard } from '../src/page-templates.ts';
import type { DesignTable } from '../src/design/client.ts';
import { axeViolations, launch, skipUnless } from './harness.ts';

const skip = skipUnless();
let browser: Browser;
before(async () => {
  if (!skip) browser = await launch();
});
after(async () => {
  await browser?.close();
});

const field = (id: number, name: string, type: DesignTable['fields'][number]['type']) => ({ id, name, kind: 'normal' as const, type });
const table: DesignTable = {
  id: 1, name: 'Orders', records: 40,
  fields: [field(1, 'OrderID', 'number'), field(2, 'Customer', 'text'), field(3, 'Status', 'text'), field(4, 'Total', 'number'), field(5, 'Placed', 'date'), field(6, 'Notes', 'text'), field(7, 'Photo', 'container')],
} as DesignTable;
const modern = { name: table.name, records: table.records, fields: table.fields.map((f) => ({ name: f.name, type: f.type, kind: f.kind })) };

async function audit(html: string, scheme: 'light' | 'dark', width = 1280): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  try {
    const page: Page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(html, { waitUntil: 'load' });
    // The sample records are drawn after load.
    await page.waitForTimeout(300);
    assert.deepEqual(errors, []);
    return await axeViolations(page);
  } finally {
    await context.close();
  }
}

for (const scheme of ['light', 'dark'] as const) {
  for (const { mode } of MODES) {
    test(`generated ${mode} page passes axe (${scheme})`, { skip }, async () => {
      const plan = planInterface(modern);
      const html = previewPage(interfacePage('Orders list', plan, mode as Mode), samplesOf('Orders list', plan));
      assert.deepEqual(await audit(html, scheme), []);
    });
  }
  test(`generated list page with its cards view open passes axe (${scheme})`, { skip }, async () => {
    const plan = planInterface(modern);
    const html = previewPage(interfacePage('Orders list', plan, 'split'), samplesOf('Orders list', plan));
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.locator('#v-cards').click();
      await page.waitForTimeout(300);
      assert.deepEqual(await axeViolations(page), []);
    } finally {
      await context.close();
    }
  });
  for (const view of ['board', 'calendar'] as const) {
    test(`generated ${view} page passes axe (${scheme})`, { skip }, async () => {
      const plan = planInterface(modern);
      assert.ok(plan[view], `the sample table backs a ${view}`);
      const html = previewPage(interfacePage('Orders list', plan, 'list', view), samplesOf('Orders list', plan));
      assert.deepEqual(await audit(html, scheme), []);
    });
  }
  test(`generated dashboards and landing page pass axe (${scheme})`, { skip }, async () => {
    const found: string[] = [];
    for (const [flavour] of FLAVOURS) {
      const html = dashboardPage('Orders dashboard', 'Orders', planDashboard(table, flavour));
      for (const v of await audit(html, scheme)) found.push(`dashboard ${flavour}: ${v}`);
    }
    for (const v of await audit(homePage('Home', 'Sales'), scheme)) found.push(`home: ${v}`);
    assert.deepEqual(found, []);
  });
}

// The page's colour comes from the table's name, so the greens and yellows (the hardest for contrast) are tried too.
for (const name of ['Items', 'Pets', 'Stock', 'Contacts', 'Projects']) {
  test(`generated pages for a table called ${name} pass axe in light and dark`, { skip }, async () => {
    const found: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      for (const [mode, view] of [['list', 'table'], ['detail', 'table'], ['list', 'board'], ['list', 'calendar']] as const) {
        const plan = planInterface({ ...modern, name });
        for (const v of await audit(previewPage(interfacePage(`${name} list`, plan, mode, view), samplesOf(`${name} list`, plan)), scheme)) found.push(`${mode} ${view} ${scheme}: ${v}`);
      }
    }
    assert.deepEqual(found, []);
  });
}

test('generated board and calendar pages on a phone pass axe', { skip }, async () => {
  const plan = planInterface(modern);
  for (const view of ['board', 'calendar'] as const) assert.deepEqual(await audit(previewPage(interfacePage('Orders list', plan, 'list', view), samplesOf('Orders list', plan)), 'light', 390), [], view);
});

test('generated list page on a phone passes axe', { skip }, async () => {
  const plan = planInterface(modern);
  assert.deepEqual(await audit(previewPage(interfacePage('Orders list', plan, 'split'), samplesOf('Orders list', plan)), 'light', 390), []);
});

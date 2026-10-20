// State markers must survive high contrast without depending on backgrounds or shadows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Browser, Locator } from 'playwright-core';
import { launch, skipUnless } from './harness.ts';

const skip = skipUnless();
let browser: Browser;
before(async () => {
  if (!skip) browser = await launch();
});
after(async () => {
  await browser?.close();
});

const css = ['tokens.css', 'app.css', 'design.css'].map((name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')).join('\n');
const cases = [
  ['toolbar', '<div class="toolbar"><div class="layout-bar"><div class="segmented">', '</div></div></div>', '<button aria-pressed="true">Form</button><button aria-pressed="false">List</button>'],
  ['mode switch', '<div class="window-bar finding"><div class="modes">', '</div></div>', '<button aria-pressed="true">Find</button><button aria-pressed="false">Browse</button>'],
  ['toolbar toggle', '<div class="window-bar">', '</div>', '<button class="quiet toolbar-toggle" aria-pressed="true">Show toolbar</button><button class="quiet toolbar-toggle" aria-pressed="false">Hide toolbar</button>'],
  ['tabs', '<div class="d-tabs" role="tablist">', '</div>', '<button role="tab" aria-selected="true">Tables</button><button role="tab" aria-selected="false">Fields</button>'],
  ['selected list option', '<ul class="quick-open-list" role="listbox">', '</ul>', '<li role="option" aria-selected="true">First</li><li role="option" aria-selected="false">Second</li>'],
  ['current link', '<nav>', '</nav>', '<a href="#first" aria-current="page">First</a><a href="#second" aria-current="false">Second</a>'],
  ['current list option', '<ul class="quick-open-list">', '</ul>', '<li class="current">First</li><li>Second</li>'],
  ['current table row', '<table class="table-view"><tbody>', '</tbody></table>', '<tr class="fm-current"><td>First</td></tr><tr><td>Second</td></tr>'],
  ['current portal row', '<div>', '</div>', '<div class="fm-portal-row fm-portal-current">First</div><div class="fm-portal-row">Second</div>'],
  ['current record', '<div class="view-list"><div class="list">', '</div></div>', '<div class="fm-part-body fm-current">First</div><div class="fm-part-body">Second</div>'],
] as const;

async function border(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).borderTop);
}

for (const [name, start, end, controls] of cases) {
  test(`forced colors distinguishes the ${name} state`, { skip }, async () => {
    const context = await browser.newContext({ forcedColors: 'active', reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      await page.setContent(start + controls + end);
      await page.addStyleTag({ content: css });
      assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
      const active = page.getByText(/^(Form|Find|Show toolbar|Tables|First)$/);
      const inactive = page.getByText(/^(List|Browse|Hide toolbar|Fields|Second)$/);
      const marker = await border(active);
      assert.match(marker, /^2px solid /, 'the active state has a solid border');
      assert.notEqual(marker, await border(inactive), 'active and inactive states differ without focus');
      await page.emulateMedia({ forcedColors: 'none' });
      assert.notEqual(await border(active), marker, 'normal colors use the component styles');
    } finally {
      await context.close();
    }
  });
}

test('forced colors keeps keyboard focus and ignores false or empty current states', { skip }, async () => {
  const context = await browser.newContext({ forcedColors: 'active', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.setContent('<div class="toolbar"><div class="segmented"><button aria-pressed="true">Form</button><button aria-pressed="false">List</button></div></div><a href="#" aria-current="false">False</a><a href="#" aria-current="">Empty</a><a href="#">Unset</a>');
    await page.addStyleTag({ content: css });
    await page.keyboard.press('Tab');
    const pressed = page.getByRole('button', { name: 'Form' });
    assert.equal(await pressed.evaluate((el) => el.matches(':focus-visible')), true);
    assert.equal(await pressed.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
    assert.equal(await pressed.evaluate((el) => getComputedStyle(el).outlineWidth), '2px');
    assert.notEqual(await border(pressed), await border(page.getByRole('button', { name: 'List' })));
    const unset = await border(page.getByRole('link', { name: 'Unset' }));
    for (const name of ['False', 'Empty']) assert.equal(await border(page.getByRole('link', { name })), unset);
  } finally {
    await context.close();
  }
});

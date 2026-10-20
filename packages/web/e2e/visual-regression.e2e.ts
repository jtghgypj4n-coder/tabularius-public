// Cropped viewport baselines for the client and admin console. The solution is
// created from a fixed seed below; the browser clock, viewport, color scheme,
// motion and font readiness are pinned before every capture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
// Each kind of computer draws text its own way (anti-aliasing, hinting), so each has its own set; a computer with none fails and
// says how to make one. The sets are made on the computers that run the check, never copied across.
const BASELINES = join(import.meta.dirname, '..', 'test', 'visual-regression', process.platform);
const FONTS = join(import.meta.dirname, '..', '..', 'scripts', 'fonts');
const FIXED_TIME = 1_798_675_200_000; // 2027-01-01T00:00:00.000Z
const CHANNEL_TOLERANCE = 8;
const AREA_THRESHOLD = 0.015;
const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];
const THEMES = ['light', 'dark'] as const;
const PASSWORD = 'visual-seed-pass-1';

let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Visual'] });
  const store = hosted.store('Visual');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [
    { name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'City' }, { name: 'Role' },
  ] }] as DesignOp[]);
  for (const [Id, Name, City, Role] of [
    [1, 'Ada Lovelace', 'London', 'Engineer'], [2, 'Grace Hopper', 'New York', 'Admiral'],
    [3, 'Edsger Dijkstra', 'Nuenen', 'Researcher'], [4, 'Barbara Liskov', 'Boston', 'Professor'],
  ] as [number, string, string, string][]) store.create('People', { Id, Name, City, Role });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await hosted?.close();
});

type ImageMetrics = { width: number; height: number; changed: number; total: number; diff: string };

async function compare(page: Page, baseline: Buffer, current: Buffer): Promise<ImageMetrics> {
  return page.evaluate(async ({ before, after, tolerance }) => {
    const decode = async (url: string) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height) };
    };
    const [a, b] = await Promise.all([decode(`data:image/png;base64,${before}`), decode(`data:image/png;base64,${after}`)]);
    if (a.canvas.width !== b.canvas.width || a.canvas.height !== b.canvas.height) {
      return { width: b.canvas.width, height: b.canvas.height, changed: Math.max(a.canvas.width * a.canvas.height, b.canvas.width * b.canvas.height), total: Math.max(a.canvas.width * a.canvas.height, b.canvas.width * b.canvas.height), diff: b.canvas.toDataURL('image/png') };
    }
    const out = b.canvas.getContext('2d')!;
    const image = out.createImageData(b.canvas.width, b.canvas.height);
    let changed = 0;
    for (let i = 0; i < b.pixels.data.length; i += 4) {
      const delta = Math.max(Math.abs(a.pixels.data[i] - b.pixels.data[i]), Math.abs(a.pixels.data[i + 1] - b.pixels.data[i + 1]), Math.abs(a.pixels.data[i + 2] - b.pixels.data[i + 2]), Math.abs(a.pixels.data[i + 3] - b.pixels.data[i + 3]));
      if (delta > tolerance) {
        changed++;
        image.data[i] = 255; image.data[i + 1] = 0; image.data[i + 2] = 180; image.data[i + 3] = 220;
      } else {
        image.data[i] = b.pixels.data[i]; image.data[i + 1] = b.pixels.data[i + 1]; image.data[i + 2] = b.pixels.data[i + 2]; image.data[i + 3] = 110;
      }
    }
    out.putImageData(image, 0, 0);
    return { width: b.canvas.width, height: b.canvas.height, changed, total: b.canvas.width * b.canvas.height, diff: b.canvas.toDataURL('image/png') };
  }, { before: baseline.toString('base64'), after: current.toString('base64'), tolerance: CHANNEL_TOLERANCE });
}

function pngFromDataUrl(url: string): Buffer {
  const data = url.slice(url.indexOf(',') + 1);
  return Buffer.from(data, 'base64');
}

async function ready(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => { globalThis.window.scrollTo(0, 0); document.activeElement instanceof HTMLElement && document.activeElement.blur(); });
}

// The fonts come from the repository, not from the computer: the page's own stack (-apple-system, Roboto, ...) is whatever the
// computer has, and it differs between computers and between versions of one.
let fontCss: string | undefined;
function pinnedFonts(): string {
  if (fontCss) return fontCss;
  // Served from the page's own address (see openContext): the pages' security policy allows fonts from there and nowhere else.
  const face = (family: string, file: string, weight: number, style: string) =>
    `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};src:url(/__visual-fonts/${file}) format('truetype')}`;
  return fontCss = [
    face('Visual Sans', 'Arimo-Regular.ttf', 400, 'normal'), face('Visual Sans', 'Arimo-Bold.ttf', 700, 'normal'),
    face('Visual Sans', 'Arimo-Italic.ttf', 400, 'italic'), face('Visual Sans', 'Arimo-BoldItalic.ttf', 700, 'italic'),
    face('Visual Mono', 'Cousine-Regular.ttf', 400, 'normal'), face('Visual Mono', 'Cousine-Bold.ttf', 700, 'normal'),
    ":root{--sans:'Visual Sans',sans-serif!important;--mono:'Visual Mono',monospace!important}",
    "*,*::before,*::after{font-family:'Visual Sans',sans-serif!important}",
    "code,pre,kbd,samp,.mono,[class*='mono'],.d-code{font-family:'Visual Mono',monospace!important}",
  ].join('\n');
}
const STILL = '*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important;scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}';

async function capture(page: Page, file: string, admin = false): Promise<Buffer> {
  await page.addStyleTag({ content: `${STILL}\n${pinnedFonts()}` });
  await ready(page);
  if (admin) await stabilizeAdminText(page);
  const shot = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', fullPage: false });
  assert.ok(shot.byteLength <= MAX_IMAGE_BYTES, `${file} is ${shot.byteLength} bytes; screenshot budget is ${MAX_IMAGE_BYTES}`);
  return shot;
}

async function captureSection(page: Page, selector: string, file: string, admin = false): Promise<Buffer> {
  await page.addStyleTag({ content: `${STILL}header{position:static!important}\n${pinnedFonts()}` });
  await ready(page);
  if (admin) await stabilizeAdminText(page);
  const shot = await page.locator(selector).screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
  assert.ok(shot.byteLength <= MAX_IMAGE_BYTES, `${file} is ${shot.byteLength} bytes; screenshot budget is ${MAX_IMAGE_BYTES}`);
  return shot;
}

async function stabilizeAdminText(page: Page): Promise<void> {
  const folder = hosted.dir;
  await page.evaluate((tempFolder) => {
    document.body.innerHTML = document.body.innerHTML
      .replaceAll(tempFolder, '/visual/seed')
      .replace(/\/(?:private\/)?(?:var|Users|tmp)\/[^\s<>"']+/g, '/visual/seed')
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, '01/01/2027, 12:00 AM');
  }, folder);
  assert.ok(!(await page.locator('body').innerText()).includes(folder), 'admin screenshot text must not include the temporary machine path');
}

async function openContext(theme: 'light' | 'dark', viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page & { errors: string[] } }> {
  const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  await context.route('**/__visual-fonts/*', (route) => route.fulfill({ path: join(FONTS, basename(new URL(route.request().url()).pathname)), contentType: 'font/ttf' }));
  await context.addInitScript((time) => {
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof Date>) { super(...(args.length ? args : [time] as [number])); }
      static now() { return time; }
    }
    Object.defineProperty(globalThis, 'Date', { value: FixedDate });
  }, FIXED_TIME);
  const page = await window(context);
  page.setDefaultTimeout(15_000);
  await page.route('**/tabularius/live/v1/databases/Visual/viewers', (route) => route.fulfill({ json: { viewers: [] } }));
  await page.route('**/tabularius/live/v1/databases/Visual/layouts/*/records/*/view', (route) => route.fulfill({ json: {} }));
  return { context, page };
}

test('client and console core screens match reviewed visual baselines', { skip }, async () => {
  const update = process.env.TABULARIUS_VISUAL_UPDATE === '1';
  const images = new Map<string, Buffer>();
  const errors: string[] = [];

  for (const viewport of VIEWPORTS) for (const theme of THEMES) {
    process.stdout.write(`Capturing ${theme} ${viewport.width}×${viewport.height}…\n`);
    const { context, page } = await openContext(theme, viewport);
    const key = (screen: string) => `${screen}-${theme}-${viewport.width}.png`;
    try {
      await page.goto(hosted.url + '/app/');
      images.set(key('sign-in'), await capture(page, key('sign-in')));

      await signIn(page, hosted.url, 'Visual', 'Ann', PASSWORD);
      await page.getByRole('button', { name: 'View as List' }).click();
      await until(() => page.locator('.fm-part').count(), (n) => n > 0);
      images.set(key('list'), await capture(page, key('list')));

      await page.getByRole('button', { name: 'View as Form' }).click();
      await until(() => field(page, 3).inputValue(), (v) => v === '1');
      images.set(key('form'), await capture(page, key('form')));

      await page.getByRole('button', { name: 'View as Table' }).click();
      await until(() => page.locator('table.table-view tbody tr').count(), (n) => n >= 4);
      images.set(key('table'), await capture(page, key('table')));

      await page.locator('button.tb', { hasText: 'Find' }).first().click();
      await page.locator('button.tb', { hasText: 'Perform Find' }).first().waitFor();
      images.set(key('find'), await capture(page, key('find')));

      await page.locator('button.tb', { hasText: 'Cancel Find' }).first().click();
      await page.getByRole('button', { name: 'View as Form' }).click();
      await until(() => field(page, 3).inputValue(), (v) => v === '1');
      await page.locator('button[title^="The found set as printed pages"]').click();
      await page.locator('.preview-sheet').first().waitFor();
      images.set(key('preview'), await capture(page, key('preview')));

      const modeGroup = page.getByRole('group', { name: 'Mode' });
      if (await modeGroup.isVisible()) await modeGroup.getByRole('button', { name: 'Layout' }).click();
      else {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.locator('.menubar').getByRole('button', { name: 'View', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Layout Mode' }).click();
      }
      await page.locator('.le-obj').first().waitFor();
      images.set(key('layout-mode'), await capture(page, key('layout-mode')));

      // Return to Browse, then capture the management surface.
      await page.getByRole('button', { name: 'Exit Layout' }).click();
      await page.locator('select.layout-menu').waitFor();
      if (viewport.width <= 390) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
      await page.getByRole('menuitem', { name: 'Database…' }).click();
      await page.getByRole('tab', { name: 'Tables & fields' }).waitFor();
      images.set(key('manage-database'), await capture(page, key('manage-database')));

      // A confirmation dialog is part of the client UI, not a browser-native prompt.
      await page.getByRole('link', { name: 'Back to browse' }).click();
      await page.locator('select.layout-menu').waitFor();
      const deleteToolbar = page.locator('button.tb', { hasText: 'Delete Record' }).first();
      if (await deleteToolbar.isVisible()) await deleteToolbar.click();
      else {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.locator('.menubar').getByRole('button', { name: 'Records', exact: true }).click();
        await page.getByRole('menuitem', { name: /Delete Record/ }).click();
      }
      await page.getByRole('dialog', { name: 'Delete Record' }).waitFor();
      images.set(key('dialogs'), await capture(page, key('dialogs')));
      await answer(page, 'Delete Record', 'Cancel');
      const logout = page.getByRole('button', { name: 'Log Out', exact: true });
      if (await logout.isVisible()) await logout.click();
      else {
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Log Out' }).click();
      }
      await page.locator('select[name="db"]').waitFor();

      await page.goto(hosted.url + '/admin/');
      await until(() => page.locator('#clients').innerText(), (t) => /Nobody is connected\./.test(t));
      images.set(key('admin-dashboard'), await capture(page, key('admin-dashboard'), true));
      await page.goto(hosted.url + '/admin/#backups');
      await until(() => page.locator('#sets').innerText(), (t) => /No backups yet\./.test(t));
      images.set(key('backups'), await captureSection(page, '#backups', key('backups'), true));
      await page.goto(hosted.url + '/admin/#audit-section');
      await page.locator('#audit-db option').first().waitFor({ state: 'attached' });
      await page.locator('#audit-refresh').click();
      await page.locator('#audit thead').waitFor({ state: 'attached' });
      await page.addStyleTag({ content: '#audit tbody{display:none!important}' });
      images.set(key('audit-log'), await captureSection(page, '#audit-section', key('audit-log'), true));
      assert.deepEqual(page.errors, [], `browser errors in ${theme} ${viewport.width}px`);
    } catch (error) {
      errors.push(`${theme} ${viewport.width}px: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    } finally {
      await context.close();
    }
  }

  if (errors.length) assert.fail(errors.join('\n'));
  assert.equal(images.size, 72, `captured ${images.size} of 72 expected screen variants`);
  const totalBytes = [...images.values()].reduce((sum, image) => sum + image.byteLength, 0);
  assert.ok(totalBytes <= MAX_TOTAL_BYTES, `baseline set would be ${totalBytes} bytes; budget is ${MAX_TOTAL_BYTES}`);

  if (!update && !existsSync(BASELINES)) assert.fail(`no visual baselines for ${process.platform} (${BASELINES}); make them on this computer with npm run test:visual -- --update`);
  mkdirSync(BASELINES, { recursive: true });
  const previousFiles = existsSync(BASELINES) ? readdirSync(BASELINES).filter((file) => file.endsWith('.png')) : [];
  const changes: string[] = [];
  let diffDir: string | undefined;
  const comparePage = await browser.newPage();
  for (const [name, current] of [...images].sort(([a], [b]) => a.localeCompare(b))) {
    const path = join(BASELINES, name);
    if (!existsSync(path)) {
      changes.push(`added   ${name} (${current.byteLength} bytes)`);
      if (update) writeFileSync(path, current);
      else errors.push(`missing baseline: ${name}; run npm run test:visual -- --update`);
      continue;
    }
    const baseline = readFileSync(path);
    const metrics = await compare(comparePage, baseline, current);
    const fraction = metrics.total ? metrics.changed / metrics.total : 1;
    if (fraction > AREA_THRESHOLD) {
      changes.push(`changed ${name} (${(fraction * 100).toFixed(3)}% pixels; ${baseline.byteLength} -> ${current.byteLength} bytes)`);
      if (update) writeFileSync(path, current);
      else {
        diffDir ??= mkdtempSync(join(tmpdir(), 'tabularius-visual-diffs-'));
        writeFileSync(join(diffDir, name), pngFromDataUrl(metrics.diff));
        writeFileSync(join(diffDir, `${name}.actual.png`), current);
        errors.push(`${name}: ${metrics.changed}/${metrics.total} pixels differ; diff in ${diffDir}`);
      }
    } else changes.push(`same    ${name}`);
  }
  await comparePage.close();
  const currentFiles = new Set(images.keys());
  const removed = previousFiles.filter((file) => !currentFiles.has(file)).sort();
  for (const file of removed) changes.push(`removed ${file}`);
  if (update) {
    for (const file of removed) rmSync(join(BASELINES, file), { force: true });
    writeFileSync(join(BASELINES, 'manifest.json'), JSON.stringify({
      pixelChannelTolerance: CHANNEL_TOLERANCE,
      differingPixelAreaThreshold: AREA_THRESHOLD,
      screens: [...images.keys()].sort(),
      totalBytes,
    }, null, 2) + '\n');
    console.log(`Visual baseline change list (${changes.length} files):\n${changes.join('\n')}`);
    console.log(`Wrote ${images.size} PNGs (${totalBytes} bytes total) to ${BASELINES}`);
  } else if (errors.length) {
    assert.fail(`${errors.join('\n')}\nVisual change list:\n${changes.filter((line) => !line.startsWith('same ')).join('\n')}`);
  } else console.log(`Visual check passed: ${images.size} screen variants, ${totalBytes} baseline bytes.`);
});

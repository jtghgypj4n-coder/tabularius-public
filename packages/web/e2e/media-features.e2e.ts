// The pages under the user's own settings: a dark scheme, forced colors (Windows high contrast), more contrast,
// reduced motion and paper. For each, the admin console, the web client and its stand-alone pages are opened in a
// real Chromium with the media feature emulated, and the computed styles of what is on screen are checked:
// text against its real background (4.5:1, from the colors the browser resolved, not from the tokens), a focus
// indicator on every Tab stop, no transition or animation that runs, and ink on white on paper. The page
// states and the layout canvas (drawn from the file, white in the dark scheme) are the file's, not checked here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { docsHtml } from '../../server/src/docs.ts';
import { dashboardPage, homePage, planDashboard } from '../src/page-templates.ts';
import type { DesignTable } from '../src/design/client.ts';
import { host, launch, signIn, skipUnless, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Contacts'] });
  const store = hosted.store('Contacts');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Email' }, { name: 'Age', type: 'number' }] }] as never);
  for (const [Name, Email, Age] of [['Ada Lovelace', 'ada@example.org', 36], ['Alan Turing', 'alan@example.org', 41]]) store.create('People', { Name, Email, Age });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

type Feature = 'dark' | 'forced' | 'contrast' | 'motion' | 'print' | 'print-dark';
const options: Record<Feature, Parameters<Browser['newContext']>[0]> = {
  dark: { colorScheme: 'dark' },
  forced: { forcedColors: 'active' },
  contrast: { contrast: 'more' },
  motion: { reducedMotion: 'reduce' },
  print: {},
  'print-dark': { colorScheme: 'dark' },
};

/** Every page of the web client and the admin console that a person opens, as [name, how to get there]. */
const pages: [string, (page: Page) => Promise<void>][] = [
  ['admin console', async (p) => { await p.goto(hosted.url + '/admin/'); await p.locator('nav.side a').first().waitFor(); await p.waitForTimeout(800); }],
  ['web client', async (p) => { await signIn(p, hosted.url, 'Contacts', 'Ann', 'ann-secret-1'); }],
  ...['design', 'security', 'debugger', 'dataviewer'].map((name): [string, (page: Page) => Promise<void>] => [`${name} page`, async (p) => {
    await signIn(p, hosted.url, 'Contacts', 'Ann', 'ann-secret-1');
    await p.goto(`${hosted.url}/app/${name}.html`);
    await p.locator('#app > *').first().waitFor();
    await p.waitForTimeout(800);
  }]),
];

async function open(feature: Feature): Promise<BrowserContext> {
  // Every context but the one for reduced motion also asks for reduced motion, so a focus ring
  // that fades in is read finished instead of half way; the motion test is the one that checks it.
  const reduce: Parameters<Browser['newContext']>[0] = feature === 'motion' ? {} : { reducedMotion: 'reduce' };
  return browser.newContext({ viewport: { width: 1280, height: 900 }, ...reduce, ...options[feature] });
}

/** In the page: text whose contrast against its resolved background is under 4.5:1 (3:1 for large text). */
function lowContrast(): string[] {
  const parse = (c: string): number[] | undefined => {
    let m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = /^color\(srgb ([^)]+)\)$/.exec(c);
    if (m) { const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return undefined;
  };
  const luminance = ([r, g, b]: number[]) => {
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // The page's own canvas: white on paper, the scheme's otherwise. The root's color-scheme says which.
  const canvasScheme = getComputedStyle(document.documentElement).colorScheme;
  const canvas = matchMedia('print').matches || !canvasScheme.includes('dark') && !matchMedia('(prefers-color-scheme: dark)').matches ? [255, 255, 255] : [18, 18, 18];
  const backgroundOf = (el: Element): number[] | undefined => {
    const layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return undefined; // a picture or a gradient: not a color to measure
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let base = canvas;
    for (const l of layers.reverse()) base = [0, 1, 2].map((i) => l[i] * l[3] + base[i] * (1 - l[3]));
    return base;
  };
  const low: string[] = [];
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    // The layout canvas is the file's, and a hidden or empty box has no text to read.
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('.fm-part, [hidden], svg')) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    const control = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
    if (!text && !control) continue;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const fg = parse(cs.color);
    const bg = backgroundOf(el);
    if (!fg || !bg) continue;
    const ink = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const [a, b] = [luminance(ink), luminance(bg)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize);
    const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
    if (ratio < need) low.push(`${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''} ${ratio.toFixed(2)} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
  }
  return [...new Set(low)];
}

/** Tab through the page: the stops that show nothing when they have focus. */
async function unmarkedStops(page: Page, forced: boolean, stops = 40): Promise<string[]> {
  await page.evaluate(() => { window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur(); });
  const bad = new Set<string>();
  let reached = 0;
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((isForced) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !el.matches(':focus-visible')) return undefined;
      const cs = getComputedStyle(el);
      // A layout field is marked on its box (a layout object is the file's own), not on the input inside it.
      const holder = el.closest('.fm-field');
      const own = (e: Element) => { const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; };
      const shadow = cs.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\)/.test(cs.boxShadow);
      const marked = own(el) || (holder ? own(holder) : false) || (!isForced && shadow);
      const label = (e: Element) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '');
      return { name: `${el.parentElement ? label(el.parentElement) + ' > ' : ''}${label(el)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"`, marked };
    }, forced);
    if (!stop) continue;
    reached++;
    if (!stop.marked) bad.add(stop.name);
  }
  assert.ok(reached >= 5, `the walk reached ${reached} focusable stops`);
  return [...bad];
}

for (const [name, go] of pages) {
  for (const feature of ['dark', 'forced', 'contrast'] as const) {
    test(`${name}: text is readable and focus is visible with ${feature === 'dark' ? 'the dark scheme' : feature === 'forced' ? 'forced colors' : 'more contrast'}`, { skip }, async () => {
      const context = await open(feature);
      try {
        const page = await context.newPage();
        await go(page);
        const media = await page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, forced: matchMedia('(forced-colors: active)').matches, more: matchMedia('(prefers-contrast: more)').matches }));
        assert.equal(feature === 'dark' ? media.dark : feature === 'forced' ? media.forced : media.more, true, 'the media feature is on');
        assert.deepEqual(await page.evaluate(lowContrast), [], 'text under the contrast ratio');
        assert.deepEqual(await unmarkedStops(page, feature === 'forced'), [], 'focus stops that show nothing');
      } finally { await context.close(); }
    });
  }

  test(`${name}: nothing moves under reduced motion, and something does without it`, { skip }, async () => {
    const reduced = await open('motion');
    const normal = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const running = async (context: BrowserContext) => {
        const page = await context.newPage();
        await go(page);
        return page.evaluate(() => {
          const longest = (list: string) => Math.max(0, ...list.split(',').map((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000)));
          const all = [...document.querySelectorAll('*')];
          return {
            // A transition or animation declared, however long (ms).
            transitions: all.filter((e) => { const cs = getComputedStyle(e); return cs.transitionProperty !== 'none' && longest(cs.transitionDuration) > 0.01; }).length,
            animations: all.filter((e) => { const cs = getComputedStyle(e); return cs.animationName !== 'none' && longest(cs.animationDuration) > 0.01; }).length,
            running: document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 0.01).length,
            smooth: getComputedStyle(document.documentElement).scrollBehavior,
          };
        });
      };
      const calm = await running(reduced);
      assert.deepEqual(calm, { transitions: 0, animations: 0, running: 0, smooth: 'auto' });
      const lively = await running(normal);
      assert.ok(lively.transitions > 0, 'without the preference the page does declare transitions (the check can fail)');
    } finally { await reduced.close(); await normal.close(); }
  });
}

for (const feature of ['print', 'print-dark'] as const) {
  test(`on paper (${feature === 'print' ? 'light' : 'dark'} screen): black on white, readable, and the admin console without its chrome`, { skip }, async () => {
    for (const [name, go] of pages) {
      const context = await open(feature);
      try {
        const page = await context.newPage();
        await go(page);
        await page.emulateMedia({ media: 'print' });
        const paper = await page.evaluate(() => ({ print: matchMedia('print').matches, color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor }));
        assert.equal(paper.print, true);
        // The web client's layout prints as it always did (the preview sheets); everything else is ink on white.
        if (name !== 'web client') {
          const [r, g, b] = paper.color.match(/\d+/g)!.map(Number);
          assert.ok(r < 70 && g < 70 && b < 70, `${name}: the text is dark on paper (${paper.color})`);
          assert.ok(/^rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)$/.test(paper.background), `${name}: the page is white on paper (${paper.background})`);
          assert.deepEqual(await page.evaluate(lowContrast), [], `${name}: text under the contrast ratio on paper`);
        }
        if (name === 'admin console') {
          const chrome = await page.evaluate(() => ['header', 'nav.side', 'button'].map((s) => [...document.querySelectorAll(s)].filter((e) => getComputedStyle(e).display !== 'none').length));
          assert.deepEqual(chrome, [0, 0, 0], 'the top bar, the section list and the buttons are not printed');
          assert.ok((await page.pdf({ format: 'A4' })).length > 2000, 'the page makes a PDF');
        }
      } finally { await context.close(); }
    }
  });
}

test('the toolbar buttons of the web client show where the keyboard is', { skip }, async () => {
  const context = await open('motion');
  try {
    const page = await context.newPage();
    await signIn(page, hosted.url, 'Contacts', 'Ann', 'ann-secret-1');
    const first = page.locator('.toolbar button.tb:not(:disabled)').first();
    await page.evaluate(() => (document.querySelector('.toolbar button.tb:not(:disabled)') as HTMLElement).focus());
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    assert.equal(await first.evaluate((el) => el.matches(':focus-visible')), true);
    assert.notEqual(await first.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
  } finally { await context.close(); }
});

test('the muted text and the borders darken under more contrast', { skip }, async () => {
  const measure = async (more: boolean, scheme: 'light' | 'dark') => {
    const context = await browser.newContext({ colorScheme: scheme, ...(more ? { contrast: 'more' as const } : {}) });
    try {
      const page = await context.newPage();
      await page.goto(hosted.url + '/admin/');
      await page.locator('nav.side a').first().waitFor();
      return await page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return { muted: s.getPropertyValue('--muted').trim(), line: s.getPropertyValue('--line-strong').trim(), focus: s.getPropertyValue('--focus').trim() };
      });
    } finally { await context.close(); }
  };
  for (const scheme of ['light', 'dark'] as const) {
    const usual = await measure(false, scheme);
    const more = await measure(true, scheme);
    assert.notEqual(more.muted, usual.muted, `${scheme}: muted text changes`);
    assert.notEqual(more.line, usual.line, `${scheme}: borders change`);
    assert.notEqual(more.focus, usual.focus, `${scheme}: the focus ring thickens`);
  }
});

test('a busy spinner stays still under reduced motion', { skip }, async () => {
  const spin = async (reduce: boolean) => {
    const context = await browser.newContext({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    try {
      const page = await context.newPage();
      await page.goto(hosted.url + '/app/');
      await page.addStyleTag({ url: hosted.url + '/app/app.css' });
      await page.evaluate(() => { document.body.innerHTML = '<div class="pull-refresh busy"><span class="pull-spinner"></span></div>'; });
      return page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 0.01).length);
    } finally { await context.close(); }
  };
  assert.equal(await spin(true), 0);
  assert.equal(await spin(false), 1, 'it does turn without the preference (the check can fail)');
});

test('the documentation and handover export prints dark ink on white from a dark screen, and keeps its links visible', { skip }, async () => {
  const html = docsHtml('# Solution\n\nA paragraph with a [link](#x) and `code`.\n\n| Table | Fields |\n| --- | --- |\n| People | 3 |\n', 'Contacts', 'Handover memo');
  const context = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.setContent(html);
    assert.deepEqual(await page.evaluate(lowContrast), [], 'readable on a dark screen');
    await page.emulateMedia({ media: 'print' });
    const paper = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor, header: getComputedStyle(document.querySelector('header')!).display }));
    assert.equal(paper.color, 'rgb(0, 0, 0)');
    assert.match(paper.background, /^rgba\(0, 0, 0, 0\)$|^rgb\(255, 255, 255\)$/);
    assert.equal(paper.header, 'none');
    assert.deepEqual(await page.evaluate(lowContrast), [], 'readable on paper');
  } finally { await context.close(); }
});

test('the generated dashboard and landing page keep their headings and focus in forced colors', { skip }, async () => {
  const dashboard = dashboardPage('Orders', 'Orders', planDashboard({ id: 1, name: 'Orders', records: 3, fields: [{ id: 1, name: 'Total', kind: 'normal', type: 'number' }, { id: 2, name: 'Status', kind: 'normal', type: 'text' }] } as DesignTable));
  const context = await browser.newContext({ forcedColors: 'active', reducedMotion: 'reduce' });
  try {
    for (const html of [dashboard, homePage('Home', '[Full Access]')]) {
      const page = await context.newPage();
      await page.setContent(html);
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => [...document.querySelectorAll('h1, .kpi')].map((e) => ({ name: e.tagName.toLowerCase() + '.' + e.className, color: getComputedStyle(e).color, fill: getComputedStyle(e).webkitTextFillColor, shown: e.getBoundingClientRect().height > 0 })));
      assert.ok(text.length > 0 && text.every((t) => t.shown));
      for (const t of text) assert.ok(t.color !== 'rgba(0, 0, 0, 0)' && t.fill !== 'rgba(0, 0, 0, 0)', `${t.name} is not transparent text over a gradient`);
      await page.close();
    }
  } finally { await context.close(); }
});

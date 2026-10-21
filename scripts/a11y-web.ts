// Opt-in accessibility audit of the admin console (/admin/) and the web client
// (/app/) against WCAG 2.2 AA, in a real headless Chromium, in light and dark
// mode. docs/accessibility.md lists what it checks and what it can't.
//
// For each page, signed out and signed in, it runs axe-core (WCAG 2.0/2.1/2.2
// A and AA rules: names, labels, contrast, landmarks, ARIA), then walks the page
// with the Tab key and fails a stop that has no visible focus indicator, no
// accessible name, or sits hidden under a sticky bar. With reduced motion on, it
// fails any transition or animation still running.
//
// Like `npm run smoke:web` it needs no fixtures and touches no network: it hosts a
// small database it builds in memory. It needs the dev dependencies
// (playwright-core, axe-core) and a Chromium: cloud sessions have one at
// /opt/pw-browsers; elsewhere set TABULARIUS_CHROMIUM. Run it with:
//
//   npm run a11y:web            # summary; exit 1 when anything fails
//   npm run a11y:web -- --json  # every finding as JSON
import { serve, setAdminPassword } from '../packages/server/src/index.ts';
import { chromium, type Browser, type Page } from 'playwright-core';
import { findChromium } from './chromium.ts';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const MAX_TABS = 400;
const ADMIN_PASSWORD = 'a11y audit password';
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

type Finding = { page: string; scheme: string; check: string; detail: string };

/**
 * Findings docs/accessibility.md lists as known and not fixed here: they are printed, but don't
 * fail the run. A desktop layout drawn at phone width shrinks its fields below 24px (2.5.8); the
 * fix is a phone layout in the file, not the renderer.
 */
const KNOWN = [/^target-size: .*\(in the layout\)/];

/** axe-core's WCAG A/AA violations on the page as it stands. */
async function axe(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource); // an inline <script> would be refused by the admin console's policy
  const result = await page.evaluate(async (tags) => {
    const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'], elementRef: true });
    // Objects drawn from the FileMaker layout itself are marked: their look and size are the file's.
    return r.violations.map((v: any) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n: any) => ({ target: `${n.target.join(' ')}${n.element?.closest?.('.fm-part') ? ' (in the layout)' : ''}`, why: n.failureSummary?.split('\n').slice(1, 2).join('').trim() })) }));
  }, AXE_TAGS);
  return result.flatMap((v: any) => v.nodes.map((n: any) => `${v.id}: ${v.help} — ${n.target}${n.why ? ` (${n.why})` : ''}`));
}

/** Tab through the page; report stops without a visible focus indicator or a name, or covered by a sticky bar. */
async function keyboardWalk(page: Page): Promise<{ problems: string[]; stops: string[] }> {
  // Start from the top of the page: focus a sentinel before everything else.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const start = document.createElement('span');
    start.id = 'a11y-start';
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    document.querySelectorAll('[data-a11y-stop]').forEach((e) => e.removeAttribute('data-a11y-stop'));
  });
  let next = 0;
  let lastStop = -1;
  const problems: string[] = [];
  const stops: string[] = [];
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate((n) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.id === 'a11y-start') return null;
      const fresh = !el.hasAttribute('data-a11y-stop');
      if (fresh) el.setAttribute('data-a11y-stop', String(n));
      const path = (e: Element): string => {
        const parts: string[] = [];
        for (let n: Element | null = e; n && n !== document.body && parts.length < 4; n = n.parentElement) {
          parts.unshift(n.id ? `${n.tagName.toLowerCase()}#${n.id}` : `${n.tagName.toLowerCase()}${n.classList.length ? '.' + [...n.classList].join('.') : ''}`);
          if (n.id) break;
        }
        return parts.join(' > ');
      };
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== 'none';
      // A focus style may sit on a wrapper (:focus-within), e.g. a drop zone around a hidden file input.
      let wrapper = false;
      for (let p = el.parentElement, d = 0; p && d < 3; p = p.parentElement, d++) {
        const ps = getComputedStyle(p);
        if (p.matches(':focus-within') && ((ps.outlineStyle !== 'none' && parseFloat(ps.outlineWidth) > 0) || ps.boxShadow.includes('px'))) wrapper = true;
      }
      // Compare with the element unfocused: a visible change counts (e.g. a border or background).
      const before = { outline: cs.outline, shadow: cs.boxShadow, border: cs.borderColor, bg: cs.backgroundColor, td: cs.textDecorationLine };
      const name = (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ? el.getAttribute('aria-labelledby')!.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '')
        || (el as HTMLInputElement).labels?.[0]?.textContent || el.getAttribute('title') || (el.tagName === 'INPUT' ? (el as HTMLInputElement).placeholder || ((el as HTMLInputElement).type === 'submit' || (el as HTMLInputElement).type === 'button' ? (el as HTMLInputElement).value : '') : el.textContent) || '').trim();
      const r = el.getBoundingClientRect();
      // Focus not obscured (2.4.11): the stop's centre must be the element itself, not a sticky bar over it.
      el.scrollIntoView?.({ block: 'nearest' });
      const r2 = el.getBoundingClientRect();
      const cx = Math.min(Math.max(r2.left + r2.width / 2, 0), innerWidth - 1);
      const cy = Math.min(Math.max(r2.top + r2.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      const obscured = r2.width > 0 && r2.height > 0 && top !== null && top !== el && !el.contains(top) && !top.contains(el)
        && (() => { for (let t: Element | null = top; t; t = t.parentElement) { const p = getComputedStyle(t).position; if (p === 'sticky' || p === 'fixed') return true; } return false; })();
      return { id: path(el), fresh, stop: Number(el.getAttribute('data-a11y-stop')), outline, shadow, wrapper, before, name, tag: el.tagName, visible: r.width > 0 && r.height > 0, obscured, hidden: !!el.closest('[hidden],[inert]') };
    }, next++);
    if (!info) { if (i > 0) break; continue; }
    // Back at an earlier stop: the page wrapped round (date fields take several Tabs, so the last stop again is fine).
    if (!info.fresh) { if (info.stop === next - 2 || info.stop === lastStop) continue; break; }
    lastStop = info.stop;
    stops.push(info.id);
    let visible = info.outline || info.shadow || info.wrapper;
    if (!visible) {
      // Did focusing change anything visible at all?
      const unfocused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const clone = getComputedStyle(el);
        const now = { outline: clone.outline, shadow: clone.boxShadow, border: clone.borderColor, bg: clone.backgroundColor, td: clone.textDecorationLine };
        el.blur();
        const off = getComputedStyle(el);
        const then = { outline: off.outline, shadow: off.boxShadow, border: off.borderColor, bg: off.backgroundColor, td: off.textDecorationLine };
        el.focus({ focusVisible: true } as FocusOptions);
        return JSON.stringify(now) !== JSON.stringify(then);
      });
      visible = unfocused;
    }
    if (!info.visible) problems.push(`focus lands on something with no size: ${info.id}`);
    else if (!visible) problems.push(`no visible focus indicator: ${info.id}`);
    if (!info.name && info.tag !== 'IFRAME') problems.push(`focusable with no accessible name: ${info.id}`);
    if (info.obscured) problems.push(`focus hidden under a sticky bar: ${info.id}`);
    if (info.hidden) problems.push(`focus lands inside hidden content: ${info.id}`);
  }
  await page.evaluate(() => document.getElementById('a11y-start')?.remove());
  if (stops.length >= MAX_TABS) problems.push(`more than ${MAX_TABS} Tab stops (possible keyboard trap)`);
  return { problems, stops };
}

/** With reduced motion, nothing should still transition or animate. */
async function motion(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const a of document.getAnimations()) {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      const d = Number((a.effect as KeyframeEffect | null)?.getComputedTiming().duration ?? 0);
      if (d > 0.01 && a.playState === 'running') out.push(`animation still runs with reduced motion: ${t?.tagName.toLowerCase()}${t?.id ? '#' + t.id : ''}${t?.className && typeof t.className === 'string' ? '.' + t.className.split(' ').join('.') : ''} (${d}ms)`);
    }
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const longest = Math.max(...cs.transitionDuration.split(',').map((s) => parseFloat(s) || 0));
      if (longest > 0.01 && cs.transitionProperty !== 'none' && cs.transitionProperty !== 'all') out.push(`transition still runs with reduced motion: ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`);
    }
    if (getComputedStyle(document.documentElement).scrollBehavior === 'smooth') out.push('smooth scrolling still on with reduced motion');
    return [...new Set(out)].slice(0, 20);
  });
}

/** The web client's keyboard paths a Tab walk can't see: menus, the toolbar keeping focus, the skip link. */
async function appKeys(page: Page): Promise<string[]> {
  const out: string[] = [];
  const active = () => page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return { role: a?.getAttribute('role') ?? a?.tagName.toLowerCase(), text: a?.getAttribute('aria-label') || a?.textContent?.trim() || '', cls: a?.className ?? '', expanded: a?.getAttribute('aria-expanded') };
  });
  const title = page.locator('.menubar .menu-title').first();
  if (await title.count()) {
    await title.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    let a = await active();
    if (!a.role?.startsWith('menuitem')) out.push(`Enter on a menu title doesn't put focus in the menu (focus on ${a.role} "${a.text}")`);
    const first = a.text;
    await page.keyboard.press('ArrowDown');
    a = await active();
    if (!a.role?.startsWith('menuitem') || a.text === first) out.push('ArrowDown doesn\'t move to the next menu item');
    await page.keyboard.press('Escape');
    a = await active();
    if (!String(a.cls).includes('menu-title') || a.expanded !== 'false') out.push(`Escape doesn't close the menu and return focus to its title (focus on ${a.role} "${a.text}", expanded ${a.expanded})`);
  } else out.push('no menu bar found');
  const list = page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'List' });
  await list.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  let a = await active();
  if (!a.text.endsWith('List')) out.push(`pressing List from the keyboard loses focus (now on ${a.role} "${a.text}")`);
  await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: 'Form' }).click();
  await page.reload();
  await page.waitForSelector('.menubar .menu-title');
  await page.waitForTimeout(800);
  await page.keyboard.press('Tab');
  a = await active();
  if (!/skip/i.test(a.text)) out.push(`the first Tab stop isn't a skip link (it's ${a.role} "${a.text}")`);
  else {
    await page.keyboard.press('Enter');
    a = await active();
    if (a.role !== 'main') out.push(`the skip link doesn't move focus to the layout (focus on ${a.role} "${a.text.slice(0, 30)}")`);
  }
  return out;
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json');
  const executablePath = findChromium();
  if (!executablePath) {
    console.error('No Chromium found. Set TABULARIUS_CHROMIUM to a Chrome/Chromium binary, or run this in a cloud session (one is preinstalled at /opt/pw-browsers).');
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-a11y-'));
  setAdminPassword(dir, ADMIN_PASSWORD);
  const s = await serve({ dir, port: 0, log: () => {}, listFilesPublicly: true });
  // A small file built in memory, so the audit needs no fixtures: a table, a layout, a few records.
  const db = s.host.create('Contacts');
  db.setPassword('Admin', 'pw');
  db.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }, { name: 'Email' }, { name: 'Age', type: 'number' }, { name: 'Notes' }] }] as never);
  const login = await fetch(`${s.url}/fmi/data/vLatest/databases/Contacts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const token = (await login.json()).response.token;
  for (const [Name, Email, Age] of [['Ada Lovelace', 'ada@example.org', 36], ['Alan Turing', 'alan@example.org', 41], ['Grace Hopper', 'grace@example.org', 85]]) {
    await fetch(`${s.url}/fmi/data/vLatest/databases/Contacts/layouts/People/records`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name, Email, Age } }) });
  }

  const findings: Finding[] = [];
  const tabOrders: Record<string, string[]> = {};
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of [1440, 390]) {
        const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height: width > 900 ? 900 : 844 }, reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => findings.push({ page: page.url(), scheme, check: 'js', detail: String(e) }));
        // What the page complained about, to say why a sign-in never finished instead of only timing out.
        const trouble: string[] = [];
        page.on('console', (m) => { if (m.type() === 'error') trouble.push(`console: ${m.text()}`); });
        page.on('requestfailed', (r) => trouble.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
        page.on('response', (r) => { if (r.status() >= 400 || /\/sessions|\/auth\//.test(r.url())) trouble.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
        const audit = async (name: string) => {
          const label = `${name} @${width}`;
          for (const d of await axe(page)) findings.push({ page: label, scheme, check: 'axe', detail: d });
          for (const d of await motion(page)) findings.push({ page: label, scheme, check: 'motion', detail: d });
          if (scheme === 'light' || width === 1440) {
            const walk = await keyboardWalk(page);
            for (const d of walk.problems) findings.push({ page: label, scheme, check: 'keyboard', detail: d });
            if (scheme === 'light') tabOrders[label] = walk.stops;
          }
        };

        await page.goto(`${s.url}/admin/`);
        await page.waitForSelector('#signin-password', { state: 'visible' });
        await audit('/admin/ sign-in');
        await page.fill('#signin-password', ADMIN_PASSWORD);
        await page.keyboard.press('Enter');
        await page.waitForSelector('#signin', { state: 'hidden' });
        await page.waitForTimeout(1500);
        await audit('/admin/ signed in');

        await page.goto(`${s.url}/app/`);
        await page.waitForSelector('form.login');
        await audit('/app/ sign-in');
        await page.getByLabel('Account').fill('Admin');
        await page.getByLabel('Password', { exact: true }).fill('pw');
        await page.keyboard.press('Enter');
        await page.waitForSelector('form.login', { state: 'detached' }).catch(async (e) => {
          const shown = (await page.locator('form.login').innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
          const listed = await fetch(`${s.url}/fmi/data/vLatest/databases`).then(async (r) => `${r.status} ${await r.text()}`).catch((x) => String(x));
          const select = await page.evaluate(() => document.querySelector('[name=db]')?.outerHTML).catch(() => '');
          trouble.push(`the server lists files as ${listed}; the page's file menu is ${select}`);
          const fields = await page.evaluate(() => `account "${(document.querySelector('[name=account]') as HTMLInputElement | null)?.value}", password of ${(document.querySelector('[name=password]') as HTMLInputElement | null)?.value.length} characters, file "${(document.querySelector('[name=db]') as HTMLSelectElement | null)?.value}"`).catch(() => '');
          throw new Error(`the /app/ sign-in did not finish (${scheme}, ${width}px) at ${page.url()}: form says "${shown}"; ${fields}; page: ${trouble.join('; ') || 'nothing reported'}\n${e}`);
        });
        await page.waitForTimeout(1500);
        await audit('/app/ signed in');
        if (scheme === 'light' && width === 1440) for (const d of await appKeys(page)) findings.push({ page: '/app/ signed in', scheme, check: 'keyboard', detail: d });
        for (const view of ['List', 'Table']) {
          await page.getByRole('group', { name: 'View as' }).getByRole('button', { name: view }).click();
          await page.waitForTimeout(800);
          await audit(`/app/ ${view.toLowerCase()} view`);
        }
        // The pages the web client opens from its menus share its sign-in.
        for (const extra of ['design.html', 'security.html', 'dashboard.html', 'automations.html', 'cleanup.html', 'dataviewer.html', 'debugger.html']) {
          await page.goto(`${s.url}/app/${extra}`);
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(1200);
          await audit(`/app/${extra}`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }

  // The same finding at both widths or in both themes is one problem.
  const grouped = new Map<string, Set<string>>();
  const known = new Set<string>();
  for (const f of findings) {
    if (KNOWN.some((k) => k.test(f.detail))) {
      known.add(`${f.page.replace(/ @\d+$/, '')} | ${f.check} | ${f.detail.replace(/ — .*/, '')}`);
      continue;
    }
    const key = `${f.page.replace(/ @\d+$/, '')} | ${f.check} | ${f.detail}`;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key)!.add(`${f.scheme}${f.page.match(/ @(\d+)$/)?.[0] ?? ''}`);
  }
  if (json) console.log(JSON.stringify({ findings, tabOrders }, null, 2));
  else {
    for (const [key, where] of grouped) console.log(`${key}  [${[...where].join(', ')}]`);
    if (known.size) console.log(`\nKnown (docs/accessibility.md):\n${[...known].map((k) => `  ${k}`).join('\n')}`);
    console.log(`\n${grouped.size} distinct finding(s)${known.size ? `, ${known.size} known` : ''}.`);
  }
  process.exit(grouped.size ? 1 : 0);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(2); });

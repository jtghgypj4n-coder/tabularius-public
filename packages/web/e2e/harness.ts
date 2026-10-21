// Shared set-up for the web client's browser tests (packages/web/e2e): host a
// folder of files on a free port, drive a real Chromium through Playwright,
// and sign in to /app/ the way a person does.
//
// The tests need a Chromium. Cloud sessions have one preinstalled under
// /opt/pw-browsers; elsewhere set TABULARIUS_CHROMIUM to a Chrome or Chromium
// executable. Without one the tests are skipped, never failed, so `npm test`
// stays usable on a machine without a browser. Playwright's own browser
// download is never used ("playwright install" isn't needed).
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { serve } from '../../server/src/index.ts';
import { STORE_EXT } from '../../server/src/host.ts';
import { createStore, type Store } from '../../store/src/index.ts';

export const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');

/** A Chromium to drive: TABULARIUS_CHROMIUM, then the preinstalled ones, then the usual install paths. */
export function findChromium(): string | undefined {
  if (process.env.TABULARIUS_CHROMIUM && existsSync(process.env.TABULARIUS_CHROMIUM)) return process.env.TABULARIUS_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    // Playwright's own layout: chromium-N/chrome-linux/chrome, chromium_headless_shell-N/chrome-mac-arm64/headless_shell, ...
    for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium'))) {
      let subs: string[];
      try { subs = readdirSync(join(root, dir)); } catch { continue; } // a file or a link, not a folder
      for (const sub of subs) {
        for (const bin of ['chrome', 'headless_shell', 'chrome-headless-shell', 'Chromium.app/Contents/MacOS/Chromium']) {
          const p = join(root, dir, sub, bin);
          if (existsSync(p) && statSync(p).isFile()) return p;
        }
      }
    }
  } catch { /* no such folder */ }
  for (const p of [
    '/opt/google/chrome/chrome', // the real binary: /usr/bin/google-chrome is a shell script that needs readlink, dirname, mkdir and cat on the PATH
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) if (existsSync(p)) return p;
  return undefined;
}

const executablePath = findChromium();

/** Why a test can't run here, for node:test's `skip`, or false when it can. */
export function skipUnless(...fixtures: string[]): string | false {
  if (!executablePath) return 'no Chromium: set TABULARIUS_CHROMIUM';
  const missing = fixtures.find((f) => !existsSync(join(FIXTURES, f)));
  return missing ? `fixtures missing (${missing}): run npm run fixtures` : false;
}

export interface Hosted {
  url: string;
  host: import('../../server/src/host.ts').Host;
  dir: string;
  store(name: string): Store;
  close(): Promise<void>;
}

/**
 * Hosts a fresh temporary folder: `fixtures` are copied in from fixtures/fmp12
 * (the originals are never touched), and `stores` are empty databases made
 * without any .fmp12, for the test to build with Store.applyDesign.
 */
export async function host(opts: { fixtures?: string[]; stores?: string[]; appConnections?: boolean; /** The assistant, answering from a stand-in for the model's API (never the real one). */ ai?: NonNullable<Parameters<typeof serve>[0]['ai']> }): Promise<Hosted> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-e2e-'));
  for (const f of opts.fixtures ?? []) copyFileSync(join(FIXTURES, f), join(dir, f));
  for (const s of opts.stores ?? []) createStore(join(dir, s + STORE_EXT));
  const s = await serve({ dir, port: 0, log: () => {}, listFilesPublicly: true, ...(opts.appConnections ? { appConnections: true } : {}), ...(opts.ai ? { ai: opts.ai } : {}) });
  return {
    url: s.url,
    host: s.host,
    dir,
    store: (name) => {
      const store = s.host.get(name);
      if (!store) throw new Error(`${name} isn't hosted`);
      return store;
    },
    async close() {
      s.server.closeAllConnections();
      // Closing the server closes the hosted files too.
      await new Promise<void>((ok) => s.server.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function launch(): Promise<Browser> {
  // Playwright gives each launch its own temporary Chromium profile and DevTools
  // connection. On a busy runner Chromium can miss its first DevTools handshake even
  // though the next fresh launch succeeds.
  let error: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await chromium.launch({ executablePath, timeout: 90_000 });
    } catch (e) {
      error = e;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error('Chromium did not connect after two fresh launch attempts', { cause: error });
}

/**
 * A browser window that fails the test on any uncaught script error: the
 * errors are collected and `assertClean` reports them.
 */
export async function window(browser: Browser | BrowserContext): Promise<Page & { errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }) as Page & { errors: string[] };
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

/** Signs in to a file at /app/ and waits for its first layout to be drawn. */
export async function signIn(page: Page, url: string, file: string, account: string, password = ''): Promise<void> {
  await page.goto(url + '/app/');
  await page.locator('select[name="db"]').selectOption(file);
  await page.locator('input[name="account"]').fill(account);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  // A solution may hide its toolbar on the first layout. The menu is still
  // mounted, and the layout part below is the visible readiness signal.
  await page.locator('select.layout-menu').waitFor({ state: 'attached' });
  await page.locator('.fm-part').first().waitFor();
}

/** Switches the window to a layout from the toolbar's layout menu. */
export async function goToLayout(page: Page, layout: string): Promise<void> {
  await page.locator('select.layout-menu').selectOption(layout);
  await until(() => page.locator('select.layout-menu').inputValue(), (v) => v === layout);
  await page.locator('.fm-part').first().waitFor();
}

/**
 * Polls `read` until `ok` accepts what it gives, and returns that; fails with
 * the last value seen after `ms`. The client redraws asynchronously, so a
 * check reads again rather than once.
 */
export async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  let last: T | undefined;
  for (;;) {
    try {
      last = await read();
      if (ok(last)) return last;
    } catch { /* not there yet */ }
    if (Date.now() > end) throw new Error(`timed out; last value: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Answers a question the page asks in its own dialog (Delete Record, Revert, Go to Record, ...), named by `title`:
 * types `text` into its box when it has one, presses `button`, and resolves with the question it asked. The page
 * asks in a dialog it draws, so a browser can't suppress it, and a test sees what a person sees.
 */
export async function answer(page: Page, title: string | RegExp, button: string, text?: string): Promise<string> {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.waitFor();
  const message = dialog.locator('.message');
  const asked = (await message.count()) ? await message.innerText() : '';
  if (text !== undefined) await dialog.getByRole('textbox').fill(text);
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  return asked;
}

/**
 * The box of a field on the layout, by its layout object id (the id FileMaker
 * gave the object, kept by the converter). Inside a portal, pass the row.
 */
export function field(scope: Page | Locator, objectId: number): Locator {
  return scope.locator(`.fm[data-id="${objectId}"]`).locator('input, textarea').first();
}

/** The toolbar's record count ("89 total", "3 found (89 total)"). */
export function found(page: Page): Locator {
  return page.locator('.found').first();
}

let axeSource: string | undefined;

/**
 * axe-core's WCAG 2.0/2.1/2.2 A and AA violations in `scope` (the whole page by default), as one
 * line each: the rule, then the first elements it hit. Empty when the page passes. Objects drawn
 * from a FileMaker layout (`.fm-part`) are left out: their look and size are the file's.
 */
export async function axeViolations(page: Page, scope = 'body'): Promise<string[]> {
  axeSource ??= readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (sel) => {
    const r = await (window as any).axe.run(document.querySelector(sel) ?? document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'] },
      resultTypes: ['violations'], elementRef: true,
    });
    return r.violations.flatMap((v: any) => {
      const nodes = v.nodes.filter((n: any) => !n.element?.closest?.('.fm-part'));
      return nodes.length ? [`${v.id}: ${nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(', ')}${nodes.length > 3 ? ` (+${nodes.length - 3} more)` : ''}`] : [];
    });
  }, scope);
}

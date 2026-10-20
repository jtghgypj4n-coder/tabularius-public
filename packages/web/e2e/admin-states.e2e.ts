// The admin console in the states a first look doesn't reach: nothing to show, a very long list, a server that
// answers with an error or refuses the sign-in, a destructive button the person backs out of, and a form that is
// filled in wrongly. Each page shows words (never "undefined", "NaN" or "[object Object]"), the rest of the
// console keeps working when one part fails, and nothing is sent that the person did not confirm.
// The server is real; where a state can't be made with real data (500 clients, an error from one endpoint) the
// browser's answer is changed on its way (page.route), so the console's own code draws it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page, Route } from 'playwright-core';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Things'] });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const STATUS = '**/tabularius/admin/v1/status';
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/;

/** The real status answer, changed by `edit`. */
async function status(page: Page, edit: (s: Record<string, any>) => void): Promise<void> {
  await page.route(STATUS, async (route: Route) => {
    // The console polls: a request still on its way when the test closes the page has nowhere to go, which is not a failure.
    try {
      const response = await route.fetch();
      const body = await response.json();
      edit(body);
      await route.fulfill({ response, json: body });
    } catch (e) {
      if (!/disposed|closed|detached/i.test(String((e as Error).message))) throw e;
    }
  });
}

const schedule = (n: number) => ({
  id: `s${n}`, name: `Nightly ${n}`, database: 'Things', script: 'Tidy', account: 'Admin', everyMinutes: 1440, at: '02:00',
  enabled: true, running: false, next: '2030-01-01T02:00:00.000Z',
});

test('with nothing to show, every list says so and no page prints a missing value', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#clients').textContent(), (t) => /Nobody is connected\./.test(t ?? ''));
  assert.match((await page.locator('#locks').textContent()) ?? '', /Nobody has a record open\./);
  assert.match((await page.locator('#schedules').textContent()) ?? '', /No scripts are scheduled\./);
  assert.match((await page.locator('#hooks').textContent()) ?? '', /No inbound hooks\./);
  assert.match((await page.locator('#queue').textContent()) ?? '', /No server-side scripts are running or waiting\./);
  const text = await page.locator('body').innerText();
  assert.doesNotMatch(text, BAD_TEXT);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('five hundred connected people and fifty schedules fit the page without sideways scrolling', { skip }, async () => {
  const page = await window(browser);
  await status(page, (s) => {
    s.clients = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, account: `person-with-a-rather-long-account-name-${i}`, db: 'Things', since: '2030-01-01T00:00:00.000Z', idleSeconds: i, locks: 0 }));
    s.schedules = Array.from({ length: 50 }, (_, i) => schedule(i));
  });
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#clients tbody tr').count(), (n) => n === 500);
  assert.equal(await page.locator('#clients-count').textContent(), '500');
  assert.equal(await page.locator('#schedules tbody tr').count(), 50);
  assert.equal(await page.locator('#sched-count').textContent(), '50');
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(sideways <= 1, `the page scrolls sideways by ${sideways}px`);
  assert.doesNotMatch(await page.locator('#clients').innerText(), BAD_TEXT);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('one part failing leaves the rest of the console working', { skip }, async () => {
  const page = await window(browser);
  await status(page, (s) => { s.schedules = [schedule(1)]; });
  for (const part of ['inbound-hooks', 'sync', 'passkeys', 'unusual', 'usage']) {
    await page.route(`**/tabularius/admin/v1/${part}*`, (route) => route.fulfill({ status: 500, json: { error: 'Something broke' } }));
  }
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#schedules tbody tr').count(), (n) => n === 1);
  // The parts after the failing ones in the same refresh are still drawn.
  await until(() => page.locator('#sets').textContent(), (t) => /No backups yet\./.test(t ?? ''));
  assert.equal(await page.locator('#error').isHidden(), true);
  assert.equal(await page.locator('#hooks-section').isHidden(), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a server that cannot be reached says so, and a refused sign-in shows the sign-in page', { skip }, async () => {
  const page = await window(browser);
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#clients').textContent(), (t) => /Nobody is connected\./.test(t ?? ''));
  await page.route(STATUS, (route) => route.fulfill({ status: 503, json: { error: 'Server is busy' } }));
  await page.evaluate(() => (globalThis as unknown as { refresh(): Promise<void> }).refresh());
  assert.match((await page.locator('#error').textContent()) ?? '', /Can't reach the server: Server is busy/);
  assert.equal(await page.locator('#error').isVisible(), true);
  // What was drawn stays; it is not blanked by the failure.
  assert.match((await page.locator('#clients').textContent()) ?? '', /Nobody is connected\./);
  await page.unroute(STATUS);
  await page.route(STATUS, (route) => route.fulfill({ status: 401, json: { error: 'Sign in', signIn: true } }));
  await page.evaluate(() => (globalThis as unknown as { refresh(): Promise<void> }).refresh());
  await until(() => page.locator('#signin').isVisible(), Boolean);
  assert.equal(await page.locator('main').isHidden(), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('deleting a schedule asks first: backing out sends nothing, agreeing deletes it', { skip }, async () => {
  const page = await window(browser);
  await status(page, (s) => { s.schedules = [schedule(7)]; });
  const deletes: string[] = [];
  await page.route('**/tabularius/admin/v1/schedules/s7', (route) => {
    deletes.push(route.request().method());
    return route.fulfill({ json: {} });
  });
  const asked: string[] = [];
  await page.goto(hosted.url + '/admin/');
  const del = page.getByRole('button', { name: 'Delete the schedule Nightly 7' });
  await del.waitFor();
  page.once('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });
  await del.click();
  await until(async () => asked.length, (n) => n === 1);
  page.once('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await del.click();
  await until(async () => deletes.length, (n) => n >= 1);
  // Requests arrive in order: had the first (dismissed) click sent one, there would be two by now.
  assert.deepEqual(deletes, ['DELETE']);
  assert.deepEqual(asked, ['Delete the schedule Nightly 7?', 'Delete the schedule Nightly 7?']);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a form filled in wrongly sends nothing; one the server refuses says why', { skip }, async () => {
  const page = await window(browser);
  const posts: string[] = [];
  await page.route('**/tabularius/admin/v1/session-timeout', (route) => { posts.push('session-timeout'); return route.fulfill({ json: {} }); });
  await page.route('**/tabularius/admin/v1/schedules', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push('schedules');
    return route.fulfill({ status: 400, json: { error: 'Script "Tidy" is not in Things' } });
  });
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#session-minutes').inputValue(), (v) => v !== '');
  // Session minutes: 0 and 5000 are outside 1 to 1440; empty is required.
  for (const bad of ['0', '5000', '']) {
    await page.locator('#session-minutes').fill(bad);
    assert.equal(await page.locator('#session-form').evaluate((f) => (f as HTMLFormElement).checkValidity()), false, `"${bad}"`);
    await page.locator('#session-set').click();
  }
  // The schedule form needs a name, script and account.
  await page.locator('#schedules-section summary').click();
  await page.locator('#add-schedule button.primary').click();
  assert.equal(await page.locator('#add-schedule').evaluate((f) => (f as HTMLFormElement).checkValidity()), false);
  assert.deepEqual(posts, []);
  // Filled in, the server's own reason is shown.
  await page.locator('#add-schedule [name="name"]').fill('Tidy up');
  await page.locator('#add-schedule [name="script"]').fill('Tidy');
  await page.locator('#add-schedule button.primary').click();
  await until(() => page.locator('#said-text').textContent(), (t) => /Can't add the schedule: Script "Tidy" is not in Things/.test(t ?? ''));
  assert.equal(await page.locator('#said').getAttribute('role'), 'alert');
  assert.deepEqual(posts, ['schedules']);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('with a file hosted, every page loads without an error or a missing value', { skip: skip || skipUnless('Flicks.fmp12') }, async () => {
  const withFile = await host({ fixtures: ['Flicks.fmp12'] });
  const page = await window(browser);
  const rejected: string[] = [];
  try {
    await page.goto(withFile.url + '/admin/');
    await until(() => page.locator('#dbs tbody tr').count(), (n) => n === 1);
    const source = await (await fetch(withFile.url + '/admin/')).text();
    const loaders = [...new Set([...source.matchAll(/^async function (load\w+)\(/gm)].map((m) => m[1]))];
    assert.ok(loaders.length >= 25, `found ${loaders.length} loaders`);
    for (const name of loaders) {
      const failed = await page.evaluate(async (n) => {
        try { await (globalThis as unknown as Record<string, () => Promise<void>>)[n](); return ''; } catch (e) { return (e as Error).message; }
      }, name);
      if (failed) rejected.push(`${name}: ${failed}`);
    }
    assert.deepEqual(rejected, []);
    assert.doesNotMatch(await page.locator('body').innerText(), BAD_TEXT);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
    await withFile.close();
  }
});

// The admin console's plug-in readiness panel, in a real browser: the first-run checklist says how many plug-in functions
// will not run, "See which" opens the list for the file with what each one does and what to use instead, the CSV downloads
// with names and counts only, and a file with no plug-in calls says so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { axeViolations, host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Plugs', 'Plain'] });
  const plugs = hosted.store('Plugs');
  plugs.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Name' }] },
    { op: 'createScript', name: 'Run a command', text: 'Set Variable [ $r ; Value: BE_ExecuteSystemCommand ( "ls" ) ]\nSet Variable [ $v ; Value: BE_Version ]' },
    { op: 'createScript', name: 'Mail it', text: 'Set Variable [ $s ; Value: BE_SMTPSend ( "a@example.com" ; "b@example.com" ; "Hi" ; "Body" ) ]' },
  ] as never);
  plugs.create('Contacts', { Name: 'SECRET-PERSON-NAME' });
  hosted.store('Plain').applyDesign([{ op: 'createTable', name: 'Things', fields: [{ name: 'Name' }] }] as never);
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('the checklist says how many plug-in functions will not run, and "See which" lists them with what to do', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  const note = page.locator('#setup-list li', { hasText: 'plug-in function' });
  await note.waitFor();
  // Two files are hosted, so the line names the one it is about; the file with no plug-in calls has none.
  assert.equal((await note.locator('span').nth(1).innerText()).trim(), 'Plugs: 2 plug-in functions will not run');
  assert.equal(await page.locator('#setup-list li', { hasText: 'Plain' }).count(), 0);
  // It is a note, not a step: the count of steps done does not include it.
  assert.match(await page.locator('#setup-count').innerText(), /^\d of \d done$/);

  await note.getByRole('button', { name: 'See which plug-in functions in Plugs' }).click();
  const panel = page.locator('#guide');
  await panel.getByRole('heading', { name: 'Plug-ins in Plugs' }).waitFor();
  await until(() => page.evaluate(() => document.activeElement?.id), (id) => id === 'guide');
  const rows = await panel.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(rows.length, 3);
  assert.match(rows[0]!, /^BaseElements BE_ExecuteSystemCommand Gives \? .* 1 0 0 No native step runs a shell command/);
  assert.ok(rows.some((r) => /BE_SMTPSend Outbox only .*Send Mail/.test(r)), rows.join('\n'));
  assert.ok(rows.some((r) => /BE_Version Runs here .*Nothing needed/.test(r)), rows.join('\n'));
  assert.match(await panel.locator('#plugins-line').innerText(), /^2 plug-in functions will not run\. 1 runs here without the plug-in\./);
  assert.equal(await panel.getByRole('link', { name: 'Moving a solution off its plug-ins' }).getAttribute('href'), '/docs/moving-a-solution#plug-ins-are-not-loaded');
  assert.deepEqual(await axeViolations(page, '#guide'), []);

  // The CSV: names and counts, and none of the file's data.
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('link', { name: 'Download as CSV' }).click()]);
  assert.equal(download.suggestedFilename(), 'plug-ins-Plugs.csv');
  const csv = readFileSync((await download.path())!, 'utf8');
  assert.match(csv, /^plugIn,function,whatHappens,/);
  assert.match(csv, /BaseElements,BE_ExecuteSystemCommand,refused,/);
  for (const hidden of ['SECRET-PERSON-NAME', 'Run a command', 'Mail it']) assert.ok(!csv.includes(hidden), hidden);

  await panel.getByRole('button', { name: 'Close' }).click();
  assert.equal((await panel.innerHTML()).trim(), '');
  assert.deepEqual(page.errors, []);
});

test('a file with no plug-in calls says so, from its own button in the files table', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await page.getByRole('button', { name: 'Plug-ins used by Plain' }).click();
  const panel = page.locator('#guide');
  await panel.getByRole('heading', { name: 'Plug-ins in Plain' }).waitFor();
  assert.match(await panel.locator('#plugins-line').innerText(), /calls no plug-in functions that Tabularius knows, so there is nothing to move/);
  assert.equal(await panel.locator('table').count(), 0);
  assert.deepEqual(await axeViolations(page, '#guide'), []);
});

test('a server error is said in words and leaves no half-drawn panel', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await page.route(/plugin-readiness/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Something went wrong on the server."}' }));
  await page.getByRole('button', { name: 'Plug-ins used by Plugs' }).click();
  await until(() => page.locator('#guide').innerHTML(), (h) => h.trim() === '');
  await page.locator('#said[role=alert]').waitFor();
  assert.match((await page.locator('#said-text').textContent()) ?? '', /Something went wrong on the server/);
});

// The Script Debugger and the Data Viewer, in a real browser, on a small
// database built here with no .fmp12: a script paused at its first step, Step
// Over, Into and Out through a subscript, a breakpoint set by clicking beside
// a step, Continue to it, a watched formula, Halt, and the run left on a
// scratch copy. The Data Viewer shows the current record's fields and a
// watched formula, and follows the browse window to the next record.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name field.
const NAME = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createScript', name: 'Double', text: 'Set Variable [ $$doubled ; Value: Get ( ScriptParameter ) * 2 ]\nExit Script [ Text Result: $$doubled ]' },
    { op: 'createScript', name: 'Main', text: [
      'Set Variable [ $a ; Value: 1 ]',
      'Perform Script [ “Double” ; Parameter: 5 ]',
      'Set Variable [ $b ; Value: $a + Get ( ScriptResult ) ]',
      'Set Field [ Customers::Name ; "Changed by the script" ]',
      'Commit Records/Requests [ With dialog: Off ]',
      'Exit Script [ Text Result: $b ]',
    ].join('\n') },
  ] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.create('Customers', { Id: 2, Name: 'Grace' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Signed in, in form view on the first customer. */
async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, NAME).inputValue(), (v) => v === 'Ada');
  return page;
}

async function tools(page: Page, item: string): Promise<void> {
  await page.locator('.menubar').getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

const status = (page: Page) => page.locator('.g-status').first().textContent().then((t) => t ?? '');
/** A row of the side panel's tables: the value beside `name` (undefined while there's no such row). */
const value = (page: Page, name: string) => page.locator('.g-side tr').evaluateAll((rows, name) => {
  const row = rows.find((r) => r.querySelector('td')?.textContent === name);
  return row?.querySelectorAll('td')[1]?.textContent?.replace(/\s*×$/, '').trim();
}, name);
const stack = (page: Page) => page.locator('.g-stack li').allTextContents();

test('the Script Debugger steps over, into and out of a subscript, stops at a breakpoint, watches a formula, and leaves the file as it was', { skip }, async () => {
  const page = await open();
  try {
    await tools(page, 'Script Debugger');
    await page.getByRole('heading', { name: 'Script Debugger' }).waitFor();
    await page.getByLabel('Script', { exact: true }).selectOption('Main');
    await page.getByLabel('Layout', { exact: true }).fill('Customers');
    await page.getByRole('button', { name: 'Debug', exact: true }).click();
    await until(() => status(page), (t) => /^Paused at step 1 of Main/.test(t));

    await page.getByRole('button', { name: 'Step Over' }).click();
    await until(() => status(page), (t) => /^Paused at step 2 of Main/.test(t));
    assert.equal(await value(page, '$a'), '1');
    // Into the subscript, and the call stack shows both.
    await page.getByRole('button', { name: 'Step Into' }).click();
    await until(() => status(page), (t) => /^Paused at step 1 of Double/.test(t));
    assert.deepEqual(await stack(page), ['Double (step 1)', 'Main (step 2)']);
    await page.getByRole('button', { name: 'Step Out' }).click();
    await until(() => status(page), (t) => /^Paused at step 3 of Main/.test(t));
    assert.equal(await value(page, '$$doubled'), '10');

    // A breakpoint on the Exit Script, and Continue runs to it.
    await page.getByRole('button', { name: 'Breakpoint on step 6' }).click();
    await until(() => page.locator('.g-step.bp').count(), (n) => n === 1);
    await page.getByRole('button', { name: 'Continue' }).click();
    await until(() => status(page), (t) => /^Paused at step 6 of Main/.test(t));
    assert.equal(await value(page, '$b'), '11');
    await page.getByLabel('Formula to watch').fill('$b * 2 & " " & Customers::Name');
    await page.getByRole('button', { name: 'Watch', exact: true }).click();
    await until(() => value(page, '$b * 2 & " " & Customers::Name'), (v) => v === '22 Changed by the script');

    await page.getByRole('button', { name: 'Continue' }).click();
    await until(() => status(page), (t) => /^Finished after \d+ steps/.test(t));
    assert.match(await status(page), /Changes stayed on the scratch copy/);
    assert.equal(await value(page, 'Exit Script result'), '11');
    // The hosted file is as it was.
    assert.equal(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.Name, 'Ada');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Halt stops a paused script where it is', { skip }, async () => {
  const page = await open();
  try {
    await page.goto(hosted.url + '/app/debugger.html?script=Main&layout=Customers');
    await page.getByRole('heading', { name: 'Script Debugger' }).waitFor();
    assert.equal(await page.getByLabel('Script', { exact: true }).inputValue(), 'Main');
    await page.getByRole('button', { name: 'Debug', exact: true }).click();
    await until(() => status(page), (t) => /^Paused at step 1 of Main/.test(t));
    await page.getByRole('button', { name: 'Step Over' }).click();
    await until(() => status(page), (t) => /^Paused at step 2 of Main/.test(t));
    await page.getByRole('button', { name: 'Halt' }).click();
    await until(() => status(page), (t) => /^Halted after 1 step\./.test(t));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('the Data Viewer shows the current record and a watched formula, and follows the browse window', { skip }, async () => {
  const page = await open();
  try {
    const [viewer] = await Promise.all([page.waitForEvent('popup'), tools(page, 'Data Viewer')]);
    await viewer.getByRole('heading', { name: 'Data Viewer' }).waitFor();
    await viewer.getByRole('tab', { name: 'Current' }).click();
    await until(() => value(viewer, 'Customers::Name'), (v) => v === 'Ada');

    await viewer.getByRole('tab', { name: 'Watch' }).click();
    await viewer.getByLabel('Expression').fill('Customers::Name & " (" & Get ( RecordNumber ) & ")"');
    await viewer.getByRole('button', { name: 'Add to Watch' }).click();
    await until(() => value(viewer, 'Customers::Name & " (" & Get ( RecordNumber ) & ")"'), (v) => !!v?.startsWith('Ada (1)'));

    // The browse window moves on; the viewer follows.
    await page.getByRole('button', { name: 'Next record' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v === 'Grace');
    await until(() => value(viewer, 'Customers::Name & " (" & Get ( RecordNumber ) & ")"'), (v) => !!v?.startsWith('Grace (2)'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('AR-web-admin-console-07 the Data Viewer Current tab reads the paused scratch run rather than the hosted record', { skip }, async () => {
  const page = await open();
  try {
    hosted.store('Shop').applyDesign([{ op: 'createScript', name: 'Scratch Current', text: [
      'Set Field [ Customers::Name ; "scratch-new" ]',
      'Commit Records/Requests [ With dialog: Off ]',
      'Exit Script',
    ].join('\n') }] as DesignOp[]);
    const run = await page.evaluate(async () => {
      const session = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      const base = `/tabularius/debug/v1/databases/${encodeURIComponent(session.db)}`;
      const response = await fetch(`${base}/runs`, { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ script: 'Scratch Current', layout: 'Customers', pauseAtStart: false, breakpoints: [{ script: 'Scratch Current', index: 2 }] }) });
      return response.json();
    });
    assert.equal(run.paused.index, 2);
    assert.equal(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.Name, 'Ada');
    const viewer = await page.context().newPage() as Page & { errors: string[] };
    viewer.errors = [];
    viewer.on('pageerror', (error) => viewer.errors.push(error.message));
    const saved = await page.evaluate(() => sessionStorage.getItem('tabularius.session'));
    await viewer.addInitScript((value) => { if (value) sessionStorage.setItem('tabularius.session', value); }, saved);
    const runCurrentRequests: string[] = [];
    viewer.on('request', (request) => { if (request.url().includes('/runs/') && request.url().includes('/current?')) runCurrentRequests.push(request.url()); });
    await viewer.goto(hosted.url + '/app/dataviewer.html');
    await viewer.getByRole('heading', { name: 'Data Viewer' }).waitFor();
    await viewer.getByRole('tab', { name: 'Current' }).click();
    await until(() => value(viewer, 'Customers::Name'), (v) => v === 'scratch-new');
    assert.ok(runCurrentRequests.some((url) => url.includes(`/runs/${run.id}/current?`)), 'Current uses the paused run endpoint');
    assert.equal(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.Name, 'Ada');
    await page.evaluate(async (id) => {
      const session = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      await fetch(`/tabularius/debug/v1/databases/${encodeURIComponent(session.db)}/runs/${id}/halt`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } });
      const channel = new BroadcastChannel(`tabularius.debug.${session.db}`);
      channel.postMessage({ type: 'run', id, paused: false });
      channel.close();
    }, run.id);
    await until(() => value(viewer, 'Customers::Name'), (v) => v === 'Ada');
    assert.match(await viewer.locator('.g-status').innerText(), /^Web client window/);
    assert.deepEqual(page.errors, []);
    assert.deepEqual(viewer.errors, []);
    await viewer.close();
  } finally { await page.context().close(); }
});

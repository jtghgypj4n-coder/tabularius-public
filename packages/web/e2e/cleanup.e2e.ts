// The Clean Up Data page, in a real browser, on a small database built here
// with no .fmp12: a scan of a layout finds a likely duplicate and a value off
// its value list, a Dry run says what ticking them would change and leaves the
// file alone, Apply makes the changes, and Undo takes the batch back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([
    { op: 'createValueList', name: 'Statuses', values: ['Active', 'Inactive'] },
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Email' }, { name: 'Status' }] },
  ] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Jo Smith', Email: 'jo@example.com', Status: 'Active' });
  store.create('Customers', { Id: 2, Name: 'Smith, Jo', Email: 'jo@example.com', Status: 'Inactive' });
  store.create('Customers', { Id: 3, Name: 'Lee Wong', Email: 'lee@example.org', Status: 'actve' });
  store.applyDesign([{ op: 'updateField', table: 'Customers', field: 'Status', options: { validation: { valueList: store.schema.valueLists.find((v) => v.name === 'Statuses')!.id } } }] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

const rows = () => hosted.store('Shop').find('Customers', { query: [{ Id: '*' }] }).records.map((r) => r.fieldData);
const status = (id: number) => String(rows().find((r) => Number(r.Id) === id)?.Status);

test('the Clean Up Data page finds a duplicate and a bad value, dry runs, applies and undoes them', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.goto(hosted.url + '/app/cleanup.html');
    await page.getByLabel('Layout', { exact: true }).selectOption('Customers');
    await page.getByRole('button', { name: 'Look for problems' }).click();
    const card = page.locator('.cleanup');
    await card.waitFor();
    await card.getByText('1 likely duplicate').waitFor();
    await card.getByText('1 value to fix').waitFor();
    // Nothing changes until Apply.
    assert.equal(rows().length, 3);
    assert.equal(status(3), 'actve');

    // The bad value is suggested the right one, and a duplicate is ticked only when it is a sure thing.
    const fix = card.getByRole('checkbox', { name: 'Fix Status' });
    assert.equal(await card.getByRole('textbox', { name: 'Change to' }).inputValue(), 'Active');
    await fix.check();
    const merge = card.getByRole('checkbox', { name: /^Merge record/ });
    await merge.check();

    await card.getByRole('button', { name: 'Dry run' }).click();
    await card.getByText(/^Dry run: .* Nothing was changed\.$/).waitFor();
    await card.locator('.cleanup-preview').getByText('Active').waitFor();
    assert.equal(rows().length, 3);
    assert.equal(status(3), 'actve');

    await card.getByRole('button', { name: 'Apply ticked' }).click();
    await card.getByRole('button', { name: 'Applied' }).waitFor();
    await until(async () => rows().length, (n) => n === 2);
    assert.equal(status(3), 'Active');

    await card.getByRole('button', { name: 'Undo', exact: true }).click();
    await card.getByText(/^Undone/).waitFor();
    await until(async () => rows().length, (n) => n === 3);
    assert.equal(status(3), 'actve');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('Apply with nothing ticked says so and changes nothing', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
    await page.goto(hosted.url + '/app/cleanup.html');
    await page.getByLabel('Layout', { exact: true }).selectOption('Customers');
    await page.getByRole('button', { name: 'Look for problems' }).click();
    const card = page.locator('.cleanup');
    await card.waitFor();
    for (const box of await card.getByRole('checkbox').all()) await box.uncheck();
    await card.getByRole('button', { name: 'Apply ticked' }).click();
    await card.getByText('Tick something to apply first.').waitFor();
    assert.equal(rows().length, 3);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

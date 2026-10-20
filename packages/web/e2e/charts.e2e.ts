// The web client in a real browser, on the public Charts sample
// (fixtures/fmp12/Charts.fmp12, from `npm run fixtures`): open the file, find,
// edit a record, sort, and read a portal. What the window shows is checked
// against what the hosted file holds.
//
// Layout object ids below are the ones FileMaker gave the objects in Charts.fmp12:
//   NW Customers: 2 = Customer, 4 = Total Sales
//   Related records • Pie: 23 = the NW SalespersonCustomers portal,
//     24 = its Salesperson field, 26 = its Total Sales field
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { field, found, goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless('Charts.fmp12');
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ fixtures: ['Charts.fmp12'] });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Every customer name on the NW Customers layout, as the file holds them. */
function customers(): string[] {
  const all = hosted.store('Charts').find('NW Customers', { limit: 1000 });
  return all.records.map((r) => String(r.fieldData['Customer']));
}

test('opens a hosted file: signs in, draws the layout and counts its records', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Charts', 'Admin');
  const layouts = await page.locator('select.layout-menu option').allTextContents();
  assert.ok(layouts.includes('NW Customers'), `layout menu: ${layouts.join(', ')}`);
  await goToLayout(page, 'NW Customers');
  const total = customers().length;
  await until(() => found(page).textContent(), (t) => t === `${total}Total (Unsorted)`);
  await until(() => field(page, 2).inputValue(), (v) => v === customers()[0]);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Find mode: a request finds the matching records', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Charts', 'Admin');
  await goToLayout(page, 'NW Customers');
  await page.locator('button.tb', { hasText: 'Find' }).click();
  await page.getByRole('button', { name: 'Perform Find' }).waitFor();
  await field(page, 2).fill('Alfreds');
  await page.getByRole('button', { name: 'Perform Find' }).click();

  const expected = hosted.store('Charts').find('NW Customers', { query: [{ Customer: 'Alfreds' }] });
  assert.ok(expected.foundCount > 0);
  await until(() => found(page).textContent(), (t) => t === `${expected.foundCount}Found (Unsorted)${expected.totalCount} Total`);
  assert.match(await field(page, 2).inputValue(), /Alfreds/);

  // Show All brings every record back.
  await page.getByRole('button', { name: 'Show All' }).click();
  await until(() => found(page).textContent(), (t) => t === `${expected.totalCount}Total (Unsorted)`);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('editing a field saves it to the file when the field is left', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Charts', 'Admin');
  await goToLayout(page, 'NW Customers');
  const box = field(page, 2);
  const first = hosted.store('Charts').find('NW Customers', { limit: 1 }).records[0];
  const id = first.recordId;
  const before = String(first.fieldData['Customer']);
  // The layout is drawn before the record arrives: wait for its value before typing over it.
  await until(() => box.inputValue(), (v) => v === before);
  await box.fill(`${before} (edited)`);
  await box.press('Tab');
  await until(async () => String(hosted.store('Charts').get('NW Customers', id).fieldData['Customer']), (v) => v === `${before} (edited)`);

  // A fresh window reads it back from the server.
  await page.reload();
  await page.locator('select.layout-menu').waitFor();
  await goToLayout(page, 'NW Customers');
  await until(() => field(page, 2).inputValue(), (v) => v === `${before} (edited)`);

  // Put it back for the other tests.
  await field(page, 2).fill(before);
  await field(page, 2).press('Tab');
  await until(async () => String(hosted.store('Charts').get('NW Customers', id).fieldData['Customer']), (v) => v === before);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('sorting keeps the current record, at its new place in the sorted order', { skip }, async () => {
  // As in FileMaker: Sort Records reorders the found set and the record you were on stays current.
  // Before the fix, a record that moved past the first 50 was swapped for whichever record took its place.
  const page = await window(browser);
  await signIn(page, hosted.url, 'Charts', 'Admin');
  await goToLayout(page, 'NW Customers');
  const sorted = hosted.store('Charts').find('NW Customers', { limit: 1000, sort: [{ fieldName: 'Customer', sortOrder: 'ascend' }] })
    .records.map((r) => String(r.fieldData['Customer']));
  const number = page.getByLabel('Record number', { exact: true });
  const current = await until(() => field(page, 2).inputValue(), (v) => v !== '');
  const at = sorted.indexOf(current);
  assert.ok(at >= 0);

  const sortBy = page.getByLabel('Sort by');
  const options = await sortBy.locator('option').allTextContents();
  assert.ok(options.includes('Customer'), `sort menu: ${options.join(', ')}`);
  await sortBy.selectOption('Customer');
  await until(() => number.inputValue(), (v) => v === String(at + 1));
  assert.equal(await field(page, 2).inputValue(), current);

  await page.getByTitle('Sort order').click();
  await until(() => number.inputValue(), (v) => v === String(sorted.length - at));
  assert.equal(await field(page, 2).inputValue(), current);

  // The found set is in descending order: the first record is the last name.
  await number.fill('1');
  await number.press('Enter');
  await until(() => field(page, 2).inputValue(), (v) => v === sorted.at(-1));
  await page.getByRole('button', { name: 'Next record' }).click();
  await until(() => field(page, 2).inputValue(), (v) => v === sorted.at(-2));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a portal shows the related records of the current record', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Charts', 'Admin');
  await goToLayout(page, 'Related records • Pie');
  const store = hosted.store('Charts');
  const first = store.find('Related records • Pie', { limit: 1 }).records[0];
  const rows = store.get('Related records • Pie', first.recordId).portalData!['NW SalespersonCustomers'];
  assert.ok(rows?.length > 0, `the first customer has related records: ${JSON.stringify(first)}`);

  const portal = page.locator('.fm[data-id="23"]');
  const shown = await until(
    async () => {
      const out: string[] = [];
      for (const row of await portal.locator('.fm-portal-row').all()) {
        const name = await field(row, 24).inputValue().catch(() => '');
        if (name) out.push(name);
      }
      return out;
    },
    (names) => names.length === rows.length,
  );
  const names = rows.map((r) => Object.entries(r).find(([k]) => /::Salesperson$|Salesperson/.test(k))?.[1]);
  assert.deepEqual(shown.sort(), names.map(String).sort());

  // The next record's portal shows that record's own rows.
  await page.getByRole('button', { name: 'Next record' }).click();
  const second = store.find('Related records • Pie', { limit: 1, offset: 2 }).records[0];
  const rows2 = store.get('Related records • Pie', second.recordId).portalData!['NW SalespersonCustomers'];
  await until(() => portal.locator('.fm-portal-row').count(), (n) => n >= rows2.length);
  assert.deepEqual(page.errors, []);
  await page.close();
});

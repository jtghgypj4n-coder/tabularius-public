// Two people in the same file at once, each in their own browser window, on a
// small database built here with no .fmp12: what one of them does shows in the
// other's window without a reload. An edit shows on the record and in list
// view, a new record counts in the total (not in a found set it wasn't found
// in), and a record deleted from under someone moves them to another.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
// The generated form's Name field.
const NAME = 5;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  store.setPassword('Bob', 'bob-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** The customers, fresh for each test. */
function customers(...names: string[]): void {
  const store = hosted.store('Shop');
  for (const r of store.find('Customers', { query: [{ Id: '*' }, { Name: '*' }] }).records) store.delete('Customers', Number(r.recordId));
  names.forEach((Name, i) => store.create('Customers', { Id: i + 1, Name }));
}

/** Ann's and Bob's windows, each signed in, in form view on the first customer. */
async function both(): Promise<[Page & { errors: string[] }, Page & { errors: string[] }]> {
  const out: (Page & { errors: string[] })[] = [];
  for (const [account, password] of [['Ann', 'ann-secret-1'], ['Bob', 'bob-secret-1']]) {
    const page = await window(await browser.newContext());
    await signIn(page, hosted.url, 'Shop', account, password);
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, NAME).inputValue(), (v) => v !== '');
    out.push(page);
  }
  return out as [Page & { errors: string[] }, Page & { errors: string[] }];
}

async function close(...pages: Page[]): Promise<void> {
  for (const page of pages) await page.context().close();
}

const count = (page: Page) => found(page).textContent().then((t) => t ?? '');

test('an edit in one window shows in the other\'s, on the record and in list view', { skip }, async () => {
  customers('Ada', 'Grace');
  const [ann, bob] = await both();
  try {
    await field(bob, NAME).fill('Ada Lovelace');
    await field(bob, NAME).press('Tab');
    await until(() => field(ann, NAME).inputValue(), (v) => v === 'Ada Lovelace');

    // In list view too, on the row it's on.
    await ann.getByRole('button', { name: 'View as List' }).click();
    await bob.getByRole('button', { name: 'Next record' }).click();
    await until(() => field(bob, NAME).inputValue(), (v) => v === 'Grace');
    await field(bob, NAME).fill('Grace Hopper');
    await field(bob, NAME).press('Tab');
    await until(() => ann.locator(`.fm[data-id="${NAME}"] input`).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
      (v) => v.join() === 'Ada Lovelace,Grace Hopper');
    assert.deepEqual(ann.errors, []);
    assert.deepEqual(bob.errors, []);
  } finally {
    await close(ann, bob);
  }
});

test('a record another person makes counts in the total, but not in a found set it wasn\'t found in', { skip }, async () => {
  customers('Ada', 'Alan', 'Hedy');
  const [ann, bob] = await both();
  try {
    // Ann finds two of the three.
    await ann.keyboard.press('ControlOrMeta+f');
    await field(ann, NAME).fill('a');
    await ann.keyboard.press('Enter');
    await until(() => count(ann), (t) => /^2Found \(Unsorted\)3 Total$/.test(t));

    await bob.getByRole('button', { name: 'New Record' }).click();
    await field(bob, NAME).fill('Amy');
    await field(bob, NAME).press('Tab');
    // Though it would have been found: Ann's found set is what her find found, until she finds again.
    await until(() => count(ann), (t) => /^2Found \(Unsorted\)4 Total$/.test(t));
    // Show All Records brings it in.
    await ann.keyboard.press('ControlOrMeta+j');
    await until(() => count(ann), (t) => /^4Total/.test(t));
    assert.deepEqual(ann.errors, []);
    assert.deepEqual(bob.errors, []);
  } finally {
    await close(ann, bob);
  }
});

test('a record deleted from under someone moves them on to another, and the count follows', { skip }, async () => {
  customers('Ada', 'Grace', 'Hedy');
  const [ann, bob] = await both();
  try {
    await until(() => count(ann), (t) => /^3Total/.test(t));
    await bob.keyboard.press('ControlOrMeta+e');
    await answer(bob, 'Delete Record', 'Delete');
    await until(() => count(bob), (t) => /^2Total/.test(t));
    await until(() => count(ann), (t) => /^2Total/.test(t));
    await until(() => field(ann, NAME).inputValue(), (v) => v === 'Grace');
    assert.deepEqual(ann.errors, []);
    assert.deepEqual(bob.errors, []);
  } finally {
    await close(ann, bob);
  }
});

test('a window that is closed or navigated away stops showing as "Also here" in the other\'s at once', { skip }, async () => {
  customers('Ada', 'Grace');
  const [ann, bob] = await both();
  try {
    // Earlier tests' windows may still be listed for a moment, so it is Bob that is waited for.
    const bobHere = ann.locator('.also-here[aria-label*="Bob"]');
    await bobHere.waitFor();
    // Closing a window never signs out, so the server has to notice the window is gone.
    await bob.context().close();
    await bobHere.waitFor({ state: 'detached' });
    assert.deepEqual(ann.errors, []);
  } finally {
    await close(ann, bob);
  }
});

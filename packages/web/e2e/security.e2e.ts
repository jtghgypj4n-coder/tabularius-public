// File > Manage > Security in the web client, in a real browser, on a small
// database built here with no .fmp12: a privilege set made and saved, an
// account added to it, that account signing in and finding it can look but
// not change, then its password set again, a password change asked for at
// next sign-in, and the account deleted after asking.
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
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Ann signed in, in Manage Security. */
async function security(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.menubar').getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage' }).first().hover();
  await page.getByRole('menuitem', { name: 'Security…' }).click();
  await page.getByRole('tab', { name: 'Accounts' }).waitFor();
  return page;
}

const account = (name: string) => hosted.store('Shop').accounts().find((a) => a.name === name);
const listed = (page: Page, name: string) => page.locator('.d-side li button', { has: page.locator('span:first-child', { hasText: new RegExp(`^${name}$`) }) });

test('a privilege set and an account made in Manage Security: the account can look but not change', { skip }, async () => {
  const page = await security();
  try {
    // A set that may view records and open layouts, and come in by the web.
    await page.getByRole('tab', { name: 'Privilege sets' }).click();
    await page.getByLabel('New set name').fill('Readers');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await until(async () => hosted.store('Shop').privilegeSets().some((p) => p.name === 'Readers'), (v) => v);
    await page.getByLabel('View', { exact: true }).first().selectOption('true');
    await page.getByLabel('Layouts default').selectOption('viewOnly');
    await page.getByLabel('fmwebdirect', { exact: true }).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => hosted.store('Shop').privilegeSets().find((p) => p.name === 'Readers')?.records.view, (v) => v === true);
    assert.equal(hosted.store('Shop').privilegeSets().find((p) => p.name === 'Readers')?.records.edit, false);

    // An account in it.
    await page.getByRole('tab', { name: 'Accounts' }).click();
    await page.getByLabel('Account name', { exact: true }).fill('Rita');
    await page.getByLabel('Password', { exact: true }).first().fill('rita-secret-1');
    await page.locator('.sec-create').getByLabel('Privilege set').selectOption('Readers');
    await page.getByRole('button', { name: 'Add account' }).click();
    await until(async () => account('Rita')?.privilegeSet, (v) => v === 'Readers');
    assert.equal(hosted.store('Shop').verify('Rita', 'rita-secret-1', ''), true);

    // Rita sees the record, and a change to it is not kept.
    const rita = await window(await browser.newContext());
    await signIn(rita, hosted.url, 'Shop', 'Rita', 'rita-secret-1');
    await rita.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(rita, NAME).inputValue(), (v) => v === 'Ada');
    await field(rita, NAME).fill('Changed');
    await field(rita, NAME).press('Tab');
    await until(() => rita.locator('.toast').allInnerTexts().then((t) => t.join(' ')), (t) => t.includes('Record access is denied (error 200)'));
    assert.equal(String(hosted.store('Shop').find('Customers', { query: [{ Id: '==1' }] }).records[0].fieldData.Name), 'Ada');
    await rita.context().close();
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('an account has its password set, a password change asked for, and is deleted after asking', { skip }, async () => {
  hosted.store('Shop').setPassword('Sam', 'sam-secret-1', '[Full Access]');
  const page = await security();
  try {
    await listed(page, 'Sam').click();
    await page.getByLabel('New password', { exact: true }).fill('sam-secret-2');
    await page.getByRole('button', { name: 'Set password' }).click();
    await until(async () => hosted.store('Shop').verify('Sam', 'sam-secret-2', ''), (v) => v);
    assert.equal(hosted.store('Shop').verify('Sam', 'sam-secret-1', ''), false);

    await page.getByLabel('User must change password on next sign-in').check();
    await page.locator('.d-row', { hasText: 'User must change password on next sign-in' }).getByRole('button', { name: 'Save' }).click();
    await until(async () => hosted.store('Shop').mustChangePassword('Sam'), (v) => v);

    // Delete asks first.
    const remove = page.getByRole('button', { name: /^Delete account/ });
    const messages: string[] = [];
    page.once('dialog', (d) => { messages.push(d.message()); void d.dismiss(); });
    await remove.click();
    assert.match(messages[0], /Delete account "Sam"/);
    assert.ok(account('Sam'));
    page.once('dialog', (d) => void d.accept());
    await remove.click();
    await until(async () => account('Sam') === undefined, (v) => v);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

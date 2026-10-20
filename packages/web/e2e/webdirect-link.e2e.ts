// A WebDirect-style link (/fmi/webd/<file>?script=...&param=...&$var=...) signs the person in and runs the script,
// but only when their privilege set has fmurlscript; a reload doesn't run it again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Links'] });
  const store = hosted.store('Links');
  store.applyDesign([
    { op: 'createTable', name: 'Notes', fields: [{ name: 'Title' }] },
    { op: 'createScript', name: 'Greet', text: 'Show Custom Dialog [ "Linked" ; "Hello " & $name & " from " & Get ( ScriptParameter ) ; Button 1: "OK" ]' },
  ] as DesignOp[]);
  store.create('Notes', { Title: 'Alpha' });
  const open = { view: true, edit: true, create: true, delete: true };
  const set = { records: open, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable' } as const;
  store.savePrivilegeSet({ name: 'Linker', ...set, extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest', 'fmurlscript'] } as never);
  store.savePrivilegeSet({ name: 'Plain', ...set, extendedPrivileges: ['fmapp', 'fmwebdirect', 'fmrest'] } as never);
  store.setPassword('Ann', 'ann-secret-1', 'Linker');
  store.setPassword('Bob', 'bob-secret-1', 'Plain');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

async function viaLink(account: string, password: string): Promise<Page> {
  const page = await window(await browser.newContext());
  await page.goto(`${hosted.url}/fmi/webd/Links?script=Greet&param=the%20link&%24name=Ann`);
  await page.locator('input[name="account"]').fill(account);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('select.layout-menu').waitFor();
  return page;
}

test('the link runs its script with the parameter and variables once the person has signed in', { skip }, async () => {
  const page = await viaLink('Ann', 'ann-secret-1');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Hello Ann from the link/);
  await dialog.getByRole('button', { name: 'OK' }).click();
  // The script is out of the address, so a reload doesn't ask for it again.
  assert.ok(!page.url().includes('script='), page.url());
  assert.ok(page.url().includes('db=Links'), page.url());
});

test('an account without fmurlscript is told so, and the script does not run', { skip }, async () => {
  const page = await viaLink('Bob', 'bob-secret-1');
  await until(() => page.locator('body').innerText(), (t) => /fmurlscript/.test(t));
  assert.equal(await page.getByRole('dialog').count(), 0);
});

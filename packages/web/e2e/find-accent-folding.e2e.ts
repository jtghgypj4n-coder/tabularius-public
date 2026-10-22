// A real browser records current word-find behavior for plain spellings of
// accented words and letters that have no accent to remove; parity stays open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { field, found, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let name = 0;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Words'] });
  const store = hosted.store('Words');
  store.applyDesign([{ op: 'createTable', name: 'Entries', fields: [{ name: 'Name' }] }] as DesignOp[]);
  name = store.design('Entries')!.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  for (const Name of ['café', 'Łódź', 'smørrebrød', 'straße']) store.create('Entries', { Name });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

test('word finds fold é, ł, ø and ß to their plain spellings in the web client', { skip }, async () => {
  const page = await window(browser);
  await signIn(page, hosted.url, 'Words', 'Ann', PASSWORD);
  const findCount = () => found(page).locator('b').textContent().then(Number);
  const run = async (query: string) => {
    if (!(await page.locator('button.tb', { hasText: 'Perform Find' }).count())) {
      await page.locator('button.tb', { hasText: 'Find' }).first().click();
      await page.locator('button.tb', { hasText: 'Perform Find' }).waitFor();
    }
    await field(page, name).fill(query);
    await page.locator('button.tb', { hasText: 'Perform Find' }).first().click();
    const alert = page.locator('dialog.no-match-dialog');
    const perform = page.locator('button.tb', { hasText: 'Perform Find' });
    await until(async () => [await alert.isVisible(), !(await perform.count())] as const, ([noMatch, completed]) => noMatch || completed);
    if (await alert.isVisible()) {
      await alert.getByRole('button', { name: 'Modify Find' }).click();
      await alert.waitFor({ state: 'detached' });
      assert.ok(await page.locator('button.tb', { hasText: 'Perform Find' }).count());
      return 0;
    }
    return await findCount();
  };
  const observed: Record<string, number> = {};
  for (const query of ['cafe', 'lodz', 'smorrebrod', 'strasse', 'café', 'Łódź', 'smørrebrød', 'straße']) observed[query] = await run(query);
  assert.deepEqual(observed, { cafe: 1, lodz: 1, smorrebrod: 1, strasse: 1, 'café': 1, 'Łódź': 1, 'smørrebrød': 1, 'straße': 1 });
  assert.deepEqual(page.errors, []);
  await page.close();
});

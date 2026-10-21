import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { answer, field, goToLayout, host, launch, signIn, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
const PASSWORD = 'url-state-test-1';
let idObject = 0;
const WALK = 940;
const tool = (page: Page, label: string) => page.locator('button.tb', { hasText: label }).first();

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Links'] });
  const store = hosted.store('Links');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] as DesignOp[]);
  idObject = store.design('People')!.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  // A script that goes to the first record and then four on: the address has to follow where it leaves the screen.
  store.applyDesign([{ op: 'createScript', name: 'Walk', text: 'Go to Record/Request/Page [ First ]\nGo to Record/Request/Page [ Next ]\nGo to Record/Request/Page [ Next ]\nGo to Record/Request/Page [ Next ]\nGo to Record/Request/Page [ Next ]' }] as DesignOp[]);
  // A commit trigger: its script ends with the window's own address write, which Back must not lose to.
  store.applyDesign([{ op: 'createScript', name: 'Marker', text: 'Set Variable [ $marked ; Value: 1 ]' }] as DesignOp[]);
  const people = store.design('People')!;
  const walkId = store.schema.scripts.find((x) => x.name === 'Walk')!.id;
  const walkButton = { id: WALK, kind: 'button', type: 0, text: 'Walk', anchors: { left: true, top: true, right: false, bottom: false }, style: {}, bounds: { top: 200, left: 20, bottom: 224, right: 130 }, action: { stepId: 1, step: 'Perform Script', scriptId: walkId, script: 'Walk' } } as LayoutObject;
  store.applyDesign([{ op: 'updateLayout', layout: 'People', design: {
    parts: people.parts.map((part) => part.kind === 'body' ? { ...part, height: 240 } : part.kind === 'footer' ? { ...part, top: 300 } : part),
    objects: [...people.objects, walkButton],
    triggers: [{ event: 'OnRecordCommit', scriptId: store.schema.scripts.find((x) => x.name === 'Marker')!.id, script: 'Marker', parameter: '' }],
  } }] as DesignOp[]);
  for (const Name of ['Ada', 'Alan', 'Grace', 'Edsger', 'Barbara', 'Hedy']) store.create('People', { Name });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  store.savePrivilegeSet({ name: 'Restricted', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', layoutAccess: { People: { layout: 'none', records: 'none' } }, valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmapp'] });
  store.setPassword('Rae', 'restricted-account-1', 'Restricted');
  browser = await launch();
});
after(async () => { await browser?.close(); await hosted?.close(); });

/** What the address says the screen shows: the tab title and, in the form view, the field value must follow it, not just the address. */
async function screenFollowsAddress(page: Page): Promise<void> {
  const url = new URL(page.url());
  const recordId = url.searchParams.get('record');
  const rows = hosted.store('Links').find('People', { limit: 100 }).records;
  const position = rows.findIndex((r) => String(r.recordId) === recordId) + 1;
  assert.ok(position > 0, `record ${recordId} is in the found set`);
  await until(() => page.title(), (title) => title.endsWith(`Record ${position}`), 10_000);
  if (url.searchParams.get('view') === 'form') {
    await until(() => field(page, idObject).inputValue(), (value) => value === String(rows[position - 1].fieldData.Name), 10_000);
  }
}

async function open(): Promise<Page & { errors: string[] }> {
  const page = await window(await browser.newContext());
  await signIn(page, hosted.url, 'Links', 'Ann', PASSWORD);
  await page.getByRole('button', { name: 'View as Form' }).click();
  await until(() => field(page, idObject).inputValue(), (v) => !!v);
  return page;
}

test('URL restores layout, record and view on reload; browser history follows screen changes', { skip }, async () => {
  const page = await open();
  try {
    const initial = new URL(page.url());
    assert.equal(initial.searchParams.get('db'), 'Links');
    assert.equal(initial.searchParams.get('layout'), 'People');
    assert.equal(initial.searchParams.get('view'), 'form');
    assert.match(await page.title(), /^Links - People - Record 1$/);

    // Ten meaningful navigation steps create ten restorable browser history entries.
    const history: string[] = [page.url()];
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Next Record' }).click();
      await until(() => page.title(), (title) => title.endsWith(`Record ${i + 2}`));
      history.push(page.url());
      const view = i % 2 === 0 ? 'list' : 'form';
      await page.getByRole('button', { name: view === 'list' ? 'View as List' : 'View as Form' }).click();
      await until(async () => new URL(page.url()).searchParams.get('view'), (actual) => actual === view);
      history.push(page.url());
    }
    assert.ok(await page.evaluate(() => history.length) >= 11, 'record and view changes must append browser history entries');
    const target = new URL(page.url());
    assert.equal(target.searchParams.get('record'), String(hosted.store('Links').find('People', { limit: 100 }).records[5].recordId));
    await page.reload();
    await until(async () => new URL(page.url()).searchParams.get('view'), (view) => view === 'list');
    assert.equal(new URL(page.url()).searchParams.get('record'), target.searchParams.get('record'));
    // The screen is drawn (not only the address read) before the first Back, so Back cannot arrive while the file is still opening.
    await screenFollowsAddress(page);
    assert.deepEqual(page.errors, []);

    // Each step waits for the address to change, so a slow runner can't leave a traversal half done.
    const backs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const before = page.url();
      await page.goBack({ waitUntil: 'commit' });
      backs.push(await until(async () => page.url(), (url) => url !== before));
      await screenFollowsAddress(page);
    }
    assert.ok(new Set(backs).size >= 8, 'Back must traverse the ten distinct record and view steps');
    for (let i = 0; i < 10; i++) {
      const before = page.url();
      await page.goForward({ waitUntil: 'commit' });
      await until(async () => page.url(), (url) => url !== before);
      await screenFollowsAddress(page);
    }
    await until(async () => page.url(), (url) => url === target.href, 10_000);
    assert.deepEqual(page.errors, []);

  } finally {
    await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
    await page.context().close();
  }
});

test('Back pressed several times without waiting ends on the screen the address names', { skip }, async () => {
  const page = await open();
  try {
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Next Record' }).click();
      await until(() => page.title(), (title) => title.endsWith(`Record ${i + 2}`));
    }
    await page.evaluate(() => { history.back(); history.back(); history.back(); });
    // However the three Backs interleaved, the address settles and the screen settles on it.
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === String(hosted.store('Links').find('People', { limit: 100 }).records[1].recordId), 10_000);
    await screenFollowsAddress(page);
    await page.evaluate(() => { history.forward(); history.forward(); });
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === String(hosted.store('Links').find('People', { limit: 100 }).records[3].recordId), 10_000);
    await screenFollowsAddress(page);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
    await page.context().close();
  }
});

const historyLength = (page: Page) => page.evaluate(() => history.length);
const idAt = (position: number) => String(hosted.store('Links').find('People', { limit: 100 }).records[position - 1].recordId);

test('a script that moves through records leaves the address, title and history on where it ended, and Back returns to where it started', { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Next Record' }).click();
    await until(() => page.title(), (title) => title.endsWith('Record 2'));
    const before = await historyLength(page);
    await page.locator(`.fm[data-id="${WALK}"]`).click();
    await until(() => page.title(), (title) => title.endsWith('Record 5'));
    assert.equal(new URL(page.url()).searchParams.get('record'), idAt(5));
    assert.equal(await historyLength(page), before + 1, 'one entry for the whole script, not one per move');
    await page.goBack({ waitUntil: 'commit' });
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === idAt(2));
    await screenFollowsAddress(page);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
    await page.context().close();
  }
});

test('Perform Find, New Record, Delete Record and Show All each leave the address and title on what is shown', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await until(async () => new URL(page.url()).searchParams.get('mode'), (mode) => mode === 'find');
    await field(page, idObject).fill('Grace');
    await tool(page, 'Perform Find').click();
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '1');
    assert.equal(new URL(page.url()).searchParams.get('mode'), 'browse');
    assert.equal(new URL(page.url()).searchParams.get('record'), idAt(3));
    await until(() => page.title(), (title) => title.endsWith('Record 1'));
    await until(() => field(page, idObject).inputValue(), (value) => value === 'Grace');

    await tool(page, 'Show All').click();
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '6');

    await tool(page, 'New Record').click();
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '7');
    const created = new URL(page.url()).searchParams.get('record');
    assert.ok(created && !hosted.store('Links').find('People', { limit: 100 }).records.slice(0, 6).some((r) => String(r.recordId) === created), 'the address names the new record');
    await until(() => page.title(), (title) => title.endsWith('Record 7'));

    await tool(page, 'Delete Record').click();
    await answer(page, 'Delete Record', 'Delete');
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '6');
    assert.notEqual(new URL(page.url()).searchParams.get('record'), created);
    await until(() => page.title(), (title) => /Record \d$/.test(title) && !title.endsWith('Record 7'));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
    await page.context().close();
  }
});

test('Back after a Find restores the full set, and Back to a deleted record says so and leaves the address alone', { skip }, async () => {
  const page = await open();
  try {
    await tool(page, 'Find').click();
    await tool(page, 'Perform Find').waitFor();
    await field(page, idObject).fill('Grace');
    await tool(page, 'Perform Find').click();
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '1');
    await page.goBack({ waitUntil: 'commit' });
    await page.goBack({ waitUntil: 'commit' });
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === idAt(1));
    await until(() => page.title(), (title) => title.endsWith('Record 1'));
    await until(() => field(page, idObject).inputValue(), (value) => value === 'Ada');
    assert.equal(new URL(page.url()).searchParams.get('found'), '6', 'the entry still says what it said');
    await page.getByRole('button', { name: 'Next Record' }).click();
    await until(() => page.title(), (title) => title.endsWith('Record 2'));

    await tool(page, 'New Record').click();
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '7');
    const created = new URL(page.url()).searchParams.get('record');
    await tool(page, 'Delete Record').click();
    await answer(page, 'Delete Record', 'Delete');
    await until(async () => new URL(page.url()).searchParams.get('found'), (found) => found === '6');
    const landed = new URL(page.url()).searchParams.get('record');
    await page.goBack({ waitUntil: 'commit' });
    await until(async () => page.locator('body').innerText(), (text) => text.includes('no longer exists'));
    assert.equal(new URL(page.url()).searchParams.get('record'), created, 'the entry keeps the record it named');
    await page.goForward({ waitUntil: 'commit' });
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === landed);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
    await page.context().close();
  }
});

test('Back with a field being typed in (on a layout with a commit trigger) saves it to its own record and still goes back', { skip }, async () => {
  const page = await open();
  const store = hosted.store('Links');
  const names = () => store.find('People', { limit: 100 }).records.map((r) => String(r.fieldData.Name));
  const original = names();
  try {
    await page.getByRole('button', { name: 'Next Record' }).click();
    await page.getByRole('button', { name: 'Next Record' }).click();
    await until(() => page.title(), (title) => title.endsWith('Record 3'));
    await field(page, idObject).fill('Typed in three');
    await page.goBack({ waitUntil: 'commit' });
    await until(() => page.title(), (title) => title.endsWith('Record 2'));
    await until(async () => names()[2], (name) => name === 'Typed in three');
    assert.deepEqual(names().filter((_, i) => i !== 2), original.filter((_, i) => i !== 2), 'no other record changed');
    assert.equal(new URL(page.url()).searchParams.get('record'), idAt(2), 'the trigger\'s script did not put the old address back');
    await page.goForward({ waitUntil: 'commit' });
    await until(() => page.title(), (title) => title.endsWith('Record 3'));
    await until(() => field(page, idObject).inputValue(), (value) => value === 'Typed in three');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
    await page.context().close();
    // The window's record lock goes with its session; then the names are put back for the tests after this one.
    await until(async () => {
      try {
        store.find('People', { limit: 100 }).records.forEach((r, i) => { if (String(r.fieldData.Name) !== original[i]) store.update('People', Number(r.recordId), { Name: original[i] }); });
        return true;
      } catch { return false; }
    }, (done) => done, 10_000);
  }
});

test('after the session ended and the person signed in again, Back restores the screen and does not end the new session', { skip }, async () => {
  const store = hosted.store('Links');
  const hedy = Number(store.find('People', { limit: 100 }).records[5].recordId);
  // Another full-access account, so the one turned off is not the last.
  store.setPassword('Eli', PASSWORD, '[Full Access]');
  const page = await window(await browser.newContext());
  try {
    await signIn(page, hosted.url, 'Links', 'Eli', PASSWORD);
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, idObject).inputValue(), (v) => !!v);
    await page.getByRole('button', { name: 'Next Record' }).click();
    await until(() => page.title(), (title) => title.endsWith('Record 2'));
    store.setAccountActive('Eli', false);
    // The window learns its session ended as soon as there is a change it would have been told about.
    store.update('People', hedy, { Name: 'Hedy L' });
    await page.locator('select[name="db"]').waitFor();
    store.setAccountActive('Eli', true);
    store.unlock('Eli');
    await page.locator('select[name="db"]').selectOption('Links');
    await page.locator('input[name="account"]').fill('Eli');
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('select.layout-menu').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, idObject).inputValue(), (v) => !!v);
    await page.getByRole('button', { name: 'Next Record' }).click();
    await until(() => page.title(), (title) => /Record \d$/.test(title));
    const here = new URL(page.url()).searchParams.get('record');
    await page.goBack({ waitUntil: 'commit' });
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record !== here);
    await screenFollowsAddress(page);
    assert.equal(await page.locator('select[name="db"]').count(), 0, 'still signed in');
    assert.doesNotMatch(await page.locator('body').innerText(), /session ended/);
  } finally {
    store.update('People', hedy, { Name: 'Hedy' });
    store.setAccountActive('Eli', true);
    await page.context().close();
  }
});

test('after a link the account cannot open, moving through the app still adds history entries', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await page.goto(`${hosted.url}/app/?db=Links&layout=Nowhere&record=1&mode=browse&view=form`);
    await page.locator('select[name="db"]').selectOption('Links');
    await page.locator('input[name="account"]').fill('Ann');
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await until(async () => page.locator('body').innerText(), (text) => text.includes('This link is not available to your account.'));
    await goToLayout(page, 'People');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, idObject).inputValue(), (v) => !!v);
    const before = await historyLength(page);
    await page.getByRole('button', { name: 'Next Record' }).click();
    await until(() => page.title(), (title) => title.endsWith('Record 2'));
    assert.equal(await historyLength(page), before + 1, 'a move adds an entry once the app is open');
  } finally { await page.context().close(); }
});

test('Back pressed at different moments while the page reloads is honoured and the screen follows it', { skip }, async () => {
  for (const offset of [0, 40, 120, 250, 500]) {
    const page = await open();
    try {
      for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Next Record' }).click();
      await until(() => page.title(), (title) => title.endsWith('Record 3'));
      await page.reload();
      await page.evaluate((ms) => new Promise<void>((resolve) => setTimeout(() => { history.back(); resolve(); }, ms)), offset);
      await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === idAt(2), 15_000);
      await screenFollowsAddress(page);
      assert.deepEqual(page.errors, [], `Back ${offset} ms after the reload`);
    } finally {
      await page.getByRole('button', { name: 'Log out' }).click().catch(() => {});
      await page.context().close();
    }
  }
});

test('opening a shared link adds no history entry, so Back from it leaves the app', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await page.goto(`${hosted.url}/app/?db=Links&layout=People&record=3&mode=browse&view=list`);
    const before = await page.evaluate(() => history.length);
    await page.locator('select[name="db"]').selectOption('Links');
    await page.locator('input[name="account"]').fill('Ann');
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('.fm-part').first().waitFor();
    await until(async () => new URL(page.url()).searchParams.get('record'), (record) => record === '3');
    assert.equal(await page.evaluate(() => history.length), before, 'opening replaces the address, it does not add to the history');
    assert.deepEqual(page.errors, []);
    await page.goBack({ waitUntil: 'commit' });
    await until(async () => page.url(), (url) => !url.startsWith(`${hosted.url}/app/`), 10_000);
  } finally { await page.context().close(); }
});

test('a shared link for an account that cannot open its layout gets a plain refusal', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await page.goto(`${hosted.url}/app/?db=Links&layout=People&record=1&mode=browse&view=form`);
    await page.locator('select[name="db"]').selectOption('Links');
    await page.locator('input[name="account"]').fill('Rae');
    await page.locator('input[name="password"]').fill('restricted-account-1');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await until(async () => page.locator('body').innerText(), (text) => text.includes('This link is not available to your account.'));
    assert.deepEqual(page.errors, []);
  } finally { await page.context().close(); }
});

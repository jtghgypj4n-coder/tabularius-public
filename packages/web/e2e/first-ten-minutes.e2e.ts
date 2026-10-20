// The first ten minutes of a newcomer, in a real browser: a server started on an empty folder, a .fmp12 dropped on the
// welcome page, hosted, signed in to, a record edited, found and sorted, the admin console opened. Then each mistake
// a newcomer makes with that first file (a PDF or a zip, an empty or cut-off file, one that is too big, one with the
// same name twice, an unusual name, one with Encryption at Rest, a page closed in the middle of sending), which must
// end in words that say what happened and what to do next, with no stack trace, path or bare code.
import './small-upload-cap.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { FIXTURES, field, found, host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless('Standards.fmp12', 'Flicks.fmp12');
let hosted: Hosted;
let browser: Browser;
let standards: Buffer;
const PASSWORD = 'ann-secret-1';

before(async () => {
  if (skip) return;
  standards = readFileSync(join(FIXTURES, 'Standards.fmp12'));
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  for (const [Id, Name] of [[1, 'Ada'], [2, 'Grace'], [3, 'Alan']] as const) store.create('Customers', { Id, Name });
  store.setPassword('Ann', PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

type Window = Page & { errors: string[] };

async function welcome(): Promise<Window> {
  const page = await window(await browser.newContext());
  await page.goto(hosted.url + '/admin/#welcome');
  await page.locator('#welcome-file').waitFor({ state: 'attached' });
  return page;
}

/** Drops a file (named and filled as given) on the welcome page. */
async function drop(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('#welcome-file').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
}

const status = (page: Page) => page.locator('#welcome-status');
const said = (page: Page) => page.locator('#welcome-said');

/** Text a person must never be shown for a mistake. */
function assertPlain(text: string, what: string): void {
  // The hosted folder is named on purpose where the page tells someone to copy a file there.
  text = text.replaceAll(hosted.dir, '<the hosted folder>');
  assert.doesNotMatch(text, /\bat \S+\.(?:ts|js|mjs):\d+|\bat async |\[object|\bundefined\b|\bnull\b|\bENOENT\b|\bEACCES\b|\bTypeError\b|\bRangeError\b|\bError:|block \d+ out of range|bad magic|\bHTTP \d{3}\b|\/tmp\/|\/home\/|tabularius-e2e/i, `${what}: ${text}`);
}

/** The words shown for a file, once the page has finished with it. */
async function outcome(page: Page, pattern: RegExp): Promise<string> {
  const text = await until(() => status(page).innerText(), (t) => pattern.test(t));
  assertPlain(text, 'welcome');

  assert.ok((await said(page).textContent())?.trim(), 'a screen reader is told as well');
  return text;
}

test('a dropped file is hosted and opens at its sign-in; the account in it signs in with no password, and the admin console is one click away', { skip }, async () => {
  const page = await welcome();
  assert.match(await page.locator('#welcome').innerText(), /Drop a FileMaker file \(\.fmp12\)/);
  await drop(page, 'Standards.fmp12', standards);
  await page.waitForURL(/\/app\/\?db=Standards/, { timeout: 90_000 });
  assert.equal(await page.locator('select[name="db"]').inputValue(), 'Standards');
  assert.equal(await page.locator('input[name="account"]').inputValue(), 'Admin');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.fm-part').first().waitFor();
  // The file's start-up script may move on to another layout; one of the file's own is showing either way.
  assert.ok(['@Startup', 'Interface', 'English'].includes(await page.locator('select.layout-menu').inputValue()));
  assert.deepEqual(page.errors, []);
  // The file is listed where an administrator looks.
  const admin = await window(await browser.newContext());
  await admin.goto(hosted.url + '/admin/');
  await until(() => admin.locator('#dbs').innerText(), (t) => /Standards/.test(t));
  assert.deepEqual(admin.errors, []);
});

test('on a small database: a record is edited, found and sorted', { skip }, async () => {
  const page = await window(await browser.newContext());
  await page.goto(hosted.url + '/app/');
  await page.locator('select[name="db"]').selectOption('Shop');
  await page.locator('input[name="account"]').fill('Ann');
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.fm-part').first().waitFor();
  await page.getByRole('button', { name: 'View as Form' }).click();
  const design = hosted.store('Shop').design('Customers')!;
  const name = design.objects.find((o) => o.kind === 'field' && o.field?.field === 'Name')!.id;
  await until(() => page.locator(`.fm[data-id="${name}"]`).count(), (n) => n === 1);
  await field(page, name).fill('Ada Lovelace');
  await field(page, name).press('Tab');
  await until(async () => hosted.store('Shop').find('Customers', { limit: 10 }).records.some((r) => r.fieldData.Name === 'Ada Lovelace'), Boolean);
  // The toolbar is drawn again after a save, so a search typed into it just then can be lost: ask until it takes.
  const search = (text: string, count: string) => until(async () => {
    const quick = page.getByRole('searchbox', { name: 'Quick find' });
    await quick.fill(text);
    await quick.press('Enter');
    await new Promise((r) => setTimeout(r, 300));
    return found(page).locator('b').textContent();
  }, (t) => t === count);
  await search('Grace', '1');
  await search('', '3');
  await page.locator('.menubar').getByRole('button', { name: 'Records', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Sort Records/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Sort records' });
  await dialog.getByRole('listbox', { name: 'Fields' }).selectOption('Name');
  await dialog.getByRole('button', { name: 'Add →' }).click();
  await dialog.getByRole('button', { name: 'Sort', exact: true }).click();
  await until(() => found(page).textContent(), (t) => /Sorted/.test(t ?? ''));
  assert.deepEqual(page.errors, []);
});

test('a PDF or a zip is turned away at once, in words, and nothing is sent', { skip }, async () => {
  const page = await welcome();
  for (const name of ['report.pdf', 'archive.zip', 'Standards.fmp12.zip', 'Standards']) {
    await drop(page, name, Buffer.from('%PDF-1.4 not a database'));
    const text = await outcome(page, /FileMaker database file/);
    assert.match(text, new RegExp(name.replace('.', '\\.')));
    assert.match(text, /ends in \.fmp12/);
  }
  assert.equal(hosted.host.names().includes('report'), false);
  assert.deepEqual(page.errors, []);
});

test('an empty file says it is empty and that the copy may not have finished', { skip }, async () => {
  const page = await welcome();
  await drop(page, 'Empty.fmp12', Buffer.alloc(0));
  const text = await outcome(page, /is empty/);
  assert.match(text, /copy it again/);
  assert.deepEqual(page.errors, []);
});

test('a file cut off part of the way, and one that is not a FileMaker database, say which and what to do', { skip }, async () => {
  const page = await welcome();
  await drop(page, 'Cut.fmp12', standards.subarray(0, 100_000));
  assert.match(await outcome(page, /Cut\.fmp12 ends too early/), /Copy it again.*size matches/);
  await drop(page, 'Fake.fmp12', Buffer.from('this is plain text, renamed\n'.repeat(500)));
  assert.match(await outcome(page, /Fake\.fmp12 isn't a FileMaker database/), /not a backup, an export/);
  await drop(page, 'Zeros.fmp12', Buffer.alloc(40_000));
  await outcome(page, /Zeros\.fmp12 isn't a FileMaker database/);
  assert.equal(hosted.host.names().some((n) => ['Cut', 'Fake', 'Zeros'].includes(n)), false, 'none was hosted');
  // The failed ones leave nothing behind that stops the same name being tried again.
  await drop(page, 'Cut.fmp12', standards.subarray(0, 100_000));
  await outcome(page, /Cut\.fmp12 ends too early/);
  assert.deepEqual(page.errors, []);
});

test('a file over the upload limit says how big it is, what the limit is, and two ways on', { skip }, async () => {
  const page = await welcome();
  await drop(page, 'Big.fmp12', Buffer.alloc(8 * 1024 * 1024 + 1));
  const text = await outcome(page, /more than the/);
  assert.match(text, /Big\.fmp12 is 8,388,609 bytes, more than the 8,388,608 bytes this server takes in one upload/);
  assert.match(text, /hosted folder/);
  assert.match(text, /TABULARIUS_MAX_UPLOAD/);
  assert.deepEqual(page.errors, []);
});

test('the same file twice: the second says it is already hosted and links to it; a name with spaces, accents and an emoji hosts and opens', { skip }, async () => {
  const page = await welcome();
  await drop(page, 'Copy of Standards.fmp12', standards);
  await page.waitForURL(/\/app\/\?db=Copy%20of%20Standards/, { timeout: 90_000 });
  await page.locator('select[name="db"]').waitFor();
  assert.equal(await page.locator('select[name="db"]').inputValue(), 'Copy of Standards');

  const again = await welcome();
  await drop(again, 'Copy of Standards.fmp12', standards);
  const text = await outcome(again, /already hosted/);
  assert.match(text, /Open Copy of Standards/);
  assert.match(text, /remove it from Hosted files first|rename this file/);
  assert.equal(await again.getByRole('link', { name: 'Open Copy of Standards' }).getAttribute('href'), '/app/?db=Copy%20of%20Standards');
  // Case does not make a different file.
  await drop(again, 'COPY OF STANDARDS.fmp12', standards);
  await outcome(again, /already hosted/);

  const odd = await welcome();
  await drop(odd, 'Mon dossier é 😀.fmp12', standards);
  await odd.waitForURL(/\/app\/\?db=Mon%20dossier%20%C3%A9%20%F0%9F%98%80/, { timeout: 90_000 });
  await odd.locator('select[name="db"]').waitFor();
  assert.equal(await odd.locator('select[name="db"]').inputValue(), 'Mon dossier é 😀');
  await odd.locator('input[name="account"]').fill('Admin');
  await odd.getByRole('button', { name: 'Open', exact: true }).click();
  await odd.locator('.fm-part').first().waitFor();
  assert.deepEqual([page.errors, again.errors, odd.errors], [[], [], []]);
});

test('a file dropped while another is being converted waits its turn and is hosted, and the first is not disturbed', { skip }, async () => {
  const first = await welcome();
  const second = await welcome();
  await drop(first, 'Flicks.fmp12', readFileSync(join(FIXTURES, 'Flicks.fmp12')));
  await until(() => status(first).innerText(), (t) => /Uploading|Converting|Waiting/.test(t));
  await drop(second, 'Second one.fmp12', standards);
  await first.waitForURL(/\/app\/\?db=Flicks/, { timeout: 120_000 });
  await second.waitForURL(/\/app\/\?db=Second%20one/, { timeout: 120_000 });
  assert.deepEqual([first.errors, second.errors], [[], []]);
});

test('a name a file cannot be hosted under says what to change', { skip }, async () => {
  const page = await welcome();
  await drop(page, 'what?.fmp12', standards);
  const text = await outcome(page, /isn't a name a file can be hosted under/);
  assert.match(text, /Rename it/);
  await drop(page, 'CON.fmp12', standards);
  await outcome(page, /isn't a name a file can be hosted under/);
  assert.deepEqual(page.errors, []);
});

/** An Encryption at Rest copy of a plaintext .fmp12, as FileMaker writes one (see the reader's encryption test). */
function encrypt(plain: Uint8Array, passphrase: string, hint: string): Buffer {
  const BLOCK = 4096, BODY = 4064, SALT_OFF = 0xfa;
  const salt = Buffer.alloc(16, 7);
  const key = pbkdf2Sync(Buffer.from(passphrase, 'utf16le'), salt, 18000, 32, 'sha1');
  const out = Buffer.from(plain);
  out.set(Buffer.from('HBAMe', 'ascii'), 15);
  out.set(Buffer.from(hint, 'utf16le'), 20);
  out.set(salt, SALT_OFF);
  for (let base = BLOCK; base + BLOCK <= out.length; base += BLOCK) {
    const iv = Buffer.alloc(16);
    iv.writeUInt32LE(base / BLOCK, 0);
    const c = createCipheriv('aes-256-cbc', key, iv);
    c.setAutoPadding(false);
    out.set(Buffer.concat([c.update(out.subarray(base, base + BODY)), c.final()]), base);
    out.set(iv, base + BODY);
  }
  return out;
}

test('a file with Encryption at Rest is received and waits for its passphrase, which the page says where to enter', { skip }, async () => {
  const page = await welcome();
  await drop(page, 'Locked.fmp12', encrypt(standards, 'Tabularius!', 'the record keeper'));
  const text = await outcome(page, /uses Encryption at Rest/);
  assert.match(text, /Enter it under Hosted files/);
  await until(() => page.locator('#dbs').innerText(), (t) => /Locked/.test(t) && /Needs passphrase/.test(t));
  assert.deepEqual(page.errors, []);
});

test('a page closed in the middle of sending leaves a name that can be taken over with one button', { skip }, async () => {
  const first = await welcome();
  // Start sending, as the page does, and stop after the first piece, as closing the tab does.
  await first.evaluate(async (size) => {
    const w = globalThis as unknown as { call(m: string, p: string, b?: unknown): Promise<{ id: string }> };
    const u = await w.call('POST', '/tabularius/admin/v1/uploads', { name: 'Halfway.fmp12', size });
    await fetch(`/tabularius/admin/v1/uploads/${u.id}?offset=0`, { method: 'PUT', headers: { 'x-tabularius-console': '1', 'x-tabularius-admin': '1', 'content-type': 'application/octet-stream' }, body: new Uint8Array(1000) });
  }, standards.length);
  await first.context().close();

  const page = await welcome();
  await drop(page, 'Halfway.fmp12', standards);
  const text = await outcome(page, /never finished/);
  assert.match(text, /probably in a page that was closed/);
  await page.getByRole('button', { name: 'Remove it and start again' }).click();
  await page.waitForURL(/\/app\/\?db=Halfway/, { timeout: 90_000 });
  assert.deepEqual(page.errors, []);
});

test('the whole welcome works from the keyboard and tells a screen reader what happens', { skip }, async () => {
  const page = await welcome();
  // The file box is reachable by Tab and shows where focus is.
  await page.locator('#welcome-file').focus();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'welcome-file');
  const ring = await page.locator('#drop').evaluate((e) => getComputedStyle(e).outlineStyle + '|' + getComputedStyle(e).boxShadow);
  assert.notEqual(ring, 'none|none', 'focus is visible on the drop box');
  assert.equal(await page.locator('#welcome-said').getAttribute('role'), 'status', 'changes are announced');
  await drop(page, 'notes.txt', Buffer.from('hello'));
  assert.match((await said(page).textContent()) ?? '', /isn't a FileMaker database file/, 'what went wrong is read out');
  assert.equal(await page.locator('#error').getAttribute('role'), 'alert');
});

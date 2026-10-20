// The admin console's Backups folder box, in a real browser: type a folder, Set, and the schedule line names it;
// a bad folder says why and changes nothing; an empty box goes back to the default.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let page: Page & { errors: string[] };
let target: string;

before(async () => {
  if (skip) return;
  target = mkdtempSync(join(tmpdir(), 'tabularius-e2e-backup-folder-'));
  hosted = await host({ stores: ['Local'] });
  browser = await launch();
  page = await window(browser);
});
after(async () => {
  await browser?.close();
  await hosted?.close();
  if (target) rmSync(target, { recursive: true, force: true, maxRetries: 5 });
});

test('the Backups folder box sets, refuses and clears the folder', { skip }, async () => {
  await page.goto(hosted.url + '/admin/');
  await until(() => page.locator('#updated').textContent(), (t) => !!t?.startsWith('Updated'));
  // This host has no schedule, so the line says where Back up now goes.
  const box = page.locator('#backup-folder');
  await box.fill(join(target, 'sets'));
  await page.locator('#backup-folder-set').click();
  await until(() => page.locator('#schedule').textContent(), (t) => !!t?.includes(join(target, 'sets')));

  // A relative path is refused with its reason, and nothing changes.
  await box.fill('relative/path');
  await page.locator('#backup-folder-set').click();
  await until(() => page.locator('#said-text').textContent(), (t) => /full path/.test(t ?? ''));
  assert.ok((await page.locator('#schedule').textContent())!.includes(join(target, 'sets')));

  // Empty goes back to the default folder.
  await box.fill('');
  await page.locator('#backup-folder-set').click();
  await until(() => page.locator('#schedule').textContent(), (t) => !t?.includes(join(target, 'sets')));
  assert.deepEqual(page.errors, []);
});

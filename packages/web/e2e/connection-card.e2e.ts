// The card under an assistant answer that drafted a connection, in a real browser: the settings are shown with where the
// keys will go, the keys are typed into password boxes (and cleared once set, never shown again), Test and Approve work,
// and a server that leaves connections to the console shows the draft and says so. The model is a stand-in answering
// from the page; the connection's own requests reach a stand-in too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, signIn, skipUnless, window, type Hosted } from './harness.ts';

const skip = skipUnless();
const KEYS = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
let hosted: Hosted;
let browser: Browser;

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'], appConnections: true });
  hosted.store('Shop').applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }] }] as DesignOp[]);
  hosted.store('Shop').setPassword('Ann', 'ann-secret-1', '[Full Access]');
  hosted.host.connections!.io = { fetch: async () => new Response('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 }) };
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

/** Opens the assistant on a page whose model answers with a draft of the named connection. */
async function ask(page: Page, name: string): Promise<void> {
  hosted.host.connections!.create({ name, type: 's3', config: { bucket: 'acme-invoices', region: 'us-east-1' }, files: ['Shop'], note: 'Scanned invoices' }, 'ai');
  await page.route('**/tabularius/assistant/v1/databases/Shop', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { available: true, canDesign: true, canExplainScripts: true, model: 'claude-sonnet-5-5' } })
    : route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ done: { reply: 'I made a draft.', proposals: [], foundSets: [], drafts: [], charts: [], dashboards: [], cleanups: [], automations: [], connections: [{ name }], tools: ['draft_connection'], usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1 } } }) + '\n' }));
  await signIn(page, hosted.url, 'Shop', 'Ann', 'ann-secret-1');
  await page.locator('.ai-button').first().click();
  await page.locator('textarea.ai-input').fill('Set up an S3 connection to our invoices bucket');
  await page.keyboard.press('Enter');
}

test('the card shows the draft, takes the keys in password boxes, tests and approves it', { skip }, async () => {
  const page = await window(await browser.newContext());
  try {
    await ask(page, 'invoices');
    const card = page.locator('.ai-proposal.connection');
    await card.getByText('Connection: invoices (').waitFor();
    await card.getByText('Bucket: acme-invoices').waitFor();
    await card.getByText('Your keys will be sent to https://s3.us-east-1.amazonaws.com').waitFor();
    // Nothing to test or approve until the keys are set.
    assert.equal(await card.getByRole('button', { name: 'Approve' }).isDisabled(), true);
    const access = card.getByLabel('Access key ID');
    assert.equal(await access.getAttribute('type'), 'password');
    await access.fill(KEYS.accessKey);
    await access.locator('xpath=following-sibling::button[1]').click();
    await card.getByLabel('Secret access key').waitFor();
    await card.getByLabel('Secret access key').fill(KEYS.secretKey);
    await card.getByLabel('Secret access key').locator('xpath=following-sibling::button[1]').click();
    await page.waitForFunction(() => !document.querySelector('.ai-proposal.connection button.primary')?.hasAttribute('disabled'));
    // The key is not left in the page or the saved conversation.
    assert.equal(await card.getByLabel('Access key ID').inputValue(), '');
    const html = await page.content();
    const kept = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    for (const v of Object.values(KEYS)) assert.ok(!html.includes(v) && !kept.includes(v));
    await card.getByRole('button', { name: 'Test' }).click();
    await card.getByText(/Test: Reached bucket acme-invoices/).waitFor();
    await card.getByRole('button', { name: 'Approve' }).click();
    await card.getByText(/Approved and on/).waitFor();
    assert.equal(hosted.host.connections!.get('invoices').status, 'active');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('on a server that leaves connections to the console, the card shows the draft and says where to finish it', { skip }, async () => {
  hosted.host.appConnections = false;
  const page = await window(await browser.newContext());
  try {
    await ask(page, 'reports');
    const card = page.locator('.ai-proposal.connection');
    await card.getByText(/leaves connections to the admin console/).waitFor();
    assert.equal(await card.locator('input').count(), 0);
    assert.equal(await card.getByRole('button', { name: 'Approve' }).count(), 0);
    assert.equal(hosted.host.connections!.get('reports').status, 'draft');
    assert.deepEqual(page.errors, []);
  } finally {
    hosted.host.appConnections = true;
    await page.context().close();
  }
});

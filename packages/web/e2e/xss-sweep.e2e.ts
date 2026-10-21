// Hostile text everywhere a person can put it, then every page that shows it, in a real browser.
//
// The payloads set a canary when they run (an `onerror` or `onload` handler calls `__hit(id)`) and carry an element
// that no page should ever contain (`<i data-xss-probe>`). Each place text can come from has its own id, so a failure
// names where the text got in. The pages are walked twice: once with the page's Content-Security-Policy switched off,
// which shows whether the text is escaped by the page itself, and once under the policy, which shows whether the
// policy would hold if something were missed. Both must see nothing run, and the first must also see no injected element.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import type { DesignOp } from '../../store/src/index.ts';
import { host, launch, skipUnless, until, window, type Hosted } from './harness.ts';

const skip = skipUnless();

/** Text that tries to run when it is put into a page as HTML, an attribute or a script; `id` says where it came from. */
export const payload = (id: string) => `"'><img src=x onerror="__hit('${id}')"><svg onload="__hit('${id}')"></svg><i data-xss-probe="${id}"></i><script>__hit('${id}')</script>`;
/** The same idea for places that take a URL. */
export const urlPayload = (id: string) => `javascript:__hit('${id}')//`;

const PASSWORD = 'correct horse';
const ALL = ['file-name', 'table', 'field', 'other-table', 'layout', 'script', 'value-list', 'value-list-value', 'privilege-set', 'account', 'privilege-set-refused', 'account-refused', 'extended-privilege', 'script-comment', 'script-text', 'dialog-title', 'dialog-message', 'tooltip', 'placeholder', 'layout-text', 'button-text', 'button-name', 'record-text', 'record-note', 'audit-account'];
const BOSS = 'Boss';
const SHOP = 'Shop';

let hosted: Hosted;
let browser: Browser;

/** Names that carry a payload, so a page that shows one without escaping it is found. */
const names = {
  file: 'Odd' + payload('file-name').replace(/[/\\]/g, ''),
  table: 'Tbl' + payload('table'),
  field: 'Fld' + payload('field'),
  note: 'Note',
  other: 'Oth' + payload('other-table'),
  layout: 'Lay' + payload('layout'),
  script: 'Scr' + payload('script'),
  valueList: 'VL' + payload('value-list'),
  privilegeSet: 'Set' + payload('privilege-set'),
  account: 'Acct' + payload('account'),
  noAppSet: 'NoApp' + payload('privilege-set-refused'),
  noAppAccount: 'NoApp' + payload('account-refused'),
  extended: 'ext' + payload('extended-privilege').replace(/\s/g, ''),
};

before(async () => {
  if (skip) return;
  hosted = await host({ stores: [SHOP, names.file] });
  const store = hosted.store(SHOP);
  store.applyDesign([
    { op: 'createTable', name: names.table, fields: [{ name: names.field }, { name: names.note }, { name: 'Link' }] },
    { op: 'createTable', name: names.other, fields: [{ name: 'Key' }, { name: 'Label' }] },
  ] as DesignOp[]);
  store.applyDesign([
    { op: 'createValueList', name: names.valueList, values: [payload('value-list-value'), 'plain'] },
    { op: 'createScript', name: names.script, text: `# ${payload('script-comment')}\nSet Variable [ $x ; ${JSON.stringify(payload('script-text'))} ]\nShow Custom Dialog [ ${JSON.stringify(payload('dialog-title'))} ; ${JSON.stringify(payload('dialog-message'))} ]` },
    { op: 'createExtendedPrivilege', name: names.extended },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((o) => o.name === name)!;
  const table = store.schema.tables.find((t) => t.name === names.table)!;
  const fieldOf = (name: string) => table.fields.find((f) => f.name === name)!;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const at = (top: number, left = 20, width = 300) => ({ top, left, bottom: top + 22, right: left + width });
  const design = store.design(names.table)!;
  const style = design.objects.find((o) => o.kind === 'field')?.style ?? {};
  const field = (id: number, name: string, top: number, extra: Record<string, unknown> = {}) => ({
    id, kind: 'field', type: 1, anchors, style, bounds: at(top),
    field: { tableOccurrenceId: occ(names.table).id, fieldId: fieldOf(name).id, tableOccurrence: names.table, field: name, display: 'edit', repetitions: 1 },
    ...extra,
  });
  store.applyDesign([
    { op: 'createLayout', name: names.layout, occurrence: occ(names.table).id, design: {
      parts: design.parts,
      objects: [
        field(1, names.field, 10, { tooltip: JSON.stringify(payload('tooltip')), placeholder: JSON.stringify(payload('placeholder')) }),
        field(2, names.note, 40),
        { id: 3, kind: 'text', type: 2, anchors, style: {}, bounds: at(80), text: payload('layout-text') },
        { id: 4, kind: 'button', type: 0, anchors, style: {}, bounds: at(110, 20, 160), text: payload('button-text'), name: payload('button-name'), action: { stepId: 1, step: 'Perform Script', scriptId: store.schema.scripts.find((s) => s.name === names.script)!.id, script: names.script } },
      ],
    } },
  ] as DesignOp[]);
  store.create(names.table, { [names.field]: payload('record-text'), [names.note]: payload('record-note'), Link: urlPayload('record-link') }, { account: 'Audit' + payload('audit-account') });
  store.savePrivilegeSet({ name: names.privilegeSet, records: { view: true, edit: true, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [names.extended, 'fmapp', 'fmrest'] });
  store.createAccount(names.account, PASSWORD, names.privilegeSet);
  store.savePrivilegeSet({ name: names.noAppSet, records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] });
  store.createAccount(names.noAppAccount, PASSWORD, names.noAppSet);
  store.applyDesign([{ op: 'createRelationship', left: names.table, right: names.other, predicates: [{ left: 'Link', right: 'Key' }] }] as DesignOp[]);
  store.setPassword(BOSS, PASSWORD, '[Full Access]');
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await hosted?.close();
});

interface Watch { shown: Set<string>; hits: string[]; dialogs: string[]; injected(): Promise<string[]>; context: BrowserContext; page: Page & { errors: string[] } }

/** A window that records every payload that runs and every dialog the page opens. */
async function watched(underPolicy: boolean): Promise<Watch> {
  const context = await browser.newContext({ bypassCSP: !underPolicy });
  const hits: string[] = [];
  const dialogs: string[] = [];
  await context.exposeFunction('__hit', (id: string) => { hits.push(id); });
  const page = await window(context);
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
  const injected = async () => {
    const found: string[] = [];
    const seen = (frame: Frame) => frame.evaluate(() => [...document.querySelectorAll('[data-xss-probe]')].map((e) => e.getAttribute('data-xss-probe') ?? '')).catch(() => []);
    for (const frame of page.frames()) found.push(...await seen(frame));
    return found;
  };
  return { shown: new Set<string>(), hits, dialogs, injected, context, page };
}

/** Both kinds of failure, with where the text came from. */
async function clean(w: Watch, where: string, underPolicy: boolean): Promise<void> {
  await new Promise((r) => setTimeout(r, 200));
  // Which places have been seen as text so far (a payload that was never shown proves nothing about its place).
  const text = await w.page.evaluate(() => document.body.innerText).catch(() => '');
  for (const id of ALL) if (text.includes(`data-xss-probe="${id}"`)) w.shown.add(id);
  assert.deepEqual(w.hits, [], `${where}: a payload ran`);
  assert.deepEqual(w.dialogs, [], `${where}: a dialog opened`);
  if (!underPolicy) assert.deepEqual(await w.injected(), [], `${where}: markup from a payload is in the page`);
}

for (const underPolicy of [false, true]) {
  const label = underPolicy ? 'under the page policy' : 'with the policy off';

  test(`admin console, ${label}: hostile names and values in every list are shown as text`, { skip }, async () => {
    const w = await watched(underPolicy);
    try {
      await w.page.goto(hosted.url + '/admin/');
      await until(() => w.page.locator('#audit-db option').count(), (n) => n > 0);
      await clean(w, 'admin: first load', underPolicy);
      // Every database select, each database in turn, then every refresh-type button.
      const ids = await w.page.locator('select[id$="-db"]').evaluateAll((els) => els.map((e) => e.id));
      const selects: string[] = [];
      for (const id of ids) if (await w.page.locator(`#${id}`).isVisible()) selects.push(id);
      for (const id of selects) {
        const options = await w.page.locator(`#${id} option`).evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
        for (const value of options) {
          await w.page.locator(`#${id}`).selectOption(value);
          await w.page.waitForLoadState('networkidle');
          await clean(w, `admin: ${id} = ${value.slice(0, 20)}`, underPolicy);
        }
      }
      // The read-only buttons of each section, once per choice in the section's other selects.
      const GO = ['#stale-go', '#stale-all', '#deps-refresh', '#unusual-refresh', '#usage-refresh', '#health-go', '#events-refresh', '#audit-refresh', '#viewas-go', '#access-go', '#testaccount-go', '#accessreview-go', '#compare-go', '#sso-test-go', '#leastpriv-go', '#log-go'];
      for (const go of GO) {
        const section = w.page.locator(`section:has(${go})`);
        const selectIds = await section.locator('select').evaluateAll((els) => els.map((e) => e.id).filter(Boolean));
        const choices: [string, string][] = [];
        for (const id of selectIds) {
          if (!(await w.page.locator(`#${id}`).isVisible())) continue;
          for (const value of await w.page.locator(`#${id} option`).evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))) choices.push([id, value]);
        }
        for (const [id, value] of choices.length ? choices : [['', '']]) {
          if (id) await w.page.locator(`#${id}`).selectOption(value).catch(() => {});
          if (await w.page.locator(go).isVisible() && await w.page.locator(go).isEnabled()) await w.page.locator(go).click();
          await w.page.waitForLoadState('networkidle');
          await clean(w, `admin: ${go} with ${id}=${value.slice(0, 20)}`, underPolicy);
        }
      }
      // Each hosted file's own panels.
      for (const name of ['Settings', 'Guide', 'Optimize', 'Plug-ins']) {
        const buttons = w.page.locator('#files').getByRole('button', { name, exact: true });
        for (let i = 0; i < await buttons.count(); i++) {
          await buttons.nth(i).click();
          await w.page.waitForLoadState('networkidle');
          await new Promise((r) => setTimeout(r, 500));
          await clean(w, `admin: file panel ${name} #${i}`, underPolicy);
        }
      }
      assert.deepEqual(w.page.errors, []);
      // Which places the page showed as text (a payload that was never shown proves nothing about its place).
      await clean(w, 'admin: end', underPolicy);
      // A place whose text no page showed proves nothing; these are the ones that must be on a page (the others are listed in the audit).
      const adminShown = ['file-name', 'table', 'field', 'other-table', 'layout', 'script', 'privilege-set', 'account', 'privilege-set-refused', 'account-refused', 'extended-privilege', 'record-text', 'record-note', 'audit-account'];
      assert.deepEqual(adminShown.filter((id) => !w.shown.has(id)), [], 'places the admin console must have shown');
      console.log(`# admin ${label}: shown as text ${w.shown.size}/${ALL.length}; not shown: ${ALL.filter((id) => !w.shown.has(id)).join(', ')}`);
    } finally {
      await w.context.close();
    }
  });
}

test('the detector itself: a payload put into a page as markup is seen, whether or not the policy would stop it', { skip }, async () => {
  for (const underPolicy of [false, true]) {
    const w = await watched(underPolicy);
    try {
      await w.page.goto(hosted.url + '/admin/');
      await w.page.evaluate((html) => { document.body.insertAdjacentHTML('beforeend', html); }, payload('control'));
      await new Promise((r) => setTimeout(r, 300));
      assert.ok((await w.injected()).includes('control'), 'the injected element is found');
      if (!underPolicy) assert.ok(w.hits.includes('control'), 'with the policy off, the handler runs and is seen');
      // The admin console's policy allows its own two scripts by hash and nothing else: an injected handler or script does not run.
      else assert.deepEqual(w.hits, [], 'under the admin console\'s policy, injected markup runs nothing');
    } finally {
      await w.context.close();
    }
  }
});

for (const underPolicy of [false, true]) {
  const label = underPolicy ? 'under the page policy' : 'with the policy off';

  test(`web client, ${label}: hostile names, records and messages are shown as text`, { skip }, async () => {
    const w = await watched(underPolicy);
    try {
      // The sign-in page lists every hosted file by name.
      await w.page.goto(hosted.url + '/app/');
      await w.page.locator('select[name="db"]').waitFor();
      await clean(w, 'web: sign-in page', underPolicy);
      const seen = new Set<string>();
      // An account the web client refuses: the message names its privilege set.
      await w.page.locator('select[name="db"]').selectOption(SHOP);
      await w.page.locator('input[name="account"]').fill(names.noAppAccount);
      await w.page.locator('input[name="password"]').fill(PASSWORD);
      await w.page.getByRole('button', { name: 'Open', exact: true }).click();
      await until(() => w.page.evaluate(() => document.body.innerText), (t) => t.includes('extended privilege'));
      await clean(w, 'web: sign-in refused', underPolicy);
      // The administrator, then the account whose name and privilege set are hostile.
      for (const account of [BOSS, names.account]) {
        await w.page.goto(hosted.url + '/app/');
        await w.page.locator('select[name="db"]').selectOption(SHOP);
        await w.page.locator('input[name="account"]').fill(account);
        await w.page.locator('input[name="password"]').fill(PASSWORD);
        await w.page.getByRole('button', { name: 'Open', exact: true }).click();
        await w.page.locator('select.layout-menu').waitFor({ state: 'attached' });
        await clean(w, `web: signed in as ${account.slice(0, 8)}`, underPolicy);
        const layouts = await w.page.locator('select.layout-menu option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
        for (const layout of layouts) {
          await w.page.locator('select.layout-menu').selectOption(layout);
          await new Promise((r) => setTimeout(r, 600));
          await clean(w, `web: layout ${layout.slice(0, 12)}`, underPolicy);
          const here = await w.page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[title],[placeholder],[aria-label]')].map((e) => `${e.getAttribute('title')} ${e.getAttribute('placeholder')} ${e.getAttribute('aria-label')}`).join('\n') + '\n' + [...document.querySelectorAll('input,textarea')].map((e) => (e as HTMLInputElement).value).join('\n'));
          for (const id of ALL) if (here.includes(`data-xss-probe="${id}"`)) seen.add(id);
        }
        await w.page.getByRole('button', { name: 'Log out' }).click();
        await w.page.locator('select[name="db"]').waitFor();
      }
      console.log(`# web ${label}: shown as text ${[...seen].join(', ')}`);
      assert.deepEqual(['table', 'field', 'other-table', 'layout', 'record-text', 'record-note', 'script', 'layout-text', 'button-text', 'account'].filter((id) => !seen.has(id)), [], 'places the web client must have shown');
      assert.deepEqual(w.page.errors, []);
    } finally {
      await w.context.close();
    }
  });
}

for (const underPolicy of [false, true]) {
  const label = underPolicy ? 'under the page policy' : 'with the policy off';

  test(`web client, ${label}: a script's dialog, the other views, a find and its messages show hostile text as text`, { skip }, async () => {
    const w = await watched(underPolicy);
    try {
      const p = w.page;
      await p.goto(hosted.url + '/app/');
      await p.locator('select[name="db"]').selectOption(SHOP);
      await p.locator('input[name="account"]').fill(BOSS);
      await p.locator('input[name="password"]').fill(PASSWORD);
      await p.getByRole('button', { name: 'Open', exact: true }).click();
      await p.locator('select.layout-menu').waitFor({ state: 'attached' });
      await p.locator('select.layout-menu').selectOption(names.layout);
      await p.locator('.fm[data-id="4"]').waitFor();
      await clean(w, 'web: the hostile layout', underPolicy);
      // The button runs a script that asks a question in a dialog it draws.
      await p.locator('.fm[data-id="4"]').click();
      const dialog = p.getByRole('dialog');
      await dialog.first().waitFor();
      const asked = await dialog.first().innerText();
      assert.ok(asked.includes('data-xss-probe="dialog-message"'), `the dialog shows the message as text: ${asked.slice(0, 120)}`);
      await clean(w, 'web: the script\'s dialog', underPolicy);
      await dialog.first().getByRole('button').first().click();
      await dialog.first().waitFor({ state: 'detached' });
      // The other views.
      for (const view of ['View as List', 'View as Table', 'View as Form']) {
        const button = p.getByRole('button', { name: view });
        if (await button.count()) { await button.first().click(); await new Promise((r) => setTimeout(r, 400)); await clean(w, `web: ${view}`, underPolicy); }
      }
      // A find whose criteria are hostile, and the message that comes back.
      await p.getByRole('button', { name: 'Find', exact: true }).first().click();
      await new Promise((r) => setTimeout(r, 400));
      const box = p.locator('.fm[data-id="1"]').locator('input, textarea').first();
      await box.fill(payload('find-criteria'));
      await box.press('Enter');
      await new Promise((r) => setTimeout(r, 800));
      await clean(w, 'web: a find with hostile criteria', underPolicy);
      // The server refuses the criteria (an unclosed quote); the page says so, in Find mode, and nothing is thrown unhandled.
      await until(() => p.locator('.toast').allInnerTexts(), (t) => t.some((x) => /closing quote/.test(x)));
      assert.deepEqual(p.errors, []);
    } finally {
      await w.context.close();
    }
  });
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { host, launch, signIn, field, until, window, type Hosted } from './harness.ts';

let hosted: Hosted;
let browser: Browser;
let fieldId: number;
const secret = 'SYNTHETIC_PRIVATE_TEXT';
before(async () => {
  hosted = await host({ stores: ['Synthetic'] });
  const store = hosted.store('Synthetic');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Value' }] }]);
  const design = store.design('Items')!;
  const object = design.objects.find((o) => o.kind === 'field')!;
  fieldId = object.id;
  object.field!.behavior = { concealed: true };
  store.applyDesign([{ op: 'updateLayout', layout: 'Items', design }]);
  const rec = store.create('Items', { Value: secret });
  store.update('Items', rec.recordId, { Value: secret }, undefined, { styles: { Value: [{ start: 0, end: secret.length, style: 256 }] } });
  store.create('Items', { Value: secret });
  store.setPassword('Admin', 'synthetic-password', '[Full Access]');
  store.setPassword('Other', 'synthetic-password', '[Full Access]');
  store.savePrivilegeSet({ name: 'Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmwebdirect'] });
  store.setPassword('Reader', 'synthetic-password', 'Readers');
  browser = await launch();
});
after(async () => { await browser?.close(); await hosted?.close(); });

async function blank() {
  const page = await window(browser);
  page.setDefaultTimeout(10_000);
  await page.route('**/synthetic.html', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
  await page.goto(hosted.url + '/synthetic.html');
  return page;
}

test('AR-web-client-01', { timeout: 20_000 }, async () => {
  const page = await blank();
  try {
    await page.evaluate(async () => {
      const { webViewer, answerPageCalls } = await import('/app/src/' + 'layout.ts');
      const w = window as any;
      w.calls = 0;
      answerPageCalls(async () => { w.calls++; return 'SYNTHETIC_CONTEXT'; });
      const wrapper = document.createElement('div'); wrapper.className = 'fm'; wrapper.dataset.id = '1';
      wrapper.append(webViewer('data:text/html,<p>first</p>', true)); document.body.append(wrapper);
    });
    await page.waitForFunction(() => document.querySelector('iframe')?.dataset.loaded === '1');
    const frame = page.frames().find((f) => f.parentFrame())!;
    assert.equal(await frame.evaluate(() => (window as any).tabularius.context()), 'SYNTHETIC_CONTEXT');
    await page.evaluate(() => {
      const f = document.querySelector('iframe')!;
      f.dataset.old = f.dataset.viewerDocument;
      f.srcdoc = `<script>window.replies=[];addEventListener('message',e=>replies.push(e.data));parent.postMessage({tabularius:'ask',id:'replacement',method:'context',args:[]},'*');</script>`;
    });
    await page.waitForFunction(() => { const f = document.querySelector('iframe')!; return f.dataset.viewerDocument !== f.dataset.old; });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => (window as any).calls), 1);
    assert.deepEqual(await frame.evaluate(() => (window as any).replies), []);
  } finally { await page.close(); }
});

test('AR-web-client-06', { timeout: 20_000 }, async () => {
  const page = await window(browser);
  try {
    await signIn(page, hosted.url, 'Synthetic', 'Admin', 'synthetic-password');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await until(() => field(page, fieldId).inputValue(), (v) => v === secret, 10_000);
    const object = page.locator(`.fm[data-id="${fieldId}"]`);
    assert.ok(!(await object.textContent())?.includes(secret));
    await field(page, fieldId).evaluate(async (element) => {
      const input = element as HTMLInputElement;
      const { previewStyled } = await import('/app/src/' + 'layout.ts');
      previewStyled(input, [{ start: 0, end: input.value.length, style: 256 }]);
      input.dispatchEvent(new Event('blur'));
    });
    assert.ok(!(await object.textContent())?.includes(secret));
    assert.equal(await field(page, fieldId).getAttribute('type'), 'password');
  } finally { await page.close(); }
});

test('AR-web-client-07', { timeout: 20_000 }, async () => {
  const page = await window(browser);
  try {
    await signIn(page, hosted.url, 'Synthetic', 'Admin', 'synthetic-password');
    await page.getByRole('button', { name: 'View as Form' }).click();
    await page.getByRole('button', { name: 'Next record' }).click();
    const kept = await until(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tabularius.recent.')).map((k) => localStorage.getItem(k)).find(Boolean) ?? null), Boolean, 10_000);
    assert.ok(!kept!.includes(secret));
    assert.equal(JSON.parse(kept!)[0].title, 'Record 2');
    await page.keyboard.press('ControlOrMeta+k');
    assert.ok(!(await page.getByRole('dialog').textContent())?.includes(secret));
  } finally { await page.close(); }
});

test('AR-web-admin-console-06', { timeout: 20_000 }, async () => {
  const page = await blank();
  try {
    await page.evaluate(async () => {
      const { Api } = await import('/app/src/' + 'api.ts');
      const api = await Api.login('Synthetic', 'Reader', 'synthetic-password');
      sessionStorage.setItem('tabularius.session', JSON.stringify({ db: api.db, token: api.token }));
      localStorage.setItem('tabularius.dataviewer.watch.Synthetic', JSON.stringify(['"SYNTHETIC_ADMIN_FORMULA"']));
      sessionStorage.setItem('tabularius.layout.Synthetic', 'Items');
    });
    await page.goto(hosted.url + '/app/dataviewer.html');
    await until(() => page.locator('#app').textContent(), (text) => !!text?.includes('full access'), 10_000);
    assert.ok(!(await page.locator('#app').textContent())?.includes('SYNTHETIC_ADMIN_FORMULA'));
    assert.equal(await page.getByLabel('Expression', { exact: true }).count(), 0);
  } finally { await page.close(); }
});

test('AR-web-client-06 textarea and edits', { timeout: 20_000 }, async () => {
  const page = await blank();
  try {
    const text = await page.evaluate(async () => {
      const { previewStyled } = await import('/app/src/' + 'layout.ts');
      const host = document.createElement('div');
      const input = document.createElement('textarea');
      input.style.setProperty('-webkit-text-security', 'disc');
      input.value = 'SYNTHETIC_TEXTAREA_TEXT';
      host.append(input); document.body.append(host);
      previewStyled(input, [{ start: 0, end: input.value.length, style: 256 }]);
      const before = host.textContent;
      input.value = 'SYNTHETIC_EDITED_TEXT';
      input.dispatchEvent(new Event('blur'));
      previewStyled(input, [{ start: 0, end: input.value.length, style: 512 }]);
      return [before, host.textContent];
    });
    assert.ok(text.every((t) => !t?.includes('SYNTHETIC_')));
    assert.ok(text.every((t) => t?.includes('•')));
  } finally { await page.close(); }
});

test('AR-web-client-07 migration', { timeout: 20_000 }, async () => {
  const page = await blank();
  try {
    await page.evaluate(async (secret) => {
      const { Api } = await import('/app/src/' + 'api.ts');
      const api = await Api.login('Synthetic', 'Admin', 'synthetic-password');
      sessionStorage.setItem('tabularius.session', JSON.stringify({ db: api.db, token: api.token }));
      const recent = [{ layout: 'Items', recordId: '1', title: secret }];
      localStorage.setItem('tabularius.recent.Synthetic.Admin', JSON.stringify(recent));
      await api.setPref('recent', recent);
    }, secret);
    await page.goto(hosted.url + '/app/');
    await page.locator('select.layout-menu').waitFor();
    await until(() => page.evaluate(async () => {
      const { Api } = await import('/app/src/' + 'api.ts');
      const s = JSON.parse(sessionStorage.getItem('tabularius.session')!);
      return JSON.stringify((await new Api(s.db, s.token).prefs()).recent);
    }), (v) => !!v && !v.includes(secret), 10_000);
    assert.ok(!(await page.evaluate(() => localStorage.getItem('tabularius.recent.Synthetic.Admin')))?.includes(secret));
    await page.keyboard.press('ControlOrMeta+k');
    assert.ok(!(await page.getByRole('dialog').textContent())?.includes(secret));
  } finally { await page.close(); }
});

for (const boundary of ['navigation', 'session']) {
  test(`AR-web-client-01 pending ${boundary}`, { timeout: 20_000 }, async () => {
    const page = await blank();
    try {
      await page.evaluate(async () => {
        const { webViewer, answerPageCalls } = await import('/app/src/' + 'layout.ts');
        const w = window as any;
        w.stop = answerPageCalls(() => new Promise((resolve) => { w.resolveCall = resolve; }));
        const host = document.createElement('div'); host.className = 'fm'; host.dataset.id = '1';
        host.append(webViewer('data:text/html,<p>first</p>', true)); document.body.append(host);
      });
      await page.waitForFunction(() => document.querySelector('iframe')?.dataset.loaded === '1');
      const frame = page.frames().find((f) => f.parentFrame())!;
      await frame.evaluate(() => {
        const w = window as any;
        w.received = [];
        w.tabularius.context().then((v: unknown) => w.received.push(v));
        w.tabularius.on('private', (v: unknown) => w.received.push(v));
      });
      await page.waitForFunction(() => typeof (window as any).resolveCall === 'function');
      if (boundary === 'navigation') {
        await page.evaluate(() => {
          const f = document.querySelector('iframe')!;
          f.dataset.old = f.dataset.viewerDocument;
          f.srcdoc = `<script>window.received=[];addEventListener('message',e=>received.push(e.data));</script>`;
        });
        await page.waitForFunction(() => { const f = document.querySelector('iframe')!; return f.dataset.viewerDocument !== f.dataset.old; });
      } else await page.evaluate(() => (window as any).stop());
      await page.evaluate(async () => {
        const { tellPages } = await import('/app/src/' + 'layout.ts');
        (window as any).resolveCall('SYNTHETIC_DELAYED_CONTEXT');
        tellPages(document, 'private', 'SYNTHETIC_EVENT');
      });
      await page.waitForTimeout(150);
      assert.deepEqual(await frame.evaluate(() => (window as any).received), []);
    } finally { await page.close(); }
  });
}

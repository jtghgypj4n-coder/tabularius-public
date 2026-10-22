// A real browser, a hostile page on another site, and a Basic login the browser has saved for the server (Playwright's
// httpCredentials with send: 'always' stands in for the cached login of a person who once opened the OData address).
// The page makes the browser post a form and fetch with no-cors; the server must not change anything. A control request
// from the server's own page, with the same saved login, shows the login works, so a refusal is the guard and not a failed login.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser } from 'playwright-core';
import { host, launch, skipUnless, window, type Hosted } from './harness.ts';
import type { DesignOp } from '../../store/src/index.ts';

const skip = skipUnless();
let hosted: Hosted;
let browser: Browser;
let evil: Server;
let evilPort: number;
const received: string[] = [];

const names = () => hosted.store('Shop').find('Customers', {}).records.map((r) => r.fieldData.Name).sort();

before(async () => {
  if (skip) return;
  hosted = await host({ stores: ['Shop'] });
  const store = hosted.store('Shop');
  store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] }] as DesignOp[]);
  store.create('Customers', { Id: 1, Name: 'Ada' });
  const full = store.privilegeSet('[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest', 'fmodata'])] });
  store.setPassword('Ann', 'ann-secret-1', '[Full Access]');
  browser = await launch();
  // The attacker's page: auto-submitting forms and no-cors fetches aimed at the server.
  evil = createServer((req, res) => {
    received.push(req.url ?? '');
    const target = `${hosted.url}/fmi/odata/v4/Shop/Customers`;
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><body>
<form id=f method=POST action="${target}" enctype="text/plain" target=sink><input name='{"Id":9,"Name":"forged-form","x":"' value='"}'></form>
<iframe name=sink></iframe>
<script>
document.getElementById('f').submit();
fetch(${JSON.stringify(target)}, { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ Id: 10, Name: 'forged-fetch' }) }).catch(() => {});
fetch(${JSON.stringify(target)}, { method: 'DELETE', mode: 'no-cors', credentials: 'include' }).catch(() => {});
fetch(${JSON.stringify(hosted.url + '/fmi/data/vLatest/databases/Shop/sessions')}, { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: '{}' }).catch(() => {});
setTimeout(() => { document.title = 'done'; }, 1500);
</script>`);
  });
  await new Promise<void>((ok) => evil.listen(0, 'localhost', ok));
  evilPort = (evil.address() as AddressInfo).port;
});
after(async () => {
  await browser?.close();
  await hosted?.close();
  await new Promise<void>((ok) => (evil ? evil.close(() => ok()) : ok()));
});

test('a page on another site cannot use the browser\'s saved login to change data', { skip }, async () => {
  const origin = new URL(hosted.url).origin;
  const context = await browser.newContext({ httpCredentials: { username: 'Ann', password: 'ann-secret-1', origin, send: 'always' } });
  try {
    const page = await window(context);
    // Control: the server's own page, same saved login, creates a record.
    await page.goto(`${hosted.url}/app/`);
    const control = await page.evaluate(async (url) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Id: 2, Name: 'honest' }) })).status, `${hosted.url}/fmi/odata/v4/Shop/Customers`);
    assert.equal(control, 201, 'the saved login works from the server\'s own page');
    assert.deepEqual(names(), ['Ada', 'honest']);

    // The hostile page, on localhost (the server is on 127.0.0.1: another site).
    const attacker = await window(context);
    const seen: Array<{ url: string; site: string | undefined; origin: string | undefined; auth: boolean }> = [];
    attacker.on('request', async (r) => { if (r.url().startsWith(origin)) { const h = await r.allHeaders().catch(() => ({} as Record<string, string>)); seen.push({ url: r.url(), site: h['sec-fetch-site'], origin: h.origin, auth: !!h.authorization }); } });
    await attacker.goto(`http://localhost:${evilPort}/attack`);
    await attacker.waitForFunction(() => document.title === 'done');
    await new Promise((ok) => setTimeout(ok, 500));
    assert.ok(received.length >= 1, 'the hostile page was loaded');
    assert.ok(seen.length >= 3, `the page made requests to the server: ${JSON.stringify(seen)}`);
    // Playwright reports the browser's extra headers only for some requests; every one that has them says cross-site.
    assert.ok(seen.some((s) => s.site === 'cross-site' && s.auth), `the form post carried the saved login and the browser called it cross-site: ${JSON.stringify(seen)}`);
    assert.ok(seen.every((s) => s.site === undefined || s.site === 'cross-site'), JSON.stringify(seen));
    assert.deepEqual(names(), ['Ada', 'honest'], 'nothing was created, changed or deleted');

    // The same hostile page on the server's own host but another port is the same site, and is refused too.
    const sameSite = await window(context);
    const sibling = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><body>x'));
    await new Promise<void>((ok) => sibling.listen(0, '127.0.0.1', ok));
    try {
      await sameSite.goto(`http://127.0.0.1:${(sibling.address() as AddressInfo).port}/`);
      const result = await sameSite.evaluate(async (url) => {
        try { return (await fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ Id: 11, Name: 'forged-sibling' }) })).type; } catch (e) { return String(e); }
      }, `${hosted.url}/fmi/odata/v4/Shop/Customers`);
      assert.equal(result, 'opaque', 'a no-cors request is sent; the response is hidden from the page');
    } finally { await new Promise<void>((ok) => sibling.close(() => ok())); }
    assert.deepEqual(names(), ['Ada', 'honest'], 'a page on another port of the same host changed nothing either');
  } finally { await context.close(); }
});

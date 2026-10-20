import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Every page shell is a "Loading…" placeholder until its script starts. With scripts off, or a module that fails to
// load, that would stay on screen for good, so each shell says what is wrong instead.
const web = join(import.meta.dirname, '..');
const shells = readdirSync(web).filter((n) => n.endsWith('.html')).map((n) => join(web, n));
const admin = join(web, '..', 'server', 'admin', 'index.html');

test('every page shell tells people when JavaScript is off', () => {
  assert.ok(shells.length >= 8);
  for (const f of [...shells, admin]) assert.match(readFileSync(f, 'utf8'), /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/, f);
});

function boot(html: string) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, 'a boot guard script');
  const loading: { className: string; textContent: string; children: { href: string; textContent: string }[]; appendChild(c: { href: string; textContent: string }): void } = {
    className: 'loading', textContent: 'Loading…', children: [], appendChild(c) { this.children.push(c); },
  };
  let present = true;
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const win = {
    document: { querySelector: () => (present ? loading : null), createElement: () => ({ href: '', textContent: '' }) },
    location: { href: 'http://example.test/app/' },
    addEventListener: (name: string, fn: (e: unknown) => void) => { (listeners[name] ??= []).push(fn); },
  };
  vm.runInNewContext(script, { ...win, window: win });
  return { loading, listeners, setPresent: (v: boolean) => { present = v; }, win };
}

test('a script that fails to load, or an unhandled rejection, replaces Loading… with a message and a reload link', () => {
  const a = boot(readFileSync(join(web, 'index.html'), 'utf8'));
  a.listeners.error[0]({ target: { tagName: 'SCRIPT' } });
  assert.equal(a.loading.className, 'fatal');
  assert.match(a.loading.textContent, /did not start/);
  assert.equal(a.loading.children[0].textContent, 'Reload');
  assert.equal(a.loading.children[0].href, 'http://example.test/app/');
  assert.equal(a.loading.children[1].textContent, ' Troubleshooting');
  assert.equal(a.loading.children[1].href, '/docs/troubleshooting-web-client#the-page-is-blank-or-stays-on-loading');

  const b = boot(readFileSync(join(web, 'design.html'), 'utf8'));
  b.listeners.unhandledrejection[0]({});
  assert.equal(b.loading.className, 'fatal');
});

test('a broken picture does not stop the page, and a page that has started is left alone', () => {
  const a = boot(readFileSync(join(web, 'index.html'), 'utf8'));
  a.listeners.error[0]({ target: { tagName: 'IMG' } });
  assert.equal(a.loading.className, 'loading');
  a.setPresent(false);
  a.listeners.error[0]({ target: { tagName: 'SCRIPT' } });
  assert.equal(a.loading.className, 'loading');
});

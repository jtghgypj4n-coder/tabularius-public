import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, normalizeWebViewerHost, normalizeWebViewerHosts, webViewerEntryCovers, describeSecurityEvent, securityEventCategory, securityEventSeverity } from '../src/index.ts';

test('a file allows no web hosts to begin with; the list is kept in the file and in its security log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-hosts-'));
  const path = join(dir, 'Shop.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    assert.deepEqual(store.webViewerHosts, []);
    store.setWebViewerHosts(['Maps.Example.com', '*.cdn.example.org', 'maps.example.com'], { account: 'admin console' });
    assert.deepEqual(store.webViewerHosts, ['*.cdn.example.org', 'maps.example.com']);
    // The same list again is not a change.
    store.setWebViewerHosts(['maps.example.com', '*.cdn.example.org'], { account: 'admin console' });
    store.setWebViewerHosts(['maps.example.com']);
    store.close();
    const again = new Store(path, 'Shop');
    assert.deepEqual(again.webViewerHosts, ['maps.example.com']);
    const events = again.securityEvents({ kind: 'web-viewer-hosts-changed' });
    assert.equal(events.length, 2);
    assert.equal(securityEventCategory('web-viewer-hosts-changed'), 'Web viewer hosts');
    assert.equal(securityEventSeverity('web-viewer-hosts-changed'), 'notice');
    const texts = events.map((e) => describeSecurityEvent(e));
    assert.ok(texts.some((t) => t === 'Web viewer hosts changed: allowed *.cdn.example.org, maps.example.com'), texts.join(' | '));
    assert.ok(texts.some((t) => t === 'Web viewer hosts changed: no longer allowed *.cdn.example.org'), texts.join(' | '));
    again.setWebViewerHosts([]);
    assert.deepEqual(again.webViewerHosts, []);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a web host is a public https host name and nothing else', () => {
  assert.equal(normalizeWebViewerHost('  Maps.Example.COM '), 'maps.example.com');
  assert.equal(normalizeWebViewerHost('*.example.com'), '*.example.com');
  for (const bad of [
    '', '  ', 'https://maps.example.com', 'maps.example.com/path', 'maps.example.com:8443', 'user@maps.example.com', 'maps example.com', 'a?b.example.com',
    'localhost', 'intranet', '0x7f.0x1', 'a.0x7f', 'printer.local', 'db.internal', '127.0.0.1', '10.0.0.5', '192.168.1.1', '[::1]', '*.com', '*', '*.', '*.*.example.com', 'ex_ample.com', '-bad.example.com', 'a..b.com',
    `${'a'.repeat(64)}.example.com`,
  ]) assert.throws(() => normalizeWebViewerHost(bad), StoreError, JSON.stringify(bad));
  assert.throws(() => normalizeWebViewerHost(42), StoreError);
  assert.throws(() => normalizeWebViewerHosts('maps.example.com'), StoreError);
  assert.throws(() => normalizeWebViewerHosts(Array.from({ length: 51 }, (_, i) => `h${i}.example.com`)), /At most 50/);
  assert.equal(normalizeWebViewerHosts(Array.from({ length: 50 }, (_, i) => `h${i}.example.com`)).length, 50);
});

test('a list stored by anything but the console is trusted only as far as it passes the same checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-hosts-'));
  const path = join(dir, 'Shop.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    const stored = ['maps.example.com', 'evil.com; frame-ancestors *', 'evil.com *', '*', 'a.example.com\r\nx: y', 42, 'Upper.Example.com', 'maps.example.com'];
    (store as unknown as { sql: { prepare(q: string): { run(...a: unknown[]): void } } }).sql
      .prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(stored));
    assert.deepEqual(store.webViewerHosts, ['maps.example.com']);
    (store as unknown as { sql: { prepare(q: string): { run(...a: unknown[]): void } } }).sql
      .prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(Array.from({ length: 60 }, (_, i) => `h${i}.example.com`)));
    assert.equal(store.webViewerHosts.length, 50);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an entry covers a host name when it is that name or a wildcard over it', () => {
  assert.equal(webViewerEntryCovers('files.example.com', 'Files.Example.com.'), true);
  assert.equal(webViewerEntryCovers('*.example.com', 'files.example.com'), true);
  assert.equal(webViewerEntryCovers('*.example.com', 'a.b.example.com'), true);
  assert.equal(webViewerEntryCovers('*.example.com', 'example.com'), false, 'the bare domain is not a subdomain');
  assert.equal(webViewerEntryCovers('*.example.com', 'badexample.com'), false);
  assert.equal(webViewerEntryCovers('maps.example.com', 'files.example.com'), false);
  assert.equal(webViewerEntryCovers('maps.example.com', ''), false);
  assert.equal(webViewerEntryCovers('maps.example.com', '[::1]'), false);
});

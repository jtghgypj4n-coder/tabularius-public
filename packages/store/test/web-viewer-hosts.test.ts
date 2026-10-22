import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, normalizeWebViewerHost, normalizeWebViewerHosts, webViewerEntryCovers, describeSecurityEvent, securityEventCategory, securityEventSeverity } from '../src/index.ts';
import { trustedWebViewerHosts } from '../src/web-viewer-hosts.ts';

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

test('a wildcard over a public suffix is refused, but a wildcard over a site and a bare suffix-like name are not', () => {
  for (const bad of ['*.co.uk', '*.org.uk', '*.gov.uk', '*.com.au', '*.co.nz', '*.co.jp', '*.ne.jp', '*.com.br', '*.com.cn', '*.co.za', '*.github.io', '*.herokuapp.com', '*.vercel.app', '*.pages.dev', '*.s3.amazonaws.com', '*.blogspot.com', '*.web.app', '*.Co.UK'])
    assert.throws(() => normalizeWebViewerHost(bad), /public suffix/, bad);
  // A name below the suffix is one site (or one account's sites), as before.
  for (const ok of ['*.example.co.uk', 'example.co.uk', '*.myorg.github.io', 'maps.example.com', '*.example.org.uk', 'co.example.com', '*.co.example.com', '*.uk.example.com']) assert.equal(normalizeWebViewerHost(ok), ok.toLowerCase(), ok);
  // The suffix itself, without a wildcard, is one host and no wider than it says.
  assert.equal(normalizeWebViewerHost('github.io'), 'github.io');
  // A stored list from a restored file loses such an entry too.
  assert.deepEqual(trustedWebViewerHosts(['*.co.uk', 'maps.example.com', '*.example.co.uk']), ['maps.example.com', '*.example.co.uk']);
});

test('more shared hosting names are public suffixes: user content, regional storage, blog and dynamic-DNS services', () => {
  for (const bad of [
    '*.githubusercontent.com', '*.googleusercontent.com', '*.r2.dev', '*.deno.dev', '*.notion.site', '*.webflow.io', '*.readthedocs.io', '*.duckdns.org', '*.ddns.net',
    '*.compute.amazonaws.com', '*.s3.us-east-1.amazonaws.com', '*.s3-website.eu-west-1.amazonaws.com', '*.us-east-1.compute.amazonaws.com', '*.blogspot.co.uk', '*.blogspot.de',
  ]) assert.throws(() => normalizeWebViewerHost(bad), /public suffix/, bad);
  // One bucket, one account's sites or a name under a suffix is one party's.
  for (const ok of ['*.mybucket.s3.us-east-1.amazonaws.com', 'raw.githubusercontent.com', '*.myapp.r2.dev', '*.example.blogspot.co.uk', '*.docs.example.com']) assert.equal(normalizeWebViewerHost(ok), ok, ok);
});

test('a stored entry that is not trusted is named, not dropped silently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-hosts-'));
  const path = join(dir, 'Shop.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    const put = (stored: unknown) => (store as unknown as { sql: { prepare(q: string): { run(...a: unknown[]): void } } }).sql
      .prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(stored));
    assert.deepEqual(store.webViewerHostsDropped, []);
    put(['maps.example.com', '*.co.uk', 'evil.com *', 'Upper.Example.com', 42, 'maps.example.com', `a.example.com\r\n${'x'.repeat(300)}`]);
    assert.deepEqual(store.webViewerHosts, ['maps.example.com']);
    // Named once each, shown plainly and shortly, in the order stored; a repeat of a good entry is not a loss.
    assert.deepEqual(store.webViewerHostsDropped.slice(0, 5), ['*.co.uk', 'evil.com *', 'Upper.Example.com', '42', `a.example.com??${'x'.repeat(85)}`]);
    assert.equal(store.webViewerHostsDropped.length, 5);
    put(Array.from({ length: 52 }, (_, i) => `h${i}.example.com`));
    assert.deepEqual(store.webViewerHostsDropped, ['h50.example.com', 'h51.example.com'], 'past the most that can be listed');
    put('not a list');
    assert.deepEqual(store.webViewerHostsDropped, []);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a huge stored list is read once and named briefly: the work and the answer are bounded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-hosts-'));
  const path = join(dir, 'Shop.sqlite');
  const realParse = JSON.parse;
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    const put = (stored: unknown) => (store as unknown as { sql: { prepare(q: string): { run(...a: unknown[]): void } } }).sql
      .prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(stored));
    put(['maps.example.com', ...Array.from({ length: 200_000 }, (_, i) => `junk ${i}`)]);
    let big = 0;
    JSON.parse = ((text: string, ...rest: []) => { if (typeof text === 'string' && text.length > 100_000) big++; return realParse(text, ...rest); }) as typeof JSON.parse;
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(store.webViewerHosts, ['maps.example.com']);
      assert.ok(store.webViewerHostsDropped.length <= 51);
    }
    JSON.parse = realParse;
    assert.ok(big <= 1, `the stored list was parsed ${big} times for 10 reads`);
    const dropped = store.webViewerHostsDropped;
    assert.equal(dropped[0], 'junk 0');
    assert.match(dropped[dropped.length - 1], /^… and \d+ more entries? not listed$/);
    // A change shows at the next read, and a copy of the answer can be changed without changing the next one.
    store.webViewerHosts.push('other.example.com');
    assert.deepEqual(store.webViewerHosts, ['maps.example.com']);
    store.setWebViewerHosts(['maps.example.com', 'b.example.com']);
    assert.deepEqual(store.webViewerHosts, ['b.example.com', 'maps.example.com']);
    assert.deepEqual(store.webViewerHostsDropped, []);
    store.close();
  } finally {
    JSON.parse = realParse;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stored list that cannot be read allows nothing, on every read, and says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-viewer-hosts-'));
  const path = join(dir, 'Shop.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    store.setWebViewerHosts(['a.example.com']);
    assert.deepEqual(store.webViewerHosts, ['a.example.com']);
    // Another connection to the file leaves text that is not JSON: the old list must not stay in force.
    const sql = (store as unknown as { sql: { prepare(q: string): { run(...a: unknown[]): void } } }).sql;
    sql.prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run('["*.co.uk",');
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(store.webViewerHosts, [], `read ${i}`);
      assert.deepEqual(store.webViewerHostsDropped, ['the stored list could not be read']);
    }
    // Repaired text is read again at once.
    sql.prepare(`INSERT INTO _fm_meta VALUES ('webViewerHosts', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run('["b.example.com"]');
    assert.deepEqual(store.webViewerHosts, ['b.example.com']);
    assert.deepEqual(store.webViewerHostsDropped, []);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cloud storage, static hosting and platform names are public suffixes too', () => {
  for (const bad of [
    '*.blob.core.windows.net', '*.web.core.windows.net', '*.file.core.windows.net', '*.dfs.core.windows.net', '*.storage.googleapis.com', '*.firebaseio.com', '*.amplifyapp.com',
    '*.azureedge.net', '*.sharepoint.com', '*.up.railway.app', '*.ondigitalocean.app', '*.s3.dualstack.us-east-1.amazonaws.com', '*.s3-fips.us-gov-west-1.amazonaws.com',
    '*.s3.cn-north-1.amazonaws.com.cn', '*.compute.amazonaws.com.cn', '*.Blob.Core.Windows.NET',
    // The bare cloud names, and every name above one the list refuses: a wildcard over it allows what the refused ones would.
    '*.amazonaws.com', '*.amazonaws.com.cn', '*.windows.net', '*.core.windows.net', '*.googleapis.com', '*.azure.com', '*.railway.app', '*.Windows.Net',
  ]) assert.throws(() => normalizeWebViewerHost(bad), /public suffix/, bad);
  // One storage account, one bucket or one project is one party's.
  for (const ok of ['*.myaccount.blob.core.windows.net', '*.mybucket.s3.us-east-1.amazonaws.com', '*.mybucket.s3.dualstack.us-east-1.amazonaws.com', '*.myproject.firebaseio.com', '*.myorg.sharepoint.com', 'storage.googleapis.com', 'windows.net', '*.example.windows.net.example.com', '*.maps.googleapis.com.example.org']) assert.equal(normalizeWebViewerHost(ok), ok, ok);
});

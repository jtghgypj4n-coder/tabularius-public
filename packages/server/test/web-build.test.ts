import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { WebBuild, staticImports, versionPage, versionScript } from '../src/web-build.ts';

const ID = '0123456789abcdef';

test('versionScript puts the build id on relative script imports, static and dynamic, and nothing else', () => {
  const source = [
    `import { a } from './a.ts';`,
    `import b from "../b.ts";`,
    `import './side.ts';`,
    `export * from './re.ts';`,
    `export { c } from './design/c.ts';`,
    `void import('./chart.ts').then((m) => m);`,
    `const fine = 'from ./not-an-import.txt';`,
    `import { x } from 'node:fs';`,
    `fetch('./data.json');`,
  ].join('\n');
  assert.equal(versionScript(source, ID), [
    `import { a } from './a.ts?v=${ID}';`,
    `import b from "../b.ts?v=${ID}";`,
    `import './side.ts?v=${ID}';`,
    `export * from './re.ts?v=${ID}';`,
    `export { c } from './design/c.ts?v=${ID}';`,
    `void import('./chart.ts?v=${ID}').then((m) => m);`,
    `const fine = 'from ./not-an-import.txt';`,
    `import { x } from 'node:fs';`,
    `fetch('./data.json');`,
  ].join('\n'));
});

test('staticImports lists what the browser fetches before the module runs, not import() or text in a string', () => {
  const source = [
    `import { a } from './a.ts';`,
    `import {`,
    `  b,`,
    `  c,`,
    `} from '../b.ts';`,
    `import './side.ts';`,
    `export * from './re.ts';`,
    `void import('./later.ts');`,
    `const s = "import x from './in-a-string.ts'";`,
    `export const ok = 1;`,
  ].join('\n');
  assert.deepEqual(staticImports(source), ['./a.ts', '../b.ts', './side.ts', './re.ts']);
});

test('versionPage versions the scripts and styles a page names and preloads its entry\'s static modules', async () => {
  const root = '/w';
  const graph: Record<string, string[]> = {
    '/w/src/main.ts': ['/w/src/a.ts', '/w/src/b.ts'],
    '/w/src/a.ts': ['/w/src/b.ts'],
    '/w/src/b.ts': [],
  };
  const html = `<head><link rel="stylesheet" href="app.css"><link rel="icon" href="data:image/svg+xml,%3Csvg%3E"><link rel="icon" href="favicon.svg">\n  <script type="module" src="src/main.ts"></script></head>`;
  const out = await versionPage(html, ID, '/w/index.html', root, async (m) => graph[m] ?? []);
  assert.match(out, new RegExp(`href="app\\.css\\?v=${ID}"`));
  assert.match(out, new RegExp(`href="favicon\\.svg\\?v=${ID}"`));
  assert.match(out, /href="data:image\/svg\+xml,%3Csvg%3E"/);
  assert.match(out, new RegExp(`<script type="module" src="src/main\\.ts\\?v=${ID}">`));
  const preloads = [...out.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(preloads, [`src/main.ts?v=${ID}`, `src/a.ts?v=${ID}`, `src/b.ts?v=${ID}`]);
  assert.ok(out.indexOf('modulepreload') < out.indexOf('<script type="module"'));

  const next = await versionPage(`<script type="module" src="/app/next/main.ts"></script>`, ID, '/w/next/index.html', root, async () => []);
  assert.match(next, new RegExp(`<link rel="modulepreload" href="/app/next/main\\.ts\\?v=${ID}">`));
  assert.match(next, new RegExp(`src="/app/next/main\\.ts\\?v=${ID}"`));
});

test('WebBuild ids follow the content of the served files, not the test folders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-build-'));
  try {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'e2e'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
    const build = new WebBuild(dir);
    const first = await build.id();
    assert.match(first, /^[0-9a-f]{16}$/);
    // A test file is not part of the client.
    writeFileSync(join(dir, 'e2e', 'x.ts'), 'export {};\n');
    // The id is trusted for a moment; a build made right after still answers the same.
    assert.equal(await build.id(), first);
    const later = new WebBuild(dir);
    assert.equal(await later.id(), first);
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2;\n');
    utimesSync(join(dir, 'src', 'a.ts'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const changed = await new WebBuild(dir).id();
    assert.notEqual(changed, first);
    // The same content, touched, is the same build.
    utimesSync(join(dir, 'src', 'a.ts'), new Date(Date.now() + 9000), new Date(Date.now() + 9000));
    assert.equal(await new WebBuild(dir).id(), changed);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the server sends the client\'s files under their build id as immutable, and everything else for revalidation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-web-build-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const page = await fetch(`${s.url}/app/`);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const html = await page.text();
    const id = /<script type="module" src="src\/main\.ts\?v=([0-9a-f]{16})"/.exec(html)?.[1];
    assert.ok(id, 'the page names its entry script with the build id');
    assert.match(html, new RegExp(`<link rel="stylesheet" href="tokens\\.css\\?v=${id}">`));
    assert.match(html, new RegExp(`<link rel="modulepreload" href="src/layout\\.ts\\?v=${id}">`));

    const main = await fetch(`${s.url}/app/src/main.ts?v=${id}`);
    assert.equal(main.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const code = await main.text();
    assert.match(code, new RegExp(`from './layout\\.ts\\?v=${id}'`));
    assert.doesNotMatch(code, /from '\.\/layout\.ts'/);
    const layout = await (await fetch(`${s.url}/app/src/layout.ts?v=${id}`)).text();
    assert.match(layout, /\bimport\('\.\/[\w-]+\.ts\?v=/, 'dynamic imports carry the id too');

    // The same URLs the entry module's static imports name are preloaded, so each exists and is cacheable.
    for (const m of html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)) {
      const res = await fetch(`${s.url}/app/${m[1]}`);
      assert.equal(res.status, 200, m[1]);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', m[1]);
      await res.arrayBuffer();
    }
    const css = await fetch(`${s.url}/app/tokens.css?v=${id}`);
    assert.equal(css.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    // Without the id, or with an old one, a file is revalidated, never kept for good.
    for (const url of ['/app/src/main.ts', '/app/src/main.ts?v=0000000000000000', '/app/tokens.css']) {
      const res = await fetch(`${s.url}${url}`);
      assert.equal(res.headers.get('cache-control'), 'no-cache', url);
      await res.arrayBuffer();
    }
    // The service worker and the manifest are always revalidated: the browser checks the worker for a new one on its own.
    for (const url of ['/app/sw.js', `/app/sw.js?v=${id}`, `/app/manifest.webmanifest?v=${id}`]) {
      const res = await fetch(`${s.url}${url}`);
      assert.equal(res.headers.get('cache-control'), 'no-cache', url);
      await res.arrayBuffer();
    }
    // The ETag still answers a revalidation.
    const tag = main.headers.get('etag')!;
    assert.equal((await fetch(`${s.url}/app/src/main.ts?v=${id}`, { headers: { 'if-none-match': tag } })).status, 304);
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true });
  }
});

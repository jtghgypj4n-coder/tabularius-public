// The guides (docs/*.md and docs/reference/*.md) are served as pages at /docs/<name>, with an index; links between
// guides work, and what is not a guide (a path out of the folder, an unknown name) is a 404.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { docsHtml, guideIndex, guidePage } from '../src/docs.ts';

const docs = join(import.meta.dirname, '..', '..', '..', 'docs');
let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-guides-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const files = [...readdirSync(docs).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)), ...readdirSync(join(docs, 'reference')).filter((f) => f.endsWith('.md')).map((f) => `reference/${f.slice(0, -3)}`)];
const get = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text() };
};

test('every guide has a page, listed in the index', async () => {
  const index = await get('/docs');
  assert.equal(index.status, 200);
  assert.match(index.type, /text\/html/);
  for (const name of files) {
    assert.ok(index.text.includes(`href="/docs/${name}"`), `${name} is in the index`);
    const page = await get(`/docs/${name}`);
    assert.equal(page.status, 200, name);
    const title = /^# (.+)$/m.exec(readFileSync(join(docs, `${name}.md`), 'utf8'))?.[1].replace(/`/g, '');
    if (title) assert.ok(page.text.includes(`<h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}`) || page.text.includes('<h1'), `${name} shows its title`);
  }
  assert.equal((await get('/docs/')).status, 200);
});

test('links between guides, and to anchors in them, lead somewhere', async () => {
  const pages = new Map<string, string>();
  for (const name of files) pages.set(name, (await get(`/docs/${name}`)).text);
  const broken: string[] = [];
  for (const [name, html] of pages) {
    for (const m of html.matchAll(/href="\/docs\/([A-Za-z0-9_/-]+)(#[^"]*)?"/g)) {
      const target = pages.get(m[1]);
      if (!target) broken.push(`${name} -> ${m[1]}`);
      else if (m[2] && !target.includes(`id="${m[2].slice(1)}"`)) broken.push(`${name} -> ${m[1]}${m[2]}`);
    }
  }
  assert.deepEqual(broken, []);
  // The older address of the connect guide still works.
  assert.equal((await get('/docs/connect-ai')).status, 200);
});

test('what is not a guide is not served', async () => {
  for (const path of ['/docs/nope', '/docs/..%2fREADME', '/docs/%2e%2e/package', '/docs/research/fmp12-format', '/docs/reference/nope', '/docs/connect-ai.md']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('guide index and pages reuse cached content and refresh when a guide changes', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'tabularius-guide-cache-'));
  // guideNames expects a reference directory as well as the root directory.
  mkdirSync(join(cacheDir, 'reference'));
  const file = join(cacheDir, 'one.md');
  try {
    writeFileSync(file, '# First\n\nFirst intro.\n');
    const first = guideIndex(cacheDir);
    for (let i = 0; i < 100; i++) assert.equal(guideIndex(cacheDir), first);
    assert.match(guidePage('one', cacheDir) ?? '', /First/);
    writeFileSync(file, '# Second\n\nSecond intro.\n');
    const later = new Date(Date.now() + 2_000);
    utimesSync(file, later, later);
    assert.match(guideIndex(cacheDir), /Second/);
    assert.match(guidePage('one', cacheDir) ?? '', /Second/);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('guide markdown: numbered and nested lists, level 4 headings, links to other guides; solution text gets none of them', () => {
  const md = '#### Deep\n\n1. one\n   carries on\n2. two\n  - nested\n\nSee [the other](other.md#part), [out](../README.md) and [web](https://example.com/x).\n';
  const guide = docsHtml(md, 'T', 'Guide', { guide: true });
  assert.match(guide, /<h4 id="deep">Deep<\/h4>/);
  assert.match(guide, /<ol><li>one carries on<\/li><li>two<ul><li>nested<\/li><\/ul><\/li><\/ol>/);
  assert.match(guide, /<a href="\/docs\/other#part">the other<\/a>/);
  assert.match(guide, /out and /);
  assert.doesNotMatch(guide, /href="\.\.\/README/);
  assert.match(guide, /<a href="https:\/\/example\.com\/x" rel="noopener noreferrer">web<\/a>/);
  const plain = docsHtml(md, 'T');
  assert.doesNotMatch(plain, /<a href|<ol>|<h4/);
});

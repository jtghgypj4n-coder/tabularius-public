// `npm run docs:build` turns the written guides into a static site folder. These tests build it from the real guides and check
// what a reader depends on: every guide has a page, every link and #anchor in the output lands, search finds the words the
// guides use, the pages ask the network for nothing, and the markup has the landmarks and names a screen reader needs. The
// Markdown renderer is checked on its own with small inputs, so a guide that starts using a new construct fails here first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import vm from 'node:vm';
import { buildSite, contentsProblems, readContents, resolveSiteLink, sourcePages, words } from '../../../scripts/docs-site-lib.ts';
import type { SearchIndex } from '../../../scripts/docs-site-lib.ts';
import { renderMarkdown, stripComments } from '../../../scripts/docs-site-markdown.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const html = (markdown: string) => renderMarkdown(markdown, { link: (href) => href }).html;
/** Objects made inside the page's own vm context have another prototype; compare their content. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// ---- the Markdown renderer ---------------------------------------------------------------------------------------------

test('headings get GitHub ids, repeated ones a number, and the page title is the first level-one heading', () => {
  const r = renderMarkdown('# The Title\n\n## Same\n\ntext\n\n## Same\n\n### `code` & more\n', { link: (h) => h });
  assert.equal(r.title, 'The Title');
  assert.deepEqual(r.headings.map((h) => h.id), ['the-title', 'same', 'same-1', 'code--more']);
  assert.match(r.html, /<h2 id="same-1">Same<a class="anchor" href="#same-1"/);
});

test('paragraphs, emphasis, code and escapes: text is never taken for markup', () => {
  assert.equal(html('a **bold** and *slanted* and `code <b>` and ~~gone~~'), '<p>a <strong>bold</strong> and <em>slanted</em> and <code>code &lt;b&gt;</code> and <del>gone</del></p>');
  assert.equal(html('2 * 3 and a_b_c and snake_case_name'), '<p>2 * 3 and a_b_c and snake_case_name</p>');
  assert.equal(html('\\*not emphasis\\* and \\<tag\\>'), '<p>*not emphasis* and &lt;tag&gt;</p>');
  // Raw tags that are not on the short list are text; script and style never get through.
  assert.equal(html('use <folder> and <script>alert(1)</script>'), '<p>use &lt;folder&gt; and &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(html('<kbd>Esc</kbd> and a<br>b'), '<p><kbd>Esc</kbd> and a<br>b</p>');
  assert.equal(html('line one  \nline two'), '<p>line one<br>line two</p>');
  assert.equal(html('line one\nline two'), '<p>line one line two</p>');
});

test('links: relative ones go through the linker, an unlinked file keeps its text, outside links open safely, javascript: never links', () => {
  const r = renderMarkdown('[a](x.md#h) [b](gone.ts) [c](https://example.org/a_(b)) <https://example.org> [d](javascript:alert(1)) [e](#top)', {
    link: (href) => (href.startsWith('gone') ? undefined : /^[a-z]+:/.test(href) ? href : `/site/${href}`),
  });
  assert.match(r.html, /<a href="\/site\/x\.md#h">a<\/a>/);
  assert.match(r.html, /<span class="not-a-link">b<\/span>/);
  assert.match(r.html, /<a href="https:\/\/example\.org\/a_\(b\)" rel="noopener noreferrer">c<\/a>/);
  assert.match(r.html, /<a href="https:\/\/example\.org" rel="noopener noreferrer">https:\/\/example\.org<\/a>/);
  assert.match(r.html, /<span class="not-a-link">d<\/span>/);
  assert.match(r.html, /<a href="\/site\/#top">e<\/a>/);
  assert.doesNotMatch(r.html, /javascript:/);
});

test('fenced code keeps every character, tildes and longer fences work, and a block carries a copy button', () => {
  const r = html('```sh\ntabularius <folder> && echo "a"\n  indented\n```\n\n~~~\nplain ``` inside\n~~~\n\n````md\n```\nnested\n```\n````');
  assert.match(r, /<pre data-lang="sh" tabindex="0"><code>tabularius &lt;folder&gt; &amp;&amp; echo &quot;a&quot;\n  indented<\/code><\/pre><button type="button" class="copy" hidden>Copy<\/button>/);
  assert.match(r, /<code>plain ``` inside<\/code>/);
  assert.match(r, /<code>```\nnested\n```<\/code>/);
  assert.equal((r.match(/class="copy"/g) ?? []).length, 3);
});

test('lists: bullets, numbers that carry on across a code block, nesting, and paragraphs and code inside an item', () => {
  assert.equal(html('- one\n- two\n  - nested\n  - more\n- three').replace(/\n/g, ''), '<ul><li>one</li><li>two<ul><li>nested</li><li>more</li></ul></li><li>three</li></ul>');
  assert.equal(html('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  const carried = html('1. First:\n\n   ```sh\n   run\n   ```\n\n2. Second');
  assert.match(carried, /<ol><li><p>First:<\/p>\n<div class="code-block"><pre data-lang="sh" tabindex="0"><code>run<\/code><\/pre>/);
  assert.match(carried, /<li><p>Second<\/p><\/li>/, 'a blank line between items makes the list loose');
  assert.equal(html('text\n- bullet after text'), '<p>text</p>\n<ul><li>bullet after text</li></ul>');
  assert.equal(html('A sentence ending in 2021.\n2021. Another'), '<p>A sentence ending in 2021. 2021. Another</p>', 'a number that is not 1 does not start a list inside a paragraph');
  assert.equal(html('3. third\n4. fourth'), '<ol start="3"><li>third</li><li>fourth</li></ol>');
  assert.equal(html('- item\n  continues here'), '<ul><li>item continues here</li></ul>');
});

test('tables: headers, alignment, escaped pipes, short rows, and inline markup in cells', () => {
  const r = html('## Things\n\n| Name | Count |\n| :--- | ---: |\n| `a\\|b` | **3** |\n| short |\n');
  assert.match(r, /<div class="table-wrap" role="region" tabindex="0" aria-label="Things"><table>/);
  assert.match(r, /<th style="text-align:left">Name<\/th><th style="text-align:right">Count<\/th>/);
  assert.match(r, /<td style="text-align:left"><code>a\|b<\/code><\/td><td style="text-align:right"><strong>3<\/strong><\/td>/);
  assert.match(r, /<td style="text-align:left">short<\/td><td style="text-align:right"><\/td>/);
});

test('quotes and callouts, rules, and comments (also over several lines and next to text)', () => {
  assert.equal(html('> quoted\n> more'), '<blockquote><p>quoted more</p></blockquote>');
  assert.match(html('> [!WARNING]\n> Careful'), /<blockquote class="callout callout-warning"><p class="callout-title">Warning<\/p><p>Careful<\/p><\/blockquote>/);
  assert.match(html('> **Note:** read this'), /callout-note/);
  assert.equal(html('before\n\n---\n\nafter'), '<p>before</p>\n<hr>\n<p>after</p>');
  assert.equal(stripComments('a <!-- gone --> b\n<!-- multi\nline -->\nc\n```\n<!-- kept -->\n```'), 'a  b\n\n\nc\n```\n<!-- kept -->\n```');
  assert.equal(html('text <!-- docs-example: run --> more'), '<p>text  more</p>');
  assert.doesNotMatch(html('<!-- known-difference: a ;; b ;; c ;; d -->\n\nvisible'), /known-difference/);
});

test('anchors written as <a id> pass through, and section text for search leaves out markup and the heading links', () => {
  const r = renderMarkdown('# Top\n\nintro words\n\n<a id="named"></a>\n\n## Part `one`\n\nSome *body* text with [a link](x.md).\n\n## Part two\n\nOther.', { link: (h) => h });
  assert.match(r.html, /<a id="named"><\/a>/);
  assert.deepEqual(r.sections.map((s) => [s.heading, s.text]), [['Top', 'Top intro words'], ['Part one', 'Part one Some body text with a link.'], ['Part two', 'Part two Other.']]);
});

// ---- the site built from the real guides --------------------------------------------------------------------------------

let out = '';
let built: ReturnType<typeof buildSite>;
before(() => {
  out = mkdtempSync(join(tmpdir(), 'docs-site-'));
  built = buildSite({ root, out, version: '9.9.9', commit: 'abc123def456' });
});
after(() => rmSync(out, { recursive: true, force: true }));

const read = (path: string) => readFileSync(join(out, path), 'utf8');
const pageFiles = () => built.files.filter((f) => f.endsWith('.html'));

test('every guide builds to a page, the build reports no problems, and the contents file lists each page once', () => {
  assert.deepEqual(built.problems, []);
  const sources = sourcePages(root);
  assert.deepEqual(built.pages.map((p) => p.src), sources);
  for (const src of sources) assert.ok(existsSync(join(out, src.replace(/\.md$/, '.html'))), `${src} has a page`);
  assert.ok(existsSync(join(out, 'index.html')));
  assert.deepEqual(contentsProblems(readContents(root), sources), []);
  // The pages are the guides: nothing the renderer could not read is left behind as markup.
  for (const f of pageFiles()) {
    const body = read(f).replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
    assert.doesNotMatch(body, /<!--|```|\]\([a-z./#]|\n\|\s*-{3}/, `${f} shows leftover markdown`);
  }
});

test('the contents file names its problems: an unknown page, a page twice, a page left out', () => {
  const sources = ['README.md', 'docs/a.md', 'docs/b.md'];
  assert.deepEqual(contentsProblems({ sections: [{ title: 'All', pages: ['README.md', 'docs/a.md', 'docs/b.md'] }] }, sources), []);
  const problems = contentsProblems({ sections: [{ title: 'One', pages: ['README.md', 'docs/a.md', 'docs/gone.md'] }, { title: 'Two', pages: ['docs/a.md'] }] }, sources);
  assert.deepEqual(problems, [
    'docs/contents.json lists docs/gone.md, which is not a page',
    'docs/contents.json lists docs/a.md more than once',
    'docs/b.md is not in docs/contents.json; add it to a section',
  ]);
});

test('every link and #anchor in the built pages lands on a file and an id that exist', () => {
  const ids = new Map<string, Set<string>>();
  const idsOf = (file: string): Set<string> => {
    if (!ids.has(file)) ids.set(file, new Set([...read(file).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    return ids.get(file)!;
  };
  const broken: string[] = [];
  let checked = 0;
  for (const file of pageFiles()) {
    for (const m of read(file).matchAll(/<(?:a|link|script)\s[^>]*?(?:href|src)="([^"]*)"/g)) {
      const target = resolveSiteLink(out, file, m[1].replace(/&amp;/g, '&'));
      if (!target) continue;
      checked++;
      if (!existsSync(join(out, target.file))) { broken.push(`${file}: ${m[1]} (no such file)`); continue; }
      if (target.fragment && target.file.endsWith('.html') && !idsOf(target.file).has(target.fragment)) broken.push(`${file}: ${m[1]} (no such id)`);
    }
  }
  assert.ok(checked > 3000, `only ${checked} links were looked at`);
  assert.deepEqual(broken, []);
});

test('the pages ask the network for nothing: no outside stylesheet, script, picture, font or request, and no inline script or style', () => {
  for (const file of built.files.filter((f) => /\.(html|css|js|svg)$/.test(f))) {
    const text = read(file);
    if (file.endsWith('.html')) {
      assert.doesNotMatch(text, /<(?:script|link|img|iframe|source|embed|object|video|audio)\b[^>]*(?:src|href)="(?:https?:)?\/\//i, `${file} loads something from outside`);
      assert.doesNotMatch(text, /<script(?![^>]*\ssrc=)[^>]*>/i, `${file} has an inline script`);
      assert.doesNotMatch(text, /<style\b|\sstyle="(?![^"]*text-align:(?:left|right|center);?")/i, `${file} has inline style that is not a column alignment`);
      assert.doesNotMatch(text, /\son[a-z]+="/i, `${file} has an inline event handler`);
    } else if (file.endsWith('.css')) {
      assert.doesNotMatch(text, /@import|url\(\s*["']?(?:https?:)?\/\//i, `${file} loads something from outside`);
    } else if (file.endsWith('.js') && !file.endsWith('search-index.js')) {
      assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\s*\(/, `${file} can make a request`);
      // The one thing a script loads is the search index beside it, as a script tag.
      for (const m of text.matchAll(/https?:\/\/[^\s'")]+/g)) assert.fail(`${file} names an outside address ${m[0]}`);
    } else if (file.endsWith('.svg')) {
      assert.doesNotMatch(text, /(?:href|src)="https?:/i);
    }
  }
});

test('every page has a language, a title, one level-one heading, landmarks, a skip link and named navigation, with unique ids', () => {
  for (const file of pageFiles()) {
    const text = read(file);
    assert.match(text, /^<!doctype html>\n<html lang="en">/, file);
    assert.match(text, /<title>[^<]+ · Tabularius docs<\/title>/, file);
    assert.equal((text.match(/<h1[\s>]/g) ?? []).length, 1, `${file} needs exactly one h1`);
    assert.match(text, /<a class="skip" href="#main">Skip to content<\/a>/, file);
    assert.match(text, /<main id="main" tabindex="-1">/, file);
    assert.match(text, /<header class="site-header">/, file);
    assert.match(text, /<nav class="site-nav" aria-label="Documentation"/, file);
    assert.match(text, /<footer class="site-footer">/, file);
    assert.match(text, /<meta name="viewport" content="width=device-width, initial-scale=1">/, file);
    const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual([...new Set(dupes)], [], `${file} repeats ids`);
    // Heading levels never jump down by more than one inside the article (a level skipped confuses a screen reader's outline).
    const article = /<article[\s\S]*?<\/article>/.exec(text)?.[0] ?? '';
    let level = 0;
    for (const m of article.matchAll(/<h([1-6])[\s>]/g)) {
      const n = Number(m[1]);
      if (level && n > level + 1 && !file.startsWith('docs/reference/')) assert.fail(`${file} jumps from h${level} to h${n}`);
      level = n;
    }
    // Exactly one link in the menu is marked as the page you are on, and it is this page.
    if (file !== 'index.html') {
      const here = [...text.matchAll(/<a href="([^"]+)" aria-current="page">/g)];
      assert.equal(here.length, 1, `${file} marks one menu entry as current`);
      assert.equal(posix.normalize(posix.join(posix.dirname(file), here[0][1])), file);
    }
  }
  // Tables a keyboard can scroll are named, and buttons say what they do.
  assert.doesNotMatch(read('docs/runbook.html'), /<div class="table-wrap"(?![^>]*aria-label=)/);
});

test('the footer stamps the version and commit, and the same inputs build the same bytes', () => {
  assert.match(read('index.html'), /Tabularius 9\.9\.9 · commit <code>abc123def456<\/code>/);
  assert.match(read('docs/runbook.html'), /Tabularius 9\.9\.9 · commit/);
  const again = mkdtempSync(join(tmpdir(), 'docs-site-again-'));
  try {
    const second = buildSite({ root, out: again, version: '9.9.9', commit: 'abc123def456' });
    assert.deepEqual(second.files, built.files);
    for (const f of built.files) assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(again, f))), `${f} differs between two builds`);
  } finally { rmSync(again, { recursive: true, force: true }); }
});

test('dark and light both come from the shared tokens, by the system setting and by choice', () => {
  const css = read('assets/site.css');
  assert.match(css, /:root\[data-theme="dark"\] \{ color-scheme: dark; /);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{ /);
  const tokens = readFileSync(join(root, 'packages', 'web', 'tokens.css'), 'utf8');
  const darkBrand = /--brand: (#[0-9a-f]{6}); --brand-hover[^\n]*\n[^\n]*\n[^\n]*--shadow/.exec(tokens)?.[1] ?? /@media \(prefers-color-scheme: dark\)[\s\S]*?--brand: (#[0-9a-f]{6})/.exec(tokens)![1];
  assert.ok(css.includes(`--brand: ${darkBrand}`), 'the dark brand colour is the shared one');
  assert.match(css, /@media print/);
  assert.match(css, /@media \(forced-colors: active\)/);
});

// ---- search ---------------------------------------------------------------------------------------------------------------

interface Engine {
  tokenize(text: string): string[];
  search(index: SearchIndex, query: string, limit?: number): { section: SearchIndex['sections'][number]; page: SearchIndex['pages'][number]; score: number }[];
  segments(text: string, terms: string[]): { text: string; match: boolean }[];
  snippet(text: string, terms: string[], length: number): string;
}
function loadSearch(): { engine: Engine; index: SearchIndex } {
  const sandbox: Record<string, unknown> = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('assets/search.js'), sandbox);
  vm.runInContext(read('assets/search-index.js'), sandbox);
  const window = sandbox.window as { TabulariusDocsSearch: Engine; TabulariusDocsIndex: SearchIndex };
  return { engine: window.TabulariusDocsSearch, index: window.TabulariusDocsIndex };
}

test('search finds known terms on the page that explains them, from the words in the guides, with a section to land on', () => {
  const { engine, index } = loadSearch();
  const top = (query: string) => engine.search(index, query, 5).map((h) => `${h.page.u}#${h.section.a}`);
  assert.ok(index.sections.length > 800, `${index.sections.length} sections indexed`);
  assert.equal(index.pages.length, built.pages.length);
  // A symptom, a setting, a command and a code are each found where the guide that covers them says so.
  assert.ok(top('forgot admin console password').some((u) => u === 'docs/runbook.html#forgot-the-admin-console-password'), top('forgot admin console password').join(', '));
  assert.ok(top('TABULARIUS_HOME').some((u) => u.startsWith('docs/environment-variables.html')), top('TABULARIUS_HOME').join(', '));
  assert.ok(top('verify-backup').some((u) => /^(docs\/runbook|docs\/troubleshooting|ADMIN)\.html/.test(u)), top('verify-backup').join(', '));
  assert.ok(top('952 token').some((u) => u.startsWith('docs/troubleshooting.html')), top('952 token').join(', '));
  // Every result links to a heading that exists on its page, or to the top of it.
  for (const q of ['backup', 'password', 'restore', 'script', 'certificate', 'quick start']) {
    for (const h of engine.search(index, q, 20)) {
      assert.ok(h.section.a === '' || read(h.page.u).includes(`id="${h.section.a}"`), `${q}: ${h.page.u}#${h.section.a}`);
    }
  }
});

test('search matches every word of the query, by whole word or by its start, and ranks headings and titles first', () => {
  const { engine, index } = loadSearch();
  const some = engine.search(index, 'forgot passw', 5);
  assert.ok(some.length > 0 && some.every((h) => /forgot/.test(h.section.w) && /passw/.test(h.section.w)));
  assert.deepEqual(plain(engine.search(index, 'zzzqqqxxx', 5)), []);
  assert.deepEqual(plain(engine.search(index, '   ', 5)), []);
  const ranked = engine.search(index, 'runbook', 3);
  assert.equal(ranked[0].page.u, 'docs/runbook.html', 'a page whose title is the word comes first');
  assert.deepEqual(plain(engine.tokenize('TABULARIUS_HOME, v2.3')), ['tabularius_home', 'tabularius', 'home', 'v2', '3']);
  assert.deepEqual(words('Set up --workers 4'), ['set', 'up', 'workers', '4']);
});

test('result text is cut into plain pieces for the page to mark, and a snippet shows the word that matched', () => {
  const { engine } = loadSearch();
  assert.deepEqual(plain(engine.segments('a <b>word</b> here', ['word'])), [{ text: 'a <b>', match: false }, { text: 'word', match: true }, { text: '</b> here', match: false }]);
  assert.deepEqual(plain(engine.segments('nothing', [])), [{ text: 'nothing', match: false }]);
  const long = `${'start '.repeat(40)}needle ${'end '.repeat(40)}`;
  const snippet = engine.snippet(long, ['needle'], 120);
  assert.ok(snippet.includes('needle') && snippet.startsWith('…') && snippet.length < 160, snippet);
  assert.equal(engine.snippet('short text', ['text'], 120), 'short text');
});

// ---- the command ----------------------------------------------------------------------------------------------------------

test('npm run docs:build writes the folder it is given, says so, and refuses an option it does not know', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-cli-'));
  try {
    const ok = spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'docs-site.ts'), '--out', dir, '--version', '1.2.3', '--commit', 'feedface0000'], { encoding: 'utf8', cwd: root });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Built \d+ pages and \d+ files/);
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /Tabularius 1\.2\.3 · commit <code>feedface0000<\/code>/);
    assert.ok(statSync(join(dir, 'assets', 'search-index.js')).size > 100_000);
    const bad = spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'docs-site.ts'), '--nonsense'], { encoding: 'utf8', cwd: root });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown option --nonsense/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.ok(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['docs:build'], 'package.json has the docs:build script');
});

test('the build stops with the broken link named, and builds nothing, when a guide points at a missing file or heading', () => {
  const fake = mkdtempSync(join(tmpdir(), 'docs-broken-'));
  try {
    // A two-page tree with one good link, one missing file and one missing heading.
    const w = (rel: string, text: string) => { const f = join(fake, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
    w('package.json', '{"version":"0.0.0"}');
    w('packages/web/tokens.css', readFileSync(join(root, 'packages', 'web', 'tokens.css'), 'utf8'));
    w('docs/brand/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    w('docs/contents.json', JSON.stringify({ sections: [{ title: 'All', pages: ['README.md', 'docs/a.md'] }] }));
    w('README.md', '# Home\n\n[good](docs/a.md#there) [missing file](docs/nope.md) [missing heading](docs/a.md#nowhere)\n');
    w('docs/a.md', '# A\n\n## There\n');
    const result = buildSite({ root: fake, out: join(fake, 'out'), version: '0', commit: 'x' });
    assert.deepEqual(result.problems, ['README.md: docs/nope.md points at nothing', 'README.md: docs/a.md#nowhere has no such heading']);
    assert.deepEqual(result.files, []);
    assert.ok(!existsSync(join(fake, 'out')));
  } finally { rmSync(fake, { recursive: true, force: true }); }
});


// `npm run docs:build`: the written guides (README, QUICKSTART, ADMIN, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT and
// docs/**/*.md) as a static site folder. Pages mirror the Markdown paths (docs/runbook.md becomes docs/runbook.html);
// the menu comes from docs/contents.json; search runs in the browser over an index written beside the pages. Nothing is
// fetched from the network, and every file works when opened straight from disk.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { escapeHtml, plainText, renderMarkdown } from './docs-site-markdown.ts';
import type { Rendered } from './docs-site-markdown.ts';

export const SITE_NAME = 'Tabularius';
const ROOT_DOCS = ['README.md', 'QUICKSTART.md', 'ADMIN.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md'];
const ASSETS = join(import.meta.dirname, 'docs-site-assets');

export interface ContentsSection { title: string; pages: string[] }
export interface Contents { sections: ContentsSection[] }

export interface Page {
  /** Repository path of the Markdown, with `/`. */
  src: string;
  /** Path of the page in the site folder. */
  out: string;
  title: string;
  summary: string;
  rendered: Rendered;
  /** Every id on the page: headings and `<a id>` anchors. */
  ids: Set<string>;
}

export interface SiteOptions {
  root: string;
  out: string;
  version: string;
  commit: string;
}

export interface BuildResult { pages: Page[]; files: string[]; problems: string[] }

/** The pages people write by hand, as repository paths. */
export function sourcePages(root: string): string[] {
  const out = ROOT_DOCS.filter((f) => existsSync(join(root, f)));
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (name.endsWith('.md')) out.push(path);
    }
  };
  walk('docs');
  return out;
}

export function readContents(root: string): Contents {
  const raw = JSON.parse(readFileSync(join(root, 'docs', 'contents.json'), 'utf8')) as Contents;
  if (!Array.isArray(raw.sections)) throw new Error('docs/contents.json needs a "sections" list');
  return raw;
}

/** Errors in the contents file against the pages: unknown paths, a page listed twice, a page left out. */
export function contentsProblems(contents: Contents, sources: string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const section of contents.sections) {
    if (!section.title || !Array.isArray(section.pages)) problems.push(`docs/contents.json: every section needs a title and a pages list`);
    for (const page of section.pages ?? []) {
      if (!sources.includes(page)) problems.push(`docs/contents.json lists ${page}, which is not a page`);
      else if (seen.has(page)) problems.push(`docs/contents.json lists ${page} more than once`);
      seen.add(page);
    }
  }
  for (const source of sources) if (!seen.has(source)) problems.push(`${source} is not in docs/contents.json; add it to a section`);
  return problems;
}

const outPath = (src: string) => src.replace(/\.md$/, '.html');
/** The path from one site file to another, with `/`. */
const rel = (from: string, to: string): string => posix.relative(posix.dirname(from), to) || posix.basename(to);

function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

export function render(root: string, sources: string[]): { pages: Page[]; problems: string[] } {
  const problems: string[] = [];
  const set = new Set(sources);
  const links: { from: string; to: string; fragment: string }[] = [];
  const pages: Page[] = sources.map((src) => {
    const rendered = renderMarkdown(readFileSync(join(root, src), 'utf8'), {
      link(href) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return /^(https?:|mailto:)/i.test(href) ? href : undefined;
        const [pathPart, fragment = ''] = href.split('#');
        if (!pathPart) return `#${fragment}`;
        const target = posix.normalize(posix.join(posix.dirname(src), decodeURIComponent(pathPart))).replace(/\/$/, '');
        if (set.has(target)) {
          links.push({ from: src, to: target, fragment: decodeURIComponent(fragment) });
          return rel(outPath(src), outPath(target)) + (fragment ? `#${fragment}` : '');
        }
        // A file or folder of the repository that is not a page here (source code, an example folder): shown, not linked.
        if (existsSync(join(root, target))) return undefined;
        problems.push(`${src}: ${href} points at nothing`);
        return undefined;
      },
    });
    const title = rendered.title || posix.basename(src, '.md');
    return { src, out: outPath(src), title, summary: rendered.summary, rendered, ids: idsOf(rendered.html) };
  });
  const byOut = new Map(pages.map((p) => [p.src, p]));
  for (const l of links) {
    if (l.fragment && !byOut.get(l.to)!.ids.has(l.fragment)) problems.push(`${l.from}: ${l.to}#${l.fragment} has no such heading`);
  }
  return { pages, problems };
}

// ---- the search index -----------------------------------------------------------------------------------------------

/** Words as the search matches them: letters and digits, and a name with underscores both whole and in parts. */
export function words(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) {
    const w = m[0];
    out.add(w);
    if (w.includes('_')) for (const part of w.split('_')) if (part) out.add(part);
  }
  return [...out];
}

/** How much of each section the index keeps to show a result from. */
const SNIPPET_CHARS = 500;

export interface SearchIndex {
  version: 1;
  pages: { u: string; t: string }[];
  /** One entry per section: page, heading, anchor, a snippet and the words it contains. */
  sections: { p: number; h: string; a: string; x: string; w: string }[];
}

export function searchIndex(pages: Page[]): SearchIndex {
  const index: SearchIndex = { version: 1, pages: [], sections: [] };
  pages.forEach((page, p) => {
    index.pages.push({ u: page.out, t: page.title });
    for (const section of page.rendered.sections) {
      if (!section.text && !section.heading) continue;
      index.sections.push({ p, h: section.heading, a: section.id, x: section.text.slice(0, SNIPPET_CHARS), w: words(`${section.heading} ${section.text}`).join(' ') });
    }
  });
  return index;
}

// ---- the page -------------------------------------------------------------------------------------------------------

/** The shared design tokens, with the dark palette also reachable by choice (`data-theme`) and not only by the system's setting. */
export function themeCss(root: string): string {
  const tokens = readFileSync(join(root, 'packages', 'web', 'tokens.css'), 'utf8');
  const light = /^:root\s*\{([\s\S]*?)^\}/m.exec(tokens);
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/.exec(tokens);
  if (!light || !dark) throw new Error('packages/web/tokens.css no longer has the :root block and the dark palette block docs:build reads');
  const lightValues = light[1].replace(/color-scheme:[^;]*;/, '').replace(/\n\s*font:[^;]*;/, '');
  return `:root { color-scheme: light dark; ${lightValues} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark[1]} } }
:root[data-theme="dark"] { color-scheme: dark; ${dark[1]} }
:root[data-theme="light"] { color-scheme: light; }
`;
}

const MARK = '<svg class="mark" width="24" height="24" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="18.5" width="26" height="6.5" rx="2.4" fill="currentColor"/><rect x="3" y="10.5" width="26" height="6.5" rx="2.4" fill="currentColor" opacity=".72"/><rect x="7" y="2.5" width="22" height="6.5" rx="2.4" fill="var(--brand)"/></svg>';

interface Layout { options: SiteOptions; contents: Contents; pages: Page[]; order: Page[] }

function header(from: string): string {
  const to = (p: string) => rel(from, p);
  return `<header class="site-header">
<a class="brand" href="${to('index.html')}">${MARK}<span>${SITE_NAME} <span class="brand-docs">docs</span></span></a>
<form class="search" role="search" action="#" hidden>
<label class="visually-hidden" for="q">Search the documentation</label>
<input id="q" name="q" type="search" placeholder="Search the docs" autocomplete="off" spellcheck="false" aria-controls="search-results" aria-describedby="search-hint">
<span id="search-hint" class="visually-hidden">Press the slash key to jump here. Use the down arrow to move through the results and Escape to close them.</span>
<div id="search-results" class="search-results" hidden></div>
<p id="search-status" class="visually-hidden" role="status"></p>
</form>
<button type="button" class="theme" id="theme" hidden>Theme</button>
</header>`;
}

function nav(layout: Layout, current: Page | undefined): string {
  const from = current?.out ?? 'index.html';
  const byPath = new Map(layout.pages.map((p) => [p.src, p]));
  const sections = layout.contents.sections.map((section) => {
    const open = current !== undefined && section.pages.includes(current.src);
    const items = section.pages.map((src) => {
      const page = byPath.get(src)!;
      const here = page === current;
      return `<li><a href="${rel(from, page.out)}"${here ? ' aria-current="page"' : ''}>${escapeHtml(page.title)}</a></li>`;
    });
    return `<details class="nav-section"${open || current === undefined ? ' open' : ''}><summary>${escapeHtml(section.title)}</summary><ul>${items.join('')}</ul></details>`;
  });
  return `<nav class="site-nav" aria-label="Documentation" id="site-nav">${sections.join('\n')}</nav>`;
}

function toc(page: Page): string {
  const headings = page.rendered.headings.filter((h) => h.level >= 2 && h.level <= 3);
  if (headings.length < 3) return '';
  return `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${headings.map((h) => `<li class="toc-${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`;
}

function footer(layout: Layout, from: string): string {
  const { version, commit } = layout.options;
  return `<footer class="site-footer"><p>${SITE_NAME} ${escapeHtml(version)} · commit <code>${escapeHtml(commit)}</code> · these pages are built from the guides in the repository and make no network requests.</p></footer>`;
}

function shell(layout: Layout, from: string, title: string, body: string, current: Page | undefined, aside = ''): string {
  const to = (p: string) => rel(from, p);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · ${SITE_NAME} docs</title>
<meta name="generator" content="${SITE_NAME} ${escapeHtml(layout.options.version)} docs:build">
<link rel="icon" href="${to('assets/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${to('assets/site.css')}">
<script src="${to('assets/theme.js')}"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${header(from)}
<div class="frame">
<details class="nav-box" id="nav-box" open><summary class="nav-toggle">Contents</summary>
${nav(layout, current)}
</details>
<main id="main" tabindex="-1">
${body}
${footer(layout, from)}
</main>
${aside}
</div>
<noscript><p class="noscript">Search needs JavaScript. Everything else on these pages works without it.</p></noscript>
<script src="${to('assets/search.js')}" defer></script>
<script src="${to('assets/site.js')}" defer></script>
</body>
</html>
`;
}

function pager(layout: Layout, page: Page): string {
  const i = layout.order.indexOf(page);
  const prev = layout.order[i - 1];
  const next = layout.order[i + 1];
  if (!prev && !next) return '';
  const link = (p: Page, label: string, cls: string) => `<a class="${cls}" href="${rel(page.out, p.out)}" rel="${cls}"><span class="pager-label">${label}</span><span>${escapeHtml(p.title)}</span></a>`;
  return `<nav class="pager" aria-label="Previous and next page">${prev ? link(prev, 'Previous', 'prev') : '<span></span>'}${next ? link(next, 'Next', 'next') : '<span></span>'}</nav>`;
}

function pageHtml(layout: Layout, page: Page): string {
  const body = `<article class="doc">
${page.rendered.html}
</article>
${pager(layout, page)}`;
  return shell(layout, page.out, page.title, body, page, toc(page));
}

function indexHtml(layout: Layout): string {
  const sections = layout.contents.sections.map((section) => {
    const byPath = new Map(layout.pages.map((p) => [p.src, p]));
    const items = section.pages.map((src) => {
      const page = byPath.get(src)!;
      const summary = page.summary.length > 170 ? `${page.summary.slice(0, 167).replace(/\s+\S*$/, '')}…` : page.summary;
      return `<li><a href="${page.out}">${escapeHtml(page.title)}</a>${summary ? `<span class="summary"> ${escapeHtml(summary)}</span>` : ''}</li>`;
    });
    return `<section class="contents-section"><h2>${escapeHtml(section.title)}</h2><ul class="contents-list">${items.join('')}</ul></section>`;
  });
  const body = `<article class="doc landing">
<h1>${SITE_NAME} documentation</h1>
<p>Guides for hosting, running and building on ${SITE_NAME}. Search covers every page; press <kbd>/</kbd> to start. This copy matches version ${escapeHtml(layout.options.version)}.</p>
${sections.join('\n')}
</article>`;
  return shell(layout, 'index.html', `${SITE_NAME} documentation`, body, undefined);
}

// ---- the build ------------------------------------------------------------------------------------------------------

const write = (out: string, path: string, content: string | Buffer, files: string[]): void => {
  const file = join(out, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  files.push(path);
};

export function buildSite(options: SiteOptions): BuildResult {
  const { root, out } = options;
  const sources = sourcePages(root);
  const contents = readContents(root);
  const { pages, problems } = render(root, sources);
  problems.push(...contentsProblems(contents, sources));
  if (problems.length) return { pages, files: [], problems };
  const byPath = new Map(pages.map((p) => [p.src, p]));
  const order = contents.sections.flatMap((s) => s.pages.map((src) => byPath.get(src)!));
  const layout: Layout = { options, contents, pages, order };
  const files: string[] = [];
  for (const page of pages) write(out, page.out, pageHtml(layout, page), files);
  write(out, 'index.html', indexHtml(layout), files);
  write(out, 'assets/site.css', themeCss(root) + readFileSync(join(ASSETS, 'site.css'), 'utf8'), files);
  for (const name of ['site.js', 'search.js', 'theme.js']) write(out, `assets/${name}`, readFileSync(join(ASSETS, name)), files);
  write(out, 'assets/favicon.svg', readFileSync(join(root, 'docs', 'brand', 'favicon.svg')), files);
  write(out, 'assets/search-index.js', `window.TabulariusDocsIndex = ${JSON.stringify(searchIndex(order))};\n`, files);
  return { pages, files: files.sort(), problems };
}

/** The version in package.json and the commit the folder is built from (`unknown` outside a checkout). */
export function stamp(root: string, git: (args: string[]) => string | undefined): { version: string; commit: string } {
  const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
  const commit = process.env.GITHUB_SHA?.slice(0, 12) ?? git(['rev-parse', '--short=12', 'HEAD']) ?? 'unknown';
  return { version, commit };
}

/** Where a link from `from` lands, for the tests: the file in the site folder and the fragment. */
export function resolveSiteLink(out: string, from: string, href: string): { file: string; fragment: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const [pathPart, fragment = ''] = href.split('#');
  const file = pathPart ? resolve(dirname(join(out, from)), decodeURIComponent(pathPart)) : join(out, from);
  return { file: relative(out, file).split(sep).join('/'), fragment: decodeURIComponent(fragment) };
}

export { plainText };

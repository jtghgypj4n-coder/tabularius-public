// The product website draft (site/): its pages must not link to files that are not there, must not use the
// FileMaker or Claris names as a product name or headline, and must not carry an address or a personal name
// that is not a placeholder. checkSite() is run on the real folder and on a folder with planted problems, so a
// rule that stopped catching its problem fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The sentences in which the two names are plainly a statement about someone else's product. */
const ALLOWED_NAMING = [
  /Tabularius is not affiliated with Claris International Inc\./g,
  /FileMaker is a\s+trademark of Claris International Inc\./g,
  /against Claris's guide/g,
  /checks it against Claris's guide/g,
];

/** A home folder, a mount point or a session link: the pieces are joined here so this file does not hold one itself. */
const PRIVATE = new RegExp(['/(Users|home|mnt)/[A-Za-z0-9_.-]+', 'session' + '_0', 'project' + '-files'].join('|'));

/** The visible text of an HTML page: no scripts, styles or tags. */
function visibleText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
}

/** Problems in the pages of a site folder, each as "file: what is wrong". */
export function checkSite(dir: string): string[] {
  const problems: string[] = [];
  for (const file of files(dir)) {
    const name = file.slice(dir.length + 1);
    if (!/\.(html|md)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const html = file.endsWith('.html');

    // A link or an image that points at a file that is not in the folder.
    if (html) {
      for (const m of text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)/g)) {
        const ref = (m[1] ?? m[2]).split(/[?#]/)[0];
        if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|data:)/i.test(ref)) continue;
        if (!existsSync(resolve(dirname(file), ref))) problems.push(`${name}: links to ${ref}, which is not in the folder`);
      }

      // One h1, and no heading level skipped.
      const levels = [...text.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      if (levels.length && levels.filter((l) => l === 1).length !== 1) problems.push(`${name}: needs exactly one h1`);
      for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) problems.push(`${name}: heading level skipped (h${levels[i - 1]} then h${levels[i]})`);

      // The page's name, description and headline describe the product factually.
      const head = [/<title>([\s\S]*?)<\/title>/, /<meta name="description" content="([^"]*)"/, /<h1[^>]*>([\s\S]*?)<\/h1>/]
        .map((re) => re.exec(text)?.[1] ?? '').join(' ') + ' ' + (/class="tag"[^>]*>([\s\S]*?)<\/p>/.exec(text)?.[1] ?? '');
      if (/FileMaker|Claris/i.test(head.replace(/<[^>]+>/g, ' '))) problems.push(`${name}: the title, description or headline uses a trademark; say ".fmp12 files" instead`);
    }

    // The trademark names only where the page says whose they are or what it is compared with.
    let rest = html ? visibleText(text) : text;
    for (const allowed of ALLOWED_NAMING) rest = rest.replace(allowed, ' ');
    const named = rest.match(/.{0,30}(?:FileMaker|Claris).{0,30}/gi) ?? [];
    for (const n of named) {
      if (!/Data API|\.fmp12|trademark|affiliated/i.test(n.replace(/\s+/g, ' '))) problems.push(`${name}: "${n.replace(/\s+/g, ' ').trim()}" uses a trademark as a product name`);
    }

    // Addresses: only the reserved example domain.
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      if (!/^example\.(com|org|net)$/i.test(m[1])) problems.push(`${name}: the address ${m[0]} is not a placeholder (use you@example.com)`);
    }

    // A quote that names its speaker, or a private path or link.
    if (html && /<cite[\s>]/.test(text)) problems.push(`${name}: a quote with a named speaker needs that person's consent; leave it out until then`);
    if (PRIVATE.test(text)) problems.push(`${name}: a private path or link`);
  }
  return problems;
}

test('the site draft links only to files that exist and names no trademark as a product', { skip: existsSync(join(root, 'site')) ? false : 'no site folder' }, () => {
  assert.deepEqual(checkSite(join(root, 'site')), []);
});

test('the site draft keeps no screenshots or reference captures of someone else\'s product or site', { skip: existsSync(join(root, 'site')) ? false : 'no site folder' }, () => {
  const stray = files(join(root, 'site')).map((f) => f.slice(root.length + 1)).filter((f) => /^site\/(refs|archive)\//.test(f) || /\bshots?\b/.test(f));
  assert.deepEqual(stray, [], 'screenshots of third-party solutions and reference captures of other companies\' sites do not belong in the repository');
});

test('checkSite catches a broken image, a trademark headline, a stray address and a named quote', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-check-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), [
      '<!doctype html><html lang="en"><head><title>FileMaker, reimagined</title>',
      '<meta name="description" content="Tabularius opens your .fmp12 files."></head><body>',
      '<h1>Tabularius</h1><p class="tag">FileMaker, reimagined.</p><h3>Skipped</h3>',
      '<img src="assets/missing.jpg" alt="">',
      '<blockquote>Words.</blockquote><cite>Someone</cite>',
      '<p>Try FileMaker today. Write to alex@company.com.</p>',
      '</body></html>',
    ].join('\n'));
    const found = checkSite(dir).join('\n');
    assert.match(found, /links to assets\/missing\.jpg/);
    assert.match(found, /title, description or headline uses a trademark/);
    assert.match(found, /heading level skipped/);
    assert.match(found, /alex@company\.com is not a placeholder/);
    assert.match(found, /named speaker/);
    assert.match(found, /uses a trademark as a product name/);
    // The factual sentences pass.
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>T</title><h1>Opens .fmp12 files</h1><p>Tabularius is not affiliated with Claris International Inc. FileMaker is a trademark of Claris International Inc.</p><p>Contact you@example.com</p>');
    assert.deepEqual(checkSite(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Every relative link in the written docs lands on a file that exists, and every #anchor on a heading or an <a id>
// in it (a broken link in a guide reads as a missing feature, so this keeps them honest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const ROOT_DOCS = ['README.md', 'ADMIN.md', 'QUICKSTART.md', 'SECURITY.md'];

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) markdownFiles(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Text without fenced code, whose brackets are code and not links. */
const prose = (text: string) => text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, (m) => m.replace(/[[\]()]/g, ' '));

/** The id GitHub (and the docs viewer) gives a heading. */
const slug = (heading: string) => heading.trim().toLowerCase().replace(/[`*_~]/g, (c) => (c === '_' ? '_' : '')).replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');

function anchorsOf(file: string): Set<string> {
  const text = readFileSync(file, 'utf8').replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
  const ids = new Set<string>();
  const seen = new Map<string, number>();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  for (const m of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

test('relative links and #anchors in the docs all resolve', () => {
  const files = [...ROOT_DOCS.map((f) => join(root, f)).filter(existsSync), ...markdownFiles(join(root, 'docs'))];
  const anchors = new Map<string, Set<string>>();
  const idsOf = (f: string) => anchors.get(f) ?? anchors.set(f, anchorsOf(f)).get(f)!;
  const broken: string[] = [];
  for (const file of files) {
    for (const m of prose(readFileSync(file, 'utf8')).matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue; // https:, mailto:, ...
      const [pathPart, fragment] = href.split('#');
      const target = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart)) : file;
      if (!existsSync(target)) { broken.push(`${relative(root, file)}: ${href} (no such file)`); continue; }
      if (fragment && target.endsWith('.md') && !idsOf(target).has(decodeURIComponent(fragment))) broken.push(`${relative(root, file)}: ${href} (no such heading)`);
    }
  }
  assert.deepEqual(broken, [], `broken links:\n${broken.join('\n')}`);
});

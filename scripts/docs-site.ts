// Builds the documentation site: `npm run docs:build [-- --out <folder>] [--version <v>] [--commit <sha>]`.
// The folder (default dist/docs-site) holds one HTML page per guide, a contents page, a search index and the few
// files they share. Open index.html straight from disk, or put the folder on any static host.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildSite, stamp } from './docs-site-lib.ts';

const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
for (const a of args) if (a.startsWith('--') && !['--out', '--version', '--commit'].includes(a)) { console.error(`Unknown option ${a}. Options: --out <folder>, --version <v>, --commit <sha>.`); process.exit(2); }

const git = (a: string[]): string | undefined => {
  try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; }
};
const { version, commit } = stamp(root, git);
const out = resolve(value('--out') ?? join(root, 'dist', 'docs-site'));
rmSync(out, { recursive: true, force: true });
const result = buildSite({ root, out, version: value('--version') ?? version, commit: value('--commit') ?? commit });
if (result.problems.length) {
  console.error(`The documentation site was not built:\n${result.problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Built ${result.pages.length} pages and ${result.files.length} files in ${relative(process.cwd(), out) || '.'}`);
console.log(`Open ${relative(process.cwd(), join(out, 'index.html')) || 'index.html'} in a browser.`);

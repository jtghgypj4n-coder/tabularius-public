// What ships in a release must be credited: every npm package that goes into the program has a licence notice (or a
// declared licence), and every source file written from another project is listed in scripts/bundled-sources.ts and
// credited in NOTICE, which is also where the software bill of materials (scripts/sbom.ts) gets them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BUNDLED_SOURCES } from '../../../scripts/bundled-sources.ts';
import { collectNotices } from '../../../scripts/third-party-notices.ts';

const root = join(import.meta.dirname, '..', '..', '..');

/** Every file that ships in the program from packages/ (tests and dependencies are not part of it): code, pages, styles. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'test' || e.name === 'e2e' ? [] : sources(p);
    return /\.(ts|js|mjs|cjs|css|html|svg|json)$/.test(e.name) && !/package(?:-lock)?\.json$|tsconfig/.test(e.name) ? [p] : [];
  });
}
const programSources = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== 'node_modules')
  .flatMap((e) => sources(join(root, 'packages', e.name)));

test('NOTICE credits every project the source was written from', () => {
  const notice = readFileSync(join(root, 'NOTICE'), 'utf8').replace(/\s+/g, ' ');
  for (const s of BUNDLED_SOURCES) assert.ok(notice.includes(s.url), `NOTICE does not name ${s.name} (${s.url})`);
});

test('each file listed as written from another project exists and says so', () => {
  for (const s of BUNDLED_SOURCES) {
    for (const f of s.files) {
      assert.ok(existsSync(join(root, f)), `${f} (${s.name}) is not there`);
      const text = readFileSync(join(root, f), 'utf8');
      assert.ok(s.mentions.some((m) => new RegExp(`(?<![A-Za-z0-9])${m.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![A-Za-z0-9])`).test(text)), `${f} does not name ${s.name} (${s.mentions.join(' or ')})`);
    }
  }
});

test('a source file that names another project\'s repository, says it was ported, or credits a Creative Commons licence is listed', () => {
  const listed = new Map(BUNDLED_SOURCES.flatMap((s) => s.files.map((f) => [f, s] as const)));
  const known = new Set(BUNDLED_SOURCES.map((s) => s.repo.toLowerCase()));
  const own = /^(?:jtghgypj4n-coder|sitotisai)\//;
  const credits = /\b(?:ported|adapted) from\b|\bCC[- ]BY\b|Creative Commons|\bBSD licen[cs]e\b|\bApache[- ]2(?:\.0)?\b licen[cs]e|licen[cs]ed under/i;
  const problems: string[] = [];
  for (const file of programSources) {
    const name = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    const repos = [...text.matchAll(/github\.com\/([A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)/g)].map((m) => m[1]).filter((r) => !own.test(r));
    if (!listed.has(name)) {
      const slug = BUNDLED_SOURCES.find((s) => text.includes(s.repo));
      if (repos.length || slug || credits.test(text)) problems.push(`${name}: credits another project but is not in scripts/bundled-sources.ts`);
    } else {
      // A listed file may name only the repositories listed: a second source credited in it is still a gap.
      for (const r of repos) if (!known.has(r.toLowerCase())) problems.push(`${name}: names ${r}, which is not in scripts/bundled-sources.ts`);
    }
  }
  assert.deepEqual(problems, [], 'add the project to scripts/bundled-sources.ts and credit it in NOTICE');
});

test('every npm package that ships in the program has a licence notice', (t) => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean; link?: boolean }> };
  const shipped = new Set(Object.entries(lock.packages)
    .filter(([path, p]) => path.includes('node_modules/') && !p.dev && !p.link && p.version)
    .map(([path, p]) => `${path.split('node_modules/').pop()}@${p.version}`));
  assert.ok(shipped.size > 20, 'the lock file lists the production dependencies');
  const found = collectNotices(root);
  if (!found.length) return t.skip('no dependencies installed here');
  const covered = new Set(found.map((n) => `${n.name}@${n.version}`));
  const missing = [...shipped].filter((k) => !covered.has(k)).sort();
  // An optional package for another system is in the lock but not installed here.
  const lockOptional = new Set(Object.entries(lock.packages).filter(([, p]) => (p as { optional?: boolean }).optional).map(([path, p]) => `${path.split('node_modules/').pop()}@${p.version}`));
  assert.deepEqual(missing.filter((k) => !lockOptional.has(k)), [], 'shipped packages with no notice: they are in the lock file but not installed, so the build would leave their licence out');
  const bare = found.filter((n) => shipped.has(`${n.name}@${n.version}`) && !n.texts.length && n.licence === '(none declared)').map((n) => `${n.name}@${n.version}`);
  assert.deepEqual(bare, [], 'shipped packages with neither a licence file nor a declared licence');
});

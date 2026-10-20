// scripts/release-notes.ts: the area a pull request lands in, what the notes say of it, the conversion work counted and
// never listed, no names of people, and the git history read as the docs/versioning.md conventions say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AREAS, areaOf, buildNotes, lineOf, pullsFromGit, type MergedPull } from '../../../scripts/release-notes-lib.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const script = join(root, 'scripts', 'release-notes.ts');

test('a label decides the area, then a title prefix, then the files changed', () => {
  assert.equal(areaOf({ number: 1, title: 'Docs: x', labels: ['area:Web client'], files: ['docs/a.md'] }), 'Web client');
  assert.equal(areaOf({ number: 2, title: 'Docs: x', files: ['packages/web/src/main.ts'] }), 'Documentation');
  assert.equal(areaOf({ number: 3, title: '[SQL] x', files: [] }), 'Data API, OData and SQL');
  assert.equal(areaOf({ number: 4, title: 'Fix a thing', files: ['packages/fmp12/src/blocks.ts'] }), 'Conversion');
  assert.equal(areaOf({ number: 5, title: 'Fix a thing', files: ['packages/web/src/design/main.ts', 'docs/design-mode.md'] }), 'Design mode');
  assert.equal(areaOf({ number: 6, title: 'Fix a thing', files: ['docs/a.md', 'docs/b.md', 'packages/cli/src/main.ts'] }), 'Documentation');
  assert.equal(areaOf({ number: 7, title: 'Fix a thing', files: ['.github/workflows/ci.yml'] }), 'Build and tests');
  assert.equal(areaOf({ number: 8, title: 'Fix a thing', files: ['somewhere/else.txt'] }), 'Other');
  assert.equal(areaOf({ number: 9, title: 'Fix a thing' }), 'Other');
  assert.equal(areaOf({ number: 10, title: 'Fix a thing', labels: ['area:nonsense'], files: ['packages/plugins/src/a.ts'] }), 'Plug-ins');
});

test('every area is named once, and the prefixes point at areas that exist', async () => {
  const { PREFIXES } = await import('../../../scripts/release-notes-lib.ts');
  assert.equal(new Set(AREAS.map((a) => a.name)).size, AREAS.length);
  for (const target of Object.values(PREFIXES)) assert.ok(AREAS.some((a) => a.name === target), target);
});

test('a line is the title without backlog tags, mentions or addresses, or the Release note line, or nothing', () => {
  assert.equal(lineOf({ number: 1, title: 'MBS JS.* on the JavaScript sandbox (r17e-13)' }), 'MBS JS.* on the JavaScript sandbox');
  assert.equal(lineOf({ number: 2, title: 'Fix the find width (u-find-width)' }), 'Fix the find width');
  assert.equal(lineOf({ number: 3, title: 'thanks @someone and mail me at a.b@example.com for the fix' }), 'Thanks and mail me at for the fix');
  assert.equal(lineOf({ number: 4, title: 'Long internal title', body: 'Before: x\n\nRelease note: Finds ignore accents again.' }), 'Finds ignore accents again');
  assert.equal(lineOf({ number: 5, title: 'Internal tidy-up', body: 'Release note: none' }), undefined);
  assert.equal(lineOf({ number: 6, title: '(r1-1)' }), undefined);
});

test('conversion work is counted, never listed, and the counts and the rest are right', () => {
  const pulls: MergedPull[] = [
    { number: 30, title: 'Read the Acme Corp invoice file layouts', files: ['packages/fmp12/src/layouts.ts'] },
    { number: 29, title: 'Read sample Foo.fmp12 containers', files: ['packages/fmp12/src/containers.ts'] },
    { number: 28, title: 'Web client: a thing', files: ['packages/web/src/main.ts'] },
    { number: 27, title: 'Web client: another', files: ['packages/web/src/main.ts'] },
    { number: 26, title: 'Web client: older', files: ['packages/web/src/main.ts'] },
    { number: 25, title: 'Tidy', body: 'Release note: none', files: ['docs/a.md'] },
  ];
  const notes = buildNotes(pulls, { version: '1.2.3', maxPerArea: 2 });
  assert.match(notes, /^## 1\.2\.3\n/);
  assert.match(notes, /### Conversion\n\n2 changes to how FileMaker files are read and converted/);
  assert.doesNotMatch(notes, /Acme|Foo\.fmp12|#30|#29/);
  assert.match(notes, /### Web client\n\n- Web client: a thing \(#28\)\n- Web client: another \(#27\)\n- …and 1 more\n/);
  assert.doesNotMatch(notes, /#26|#25/);
  assert.match(notes, /5 merged pull requests, 1 left out at their own request\./);
  assert.ok(notes.indexOf('### Conversion') < notes.indexOf('### Web client'), 'areas come in the fixed order');
});

test('the history is read: pull request merges only, newest first, title from the body, files from the diff', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-notes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  git('add', '.'); git('commit', '-q', '-m', 'first');
  const merge = (n: number, branch: string, title: string, file: string) => {
    git('checkout', '-q', '-b', branch);
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), String(n));
    git('add', '.'); git('commit', '-q', '-m', `work on ${branch}`);
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', `Merge pull request #${n} from someone/${branch}\n\n${title}`, branch);
  };
  merge(11, 'docs-one', 'Docs: explain the thing', 'docs/one.md');
  git('tag', 'v0.0.9');
  merge(12, 'web-two', 'A web client thing', 'packages/web/src/two.ts');
  git('merge', '-q', '--no-ff', '-m', 'Merge remote-tracking branch origin/main', 'HEAD');

  assert.deepEqual(pullsFromGit(dir), [
    { number: 12, title: 'A web client thing', files: ['packages/web/src/two.ts'] },
    { number: 11, title: 'Docs: explain the thing', files: ['docs/one.md'] },
  ]);
  assert.deepEqual(pullsFromGit(dir, 'v0.0.9').map((p) => p.number), [12]);
  const notes = buildNotes(pullsFromGit(dir), { version: '0.1.0' });
  assert.match(notes, /### Web client\n\n- A web client thing \(#12\)/);
  assert.match(notes, /### Documentation\n\n- Docs: explain the thing \(#11\)/);
  assert.doesNotMatch(notes, /someone|T <t@/);
});

test('the command writes notes from a list of pull requests, as a changelog on request, and says plainly what is wrong', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-notes-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prs = join(dir, 'prs.json');
  writeFileSync(prs, JSON.stringify([{ number: 7, title: 'Plug-ins: a signed example', labels: [], files: [] }]));
  const run = (...a: string[]) => spawnSync(process.execPath, ['--no-warnings', script, ...a], { encoding: 'utf8' });

  const plain = run('--version', '0.2.0', '--prs', prs);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^## 0\.2\.0\n\n### Plug-ins\n\n- Plug-ins: a signed example \(#7\)\n/);
  const out = join(dir, 'CHANGELOG.md');
  const log = run('--version', '0.2.0', '--prs', prs, '--changelog', '--out', out);
  assert.equal(log.status, 0, log.stderr);
  assert.match(log.stdout, /CHANGELOG\.md: written/);
  assert.match(spawnSync('head', ['-3', out], { encoding: 'utf8' }).stdout, /^# Changelog\n\nWhat changed in each version/);

  for (const [args, message] of [[[], /give the version/], [['--version'], /--version needs a value/], [['--version', '1', '--bogus'], /Unknown option --bogus/], [['--version', '1', '--prs', join(dir, 'missing.json')], /ENOENT|no such file/]] as const) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, new RegExp(`^release-notes: `));
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  }
});

test('the real history of this checkout reads without a name of a person in the notes', () => {
  const pulls = pullsFromGit(root);
  if (pulls.length === 0) return; // a shallow clone has no merges to read
  assert.ok(pulls.every((p) => Number.isInteger(p.number) && p.title), 'every pull request has a number and a title');
  const notes = buildNotes(pulls, { version: '0.0.0' });
  assert.doesNotMatch(notes, /jtghgypj4n|noreply@|Co-Authored-By/i);
});

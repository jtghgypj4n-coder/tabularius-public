// Builds the one-commit copy of the repository that the public repo starts from, and checks it. It stops there:
// nothing is pushed, no remote is added, no repository is created. The owner decides when to go public
// (notes/public-launch.md has the checklist).
//
//   node --no-warnings scripts/public-snapshot.ts [--out DIR] [--author "Name <email>"] [--skip-tests] [--repo OWNER/NAME]
//
// What it does, in a temporary folder (or --out, which must not exist yet):
//   1. Exports the committed files of HEAD (`git archive`), so uncommitted work and ignored files never go in.
//      With --repo OWNER/NAME it points the install scripts and links at the new public repository.
//   2. Checks the tree: the licence files, the fork guard in ci.yml, no FileMaker file or fixture, no key material
//      or token shapes, no private address or personal path outside documentation placeholders, the dependency gate.
//   3. Runs `npm ci`, the typecheck, the name guard and (unless --skip-tests) `npm run fixtures` and `npm run test:ci`.
//   4. Makes a fresh git repository with ONE commit under a neutral author and checks that nothing else is in it.
//   5. Runs the release audit (scripts/release-audit.ts) over that repository's files: allow-list, modes, secrets, personal details.
// Exit code 0 means the snapshot is ready; the last lines say where it is and the commands to publish it by hand.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { KEY_SHAPES, PRIVATE_SHAPES, auditTree } from './release-audit.ts';

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const AUTHOR = option('--author') ?? 'Tabularius contributors <noreply@tabularius.invalid>';
const authorMatch = /^(.+?)\s*<([^<>\s]+)>$/.exec(AUTHOR);
if (!authorMatch) { console.error(`--author must look like "Name <email>", not "${AUTHOR}"`); process.exit(2); }
const [, AUTHOR_NAME, AUTHOR_EMAIL] = authorMatch;

const problems: string[] = [];
const fail = (message: string) => { problems.push(message); console.error(`  FAIL ${message}`); };
const step = (title: string) => console.log(`\n== ${title}`);

function sh(cmd: string, cmdArgs: string[], cwd: string, env: Record<string, string> = {}): string {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 });
}
function run(label: string, cmd: string, cmdArgs: string[], cwd: string): boolean {
  console.log(`  $ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: process.env });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status})`);
  return r.status === 0;
}

/** All files under a folder, as paths relative to it. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base)); else out.push(relative(base, p));
  }
  return out;
}

const SKIP_CONTENT = /(^|\/)(test|e2e)\/|\.test\.ts$|^docs\/reference\/|^package-lock\.json$/;
const TEXT = /\.(ts|js|mjs|json|md|yml|yaml|sh|ps1|html|css|txt|toml|plist|service|xml|sql|rb|nuspec)$|^(LICENSE|NOTICE|Dockerfile)$/;

const work = option('--out') ?? mkdtempSync(join(tmpdir(), 'tabularius-public-'));
if (option('--out') && existsSync(work)) { console.error(`${work} already exists; give --out a new folder`); process.exit(2); }
const tree = join(work, 'tree');

step('Export the committed files of HEAD');
const head = sh('git', ['rev-parse', '--short', 'HEAD'], ROOT).trim();
const dirty = sh('git', ['status', '--porcelain', '--untracked-files=no'], ROOT).trim();
if (dirty) console.log('  note: the working tree has uncommitted changes; only what is committed in HEAD is exported');
console.log(`  from ${head} into ${tree}`);
sh('mkdir', ['-p', tree], ROOT);
execFileSync('sh', ['-c', `git archive HEAD | tar -x -C "${tree}"`], { cwd: ROOT, stdio: 'inherit' });
const OLD_REPO = 'jtghgypj4n-coder/tabularius-public';
const newRepo = option('--repo');
if (newRepo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(newRepo)) { console.error(`--repo must look like owner/name, not "${newRepo}"`); process.exit(2); }
if (newRepo !== undefined) {
  for (const f of walk(tree)) {
    const path = join(tree, f);
    if (!TEXT.test(f)) continue;
    const text = readFileSync(path, 'utf8');
    if (text.includes(OLD_REPO)) { writeFileSync(path, text.split(OLD_REPO).join(newRepo)); console.log(`  ${f}: repository address set to ${newRepo}`); }
  }
}
const files = walk(tree);
console.log(`  ${files.length} files`);

step('Make the one-commit repository (the checks below need it: they read the tracked files)');
const env = {
  GIT_AUTHOR_NAME: AUTHOR_NAME, GIT_AUTHOR_EMAIL: AUTHOR_EMAIL, GIT_COMMITTER_NAME: AUTHOR_NAME, GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
// node_modules and the fetched fixtures are ignored by the tree's own .gitignore, so they stay out of the commit.
const version = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8')).version as string;
sh('git', ['init', '-q', '-b', 'main'], tree, env);
sh('git', ['add', '-A'], tree, env);
sh('git', ['commit', '-q', '-m', `tabularius ${version}`], tree, env);

step('Check the tree');
for (const f of files) {
  if (TEXT.test(f) && readFileSync(join(tree, f), 'utf8').includes(OLD_REPO)) {
    console.log(`  note: ${f} still names ${OLD_REPO}; re-run with --repo OWNER/NAME once the public repository's name is chosen`);
  }
}
for (const f of ['LICENSE', 'NOTICE', 'README.md', 'SECURITY.md', 'package.json', 'package-lock.json']) {
  if (!existsSync(join(tree, f))) fail(`${f} is missing`);
}
if (existsSync(join(tree, 'LICENSE')) && !/^MIT License/.test(readFileSync(join(tree, 'LICENSE'), 'utf8'))) fail('LICENSE is not the MIT licence');
if (JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8')).license !== 'MIT') fail('package.json does not say "license": "MIT"');

// The self-hosted runner must never run a fork's pull request (the owner's macOS user hosts the files).
const workflows = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
if (workflows.length === 0) fail('no workflows in the tree');
for (const w of workflows) {
  const text = readFileSync(join(tree, w), 'utf8');
  if (/self-hosted/.test(text) && /pull_request/.test(text) && !/head\.repo\.full_name\s*==\s*github\.repository/.test(text)) {
    fail(`${w} runs pull requests on a self-hosted runner without the fork guard (see notes/workflows-to-add/README.md)`);
  }
}

for (const f of files) {
  if (/\.fmp12$/i.test(f) || f.startsWith('fixtures/') || /\.(sqlite|sqlite3|db|pem|p12|pfx|key)$/i.test(f) || /(^|\/)\.env(\.|$)/.test(f)) fail(`${f} must not be in the public tree`);
}
for (const f of files) {
  if (!TEXT.test(f) || SKIP_CONTENT.test(f)) continue;
  const lines = readFileSync(join(tree, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [what, re] of [...KEY_SHAPES, ...PRIVATE_SHAPES]) if (re.test(line)) fail(`${f}:${i + 1} looks like ${what}`);
  });
}
// Private addresses: the documentation address 192.168.1.20 and the loopback/RFC examples in tests are fine.
for (const f of files) {
  if (!TEXT.test(f) || SKIP_CONTENT.test(f)) continue;
  readFileSync(join(tree, f), 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\b192\.168\.\d+\.\d+\b/g)) if (m[0] !== '192.168.1.20' && !/^192\.168\.(0\.0|1\.(5|10|50))$/.test(m[0])) fail(`${f}:${i + 1} has the private address ${m[0]}`);
  });
}
if (problems.length === 0) console.log('  files, secrets, personal details: clean');

step('Install, then the dependency gate, the name guard and the typecheck');
if (run('npm ci', 'npm', ['ci', '--no-audit', '--no-fund'], tree)) {
  run('dependency gate', 'node', ['--no-warnings', 'scripts/dependency-gate.ts'], tree);
  const guard = spawnSync('node', ['--no-warnings', '--test', 'packages/cli/test/no-private-names.test.ts'], { cwd: tree, encoding: 'utf8' });
  console.log(`  name guard: ${/# pass 1\b/.test(guard.stdout) && guard.status === 0 ? 'passed' : 'FAILED'}`);
  if (guard.status !== 0 || !/# pass 1\b/.test(guard.stdout) || /# skipped [1-9]/.test(guard.stdout)) fail(`the name guard did not pass (or was skipped):\n${guard.stdout.split('\n').filter((l) => /^\s*\+|banned|not ok/.test(l)).join('\n')}`);
  run('typecheck', 'npm', ['run', 'typecheck'], tree);
  if (flag('--skip-tests')) console.log('\n  --skip-tests: the fixtures and the full test run were skipped, so the snapshot is NOT fully verified');
  else if (run('fixtures', 'npm', ['run', 'fixtures'], tree)) run('tests', 'npm', ['run', 'test:ci'], tree);
}

step('Check the one-commit repository');
const log = sh('git', ['log', '--all', '--format=%H|%an|%ae|%cn|%ce'], tree, env).trim().split('\n');
if (log.length !== 1) fail(`expected one commit, found ${log.length}`);
for (const line of log) {
  const [, an, ae, cn, ce] = line.split('|');
  if (an !== AUTHOR_NAME || cn !== AUTHOR_NAME || ae !== AUTHOR_EMAIL || ce !== AUTHOR_EMAIL) fail(`a commit has an identity other than ${AUTHOR}`);
}
if (sh('git', ['remote'], tree, env).trim()) fail('the snapshot repository has a remote');
if (sh('git', ['status', '--porcelain'], tree, env).trim()) fail('the committed tree differs from the exported one (something was changed by the install or the tests)');
const tracked = sh('git', ['ls-files'], tree, env).trim().split('\n').length;
console.log(`  1 commit, ${tracked} files, author ${AUTHOR}`);

step('Audit the contents of the one-commit repository');
// The same allow-list and rules as the release pack (scripts/release-audit.ts): a file nobody listed, a stray executable,
// a secret or a personal detail fails here too.
const contents = auditTree(tree);
for (const f of contents) fail(`${f.rule}: ${f.path}${f.line ? `:${f.line}` : ''} ${f.detail}`);
if (contents.length === 0) console.log('  every file is on the allow-list; nothing found');


if (problems.length) {
  console.error(`\nNOT READY: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`The snapshot is at ${tree} (kept for inspection). Nothing was pushed.`);
  process.exit(1);
}
console.log(`\nREADY. The snapshot is at ${tree}. Nothing was pushed and no repository was created.`);
console.log('When the owner says go, from that folder (the new repository must already exist and be empty):');
console.log('  git remote add origin git@github.com:<owner>/<new-repo>.git');
console.log('  git push -u origin main');

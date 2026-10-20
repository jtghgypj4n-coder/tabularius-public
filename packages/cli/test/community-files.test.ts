// The files a stranger looks for on the repository's first day exist, say what they should, and point at things
// that exist: the licence, the code of conduct, the security policy, the contributing guide, the issue forms and the
// pull request form. Workflow files are not touched here (they are proposed separately).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const templates = readdirSync(join(root, '.github', 'ISSUE_TEMPLATE')).filter((f) => f.endsWith('.md')).map((f) => `.github/ISSUE_TEMPLATE/${f}`);

/** Relative links of a Markdown file, outside code blocks. */
function localLinks(path: string): string[] {
  const text = read(path).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  return [...text.matchAll(/(?<!!)\[[^\]\n]+\]\(([^\s)]+)\)/g)].map((m) => m[1]).filter((href) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href));
}

test('the files a public repository is expected to have are there', () => {
  for (const f of ['LICENSE', 'README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/config.yml']) {
    assert.ok(existsSync(join(root, f)), f);
  }
  assert.ok(templates.length >= 3, 'a bug, a feature and a file-does-not-open form');
  assert.ok(templates.some((t) => t.endsWith('file_does_not_open.md')));
});

test('every relative link in these files goes to a file or folder that exists', () => {
  for (const f of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', '.github/pull_request_template.md', 'docs/reporting-a-file-that-does-not-open.md', ...templates]) {
    for (const href of localLinks(f)) {
      assert.ok(existsSync(resolve(root, dirname(f), decodeURIComponent(href.split(/[?#]/)[0]))), `${f} links to ${href}, which does not exist`);
    }
  }
});

test('each issue form has its front matter, and none asks for a file or a password', () => {
  for (const t of templates) {
    const text = read(t);
    assert.match(text, /^---\nname: .+\nabout: .+\n(?:title: .*\n)?labels: .+\n/, `${t} has front matter`);
    assert.match(text, /SECURITY\.md/, `${t} sends security problems to the private route`);
    assert.doesNotMatch(text, /(?<!\b(?:not|never) )\b(attach|upload|send)\b[^.\n]*\b(your|the) (?:\.fmp12|file|database|backup)\b(?![^.\n]*\b(?:not|never|don't|do not)\b)/i, `${t} must not ask for the file`);
  }
  const form = read('.github/ISSUE_TEMPLATE/file_does_not_open.md');
  assert.match(form, /do not attach the file/i);
  assert.match(form, /tabularius info/);
  assert.match(form, /tabularius version/);
});

test('the pull request form, the contributing guide and the code of conduct agree with each other', () => {
  const form = read('.github/pull_request_template.md');
  const guide = read('CONTRIBUTING.md');
  const headings = [...form.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings.slice(0, 3), ['Before', 'After', 'How']);
  for (const h of headings.slice(0, 3)) assert.match(guide, new RegExp(`\\*\\*${h}\\*\\*`), `the guide names ${h}`);
  for (const cmd of form.matchAll(/`npm (?:run )?([a-z:]+)[^`]*`/g)) {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    assert.ok(cmd[1] in scripts || cmd[1] === 'test', `the form names npm script ${cmd[1]}`);
  }
  assert.match(guide, /CODE_OF_CONDUCT\.md/);
  assert.match(guide, /MIT/);
  assert.match(guide, /no runtime dependencies/);
  const pkg = JSON.parse(read('package.json')) as { dependencies?: object };
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'the guide says there are no runtime dependencies');
  assert.match(read('CODE_OF_CONDUCT.md'), /Reporting a problem/);
});

test('the security policy says how to report, what to expect, which versions and what is out of scope', () => {
  const policy = read('SECURITY.md');
  for (const heading of ['Reporting a vulnerability', 'What to expect', 'Supported versions', 'In scope', 'Out of scope']) {
    assert.match(policy, new RegExp(`^#{2,3} ${heading}$`, 'm'), heading);
  }
  assert.match(policy, /private vulnerability reporting/i);
  assert.match(policy, /no service-level agreement/i, 'it does not promise more than volunteers can keep');
  assert.match(policy, /\(#known-limitations\)/);
  assert.match(policy, /^## Known limitations$/m);
});

test('a CODEOWNERS file, if there is one, has no placeholder in it', () => {
  for (const f of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
    if (!existsSync(join(root, f))) continue;
    assert.doesNotMatch(read(f), /your-|example|placeholder|TODO|@org\b|@owner\b/i, f);
  }
});

test('the page on reporting a file that does not open only suggests commands that print no data', () => {
  const page = read('docs/reporting-a-file-that-does-not-open.md');
  const commands = [...page.matchAll(/^tabularius (\w+)/gm)].map((m) => m[1]);
  // `diagnostics` writes no record, script or password either: diagnostics.test.ts seeds every kind and checks none reaches the bundle.
  assert.deepEqual([...new Set(commands)].sort(), ['diagnostics', 'info', 'version']);
  assert.match(page, /never to send|never send|What never to send/i);
  assert.match(page, /Save a Copy as/);
});

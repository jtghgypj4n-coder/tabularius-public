// The command list and the environment variables are described in prose, so
// these checks fail when the code and the documentation stop agreeing: a
// command with no usage text or no mention in the docs, or an TABULARIUS_*
// variable the code reads that no page names (or a page names that nothing reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';
import { testCommandPath } from '../../../scripts/test-command-path.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const mainSource = readFileSync(main, 'utf8');

/** Every file under `dir` (relative to the repository), skipping dependencies and dot folders. */
function files(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

const pages = ['README.md', 'ADMIN.md', 'SECURITY.md', 'QUICKSTART.md', ...files('docs', (p) => p.endsWith('.md'))].filter((p) => existsSync(join(root, p)));
const pageText = pages.map((p) => readFileSync(join(root, p), 'utf8')).join('\n');

const USAGE = mainSource.slice(mainSource.indexOf('const USAGE = `'), mainSource.indexOf('`;', mainSource.indexOf('const USAGE = `')));
const usageCommands = [...new Set([...USAGE.matchAll(/^ {2}tabularius ([a-z][\w-]*)/gm)].map((m) => m[1]))];

/**
 * Words that are cases of a switch in main.ts but not commands of their own: the actions of `privileges`
 * (`tabularius privileges show|save|...`), which its usage lines list.
 */
const SUBCOMMANDS = new Set(['show', 'save', 'account', 'external', 'policy', 'must-change', 'grant', 'revoke']);

test('every command the CLI dispatches has usage text', () => {
  const dispatched = [...new Set([...mainSource.matchAll(/^ {4}case '([a-z][\w-]*)':/gm)].map((m) => m[1]))].filter((c) => !SUBCOMMANDS.has(c));
  const unlisted = dispatched.filter((c) => !usageCommands.includes(c));
  assert.deepEqual(unlisted, [], 'commands handled in main.ts that the USAGE text does not list');
});

test('every command in the usage text is named in the documentation', () => {
  const undocumented = usageCommands.filter((c) => !new RegExp(`tabularius ${c}\\b`).test(pageText));
  assert.deepEqual(undocumented, [], 'commands with no `tabularius <command>` in the README, ADMIN, SECURITY, QUICKSTART or docs/');
});

test('help <command> prints the usage of every command in the usage text', async (t) => {
  const env = testCommandPath(t);
  const bad: string[] = [];
  for (let i = 0; i < usageCommands.length; i += 8) {
    const batch = usageCommands.slice(i, i + 8);
    const results = await Promise.all(batch.map((c) => runCli(main, ['help', c], { env: { ...env, PORT: '1' } })));
    results.forEach((r, j) => {
      if (r.status !== 0 || !r.stdout.startsWith('Usage:\n') || !new RegExp(`^  tabularius ${batch[j]}\\b`, 'm').test(r.stdout)) bad.push(batch[j]);
    });
  }
  assert.deepEqual(bad, [], 'commands whose `help <command>` does not print their own usage lines');
});

/**
 * Names the code reads that a page need not describe, each with its reason.
 * Adding a name here is a decision that nobody outside the project needs it.
 */
const NOT_DOCUMENTED: Record<string, string> = {};

/** Names a page uses that the server does not read, each with its reason. */
const NOT_READ: Record<string, string> = {
  TABULARIUS_AUTH: 'the name an example gives to the MCP client\'s own variable holding the bearer token',
};

test('every TABULARIUS_* variable the code reads is documented, and every documented one is read', () => {
  const sources = [
    ...files('packages', (p) => /[\\/]src[\\/].+\.(ts|js|cjs|mjs)$/.test(p)),
    ...files('scripts', (p) => /\.(ts|js|cjs|mjs)$/.test(p)),
  ];
  // A name ending in _ is a family written TABULARIUS_AI_EMBED_* in prose, not a variable.
  const names = (text: string) => new Set([...text.matchAll(/\bTABULARIUS_[A-Z0-9_]*[A-Z0-9]\b/g)].map((m) => m[0]));
  const read = names(sources.map((p) => readFileSync(join(root, p), 'utf8')).join('\n'));
  const written = names(pageText);
  const undocumented = [...read].filter((n) => !written.has(n) && !(n in NOT_DOCUMENTED)).sort();
  assert.deepEqual(undocumented, [], 'variables the code reads that no page names: describe them in docs/environment-variables.md');

  // A page may name a variable only a test, an end-to-end run or a deployment file reads (compose, Dockerfile, workflows).
  const deployment = [
    ...files('packages', (p) => /\.(ts|js|cjs|mjs)$/.test(p)),
    ...readdirSync(root).filter((n) => /^(?:compose.*\.ya?ml|Dockerfile.*)$/.test(n)),
    ...(existsSync(join(root, '.github')) ? files('.github', () => true) : []),
  ];
  const elsewhere = names(deployment.map((p) => readFileSync(join(root, p), 'utf8')).join('\n'));
  const stale = [...written].filter((n) => !read.has(n) && !elsewhere.has(n) && !(n in NOT_READ)).sort();
  assert.deepEqual(stale, [], 'variables a page names that no code reads');
  for (const n of Object.keys(NOT_DOCUMENTED)) assert.ok(read.has(n) && !written.has(n), `${n} no longer needs an exemption`);
  for (const n of Object.keys(NOT_READ)) assert.ok(written.has(n) && !read.has(n), `${n} no longer needs an exemption`);
});

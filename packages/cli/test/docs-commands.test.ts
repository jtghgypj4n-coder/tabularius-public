// The four documents a newcomer follows (README, QUICKSTART, ADMIN, "Moving a solution") name commands and options. These
// checks fail when one of them no longer exists, when a command's option is not in its `help`, when an `npm run` script is
// gone, and when a page's Node version differs from package.json. (docs-run.test.ts runs the marked examples.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';
import { inlineCode, tabulariusCall, root, shellCommands, shellFences } from './docs-examples.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const PAGES = ['README.md', 'QUICKSTART.md', 'ADMIN.md', 'docs/moving-a-solution.md'];
// Options every command accepts, or that name the program rather than a command.
const GLOBAL = new Set(['--help', '--version']);

const helpCache = new Map<string, Promise<string>>();
const helpOf = (command: string): Promise<string> => {
  if (!helpCache.has(command)) helpCache.set(command, runCli(main, ['help', command], { env: { ...process.env, PORT: '1' } }).then((r) => (r.status === 0 ? r.stdout : '')));
  return helpCache.get(command)!;
};

interface Where { file: string; line: number; text: string }
const examples = (): (Where & { call: NonNullable<ReturnType<typeof tabulariusCall>> })[] => {
  const out: (Where & { call: NonNullable<ReturnType<typeof tabulariusCall>> })[] = [];
  for (const file of PAGES) {
    for (const f of shellFences(file)) {
      for (const cmd of shellCommands(f.body)) {
        const call = tabulariusCall(cmd);
        if (call) out.push({ file, line: f.line, text: cmd, call });
      }
    }
    for (const c of inlineCode(file)) {
      const call = tabulariusCall(c.text);
      if (call && !['is', 'the'].includes(call.command)) out.push({ file, line: c.line, text: c.text, call });
    }
  }
  return out;
};

test('every Tabularius command the four pages show exists', async () => {
  const calls = examples();
  assert.ok(calls.length > 100, `found ${calls.length} examples; the extractor stopped finding them`);
  const missing: string[] = [];
  for (const command of new Set(calls.map((c) => c.call.command))) if (!(await helpOf(command))) missing.push(command);
  assert.deepEqual(missing, [], `commands named in ${PAGES.join(', ')} that \`tabularius help <command>\` does not know`);
});

test('every option the four pages show is in that command\'s help', async () => {
  const wrong: string[] = [];
  for (const { file, line, text, call } of examples()) {
    const help = await helpOf(call.command);
    for (const flag of call.flags) if (!GLOBAL.has(flag) && !help.includes(flag)) wrong.push(`${file}:${line} ${call.command} has no ${flag}: ${text}`);
    if (call.serveFlags.length) {
      const serve = await helpOf('serve');
      for (const flag of call.serveFlags) if (!serve.includes(flag)) wrong.push(`${file}:${line} serve has no ${flag}: ${text}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('an option that belongs to serve is not given to service install without --', async () => {
  const r = await runCli(main, ['service', 'print', tmpdir(), '--https', 'local'], { env: { ...process.env, HOME: tmpdir() } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--https is not an option of service print\. Options for serve go after "--"/);
});

test('every npm script the four pages run is in package.json', () => {
  const scripts = new Set(Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts));
  const missing: string[] = [];
  for (const file of PAGES) {
    for (const f of shellFences(file)) {
      for (const cmd of shellCommands(f.body)) {
        const m = /(?:^|\s)npm run ([\w:-]+)/.exec(cmd);
        if (m && !scripts.has(m[1])) missing.push(`${file}:${f.line} npm run ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('the Node version the pages ask for is the one package.json requires', () => {
  const required = /(\d+\.\d+)/.exec(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node)![1];
  const wrong: string[] = [];
  for (const file of PAGES) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const m of text.matchAll(/Node (?:v?)(\d+\.\d+)/g)) if (m[1] !== required) wrong.push(`${file}: Node ${m[1]} (package.json says ${required})`);
  }
  assert.deepEqual(wrong, []);
});

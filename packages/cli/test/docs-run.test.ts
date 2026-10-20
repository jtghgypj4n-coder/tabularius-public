// The command examples in the hand-written pages (see docs-examples.ts for the marks): every example that runs Tabularius says
// whether it runs as written, runs once placeholders are replaced, or only shows a shape; the first two are run in an empty
// home folder that holds a hosted `Invoices` (the invoicing starter) in ~/Databases; and every command and option any example
// shows exists in that command's `help`. Commands that start a server and never return (`serve`, `standby`, `mcp`, `tabularius`
// on its own) are checked by the second part only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runCli } from './cli-run.ts';
import { handWrittenDocs, inlineCode, tabulariusCall, root, shellCommands, shellFences } from './docs-examples.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const fixtures = join(root, 'fixtures', 'fmp12');
const NEVER_RETURN = new Set(['serve', 'standby', 'mcp', 'service', 'upgrade', 'backup-loop']);
const GLOBAL = new Set(['--help', '--version']);

const helpCache = new Map<string, Promise<string>>();
const helpOf = (command: string): Promise<string> => {
  if (!helpCache.has(command)) helpCache.set(command, runCli(main, ['help', command], { env: { ...process.env, PORT: '1' } }).then((r) => (r.status === 0 ? r.stdout : '')));
  return helpCache.get(command)!;
};

test('every shell example that runs Tabularius carries a docs-example mark', () => {
  const unmarked: string[] = [];
  for (const file of handWrittenDocs()) {
    for (const f of shellFences(file)) {
      if (!f.mark && shellCommands(f.body).some((c) => tabulariusCall(c))) unmarked.push(`${file}:${f.line}`);
    }
  }
  assert.deepEqual(unmarked, [], 'put <!-- docs-example: run | placeholders {"a":"b"} | illustrative --> on the line before the fence');
});

test('every command, option and npm script the hand-written pages show exists', async () => {
  const wrong: string[] = [];
  const scripts = new Set(Object.keys((await import(join(root, 'package.json'), { with: { type: 'json' } })).default.scripts));
  const seen: { file: string; line: number; text: string }[] = [];
  // docs/research/ studies commands that do not exist yet (a write-back route), so it is not held to the program's help.
  for (const file of handWrittenDocs().filter((f) => !f.startsWith('docs/research/'))) {
    for (const f of shellFences(file)) for (const text of shellCommands(f.body)) seen.push({ file, line: f.line, text });
    // An inline span is an example only when it starts with the command; `tabularius process` inside a quoted message is not.
    for (const c of inlineCode(file)) if (/^(npm run (-s )?)?tabularius [a-z]/.test(c.text)) seen.push({ file, line: c.line, text: c.text });
  }
  let calls = 0;
  for (const { file, line, text } of seen) {
    const npm = /(?:^|\s)npm run (?:-s )?([\w:-]+)/.exec(text);
    if (npm && !scripts.has(npm[1])) wrong.push(`${file}:${line} npm run ${npm[1]} is not a script`);
    const call = tabulariusCall(text);
    if (!call || ['is', 'the', 'to'].includes(call.command)) continue;
    calls++;
    const help = await helpOf(call.command);
    if (!help) { wrong.push(`${file}:${line} Tabularius ${call.command} is not a command: ${text}`); continue; }
    for (const flag of call.flags) if (!GLOBAL.has(flag) && !help.includes(flag)) wrong.push(`${file}:${line} ${call.command} has no ${flag}: ${text}`);
    if (call.serveFlags.length) {
      const serve = await helpOf('serve');
      for (const flag of call.serveFlags) if (!serve.includes(flag)) wrong.push(`${file}:${line} serve has no ${flag}: ${text}`);
    }
  }
  assert.ok(calls > 150, `found ${calls} examples; the extractor stopped finding them`);
  assert.deepEqual(wrong, []);
});

const skip = existsSync(join(fixtures, 'Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

test('the examples marked run or placeholders work, in an empty home folder with a hosted Invoices', { skip, timeout: 600_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-docs-run-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  try {
    writeFileSync(join(bin, 'tabularius'), `#!/bin/sh\nexec "${process.execPath}" --no-warnings "${main}" "$@"\n`);
    chmodSync(join(bin, 'tabularius'), 0o755);
    let total = 0;
    const byFile = new Map<string, ReturnType<typeof shellFences>>();
    for (const file of handWrittenDocs()) {
      const runnable = shellFences(file).filter((f) => f.mark === 'run' || f.mark === 'placeholders');
      if (runnable.length) byFile.set(file, runnable);
    }
    for (const [file, fences] of byFile) {
      // Each page gets its own empty home, so one page's examples can't lean on another's.
      const home = mkdtempSync(join(dir, 'home-'));
      symlinkSync(join(root, 'examples'), join(home, 'examples'));
      symlinkSync(join(root, 'fixtures'), join(home, 'fixtures'));
      const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, PORT: '1' };
      const sh = (cmd: string, input = 'a-test-password\n') => spawnSync('sh', ['-c', cmd], { cwd: home, env, input, encoding: 'utf8', timeout: 120_000 });
      const made = sh('tabularius new ~/Databases Invoices --starter invoicing && tabularius passwd ~/Databases Invoices Admin');
      assert.equal(made.status, 0, `${file}: the hosted Invoices could not be made\n${made.stdout}${made.stderr}`);
      for (const f of fences) {
        for (let cmd of shellCommands(f.body)) {
          for (const [from, to] of f.subs ?? []) cmd = cmd.split(from).join(to);
          cmd = cmd.replace(/\bnpm run tabularius -- /g, 'tabularius ');
          const call = tabulariusCall(cmd);
          if (call && NEVER_RETURN.has(call.command)) continue;
          if (!call && /^(tabularius)$/.test(cmd.trim())) continue;
          const r = sh(cmd);
          assert.equal(r.status, 0, `${file}:${f.line} \`${cmd}\` exited ${r.status}\n${r.stdout}${r.stderr}`);
          total++;
        }
      }
    }
    assert.ok(total >= 15, `ran ${total} commands`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

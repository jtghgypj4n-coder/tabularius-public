// docs/tutorials/let-an-ai-use-your-file-safely.md is run, not just read: its ```sh run blocks are executed in order in one
// shell, with `tabularius` as this repository's CLI and the tutorial's address pointing at a server started in this process
// where the tutorial says ```sh serve. If a command or an answer in the tutorial goes stale, this test fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const doc = readFileSync(join(root, 'docs', 'tutorials', 'let-an-ai-use-your-file-safely.md'), 'utf8');

/** The tutorial's fenced blocks: `run` ones are executed, `serve` is where the server starts, plain ones are shown only. */
function blocks(): { kind: string; code: string }[] {
  return [...doc.matchAll(/^```sh(?: (run|serve))?\n([\s\S]*?)^```$/gm)].map((m) => ({ kind: m[1] ?? 'show', code: m[2] }));
}

function bash(script: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', ['-e', '-o', 'pipefail'], { cwd: root, env });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(script);
  });
}

test('the "Let an AI use your file safely" tutorial works as written', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tabularius-tutorial-'));
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'tabularius'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --no-warnings ${JSON.stringify(main)} "$@"\n`);
  chmodSync(join(bin, 'tabularius'), 0o755);
  const env = { ...process.env, HOME: tmp, PATH: `${bin}:${process.env.PATH}` };
  const parts = blocks();
  const at = parts.findIndex((b) => b.kind === 'serve');
  assert.ok(at > 0 && parts.some((b) => b.kind === 'run'), 'the tutorial has a serve step after setup commands');
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const setup = await bash(parts.slice(0, at).filter((b) => b.kind === 'run').map((b) => b.code).join('\n'), env);
    assert.equal(setup.code, 0, setup.out);

    server = await serve({ dir: join(tmp, 'tabularius'), port: 0, log: () => {} });
    const rest = parts.slice(at + 1).filter((b) => b.kind === 'run').map((b) => b.code).join('\necho "=== next"\n')
      .replaceAll('http://127.0.0.1:8080', server.url);
    const ran = await bash(rest, env);
    assert.equal(ran.code, 0, ran.out);
    const steps = ran.out.split('=== next');
    const all = ran.out;

    // The app saw stand-ins, not the customers' addresses.
    assert.match(all, /<EMAIL_\d+>/);
    const seen = steps.find((x) => x.includes('<EMAIL_'))!;
    assert.doesNotMatch(seen, /billing@acme\.example|pat@umbrella\.example|Invoice 1042/);
    // Its change waited for approval; approving it made the change.
    assert.match(all, /pending_approval/);
    assert.match(steps.find((x) => x.trim().startsWith('[{'))!, /"agent":"triage".*"data":\{"Category":"Billing","Priority":"High"\}/);
    assert.match(all, /"Category":"Billing"/);
    assert.match(all, /"Priority":"High"/);
    // The history names the agent for the proposal and the change, and the person for the approval.
    assert.match(all, /"account":"triage","kind":"agent-change-proposed"/);
    assert.match(all, /"account":"triage","kind":"update"/);
    assert.match(all, /"account":"Admin","kind":"agent-change-approved"/);
    // After the token is revoked the app is refused.
    assert.match(steps[steps.length - 1], /invalid_token/, steps[steps.length - 1]);

    const store = server.host.get('Helpdesk')!;
    const row = store.query('SELECT Category, Priority FROM Tickets ORDER BY _fm_record_id LIMIT 1')[0] as { Category: string; Priority: string };
    assert.deepEqual({ ...row }, { Category: 'Billing', Priority: 'High' });
  } finally {
    await new Promise<void>((r) => (server ? server.server.close(() => r()) : r()));
    rmSync(tmp, { recursive: true, force: true });
  }
});

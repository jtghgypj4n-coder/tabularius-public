// docs/tutorials/let-an-ai-use-your-file-safely.md is run against a throwaway store and local server.
// Keep its command blocks in order so shell variables and the AI account persist between examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const page = readFileSync(join(root, 'docs', 'tutorials', 'let-an-ai-use-your-file-safely.md'), 'utf8');
const hasCurl = spawnSync('curl', ['--version']).status === 0;

const freePort = () => new Promise<number>((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

test('the let-an-ai-use-your-file-safely tutorial works as written', { skip: !hasCurl && 'curl missing', timeout: 240_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-tutorial-ai-'));
  const folder = join(work, 'tabularius');
  const blocksFor = (port: number) => {
    const adapt = (s: string) => s.replaceAll('~/tabularius', folder).replace(/\b8080\b/g, String(port)).replaceAll('examples/support-desk', join(root, 'examples', 'support-desk'));
    return [...page.matchAll(/^```(\w+)(?: (run|serve))?\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], run: m[2] === 'run', code: adapt(m[3]) }));
  };
  let port = await freePort();
  let blocks = blocksFor(port);
  const setup = blocks.filter((b) => b.lang === 'sh' && b.run).slice(0, 2);
  const serve = blocks.find((b) => b.lang === 'sh' && !b.run && /tabularius serve/.test(b.code));
  let examples = blocks.filter((b) => b.lang === 'sh' && b.run).slice(2);
  let server: ReturnType<typeof spawn> | undefined;
  try {
    assert.equal(setup.length, 2, 'the page has its store creation and privacy setup blocks');
    assert.ok(serve, 'the page shows how to start the server');
    assert.ok(examples.length >= 8, 'the page has its runnable API, MCP and audit blocks');
    const run = (script: string) => spawnSync('bash', ['-ec', `tabularius() { node --no-warnings '${main}' "$@"; }\n${script}`], { cwd: work, encoding: 'utf8', env: { ...process.env, HOME: work } });
    const made = run(setup.map((b) => b.code).join('\n'));
    assert.equal(made.status, 0, made.stdout + made.stderr);

    // The port was free a moment ago, not now: another test's server may have taken it (and answers 400 to every request
    // that carries no proxy header). A server that exits at start-up, or an answer that is not the health page's, is that.
    for (let attempt = 1; ; attempt++) {
      const started = spawn(process.execPath, ['--no-warnings', main, 'serve', folder, '--port', String(port)], { stdio: 'ignore', env: { ...process.env, HOME: work } });
      server = started;
      const ready = await (async () => {
        for (const end = Date.now() + 60_000; ; await new Promise((ok) => setTimeout(ok, 200))) {
          if (started.exitCode !== null) return false;
          if (await fetch(`http://127.0.0.1:${port}/tabularius/health`).then((r) => r.ok, () => false) && started.exitCode === null) return true;
          assert.ok(Date.now() < end, 'the server came up');
        }
      })();
      if (ready) break;
      assert.ok(attempt < 5, 'the server found a port to listen on');
      port = await freePort();
      blocks = blocksFor(port);
      examples = blocks.filter((b) => b.lang === 'sh' && b.run).slice(2);
    }

    const script = examples.map((b, i) => `echo __DOC_BLOCK_${i}__\n${b.code}`).join('\n');
    const out = run(script);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /__DOC_BLOCK_0__[\s\S]*__DOC_BLOCK_1__[\s\S]*__DOC_BLOCK_2__[\s\S]*__DOC_BLOCK_3__/);
    assert.match(out.stdout, /<EMAIL_\d+>/, 'record reads use the PII stand-ins');
    assert.match(out.stdout, /pending_approval/, 'the agent change waits for approval');
    assert.match(out.stdout, /Billing/);
    assert.match(out.stdout, /__DOC_BLOCK_7__[\s\S]*__DOC_BLOCK_8__/, 'audit and token revocation examples ran');
  } finally {
    if (server && server.exitCode === null) {
      const gone = new Promise((ok) => server!.once('exit', ok));
      server.kill('SIGINT');
      const timer = setTimeout(() => server!.kill('SIGKILL'), 20_000);
      await gone;
      clearTimeout(timer);
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

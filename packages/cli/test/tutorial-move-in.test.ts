// docs/tutorials/move-a-file-in.md is run: its `sh run` blocks are executed in order against a throwaway folder,
// with `tabularius` standing for this checkout's command and a sample file standing in as Invoices.fmp12. The server
// the page tells you to start is started here from the command it shows. Skipped without sample files or curl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const sample = join(root, 'fixtures', 'fmp12', 'Charts.fmp12');
const page = readFileSync(join(root, 'docs', 'tutorials', 'move-a-file-in.md'), 'utf8');
const hasCurl = spawnSync('curl', ['--version']).status === 0;

const freePort = () => new Promise<number>((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

test('the move-a-file-in tutorial works as written', { skip: (!existsSync(sample) && 'sample files missing: run npm run fixtures') || (!hasCurl && 'curl missing'), timeout: 240_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-tutorial-move-'));
  const port = await freePort();
  // The page's own text, with the throwaway home and port in place of the ones it shows.
  const adapt = (s: string) => s.replaceAll('~/Databases', join(work, 'Databases')).replaceAll('8080', String(port));
  const blocks = [...page.matchAll(/^```(\w+)( run)?\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], run: !!m[2], code: m[3] }));
  const shell: string[] = [];
  let server: ReturnType<typeof spawn> | undefined;
  try {
    copyFileSync(sample, join(work, 'Invoices.fmp12'));
    assert.ok(blocks.filter((b) => b.run).length >= 5, 'the page has its runnable blocks');
    for (const b of blocks) {
      if (b.lang === 'sh' && b.run) shell.push(adapt(b.code));
      else if (b.lang === 'sh' && /tabularius serve/.test(b.code)) shell.push('__SERVE__');
    }
    const at = shell.indexOf('__SERVE__');
    assert.ok(at > 0, 'the page shows how to start the server');
    const run = (script: string) => spawnSync('bash', ['-ec', `tabularius() { node --no-warnings '${main}' "$@"; }\n${script}`], { cwd: work, encoding: 'utf8', env: { ...process.env, HOME: work } });

    const before = run(shell.slice(0, at).join('\n'));
    assert.equal(before.status, 0, before.stdout + before.stderr);
    assert.match(before.stdout, /"file": "Invoices.fmp12"/);
    assert.match(before.stdout, /# Conversion report: Invoices/);
    assert.match(before.stdout, /Invoices: \d+ scripts, \d+ ok/);
    assert.match(before.stdout, /Invoices: \d+ stored calculations/);
    assert.ok(existsSync(join(work, 'Databases', 'Invoices.openhbam.sqlite')), 'the report converted the copy');

    server = spawn(process.execPath, ['--no-warnings', main, 'serve', join(work, 'Databases'), '--port', String(port)], { stdio: 'ignore' });
    for (const end = Date.now() + 60_000; ; await new Promise((ok) => setTimeout(ok, 200))) {
      if (await fetch(`http://127.0.0.1:${port}/fmi/data/vLatest/databases`).then((r) => r.status < 500, () => false)) break;
      assert.ok(Date.now() < end, 'the server came up');
    }
    const after = run(shell.slice(at + 1).join('\n'));
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.match(after.stdout, /got a token of [1-9]\d* characters/);
    assert.match(after.stdout, /"layouts":\[\{"name":/);
  } finally {
    if (server && server.exitCode === null) {
      const gone = new Promise((ok) => server!.once('exit', ok));
      server.kill('SIGINT');
      await gone;
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

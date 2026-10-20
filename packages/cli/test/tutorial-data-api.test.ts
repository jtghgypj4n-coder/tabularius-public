// docs/tutorials/data-api-client.md is run: its `sh run` and `js run` blocks are executed in order against a
// throwaway folder hosted on a free port, with `tabularius` standing for this checkout's command, so the page can't
// go stale. The `sh` blocks that aren't marked `run` (starting the server) are done here instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const page = readFileSync(join(root, 'docs', 'tutorials', 'data-api-client.md'), 'utf8');
const hasCurl = spawnSync('curl', ['--version']).status === 0;

const freePort = () => new Promise<number>((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

test('the Data API tutorial works as written', { skip: !hasCurl && 'curl missing', timeout: 180_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-tutorial-'));
  const port = await freePort();
  const folder = join(work, 'tabularius-tutorial');
  // The page's own text, with the throwaway folder and port in place of the ones it shows.
  const adapt = (s: string) => s.replaceAll('~/tabularius-tutorial', folder).replaceAll('8080', String(port)).replaceAll('examples/first-app', join(root, 'examples', 'first-app'));
  const blocks = [...page.matchAll(/^```(\w+)( run)?\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], run: !!m[2], code: m[3] }));
  const shell: string[] = [];
  let server: ReturnType<typeof spawn> | undefined;
  try {
    assert.ok(blocks.filter((b) => b.run).length >= 5, 'the page has its runnable blocks');
    for (const b of blocks) {
      if (b.lang === 'js' && b.run) {
        const file = /^\/\/ (\S+\.mjs)$/m.exec(b.code)?.[1];
        assert.ok(file, 'a runnable js block names its file on its first line');
        writeFileSync(join(work, file), adapt(b.code));
      } else if (b.lang === 'sh' && b.run) {
        shell.push(adapt(b.code));
      } else if (b.lang === 'sh' && /tabularius serve/.test(b.code)) {
        // Step 1's server: started here, from the command the page shows, once the folder exists.
        shell.push('__SERVE__');
      } else if (b.lang === 'sh') {
        shell.push(adapt(b.code));
      }
    }
    const at = shell.indexOf('__SERVE__');
    assert.ok(at > 0, 'the page shows how to start the server');
    const run = (script: string) => spawnSync('bash', ['-ec', `tabularius() { node --no-warnings '${main}' "$@"; }\n${script}`], { cwd: work, encoding: 'utf8', env: { ...process.env, HOME: work } });

    const setup = run(shell.slice(0, at).join('\n'));
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    server = spawn(process.execPath, ['--no-warnings', main, 'serve', folder, '--port', String(port), '--list-files-publicly'], { stdio: 'ignore' });
    for (const end = Date.now() + 60_000; ; await new Promise((ok) => setTimeout(ok, 200))) {
      if (await fetch(`http://127.0.0.1:${port}/fmi/data/vLatest/databases`).then((r) => r.ok, () => false)) break;
      assert.ok(Date.now() < end, 'the server came up');
    }

    const out = run(shell.slice(at + 1).join('\n'));
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /got a token of \d+ characters/);
    assert.match(out.stdout, /"layouts":\[\{"name":"Calls".*"name":"Contacts"/);
    assert.match(out.stdout, /"recordId":"1"/);
    assert.match(out.stdout, /"foundCount":1/);
    assert.match(out.stdout, /"Name":"Ada Lovelace"/);
    assert.match(out.stdout, /"modId":"1"/);
    assert.match(out.stdout, /made record 1\n1 Grace Hopper\n/, 'the Node client made, found and removed its record');
  } finally {
    // Stop the server and wait for it to go: it writes a backup into the folder, and removing the folder under it fails.
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

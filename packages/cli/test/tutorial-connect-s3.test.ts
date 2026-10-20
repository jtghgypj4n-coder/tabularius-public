// docs/tutorials/connect-an-s3-bucket.md is run: its `sh run` blocks are executed in order against a throwaway folder,
// with `tabularius` standing for this checkout's command and a local stand-in for S3 (it checks every request's signature
// the way S3 does) in the place of MinIO. The server the page tells you to start is started here from the command it
// shows. Nothing here reaches a real service. Skipped without curl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeS3 } from '../../server/test/fake-s3.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const page = readFileSync(join(root, 'docs', 'tutorials', 'connect-an-s3-bucket.md'), 'utf8');
const hasCurl = spawnSync('curl', ['--version']).status === 0;

const freePort = () => new Promise<number>((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

test('the connect-an-S3-bucket tutorial works as written', { skip: !hasCurl && 'curl missing', timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'tabularius-tutorial-s3-'));
  const port = await freePort();
  const s3 = await fakeS3({ bucket: 'invoices', accessKey: 'minioadmin', secretKey: 'tutorial-secret-key-1234' });
  // The page's own text, with the throwaway home, port and S3 in place of the ones it shows (applied once: a stand-in port
  // that happened to hold the digits 8080 would be rewritten by a second pass).
  const adapt = (s: string) => s.replaceAll('~/Databases', join(work, 'Databases')).replace(/\b8080\b/g, String(port)).replaceAll('http://localhost:9000', s3.endpoint);
  const blocks = [...page.matchAll(/^```(\w*)( run)?\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], run: !!m[2], code: m[3] }));
  const runnable = blocks.filter((b) => b.lang === 'sh' && b.run).map((b) => adapt(b.code));
  const serve = blocks.find((b) => b.lang === 'sh' && !b.run && /tabularius serve/.test(b.code));
  let server: ReturnType<typeof spawn> | undefined;
  try {
    assert.ok(serve, 'the page shows how to start the server');
    assert.ok(runnable.length >= 4, 'the page has its runnable blocks');
    assert.match(serve.code, /TABULARIUS_SECRETS_KEY=/, 'the page starts the server with a secrets passphrase');
    const passphrase = /TABULARIUS_SECRETS_KEY='([^']+)'/.exec(serve.code)![1];
    // Not spawnSync: the stand-in S3 lives in this process and has to answer while the server's Test call is waiting on it.
    const run = async (script: string) => {
      const sh = spawn('bash', ['-ec', `tabularius() { node --no-warnings '${main}' "$@"; }\n${script}`], { cwd: work, env: { ...process.env, HOME: work } });
      let stdout = '';
      let stderr = '';
      sh.stdout.on('data', (d) => (stdout += d));
      sh.stderr.on('data', (d) => (stderr += d));
      const [status] = await once(sh, 'close') as [number];
      return { status, stdout, stderr };
    };

    const made = spawnSync('bash', ['-ec', adapt(serve.code.split('\n').filter((l) => /^mkdir/.test(l)).join('\n'))], { cwd: work, encoding: 'utf8', env: { ...process.env, HOME: work } });
    assert.equal(made.status, 0, made.stderr);
    server = spawn(process.execPath, ['--no-warnings', main, 'serve', join(work, 'Databases'), '--port', String(port)], { stdio: 'ignore', env: { ...process.env, HOME: work, TABULARIUS_SECRETS_KEY: passphrase } });
    for (const end = Date.now() + 60_000; ; await new Promise((ok) => setTimeout(ok, 200))) {
      if (await fetch(`http://127.0.0.1:${port}/fmi/data/vLatest/databases`).then((r) => r.status < 500, () => false)) break;
      assert.ok(Date.now() < end, 'the server came up');
    }

    const added = await run(runnable[0]);
    assert.equal(added.status, 0, added.stdout + added.stderr);
    assert.match(added.stdout, /"status":\s*"draft"/);
    assert.match(added.stdout, /"ready":\s*false/);

    const keys = await run(runnable[1]);
    assert.equal(keys.status, 0, keys.stdout + keys.stderr);
    assert.match(keys.stdout, /"set":\s*true/);
    assert.ok(!keys.stdout.includes('tutorial-secret-key-1234'), 'no call gives a key back');

    const sealed = await run(runnable[2]);
    assert.equal(sealed.status, 0, sealed.stdout + sealed.stderr);
    assert.match(sealed.stdout, /the secret is not in the folder in plain text/);

    const tested = await run(runnable[3]);
    assert.equal(tested.status, 0, tested.stdout + tested.stderr);
    assert.match(tested.stdout, /"ok":\s*true/);
    assert.match(tested.stdout, /"status":\s*"active"/);
    assert.equal(s3.seen.rejected, 0, 'every request to the service was signed with the typed keys');
    assert.ok(s3.requests.length >= 1, 'Test reached the service');
  } finally {
    if (server && server.exitCode === null) {
      const gone = new Promise((ok) => server!.once('exit', ok));
      server.kill('SIGINT');
      await gone;
    }
    await s3.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

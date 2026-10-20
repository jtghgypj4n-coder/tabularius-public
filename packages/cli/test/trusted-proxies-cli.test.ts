import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

/** Wait for both the listening URL and any required warning, which can arrive on separate streams. */
function startup(child: EventEmitter & { stdout: Readable; stderr: Readable }, wide: string): Promise<{ url: string; output: string; errors: string }> {
  let output = '';
  let errors = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`startup timed out: ${output}\n${errors}`)), 15_000);
    const finish = (error?: Error, url?: string) => {
      clearTimeout(timer);
      child.off('error', fail);
      child.off('exit', exit);
      child.stdout.off('data', stdout);
      child.stderr.off('data', stderr);
      if (error) reject(error);
      else resolve({ url: url!, output, errors });
    };
    const fail = (error: Error) => finish(error);
    const exit = (code: number | null) => finish(new Error(`server exited ${code}: ${errors}`));
    const check = () => {
      const match = /Web client: (http:\/\/[^\s/]+)/.exec(output);
      const warning = !wide || (output + errors).split('\n').some((line) => /warning:.*--trusted-proxies.*trusts every/i.test(line) && line.includes(wide));
      if (match && warning) finish(undefined, match[1]);
    };
    const stdout = (data: Buffer) => { output += data; check(); };
    const stderr = (data: Buffer) => { errors += data; check(); };
    child.once('error', fail);
    child.once('exit', exit);
    child.stdout.on('data', stdout);
    child.stderr.on('data', stderr);
  });
}

for (const warningFirst of [false, true]) {
  test(`CLI readiness waits for the warning ${warningFirst ? 'before' : 'after'} the listening URL`, async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const ready = startup(child, '::/0');
    let settled = false;
    void ready.then(() => { settled = true; });
    const url = () => child.stdout.write('Web client: http://127.0.0.1:1234\n');
    const warning = () => child.stderr.write('warning: --trusted-proxies ::/0 trusts every address\n');
    (warningFirst ? warning : url)();
    await setImmediate();
    const settledEarly = settled;
    (warningFirst ? url : warning)();
    const result = await ready;
    assert.equal(settledEarly, false, 'readiness requires both conditions');
    assert.equal(result.url, 'http://127.0.0.1:1234');
    assert.match(result.output + result.errors, /warning:.*--trusted-proxies.*trusts every/i);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
  });
}

for (const source of ['flag', 'environment']) {
  test(`serve rejects an invalid trusted proxy from the ${source}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-trusted-proxy-cli-'));
    try {
      const env = { ...process.env };
      delete env.TABULARIUS_TRUSTED_PROXIES;
      if (source === 'environment') env.TABULARIUS_TRUSTED_PROXIES = '172.30.0.0/24, caddy';
      const extra = source === 'flag' ? ['--trusted-proxies', '172.30.0.0/24, caddy'] : [];
      const result = spawnSync(process.execPath, ['--no-warnings', main, 'serve', dir, '--port', '0', ...extra], { env, encoding: 'utf8', timeout: 15_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /--trusted-proxies.*must be an IP address or CIDR/);
      assert.deepEqual(readdirSync(dir), [], 'invalid trust configuration fails before startup');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const workers of [1, 2]) for (const wide of ['', '0.0.0.0/0', '::/0']) {
    test(`serve applies trusted proxies from the ${source} with ${workers} worker(s)${wide ? ` and warns about ${wide}` : ''}`, async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'tabularius-trusted-proxy-cli-'));
      const env: NodeJS.ProcessEnv = { ...process.env, TABULARIUS_HOME: join(dir, 'home') };
      delete env.TABULARIUS_TRUSTED_PROXIES;
      const value = `172.30.0.0/24, 127.0.0.1${wide ? `, ${wide}` : ''}`;
      if (source === 'environment') env.TABULARIUS_TRUSTED_PROXIES = value;
      const extra = source === 'flag' ? ['--trusted-proxies', value] : [];
      const child = spawn(process.execPath, ['--no-warnings', main, 'serve', dir, '--port', '0', '--no-backups', '--workers', String(workers), '--proxy-header', 'x-forwarded-for', ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      t.after(async () => {
        const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
        child.kill('SIGTERM');
        await exited;
        clearTimeout(force);
        rmSync(dir, { recursive: true, force: true });
      });
      const { url, output, errors } = await startup(child, wide);
      // The trusted peer names its visitor, so the request is that visitor's: not the local administrator.
      // This checks the CLI-to-server/cluster plumbing, without requiring a second network interface.
      const visitor = { 'x-forwarded-for': '198.51.100.9' };
      const info = await fetch(`${url}/tabularius/admin/v1/sign-in-info`, { headers: visitor });
      assert.equal(info.status, 200);
      assert.equal((await info.json()).local, false, 'the configured proxy must not count as the local administrator');
      const status = await fetch(`${url}/tabularius/admin/v1/status`, { headers: visitor });
      assert.equal(status.status, 403);
      await status.arrayBuffer();
      // A trusted proxy that names no visitor is a fault: refused before authentication, with the reason.
      const nameless = await fetch(`${url}/tabularius/admin/v1/status`);
      assert.equal(nameless.status, 400);
      assert.match(await nameless.text(), /--proxy-header and --trusted-proxies/);
      if (wide) {
        assert.match(output + errors, /warning:.*--trusted-proxies.*trusts every/i);
        assert.ok((output + errors).includes(wide), 'the warning identifies the unrestricted proxy range');
      } else assert.doesNotMatch(output + errors, /warning:.*--trusted-proxies/i);
    });
  }
}

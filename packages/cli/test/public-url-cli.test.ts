import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

describe('public URL CLI preflight', { concurrency: 2 }, () => {
for (const source of ['flag', 'environment']) {
  test(`serve refuses an invalid public URL from the ${source} before startup`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-public-url-cli-'));
    try {
      const values = ['example.com', 'https://files.example.com/path', 'https://files.example.com?query', 'https://files.example.com#fragment', ''];
      // Each invalid input must fail before touching the same empty folder, so these checks are independent.
      const results = await Promise.all(values.map((value) => {
        const args = source === 'flag' ? ['--public-url', value] : [];
        const env: NodeJS.ProcessEnv = { ...process.env };
        delete env.TABULARIUS_PUBLIC_URL;
        if (source === 'environment') env.TABULARIUS_PUBLIC_URL = value;
        return runCli(main, ['serve', dir, ...args], { env, timeout: 15_000 });
      }));
      for (const [i, value] of values.entries()) {
        const r = results[i];
        assert.ifError(r.error);
        assert.equal(r.status, 1, `${value}: ${r.stderr}`);
        assert.match(r.stderr, /give a full address such as https:\/\/files\.example\.com/);
        assert.deepEqual(readdirSync(dir), [], 'invalid configuration must not start the server');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}


for (const platform of ['darwin', 'linux', 'win32']) {
  for (const source of ['flag', 'environment']) {
    test(`service install on ${platform} refuses an invalid ${source} URL without replacing or restarting a service`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tabularius-service-url-'));
      try {
        const home = join(dir, 'home');
        const bin = join(dir, 'bin');
        mkdirSync(home);
        mkdirSync(bin);
        // Even if preflight regresses, never invoke a real service manager.
        for (const cmd of ['launchctl', 'systemctl', 'loginctl', 'schtasks', 'sudo']) {
          writeFileSync(join(bin, cmd), '#!/bin/sh\necho called >> "$TABULARIUS_HOME/calls"\nexit 0\n', { mode: 0o755 });
        }
        const config = join(home, 'service.json');
        writeFileSync(config, '{"working":"service"}');
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, TABULARIUS_HOME: home, PATH: bin };
        delete env.TABULARIUS_PUBLIC_URL;
        if (source === 'environment') env.TABULARIUS_PUBLIC_URL = 'example.com';
        const args = source === 'flag' ? ['--', '--public-url', 'example.com'] : [];
        const r = await runCli(main, ['service', 'install', join(dir, 'data'), '--platform', platform, '--port', '0', ...args], { env, timeout: 15_000 });
        assert.ifError(r.error);
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /give a full address/);
        assert.equal(readFileSync(config, 'utf8'), '{"working":"service"}');
        assert.deepEqual(readdirSync(home), ['service.json']);
        assert.deepEqual(readdirSync(dir).sort(), ['bin', 'home'], 'no data or service directories created');
        assert.equal(existsSync(join(home, 'calls')), false, 'no service manager was invoked');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

for (const source of ['flag', 'environment']) {
  test(`upgrade exits 1 before fetching or restarting with an invalid ${source} public URL`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-upgrade-url-'));
    try {
      const extra = source === 'flag' ? ['--public-url', 'example.com'] : [];
      const record = JSON.stringify({ platform: 'linux', folder: dir, host: '127.0.0.1', port: 8080, system: false, extra });
      writeFileSync(join(dir, 'service.json'), record);
      const env: NodeJS.ProcessEnv = { ...process.env, TABULARIUS_HOME: dir };
      delete env.TABULARIUS_PUBLIC_URL;
      if (source === 'environment') env.TABULARIUS_PUBLIC_URL = 'example.com';
      const r = await runCli(main, ['upgrade', '--from', join(dir, 'missing-release')], { env, timeout: 15_000 });
      assert.ifError(r.error);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /give a full address/);
      assert.match(r.stderr, /upgrade refused; the existing service was not restarted/);
      assert.equal(readFileSync(join(dir, 'service.json'), 'utf8'), record);
      assert.deepEqual(readdirSync(dir), ['service.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
});

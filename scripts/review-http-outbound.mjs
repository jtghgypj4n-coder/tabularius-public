// Synthetic, loopback audit profile. No package manager, services or fixture tests.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = ['http-framing', 'http-targets', 'http-round2', 'outbound-features-round2',
  'edge-transport', 'edge-bodies', 'edge-application', 'edge-tls', 'edge-stream-slots',
  'edge-cluster', 'edge-cli', 'outbound-guard-drift', 'outbound-operator', 'changes-bodies', 'inbound-hooks', 'embed-endpoint'];
const scripts = ['net-guard', 'net-guard-round2', 'net-guard-invariants', 'net-guard-rate', 'net-guard-tls',
  'net-guard-fairness', 'net-guard-lifecycle', 'net-guard-operator', 'network-problem',
  'insert-from-url-guard', 'mbs-curl', 'plugin-network', 'outbound-stop', 'outbound-stop-lag', 'outbound-loop'];
const args = process.argv.slice(2);
assert.ok(args.every(x => x === '--framing' || x === '--insecure-http-parser'), 'unknown audit option');
const files = args.includes('--framing') ? ['packages/server/test/http-framing.test.ts', 'packages/server/test/http-round2.test.ts']
  : [...server.map(x => `packages/server/test/${x}.test.ts`), ...scripts.map(x => `packages/scripts/test/${x}.test.ts`)];
const dir = mkdtempSync(join(tmpdir(), 'tabularius-http-review-'));
const marker = join(dir, 'forbidden-command');
try {
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, name), '#!/bin/sh\nprintf called >> "$HTTP_REVIEW_MARKER"\nexit 99\n', { mode: 0o700 });
    writeFileSync(join(dir, `${name}.cmd`), '@echo off\r\necho called>>"%HTTP_REVIEW_MARKER%"\r\nexit /b 99\r\n');
  }
  const result = spawnSync(process.execPath, [
    ...(args.includes('--insecure-http-parser') ? ['--insecure-http-parser'] : []),
    '--test', '--test-concurrency=2', '--test-timeout=55000', ...files,
  ], { cwd: root, env: { ...process.env, PATH: dir, HTTP_REVIEW_MARKER: marker }, stdio: 'inherit' });
  assert.equal(existsSync(marker), false, 'a prohibited command was attempted');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }

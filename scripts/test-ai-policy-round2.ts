// Small synthetic-only review profile. No package manager or shell invocation.
// --http adds loopback protocol tests; both profiles use two test workers.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--http')) throw new Error('Usage: node scripts/test-ai-policy-round2.ts [--http]');
const files = [
  'packages/server/test/ai-policy-round2.test.ts',
  ...['assistant-ai-policy', 'assistant-ai-policy-analysis', 'mcp-ai-policy', 'mcp-ai-policy-probes',
    'mcp-secret-value', 'mcp-ai-policy-relationships', 'mcp-ai-policy-custom-functions',
    'ai-output-languages', 'mcp-resource-masking', 'mcp-trace-privileges'].map((name) => `packages/server/test/${name}.test.ts`),
  ...['credential-dataflow', 'credential-diagnostics', 'redaction-linear'].map((name) => `packages/scripts/test/${name}.test.ts`),
  ...(args.includes('--http') ? ['packages/server/test/ai-output-parity.test.ts', 'packages/server/test/agent-ai-policy.test.ts',
    'packages/server/test/cross-file-regressions.test.ts'] : []),
];
const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-review-'));
const marker = join(dir, 'forbidden-command');
const bin = join(dir, 'bin');
mkdirSync(bin);
for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
  const stub = '#!/bin/sh\nprintf "%s\\n" "$0" >> "${0%/*}/../forbidden-command"\nexit 99\n';
  writeFileSync(join(bin, command), stub, { mode: 0o755 });
  writeFileSync(join(bin, `${command}.cmd`), '@echo off\r\necho %~nx0>>"%~dp0..\\forbidden-command"\r\nexit /b 99\r\n');
}
try {
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PATH: bin },
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (existsSync(marker)) {
    process.stderr.write('FAIL: a forbidden child command was invoked.\n');
    process.exitCode = 1;
  } else process.exitCode = code;
} finally { rmSync(dir, { recursive: true, force: true }); }

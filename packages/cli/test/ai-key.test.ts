// Where the AI key comes from: the environment, else a file only its owner can read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveAiKey } from '../src/ai-key.ts';

const posix = process.platform === 'win32' ? { skip: 'file modes' } : {};

function withKeyFile(contents: string, mode: number, run: (file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'aikey-'));
  try {
    const file = join(dir, 'anthropic-key');
    writeFileSync(file, contents);
    chmodSync(file, mode);
    run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('ANTHROPIC_API_KEY wins over the file', () => {
  withKeyFile('sk-from-file\n', 0o600, (file) => {
    const k = resolveAiKey({ ANTHROPIC_API_KEY: 'sk-from-env' }, file);
    assert.deepEqual([k.apiKey, k.source, k.keyFile], ['sk-from-env', 'environment', undefined]);
  });
});

test('reads a private key file, trimmed', posix, () => {
  withKeyFile('sk-from-file\n', 0o600, (file) => {
    const k = resolveAiKey({}, file, 'wrkspc_01AbC');
    assert.deepEqual([k.apiKey, k.source, k.keyFile, k.workspaceId], ['sk-from-file', 'file', file, 'wrkspc_01AbC']);
    assert.equal(k.workspaceFile, join(dirname(file), 'anthropic-workspace-id'));
  });
});

test('refuses a file other users can read, without printing the key', posix, () => {
  withKeyFile('sk-secret-value', 0o644, (file) => {
    assert.throws(() => resolveAiKey({}, file), (e: Error) => /chmod 600/.test(e.message) && !e.message.includes('sk-secret-value'));
  });
});

test('says what is wrong for a missing or empty file', posix, () => {
  assert.throws(() => resolveAiKey({}, '/nonexistent/anthropic-key'), /does not exist/);
  withKeyFile('  \n', 0o600, (file) => assert.throws(() => resolveAiKey({}, file), /is empty/));
  assert.throws(() => resolveAiKey({ TABULARIUS_HOME: '/nonexistent' }, undefined), /anthropic-key/);
});

test('a workspace id must look like wrkspc_…', () => {
  assert.throws(() => resolveAiKey({ ANTHROPIC_API_KEY: 'sk-x' }, undefined, 'my-workspace'), /wrkspc_/);
});

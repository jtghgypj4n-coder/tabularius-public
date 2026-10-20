// `serve --mcp-origin` takes plain http(s) origins; anything else is an error naming it, before the server starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const serve = (extra: string[], env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-origin-flag-'));
  try {
    return spawnSync(process.execPath, ['--no-warnings', main, 'serve', dir, '--port', '0', ...extra], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 20000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('--mcp-origin and TABULARIUS_MCP_ORIGINS refuse a value that is not an origin', () => {
  for (const bad of ['files.example.com', 'https://files.example.com/path', 'ftp://files.example.com', 'null', 'https://*.example.com', 'https://[::1', 'https://a:99999']) {
    const r = serve(['--mcp-origin', bad]);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /--mcp-origin ".*" is not an origin/, bad);
  }
  const r = serve([], { TABULARIUS_MCP_ORIGINS: 'https://ok.example.com, nope' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--mcp-origin "nope" is not an origin/);
  const missing = serve(['--mcp-origin']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--mcp-origin needs an address/);
});

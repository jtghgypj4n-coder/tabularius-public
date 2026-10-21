// The folder's own /mcp administrator token: made once, shared by processes that start together, and trusted only when the
// file is the user's own plain file that nobody else can read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MCP_LOCAL_TOKEN_FILE, localMcpToken, readLocalMcpToken } from '../src/mcp-local-token.ts';

const posix = process.platform !== 'win32';
const folder = (t: { after(fn: () => void): void }) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-local-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the token is made once, kept, and read back without making one', (t) => {
  const dir = folder(t);
  assert.equal(readLocalMcpToken(dir), undefined, 'reading makes nothing');
  assert.deepEqual(readdirSync(dir), []);
  const token = localMcpToken(dir);
  assert.match(token, /^tbmcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(localMcpToken(dir), token);
  assert.equal(readLocalMcpToken(dir), token);
  if (posix) assert.equal(statSync(join(dir, MCP_LOCAL_TOKEN_FILE)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), [MCP_LOCAL_TOKEN_FILE], 'no temporary file is left behind');
});

test('processes starting together agree on one token', async (t) => {
  const dir = folder(t);
  const module = new URL('../src/mcp-local-token.ts', import.meta.url).href;
  const code = `import { localMcpToken } from ${JSON.stringify(module)}; console.log(localMcpToken(${JSON.stringify(dir)}));`;
  const run = promisify(execFile);
  const out = await Promise.all(Array.from({ length: 6 }, () => run(process.execPath, ['--no-warnings', '--input-type=module', '-e', code])));
  const tokens = new Set(out.map((o) => o.stdout.trim()));
  assert.equal(tokens.size, 1, [...tokens].join(' '));
  assert.equal(readLocalMcpToken(dir), [...tokens][0]);
  assert.deepEqual(readdirSync(dir), [MCP_LOCAL_TOKEN_FILE]);
});

test('a file that is not the user\'s own private plain file is refused, never trusted', { skip: posix ? false : 'no owner-only modes here' }, (t) => {
  const dir = folder(t);
  const file = join(dir, MCP_LOCAL_TOKEN_FILE);
  const planted = `tbmcp_${'a'.repeat(43)}\n`;
  writeFileSync(file, planted, { mode: 0o644 });
  chmodSync(file, 0o644);
  assert.throws(() => localMcpToken(dir), /can be read by other users/);
  assert.throws(() => readLocalMcpToken(dir), /can be read by other users/);
  assert.equal(readFileSync(file, 'utf8'), planted, 'it is not overwritten');
  chmodSync(file, 0o600);
  assert.equal(localMcpToken(dir), planted.trim());
  // Not a token at all, or empty (a crash in an older version): refused with what to do, not replaced quietly.
  writeFileSync(file, '', { mode: 0o600 });
  assert.throws(() => localMcpToken(dir), /does not hold a \/mcp token/);
  writeFileSync(file, 'hello\n', { mode: 0o600 });
  assert.throws(() => readLocalMcpToken(dir), /does not hold a \/mcp token/);
  rmSync(file);
  // A link, even one that points at a good token, is not a plain file.
  const real = join(dir, 'real');
  writeFileSync(real, planted, { mode: 0o600 });
  symlinkSync(real, file);
  assert.throws(() => localMcpToken(dir), /is not a plain file/);
});

// `tabularius mcp-token <folder>` prints the token /mcp accepts from this folder's own file. It only reads: with no token yet it
// says to start the server, and it says when an override token is in force instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localMcpToken } from '../../server/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('mcp-token prints the folder\'s token, makes none, and notes an override', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-token-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: dir };
  const none = await runCli(main, ['mcp-token', dir], { env });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no \/mcp token yet.*tabularius serve/s);
  assert.deepEqual(readdirSync(dir), [], 'asking makes nothing');
  const token = localMcpToken(dir);
  const shown = await runCli(main, ['mcp-token', dir], { env });
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(shown.stdout.trim(), token);
  assert.equal(shown.stderr, '');
  const override = await runCli(main, ['mcp-token', dir], { env: { ...env, TABULARIUS_MCP_TOKEN: 'something-else' } });
  assert.match(override.stderr, /TABULARIUS_MCP_TOKEN, which it uses instead/);
});

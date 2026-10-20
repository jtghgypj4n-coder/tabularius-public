import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runMcpE2E } from '../../../scripts/mcp-e2e.ts';

// An AI app's whole path against a real `tabularius serve` process on a public sample: the OAuth challenge, a full token
// that finds, edits and runs a script (and the audit log lists them), read-only and layout-limited tokens, and a file
// with AI off. scripts/release-smoke.ts runs the same check on the built single-file program (scripts/mcp-e2e.ts).
const root = join(import.meta.dirname, '..', '..', '..');
const skip = existsSync(join(root, 'fixtures', 'fmp12', 'Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

test('an AI app against a real server: challenge, tokens, edit, script, audit log, read-only, layout limit, AI off', { skip, timeout: 120_000 }, async () => {
  await runMcpE2E([process.execPath, '--no-warnings', join(root, 'packages', 'cli', 'src', 'main.ts')]);
});

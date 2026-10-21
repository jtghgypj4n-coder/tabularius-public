// Preload for the round-two audit profile. Descendant processes inherit only
// command stubs; Node itself is always launched via process.execPath.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inherited = process.env.TABULARIUS_REVIEW_STUB_DIR;
const dir = inherited ?? mkdtempSync(join(tmpdir(), 'tabularius-review-path-'));
const marker = join(dir, 'forbidden-command');
if (!inherited) {
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(dir, command), '#!/bin/sh\nprintf blocked > "$TABULARIUS_REVIEW_STUB_DIR/forbidden-command"\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(dir, command + '.cmd'), '@echo off\r\necho blocked > "%TABULARIUS_REVIEW_STUB_DIR%\\forbidden-command"\r\nexit /b 99\r\n');
  }
}
process.env.TABULARIUS_REVIEW_STUB_DIR = dir;
process.env.PATH = dir;
process.on('exit', () => {
  if (existsSync(marker)) {
    process.stderr.write('FAIL: a backup review test attempted a forbidden command\n');
    process.exitCode = 1;
  }
  if (!inherited) rmSync(dir, { recursive: true, force: true });
});

// Preload for filesystem regression runs. Child processes inherit a PATH that
// cannot invoke service managers, installers, source control or network tools.
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-test-path-'));
const marker = join(dir, 'forbidden-command');
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo', 'install', 'loginctl', 'schtasks', 'wget']) {
  writeFileSync(join(dir, command), `#!/bin/sh\nprintf '%s\\n' '${command}' >> ${quote(marker)}\nexit 99\n`, { mode: 0o700 });
}
symlinkSync(process.execPath, join(dir, process.platform === 'win32' ? 'node.exe' : 'node'));
process.env.PATH = dir;
process.on('exit', () => {
  const invoked = existsSync(marker);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(invoked, false, 'a test invoked a forbidden external command');
});

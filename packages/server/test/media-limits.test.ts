import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

for (const scenario of ['urls', 'gif', 'jobs', 'bytes', 'tools', 'cancel', 'active-cancel', 'lifecycle', 'tool-cancel', 'mime']) {
  test(`AR-server-containers-media-${({ urls: '01', gif: '02 / AR-server-data-apis-11', mime: '04' } as Record<string, string>)[scenario] ?? '03'}: ${scenario}`, async () => {
    const child = spawn(process.execPath, ['--no-warnings', new URL('./media-limits-child.ts', import.meta.url).pathname, scenario], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TABULARIUS_THUMBNAILS: 'builtin' },
    });
    let output = '';
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, 15_000);
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(expired, false, `watchdog expired: ${output}`);
      assert.equal(code, 0, output);
    } finally { clearTimeout(timer); child.kill('SIGKILL'); }
  });
}

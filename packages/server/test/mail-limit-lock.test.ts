import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailLimit, MAIL_LIMIT_FILE } from '../src/mail-limit.ts';

for (const limit of [40, 3]) test(`two processes retain sends and enforce a shared allowance of ${limit}`, { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mail-lock-'));
  const file = join(dir, MAIL_LIMIT_FILE);
  const source = `import { MailLimit } from ${JSON.stringify(new URL('../src/mail-limit.ts', import.meta.url).href)};
    const l = new MailLimit(process.argv[1]); l.perHour = Number(process.argv[2]); l.perFile = 100;
    l.clock = () => 1000000;
    process.on('message', () => process.send(l.take(['A', 'a', 'A']) ?? null)); process.send('ready');`;
  const children = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', source, file, String(limit)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  const exited = children.map((c) => once(c, 'exit'));
  try {
    await Promise.all(children.map((c) => once(c, 'message')));
    let accepted = 0;
    // Alternate to expose stale instance caches deterministically, then contend concurrently.
    for (let i = 0; i < 20; i++) {
      const c = children[i % 2];
      const answer = once(c, 'message'); c.send('take');
      if ((await answer)[0] === null) accepted++;
    }
    for (let i = 0; i < 10; i++) {
      const answers = children.map((c) => { const answer = once(c, 'message'); c.send('take'); return answer; });
      for (const [answer] of await Promise.all(answers)) if (answer === null) accepted++;
    }
    assert.equal(accepted, limit);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.all.length, limit);
    assert.deepEqual(saved.files, { a: Array(limit).fill(1000000) });
    const reset = new MailLimit(file); reset.reset();
    const answer = once(children[0], 'message'); children[0].send('take');
    assert.equal((await answer)[0], null);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).all.length, 1);
  } finally {
    children.forEach((c) => c.kill()); await Promise.all(exited);
    rmSync(dir, { recursive: true, force: true });
  }
});

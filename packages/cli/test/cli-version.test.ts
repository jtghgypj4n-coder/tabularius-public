import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const launch = join(import.meta.dirname, '..', 'src', 'launch.cjs');
const { version } = JSON.parse(readFileSync(new URL('../../server/package.json', import.meta.url), 'utf8')) as { version: string };

for (const arg of ['--version', '-v', 'version']) {
  test(`${arg} prints the package version, the commit and the Node it needs, and exits successfully`, () => {
    const r = spawnSync(process.execPath, ['--no-warnings', launch, arg], { encoding: 'utf8', timeout: 90_000 });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^tabularius ${version.replaceAll('.', '\\.')}\\ncommit \\S+\\nNode \\S+ or newer is needed; this is Node \\S+\\n$`));
    assert.equal(r.stderr, '');
  });
}

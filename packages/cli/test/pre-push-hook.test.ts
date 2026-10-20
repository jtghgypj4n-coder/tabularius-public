// scripts/git-hooks/pre-push is the opt-in hint that the generated pages are stale: it passes on a current checkout and, when a
// page is out of date, fails with the command that fixes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const hook = join(root, 'scripts', 'git-hooks', 'pre-push');

test('hooks:install points git at the hook, which is executable', () => {
  const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts['hooks:install'], 'git config core.hooksPath scripts/git-hooks');
  assert.ok(existsSync(hook));
  assert.ok(statSync(hook).mode & 0o100, 'the hook is executable');
});

test('the hook passes when the generated pages are current and names the command when one is stale', () => {
  const run = (env: NodeJS.ProcessEnv) => spawnSync('sh', [hook], { cwd: root, encoding: 'utf8', env });
  // An npm whose checks fail stands for a stale page, so no real page is touched while other tests read them.
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-hook-'));
  try {
    const realNpm = spawnSync('sh', ['-c', 'command -v npm'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.ok(realNpm);
    writeFileSync(join(dir, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TABULARIUS_HOOK_LOG"\nif [ "${TABULARIUS_HOOK_EXIT:-0}" != 0 ]; then exit 1; fi\nif [ "$3" = precheck ]; then exit 0; fi\nexec "$TABULARIUS_REAL_NPM" "$@"\n');
    chmodSync(join(dir, 'npm'), 0o755);
    const log = join(dir, 'calls');
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, TABULARIUS_HOOK_LOG: log, TABULARIUS_REAL_NPM: realNpm };
    const clean = run(env);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const calls = readFileSync(log, 'utf8');
    assert.match(calls, /--silent docs:reference -- --check/);
    assert.match(calls, /--silent docs:plugins -- --check/);
    assert.match(calls, /--silent precheck -- --quick/);
    const stale = run({ ...env, TABULARIUS_HOOK_EXIT: '1' });
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /Run `npm run docs:reference`/);
    assert.match(stale.stderr, /Run `npm run docs:plugins`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

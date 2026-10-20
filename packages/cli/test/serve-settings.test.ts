import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings } from '../../server/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('serve reports invalid folder settings and refuses to start', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-serve-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, '.openhbam-settings.json');
  for (const [contents, message] of [['{ half', `${file} isn't valid JSON`], ['{"keep":"abc"}', `${file}: keep must be a number`]]) {
    writeFileSync(file, contents);
    const r = spawnSync(process.execPath, ['--no-warnings', main, 'serve', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('serve accepts valid folder settings', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-serve-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.openhbam-settings.json'), JSON.stringify({ backupEvery: 'off', keep: 3, backupDir: 'backups' }));
  assert.deepEqual(readSettings(dir), { backupEvery: 'off', keep: 3, backupDir: join(dir, 'backups') });
});

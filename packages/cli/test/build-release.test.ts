import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { defaultReleaseVersion, parseReleaseArgs } from '../../../scripts/build-release.ts';

test('release arguments accept defaults, output paths, and filename-safe versions', () => {
  assert.deepEqual(parseReleaseArgs([]), {});
  assert.deepEqual(parseReleaseArgs(['--out', 'release builds', '--version', 'v1.2-RC_3+meta']), {
    out: 'release builds', version: 'v1.2-RC_3+meta',
  });
  assert.deepEqual(parseReleaseArgs(['--version', '1.2.3', '--out', 'dist']), { version: '1.2.3', out: 'dist' });
  assert.deepEqual(parseReleaseArgs(['--out', 'dist']), { out: 'dist' });
  assert.deepEqual(parseReleaseArgs(['--version', '1.2.3']), { version: '1.2.3' });
});

test('release arguments reject unknown flags and positional arguments', () => {
  for (const flag of ['--ouput', '--help', 'dist']) {
    assert.throws(() => parseReleaseArgs([flag]), { message: `Unknown flag: ${flag}` });
  }
});

test('release flags require a nonempty value before the next flag', () => {
  for (const flag of ['--out', '--version']) {
    for (const rest of [[], [''], ['--out', 'dist'], ['--version', '1.2.3'], ['--ouput']]) {
      assert.throws(() => parseReleaseArgs([flag, ...rest]), { message: `Missing value for ${flag}` });
    }
  }
});

test('release versions reject characters outside the filename allowlist', () => {
  for (const version of ['../release', 'path\\release', 'two words', 'v1:2', 'v1\n', 'v1\0', 'vé']) {
    assert.throws(() => parseReleaseArgs(['--version', version]), /Invalid --version/);
  }
});

test('the default release version marks tracked and untracked changes as dirty', () => {
  assert.equal(defaultReleaseVersion('1.2.3', 'abc123', ''), '1.2.3-abc123');
  for (const status of [' M scripts/build-release.ts\n', 'M  package.json\n', '?? new-file.ts\n']) {
    assert.equal(defaultReleaseVersion('1.2.3', 'abc123', status), '1.2.3-abc123-dirty');
  }
});

test('invalid release arguments exit with a clear error before staging', () => {
  for (const [args, message] of [
    [['--ouput', 'dist'], /Unknown flag: --ouput/],
    [['--out'], /Missing value for --out/],
    [['--version'], /Missing value for --version/],
    [['--version', '../release'], /Invalid --version/],
  ] as const) {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, '../../../scripts/build-release.ts'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, '');
  }
});

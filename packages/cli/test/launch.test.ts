import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
const launcher = join(import.meta.dirname, '..', pkg.bin.tabularius);

test('the package entry rejects old Node before loading TypeScript', () => {
  for (const version of ['16.20.2', '18.20.8', '20.19.0', '22.0.0', '22.17.0', '22.19.0']) {
    const code = `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} }); require(${JSON.stringify(launcher)});`;
    const r = spawnSync(process.execPath, ['--no-experimental-strip-types', '-e', code], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'Tabularius needs Node 22.20 or later (https://nodejs.org).\n');
  }
});

test('the package entry passes arguments and exit status through on supported Node', () => {
  for (const version of ['22.20.0', '24.0.0']) {
    const code = `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} }); process.argv = [process.execPath, ${JSON.stringify(launcher)}, 'doctor', '--help']; require(${JSON.stringify(launcher)});`;
    const r = spawnSync(process.execPath, ['--no-warnings', '-e', code], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /tabularius doctor/);
    assert.equal(r.stderr, '');
  }
  const r = spawnSync(process.execPath, ['--no-warnings', launcher, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^unknown command bogus/);
});

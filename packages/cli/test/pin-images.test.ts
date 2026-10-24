import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'pin-images.ts');
const digest = `sha256:${'a'.repeat(64)}`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pin-images-'));
  mkdirSync(join(root, 'bin'));
  for (const name of ['docker', 'curl']) writeFileSync(join(root, 'bin', name), '#!/bin/sh\nprintf called > "$PIN_IMAGES_MARKER"\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(root, 'Dockerfile'), 'FROM node:22-slim\n');
  writeFileSync(join(root, 'compose.yaml'), 'services:\n  app:\n    image: example/app:1.2\n');
  return root;
}
function run(root: string, ...args: string[]) {
  const marker = join(root, 'marker');
  const result = spawnSync(process.execPath, [script, ...args, '--root', root], {
    encoding: 'utf8', env: { ...process.env, PATH: join(root, 'bin'), PIN_IMAGES_MARKER: marker },
  });
  assert.equal(readMaybe(marker), '', 'the script must not invoke docker, curl, or another network command');
  return result;
}
const readMaybe = (file: string) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

test('check classifies Dockerfile and compose image references and require-pinned reports status', () => {
  const root = fixture();
  writeFileSync(join(root, 'Dockerfile'), `FROM node:22-slim@${digest}\n`);
  const listed = run(root, 'check');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /node:22-slim@sha256:[a-f0-9]{64}.*pinned by digest/);
  assert.match(listed.stdout, /example\/app:1\.2.*tag only/);
  const required = run(root, 'check', '--require-pinned');
  assert.equal(required.status, 1);
  assert.match(required.stdout, /example\/app:1\.2.*tag only/);
  writeFileSync(join(root, 'compose.yaml'), `services:\n  app:\n    image: example/app:1.2@${digest}\n`);
  assert.equal(run(root, 'check', '--require-pinned').status, 0);
});

test('write pins only named references, preserves tags, rejects malformed maps without touching files', () => {
  const root = fixture();
  const map = join(root, 'digests.json');
  writeFileSync(map, JSON.stringify({ 'node:22-slim': digest }));
  const result = run(root, 'write', map);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(root, 'Dockerfile'), 'utf8'), new RegExp(`FROM node:22-slim@${digest}`));
  assert.equal(readFileSync(join(root, 'compose.yaml'), 'utf8'), 'services:\n  app:\n    image: example/app:1.2\n');
  const beforeDocker = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const beforeCompose = readFileSync(join(root, 'compose.yaml'), 'utf8');
  writeFileSync(map, JSON.stringify({ 'node:22-slim': digest, 'example/app:1.2': 'sha256:bad' }));
  const bad = run(root, 'write', map);
  assert.equal(bad.status, 1);
  assert.equal(readFileSync(join(root, 'Dockerfile'), 'utf8'), beforeDocker);
  assert.equal(readFileSync(join(root, 'compose.yaml'), 'utf8'), beforeCompose);
});

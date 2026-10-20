import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimFolder } from '../../server/src/backup.ts';
import { readJsonStateSync, sweepStateTempsSync, writeJsonStateSync } from '../src/durable.ts';

test('startup sweeps old state temps, including reused own pid, but preserves live writers and unrelated files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-temps-'));
  const old = new Date(Date.now() - 2 * 3600000);
  const make = (name: string, stale = true) => {
    const path = join(dir, name); writeFileSync(path, 'bytes');
    if (stale) utimesSync(path, old, old);
    return path;
  };
  try {
    const orphan = make(`.state.json.${process.pid}.${randomUUID()}.tmp`);
    const live = make(`..openhbam-settings.json.${process.ppid}.${randomUUID()}.tmp`);
    const fresh = make(`.state.json.${process.pid}.${randomUUID()}.tmp`, false);
    const unrelated = make('.state.json.123.not-a-uuid.tmp');
    const state = make('state.json');
    const link = join(dir, `.state.json.${process.pid}.${randomUUID()}.tmp`);
    symlinkSync(state, link);
    const directory = join(dir, `.state.json.${process.pid}.${randomUUID()}.tmp`);
    mkdirSync(directory); utimesSync(directory, old, old);
    const release = claimFolder(dir); release();
    assert.equal(existsSync(orphan), false);
    for (const path of [live, fresh, unrelated, state, link, directory]) assert.ok(existsSync(path), path);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('first state access also sweeps directories used without hosting a server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-startup-'));
  try {
    const stale = join(dir, `.service.json.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(stale, '{}');
    const old = new Date(Date.now() - 2 * 3600000); utimesSync(stale, old, old);
    const file = join(dir, 'service.json'); writeFileSync(file, '{}');
    assert.deepEqual(readJsonStateSync(file), {});
    assert.equal(existsSync(stale), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an active temp created by this process is retained even if its timestamp is old', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-active-temp-'));
  const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
  const fsync = fs.fsyncSync;
  let checked = false;
  fs.fsyncSync = (fd: number) => {
    const temp = readdirSync(dir).find((name) => name.endsWith('.tmp'));
    if (temp) {
      const path = join(dir, temp), old = new Date(Date.now() - 2 * 3600000);
      utimesSync(path, old, old);
      assert.deepEqual(sweepStateTempsSync(dir), []);
      assert.ok(existsSync(path)); checked = true;
    }
    fsync(fd);
  };
  syncBuiltinESMExports();
  try { writeJsonStateSync(join(dir, 'state.json'), {}); assert.ok(checked); }
  finally { fs.fsyncSync = fsync; syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});

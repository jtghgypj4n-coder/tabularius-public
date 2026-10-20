import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, Schedules } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('an unavailable backup destination stays configured, is reported, and works after it returns', { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sched-backup-offline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir);
  const id = 'backup-offline';
  const parent = join(dir, 'unmounted-drive');
  const dest = join(parent, 'nightly');
  writeFileSync(join(dir, '.openhbam-schedules.json'), JSON.stringify({ schedules: [
    { id, kind: 'backup', name: 'Nightly', dest, keep: 2, everyMinutes: 1440, enabled: false },
  ] }));
  const schedules = new Schedules(host, () => {});
  try {
    assert.equal(schedules.all().length, 1);
    assert.match(schedules.all()[0].unavailable ?? '', /isn't there|can't write/);
    schedules.update(id, { name: 'Nightly backup' });
    schedules.create({ kind: 'message', name: 'Also saved', message: 'hello', everyMinutes: 60, enabled: false });
    assert.match(readFileSync(join(dir, '.openhbam-schedules.json'), 'utf8'), /backup-offline/);
    const skipped = await schedules.run(id);
    assert.notEqual(skipped.error, 0);
    assert.match(skipped.message ?? '', /isn't there|can't write/);
    mkdirSync(parent);
    const recovered = await schedules.run(id);
    assert.equal(recovered.error, 0, recovered.message);
    assert.equal(schedules.all().find((s) => s.id === id)?.unavailable, undefined);
  } finally {
    schedules.stop();
    host.close();
  }
});

test('listing schedules only looks at a backup destination: it never makes the folder or writes to it', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sched-backup-look-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir);
  const parent = join(dir, 'drive');
  const dest = join(parent, 'nightly');
  mkdirSync(parent);
  writeFileSync(join(dir, '.openhbam-schedules.json'), JSON.stringify({ schedules: [
    { id: 'look', kind: 'backup', name: 'Nightly', dest, keep: 2, everyMinutes: 1440, enabled: false },
  ] }));
  const schedules = new Schedules(host, () => {});
  try {
    let now = performance.now();
    t.mock.method(performance, 'now', () => now);
    assert.match(schedules.all()[0].unavailable ?? '', /isn't there/);
    assert.equal(existsSync(dest), false, 'listing must not create the folder');
    mkdirSync(dest);
    assert.match(schedules.all()[0].unavailable ?? '', /isn't there/, 'a second listing uses the first check');
    now += 60_001;
    assert.equal(schedules.all()[0].unavailable, undefined);
    assert.deepEqual(readdirSync(dest), [], 'listing must not leave a probe file');
  } finally {
    schedules.stop();
    host.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { importFmp12 } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('startup and folder watcher publish one complete store when converting the same file', { skip, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-conversion-race-'));
  const logs: string[] = [];
  let watcher: Host | undefined;
  let startup: Host | undefined;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  try {
    copyFileSync(fixture, join(dir, 'Flicks.fmp12'));
    watcher = new Host(dir, (line) => logs.push(line), { background: true });
    // Hold the worker conversion after scan has committed to it. A second Host
    // then takes the synchronous startup path against the same source file.
    (watcher as unknown as { convert: (src: string, dest: string) => Promise<{ tables: number; records: number }> }).convert = async (src, dest) => {
      started();
      await held;
      const stats = importFmp12(src, dest);
      return { tables: stats.length, records: stats.reduce((n, stat) => n + stat.records, 0) };
    };
    const scanning = watcher.scan((line) => logs.push(line));
    await entered;
    startup = new Host(dir, (line) => logs.push(line));
    release();
    assert.equal(await scanning, 'Flicks');
    assert.ok(startup.get('Flicks'));
    assert.ok(watcher.get('Flicks'));
    assert.equal(logs.filter((line) => /^converted Flicks\.fmp12:/.test(line)).length, 1, logs.join('\n'));
    assert.ok(!logs.some((line) => /couldn't convert|ENOENT/.test(line)), logs.join('\n'));
    assert.deepEqual(readdirSync(dir).filter((file) => file.startsWith('Flicks.openhbam.sqlite.tmp')), []);
  } finally {
    release();
    watcher?.close();
    startup?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

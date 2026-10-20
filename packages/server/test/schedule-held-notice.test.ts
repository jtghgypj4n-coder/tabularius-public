// A schedule whose approval no longer covers its files is named in the server's event log when the server starts, rather
// than first being found out by a run that quietly goes without its connections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('starting the server logs one warning for each network schedule whose connections are held', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-held-notice-'));
  try {
    copyFileSync(fixture, join(dir, 'Charts.fmp12'));
    const schedule = (id: string, name: string, extra: Record<string, unknown>) =>
      ({ id, name, database: 'Charts', script: 'Nightly', account: 'Admin', everyMinutes: 1440, enabled: true, ...extra });
    // Approved before this server (no seal), network off (nothing to hold), and a message schedule (not a script).
    writeFileSync(join(dir, '.openhbam-schedules.json'), JSON.stringify({ schedules: [
      schedule('a1', 'Upload report', { network: true }),
      schedule('b2', 'Local only', {}),
      { id: 'c3', name: 'Say hello', kind: 'message', message: 'hello', everyMinutes: 1440, enabled: true, database: 'Charts', script: '', account: 'Admin' },
    ] }));
    const s = await serve({ dir, port: 0, scriptNetwork: true, log: () => {} });
    try {
      await new Promise((r) => setTimeout(r, 100));
      const { entries } = await s.host.logs!.read('Event', { q: 'connections held' });
      assert.equal(entries.length, 1, JSON.stringify(entries));
      assert.match(entries[0].message, /Schedule "Upload report" \(Charts, script Nightly\) has its connections held/);
      assert.match(entries[0].message, /approved again in the console's Schedules page/);
      assert.equal(entries[0].type, 'Warning');
    } finally {
      await new Promise<void>((r) => s.server.close(() => r()));
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

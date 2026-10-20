import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { Metrics } from '../src/metrics.ts';
import type { MetricSources } from '../src/metrics.ts';

test('monitoring guide documents every metric emitted in a HELP line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-monitoring-docs-'));
  const host = new Host(dir);
  const metrics = new Metrics();
  try {
    const now = Date.now();
    // Supply every optional source so conditional families are covered without hosted files.
    metrics.sources = {
      host,
      clients: () => [],
      liveStreams: () => 0,
      sessionsHeld: () => 0,
      pgConnections: () => 0,
      backups: { last: { at: now, ok: false } },
      progressive: { last: { at: now, ok: true } },
      offsite: { last: { at: now, ok: true } },
      schedules: () => [{ id: '1', name: 'Nightly', enabled: true, next: new Date(now + 60_000).toISOString(), last: { at: new Date(now).toISOString(), error: 0 }, runs: 1, failures: 0 }],
      certificateExpires: () => now + 86_400_000,
      standbys: () => [{ from: 'standby.example.com', file: 'Orders', behind: 0, at: now }],
      diskFree: () => [{ area: 'data', path: dir }],
      statfs: () => ({ bavail: 1000, bsize: 4096 }),
    } satisfies Required<MetricSources>;
    const names = [...metrics.render().matchAll(/^# HELP (\S+) /gm)].map((m) => m[1]);
    assert.ok(names.length > 0, 'render emits HELP lines');
    const doc = readFileSync(new URL('../../../docs/monitoring.md', import.meta.url), 'utf8');
    const missing = names.filter((name) => !doc.includes(`| \`${name}\` |`));
    assert.deepEqual(missing, [], `metrics missing from docs/monitoring.md: ${missing.join(', ')}`);
  } finally {
    metrics.stop();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

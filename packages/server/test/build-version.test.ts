import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { Metrics } from '../src/metrics.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

test('metrics expose the package version as a build info gauge', () => {
  const metrics = new Metrics();
  try {
    const lines = metrics.render().trimEnd().split('\n');
    assert.ok(lines.includes('# TYPE tabularius_build_info gauge'));
    assert.ok(lines.includes(`tabularius_build_info{version="${version}"} 1`));
  } finally {
    metrics.stop();
  }
});

test('the Server started event records the package version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-build-version-'));
  try {
    const { server, host, url } = await serve({ dir, port: 0, watch: false, log: () => {} });
    try {
      await host.logs!.flush();
      const lines = readFileSync(join(dir, 'Logs', 'Event.log'), 'utf8').trimEnd().split('\n');
      const started = lines.filter((line) => line.includes('\tServer started at '));
      assert.equal(started.length, 1);
      assert.equal(started[0].split('\t').at(-1), `Server started at ${url}, hosting 0 files (version ${version})`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

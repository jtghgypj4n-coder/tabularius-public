// A file being converted, or one that failed, is visible: the Data API says
// "being converted" (503 with Retry-After) instead of "missing", and the admin
// status lists files that could not be converted with the reason.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-visibility-'));
  const s = await serve({ dir, port: 0, listFilesPublicly: true, log: () => {} });
  ({ server, host } = s);
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true });
});

test('the admin status lists a file that failed to convert, with the reason', async () => {
  writeFileSync(join(dir, 'Broken.fmp12'), 'this is not a FileMaker file at all');
  await host.scan(); // first sighting
  await host.scan(); // size unchanged: converted, and fails
  const status = await (await fetch(`${base}/tabularius/admin/v1/status`, { headers: { 'x-tabularius-admin': '1' } })).json();
  assert.equal(status.failed.length, 1);
  assert.equal(status.failed[0].file, 'Broken.fmp12');
  assert.ok(status.failed[0].error.length > 0);
});

test('a file still converting answers 503 with Retry-After, not 404', async () => {
  host.converted.set('Slow', { phase: 'records' } as never);
  const converting = await fetch(`${base}/fmi/data/vLatest/databases/Slow/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('a:b') }, body: '{}' });
  assert.equal(converting.status, 503);
  assert.equal(converting.headers.get('retry-after'), '5');
  assert.match((await converting.json()).messages[0].message, /Slow is being converted/);
  host.converted.delete('Slow');
  const missing = await fetch(`${base}/fmi/data/vLatest/databases/Nope/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('a:b') }, body: '{}' });
  assert.equal(missing.status, 404);
});

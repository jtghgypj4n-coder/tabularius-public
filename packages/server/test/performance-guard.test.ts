// A guard against slowdowns on real files: the two Beezwax demo files are converted and hosted, then each layout's
// first page, a sort, a found set and a record's portal are timed. The limits are generous (about ten times what a
// slow machine takes), so only a real regression, not a busy runner, fails them. The numbers go to a file
// (TABULARIUS_PERF_OUT, else the temp folder) and into the test output, so a slow creep shows before it breaks a limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const files = ['BeezwaxSemanticSearch', 'BeezwaxUnifiedSearchActions'];
const skip = files.every((f) => existsSync(join(fixtures, `${f}.fmp12`))) ? false : 'fixtures missing: run npm run fixtures';

/** Milliseconds a slow runner is still allowed. */
const LIMIT = { convert: 30_000, reopen: 10_000, page: 500, sort: 1_000, record: 500 };
const RUNS = 5;

let dir: string;
let host: Host;
let server: Server;
const rows: { area: string; what: string; ms: number }[] = [];

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
function measure(area: string, what: string, limit: number, run: () => unknown): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    run();
    times.push(performance.now() - t);
  }
  const ms = median(times);
  rows.push({ area, what, ms: Math.round(ms * 10) / 10 });
  assert.ok(ms < limit, `${area}: ${what} took ${ms.toFixed(0)} ms (median of ${RUNS}); the limit is ${limit} ms`);
  return ms;
}

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-perf-'));
  for (const f of files) copyFileSync(join(fixtures, `${f}.fmp12`), join(dir, `${f}.fmp12`));
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  const out = process.env.TABULARIUS_PERF_OUT || join(tmpdir(), `tabularius-perf-${process.pid}.json`);
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), node: process.version, platform: process.platform, cpu: `${cpus()[0]?.model ?? 'unknown'} x ${cpus().length}`, rows }, null, 2));
  } catch { /* the numbers are in the output too */ }
  for (const r of rows) process.stderr.write(`perf ${r.area.padEnd(8)} ${String(r.ms).padStart(9)} ms  ${r.what}\n`);
});

test('converting and hosting the two Beezwax files is within its limit, and opening them again is quick', { skip }, async () => {
  const hosted = async () => {
    const t = performance.now();
    const s = await serve({ dir, port: 0, log: () => {} });
    while (s.host.openStores().length < files.length) {
      if (performance.now() - t > LIMIT.convert) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return { s, ms: performance.now() - t };
  };
  const first = await hosted();
  rows.push({ area: 'open', what: 'convert and host both files (cold)', ms: Math.round(first.ms) });
  assert.equal(first.s.host.openStores().length, files.length, `both files hosted within ${LIMIT.convert} ms`);
  assert.ok(first.ms < LIMIT.convert, `cold open took ${first.ms.toFixed(0)} ms; the limit is ${LIMIT.convert} ms`);
  await new Promise<void>((r) => first.s.server.close(() => r()));

  const again = await hosted();
  rows.push({ area: 'open', what: 'host both files again (already converted)', ms: Math.round(again.ms) });
  assert.ok(again.ms < LIMIT.reopen, `reopening took ${again.ms.toFixed(0)} ms; the limit is ${LIMIT.reopen} ms`);
  server = again.s.server;
  host = again.s.host;
});

test('every layout\'s first page, sorted page, found set and portal rows are quick', { skip }, () => {
  const stores = host.openStores();
  assert.equal(stores.length, files.length);
  for (const store of stores) {
    for (const layout of store.layouts()) {
      const name = `${store.name}: ${layout.name}`;
      const first = store.find(layout.name, { limit: 50 });
      measure('page', `${name}, first 50 records`, LIMIT.page, () => store.find(layout.name, { limit: 50 }));
      if (!first.foundCount) continue;
      const fields = Object.keys(first.records[0].fieldData);
      const field = fields.find((f) => typeof first.records[0].fieldData[f] === 'string' && first.records[0].fieldData[f] !== '' && !f.includes('::'));
      if (field) {
        measure('sort', `${name}, all records by ${field}`, LIMIT.sort, () => store.find(layout.name, { limit: 50, sort: [{ fieldName: field, sortOrder: 'ascend' }] }));
        const value = String(first.records[0].fieldData[field]).split(/\s+/)[0];
        measure('find', `${name}, ${field} = "${value}"`, LIMIT.page, () => store.find(layout.name, { limit: 50, query: [{ [field]: value }] }));
      }
      if (first.records.some((r) => Object.keys(r.portalData ?? {}).length)) {
        const id = first.records.find((r) => Object.keys(r.portalData ?? {}).length)!.recordId;
        measure('portal', `${name}, one record with its portal rows`, LIMIT.record, () => store.get(layout.name, Number(id)));
      }
    }
  }
  assert.ok(rows.some((r) => r.area === 'portal'), 'at least one portal was timed');
});

// The memory guard: work that would fill the server's memory stops with
// FileMaker error 812 ("Exceeded host's capacity") before the process dies,
// so one request fails and the server keeps running for everyone else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('a request that keeps taking memory gets error 812, and the process lives', () => {
  const errors = join(import.meta.dirname, '..', 'src', 'errors.ts');
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--no-warnings', '--input-type=module', '-e', `
    import { checkMemory, StoreError } from ${JSON.stringify(errors)};
    // Records gathered a page at a time, as a query would.
    const held = [];
    let page = [];
    try {
      for (let i = 0; ; i++) {
        checkMemory();
        page.push({ a: 'x'.repeat(16) + i, b: i });
        if (page.length === 1000) { held.push(page); page = []; }
      }
    } catch (e) {
      held.length = 0;
      console.log(e instanceof StoreError ? e.code + ' ' + e.message : 'other ' + e);
    }
    console.log('still running');
  `], { encoding: 'utf8', timeout: 60_000 });
  assert.match(r.stdout, /^812 Exceeded host's capacity/m, r.stderr);
  assert.match(r.stdout, /still running/);
  assert.equal(r.status, 0);
});

test('garbage not yet collected is not counted against a request: no 812 once the memory is let go', () => {
  const errors = join(import.meta.dirname, '..', 'src', 'errors.ts');
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--no-warnings', '--input-type=module', '-e', `
    import { getHeapStatistics } from 'node:v8';
    import { checkMemory, StoreError } from ${JSON.stringify(errors)};
    // Fill the heap to about 95 percent of what the guard allows, then let all of it go without collecting.
    let held = [];
    const h = getHeapStatistics();
    const allowed = Math.max(h.heap_size_limit - 48 * 2 ** 20, h.heap_size_limit / 2);
    while (getHeapStatistics().used_heap_size < allowed * 0.95) {
      const page = [];
      for (let i = 0; i < 1000; i++) page.push({ a: 'x'.repeat(16) + i, b: i });
      held.push(page);
    }
    held = null;
    try {
      for (let i = 0; i < 5000; i++) checkMemory();
      console.log('no refusal');
    } catch (e) {
      console.log(e instanceof StoreError ? e.code + ' ' + e.message : 'other ' + e);
    }
  `], { encoding: 'utf8', timeout: 60_000 });
  assert.match(r.stdout, /^no refusal$/m, r.stdout + r.stderr);
  assert.equal(r.status, 0);
});
